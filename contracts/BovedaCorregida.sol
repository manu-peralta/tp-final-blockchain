// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

/// Version que corrige los cinco problemas del caso de estudio.
contract BovedaCorregida {
    address public administrador;
    mapping(address => uint256) public saldos;
    mapping(address => bool) public recompensaReclamada;
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
        fondoRecompensas = msg.value;
    }

    function depositar() external payable {
        require(msg.value > 0, "Deposito cero");
        saldos[msg.sender] += msg.value;
        emit Deposito(msg.sender, msg.value);
    }

    // SC01: se comprueba el llamador, entonces solo el administrador puede cambiar el administrador
    function cambiarAdministrador(address nuevoAdministrador) external {
        require(msg.sender == administrador, "Solo administrador");
        require(nuevoAdministrador != address(0), "Direccion cero");
        administrador = nuevoAdministrador;
        emit AdministradorCambiado(nuevoAdministrador);
    }

    // SC02: se registra el cobro de la recompensa, entonces no se puede reclamar dos veces
    function reclamarRecompensa() external {
        require(saldos[msg.sender] > 0, "Sin saldo");
        require(!recompensaReclamada[msg.sender], "Recompensa ya reclamada");
        require(fondoRecompensas >= RECOMPENSA, "Sin fondo de recompensas");
        recompensaReclamada[msg.sender] = true;
        fondoRecompensas -= RECOMPENSA;
        saldos[msg.sender] += RECOMPENSA;
        emit RecompensaAcreditada(msg.sender, RECOMPENSA);
    }

    // SC05: la comision se limita a 10%
    function setComision(uint256 nuevaComision) external {
        require(msg.sender == administrador, "Solo administrador");
        require(nuevaComision <= 10, "Comision maxima: 10%");
        porcentajeComision = nuevaComision;
        emit ComisionCambiada(nuevaComision);
    }

    // SC06: se verifica el envio, entonces no se puede retirar si el envio falla
    function retirarA(uint256 monto, address payable destino) external {
        require(destino != address(0), "Direccion cero");
        require(monto > 0 && monto <= saldos[msg.sender], "Monto invalido");
        uint256 comision = monto * porcentajeComision / 100;
        saldos[msg.sender] -= monto;
        (bool enviado, ) = destino.call{value: monto - comision}("");
        // si falla, el revert restaura el saldo descontado
        require(enviado, "Fallo el envio");
        emit Retiro(msg.sender, destino, monto, comision);
    }

    // SC08: se pone el saldo en cero antes del envio, entonces no se puede cobrar dos veces
    function retirarTodo() external {
        uint256 monto = saldos[msg.sender];
        require(monto > 0, "Sin saldo");
        uint256 comision = monto * porcentajeComision / 100;
        saldos[msg.sender] = 0;
        (bool enviado, ) = payable(msg.sender).call{value: monto - comision}("");
        require(enviado, "Fallo el envio");
        emit Retiro(msg.sender, msg.sender, monto, comision);
    }
}
