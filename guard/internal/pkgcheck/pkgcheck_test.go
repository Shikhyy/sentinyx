package pkgcheck

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Shikhyy/sentinyx/guard/internal/policy"
	"github.com/Shikhyy/sentinyx/guard/internal/prov"
)

func TestCheck(t *testing.T) {
	now := time.Date(2026, 11, 4, 0, 0, 0, 0, time.UTC)
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.EscapedPath())
		switch r.URL.EscapedPath() {
		case "/left-pad":
			w.Write([]byte(`{"time":{"created":"2014-03-14T00:00:00.000Z"}}`))
		case "/fresh-pkg":
			w.Write([]byte(`{"time":{"created":"2026-11-03T00:00:00.000Z"}}`))
		case "/%40scope%2Fname":
			w.Write([]byte(`{"time":{"created":"2020-01-01T00:00:00.000Z"}}`))
		case "/no-time":
			w.Write([]byte(`{}`))
		case "/broken":
			w.Write([]byte(`<html>`))
		case "/err500":
			w.WriteHeader(500)
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	dead := httptest.NewServer(nil)
	dead.Close()

	tests := []struct {
		name    string
		reg     string
		pkg     string
		want    policy.Decision
		wantErr bool
		reason  string
	}{
		{"old package allowed", srv.URL, "left-pad", policy.Allow, false, ""},
		{"scoped package allowed", srv.URL, "@scope/name", policy.Allow, false, ""},
		{"too new => hold", srv.URL, "fresh-pkg", policy.Hold, false, "first published"},
		{"missing => deny", srv.URL, "left-padz", policy.Deny, false, "does not exist"},
		{"invalid name => deny, no request", srv.URL, "../etc/passwd", policy.Deny, false, "not a valid"},
		{"network error => error (caller holds)", dead.URL, "left-pad", policy.Hold, true, ""},
		{"HTTP 500 => error", srv.URL, "err500", policy.Hold, true, ""},
		{"unparseable => error", srv.URL, "broken", policy.Hold, true, ""},
		{"no creation time => error", srv.URL, "no-time", policy.Hold, true, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := &Checker{Registry: tc.reg, Now: func() time.Time { return now }}
			d, why, err := c.Check(tc.pkg)
			if (err != nil) != tc.wantErr || d != tc.want || !strings.Contains(why, tc.reason) {
				t.Fatalf("got %s %q %v", d, why, err)
			}
		})
	}
	for _, p := range paths {
		if strings.Contains(p, "..") {
			t.Fatalf("invalid name reached the registry: %s", p)
		}
	}
}

// Integration with the engine: a registry error must end as hold.
func TestEngineHoldsOnRegistryError(t *testing.T) {
	dead := httptest.NewServer(nil)
	dead.Close()
	c := &Checker{Registry: dead.URL}
	e := &policy.Engine{Prov: nopSource{}, PackageCheck: c.Check}
	res := e.Decide(policy.Action{Args: []policy.Arg{{Name: "package", Role: policy.RolePackage, Kind: "package", Value: "left-pad", Eco: "npm"}}})
	if res.Decision != policy.Hold || !strings.Contains(res.Reason, "fail closed") {
		t.Fatalf("%+v", res)
	}
}

type nopSource struct{}

func (nopSource) LabelOf(k prov.ValueKind, v string) (prov.Label, error) {
	return prov.Label{Kind: "unlabeled"}, nil
}
