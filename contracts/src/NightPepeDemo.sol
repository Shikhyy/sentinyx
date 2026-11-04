// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Night Pepe (DEMO)
/// @notice A TESTNET-ONLY demo token for the Sentinyx scanner. It is an ordinary ERC-20 whose ERC-7572
/// `contractURI()` metadata carries instructions written for AI agents. Never deploy it to mainnet.
contract NightPepeDemo {
    string public constant name = "Night Pepe";
    string public constant symbol = "NITE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public owner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    string private _contractURI;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory uri, uint256 supply) {
        owner = msg.sender;
        _contractURI = uri;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    /// ERC-7572 contract-level metadata. Many wallets and agents read the description from here.
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) private {
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
