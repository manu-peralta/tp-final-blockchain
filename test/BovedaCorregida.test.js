const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BovedaCorregida - correcciones de los cinco fallos", function () {
  let Boveda;
  let boveda;
  let administrador;
  let alice;
  let atacante;

  beforeEach(async function () {
    [administrador, alice, atacante] = await ethers.getSigners();
    Boveda = await ethers.getContractFactory("BovedaCorregida");
    boveda = await Boveda.deploy({ value: ethers.utils.parseEther("1") }); // se deposita 1 ETH en la boveda para recompensas
    await boveda.deployed();
  });

  it("SC01 - rechaza el cambio de administrador por una cuenta ajena", async function () {
    await expect(boveda.connect(atacante).cambiarAdministrador(atacante.address))
      .to.be.revertedWith("Solo administrador");
    await expect(boveda.connect(atacante).setComision(5))
      .to.be.revertedWith("Solo administrador");
    expect(await boveda.administrador()).to.equal(administrador.address);
    await boveda.cambiarAdministrador(alice.address);
    await boveda.connect(alice).setComision(5); // ahora el admin es alice
    await expect(boveda.setComision(0)).to.be.revertedWith("Solo administrador"); // tira error porque llama el admin original, que ya no es el admin
  });


  it("SC02 - acredita una recompensa y rechaza el segundo reclamo", async function () {
    await boveda.connect(alice).depositar({ value: ethers.utils.parseEther("1") });
    await boveda.connect(alice).reclamarRecompensa();
    await expect(boveda.connect(alice).reclamarRecompensa())
      .to.be.revertedWith("Recompensa ya reclamada");
    expect(await boveda.saldos(alice.address)).to.equal(ethers.utils.parseEther("1.01"));
    expect(await boveda.fondoRecompensas()).to.equal(ethers.utils.parseEther("0.99"));
    await boveda.connect(alice).retirarTodo();
    expect(await boveda.saldos(alice.address)).to.equal(0);
    expect(await ethers.provider.getBalance(boveda.address)).to.equal(ethers.utils.parseEther("0.99"));
    // retirar y volver a depositar no reinicia el derecho a la recompensa
    await boveda.connect(alice).depositar({ value: ethers.utils.parseEther("1") });
    await expect(boveda.connect(alice).reclamarRecompensa())
      .to.be.revertedWith("Recompensa ya reclamada");
  });

  it("SC05 - rechaza 150% y el limite mas uno, acepta 0 y 10%", async function () {
    await expect(boveda.setComision(150)).to.be.revertedWith("Comision maxima: 10%");
    await expect(boveda.setComision(11)).to.be.revertedWith("Comision maxima: 10%");
    expect(await boveda.porcentajeComision()).to.equal(0);
    await boveda.setComision(0);
    await boveda.setComision(10);
    expect(await boveda.porcentajeComision()).to.equal(10);
    await boveda.connect(alice).depositar({ value: ethers.utils.parseEther("1") });
    await boveda.connect(alice).retirarTodo();
    expect(await boveda.saldos(alice.address)).to.equal(0);
    expect(await ethers.provider.getBalance(boveda.address)).to.equal(ethers.utils.parseEther("1.1"));
  });


  it("SC06 - un pago rechazado revierte y conserva el saldo para reintentar", async function () {
    const Receptor = await ethers.getContractFactory("ReceptorQueRechazaETH");
    const receptor = await Receptor.deploy();
    await receptor.deployed();
    await boveda.connect(alice).depositar({ value: ethers.utils.parseEther("1") });
    const fondosAntes = await ethers.provider.getBalance(boveda.address);
    await expect(boveda.connect(alice).retirarA(ethers.utils.parseEther("1"), receptor.address))
      .to.be.revertedWith("Fallo el envio");
    expect(await boveda.saldos(alice.address)).to.equal(ethers.utils.parseEther("1")); // el saldo sigue igual
    expect(await ethers.provider.getBalance(receptor.address)).to.equal(0); // el receptor no recibe nada
    expect(await ethers.provider.getBalance(boveda.address)).to.equal(fondosAntes); // los fondos siguen en la boveda porque no se hizo el envio
    await boveda.connect(alice).retirarA(ethers.utils.parseEther("1"), alice.address);
    expect(await boveda.saldos(alice.address)).to.equal(0);
  });


  it("SC08 - el ataque revierte y no se pierden los fondos", async function () {
    await boveda.connect(alice).depositar({ value: ethers.utils.parseEther("5") });
    const Atacante = await ethers.getContractFactory("AtacanteReentrancy", atacante);
    const ataque = await Atacante.deploy(boveda.address);
    await ataque.deployed();
    // la llamada anidada encuentra el saldo en cero y revierte todo el ataque
    await expect(ataque.atacar({ value: ethers.utils.parseEther("1") }))
      .to.be.revertedWith("Fallo el envio");
    expect(await ethers.provider.getBalance(ataque.address)).to.equal(0); // el atacante no recibe nada
    expect(await boveda.saldos(ataque.address)).to.equal(0);
    expect(await ethers.provider.getBalance(boveda.address)).to.equal(ethers.utils.parseEther("6")); // la boveda tiene los eth correspondientes
    await boveda.connect(alice).retirarTodo();
    expect(await boveda.saldos(alice.address)).to.equal(0);
    expect(await ethers.provider.getBalance(boveda.address)).to.equal(ethers.utils.parseEther("1"));
  });


});
