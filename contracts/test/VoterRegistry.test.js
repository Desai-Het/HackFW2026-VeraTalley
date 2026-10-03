const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VoterRegistry", function () {
  async function deployFixture() {
    const [admin, voter1, voter2, outsider] = await ethers.getSigners();
    const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
    const registry = await VoterRegistry.deploy();
    return { registry, admin, voter1, voter2, outsider };
  }

  it("sets the deployer as admin", async function () {
    const { registry, admin } = await deployFixture();
    expect(await registry.admin()).to.equal(admin.address);
  });

  it("starts with nobody eligible", async function () {
    const { registry, voter1 } = await deployFixture();
    expect(await registry.isEligible(voter1.address)).to.equal(false);
    expect(await registry.voterCount()).to.equal(0);
  });

  it("lets the admin register voters and emits an event per voter", async function () {
    const { registry, admin, voter1, voter2 } = await deployFixture();
    await expect(registry.connect(admin).registerVoters([voter1.address, voter2.address]))
      .to.emit(registry, "VoterRegistered")
      .withArgs(voter1.address)
      .and.to.emit(registry, "VoterRegistered")
      .withArgs(voter2.address);

    expect(await registry.isEligible(voter1.address)).to.equal(true);
    expect(await registry.isEligible(voter2.address)).to.equal(true);
    expect(await registry.voterCount()).to.equal(2);
  });

  it("rejects registration from a non-admin caller", async function () {
    const { registry, outsider, voter1 } = await deployFixture();
    await expect(registry.connect(outsider).registerVoters([voter1.address])).to.be.revertedWith(
      "VeraTally: caller is not admin"
    );
  });

  it("rejects the zero address", async function () {
    const { registry, admin } = await deployFixture();
    await expect(
      registry.connect(admin).registerVoters([ethers.ZeroAddress])
    ).to.be.revertedWith("VeraTally: zero address");
  });

  it("is idempotent - registering the same voter twice does not double-count or re-emit", async function () {
    const { registry, admin, voter1 } = await deployFixture();
    await registry.connect(admin).registerVoters([voter1.address]);
    await expect(registry.connect(admin).registerVoters([voter1.address])).to.not.emit(
      registry,
      "VoterRegistered"
    );
    expect(await registry.voterCount()).to.equal(1);
  });
});
