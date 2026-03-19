// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IZKVerifier
 * @notice Interface for a ZK proof verifier contract.
 *         ZKRollupPayments calls this to validate each batch before
 *         accepting a new state root commitment.
 */
interface IZKVerifier {
    /**
     * @param proof        Raw bytes of the ZK proof
     * @param publicInputs Public inputs the proof is computed against
     *                     (e.g. old state root, new state root, batch hash)
     * @return             True if the proof is valid, false otherwise
     */
    function verifyProof(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool);
}