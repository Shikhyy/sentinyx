// Package gate ties the policy engine to the trace log: every check is logged.
package gate

import (
	"fmt"
	"os"

	"github.com/Shikhyy/sentinyx/guard/internal/policy"
	"github.com/Shikhyy/sentinyx/guard/internal/trace"
)

type Gate struct {
	Engine *policy.Engine
	Trace  *trace.Logger
}

// Check decides and logs. A failure to write the trace is reported on stderr
// but does not change the decision (the decision is already fail-closed).
func (g *Gate) Check(a policy.Action) (policy.Result, trace.Entry) {
	res := g.Engine.Decide(a)
	e := trace.Entry{
		Agent: a.Agent, Action: a.Name, Args: a.Detail,
		Provenance: res.Provenance, Decision: string(res.Decision), Reason: res.Reason,
	}
	if g.Trace != nil {
		if err := g.Trace.Log(&e); err != nil {
			fmt.Fprintln(os.Stderr, "sentinyx: trace write failed:", err)
		}
	}
	return res, e
}
