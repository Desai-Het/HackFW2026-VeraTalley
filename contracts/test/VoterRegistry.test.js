const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VoterRegistry", function () {
  async function deployFixture() {
    const [admin, voter1, voter2, outsider] = await ethers.getSigners();
    const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
    const registry = await VoterRegistry.deploy(admin.address);
    return { registry, admin, voter1, voter2, outsider };
  }

  it("sets the admin it was constructed with (here, the deployer)", async function () {
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

  // ---------------------------------------------------------------------------------------
  // Everything below this line was added on top of the original 6 tests.
  // ---------------------------------------------------------------------------------------

  describe("batch behavior", function () {
    it("accepts an empty list as a harmless no-op", async function () {
      const { registry, admin } = await deployFixture();
      await expect(registry.connect(admin).registerVoters([])).to.not.emit(registry, "VoterRegistered");
      expect(await registry.voterCount()).to.equal(0);
    });

    it("counts a wallet once when it appears twice in the same list", async function () {
      const { registry, admin, voter1 } = await deployFixture();
      await expect(registry.connect(admin).registerVoters([voter1.address, voter1.address]))
        .to.emit(registry, "VoterRegistered")
        .withArgs(voter1.address);

      expect(await registry.voterCount()).to.equal(1);
      expect(await registry.queryFilter(registry.filters.VoterRegistered())).to.have.length(1);
    });

    it("on a mixed list, registers and announces only the new wallets", async function () {
      const { registry, admin, voter1, voter2 } = await deployFixture();
      await registry.connect(admin).registerVoters([voter1.address]);

      const tx = await registry.connect(admin).registerVoters([voter1.address, voter2.address]);
      await tx.wait();

      expect(await registry.voterCount()).to.equal(2);
      // voter1 was announced by the first call, voter2 by the second, nobody twice.
      const events = await registry.queryFilter(registry.filters.VoterRegistered());
      expect(events.map((e) => e.args.voter)).to.deep.equal([voter1.address, voter2.address]);
    });

    it("one bad address cancels the whole batch, including valid wallets listed before it", async function () {
      const { registry, admin, voter1, voter2 } = await deployFixture();
      await expect(
        registry.connect(admin).registerVoters([voter1.address, ethers.ZeroAddress, voter2.address])
      ).to.be.revertedWith("VeraTally: zero address");

      expect(await registry.isEligible(voter1.address)).to.equal(false);
      expect(await registry.isEligible(voter2.address)).to.equal(false);
      expect(await registry.voterCount()).to.equal(0);
      expect(await registry.queryFilter(registry.filters.VoterRegistered())).to.have.length(0);
    });

    it("keeps an accurate running count across several separate calls", async function () {
      const [admin, a, b, c, d] = await ethers.getSigners();
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      const registry = await VoterRegistry.connect(admin).deploy(admin.address);

      await registry.registerVoters([a.address]);
      await registry.registerVoters([b.address, c.address]);
      await registry.registerVoters([c.address, d.address]);

      expect(await registry.voterCount()).to.equal(4);
    });

    it("handles a larger batch in one call", async function () {
      const { registry, admin } = await deployFixture();
      const wallets = Array.from({ length: 50 }, () => ethers.Wallet.createRandom().address);
      await registry.connect(admin).registerVoters(wallets);

      expect(await registry.voterCount()).to.equal(50);
      expect(await registry.isEligible(wallets[0])).to.equal(true);
      expect(await registry.isEligible(wallets[49])).to.equal(true);
    });
  });

  describe("access control (additional cases)", function () {
    it("rejects the zero address as the admin", async function () {
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      await expect(VoterRegistry.deploy(ethers.ZeroAddress)).to.be.revertedWith("VeraTally: zero address");
    });

    it("uses the admin it is given, not whoever deploys it (this is how the factory works)", async function () {
      const { admin, outsider, voter1 } = await deployFixture();
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      const registry = await VoterRegistry.connect(outsider).deploy(admin.address);

      expect(await registry.admin()).to.equal(admin.address);
      // Sending the deployment transaction gives the deployer no rights over the registry.
      await expect(registry.connect(outsider).registerVoters([voter1.address])).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
      await registry.connect(admin).registerVoters([voter1.address]);
      expect(await registry.isEligible(voter1.address)).to.equal(true);
    });

    it("a registered voter has no admin rights", async function () {
      const { registry, admin, voter1, voter2 } = await deployFixture();
      await registry.connect(admin).registerVoters([voter1.address]);
      await expect(registry.connect(voter1).registerVoters([voter2.address])).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
      expect(await registry.isEligible(voter2.address)).to.equal(false);
    });

    it("a rejected non-admin call changes nothing", async function () {
      const { registry, outsider, voter1 } = await deployFixture();
      await expect(registry.connect(outsider).registerVoters([voter1.address])).to.be.reverted;
      expect(await registry.isEligible(voter1.address)).to.equal(false);
      expect(await registry.voterCount()).to.equal(0);
    });

    it("the admin can register their own wallet like any other", async function () {
      const { registry, admin } = await deployFixture();
      await registry.connect(admin).registerVoters([admin.address]);
      expect(await registry.isEligible(admin.address)).to.equal(true);
    });

    it("the admin is not automatically eligible", async function () {
      const { registry, admin } = await deployFixture();
      expect(await registry.isEligible(admin.address)).to.equal(false);
    });

    it("the admin cannot be changed: the contract exposes no way to hand it over", async function () {
      const { registry } = await deployFixture();
      const writeFunctions = registry.interface.fragments
        .filter((f) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f) => f.name);
      expect([...writeFunctions].sort()).to.deep.equal(["addInvites", "claimInvite", "linkBallot", "registerVoters"]);
      expect(writeFunctions.some((n) => /admin|owner|transfer/i.test(n))).to.equal(false);
    });

    it("there is no function to remove a voter once registered", async function () {
      const { registry, admin, voter1 } = await deployFixture();
      await registry.connect(admin).registerVoters([voter1.address]);
      const names = registry.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
      expect(names.some((n) => /remove|unregister|revoke|delete/i.test(n))).to.equal(false);
      expect(await registry.isEligible(voter1.address)).to.equal(true);
    });
  });

  describe("independence between registries", function () {
    it("two registries keep separate lists and separate admins", async function () {
      const [admin, other, voter] = await ethers.getSigners();
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      const first = await VoterRegistry.connect(admin).deploy(admin.address);
      const second = await VoterRegistry.connect(other).deploy(other.address);

      await first.connect(admin).registerVoters([voter.address]);

      expect(await first.isEligible(voter.address)).to.equal(true);
      expect(await second.isEligible(voter.address)).to.equal(false);
      expect(await second.voterCount()).to.equal(0);
      await expect(second.connect(admin).registerVoters([voter.address])).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
    });
  });
});
