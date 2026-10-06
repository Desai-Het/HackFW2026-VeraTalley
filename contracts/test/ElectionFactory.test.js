const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("ElectionFactory", function () {
  const CANDIDATES = ["Alex Rivera", "Jordan Kim"];

  async function deployFixture() {
    const [factoryDeployer, alice, bob, voter1, voter2, outsider] = await ethers.getSigners();
    const ElectionFactory = await ethers.getContractFactory("ElectionFactory");
    const factory = await ElectionFactory.connect(factoryDeployer).deploy();
    return { factory, factoryDeployer, alice, bob, voter1, voter2, outsider };
  }

  // Creates an election as `creator` and returns handles to the new contracts, the election id
  // and the emitted event, read back from the transaction's logs the way a frontend would.
  async function createElectionAs(factory, creator, title = "Test Election", candidates = CANDIDATES) {
    const tx = await factory.connect(creator).createElection(title, candidates);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "ElectionCreated");
    const registry = await ethers.getContractAt("VoterRegistry", event.args.registry);
    const ballot = await ethers.getContractAt("ElectionBallot", event.args.ballot);
    return { id: event.args.electionId, registry, ballot, event };
  }

  describe("creating an election", function () {
    it("starts with no elections", async function () {
      const { factory, alice } = await deployFixture();
      expect(await factory.electionCount()).to.equal(0);
      expect(await factory.getElectionIdsByCreator(alice.address)).to.deep.equal([]);
    });

    it("lets anyone create an election - no registration or permission needed", async function () {
      const { factory, outsider } = await deployFixture();
      const { ballot } = await createElectionAs(factory, outsider);
      expect(await factory.electionCount()).to.equal(1);
      expect(await ballot.title()).to.equal("Test Election");
    });

    it("emits ElectionCreated with the id, the creator and the title", async function () {
      const { factory, alice } = await deployFixture();
      await expect(factory.connect(alice).createElection("Club President", CANDIDATES))
        .to.emit(factory, "ElectionCreated")
        .withArgs(0, alice.address, anyValue, anyValue, "Club President");
    });

    it("returns the same id and addresses that it records", async function () {
      const { factory, alice } = await deployFixture();
      const [id, registryAddr, ballotAddr] = await factory.connect(alice).createElection.staticCall("Preview", CANDIDATES);
      await factory.connect(alice).createElection("Preview", CANDIDATES);

      expect(id).to.equal(0n);
      const [creator, registry, ballot] = await factory.getElection(0);
      expect(creator).to.equal(alice.address);
      expect(registry).to.equal(registryAddr);
      expect(ballot).to.equal(ballotAddr);
    });

    it("creates the ballot in Draft with the given title and candidates and an empty tally", async function () {
      const { factory, alice } = await deployFixture();
      const { ballot } = await createElectionAs(factory, alice, "Student Government President");
      expect(await ballot.title()).to.equal("Student Government President");
      expect(await ballot.getCandidates()).to.deep.equal(CANDIDATES);
      expect(await ballot.state()).to.equal(0); // Draft
      expect(await ballot.getTally()).to.deep.equal([0n, 0n]);
    });

    it("wires the new ballot to the registry created in the same call", async function () {
      const { factory, alice } = await deployFixture();
      const { ballot, registry } = await createElectionAs(factory, alice);
      expect(await ballot.voterRegistry()).to.equal(await registry.getAddress());
    });

    it("creates an empty voter list", async function () {
      const { factory, alice } = await deployFixture();
      const { registry } = await createElectionAs(factory, alice);
      expect(await registry.voterCount()).to.equal(0);
    });

    it("makes the caller - not the factory - the admin of both new contracts", async function () {
      const { factory, alice } = await deployFixture();
      const { ballot, registry } = await createElectionAs(factory, alice);

      expect(await ballot.admin()).to.equal(alice.address);
      expect(await registry.admin()).to.equal(alice.address);
      expect(await ballot.admin()).to.not.equal(await factory.getAddress());
      expect(await registry.admin()).to.not.equal(await factory.getAddress());
    });

    it("rejects a candidate list with fewer than two candidates, and records nothing", async function () {
      const { factory, alice } = await deployFixture();
      await expect(factory.connect(alice).createElection("Too few", ["Only One"])).to.be.revertedWith(
        "VeraTally: need at least two candidates"
      );
      await expect(factory.connect(alice).createElection("None at all", [])).to.be.revertedWith(
        "VeraTally: need at least two candidates"
      );
      expect(await factory.electionCount()).to.equal(0);
      expect(await factory.getElectionIdsByCreator(alice.address)).to.deep.equal([]);
    });
  });

  describe("the creator runs the election", function () {
    it("supports a full lifecycle: register voters, open, vote, close", async function () {
      const { factory, alice, voter1, voter2, outsider } = await deployFixture();
      const { ballot, registry } = await createElectionAs(factory, alice);

      await registry.connect(alice).registerVoters([voter1.address, voter2.address]);
      await expect(ballot.connect(alice).openVoting()).to.emit(ballot, "VotingOpened");

      await ballot.connect(voter1).castVote(0);
      await ballot.connect(voter2).castVote(1);
      await expect(ballot.connect(outsider).castVote(0)).to.be.revertedWith(
        "VeraTally: this wallet is not registered to vote"
      );
      await expect(ballot.connect(voter1).castVote(1)).to.be.revertedWith(
        "VeraTally: this wallet has already voted"
      );

      await expect(ballot.connect(alice).closeVoting()).to.emit(ballot, "VotingClosed");
      expect(await ballot.getTally()).to.deep.equal([1n, 1n]);
    });
  });

  describe("nobody has authority over an election they did not create (CR-02, OOS-14)", function () {
    it("the wallet that deployed the factory has no power over anyone's election", async function () {
      const { factory, factoryDeployer, alice, voter1 } = await deployFixture();
      const { ballot, registry } = await createElectionAs(factory, alice);

      await expect(registry.connect(factoryDeployer).registerVoters([voter1.address])).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
      await expect(ballot.connect(factoryDeployer).openVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
      await ballot.connect(alice).openVoting();
      await expect(ballot.connect(factoryDeployer).closeVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
    });

    it("one creator has no power over another creator's election", async function () {
      const { factory, alice, bob, voter1 } = await deployFixture();
      const aliceElection = await createElectionAs(factory, alice, "Alice's election");
      const bobElection = await createElectionAs(factory, bob, "Bob's election");

      await expect(aliceElection.registry.connect(bob).registerVoters([voter1.address])).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
      await expect(aliceElection.ballot.connect(bob).openVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
      await expect(bobElection.ballot.connect(alice).openVoting()).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
      // ...while each keeps full control of their own.
      await expect(aliceElection.ballot.connect(alice).openVoting()).to.emit(aliceElection.ballot, "VotingOpened");
      await expect(bobElection.ballot.connect(bob).openVoting()).to.emit(bobElection.ballot, "VotingOpened");
    });

    it("the factory has no owner, no admin and no function that changes an election after creation", async function () {
      const { factory } = await deployFixture();
      const writeFunctions = factory.interface.fragments
        .filter((f) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f) => f.name);
      expect(writeFunctions).to.deep.equal(["createElection"]);

      const allNames = factory.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
      expect(allNames.some((n) => /^(owner|admin|pause|upgrade|transferOwnership)/i.test(n))).to.equal(false);
    });
  });

  describe("keeping track of elections", function () {
    it("numbers elections in creation order, each with its own registry and ballot", async function () {
      const { factory, alice, bob } = await deployFixture();
      const first = await createElectionAs(factory, alice, "First");
      const second = await createElectionAs(factory, bob, "Second");
      const third = await createElectionAs(factory, alice, "Third");

      expect([first.id, second.id, third.id]).to.deep.equal([0n, 1n, 2n]);
      expect(await factory.electionCount()).to.equal(3);

      const addresses = [first, second, third].flatMap((e) => [e.registry.target, e.ballot.target]);
      expect(new Set(addresses).size).to.equal(6);
    });

    it("getElection returns the creator and both addresses", async function () {
      const { factory, alice, bob } = await deployFixture();
      await createElectionAs(factory, alice, "First");
      const second = await createElectionAs(factory, bob, "Second");

      const [creator, registry, ballot] = await factory.getElection(1);
      expect(creator).to.equal(bob.address);
      expect(registry).to.equal(await second.registry.getAddress());
      expect(ballot).to.equal(await second.ballot.getAddress());
    });

    it("getElection rejects an id that doesn't exist yet", async function () {
      const { factory, alice } = await deployFixture();
      await expect(factory.getElection(0)).to.be.revertedWith("VeraTally: unknown election");
      await createElectionAs(factory, alice);
      await expect(factory.getElection(1)).to.be.revertedWith("VeraTally: unknown election");
      await expect(factory.getElection(ethers.MaxUint256)).to.be.revertedWith("VeraTally: unknown election");
      await expect(factory.getElection(0)).to.not.be.reverted;
    });

    it("lists each creator's own election ids, oldest first", async function () {
      const { factory, alice, bob, outsider } = await deployFixture();
      await createElectionAs(factory, alice); // 0
      await createElectionAs(factory, bob); // 1
      await createElectionAs(factory, alice); // 2
      await createElectionAs(factory, alice); // 3

      expect(await factory.getElectionIdsByCreator(alice.address)).to.deep.equal([0n, 2n, 3n]);
      expect(await factory.getElectionIdsByCreator(bob.address)).to.deep.equal([1n]);
      expect(await factory.getElectionIdsByCreator(outsider.address)).to.deep.equal([]);
    });

    it("elections from the same creator are fully independent of each other", async function () {
      const { factory, alice, voter1 } = await deployFixture();
      const first = await createElectionAs(factory, alice, "First");
      const second = await createElectionAs(factory, alice, "Second");

      // A voter registered in one election is not eligible in the other...
      await first.registry.connect(alice).registerVoters([voter1.address]);
      expect(await first.registry.isEligible(voter1.address)).to.equal(true);
      expect(await second.registry.isEligible(voter1.address)).to.equal(false);

      // ...and voting in one does not use up their vote in the other.
      await second.registry.connect(alice).registerVoters([voter1.address]);
      await first.ballot.connect(alice).openVoting();
      await second.ballot.connect(alice).openVoting();
      await first.ballot.connect(voter1).castVote(0);
      expect(await second.ballot.hasVoted(voter1.address)).to.equal(false);
      await second.ballot.connect(voter1).castVote(1);

      expect(await first.ballot.getTally()).to.deep.equal([1n, 0n]);
      expect(await second.ballot.getTally()).to.deep.equal([0n, 1n]);
    });

    it("every election can be discovered from ElectionCreated events alone (CR-03)", async function () {
      const { factory, alice, bob } = await deployFixture();
      await createElectionAs(factory, alice, "Alice one");
      const bobs = await createElectionAs(factory, bob, "Bob one");
      await createElectionAs(factory, alice, "Alice two");

      const all = await factory.queryFilter(factory.filters.ElectionCreated());
      expect(all).to.have.length(Number(await factory.electionCount()));

      const aliceEvents = await factory.queryFilter(factory.filters.ElectionCreated(null, alice.address));
      expect(aliceEvents.map((e) => e.args.title)).to.deep.equal(["Alice one", "Alice two"]);

      const bobEvents = await factory.queryFilter(factory.filters.ElectionCreated(null, bob.address));
      expect(bobEvents).to.have.length(1);
      expect(bobEvents[0].args.ballot).to.equal(await bobs.ballot.getAddress());
    });

    it("a failed creation emits no event", async function () {
      const { factory, alice } = await deployFixture();
      await expect(factory.connect(alice).createElection("Too few", ["Only One"])).to.be.reverted;
      expect(await factory.queryFilter(factory.filters.ElectionCreated())).to.have.length(0);
    });

    it("two factories keep completely separate lists", async function () {
      const { factory, alice } = await deployFixture();
      const ElectionFactory = await ethers.getContractFactory("ElectionFactory");
      const otherFactory = await ElectionFactory.deploy();

      await createElectionAs(factory, alice);
      expect(await factory.electionCount()).to.equal(1);
      expect(await otherFactory.electionCount()).to.equal(0);
      expect(await otherFactory.getElectionIdsByCreator(alice.address)).to.deep.equal([]);
    });
  });
});
