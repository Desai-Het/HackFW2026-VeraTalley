// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SignatureLib
/// @notice Minimal EIP-712 helpers shared by VoterRegistry and ElectionBallot. Kept in-repo
///         (about 30 lines) instead of pulling in a dependency for one function.
/// @dev The domain binds every signature to one contract on one chain, so a signature made for
///      election A can never be replayed on election B or on another network.
library SignatureLib {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function domainSeparator(address verifyingContract) internal view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("VeraTally"), keccak256("1"), block.chainid, verifyingContract)
        );
    }

    /// @dev Returns the signer of an EIP-712 typed-data hash, or address(0) if the signature is
    ///      malformed. Rejects high-s signatures so each signature has exactly one valid form.
    function recover(address verifyingContract, bytes32 structHash, bytes memory sig)
        internal
        view
        returns (address)
    {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(verifyingContract), structHash));
        return ecrecover(digest, v, r, s);
    }
}
