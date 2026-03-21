// scripts/relay.js
// Core off-chain orchestrator. Reads payment intents, splits them into batches
// of up to 5, and for each batch calls commitBatch() on ZKRollupPayments.
// Writes a full summary report to logs/relay.json.

import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  getProvider,
  getContract,
  computeBatchHash,
  computeNewStateRoot,
  ROOT,
} from './utils/chain.js';

const BATCH_SIZE = 5; // Maximum intents per on-chain batch

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Split an array into chunks of at most `size` items.
 *   chunk([1,2,3,4,5,6,7], 3) → [[1,2,3],[4,5,6],[7]]
 */
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process a single batch: compute hashes, read current state root,
 * compute next state root, submit the on-chain transaction.
 *
 * @param {object[]} batchIntents  - intents in this batch
 * @param {number}   batchIndex    - 0-based position in the batch sequence
 * @param {Contract} rollup        - connected with the relayer signer
 * @returns {object} log entry for relay.json
 */
async function processBatch(batchIntents, batchIndex, rollup) {
  const intentIds = batchIntents.map(i => i.intentId);

  // 1. Commitment hashes (computed off-chain)
  const batchHash = computeBatchHash(intentIds);

  // 2. Read the CURRENT state root from the chain
  const currentStateRoot = await rollup.currentStateRoot();

  // 3. Derive the new state root off-chain
  const newStateRoot = computeNewStateRoot(currentStateRoot, batchHash);

  console.log(`\nBatch ${batchIndex} (${batchIntents.length} intents)`);
  console.log(`  currentStateRoot : ${currentStateRoot}`);
  console.log(`  batchHash        : ${batchHash}`);
  console.log(`  newStateRoot     : ${newStateRoot}`);

  // 4. Submit on-chain commitment
  //    proof = "0x" (empty bytes — stub verifier accepts anything)
  //    publicInputs = [] (no public inputs required by stub)
  const tx = await rollup.commitBatch(
    newStateRoot,
    batchHash,
    batchIntents.length,
    '0x',
    []
  );
  const receipt = await tx.wait();
  console.log(`  ✔ txHash=${receipt.hash}  block=${receipt.blockNumber}`);

  return {
    batchIndex  : batchIndex,
    intentIds   : intentIds,
    batchHash   : batchHash,
    newStateRoot: newStateRoot,
    txCount     : batchIntents.length,
    txHash      : receipt.hash,
    blockNumber : receipt.blockNumber,
  };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.RELAYER_PRIVATE_KEY) {
    throw new Error('RELAYER_PRIVATE_KEY not set');
  }

  const provider = getProvider();
  const wallet   = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
  const relayer  = new ethers.NonceManager(wallet);
  console.log(`Relayer address: ${wallet.address}`);

  // Load intents
  const { intents } = JSON.parse(
    readFileSync(join(ROOT, 'intents/payment_intents.json'), 'utf8')
  );
  console.log(`Total intents: ${intents.length}`);

  // Connect rollup with the relayer signer
  const rollup = getContract('ZKRollupPayments', relayer);

  // Split into batches of at most BATCH_SIZE
  const batches = chunk(intents, BATCH_SIZE);
  console.log(`Splitting into ${batches.length} batch(es) of max ${BATCH_SIZE}`);

  // Process each batch sequentially (each depends on the previous state root)
  const batchLogs = [];
  for (let i = 0; i < batches.length; i++) {
    const log = await processBatch(batches[i], i, rollup);
    batchLogs.push(log);
  }

  // Write report
  const output = {
    completedAt  : new Date().toISOString(),
    totalIntents : intents.length,
    totalBatches : batchLogs.length,
    batches      : batchLogs,
  };

  mkdirSync(join(ROOT, 'logs'), { recursive: true });
  writeFileSync(join(ROOT, 'logs/relay.json'), JSON.stringify(output, null, 2));
  console.log('\n✅ Relay complete. Written to logs/relay.json');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('Relay failed:', err);
  process.exit(1);
});
