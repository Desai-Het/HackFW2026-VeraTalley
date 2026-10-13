// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SignatureLib} from "./SignatureLib.sol";

interface IBallotState {
    /// @dev 0 = Draft, 1 = Open, 2 = Closed (matches ElectionBallot.State).
    function state() external view returns (uint8);
}

/// @title VoterRegistry
/// @notice Admin-managed allowlist of wallet addresses eligible to vote in one election.
/// @dev The admin is passed in at construction instead of being taken from msg.sender, so that
///      ElectionFactory (Increment C) can deploy a registry on behalf of the wallet that called
///      createElection: that wallet becomes the sole admin, and the factory itself holds no
///      authority over it (CR-02). Deploying a registry directly still works - just pass your
///      own address. The eligibility model is unchanged. Voter identity itself is verified
///      outside this system (OOS-04) - this contract only enforces that a listed wallet can
///      vote once.
contract VoterRegistry {
    bytes32 public constant CLAIM_TYPEHASH = keccak256("ClaimInvite(address voter)");

    address public immutable admin;
    /// @notice Whoever deployed this registry (the factory, for factory elections). Its only
    ///         power is to link the ballot once, so the registry can tell when voting starts.
    address public immutable deployer;
    /// @notice The ballot this registry belongs to. Zero until linked, in which case the
    ///         registry behaves as a plain allowlist with no locking.
    address public ballot;

    mapping(address => bool) public isEligible;
    uint256 public voterCount;

    /// @notice Invite status per invite address: 0 = unknown, 1 = issued, 2 = claimed.
    mapping(address => uint8) public inviteStatus;
    mapping(address => address) public inviteClaimedBy;
    uint256 public inviteCount;
    uint256 public inviteClaimedCount;

    event VoterRegistered(address indexed voter);
    event BallotLinked(address indexed ballot);
    event InviteAdded(address indexed invite);
    event InviteClaimed(address indexed invite, address indexed voter);

    modifier onlyAdmin() {
        require(msg.sender == admin, "VeraTally: caller is not admin");
        _;
    }

    /// @param _admin The only wallet allowed to register voters. Cannot be the zero address and
    ///        cannot be changed later.
    constructor(address _admin) {
        require(_admin != address(0), "VeraTally: zero address");
        admin = _admin;
        deployer = msg.sender;
    }

    /// @notice Links this registry to its ballot. One time only, only by the deployer.
    function linkBallot(address _ballot) external {
        require(msg.sender == deployer, "VeraTally: caller is not the deployer");
        require(ballot == address(0), "VeraTally: ballot already linked");
        require(_ballot != address(0), "VeraTally: zero address");
        ballot = _ballot;
        emit BallotLinked(_ballot);
    }

    function _ballotState() private view returns (uint8) {
        return ballot == address(0) ? 0 : IBallotState(ballot).state();
    }

    /// @notice Adds one or more wallet addresses to the allowlist. Already-registered addresses
    ///         are silently skipped (idempotent), so re-submitting a list is safe.
    ///         Only possible while the election is in Draft: once voting opens the voter list is
    ///         frozen, so the admin cannot add voters after seeing how the vote is going.
    function registerVoters(address[] calldata voters) external onlyAdmin {
        require(_ballotState() == 0, "VeraTally: voter list is locked once voting opens");
        for (uint256 i = 0; i < voters.length; i++) {
            address voter = voters[i];
            require(voter != address(0), "VeraTally: zero address");
            if (isEligible[voter]) continue;
            isEligible[voter] = true;
            voterCount++;
            emit VoterRegistered(voter);
        }
    }

    // ---------------------------------------------------------------------
    // Invites (email magic links)
    // ---------------------------------------------------------------------

    /// @notice Registers invites. Each invite is the public address of a secret key that is
    ///         sent to one person (a magic link). Only the address goes on-chain, never the
    ///         secret. Draft only, same as registerVoters.
    function addInvites(address[] calldata invites) external onlyAdmin {
        require(_ballotState() == 0, "VeraTally: invites can only be added before voting opens");
        for (uint256 i = 0; i < invites.length; i++) {
            address invite = invites[i];
            require(invite != address(0), "VeraTally: zero address");
            require(inviteStatus[invite] == 0, "VeraTally: duplicate invite");
            inviteStatus[invite] = 1;
            inviteCount++;
            emit InviteAdded(invite);
        }
    }

    /// @notice Turns one unused invite into one eligible voter. `sig` must be the invite key's
    ///         EIP-712 signature over ClaimInvite(voter). Anyone may submit it (a relayer pays
    ///         the gas); a copied transaction can only register the same voter, never another.
    ///         Allowed while the election is Draft or Open, not after it closes.
    function claimInvite(address voter, bytes calldata sig) external {
        require(_ballotState() != 2, "VeraTally: election is closed");
        require(voter != address(0), "VeraTally: zero address");
        require(!isEligible[voter], "VeraTally: this wallet is already registered");

        address invite = SignatureLib.recover(address(this), keccak256(abi.encode(CLAIM_TYPEHASH, voter)), sig);
        require(invite != address(0) && inviteStatus[invite] != 0, "VeraTally: invalid invite");
        require(inviteStatus[invite] == 1, "VeraTally: invite already used");

        inviteStatus[invite] = 2;
        inviteClaimedBy[invite] = voter;
        inviteClaimedCount++;
        isEligible[voter] = true;
        voterCount++;
        emit InviteClaimed(invite, voter);
        emit VoterRegistered(voter);
    }
}
