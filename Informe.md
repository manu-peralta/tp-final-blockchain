# Vulnerabilidades en Smart Contracts: un caso práctico con una bóveda de ETH

**Manuel Peralta - Legajo 20189/4**

## 1. Objetivo

Como continuación del informe anterior, se desarrolla una bóveda de ETH con cinco vulnerabilidades del OWASP Smart Contract Top 10 de 2026. Se conservan control de acceso y reentrada, y se incorporan lógica de negocio, validación de entradas y llamadas externas sin verificar. Cada caso se demuestra con un test y se compara con una versión corregida.

## 2. Descripción del contrato y reglas

La bóveda guarda ETH y registra un saldo por dirección. Los usuarios pueden depositar, retirar todo su saldo a su propia cuenta o enviar una parte a otro destinatario. El administrador configura una comisión de retiro usando porcentajes enteros, el cálculo es monto * porcentajeComision / 100. La regla del proyecto limita la comisión al 10%.

Cada dirección con saldo puede reclamar una recompensa de 0,01 ETH una sola vez, mientras alcance el fondo aportado al constructor de la boveda. Al reclamar, se descuenta del fondo y se suma al saldo del usuario. Ese aporte inicial no se registra como saldo del administrador.

Las cinco vulnerabilidades están en BovedaVulnerable.sol. BovedaCorregida.sol implementa las correcciones. Desde los tests se despliegan AtacanteReentrancy.sol y ReceptorQueRechazaETH.sol para simular la reentrada y el rechazo de un pago.

## 3. Método de demostración

Se utiliza Solidity 0.8.18. Antes de cada test se despliega una bóveda nueva con 1 ETH de fondo de recompensas, aportado al constructor. Los tests usan las cuentas administrador, alice y atacante.

Reglas para separar las demostraciones:

- La comisión comienza en cero para no alterar los montos de los otros casos.
- En SC02 (lógica de negocio), los reclamos se hacen en transacciones sucesivas, sin reentrada.
- En SC05 (falta de validación de entradas), la comisión inválida la configura el administrador legítimo, sin aprovechar SC01 (control de acceso).
- En SC06 (llamadas externas sin verificar), el saldo se actualiza antes del pago. En SC08 (reentrada), se comprueba el pago, pero el saldo se actualiza después.

## 4. SC01: control de acceso incorrecto

cambiarAdministrador no comprueba que quien llama sea el administrador:

```solidity
function cambiarAdministrador(address nuevoAdministrador) external {
    require(nuevoAdministrador != address(0), "Direccion cero");
    administrador = nuevoAdministrador;
    emit AdministradorCambiado(nuevoAdministrador);
}
```

La prueba usa una cuenta ajena para tomar el rol de administrador y configurar una comisión del 5%. Después comprueba que el administrador original perdió ese permiso.

La corrección agrega require(msg.sender == administrador, "Solo administrador") dentro de la función. El test rechaza el cambio desde una cuenta ajena y permite que el administrador actual transfiera el rol a Alice. Después comprueba que Alice puede configurar la comisión y que el administrador original ya no puede hacerlo.

## 5. SC02: error de lógica de negocio

reclamarRecompensa permite repetir un cobro que debería ser único:

```solidity
require(saldos[msg.sender] > 0, "Sin saldo");
require(fondoRecompensas >= RECOMPENSA, "Sin fondo de recompensas");
fondoRecompensas -= RECOMPENSA;
saldos[msg.sender] += RECOMPENSA;
```

La prueba deposita 1 ETH y reclama dos veces. El saldo llega a 1,02 ETH y el fondo baja a 0,98 ETH. Después retira el saldo completo: obtuvo 0,01 ETH más de lo permitido.

La corrección agrega mapping(address => bool) recompensaReclamada. Antes de acreditar, verifica que la dirección no haya cobrado y registra el reclamo. El test permite una recompensa y rechaza la segunda, incluso después de retirar y volver a depositar.

## 6. SC05: falta de validación de entradas

setComision comprueba que quien llama sea el administrador, pero no valida el rango recibido:

```solidity
function setComision(uint256 nuevaComision) external {
    require(msg.sender == administrador, "Solo administrador");
    porcentajeComision = nuevaComision;
    emit ComisionCambiada(nuevaComision);
}
```

El administrador ejecuta setComision(150). Al retirar 1 ETH, la comisión calculada es 1,5 ETH. En esta version de solidity, la resta monto - comision revierte por underflow, en lugar de desbordarse silenciosamente como podría ocurrir antes de la version 0.8. La idea del test era demostrar la falta de validación de la comisión, no ese underflow. El bloqueo es recuperable, ya que restablecer la comisión a cero permite retirar.

La corrección agrega require(nuevaComision <= 10). Los tests rechazan 150 y 11, aceptan 0 y 10, y comprueban que un retiro de 1 ETH al 10% deja 0,1 ETH de comisión en la bóveda.

## 7. SC06: llamada externa sin verificar

retirarA descuenta el saldo, pero no comprueba enviado:

```solidity
saldos[msg.sender] -= monto;
(bool enviado, ) = destino.call{value: monto - comision}("");
emit Retiro(msg.sender, destino, monto, comision);
```

El test deposita 1 ETH y usa como destino a ReceptorQueRechazaETH, cuyo receive() revierte. La bóveda continúa y deja el saldo registrado del usuario en cero sin pagarle. El ETH permanece en la bóveda y el receptor no recibe nada.

La corrección agrega require(enviado, "Fallo el envio"). Ante el rechazo, revierte también el descuento del saldo. El test comprueba que el usuario conserva su saldo y puede reintentar el retiro hacia una dirección válida.

## 8. SC08: reentrada

retirarTodo envía el ETH antes de poner el saldo en cero:

```solidity
uint256 monto = saldos[msg.sender];
// ... validaciones y calculo de comision ...
(bool enviado, ) = payable(msg.sender).call{value: monto - comision}("");
require(enviado, "Fallo el envio");
saldos[msg.sender] = 0;
```

El test prepara el fondo inicial de 1 ETH y un depósito legítimo de 5 ETH. AtacanteReentrancy deposita 1 ETH y pide retirar. Su receive() vuelve a llamar a retirarTodo hasta alcanzar tres cobros. Obtiene 3 ETH en total: recupera su depósito y extrae 2 ETH adicionales. Su saldo registrado queda en cero y la bóveda conserva solo 4 ETH. El retiro completo del usuario que depositó 5 ETH falla por falta de fondos.

Se asigna el saldo a cero al finalizar, en lugar de restar en cada llamada, para que un underflow no revierta la demostración.

La corrección mueve saldos[msg.sender] = 0 antes del envío. El mismo auxiliar encuentra el saldo en cero al intentar cobrar nuevamente y revierte todo el ataque, incluido su depósito. El test comprueba que la bóveda conserva los 6 ETH previos y que el usuario legítimo puede retirar sus 5 ETH.

## 9. Resultados

El proyecto incluye diez pruebas: cinco reproducen las vulnerabilidades y cinco comprueban sus correcciones. Las instrucciones de ejecución están en el README.

El caso permite comparar cada falla con un cambio concreto: restringir una función, registrar un reclamo, limitar un parámetro, comprobar un pago o actualizar el saldo antes de enviarlo.

## Referencias

OWASP. SC01:2026 - Access Control Vulnerabilities. [https://scs.owasp.org/sctop10/SC01-AccessControlVulnerabilities/](https://scs.owasp.org/sctop10/SC01-AccessControlVulnerabilities/)

OWASP. SC02:2026 - Business Logic Vulnerabilities. [https://scs.owasp.org/sctop10/SC02-BusinessLogicVulnerabilities/](https://scs.owasp.org/sctop10/SC02-BusinessLogicVulnerabilities/)

OWASP. SC05:2026 - Lack of Input Validation. [https://scs.owasp.org/sctop10/SC05-LackOfInputValidation/](https://scs.owasp.org/sctop10/SC05-LackOfInputValidation/)

OWASP. SC06:2026 - Unchecked External Calls. [https://scs.owasp.org/sctop10/SC06-UncheckedExternalCalls/](https://scs.owasp.org/sctop10/SC06-UncheckedExternalCalls/)

OWASP. SC08:2026 - Reentrancy Attacks. [https://scs.owasp.org/sctop10/SC08-ReentrancyAttacks/](https://scs.owasp.org/sctop10/SC08-ReentrancyAttacks/)

OWASP. Smart Contract Top 10: 2026. [https://scs.owasp.org/sctop10/](https://scs.owasp.org/sctop10/)
