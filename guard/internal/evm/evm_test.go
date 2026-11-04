package evm

import (
	"bytes"
	"encoding/hex"
	"math/big"
	"testing"
)

func rlpBytes(b []byte) []byte {
	switch {
	case len(b) == 1 && b[0] < 0x80:
		return b
	case len(b) <= 55:
		return append([]byte{0x80 + byte(len(b))}, b...)
	}
	l := big.NewInt(int64(len(b))).Bytes()
	return append(append([]byte{0xb7 + byte(len(l))}, l...), b...)
}

func rlpListOf(items ...[]byte) []byte {
	var p []byte
	for _, i := range items {
		p = append(p, i...)
	}
	if len(p) <= 55 {
		return append([]byte{0xc0 + byte(len(p))}, p...)
	}
	l := big.NewInt(int64(len(p))).Bytes()
	return append(append([]byte{0xf7 + byte(len(l))}, l...), p...)
}

func n(v int64) []byte { return rlpBytes(big.NewInt(v).Bytes()) }

func eip1559(to []byte, value int64, data []byte) []byte {
	sig := rlpBytes([]byte{1})
	return append([]byte{2}, rlpListOf(n(84532), n(0), n(1), n(2), n(21000), rlpBytes(to), n(value), rlpBytes(data), rlpListOf(), sig, sig, sig)...)
}

func TestDecodeRaw(t *testing.T) {
	to, _ := hex.DecodeString("1111111111111111111111111111111111111111")
	data := append([]byte{0xa9, 0x05, 0x9c, 0xbb}, make([]byte, 64)...)
	sig := rlpBytes([]byte{1})
	legacy := rlpListOf(n(0), n(1), n(21000), rlpBytes(to), n(7), rlpBytes(nil), n(84532*2+35), sig, sig)
	tests := []struct {
		name    string
		raw     []byte
		wantErr bool
		check   func(*Tx) bool
	}{
		{"eip1559", eip1559(to, 5, data), false, func(x *Tx) bool {
			return x.Type == 2 && x.To == "0x1111111111111111111111111111111111111111" && x.Value.Int64() == 5 && bytes.Equal(x.Data, data)
		}},
		{"legacy", legacy, false, func(x *Tx) bool { return x.Type == 0 && x.Value.Int64() == 7 }},
		{"creation", eip1559(nil, 0, []byte{1, 2}), false, func(x *Tx) bool { return x.Creation }},
		{"truncated", eip1559(to, 5, data)[:30], true, nil},
		{"trailing bytes", append(eip1559(to, 5, data), 0), true, nil},
		{"unknown type", []byte{0x09, 0xc0}, true, nil},
		{"empty", nil, true, nil},
		{"huge declared length", []byte{0x02, 0xbb, 0xff, 0xff, 0xff, 0xff}, true, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := DecodeRaw(tc.raw)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v", err)
			}
			if err == nil && !tc.check(tx) {
				t.Fatalf("bad decode: %+v", tx)
			}
		})
	}
}

func TestDecodeCall(t *testing.T) {
	word := func(h string) []byte { b, _ := hex.DecodeString(h); return append(make([]byte, 32-len(b)), b...) }
	data := append([]byte{0xa9, 0x05, 0x9c, 0xbb}, append(word("abcdef0123456789abcdef0123456789abcdef01"), word("64")...)...)
	c := DecodeCall(data)
	if c.Name != "transfer" || c.Recipient != "0xabcdef0123456789abcdef0123456789abcdef01" || c.Amount.Int64() != 100 || c.Malformed {
		t.Fatalf("%+v", c)
	}
	if !DecodeCall(data[:20]).Malformed {
		t.Fatal("short calldata must be malformed")
	}
	if DecodeCall([]byte{1, 2, 3, 4}).Name != "" {
		t.Fatal("unknown selector must have no name")
	}
}
