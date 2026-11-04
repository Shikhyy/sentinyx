// Package evm decodes just enough of Ethereum transactions and ERC-20/721
// calldata for Guard to name the recipient, spender and amount.
package evm

import (
	"errors"
)

var errRLP = errors.New("malformed RLP")

// rlpItem reads one RLP item from b.
func rlpItem(b []byte) (isList bool, payload, rest []byte, err error) {
	if len(b) == 0 {
		return false, nil, nil, errRLP
	}
	p := b[0]
	var hdr, n int
	switch {
	case p < 0x80:
		return false, b[:1], b[1:], nil
	case p <= 0xb7:
		hdr, n = 1, int(p-0x80)
	case p <= 0xbf:
		hdr = 1 + int(p-0xb7)
		n, err = rlpLen(b, hdr-1)
	case p <= 0xf7:
		isList, hdr, n = true, 1, int(p-0xc0)
	default:
		isList = true
		hdr = 1 + int(p-0xf7)
		n, err = rlpLen(b, hdr-1)
	}
	if err != nil || n < 0 || hdr+n > len(b) || hdr+n < hdr {
		return false, nil, nil, errRLP
	}
	return isList, b[hdr : hdr+n], b[hdr+n:], nil
}

func rlpLen(b []byte, ll int) (int, error) {
	if ll < 1 || ll > 4 || 1+ll > len(b) {
		return 0, errRLP
	}
	n := 0
	for _, c := range b[1 : 1+ll] {
		n = n<<8 | int(c)
	}
	return n, nil
}

// rlpList decodes b as a single list and returns its raw item payloads.
func rlpList(b []byte) ([][]byte, error) {
	isList, payload, rest, err := rlpItem(b)
	if err != nil || !isList || len(rest) != 0 {
		return nil, errRLP
	}
	var items [][]byte
	for len(payload) > 0 {
		var it []byte
		var isL bool
		isL, it, payload, err = rlpItem(payload)
		if err != nil {
			return nil, err
		}
		if isL {
			it = nil // nested lists (access lists) are not needed
		}
		items = append(items, it)
	}
	return items, nil
}
