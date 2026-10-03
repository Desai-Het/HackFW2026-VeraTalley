// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VoterRegistry
/// @notice Admin-managed allowlist of wallet addresses eligible to vote in one election.
/// @dev Increment B scope: deployed directly, standalone, with the deploying wallet as its
///      only admin (see CR-02 - no account has authority over an election/registry it didn't
///      create). Increment C wraps this behind ElectionFactory so each election gets its own
///      registry automatically; the eligibility model here doesn't change, only how it's
///      deployed. Voter identity itself is verified outside this system (OOS-04) - this
///      contract only enforces that a listed wallet can vote once.
contract VoterRegistry {
    address public immutable admin;

    mapping(address => bool) public isEligible;
    uint256 public voterCount;

    event VoterRegistered(address indexed voter);

    modifier onlyAdmin() {
        require(msg.sender == admin, "VeraTally: caller is not admin");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /// @notice Adds one or more wallet addresses to the allowlist. Already-registered addresses
    ///         are silently skipped (idempotent), so re-submitting a list is safe.
    function registerVoters(address[] calldata voters) external onlyAdmin {
        for (uint256 i = 0; i < voters.length; i++) {
            address voter = voters[i];
            require(voter != address(0), "VeraTally: zero address");
            if (isEligible[voter]) continue;
            isEligible[voter] = true;
            voterCount++;
            emit VoterRegistered(voter);
        }
    }
}
