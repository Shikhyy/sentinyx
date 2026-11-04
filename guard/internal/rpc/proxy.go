// Package rpc is an HTTP JSON-RPC proxy for Base nodes that checks
// eth_sendRawTransaction / eth_sendTransaction before forwarding.
package rpc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/sentinyx/guard/internal/evm"
	"github.com/sentinyx/guard/internal/gate"
	"github.com/sentinyx/guard/internal/policy"
	"github.com/sentinyx/guard/internal/prov"
)

const maxBody = 1 << 20

type Proxy struct {
	Upstream string
	Gate     *gate.Gate
	Tracker  *prov.Tracker
	Agent    string
	Client   *http.Client
}

type req struct {
	JSONRPC string            `json:"jsonrpc"`
	ID      json.RawMessage   `json:"id"`
	Method  string            `json:"method"`
	Params  []json.RawMessage `json:"params"`
}

func NewProxy(upstream string, g *gate.Gate, t *prov.Tracker, agent string) (*Proxy, error) {
	u, err := url.Parse(upstream)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("--upstream must be an http(s) URL")
	}
	return &Proxy{Upstream: upstream, Gate: g, Tracker: t, Agent: agent,
		Client: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (p *Proxy) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/_sentinyx/observe", p.observe)
	mux.HandleFunc("/", p.serve)
	return mux
}

// observe lets the agent harness report untrusted text it read. It can only
// add untrusted taint (never user/trusted labels) and only from loopback.
func (p *Proxy) observe(w http.ResponseWriter, r *http.Request) {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(host); r.Method != http.MethodPost || ip == nil || !ip.IsLoopback() {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	var in struct{ Origin, Text string }
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&in); err != nil || in.Origin == "" {
		http.Error(w, `want {"origin":"...","text":"..."}`, http.StatusBadRequest)
		return
	}
	n, err := p.Tracker.Observe(prov.Untrusted(in.Origin), in.Text)
	if err != nil {
		http.Error(w, "could not record: "+err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]int{"recorded": n})
}

func (p *Proxy) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST JSON-RPC only", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil || len(body) > maxBody {
		http.Error(w, "bad or oversized body", http.StatusBadRequest)
		return
	}
	trim := bytes.TrimSpace(body)
	batch := len(trim) > 0 && trim[0] == '['
	var items []json.RawMessage
	if batch {
		if json.Unmarshal(trim, &items) != nil {
			writeJSON(w, errResp(nil, -32700, "Sentinyx: unparseable batch, not forwarded"))
			return
		}
	} else {
		items = []json.RawMessage{trim}
	}
	var forward, blocked []json.RawMessage
	for _, it := range items {
		if b := p.check(it); b != nil {
			blocked = append(blocked, b)
		} else {
			forward = append(forward, it)
		}
	}
	var out []json.RawMessage
	out = append(out, blocked...)
	if len(forward) > 0 {
		var fb []byte
		if batch {
			fb, _ = json.Marshal(forward)
		} else {
			fb = forward[0]
		}
		resp, err := p.Client.Post(p.Upstream, "application/json", bytes.NewReader(fb))
		if err != nil {
			http.Error(w, "upstream error", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		rb, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		if err != nil {
			http.Error(w, "upstream error", http.StatusBadGateway)
			return
		}
		if len(blocked) == 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(resp.StatusCode)
			_, _ = w.Write(rb)
			return
		}
		var ups []json.RawMessage
		if batch && json.Unmarshal(rb, &ups) == nil {
			out = append(out, ups...)
		} else {
			out = append(out, rb)
		}
	}
	if batch {
		b, _ := json.Marshal(out)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(b)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(out[0])
}

func writeJSON(w http.ResponseWriter, b json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(b)
}

func errResp(id json.RawMessage, code int, text string, data ...any) json.RawMessage {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	e := map[string]any{"code": code, "message": text}
	if len(data) > 0 {
		e["data"] = data[0]
	}
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "error": e})
	return b
}

// check returns nil to forward, or a JSON-RPC error response to return.
func (p *Proxy) check(raw json.RawMessage) json.RawMessage {
	var r req
	if json.Unmarshal(raw, &r) != nil {
		return errResp(nil, -32700, "Sentinyx: unparseable request, not forwarded")
	}
	if r.Method != "eth_sendRawTransaction" && r.Method != "eth_sendTransaction" {
		return nil
	}
	act, err := p.action(r)
	if err != nil {
		act = policy.Action{Agent: p.Agent, Name: r.Method, Kind: "tx",
			HoldReasons: []string{"transaction could not be decoded: " + err.Error()}}
	}
	res, entry := p.Gate.Check(act)
	if res.Decision == policy.Allow {
		return nil
	}
	code := -32001
	if res.Decision == policy.Hold {
		code = -32002
	}
	return errResp(r.ID, code, fmt.Sprintf("Sentinyx %s this transaction: %s", map[policy.Decision]string{policy.Deny: "denied", policy.Hold: "held"}[res.Decision], res.Reason),
		map[string]string{"decision": string(res.Decision), "trace": entry.ID})
}

func (p *Proxy) action(r req) (policy.Action, error) {
	if len(r.Params) < 1 {
		return policy.Action{}, fmt.Errorf("missing params")
	}
	var tx *evm.Tx
	if r.Method == "eth_sendRawTransaction" {
		var s string
		if err := json.Unmarshal(r.Params[0], &s); err != nil {
			return policy.Action{}, err
		}
		b, err := evm.DecodeHex(s)
		if err != nil {
			return policy.Action{}, err
		}
		if tx, err = evm.DecodeRaw(b); err != nil {
			return policy.Action{}, err
		}
	} else {
		var o struct{ To, Value, Data, Input string }
		if err := json.Unmarshal(r.Params[0], &o); err != nil {
			return policy.Action{}, err
		}
		if o.Data == "" {
			o.Data = o.Input
		}
		var err error
		if tx, err = evm.FromJSON(o.To, o.Value, o.Data); err != nil {
			return policy.Action{}, err
		}
	}
	return policy.ActionFromTx(p.Agent, r.Method, tx), nil
}
