const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ElectionBallot", function () {
  const CANDIDATES = ["Alex Rivera", "Jordan Kim"];

  async function deployFixture() {
    const [admin, voter1, voter2, outsider] = await ethers.getSigners();

    const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
    const registry = await VoterRegistry.connect(admin).deploy(admin.address);

    const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
    const ballot = await ElectionBallot.connect(admin).deploy(
      "Student Government President",
      CANDIDATES,
      await registry.getAddress(),
      admin.address
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
      const registry = await VoterRegistry.deploy(admin.address);
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      await expect(
        ElectionBallot.deploy("Bad Election", ["Only One"], await registry.getAddress(), admin.address)
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
        await registry.getAddress(),
        voter1.address
      );
      // voter1 is admin of otherBallot, but not of `ballot`.
      expect(await otherBallot.admin()).to.equal(voter1.address);
      await expect(ballot.connect(voter1).openVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
    });
  });

  // ---------------------------------------------------------------------------------------
  // Everything below this line was added on top of the original 20 tests. It covers cases the
  // original suite did not exercise. Tests marked "documents current behavior" pin down what
  // the contract does TODAY on a question the project docs leave open - if the team decides
  // on a different rule, those are the tests to change along with the contract.
  // ---------------------------------------------------------------------------------------

  describe("deployment (additional cases)", function () {
    it("rejects the zero address as the admin", async function () {
      const { registry } = await deployFixture();
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      await expect(
        ElectionBallot.deploy("Bad Election", CANDIDATES, await registry.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("VeraTally: zero address");
    });

    it("uses the admin it is given, not whoever deploys it (this is how the factory works)", async function () {
      const { registry, admin, outsider } = await deployFixture();
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      const ballot = await ElectionBallot.connect(outsider).deploy(
        "Delegated",
        CANDIDATES,
        await registry.getAddress(),
        admin.address
      );
      expect(await ballot.admin()).to.equal(admin.address);
      // Sending the deployment transaction gives the deployer no rights over the ballot.
      await expect(ballot.connect(outsider).openVoting()).to.be.revertedWith("VeraTally: caller is not admin");
      await expect(ballot.connect(admin).openVoting()).to.emit(ballot, "VotingOpened");
    });

    it("rejects the zero address as the voter registry", async function () {
      const [admin] = await ethers.getSigners();
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      await expect(
        ElectionBallot.deploy("Bad Election", CANDIDATES, ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("VeraTally: zero address");
    });

    it("rejects an empty candidate list", async function () {
      const [admin] = await ethers.getSigners();
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      const registry = await VoterRegistry.deploy(admin.address);
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      await expect(
        ElectionBallot.deploy("Bad Election", [], await registry.getAddress(), admin.address)
      ).to.be.revertedWith("VeraTally: need at least two candidates");
    });

    it("accepts exactly two candidates (the minimum)", async function () {
      const [admin] = await ethers.getSigners();
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      const registry = await VoterRegistry.deploy(admin.address);
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      const ballot = await ElectionBallot.deploy("Two Way", ["A", "B"], await registry.getAddress(), admin.address);
      expect(await ballot.candidateCount()).to.equal(2);
    });

    it("stores the registry address it was given", async function () {
      const { ballot, registry } = await deployFixture();
      expect(await ballot.voterRegistry()).to.equal(await registry.getAddress());
    });

    it("starts with an all-zero tally and nobody marked as voted", async function () {
      const { ballot, voter1 } = await deployFixture();
      expect(await ballot.getTally()).to.deep.equal([0n, 0n]);
      expect(await ballot.hasVoted(voter1.address)).to.equal(false);
    });

    it("supports more than two candidates and tallies each separately", async function () {
      const [admin, v1, v2, v3] = await ethers.getSigners();
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      const registry = await VoterRegistry.deploy(admin.address);
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      const ballot = await ElectionBallot.deploy("Three Way", ["A", "B", "C"], await registry.getAddress(), admin.address);
      await registry.registerVoters([v1.address, v2.address, v3.address]);
      await ballot.openVoting();

      await ballot.connect(v1).castVote(0);
      await ballot.connect(v2).castVote(2);
      await ballot.connect(v3).castVote(2);

      expect(await ballot.getTally()).to.deep.equal([1n, 0n, 2n]);
    });
  });

  describe("state transitions (additional cases)", function () {
    it("rejects closing from a non-admin caller, even while the election is Open", async function () {
      const { ballot, admin, outsider } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(outsider).closeVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
      expect(await ballot.state()).to.equal(1); // still Open
    });

    it("rejects a registered voter trying to open or close the election", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await expect(ballot.connect(voter1).openVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(voter1).closeVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
    });

    it("rejects closing twice", async function () {
      const { ballot, admin } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(admin).closeVoting();
      await expect(ballot.connect(admin).closeVoting()).to.be.revertedWith(
        "VeraTally: election must be Open to close"
      );
    });

    it("cannot be reopened once Closed", async function () {
      const { ballot, admin } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(admin).closeVoting();
      await expect(ballot.connect(admin).openVoting()).to.be.revertedWith(
        "VeraTally: election must be in Draft to open"
      );
      expect(await ballot.state()).to.equal(2); // still Closed
    });

    it("emits VotingOpened and VotingClosed exactly once each over a full lifecycle", async function () {
      const { ballot, admin } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(admin).closeVoting();
      expect(await ballot.queryFilter(ballot.filters.VotingOpened())).to.have.length(1);
      expect(await ballot.queryFilter(ballot.filters.VotingClosed())).to.have.length(1);
    });
  });

  describe("casting a vote (additional cases)", function () {
    it("accepts a vote for the last valid candidate id", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(voter1).castVote(CANDIDATES.length - 1);
      expect(await ballot.getTally()).to.deep.equal([0n, 1n]);
    });

    it("rejects candidate id equal to the candidate count (off-by-one boundary)", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(voter1).castVote(CANDIDATES.length)).to.be.revertedWith(
        "VeraTally: invalid candidate"
      );
    });

    it("rejects the largest possible candidate id without overflowing", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(voter1).castVote(ethers.MaxUint256)).to.be.revertedWith(
        "VeraTally: invalid candidate"
      );
    });

    it("a rejected vote leaves no trace: tally unchanged and the wallet is not marked as voted", async function () {
      const { ballot, admin, voter1, outsider } = await deployFixture();
      await ballot.connect(admin).openVoting();

      await expect(ballot.connect(outsider).castVote(0)).to.be.reverted;
      await expect(ballot.connect(voter1).castVote(99)).to.be.reverted;

      expect(await ballot.getTally()).to.deep.equal([0n, 0n]);
      expect(await ballot.hasVoted(outsider.address)).to.equal(false);
      // The voter whose vote failed on a bad candidate id can still vote properly afterwards.
      expect(await ballot.hasVoted(voter1.address)).to.equal(false);
      await expect(ballot.connect(voter1).castVote(0)).to.emit(ballot, "VoteCast");
    });

    it("a rejected second vote does not change the tally or the first choice", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(voter1).castVote(0);
      await expect(ballot.connect(voter1).castVote(1)).to.be.reverted;
      expect(await ballot.getTally()).to.deep.equal([1n, 0n]);
    });

    it("the admin has no special voting rights: an unregistered admin cannot vote", async function () {
      const { ballot, admin } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(admin).castVote(0)).to.be.revertedWith(
        "VeraTally: this wallet is not registered to vote"
      );
    });

    it("the tally is frozen after closing: the final numbers stay exactly as they were", async function () {
      const { ballot, admin, voter1, voter2 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(voter1).castVote(0);
      await ballot.connect(admin).closeVoting();

      await expect(ballot.connect(voter2).castVote(1)).to.be.reverted;

      expect(await ballot.getTally()).to.deep.equal([1n, 0n]);
      expect(await ballot.hasVoted(voter2.address)).to.equal(false);
    });

    it("a closed election still reports who already voted", async function () {
      const { ballot, admin, voter1 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(voter1).castVote(0);
      await ballot.connect(admin).closeVoting();
      expect(await ballot.hasVoted(voter1.address)).to.equal(true);
    });

    it("voteCounts(i) and getTally() agree for every candidate", async function () {
      const { ballot, admin, voter1, voter2 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(voter1).castVote(1);
      await ballot.connect(voter2).castVote(0);

      const tally = await ballot.getTally();
      for (let i = 0; i < CANDIDATES.length; i++) {
        expect(await ballot.voteCounts(i)).to.equal(tally[i]);
      }
    });

    it("reads of the ballot do not depend on who calls them", async function () {
      const { ballot, outsider } = await deployFixture();
      expect(await ballot.connect(outsider).getTally()).to.deep.equal([0n, 0n]);
      expect(await ballot.connect(outsider).title()).to.equal("Student Government President");
    });
  });

  describe("events can rebuild the result (CR-03)", function () {
    it("recounting the VoteCast event log gives exactly the on-chain tally", async function () {
      const [admin, v1, v2, v3, v4] = await ethers.getSigners();
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      const registry = await VoterRegistry.deploy(admin.address);
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      const ballot = await ElectionBallot.deploy("Recount", ["A", "B", "C"], await registry.getAddress(), admin.address);
      await registry.registerVoters([v1.address, v2.address, v3.address, v4.address]);
      await ballot.openVoting();

      await ballot.connect(v1).castVote(0);
      await ballot.connect(v2).castVote(2);
      await ballot.connect(v3).castVote(2);
      await ballot.connect(v4).castVote(1);
      await ballot.closeVoting();

      const events = await ballot.queryFilter(ballot.filters.VoteCast());
      const recount = [0n, 0n, 0n];
      for (const e of events) recount[Number(e.args.candidateId)] += 1n;

      expect(events).to.have.length(4);
      expect(recount).to.deep.equal(await ballot.getTally());
    });

    it("each wallet appears in the VoteCast log at most once", async function () {
      const { ballot, admin, voter1, voter2 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(voter1).castVote(0);
      await expect(ballot.connect(voter1).castVote(0)).to.be.reverted;
      await ballot.connect(voter2).castVote(1);

      const events = await ballot.queryFilter(ballot.filters.VoteCast());
      const voters = events.map((e) => e.args.voter);
      expect(new Set(voters).size).to.equal(voters.length);
    });

    it("VoteCast can be filtered by voter address (the voter is an indexed field)", async function () {
      const { ballot, admin, voter1, voter2 } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(voter1).castVote(0);
      await ballot.connect(voter2).castVote(1);

      const mine = await ballot.queryFilter(ballot.filters.VoteCast(voter2.address));
      expect(mine).to.have.length(1);
      expect(mine[0].args.candidateId).to.equal(1n);
    });

    it("a failed vote emits no VoteCast event", async function () {
      const { ballot, admin, outsider } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(outsider).castVote(0)).to.be.reverted;
      expect(await ballot.queryFilter(ballot.filters.VoteCast())).to.have.length(0);
    });
  });

  describe("registry timing (documents current behavior)", function () {
    // The docs say nobody can change the rules mid-election (CR-04) but also that the
    // election's admin manages the voter list (CR-02), and they do not say whether the list may
    // change once voting has started. The registry has no knowledge of the ballot's state, so
    // today the answer is "yes, it can". These tests pin that down. If the team decides to lock
    // the list at open time, these are the tests that should start failing.

    it("a voter registered while the election is Open can vote", async function () {
      const { ballot, registry, admin, outsider } = await deployFixture();
      await ballot.connect(admin).openVoting();

      await expect(ballot.connect(outsider).castVote(0)).to.be.reverted; // not yet registered
      await registry.connect(admin).registerVoters([outsider.address]);
      await expect(ballot.connect(outsider).castVote(0))
        .to.emit(ballot, "VoteCast")
        .withArgs(outsider.address, 0);
    });

    it("a voter registered after the election is Closed still cannot vote", async function () {
      const { ballot, registry, admin, outsider } = await deployFixture();
      await ballot.connect(admin).openVoting();
      await ballot.connect(admin).closeVoting();
      await registry.connect(admin).registerVoters([outsider.address]);
      await expect(ballot.connect(outsider).castVote(0)).to.be.revertedWith(
        "VeraTally: voting is not open"
      );
    });

    it("a voter registered during Draft can vote once the election opens", async function () {
      const { ballot, registry, admin, outsider } = await deployFixture();
      await registry.connect(admin).registerVoters([outsider.address]);
      await ballot.connect(admin).openVoting();
      await expect(ballot.connect(outsider).castVote(1)).to.emit(ballot, "VoteCast");
    });
  });

  describe("isolation between elections (additional cases)", function () {
    it("the admin of the registry has no power over a ballot that uses it", async function () {
      // Registry admin is `voter1`; ballot admin is `admin`.
      const [admin, voter1, voter2] = await ethers.getSigners();
      const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
      const registry = await VoterRegistry.connect(voter1).deploy(voter1.address);
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      const ballot = await ElectionBallot.connect(admin).deploy("Split Admins", CANDIDATES, await registry.getAddress(), admin.address);

      expect(await registry.admin()).to.equal(voter1.address);
      expect(await ballot.admin()).to.equal(admin.address);

      await expect(ballot.connect(voter1).openVoting()).to.be.revertedWith("VeraTally: caller is not admin");
      // ...and the ballot's admin cannot edit the registry's list.
      await expect(registry.connect(admin).registerVoters([voter2.address])).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
    });

    it("two ballots sharing one registry keep separate votes, tallies and states", async function () {
      const { ballot, registry, admin, voter1, voter2 } = await deployFixture();
      const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
      const second = await ElectionBallot.connect(admin).deploy("Second", ["X", "Y"], await registry.getAddress(), admin.address);

      await ballot.connect(admin).openVoting();
      await second.connect(admin).openVoting();

      // Voting in one election does not use up the voter's ballot in the other.
      await ballot.connect(voter1).castVote(0);
      expect(await ballot.hasVoted(voter1.address)).to.equal(true);
      expect(await second.hasVoted(voter1.address)).to.equal(false);
      await second.connect(voter1).castVote(1);

      await second.connect(voter2).castVote(1);
      expect(await ballot.getTally()).to.deep.equal([1n, 0n]);
      expect(await second.getTally()).to.deep.equal([0n, 2n]);

      // Closing one does not close the other.
      await ballot.connect(admin).closeVoting();
      expect(await ballot.state()).to.equal(2);
      expect(await second.state()).to.equal(1);
    });
  });
});
