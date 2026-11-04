// Package pkgcheck looks a package up on the npm registry. Anything it cannot
// establish (network error, odd response) is an error, which callers must
// treat as "hold".
package pkgcheck

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/Shikhyy/sentinyx/guard/internal/policy"
)

var nameRe = regexp.MustCompile(`^(?:@[a-z0-9~-][a-z0-9._~-]*/)?[a-z0-9~-][a-z0-9._~-]*$`)

type Checker struct {
	Registry string // default https://registry.npmjs.org
	Client   *http.Client
	MinAge   time.Duration // default 7 days
	Now      func() time.Time
}

func (c *Checker) defaults() (string, *http.Client, time.Duration, time.Time) {
	reg := c.Registry
	if reg == "" {
		reg = "https://registry.npmjs.org"
	}
	cl := c.Client
	if cl == nil {
		cl = &http.Client{Timeout: 10 * time.Second}
	}
	age := c.MinAge
	if age == 0 {
		age = 7 * 24 * time.Hour
	}
	now := time.Now()
	if c.Now != nil {
		now = c.Now()
	}
	return strings.TrimRight(reg, "/"), cl, age, now
}

// Check returns deny (invalid name / does not exist), hold (younger than
// MinAge) or allow. A non-nil error means the registry could not be asked.
func (c *Checker) Check(name string) (policy.Decision, string, error) {
	reg, cl, minAge, now := c.defaults()
	name = strings.ToLower(strings.TrimSpace(name))
	if len(name) > 214 || !nameRe.MatchString(name) {
		return policy.Deny, fmt.Sprintf("%q is not a valid npm package name", name), nil
	}
	resp, err := cl.Get(reg + "/" + strings.Replace(url.PathEscape(name), "@", "%40", 1))
	if err != nil {
		return policy.Hold, "", fmt.Errorf("npm registry unreachable: %w", err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return policy.Deny, fmt.Sprintf("package %q does not exist on npm (possible hallucinated name)", name), nil
	case resp.StatusCode != http.StatusOK:
		return policy.Hold, "", fmt.Errorf("npm registry returned HTTP %d", resp.StatusCode)
	}
	var doc struct {
		Time map[string]string `json:"time"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 50<<20)).Decode(&doc); err != nil {
		return policy.Hold, "", fmt.Errorf("unreadable registry response: %w", err)
	}
	created, err := time.Parse(time.RFC3339, doc.Time["created"])
	if err != nil {
		return policy.Hold, "", fmt.Errorf("registry response has no creation time")
	}
	if age := now.Sub(created); age < minAge {
		return policy.Hold, fmt.Sprintf("package %q was first published %s ago (< %s)", name, age.Round(time.Hour), minAge), nil
	}
	return policy.Allow, "", nil
}
