// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ZENOMARKETS testnet asset: the settlement dollar and the tokenized instruments of the testnet
/// markets. Anyone can mint up to `MINT_LIMIT` whole tokens per call, so every visitor can try the venue.
contract ZenoTestToken is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable mintLimit;

    error MintLimit(uint256 limit);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 mintLimitWhole)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
        mintLimit = mintLimitWhole * 10 ** decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        if (amount > mintLimit) revert MintLimit(mintLimit);
        _mint(to, amount);
    }
}
