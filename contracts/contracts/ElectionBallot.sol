// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VoterRegistry} from "./VoterRegistry.sol";

/// @title ElectionBallot
/// @notice A single-contest, single-choice election: one allowlisted wallet, one vote.
/// @dev Increment B scope (see docs/sprints/sprint-01). Deliberately out of scope here, per the
///      hackathon requirements doc: ballot secrecy (OOS-01 - votes are public and linked to the
///      voting wallet), ranked/approval/cumulative voting (OOS-02), and multiple contests
///      (OOS-03). Every state change and vote emits an event so the frontend (and, later, the
///      public verification page in Increment D) can rebuild the full tally from on-chain events
///      alone (CR-03), without trusting this contract's storage reads from any one RPC provider.
///      Immutable once deployed: no proxy, no upgrade path, no pause/override function (CR-04) -
///      nobody, including the admin, can change the rules mid-election.
contract ElectionBallot {
    enum State {
        Draft,
        Open,
        Closed
    }

    address public immutable admin;
    VoterRegistry public immutable voterRegistry;
    string public title;
    string[] public candidates;

    State public state;
    mapping(uint256 => uint256) public voteCounts;
    mapping(address => bool) public hasVoted;

    event VotingOpened();
    event VotingClosed();
    event VoteCast(address indexed voter, uint256 indexed candidateId);

    modifier onlyAdmin() {
        require(msg.sender == admin, "VeraTally: caller is not admin");
        _;
    }

    /// @param _title Election title shown in the UI.
    /// @param _candidates Candidate names, in display/index order. Must be at least 2.
    /// @param _voterRegistry Address of this election's VoterRegistry.
    /// @param _admin The only wallet allowed to open and close this election. Passed in (rather
    ///        than taken from msg.sender) so ElectionFactory can deploy a ballot on behalf of
    ///        the wallet that called createElection (CR-02). Cannot be the zero address and
    ///        cannot be changed later.
    constructor(string memory _title, string[] memory _candidates, address _voterRegistry, address _admin) {
        require(_candidates.length >= 2, "VeraTally: need at least two candidates");
        require(_voterRegistry != address(0), "VeraTally: zero address");
        require(_admin != address(0), "VeraTally: zero address");

        admin = _admin;
        title = _title;
        for (uint256 i = 0; i < _candidates.length; i++) {
            candidates.push(_candidates[i]);
        }
        voterRegistry = VoterRegistry(_voterRegistry);
        state = State.Draft;
    }

    /// @notice Moves the election from Draft to Open. Only possible once, only by the admin.
    function openVoting() external onlyAdmin {
        require(state == State.Draft, "VeraTally: election must be in Draft to open");
        state = State.Open;
        emit VotingOpened();
    }

    /// @notice Moves the election from Open to Closed. Only possible once, only by the admin.
    function closeVoting() external onlyAdmin {
        require(state == State.Open, "VeraTally: election must be Open to close");
        state = State.Closed;
        emit VotingClosed();
    }

    /// @notice Casts one vote for `candidateId`. Reverts with a specific, UI-friendly reason if
    ///         voting isn't open, the caller isn't on the allowlist, or the caller already voted.
    function castVote(uint256 candidateId) external {
        require(state == State.Open, "VeraTally: voting is not open");
        require(voterRegistry.isEligible(msg.sender), "VeraTally: this wallet is not registered to vote");
        require(!hasVoted[msg.sender], "VeraTally: this wallet has already voted");
        require(candidateId < candidates.length, "VeraTally: invalid candidate");

        hasVoted[msg.sender] = true;
        voteCounts[candidateId] += 1;

        emit VoteCast(msg.sender, candidateId);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getCandidates() external view returns (string[] memory) {
        return candidates;
    }

    function candidateCount() external view returns (uint256) {
        return candidates.length;
    }

    /// @notice Full live tally, in candidate index order.
    function getTally() external view returns (uint256[] memory) {
        uint256[] memory tally = new uint256[](candidates.length);
        for (uint256 i = 0; i < candidates.length; i++) {
            tally[i] = voteCounts[i];
        }
        return tally;
    }
}
