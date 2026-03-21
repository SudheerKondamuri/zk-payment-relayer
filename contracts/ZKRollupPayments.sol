// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IZKVerifier.sol";

/**
 * @title ZKRollupPayments
 * @notice Simplified ZK-Rollup payment contract.
 *
 *  Life-cycle:
 *  1. Users call deposit() to lock ETH as L2 collateral.
 *  2. Off-chain relayer batches payment intents and calls commitBatch()
 *     with the new state root + a ZK proof of valid execution.
 *  3. Users call withdraw() to reclaim ETH from the L1 escrow.
 *
 * @dev Uses a stub verifier during development.
 *      In production, replace StubZKVerifier with a real proof verifier.
 */
contract ZKRollupPayments is Ownable {

    // ─────────────────────────────────────────────────────────────
    //  State Variables
    // ─────────────────────────────────────────────────────────────

    /// @notice The ZK-proof verifier contract.
    /// set once in constructor, never changed — saves gas vs. a normal var.
    IZKVerifier public verifier;

    /// @notice Latest L2 state root accepted on-chain.
    bytes32 public currentStateRoot;

    /// @notice Total number of batches committed so far.
    uint256 public batchCount;

    /// @notice L1 collateral balances: user address → Wei locked in contract.
    mapping(address => uint256) public deposits;

    /// @notice Historical record of every committed batch.
    mapping(uint256 => BatchRecord) public batches;

    /// @notice Addresses allowed to call commitBatch().
    mapping(address => bool) public relayers;

    // ─────────────────────────────────────────────────────────────
    //  Struct
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Immutable on-chain record stored for every committed batch.
     * @param oldStateRoot  State root before this batch was applied.
     * @param newStateRoot  State root after this batch was applied.
     * @param batchHash     keccak256 of all intentIds in the batch.
     * @param txCount       Number of payment intents in this batch.
     * @param committedAt   block.timestamp when commitBatch was mined.
     * @param relayer       Address that submitted this batch.
     */
    struct BatchRecord {
        bytes32 oldStateRoot;
        bytes32 newStateRoot;
        bytes32 batchHash;
        uint256 txCount;
        uint256 committedAt;
        address relayer;
    }

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    /// @notice Emitted when a user deposits ETH into the rollup.
    event Deposited(
        address indexed user,
        uint256 amount,
        uint256 newBalance
    );

    /// @notice Emitted when a user withdraws ETH from the rollup.
    event Withdrawn(
        address indexed user,
        uint256 amount,
        uint256 newBalance
    );

    /// @notice Emitted when the relayer commits a new batch on-chain.
    event BatchCommitted(
        uint256 indexed batchIndex,
        bytes32 oldStateRoot,
        bytes32 newStateRoot,
        bytes32 batchHash,
        uint256 txCount,
        address indexed relayer
    );

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    /**
     * @param _verifier Address of the IZKVerifier contract to use.
     *                  Pass the StubZKVerifier address during development.
     */
    constructor(address _verifier) Ownable(msg.sender) {
        verifier = IZKVerifier(_verifier);
    }

    // ─────────────────────────────────────────────────────────────
    //  User Functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Deposit ETH into the rollup to fund your L2 balance.
     * @dev msg.value is added to deposits[msg.sender].
     *      Emits Deposited.
     */
    function deposit() external payable {
        require(msg.value > 0, "ZKRollup: zero deposit");

        deposits[msg.sender] += msg.value;

        emit Deposited(msg.sender, msg.value, deposits[msg.sender]);
    }

    /**
     * @notice Withdraw ETH from your L1 rollup balance back to your wallet.
     * @param amount Amount in Wei to withdraw.
     * @dev    Emits Withdrawn.
     */
    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "ZKRollup: insufficient balance");

        deposits[msg.sender] -= amount;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ZKRollup: transfer failed");
        

        emit Withdrawn(msg.sender, amount, deposits[msg.sender]);
    }

    // ─────────────────────────────────────────────────────────────
    //  Relayer Functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Submit a new batch commitment. Only whitelisted relayers may call this.
     * @param newStateRoot   The new L2 state root after applying the batch.
     * @param batchHash      keccak256 hash of all intentIds in the batch.
     * @param txCount        Number of intents in this batch.
     * @param proof          ZK proof bytes (empty for stub verifier).
     * @param publicInputs   Public inputs for the ZK verifier.
     */
    function commitBatch(
        bytes32 newStateRoot,
        bytes32 batchHash,
        uint256 txCount,
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external {
        require(relayers[msg.sender], "ZKRollup: not a relayer");
        require(
            verifier.verifyProof(proof, publicInputs),
            "ZKRollup: invalid proof"
        );


        bytes32 oldStateRoot = currentStateRoot;
        currentStateRoot = newStateRoot;
        

        batches[batchCount] = BatchRecord({
            oldStateRoot: oldStateRoot,
            newStateRoot: newStateRoot,
            batchHash: batchHash,
            txCount: txCount,
            committedAt: block.timestamp,
            relayer: msg.sender
        });

        batchCount++;

        emit BatchCommitted(
            batchCount - 1,
            oldStateRoot,
            newStateRoot,
            batchHash,
            txCount,
            msg.sender
        );
    }

    // ─────────────────────────────────────────────────────────────
    //  Owner / Admin Functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Whitelist an address to call commitBatch().
     * @param relayer The relayer address to add.
     */
    function addRelayer(address relayer) external onlyOwner {

        relayers[relayer] = true;
    }

    /**
     * @notice Remove a relayer from the whitelist.
     * @param relayer The relayer address to remove.
     */
    function removeRelayer(address relayer) external onlyOwner {
        relayers[relayer] = false;
    }

    // ─────────────────────────────────────────────────────────────
    //  View / Getter Functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Fetch a stored BatchRecord by its index.
     * @param index The batch index (0-based). Must be < batchCount.
     * @return The BatchRecord struct for that batch.
     */
    function getBatch(uint256 index) external view returns (BatchRecord memory) {
        require(index < batchCount, "ZKRollup: batch does not exist");
        return batches[index];
    }
}