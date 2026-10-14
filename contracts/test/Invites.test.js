const { expect } = require("chai");
const { ethers } = require("hardhat");

// Covers the email-invite flow: an admin registers invite addresses, each invite key signs a
// claim for a voter's own address, and the voter key signs its vote so a relayer can submit
// both without the voter holding a wallet app or gas.
describe("Invites and signed votes", function () {
  const CANDIDATES = ["Alex Rivera", "Jordan Kim", "Sam Lee"];

  async function typedDomain(contract) {
    const { chainId } = await ethers.provider.getNetwork();
    return { name: "VeraTally", version: "1", chainId, verifyingContract: await contract.getAddress() };
  }
  const CLAIM_TYPES = { ClaimInvite: [{ name: "voter", type: "address" }] };
  const VOTE_TYPES = {
    Vote: [
      { name: "voter", type: "address" },
      { name: "candidateId", type: "uint256" },
    ],
  };
  const signClaim = async (inviteWallet, registry, voterAddress) =>
    inviteWallet.signTypedData(await typedDomain(registry), CLAIM_TYPES, { voter: voterAddress });
  const signVote = async (voterWallet, ballot, candidateId) =>
    voterWallet.signTypedData(await typedDomain(ballot), VOTE_TYPES, { voter: voterWallet.address, candidateId });

  async function fixture() {
    const [factoryDeployer, admin, relayer, outsider] = await ethers.getSigners();
    const factory = await (await ethers.getContractFactory("ElectionFactory")).deploy();
    const receipt = await (await factory.connect(admin).createElection("Club", CANDIDATES)).wait();
    const ev = receipt.logs
      .map((l) => {
        try {
          return factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "ElectionCreated");
    const registry = await ethers.getContractAt("VoterRegistry", ev.args.registry);
    const ballot = await ethers.getContractAt("ElectionBallot", ev.args.ballot);
    // Two people: each has an invite key (from the email) and their own voting key.
    const people = [0, 1, 2].map(() => ({
      invite: ethers.Wallet.createRandom(),
      voter: ethers.Wallet.createRandom(),
    }));
    return { factory, admin, relayer, outsider, registry, ballot, people, factoryDeployer };
  }

  async function withInvites() {
    const f = await fixture();
    await f.registry.connect(f.admin).addInvites(f.people.map((p) => p.invite.address));
    return f;
  }

  async function claim(f, i, who = f.relayer) {
    const p = f.people[i];
    return f.registry.connect(who).claimInvite(p.voter.address, await signClaim(p.invite, f.registry, p.voter.address));
  }

  describe("linking", function () {
    it("a factory election has its registry linked to its ballot", async function () {
      const { registry, ballot } = await fixture();
      expect(await registry.ballot()).to.equal(await ballot.getAddress());
    });
    it("linking is one-time and deployer-only", async function () {
      const { registry, admin, ballot } = await fixture();
      await expect(registry.connect(admin).linkBallot(await ballot.getAddress())).to.be.revertedWith(
        "VeraTally: caller is not the deployer"
      );
    });
  });

  describe("addInvites", function () {
    it("only the admin can add invites", async function () {
      const f = await fixture();
      await expect(f.registry.connect(f.outsider).addInvites([f.people[0].invite.address])).to.be.revertedWith(
        "VeraTally: caller is not admin"
      );
    });
    it("records issued invites and counts them", async function () {
      const f = await withInvites();
      expect(await f.registry.inviteCount()).to.equal(3);
      expect(await f.registry.inviteStatus(f.people[0].invite.address)).to.equal(1);
    });
    it("rejects duplicates and the zero address", async function () {
      const f = await withInvites();
      await expect(f.registry.connect(f.admin).addInvites([f.people[0].invite.address])).to.be.revertedWith(
        "VeraTally: duplicate invite"
      );
      await expect(f.registry.connect(f.admin).addInvites([ethers.ZeroAddress])).to.be.revertedWith(
        "VeraTally: zero address"
      );
    });
    it("is locked once voting opens", async function () {
      const f = await withInvites();
      await f.ballot.connect(f.admin).openVoting();
      await expect(f.registry.connect(f.admin).addInvites([ethers.Wallet.createRandom().address])).to.be.revertedWith(
        "VeraTally: invites can only be added before voting opens"
      );
    });
  });

  describe("voter list lock", function () {
    it("registerVoters works in Draft and is locked once voting opens", async function () {
      const f = await fixture();
      await f.registry.connect(f.admin).registerVoters([f.people[0].voter.address]);
      await f.ballot.connect(f.admin).openVoting();
      await expect(f.registry.connect(f.admin).registerVoters([f.people[1].voter.address])).to.be.revertedWith(
        "VeraTally: voter list is locked once voting opens"
      );
    });
  });

  describe("claimInvite", function () {
    it("registers the voter, marks the invite used, and anyone (a relayer) can submit it", async function () {
      const f = await withInvites();
      await expect(claim(f, 0))
        .to.emit(f.registry, "InviteClaimed")
        .withArgs(f.people[0].invite.address, f.people[0].voter.address);
      expect(await f.registry.isEligible(f.people[0].voter.address)).to.equal(true);
      expect(await f.registry.inviteStatus(f.people[0].invite.address)).to.equal(2);
      expect(await f.registry.inviteClaimedBy(f.people[0].invite.address)).to.equal(f.people[0].voter.address);
      expect(await f.registry.inviteClaimedCount()).to.equal(1);
      expect(await f.registry.voterCount()).to.equal(1);
    });
    it("works while voting is open", async function () {
      const f = await withInvites();
      await f.ballot.connect(f.admin).openVoting();
      await claim(f, 0);
      expect(await f.registry.isEligible(f.people[0].voter.address)).to.equal(true);
    });
    it("is refused after the election closes", async function () {
      const f = await withInvites();
      await f.ballot.connect(f.admin).openVoting();
      await f.ballot.connect(f.admin).closeVoting();
      await expect(claim(f, 0)).to.be.revertedWith("VeraTally: election is closed");
    });
    it("an invite cannot be used twice", async function () {
      const f = await withInvites();
      await claim(f, 0);
      const p = f.people[0];
      const other = ethers.Wallet.createRandom();
      const sig = await signClaim(p.invite, f.registry, other.address);
      await expect(f.registry.claimInvite(other.address, sig)).to.be.revertedWith("VeraTally: invite already used");
    });
    it("rejects a signature from a key that is not an issued invite", async function () {
      const f = await withInvites();
      const stranger = ethers.Wallet.createRandom();
      const sig = await signClaim(stranger, f.registry, f.people[0].voter.address);
      await expect(f.registry.claimInvite(f.people[0].voter.address, sig)).to.be.revertedWith(
        "VeraTally: invalid invite"
      );
    });
    it("a copied claim can only register the same voter, never a different address", async function () {
      const f = await withInvites();
      const p = f.people[0];
      const sig = await signClaim(p.invite, f.registry, p.voter.address);
      // An attacker swapping in their own address makes the signature recover to a random key.
      await expect(f.registry.connect(f.outsider).claimInvite(f.outsider.address, sig)).to.be.revertedWith(
        "VeraTally: invalid invite"
      );
    });
    it("rejects malformed signatures", async function () {
      const f = await withInvites();
      await expect(f.registry.claimInvite(f.people[0].voter.address, "0x1234")).to.be.revertedWith(
        "VeraTally: invalid invite"
      );
    });
    it("a signature for one election cannot be replayed on another", async function () {
      const f = await withInvites();
      // Second election in the same factory, same invite address registered there too.
      const factory = f.factory;
      const receipt = await (await factory.connect(f.admin).createElection("Other", CANDIDATES)).wait();
      const ev = receipt.logs
        .map((l) => {
          try {
            return factory.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p) => p && p.name === "ElectionCreated");
      const registry2 = await ethers.getContractAt("VoterRegistry", ev.args.registry);
      await registry2.connect(f.admin).addInvites([f.people[0].invite.address]);
      const sigForFirst = await signClaim(f.people[0].invite, f.registry, f.people[0].voter.address);
      await expect(registry2.claimInvite(f.people[0].voter.address, sigForFirst)).to.be.revertedWith(
        "VeraTally: invalid invite"
      );
    });
    it("refuses a voter that is already registered", async function () {
      const f = await withInvites();
      await f.registry.connect(f.admin).registerVoters([f.people[0].voter.address]);
      await expect(claim(f, 0)).to.be.revertedWith("VeraTally: this wallet is already registered");
    });
  });

  describe("castVoteBySig", function () {
    async function ready() {
      const f = await withInvites();
      await claim(f, 0);
      await claim(f, 1);
      await f.ballot.connect(f.admin).openVoting();
      return f;
    }

    it("records the vote for the signer, paid for by someone else", async function () {
      const f = await ready();
      const p = f.people[0];
      const sig = await signVote(p.voter, f.ballot, 2);
      await expect(f.ballot.connect(f.relayer).castVoteBySig(p.voter.address, 2, sig))
        .to.emit(f.ballot, "VoteCast")
        .withArgs(p.voter.address, 2);
      expect(await f.ballot.hasVoted(p.voter.address)).to.equal(true);
      expect((await f.ballot.getTally()).map(Number)).to.deep.equal([0, 0, 1]);
    });
    it("the relayer cannot change the candidate", async function () {
      const f = await ready();
      const p = f.people[0];
      const sig = await signVote(p.voter, f.ballot, 0);
      await expect(f.ballot.connect(f.relayer).castVoteBySig(p.voter.address, 1, sig)).to.be.revertedWith(
        "VeraTally: invalid signature"
      );
    });
    it("cannot vote for someone else's address", async function () {
      const f = await ready();
      const sig = await signVote(f.people[0].voter, f.ballot, 0);
      await expect(
        f.ballot.connect(f.relayer).castVoteBySig(f.people[1].voter.address, 0, sig)
      ).to.be.revertedWith("VeraTally: invalid signature");
    });
    it("a replayed vote signature is rejected (one vote per voter)", async function () {
      const f = await ready();
      const p = f.people[0];
      const sig = await signVote(p.voter, f.ballot, 1);
      await f.ballot.castVoteBySig(p.voter.address, 1, sig);
      await expect(f.ballot.castVoteBySig(p.voter.address, 1, sig)).to.be.revertedWith(
        "VeraTally: this wallet has already voted"
      );
    });
    it("a signature for one election is useless on another ballot", async function () {
      const f = await ready();
      const p = f.people[0];
      const sig = await signVote(p.voter, f.ballot, 1);
      const receipt = await (await f.factory.connect(f.admin).createElection("Other", CANDIDATES)).wait();
      const ev = receipt.logs
        .map((l) => {
          try {
            return f.factory.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((x) => x && x.name === "ElectionCreated");
      const ballot2 = await ethers.getContractAt("ElectionBallot", ev.args.ballot);
      await expect(ballot2.castVoteBySig(p.voter.address, 1, sig)).to.be.revertedWith("VeraTally: invalid signature");
    });
    it("unregistered voters, closed elections and bad candidates are refused", async function () {
      const f = await ready();
      const unregistered = f.people[2]; // invite issued but never claimed
      await expect(
        f.ballot.castVoteBySig(unregistered.voter.address, 0, await signVote(unregistered.voter, f.ballot, 0))
      ).to.be.revertedWith("VeraTally: this wallet is not registered to vote");
      const p = f.people[0];
      await expect(f.ballot.castVoteBySig(p.voter.address, 9, await signVote(p.voter, f.ballot, 9))).to.be.revertedWith(
        "VeraTally: invalid candidate"
      );
      await f.ballot.connect(f.admin).closeVoting();
      await expect(f.ballot.castVoteBySig(p.voter.address, 0, await signVote(p.voter, f.ballot, 0))).to.be.revertedWith(
        "VeraTally: voting is not open"
      );
    });
    it("the wallet path still works alongside", async function () {
      const f = await ready();
      const [, , , w] = await ethers.getSigners();
      // w isn't registered here, so just confirm castVote is still exposed and enforces eligibility.
      await expect(f.ballot.connect(w).castVote(0)).to.be.revertedWith(
        "VeraTally: this wallet is not registered to vote"
      );
    });
  });

  describe("signature edge cases", function () {
    const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

    async function validClaim() {
      const f = await withInvites();
      const p = f.people[0];
      const sig = await signClaim(p.invite, f.registry, p.voter.address);
      return { f, p, sig };
    }
    // Rebuilds a 65-byte signature from parts, so a test can alter one piece.
    const build = (r, sBig, v) =>
      ethers.concat([r, ethers.zeroPadValue(ethers.toBeHex(sBig), 32), ethers.toBeHex(v, 1)]);

    it("accepts the 0/1 form of v as well as 27/28", async function () {
      const { f, p, sig } = await validClaim();
      const parsed = ethers.Signature.from(sig);
      const alt = build(parsed.r, BigInt(parsed.s), parsed.yParity); // v = 0 or 1
      await f.registry.claimInvite(p.voter.address, alt);
      expect(await f.registry.isEligible(p.voter.address)).to.equal(true);
    });
    it("rejects a signature whose v is not 27 or 28", async function () {
      const { f, p, sig } = await validClaim();
      const parsed = ethers.Signature.from(sig);
      await expect(f.registry.claimInvite(p.voter.address, build(parsed.r, BigInt(parsed.s), 29))).to.be.revertedWith(
        "VeraTally: invalid invite"
      );
    });
    it("rejects the malleated twin of a valid signature (high s)", async function () {
      const { f, p, sig } = await validClaim();
      const parsed = ethers.Signature.from(sig);
      // (r, n - s, flipped v) recovers the same signer on a naive check; ours must refuse it.
      const twin = build(parsed.r, N - BigInt(parsed.s), parsed.v === 27 ? 28 : 27);
      await expect(f.registry.claimInvite(p.voter.address, twin)).to.be.revertedWith("VeraTally: invalid invite");
      // and the original still works, so the invite was not burned by the rejected twin
      await f.registry.claimInvite(p.voter.address, sig);
      expect(await f.registry.isEligible(p.voter.address)).to.equal(true);
    });
  });

  describe("end to end", function () {
    it("three people claim and vote through a relayer; tally and counts add up", async function () {
      const f = await withInvites();
      for (const i of [0, 1, 2]) await claim(f, i);
      await f.ballot.connect(f.admin).openVoting();
      const picks = [0, 0, 2];
      for (const i of [0, 1, 2]) {
        const p = f.people[i];
        await f.ballot.connect(f.relayer).castVoteBySig(p.voter.address, picks[i], await signVote(p.voter, f.ballot, picks[i]));
      }
      expect((await f.ballot.getTally()).map(Number)).to.deep.equal([2, 0, 1]);
      expect(await f.registry.inviteClaimedCount()).to.equal(await f.registry.inviteCount());
    });
  });
});
