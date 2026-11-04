package policy

import (
	"math/big"

	"github.com/sentinyx/guard/internal/evm"
	"github.com/sentinyx/guard/internal/prov"
)

var unlimited = new(big.Int).Lsh(big.NewInt(1), 255)

// ActionFromTx turns a decoded transaction into an Action.
func ActionFromTx(agent, method string, tx *evm.Tx) Action {
	a := Action{Agent: agent, Name: method, Kind: "tx", Detail: map[string]any{}}
	addr := func(name string, role Role, v string) {
		if v != "" {
			a.Args = append(a.Args, Arg{Name: name, Role: role, Kind: prov.VAddress, Value: v})
		}
	}
	amount := func(v *big.Int) {
		if v != nil && v.Sign() > 0 {
			a.Args = append(a.Args, Arg{Name: "amount", Role: RoleAmount, Kind: prov.VAmount, Value: v.String()})
		}
	}
	a.Detail["to"] = tx.To
	a.Detail["value_wei"] = tx.Value.String()
	if tx.Creation {
		a.HoldReasons = append(a.HoldReasons, "contract creation cannot be checked")
		return a
	}
	if tx.SetCode {
		a.HoldReasons = append(a.HoldReasons, "EIP-7702 delegation transaction")
	}
	if len(tx.Data) == 0 {
		a.Kind = "transfer"
		if tx.Value.Sign() > 0 {
			addr("recipient", RoleRecipient, tx.To)
		} else {
			addr("target", RoleTarget, tx.To)
		}
		amount(tx.Value)
		return a
	}
	a.Detail["calldata_bytes"] = len(tx.Data)
	c := evm.DecodeCall(tx.Data)
	if c.Malformed {
		a.HoldReasons = append(a.HoldReasons, "malformed calldata for known function")
	}
	addr("target", RoleTarget, tx.To)
	if tx.Value.Sign() > 0 {
		amount(tx.Value)
	}
	switch c.Name {
	case "":
		a.Kind = "call"
		for i, w := range evm.AddressWords(tx.Data) {
			a.Args = append(a.Args, Arg{Name: "calldata_address#" + itoa(i), Role: RoleAddress, Kind: prov.VAddress, Value: w})
		}
	case "approve", "increaseAllowance", "setApprovalForAll":
		a.Kind = "approve"
		a.Detail["function"] = c.Name
		addr("spender", RoleSpender, c.Spender)
		if c.Amount != nil {
			if c.Amount.Cmp(unlimited) >= 0 {
				a.HoldReasons = append(a.HoldReasons, "unlimited approval")
			}
			if c.Amount.Sign() > 0 {
				a.Args = append(a.Args, Arg{Name: "approve_amount", Role: RoleAmount, Kind: prov.VAmount, Value: c.Amount.String()})
			}
		}
		if c.Approves {
			a.HoldReasons = append(a.HoldReasons, "approval for all tokens in a collection")
		}
	default: // transfer, transferFrom, safeTransferFrom
		a.Kind = "transfer"
		a.Detail["function"] = c.Name
		addr("recipient", RoleRecipient, c.Recipient)
		addr("from", RoleAddress, c.From)
		if c.Amount != nil && c.Amount.Sign() > 0 {
			a.Args = append(a.Args, Arg{Name: "token_amount", Role: RoleAmount, Kind: prov.VAmount, Value: c.Amount.String()})
		}
	}
	return a
}

func itoa(i int) string { return big.NewInt(int64(i)).String() }
