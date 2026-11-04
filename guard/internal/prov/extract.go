package prov

import (
	"regexp"
	"strings"
)

type ValueKind string

const (
	VAddress ValueKind = "address"
	VPackage ValueKind = "package"
	VCommand ValueKind = "command"
	VURL     ValueKind = "url"
	VAmount  ValueKind = "amount"
)

// Pkg is a package name found in an install command. Eco is "npm" for
// npm/pnpm/yarn/bun/npx, otherwise the tool name ("pip", "cargo", ...).
type Pkg struct{ Eco, Name string }

var hexRe = regexp.MustCompile(`(?i)0x[0-9a-f]+`)

// ExtractAddresses returns lower-cased 20-byte hex addresses found in text.
func ExtractAddresses(text string) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range hexRe.FindAllString(text, -1) {
		if len(m) != 42 {
			continue
		}
		a := strings.ToLower(m)
		if !seen[a] {
			seen[a] = true
			out = append(out, a)
		}
	}
	return out
}

func NormalizeAddress(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

var urlRe = regexp.MustCompile("https?://[^\\s'\"`<>)\\]]+")

func ExtractURLs(text string) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range urlRe.FindAllString(text, -1) {
		m = strings.TrimRight(m, ".,;:!?")
		if !seen[m] {
			seen[m] = true
			out = append(out, m)
		}
	}
	return out
}

var (
	amountVerbRe = regexp.MustCompile(`(?i)\b(send|transfer|pay|withdraw|approve|move|wire|drain|swap|bridge)\w*`)
	numRe        = regexp.MustCompile(`\d[\d,]*(?:\.\d+)?`)
)

// NormalizeAmount canonicalises a decimal string ("1,000.50" -> "1000.5").
func NormalizeAmount(s string) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	t := strings.TrimLeft(s, "0")
	if t == "" || t[0] == '.' {
		t = "0" + t
	}
	return t
}

// ExtractAmounts returns numbers (2+ chars) that appear within 100 bytes of a
// money-moving verb. This is deliberately narrow: bare numbers are too noisy.
func ExtractAmounts(text string) []string {
	var out []string
	seen := map[string]bool{}
	for _, v := range amountVerbRe.FindAllStringIndex(text, -1) {
		lo, hi := v[0]-100, v[1]+100
		if lo < 0 {
			lo = 0
		}
		if hi > len(text) {
			hi = len(text)
		}
		for _, n := range numRe.FindAllString(text[lo:hi], -1) {
			n = NormalizeAmount(n)
			if len(n) >= 2 && !seen[n] {
				seen[n] = true
				out = append(out, n)
			}
		}
	}
	return out
}

var segSplit = regexp.MustCompile("&&|\\|\\||[;|\n`]")

var npmTools = map[string]bool{"npm": true, "pnpm": true, "yarn": true, "bun": true}

// ExtractPackages finds packages named by install commands inside text.
func ExtractPackages(text string) []Pkg {
	var out []Pkg
	seen := map[string]bool{}
	add := func(eco, tok string) {
		n := normalizePkg(eco, tok)
		if n == "" || seen[eco+"|"+n] {
			return
		}
		seen[eco+"|"+n] = true
		out = append(out, Pkg{Eco: eco, Name: n})
	}
	for _, seg := range segSplit.Split(text, -1) {
		f := strings.Fields(seg)
		for i := 0; i < len(f); i++ {
			tool := f[i]
			next := ""
			if i+1 < len(f) {
				next = f[i+1]
			}
			switch {
			case npmTools[tool] && (next == "install" || next == "i" || next == "add"):
				collect(f[i+2:], func(t string) { add("npm", t) })
			case (tool == "pip" || tool == "pip3") && next == "install":
				collect(f[i+2:], func(t string) { add("pip", t) })
			case (tool == "cargo" || tool == "gem") && next == "install":
				collect(f[i+2:], func(t string) { add(tool, t) })
			case tool == "go" && (next == "install" || next == "get"):
				collect(f[i+2:], func(t string) { add("go", t) })
			case tool == "npx" || tool == "bunx":
				collect(f[i+1:], func(t string) { add("npm", t) }, 1)
			case tool == "uvx" || tool == "pipx":
				collect(f[i+1:], func(t string) { add("pip", t) }, 1)
			}
		}
	}
	return out
}

var flagWithArg = map[string]bool{"-r": true, "-c": true, "-e": true, "--requirement": true, "--constraint": true, "--registry": true, "--prefix": true, "-p": true, "--package": true}

func collect(toks []string, fn func(string), limit ...int) {
	n := 0
	for i := 0; i < len(toks); i++ {
		t := toks[i]
		if strings.HasPrefix(t, "-") {
			if flagWithArg[t] {
				i++
			}
			continue
		}
		if t == "run" || t == "exec" {
			continue
		}
		if strings.ContainsAny(t, "<>$(){}") || strings.HasPrefix(t, ".") || strings.HasPrefix(t, "/") || strings.HasPrefix(t, "~") {
			break
		}
		fn(t)
		n++
		if len(limit) > 0 && n >= limit[0] {
			return
		}
	}
}

var verSplit = regexp.MustCompile(`[=<>~!^]`)

func normalizePkg(eco, tok string) string {
	tok = strings.Trim(tok, "'\"")
	if tok == "" {
		return ""
	}
	if i := verSplit.FindStringIndex(tok); i != nil && i[0] > 0 {
		tok = tok[:i[0]]
	}
	if i := strings.LastIndex(tok, "@"); i > 0 { // name@1.2.3 or @scope/name@1.2.3
		tok = tok[:i]
	}
	return NormalizePackage(tok)
}

// NormalizePackage lower-cases a package name.
func NormalizePackage(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

var pipeToShell = regexp.MustCompile(`\|\s*(sudo\s+)?(ba|z|da)?sh\b`)

var cmdBins = map[string]bool{
	"curl": true, "wget": true, "sh": true, "bash": true, "zsh": true, "sudo": true, "rm": true,
	"npm": true, "npx": true, "pnpm": true, "yarn": true, "pip": true, "pip3": true, "python": true,
	"python3": true, "node": true, "cast": true, "git": true, "chmod": true, "nc": true, "ssh": true,
	"scp": true, "docker": true, "eval": true, "powershell": true, "cat": true, "echo": true, "mv": true, "cp": true,
}

// NormalizeCommand collapses whitespace and strips a leading prompt.
func NormalizeCommand(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "$ ")
	s = strings.TrimPrefix(s, "> ")
	return strings.Join(strings.Fields(s), " ")
}

func looksLikeCommand(c string) bool {
	if len(c) < 8 {
		return false
	}
	if pipeToShell.MatchString(c) {
		return true
	}
	f := strings.Fields(c)
	if len(f) < 2 {
		return false
	}
	if f[0] == "sudo" && len(f) > 2 {
		f = f[1:]
	}
	return cmdBins[f[0]]
}

var backtickRe = regexp.MustCompile("`([^`\n]+)`")

// ExtractCommands returns shell-looking lines and `inline code` spans.
func ExtractCommands(text string) []string {
	var cands []string
	for _, line := range strings.Split(text, "\n") {
		cands = append(cands, line)
	}
	for _, m := range backtickRe.FindAllStringSubmatch(text, -1) {
		cands = append(cands, m[1])
	}
	var out []string
	seen := map[string]bool{}
	for _, c := range cands {
		c = NormalizeCommand(strings.Trim(strings.TrimSpace(c), "`"))
		if looksLikeCommand(c) && !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out
}
