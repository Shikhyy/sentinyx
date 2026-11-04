// Package mcp implements the stdio proxy between an MCP client (the agent)
// and a real MCP server: tool results are labelled, tools/call is checked.
package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/sentinyx/guard/internal/gate"
	"github.com/sentinyx/guard/internal/policy"
	"github.com/sentinyx/guard/internal/prov"
)

type Proxy struct {
	Gate    *gate.Gate
	Tracker *prov.Tracker
	Agent   string
	// TrustedTools lists tools whose results are labelled `trusted` instead
	// of `untrusted:tool:<name>`.
	TrustedTools map[string]bool
	Stderr       io.Writer

	mu       sync.Mutex
	pending  map[string]string // request id -> origin, for labelling the result
	degraded bool              // provenance could not be recorded: hold side effects
}

type msg struct {
	JSONRPC string          `json:"jsonrpc,omitempty"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

type lockedWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) writeLine(b []byte) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	_, err := l.w.Write(append(bytes.TrimRight(b, "\r\n"), '\n'))
	return err
}

// Run proxies until the server's output ends. When the client's input ends
// it closes serverIn so the server can exit.
func (p *Proxy) Run(client io.Reader, clientOut io.Writer, serverIn io.WriteCloser, serverOut io.Reader) error {
	if p.Stderr == nil {
		p.Stderr = os.Stderr
	}
	p.pending = map[string]string{}
	cw := &lockedWriter{w: clientOut}
	sw := &lockedWriter{w: serverIn}

	go func() {
		defer serverIn.Close()
		br := bufio.NewReaderSize(client, 1<<20)
		for {
			line, err := br.ReadBytes('\n')
			if len(bytes.TrimSpace(line)) > 0 {
				p.fromClient(line, cw, sw)
			}
			if err != nil {
				return
			}
		}
	}()

	br := bufio.NewReaderSize(serverOut, 1<<20)
	for {
		line, err := br.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			p.fromServer(line, cw)
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

func isBatch(b []byte) bool { return len(b) > 0 && bytes.TrimSpace(b)[0] == '[' }

func (p *Proxy) fromClient(line []byte, cw, sw *lockedWriter) {
	var items []json.RawMessage
	batch := isBatch(line)
	if batch {
		if err := json.Unmarshal(line, &items); err != nil {
			p.reply(cw, nil, -32700, "Sentinyx: unparseable batch, not forwarded")
			return
		}
	} else {
		items = []json.RawMessage{bytes.TrimSpace(line)}
	}
	var forward []json.RawMessage
	var replies []json.RawMessage
	for _, it := range items {
		var m msg
		if err := json.Unmarshal(it, &m); err != nil {
			// Fail closed: if we cannot parse it we cannot tell whether it is a tools/call.
			replies = append(replies, errorReply(nil, -32700, "Sentinyx: unparseable message, not forwarded"))
			continue
		}
		if m.Method == "tools/call" {
			if blocked := p.checkCall(m); blocked != nil {
				if len(m.ID) > 0 {
					replies = append(replies, blocked)
				}
				continue
			}
		} else if m.Method == "resources/read" && len(m.ID) > 0 {
			var rp struct {
				URI string `json:"uri"`
			}
			_ = json.Unmarshal(m.Params, &rp)
			p.remember(m.ID, "resource:"+rp.URI)
		}
		forward = append(forward, it)
	}
	for _, r := range replies {
		if batch {
			continue
		}
		_ = cw.writeLine(r)
	}
	if batch && len(replies) > 0 {
		out, _ := json.Marshal(replies)
		_ = cw.writeLine(out)
	}
	if len(forward) == 0 {
		return
	}
	if batch {
		out, _ := json.Marshal(forward)
		_ = sw.writeLine(out)
		return
	}
	_ = sw.writeLine(forward[0])
}

// checkCall returns nil to forward, or the reply that blocks the call.
func (p *Proxy) checkCall(m msg) json.RawMessage {
	var cp struct {
		Name string         `json:"name"`
		Args map[string]any `json:"arguments"`
	}
	dec := json.NewDecoder(bytes.NewReader(m.Params))
	dec.UseNumber()
	var act policy.Action
	if err := dec.Decode(&cp); err != nil || cp.Name == "" {
		act = policy.Action{Agent: p.Agent, Name: "tools/call", Kind: "call",
			HoldReasons: []string{"tools/call params could not be parsed"}}
	} else {
		act = Classify(p.Agent, cp.Name, cp.Args)
	}
	p.mu.Lock()
	if p.degraded {
		act.HoldReasons = append(act.HoldReasons, "provenance recording failed earlier; cannot trust taint state")
	}
	p.mu.Unlock()
	res, entry := p.Gate.Check(act)
	if res.Decision == policy.Allow {
		p.remember(m.ID, "tool:"+cp.Name)
		return nil
	}
	verb := "denied"
	if res.Decision == policy.Hold {
		verb = "held for human review"
	}
	text := fmt.Sprintf("Sentinyx blocked this tool call (%s): %s. Trace %s. Do not retry with the same values.", verb, res.Reason, entry.ID)
	r, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": json.RawMessage(m.ID),
		"result": map[string]any{
			"isError": true,
			"content": []map[string]string{{"type": "text", "text": text}},
		},
	})
	return r
}

func (p *Proxy) remember(id json.RawMessage, origin string) {
	if len(id) == 0 {
		return
	}
	p.mu.Lock()
	p.pending[string(bytes.TrimSpace(id))] = origin
	p.mu.Unlock()
}

func errorReply(id json.RawMessage, code int, text string) json.RawMessage {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	r, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id,
		"error": map[string]any{"code": code, "message": text}})
	return r
}

func (p *Proxy) reply(cw *lockedWriter, id json.RawMessage, code int, text string) {
	_ = cw.writeLine(errorReply(id, code, text))
}

// fromServer labels results of pending requests, then forwards unchanged.
func (p *Proxy) fromServer(line []byte, cw *lockedWriter) {
	t := bytes.TrimSpace(line)
	var items []json.RawMessage
	if isBatch(t) {
		_ = json.Unmarshal(t, &items)
	} else {
		items = []json.RawMessage{t}
	}
	for _, it := range items {
		var m msg
		if json.Unmarshal(it, &m) != nil || len(m.ID) == 0 || m.Method != "" {
			continue
		}
		p.mu.Lock()
		origin, ok := p.pending[string(bytes.TrimSpace(m.ID))]
		delete(p.pending, string(bytes.TrimSpace(m.ID)))
		p.mu.Unlock()
		if !ok {
			continue
		}
		var parts []string
		for _, raw := range []json.RawMessage{m.Result, m.Error} {
			if len(raw) == 0 {
				continue
			}
			var v any
			if json.Unmarshal(raw, &v) == nil {
				parts = append(parts, strs(v)...)
			}
		}
		label := prov.Untrusted(origin)
		if p.TrustedTools[strings.TrimPrefix(origin, "tool:")] {
			label = prov.Trusted()
		}
		if _, err := p.Tracker.Observe(label, strings.Join(parts, "\n")); err != nil {
			fmt.Fprintln(p.Stderr, "sentinyx: could not record provenance:", err)
			p.mu.Lock()
			p.degraded = true
			p.mu.Unlock()
		}
	}
	_ = cw.writeLine(t)
}
