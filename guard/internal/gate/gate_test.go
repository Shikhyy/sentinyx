package gate

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/sentinyx/guard/internal/policy"
	"github.com/sentinyx/guard/internal/prov"
	"github.com/sentinyx/guard/internal/trace"
)

type errSrc struct{}

func (errSrc) LabelOf(prov.ValueKind, string) (prov.Label, error) {
	return prov.Label{}, errors.New("store down")
}

type panicSrc struct{}

func (panicSrc) LabelOf(prov.ValueKind, string) (prov.Label, error) { panic("boom") }

const evil = "0xabcdef0123456789abcdef0123456789abcdef01"

func act(to string) policy.Action {
	return policy.Action{Agent: "ag", Name: "send", Kind: "transfer",
		Detail: map[string]any{"to": to},
		Args:   []policy.Arg{{Name: "recipient", Role: policy.RoleRecipient, Kind: prov.VAddress, Value: to}}}
}

func TestCheckDecisionsAreLogged(t *testing.T) {
	tr := prov.NewTracker()
	tr.Observe(prov.Untrusted("tool:x"), "pay "+evil)
	tests := []struct {
		name   string
		src    prov.Source
		want   policy.Decision
		reason string
	}{
		{"tainted => deny", tr, policy.Deny, "untrusted:tool:x"},
		{"engine error => hold", errSrc{}, policy.Hold, "fail closed"},
		{"engine panic => hold", panicSrc{}, policy.Hold, "fail closed"},
		{"nil source => hold", nil, policy.Hold, "fail closed"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			g := &Gate{Engine: &policy.Engine{Prov: tc.src}, Trace: trace.New(&buf)}
			res, e := g.Check(act(evil))
			if res.Decision != tc.want || !strings.Contains(res.Reason, tc.reason) {
				t.Fatalf("got %s (%s)", res.Decision, res.Reason)
			}
			var logged trace.Entry
			if err := json.Unmarshal(buf.Bytes(), &logged); err != nil {
				t.Fatal(err)
			}
			if logged.Decision != string(tc.want) || logged.ID != e.ID || logged.ID == "" || logged.Agent != "ag" || logged.Action != "send" {
				t.Fatalf("trace mismatch: %+v", logged)
			}
		})
	}
}

type badWriter struct{}

func (badWriter) Write([]byte) (int, error) { return 0, errors.New("disk full") }

func TestTraceFailureDoesNotChangeDecision(t *testing.T) {
	tr := prov.NewTracker()
	tr.Observe(prov.Untrusted("t"), evil)
	g := &Gate{Engine: &policy.Engine{Prov: tr}, Trace: trace.New(badWriter{})}
	if res, _ := g.Check(act(evil)); res.Decision != policy.Deny {
		t.Fatalf("got %s", res.Decision)
	}
	if res, _ := (&Gate{Engine: &policy.Engine{Prov: tr}}).Check(act(evil)); res.Decision != policy.Deny {
		t.Fatalf("nil trace: got %s", res.Decision)
	}
}
