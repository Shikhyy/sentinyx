package evm

import (
	"encoding/hex"
	"math/big"
)

// Call is a decoded known call. Unknown selectors have Name "" .
type Call struct {
	Name      string
	Recipient string   // transfer / transferFrom / safeTransferFrom target
	From      string   // transferFrom source
	Spender   string   // approve / increaseAllowance / setApprovalForAll
	Amount    *big.Int // token amount (nil for NFTs / unknown)
	Approves  bool     // setApprovalForAll(_, true)
	Malformed bool
}

func word(b []byte, i int) []byte { return b[4+32*i : 4+32*(i+1)] }

func addrWord(w []byte) (string, bool) {
	for _, c := range w[:12] {
		if c != 0 {
			return "", false
		}
	}
	return "0x" + hex.EncodeToString(w[12:]), true
}

// DecodeCall recognises common ERC-20/721 calls.
func DecodeCall(data []byte) Call {
	if len(data) < 4 {
		return Call{Malformed: len(data) > 0}
	}
	sel := hex.EncodeToString(data[:4])
	need := map[string]int{
		"a9059cbb": 2, "095ea7b3": 2, "39509351": 2, "23b872dd": 3,
		"a22cb465": 2, "42842e0e": 3, "b88d4fde": 3,
	}[sel]
	if need == 0 {
		return Call{}
	}
	if len(data) < 4+32*need {
		return Call{Name: sel, Malformed: true}
	}
	a := func(i int) string {
		s, ok := addrWord(word(data, i))
		if !ok {
			return ""
		}
		return s
	}
	n := func(i int) *big.Int { return new(big.Int).SetBytes(word(data, i)) }
	c := Call{}
	switch sel {
	case "a9059cbb":
		c.Name, c.Recipient, c.Amount = "transfer", a(0), n(1)
	case "095ea7b3":
		c.Name, c.Spender, c.Amount = "approve", a(0), n(1)
	case "39509351":
		c.Name, c.Spender, c.Amount = "increaseAllowance", a(0), n(1)
	case "23b872dd":
		c.Name, c.From, c.Recipient, c.Amount = "transferFrom", a(0), a(1), n(2)
	case "a22cb465":
		c.Name, c.Spender = "setApprovalForAll", a(0)
		c.Approves = n(1).Sign() != 0
	case "42842e0e", "b88d4fde":
		c.Name, c.From, c.Recipient = "safeTransferFrom", a(0), a(1)
	}
	// An address word with non-zero padding is malformed for our purposes.
	if (c.Recipient == "" && need >= 2 && (sel == "a9059cbb" || sel == "23b872dd" || sel == "42842e0e" || sel == "b88d4fde")) ||
		(c.Spender == "" && (sel == "095ea7b3" || sel == "39509351" || sel == "a22cb465")) {
		c.Malformed = true
	}
	return c
}

// AddressWords returns address-shaped 32-byte words in calldata after the
// selector (12 zero bytes + 20 non-zero-leading bytes).
func AddressWords(data []byte) []string {
	var out []string
	if len(data) < 4 {
		return nil
	}
	for i := 4; i+32 <= len(data); i += 32 {
		if s, ok := addrWord(data[i : i+32]); ok && data[i+12] != 0 {
			out = append(out, s)
		}
	}
	return out
}
