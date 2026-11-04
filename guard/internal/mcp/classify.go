package mcp

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/Shikhyy/sentinyx/guard/internal/policy"
	"github.com/Shikhyy/sentinyx/guard/internal/prov"
)

func set(s ...string) map[string]bool {
	m := map[string]bool{}
	for _, v := range s {
		m[v] = true
	}
	return m
}

var (
	recipientKeys = set("to", "recipient", "recipients", "receiver", "destination", "dest", "toaddress", "recipientaddress", "payee")
	spenderKeys   = set("spender", "operator", "delegate", "spenderaddress")
	amountKeys    = set("amount", "value", "quantity", "amountwei", "rawamount")
	packageKeys   = set("package", "packages", "pkg", "packagename", "dependency", "dependencies", "module")
	commandKeys   = set("command", "cmd", "script", "shell", "commandline")
)

func normKey(k string) string {
	return strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(k))
}

// strs flattens a JSON value into strings (numbers keep their literal form).
func strs(v any) []string {
	switch x := v.(type) {
	case string:
		return []string{x}
	case json.Number:
		return []string{x.String()}
	case []any:
		var out []string
		for _, e := range x {
			out = append(out, strs(e)...)
		}
		return out
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var out []string
		for _, k := range keys {
			out = append(out, strs(x[k])...)
		}
		return out
	}
	return nil
}

// Classify maps a tools/call to an Action. Roles come from argument names
// (recipient, spender, package, command, ...), not from trusting the tool.
// Shell commands are also searched for addresses, install targets and URLs;
// every other address found in any argument becomes a "target" (hold if tainted).
func Classify(agent, tool string, args map[string]any) policy.Action {
	a := policy.Action{Agent: agent, Name: tool, Kind: "call", Detail: sanitize(args)}
	seenAddr := map[string]bool{}
	addArg := func(name string, role policy.Role, kind prov.ValueKind, v, eco string) {
		if strings.TrimSpace(v) == "" {
			return
		}
		a.Args = append(a.Args, policy.Arg{Name: name, Role: role, Kind: kind, Value: v, Eco: eco})
		if kind == prov.VAddress {
			seenAddr[prov.NormalizeAddress(v)] = true
		}
	}
	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		nk := normKey(k)
		vals := strs(args[k])
		for i, v := range vals {
			name := k
			if len(vals) > 1 {
				name = fmt.Sprintf("%s[%d]", k, i)
			}
			switch {
			case commandKeys[nk]:
				a.Kind = "shell"
				addArg(name, policy.RoleCommand, prov.VCommand, v, "")
				for _, p := range prov.ExtractPackages(v) {
					addArg("install:"+p.Name, policy.RolePackage, prov.VPackage, p.Name, p.Eco)
				}
				for _, ad := range prov.ExtractAddresses(v) {
					addArg("cmd_address:"+ad[:10], policy.RoleRecipient, prov.VAddress, ad, "")
				}
				for _, u := range prov.ExtractURLs(v) {
					addArg("cmd_url", policy.RoleURL, prov.VURL, u, "")
				}
			case packageKeys[nk]:
				if a.Kind == "call" {
					a.Kind = "install"
				}
				addArg(name, policy.RolePackage, prov.VPackage, prov.NormalizePackage(stripVersion(v)), guessEco(tool))
			case recipientKeys[nk] && len(prov.ExtractAddresses(v)) > 0:
				if a.Kind == "call" {
					a.Kind = "transfer"
				}
				addArg(name, policy.RoleRecipient, prov.VAddress, v, "")
			case spenderKeys[nk]:
				if a.Kind == "call" {
					a.Kind = "approve"
				}
				addArg(name, policy.RoleSpender, prov.VAddress, v, "")
			case amountKeys[nk]:
				addArg(name, policy.RoleAmount, prov.VAmount, v, "")
			}
		}
	}
	// Any other address anywhere in the arguments: hold if it is tainted.
	for _, s := range strs(args) {
		for _, ad := range prov.ExtractAddresses(s) {
			if !seenAddr[ad] {
				addArg("address:"+ad[:10], policy.RoleTarget, prov.VAddress, ad, "")
			}
		}
	}
	return a
}

func stripVersion(v string) string {
	if i := strings.LastIndex(v, "@"); i > 0 {
		return v[:i]
	}
	return v
}

func guessEco(tool string) string {
	t := strings.ToLower(tool)
	switch {
	case strings.Contains(t, "pip"), strings.Contains(t, "python"), strings.Contains(t, "cargo"):
		return ""
	}
	return "npm"
}

// sanitize truncates long strings so traces stay small.
func sanitize(v map[string]any) map[string]any {
	out := make(map[string]any, len(v))
	for k, x := range v {
		out[k] = trunc(x)
	}
	return out
}

func trunc(v any) any {
	switch x := v.(type) {
	case string:
		if len(x) > 512 {
			return x[:512] + "…"
		}
		return x
	case []any:
		o := make([]any, len(x))
		for i, e := range x {
			o[i] = trunc(e)
		}
		return o
	case map[string]any:
		return sanitize(x)
	}
	return v
}
