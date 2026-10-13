// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VoterRegistry} from "./VoterRegistry.sol";
import {ElectionBallot} from "./ElectionBallot.sol";

/// @title ElectionFactory
/// @notice Lets anyone create their own election: one call deploys a fresh VoterRegistry and
///         ElectionBallot pair and makes the caller the sole admin of both.
/// @dev Increment C. This is what makes VeraTally permissionless (CR-02): there is deliberately
///      no owner, no system admin, no pause switch and no way to touch an election after
///      creating it (OOS-14). Whoever deploys this factory has exactly the same powers as any
///      other caller - none over elections they did not create. The factory only keeps an
///      index of what was created so a frontend can list elections; every real rule lives in
///      the ballot and registry it deploys, which are themselves immutable (CR-04).
///
///      The new contracts take their admin as a constructor argument. Inside this function
///      msg.sender of the constructors would be the factory itself, so the creator's address is
///      passed in explicitly instead.
contract ElectionFactory {
    struct ElectionRecord {
        address creator;
        address registry;
        address ballot;
    }

    ElectionRecord[] private _elections;
    mapping(address => uint256[]) private _electionIdsByCreator;

    /// @notice Emitted once per election created. Everything needed to find and display the
    ///         election is here, so an indexer or frontend can discover elections from events
    ///         alone (CR-03).
    event ElectionCreated(
        uint256 indexed electionId,
        address indexed creator,
        address registry,
        address ballot,
        string title
    );

    /// @notice Creates a new election in the Draft state, with an empty voter list.
    /// @dev The caller then manages it directly: registerVoters on the registry, and
    ///      openVoting/closeVoting on the ballot. Reverts with the ballot's own message if the
    ///      candidate list is invalid (fewer than two candidates).
    /// @param title Election title shown in the UI.
    /// @param candidates Candidate names, in display/index order. Must be at least 2.
    /// @return electionId Position of the new election in this factory's list.
    /// @return registry Address of the new election's VoterRegistry.
    /// @return ballot Address of the new election's ElectionBallot.
    function createElection(string memory title, string[] memory candidates)
        external
        returns (uint256 electionId, address registry, address ballot)
    {
        VoterRegistry newRegistry = new VoterRegistry(msg.sender);
        ElectionBallot newBallot = new ElectionBallot(title, candidates, address(newRegistry), msg.sender);
        newRegistry.linkBallot(address(newBallot));

        electionId = _elections.length;
        registry = address(newRegistry);
        ballot = address(newBallot);

        _elections.push(ElectionRecord({creator: msg.sender, registry: registry, ballot: ballot}));
        _electionIdsByCreator[msg.sender].push(electionId);

        emit ElectionCreated(electionId, msg.sender, registry, ballot, title);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Total number of elections ever created through this factory.
    function electionCount() external view returns (uint256) {
        return _elections.length;
    }

    /// @notice Looks up one election by its id (0, 1, 2, ... in creation order).
    function getElection(uint256 electionId)
        external
        view
        returns (address creator, address registry, address ballot)
    {
        require(electionId < _elections.length, "VeraTally: unknown election");
        ElectionRecord storage record = _elections[electionId];
        return (record.creator, record.registry, record.ballot);
    }

    /// @notice Ids of every election created by `creator`, oldest first.
    function getElectionIdsByCreator(address creator) external view returns (uint256[] memory) {
        return _electionIdsByCreator[creator];
    }
}
