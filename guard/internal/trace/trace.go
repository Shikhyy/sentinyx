// Package trace writes one JSON line per decision.
package trace

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"sync"
	"time"
)

type Entry struct {
	ID         string            `json:"id"`
	Agent      string            `json:"agent"`
	Action     string            `json:"action"`
	Args       map[string]any    `json:"args"`
	Provenance map[string]string `json:"provenance"`
	Decision   string            `json:"decision"`
	Reason     string            `json:"reason"`
	CreatedAt  time.Time         `json:"created_at"`
}

type Logger struct {
	mu sync.Mutex
	w  io.Writer
	c  io.Closer
}

func New(w io.Writer) *Logger { return &Logger{w: w} }

func NewFile(path string) (*Logger, error) {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &Logger{w: f, c: f}, nil
}

func (l *Logger) Close() error {
	if l != nil && l.c != nil {
		return l.c.Close()
	}
	return nil
}

func NewID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(b)
}

// Log fills ID and CreatedAt if empty and writes the entry.
func (l *Logger) Log(e *Entry) error {
	if e.ID == "" {
		e.ID = NewID()
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}
	if e.Args == nil {
		e.Args = map[string]any{}
	}
	if e.Provenance == nil {
		e.Provenance = map[string]string{}
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	_, err = l.w.Write(append(b, '\n'))
	return err
}
