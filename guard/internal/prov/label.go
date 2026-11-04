// Package prov holds the provenance model: where a value came from, and a
// tracker that remembers which values were seen in untrusted tool output.
package prov

import (
	"fmt"
	"strings"
)

type Kind string

const (
	KindUser      Kind = "user"
	KindTrusted   Kind = "trusted"
	KindUntrusted Kind = "untrusted"
	// KindUnlabeled means the value was never seen in any labelled source.
	// Guard cannot tell whether the user or the model produced it.
	KindUnlabeled Kind = "unlabeled"
)

// Label is `user`, `trusted`, `untrusted:<origin>` or `unlabeled`.
type Label struct {
	Kind   Kind
	Origin string
}

func User() Label                   { return Label{Kind: KindUser} }
func Trusted() Label                { return Label{Kind: KindTrusted} }
func Unlabeled() Label              { return Label{Kind: KindUnlabeled} }
func Untrusted(origin string) Label { return Label{Kind: KindUntrusted, Origin: origin} }

func (l Label) IsUntrusted() bool { return l.Kind == KindUntrusted }

func (l Label) String() string {
	if l.Kind == KindUntrusted {
		return "untrusted:" + l.Origin
	}
	if l.Kind == "" {
		return string(KindUnlabeled)
	}
	return string(l.Kind)
}

// ParseLabel parses the String form.
func ParseLabel(s string) (Label, error) {
	switch {
	case s == "user":
		return User(), nil
	case s == "trusted":
		return Trusted(), nil
	case s == "unlabeled":
		return Unlabeled(), nil
	case strings.HasPrefix(s, "untrusted:") && len(s) > len("untrusted:"):
		return Untrusted(strings.TrimPrefix(s, "untrusted:")), nil
	}
	return Label{}, fmt.Errorf("invalid provenance label %q", s)
}
