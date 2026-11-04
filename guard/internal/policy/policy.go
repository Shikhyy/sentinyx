// Package policy decides allow | deny | hold for an action, based on the
// provenance of its critical arguments. It fails closed.
package policy

import (
	"fmt"
	"strings"

	"github.com/Shikhyy/sentinyx/guard/internal/prov"
)

type Decision string

const (
	Allow Decision = "allow"
	Deny  Decision = "deny"
	Hold  Decision = "hold"
)

func (d Decision) rank() int {
	switch d {
	case Allow:
		return 0
	case Hold:
		return 1
	}
	return 2 // deny, and anything unknown, is treated as strictest
}

type Role string

const (
	RoleRecipient Role = "recipient"
	RoleSpender   Role = "spender"
	RolePackage   Role = "package"
	RoleCommand   Role = "command"
	RoleAmount    Role = "amount"
	RoleTarget    Role = "target"
	RoleURL       Role = "url"
	RoleAddress   Role = "address"
)

// denyRoles: a tainted value in these roles is denied. Other roles are held.
var denyRoles = map[Role]bool{RoleRecipient: true, RoleSpender: true, RolePackage: true, RoleCommand: true}

// Arg is one critical argument of an action.
type Arg struct {
	Name  string
	Role  Role
	Kind  prov.ValueKind
	Value string
	Eco   string // package ecosystem ("npm", "pip", ...), when known
}

// Action is a side effect an agent wants to perform.
type Action struct {
	Agent string
	Name  string // tool name or JSON-RPC method
	Kind  string // transfer, approve, install, shell, tx, call
	Args  []Arg
	// HoldReasons are reasons the builder already knows warrant a hold
	// (unlimited approval, contract creation, ...).
	HoldReasons []string
	// Detail is the (sanitised) argument map written to the trace.
	Detail map[string]any
}

type Result struct {
	Decision   Decision
	Reason     string
	Provenance map[string]string
}

// Engine evaluates actions.
type Engine struct {
	Prov prov.Source
	// PackageCheck, if set, is called for npm package args that are not
	// tainted (registry existence / age).
	PackageCheck func(name string) (Decision, string, error)
}

// Decide never returns an error: any engine error or panic becomes a hold.
func (e *Engine) Decide(a Action) (res Result) {
	defer func() {
		if r := recover(); r != nil {
			res = Result{Decision: Hold, Reason: fmt.Sprintf("policy engine panic: %v (fail closed: held)", r)}
		}
	}()
	r, err := e.decide(a)
	if err != nil {
		return Result{Decision: Hold, Reason: "policy engine error: " + err.Error() + " (fail closed: held)", Provenance: r.Provenance}
	}
	return r
}

func (e *Engine) decide(a Action) (Result, error) {
	res := Result{Decision: Allow, Provenance: map[string]string{}}
	if e == nil || e.Prov == nil {
		return res, fmt.Errorf("no provenance source configured")
	}
	var reasons []string
	worsen := func(d Decision, why string) {
		if d.rank() > res.Decision.rank() {
			res.Decision = d
		}
		if d != Allow {
			reasons = append(reasons, why)
		}
	}
	for _, why := range a.HoldReasons {
		worsen(Hold, why)
	}
	for _, arg := range a.Args {
		l, err := e.Prov.LabelOf(arg.Kind, arg.Value)
		if err != nil {
			return res, fmt.Errorf("provenance lookup for %s: %w", arg.Name, err)
		}
		name := arg.Name
		for i := 2; ; i++ { // keep duplicate names distinct in the trace
			if _, dup := res.Provenance[name]; !dup {
				break
			}
			name = fmt.Sprintf("%s#%d", arg.Name, i)
		}
		res.Provenance[name] = l.String()
		if l.IsUntrusted() {
			d := Hold
			if denyRoles[arg.Role] {
				d = Deny
			}
			worsen(d, fmt.Sprintf("%s %s came from %s", arg.Role, short(arg.Value), l))
			continue
		}
		if e.PackageCheck != nil && arg.Role == RolePackage && arg.Eco == "npm" && l.Kind != prov.KindUser {
			d, why, err := e.PackageCheck(arg.Value)
			if err != nil {
				return res, fmt.Errorf("package check %s: %w", arg.Value, err)
			}
			worsen(d, why)
		}
	}
	if res.Decision == Allow {
		res.Reason = "no critical argument came from untrusted text"
	} else {
		res.Reason = strings.Join(reasons, "; ")
	}
	return res, nil
}

func short(s string) string {
	if len(s) > 60 {
		return s[:57] + "..."
	}
	return s
}
