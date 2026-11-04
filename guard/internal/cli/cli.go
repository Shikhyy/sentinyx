// Package cli implements the sentinyx command.
package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"time"

	"github.com/sentinyx/guard/internal/evm"
	"github.com/sentinyx/guard/internal/gate"
	"github.com/sentinyx/guard/internal/mcp"
	"github.com/sentinyx/guard/internal/pkgcheck"
	"github.com/sentinyx/guard/internal/policy"
	"github.com/sentinyx/guard/internal/prov"
	"github.com/sentinyx/guard/internal/rpc"
	"github.com/sentinyx/guard/internal/trace"
)

const usage = `sentinyx - provenance guard for AI agents

  sentinyx wrap [flags] -- <mcp server cmd> [args]   stdio MCP proxy
  sentinyx rpc --upstream <url> [flags]              JSON-RPC proxy for Base
  sentinyx check pkg <name> [flags]                  npm registry + taint check
  sentinyx check tx <raw-tx-or-calldata> [flags]     decode and check a transaction

common flags: --agent NAME  --trace FILE  --taint-file FILE  --allow 0xADDR (repeatable)
exit codes for check: 0 allow, 2 deny, 3 hold (also for any internal error), 64 usage
`

type multi []string

func (m *multi) String() string     { return strings.Join(*m, ",") }
func (m *multi) Set(v string) error { *m = append(*m, v); return nil }

type common struct {
	agent, tracePath, taintFile string
	allow                       multi
}

func (c *common) bind(fs *flag.FlagSet) {
	fs.StringVar(&c.agent, "agent", "default", "agent name recorded in traces")
	fs.StringVar(&c.tracePath, "trace", envOr("SENTINYX_TRACE", "sentinyx-trace.jsonl"), "JSON-lines trace file ('-' = stderr)")
	fs.StringVar(&c.taintFile, "taint-file", os.Getenv("SENTINYX_TAINT_FILE"), "shared file of untrusted values (lets wrap, rpc and check see the same taint)")
	fs.Var(&c.allow, "allow", "address the user explicitly approved (labelled `user`; repeatable)")
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func (c *common) build() (*gate.Gate, *prov.Tracker, func(), error) {
	var t *prov.Tracker
	if c.taintFile != "" {
		t = prov.NewSharedTracker(c.taintFile)
	} else {
		t = prov.NewTracker()
	}
	for _, a := range c.allow {
		if len(prov.ExtractAddresses(a)) != 1 {
			return nil, nil, nil, fmt.Errorf("--allow %q is not an address", a)
		}
		_ = t.Register(prov.User(), prov.VAddress, a)
	}
	var lg *trace.Logger
	closeFn := func() {}
	if c.tracePath == "-" {
		lg = trace.New(os.Stderr)
	} else {
		var err error
		if lg, err = trace.NewFile(c.tracePath); err != nil {
			return nil, nil, nil, err
		}
		closeFn = func() { lg.Close() }
	}
	return &gate.Gate{Engine: &policy.Engine{Prov: t}, Trace: lg}, t, closeFn, nil
}

// Main runs the CLI and returns the process exit code.
func Main(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		fmt.Fprint(stderr, usage)
		return 64
	}
	switch args[0] {
	case "wrap":
		return wrap(args[1:], stderr)
	case "rpc":
		return rpcCmd(args[1:], stderr)
	case "check":
		if len(args) < 2 {
			fmt.Fprint(stderr, usage)
			return 64
		}
		return check(args[1], args[2:], stdout, stderr)
	}
	fmt.Fprintf(stderr, "unknown command %q\n%s", args[0], usage)
	return 64
}

func wrap(args []string, stderr io.Writer) int {
	fs := flag.NewFlagSet("wrap", flag.ContinueOnError)
	fs.SetOutput(stderr)
	var c common
	c.bind(fs)
	var trusted multi
	fs.Var(&trusted, "trusted-tool", "tool whose results are labelled `trusted` (repeatable)")
	if err := fs.Parse(args); err != nil {
		return 64
	}
	if fs.NArg() == 0 {
		fmt.Fprintln(stderr, "wrap: need a server command after --")
		return 64
	}
	g, t, done, err := c.build()
	if err != nil {
		fmt.Fprintln(stderr, "sentinyx:", err)
		return 1
	}
	defer done()
	cmd := exec.Command(fs.Arg(0), fs.Args()[1:]...)
	cmd.Stderr = os.Stderr
	in, err := cmd.StdinPipe()
	if err != nil {
		fmt.Fprintln(stderr, "sentinyx:", err)
		return 1
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		fmt.Fprintln(stderr, "sentinyx:", err)
		return 1
	}
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(stderr, "sentinyx: cannot start server:", err)
		return 1
	}
	tt := map[string]bool{}
	for _, n := range trusted {
		tt[n] = true
	}
	p := &mcp.Proxy{Gate: g, Tracker: t, Agent: c.agent, TrustedTools: tt, Stderr: stderr}
	_ = p.Run(os.Stdin, os.Stdout, in, out)
	if err := cmd.Wait(); err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return ee.ExitCode()
		}
		return 1
	}
	return 0
}

func rpcCmd(args []string, stderr io.Writer) int {
	fs := flag.NewFlagSet("rpc", flag.ContinueOnError)
	fs.SetOutput(stderr)
	var c common
	c.bind(fs)
	upstream := fs.String("upstream", os.Getenv("SENTINYX_UPSTREAM"), "upstream JSON-RPC URL (e.g. a Base Sepolia endpoint)")
	listen := fs.String("listen", "127.0.0.1:8545", "listen address")
	if err := fs.Parse(args); err != nil {
		return 64
	}
	g, t, done, err := c.build()
	if err != nil {
		fmt.Fprintln(stderr, "sentinyx:", err)
		return 1
	}
	defer done()
	p, err := rpc.NewProxy(*upstream, g, t, c.agent)
	if err != nil {
		fmt.Fprintln(stderr, "sentinyx:", err)
		return 64
	}
	srv := &http.Server{Addr: *listen, Handler: p.Handler(), ReadHeaderTimeout: 10 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() { <-ctx.Done(); srv.Close() }()
	fmt.Fprintf(stderr, "sentinyx rpc: listening on %s\n", *listen)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintln(stderr, "sentinyx:", err)
		return 1
	}
	return 0
}

func exitFor(d policy.Decision) int {
	switch d {
	case policy.Allow:
		return 0
	case policy.Deny:
		return 2
	}
	return 3
}

func check(sub string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("check "+sub, flag.ContinueOnError)
	fs.SetOutput(stderr)
	var c common
	c.bind(fs)
	registry := fs.String("registry", "https://registry.npmjs.org", "npm registry (check pkg)")
	to := fs.String("to", "", "treat the argument as calldata sent to this address (check tx)")
	value := fs.String("value", "0", "wei value in decimal (check tx with --to)")
	// allow flags after the positional argument too
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
	if len(pos) != 1 || (sub != "pkg" && sub != "tx") {
		fmt.Fprint(stderr, usage)
		return 64
	}
	g, _, done, err := c.build()
	if err != nil {
		fmt.Fprintln(stderr, "sentinyx:", err)
		return exitFor(policy.Hold)
	}
	defer done()

	var act policy.Action
	if sub == "pkg" {
		pc := &pkgcheck.Checker{Registry: *registry}
		g.Engine.PackageCheck = pc.Check
		name := prov.NormalizePackage(pos[0])
		act = policy.Action{Agent: c.agent, Name: "check pkg", Kind: "install",
			Detail: map[string]any{"package": name},
			Args:   []policy.Arg{{Name: "package", Role: policy.RolePackage, Kind: prov.VPackage, Value: name, Eco: "npm"}}}
	} else {
		tx, err := parseTx(pos[0], *to, *value)
		if err != nil {
			act = policy.Action{Agent: c.agent, Name: "check tx", Kind: "tx",
				HoldReasons: []string{"transaction could not be decoded: " + err.Error()}}
		} else {
			act = policy.ActionFromTx(c.agent, "check tx", tx)
		}
	}
	res, entry := g.Check(act)
	enc := json.NewEncoder(stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(entry)
	return exitFor(res.Decision)
}

func parseTx(arg, to, value string) (*evm.Tx, error) {
	b, err := evm.DecodeHex(arg)
	if err != nil {
		return nil, err
	}
	if to != "" {
		v, ok := new(big.Int).SetString(value, 10)
		if !ok {
			return nil, fmt.Errorf("invalid --value")
		}
		tx, err := evm.FromJSON(to, "", "")
		if err != nil {
			return nil, err
		}
		tx.Value, tx.Data = v, b
		return tx, nil
	}
	if tx, err := evm.DecodeRaw(b); err == nil {
		return tx, nil
	}
	return nil, fmt.Errorf("not a raw signed transaction; pass --to for bare calldata")
}
