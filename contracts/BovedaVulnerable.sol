// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

contract BovedaVulnerable {
    address public administrador;
    mapping(address => uint256) public saldos;
    uint256 public porcentajeComision;
    uint256 public fondoRecompensas;
    uint256 public constant RECOMPENSA = 0.01 ether;

    event Deposito(address indexed usuario, uint256 monto);
    event Retiro(address indexed usuario, address indexed destino, uint256 monto, uint256 comision);
    event RecompensaAcreditada(address indexed usuario, uint256 monto);
    event AdministradorCambiado(address indexed nuevoAdministrador);
    event ComisionCambiada(uint256 nuevaComision);

    constructor() payable {
        administrador = msg.sender;
        fondoRecompensas = msg.value; // financia las recompensas
    }

    function depositar() external payable {
        require(msg.value > 0, "Deposito cero");
        saldos[msg.sender] += msg.value;
        emit Deposito(msg.sender, msg.value);
    }

    // SC01: no se comprueba el llamador, entonces cualquier cuenta puede tomar el control
    function cambiarAdministrador(address nuevoAdministrador) external {
        require(nuevoAdministrador != address(0), "Direccion cero");
        administrador = nuevoAdministrador;
        emit AdministradorCambiado(nuevoAdministrador);
    }

    // SC02: la regla es una recompensa por cuenta, pero el cobro no queda registrado
    function reclamarRecompensa() external {
        require(saldos[msg.sender] > 0, "Sin saldo");
        require(fondoRecompensas >= RECOMPENSA, "Sin fondo de recompensas");
        fondoRecompensas -= RECOMPENSA;
        saldos[msg.sender] += RECOMPENSA;
        emit RecompensaAcreditada(msg.sender, RECOMPENSA);
    }

    // SC05: el llamador esta autorizado, pero el valor no tiene un limite
    // la idea del fallo es de validacion de entradas porque acepta una comision que bloquea los retiros
    // solidity 0.8 revierte la resta por underflow y no hay un desbordamiento silencioso
    // los fondos quedan bloqueados hasta que el administrador corrija la comision
    function setComision(uint256 nuevaComision) external {
        require(msg.sender == administrador, "Solo administrador");
        porcentajeComision = nuevaComision;
        emit ComisionCambiada(nuevaComision);
    }

    // SC06: se ignora un fallo del pago y se descuenta el saldo
    function retirarA(uint256 monto, address payable destino) external {
        require(destino != address(0), "Direccion cero");
        require(monto > 0 && monto <= saldos[msg.sender], "Monto invalido");
        uint256 comision = monto * porcentajeComision / 100;
        saldos[msg.sender] -= monto;
        (bool enviado, ) = destino.call{value: monto - comision}("");
        // 'enviado' queda sin verificar deliberadamente para el ejemplo
        emit Retiro(msg.sender, destino, monto, comision);
    }

    // SC08: el receptor puede volver a entrar mientras su saldo todavia esta disponible
    function retirarTodo() external {
        uint256 monto = saldos[msg.sender];
        require(monto > 0, "Sin saldo");
        uint256 comision = monto * porcentajeComision / 100;
        (bool enviado, ) = payable(msg.sender).call{value: monto - comision}(""); // aca se puede hacer reentrancy, no se descuenta el saldo antes
        require(enviado, "Fallo el envio");
        saldos[msg.sender] = 0;
        emit Retiro(msg.sender, msg.sender, monto, comision);
    }
}
