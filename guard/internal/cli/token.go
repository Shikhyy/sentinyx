package cli

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultAPI = "https://sentinyx.vercel.app"

// tokenAnswer is the part of the public /api/check answer that decides the exit code.
// The API never repeats scanned text, so the whole answer is safe to print.
type tokenAnswer struct {
	Action   string `json:"action"`
	Verdict  string `json:"verdict"`
	Complete bool   `json:"complete"`
	Report   string `json:"report"`
}

// checkToken asks the Sentinyx API whether a token's text is safe for an agent to read.
// Exit codes match the other check commands: 0 allow, 2 deny, 3 hold, and 3 for any error (it fails closed).
func checkToken(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("check token", flag.ContinueOnError)
	fs.SetOutput(stderr)
	api := fs.String("api", envOr("SENTINYX_API", defaultAPI), "Sentinyx base URL")
	chain := fs.String("chain", "", "base or base-sepolia (default: Base, then Base Sepolia)")
	var pos []string
	for len(args) > 0 {
		if err := fs.Parse(args); err != nil {
			return 64
		}
		if fs.NArg() == 0 {
			break
		}
		pos = append(pos, fs.Arg(0))
		args = fs.Args()[1:]
	}
	if len(pos) != 1 {
		fmt.Fprint(stderr, usage)
		return 64
	}

	q := url.Values{"target": {pos[0]}}
	if *chain != "" {
		q.Set("chain", *chain)
	}
	endpoint := strings.TrimRight(*api, "/") + "/api/check?" + q.Encode()

	client := &http.Client{Timeout: 40 * time.Second}
	resp, err := client.Get(endpoint)
	if err != nil {
		fmt.Fprintln(stderr, "sentinyx: could not reach the API, holding:", err)
		return 3
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		fmt.Fprintln(stderr, "sentinyx: could not read the answer, holding:", err)
		return 3
	}
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		if e.Error == "" {
			e.Error = resp.Status
		}
		fmt.Fprintf(stderr, "sentinyx: the API said no, holding: %s\n", e.Error)
		if resp.StatusCode == http.StatusBadRequest {
			return 64
		}
		return 3
	}

	var a tokenAnswer
	if err := json.Unmarshal(body, &a); err != nil {
		fmt.Fprintln(stderr, "sentinyx: the answer was not understood, holding")
		return 3
	}
	var pretty json.RawMessage = body
	if out, err := json.MarshalIndent(pretty, "", "  "); err == nil {
		fmt.Fprintln(stdout, string(out))
	}
	switch a.Action {
	case "allow":
		if !a.Complete {
			fmt.Fprintln(stderr, "sentinyx: allowed, but some fields could not be read, so this is not a full all-clear")
		}
		return 0
	case "deny":
		return 2
	}
	return 3
}
