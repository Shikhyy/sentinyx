package evm

import (
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

type Tx struct {
	Type     byte   // 0 legacy, 1, 2, 3, 4
	To       string // lower-case 0x address; empty for contract creation
	Value    *big.Int
	Data     []byte
	Creation bool
	SetCode  bool // EIP-7702 authorization list present
}

// DecodeHex parses 0x-prefixed (or bare) hex.
func DecodeHex(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(strings.TrimPrefix(s, "0x"), "0X")
	if len(s)%2 == 1 {
		return nil, errors.New("odd-length hex")
	}
	return hex.DecodeString(s)
}

// DecodeRaw decodes a signed raw transaction (legacy, EIP-2930/1559/4844/7702).
func DecodeRaw(raw []byte) (*Tx, error) {
	if len(raw) == 0 {
		return nil, errors.New("empty transaction")
	}
	var toIdx, valIdx, dataIdx, minFields int
	tx := &Tx{}
	body := raw
	switch {
	case raw[0] >= 0xc0:
		toIdx, valIdx, dataIdx, minFields = 3, 4, 5, 9
	case raw[0] == 0x01:
		tx.Type, body = 1, raw[1:]
		toIdx, valIdx, dataIdx, minFields = 4, 5, 6, 11
	case raw[0] == 0x02 || raw[0] == 0x03 || raw[0] == 0x04:
		tx.Type, body = raw[0], raw[1:]
		toIdx, valIdx, dataIdx, minFields = 5, 6, 7, 12
	default:
		return nil, fmt.Errorf("unsupported transaction type 0x%02x", raw[0])
	}
	f, err := rlpList(body)
	if err != nil {
		return nil, err
	}
	if len(f) < minFields {
		return nil, fmt.Errorf("transaction has %d fields, want at least %d", len(f), minFields)
	}
	switch len(f[toIdx]) {
	case 0:
		tx.Creation = true
	case 20:
		tx.To = "0x" + hex.EncodeToString(f[toIdx])
	default:
		return nil, errors.New("invalid 'to' field")
	}
	if len(f[valIdx]) > 32 {
		return nil, errors.New("value too large")
	}
	tx.Value = new(big.Int).SetBytes(f[valIdx])
	tx.Data = f[dataIdx]
	tx.SetCode = tx.Type == 4
	return tx, nil
}

// FromJSON builds a Tx from an eth_sendTransaction-style object.
func FromJSON(to, value, data string) (*Tx, error) {
	tx := &Tx{Value: new(big.Int)}
	if to == "" {
		tx.Creation = true
	} else {
		b, err := DecodeHex(to)
		if err != nil || len(b) != 20 {
			return nil, errors.New("invalid 'to'")
		}
		tx.To = "0x" + hex.EncodeToString(b)
	}
	if value != "" {
		v, ok := new(big.Int).SetString(strings.TrimPrefix(value, "0x"), 16)
		if !ok {
			return nil, errors.New("invalid value")
		}
		tx.Value = v
	}
	if data != "" {
		d, err := DecodeHex(data)
		if err != nil {
			return nil, errors.New("invalid data")
		}
		tx.Data = d
	}
	return tx, nil
}
