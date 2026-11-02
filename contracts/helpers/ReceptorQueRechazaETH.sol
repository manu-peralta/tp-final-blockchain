// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

// para SC06
contract ReceptorQueRechazaETH {
    receive() external payable {
        revert("No acepto ETH");
    }
}
