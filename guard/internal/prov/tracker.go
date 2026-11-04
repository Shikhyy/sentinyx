package prov

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
)

// Source answers "where did this value come from?".
type Source interface {
	LabelOf(kind ValueKind, value string) (Label, error)
}

type key struct {
	k ValueKind
	v string
}

// Tracker remembers values seen in labelled text. Matching is by value
// (normalised string equality; substring for commands), not data flow: it only
// recognises values the model copies through verbatim.
type Tracker struct {
	mu        sync.Mutex
	known     map[key]Label // user / trusted: win over untrusted
	untrusted map[key]Label
	file      string // optional shared JSONL file of untrusted values
	offset    int64
}

func NewTracker() *Tracker {
	return &Tracker{known: map[key]Label{}, untrusted: map[key]Label{}}
}

// NewSharedTracker persists untrusted values to path (append-only JSONL) and
// picks up values appended by other Guard processes.
func NewSharedTracker(path string) *Tracker {
	t := NewTracker()
	t.file = path
	return t
}

type record struct {
	Kind   ValueKind `json:"kind"`
	Value  string    `json:"value"`
	Origin string    `json:"origin"`
}

func normalize(kind ValueKind, v string) string {
	switch kind {
	case VAddress, VPackage:
		return NormalizeAddress(v)
	case VCommand:
		return NormalizeCommand(v)
	case VAmount:
		return NormalizeAmount(v)
	}
	return strings.TrimSpace(v)
}

// Register labels one value explicitly (e.g. an address the user typed).
// user/trusted labels override untrusted ones. Untrusted labels are persisted.
func (t *Tracker) Register(l Label, kind ValueKind, value string) error {
	value = normalize(kind, value)
	if value == "" {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	k := key{kind, value}
	if !l.IsUntrusted() {
		t.known[k] = l
		return nil
	}
	if _, ok := t.untrusted[k]; !ok {
		t.untrusted[k] = l
	}
	return t.appendLocked(record{Kind: kind, Value: value, Origin: l.Origin})
}

func (t *Tracker) appendLocked(r record) error {
	if t.file == "" {
		return nil
	}
	f, err := os.OpenFile(t.file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	b, _ := json.Marshal(r)
	_, err = f.Write(append(b, '\n'))
	return err
}

// Observe extracts addresses, packages, commands, URLs and amounts from text
// and records them under label l. It returns the number of values recorded.
func (t *Tracker) Observe(l Label, text string) (int, error) {
	n := 0
	var firstErr error
	reg := func(kind ValueKind, v string) {
		if err := t.Register(l, kind, v); err != nil && firstErr == nil {
			firstErr = err
		}
		n++
	}
	for _, a := range ExtractAddresses(text) {
		reg(VAddress, a)
	}
	for _, p := range ExtractPackages(text) {
		reg(VPackage, p.Name)
	}
	for _, c := range ExtractCommands(text) {
		reg(VCommand, c)
	}
	for _, u := range ExtractURLs(text) {
		reg(VURL, u)
	}
	if l.IsUntrusted() { // amounts only matter when attacker text names them
		for _, a := range ExtractAmounts(text) {
			reg(VAmount, a)
		}
	}
	return n, firstErr
}

// refreshLocked loads records appended to the shared file since last read.
func (t *Tracker) refreshLocked() error {
	if t.file == "" {
		return nil
	}
	f, err := os.Open(t.file)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if st.Size() < t.offset { // truncated: start over
		t.offset = 0
		t.untrusted = map[key]Label{}
	}
	if _, err := f.Seek(t.offset, 0); err != nil {
		return err
	}
	br := bufio.NewReader(f)
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 0 && line[len(line)-1] == '\n' {
			t.offset += int64(len(line))
			var r record
			if jerr := json.Unmarshal(line, &r); jerr != nil {
				return fmt.Errorf("taint file %s: corrupt record: %w", t.file, jerr)
			}
			k := key{r.Kind, r.Value}
			if _, ok := t.untrusted[k]; !ok {
				t.untrusted[k] = Untrusted(r.Origin)
			}
		}
		if err != nil {
			break
		}
	}
	return nil
}

// LabelOf implements Source. Errors (e.g. an unreadable taint file) must be
// treated by callers as "cannot decide".
func (t *Tracker) LabelOf(kind ValueKind, value string) (Label, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := t.refreshLocked(); err != nil {
		return Label{}, err
	}
	v := normalize(kind, value)
	k := key{kind, v}
	if l, ok := t.known[k]; ok {
		return l, nil
	}
	if l, ok := t.untrusted[k]; ok {
		return l, nil
	}
	if kind == VCommand && len(v) >= 8 {
		for uk, l := range t.untrusted {
			if uk.k == VCommand && (strings.Contains(v, uk.v) || strings.Contains(uk.v, v)) {
				return l, nil
			}
		}
	}
	return Unlabeled(), nil
}
