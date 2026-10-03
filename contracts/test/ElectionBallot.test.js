const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ElectionBallot", function () {
  const CANDIDATES = ["Alex Rivera", "Jordan Kim"];

  async function deployFixture() {
    const [admin, voter1, voter2, outsider] = await ethers.getSigners();

    const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
    const registry = await VoterRegistry.connect(admin).deploy();

    const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
    const ballot = await ElectionBallot.connect(admin).deploy(
      "Student Government President",
      CANDIDATES,
      await registry.getAddress()
    );

    await registry.connect(admin).registerVoters([voter1.address, voter2.address]);

    return { registry, ballot, admin, voter1, voter2, outsider };
  }

  describe("deployment", function () {
    it("sets title, candidates, admin, and starts in Draft", async function () {
      const { ballot, admin } = await deployFixture();
      expect(await ballot.title()).to.equal("Student Government President");
      expect(await ballot.getCandidates()).to.deep.equal(CANDIDATES);
      expect(await ballot.candidateCount()).to.equal(CANDIDATES.length);
      expect(await ballot.admin()).to.equal(admin.address);
      expect(await ballot.state()).to.equal(0); // Draft
    });

    it("rejects fewer than two candidates", async function () {
      const [admin] = await ethers.getSigners();
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      const registry = await VoterRegistry.deploy();
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      await expect(
        ElectionBallot.deploy("Bad Election", ["Only One"], await registry.getAddress())
      ).to.be.revertedWith("VeraTally: need at least two candidates");
    });
  });

  describe("state transitions", function () {
    it("lets the admin open voting from Draft", async function () {
      const { ballot, admin } = await deployFixture();
      await expect(ballot.connect(admin).openVoting()).to.emit(ballot, "VotingOpened");
      expect(await ballot.state()).to.equal(1); // Open
    });

    it("rejects opening from a non-admin caller", async function () {
      const { ballot, outsider } = await deployFixture();
      await expect(ballot.connect(outsider).openVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
    });

    it("rejects opening twice", async function () {
      const { ballot, admin } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(admin).openVoting()).to.be.revertedWith(
        "VeraTally: election must be in Draft to open"
      );
    });

    it("lets the admin close voting from Open, and rejects closing from Draft", async function () {
      const { ballot, admin } = await deployFixture();
      await expect(ballot.connect(admin).closeVoting()).to.be.revertedWith(
        "VeraTally: election must be Open to close"
      );
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(admin).closeVoting()).to.emit(ballot, "VotingClosed");
      expect(await ballot.state()).to.equal(2); // Closed
    });
  });

  describe("casting a vote", function () {
    it("rejects a vote while the election is still in Draft", async function () {
      const { ballot, voter1 } = await deployFixture();
      await expect(ballot.connect(voter1).castVote(0)).to.be.revertedWith(
        "VeraTally: voting is not open"
      );
    });

    it("rejects a vote from a wallet that isn't registered", async function () {
      const { ballot, admin, outsider } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(outsider).castVote(0)).to.be.revertedWith(
        "VeraTally: this wallet is not registered to vote"
      );
    });

    it("accepts a vote from a registered wallet while Open, updates the tally, and emits VoteCast", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await ballot.connect(admin).openVoting();

      await expect(ballot.connect(voter1).castVote(1)).to.emit(ballot, "VoteCast").withArgs(voter1.address, 1);

      expect(await ballot.hasVoted(voter1.address)).to.equal(true);
      expect(await ballot.getTally()).to.deep.equal([0n, 1n]);
    });

    it("rejects a second vote from the same wallet", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(voter1).castVote(0);
      await expect(ballot.connect(voter1).castVote(1)).to.be.revertedWith(
        "VeraTally: this wallet has already voted"
      );
    });

    it("rejects an invalid candidate id", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(voter1).castVote(99)).to.be.revertedWith(
        "VeraTally: invalid candidate"
      );
    });

    it("rejects a vote after the election is closed", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(admin).closeVoting();
      await expect(ballot.connect(voter1).castVote(0)).to.be.revertedWith(
        "VeraTally: voting is not open"
      );
    });

    it("tallies multiple voters correctly, in candidate order", async function () {
      const { ballot, admin, voter1, voter2 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(voter1).castVote(0);
      await ballot.connect(voter2).castVote(0);
      expect(await ballot.getTally()).to.deep.equal([2n, 0n]);
    });
  });

  describe("another election's admin has no authority here", function () {
    it("a second ElectionBallot's admin cannot open or close this one", async function () {
      const { ballot, registry, voter1 } = await deployFixture();
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      const otherBallot = await ElectionBallot.connect(voter1).deploy(
        "Other Election",
        ["A", "B"],
        await registry.getAddress()
      );
      // voter1 is admin of otherBallot, but not of `ballot`.
      expect(await otherBallot.admin()).to.equal(voter1.address);
      await expect(ballot.connect(voter1).openVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
    });
  });
});
