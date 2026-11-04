package trace

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoggerWritesOneJSONLinePerEntry(t *testing.T) {
	var buf bytes.Buffer
	l := New(&buf)
	for _, d := range []string{"allow", "deny", "hold"} {
		if err := l.Log(&Entry{Agent: "a", Action: "x", Decision: d, Reason: "r"}); err != nil {
			t.Fatal(err)
		}
	}
	lines := strings.Split(strings.TrimSuffix(buf.String(), "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("want 3 lines, got %d", len(lines))
	}
	ids := map[string]bool{}
	for i, ln := range lines {
		var e Entry
		if err := json.Unmarshal([]byte(ln), &e); err != nil {
			t.Fatalf("line %d invalid JSON: %v", i, err)
		}
		if e.Args == nil || e.Provenance == nil {
			t.Errorf("line %d: args/provenance must be {} not null: %s", i, ln)
		}
		ids[e.ID] = true
	}
	if len(ids) != 3 {
		t.Fatal("IDs must be unique")
	}
}

func TestLogFillsIDAndCreatedAtButKeepsExplicit(t *testing.T) {
	l := New(&bytes.Buffer{})
	e := &Entry{}
	before := time.Now().UTC().Add(-time.Second)
	if err := l.Log(e); err != nil {
		t.Fatal(err)
	}
	if len(e.ID) != 16 || e.CreatedAt.Before(before) {
		t.Fatalf("not filled: %+v", e)
	}
	fixed := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	e2 := &Entry{ID: "mine", CreatedAt: fixed}
	l.Log(e2)
	if e2.ID != "mine" || !e2.CreatedAt.Equal(fixed) {
		t.Fatalf("explicit values overwritten: %+v", e2)
	}
}

func TestNewFileIs0600AndAppends(t *testing.T) {
	p := filepath.Join(t.TempDir(), "t.jsonl")
	l, err := NewFile(p)
	if err != nil {
		t.Fatal(err)
	}
	l.Log(&Entry{Decision: "allow"})
	l.Close()
	st, _ := os.Stat(p)
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v, want 0600", st.Mode().Perm())
	}
	l2, _ := NewFile(p)
	l2.Log(&Entry{Decision: "deny"})
	l2.Close()
	b, _ := os.ReadFile(p)
	if n := strings.Count(string(b), "\n"); n != 2 {
		t.Fatalf("want 2 appended lines, got %d", n)
	}
	if _, err := NewFile(filepath.Join(t.TempDir(), "no", "dir", "x")); err == nil {
		t.Fatal("unwritable path must error")
	}
}
