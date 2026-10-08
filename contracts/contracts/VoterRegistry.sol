// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
    address public immutable admin;

    mapping(address => bool) public isEligible;
    uint256 public voterCount;

    event VoterRegistered(address indexed voter);

    modifier onlyAdmin() {
        require(msg.sender == admin, "VeraTally: caller is not admin");
        _;
    }

    /// @param _admin The only wallet allowed to register voters. Cannot be the zero address and
    ///        cannot be changed later.
    constructor(address _admin) {
        require(_admin != address(0), "VeraTally: zero address");
        admin = _admin;
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
