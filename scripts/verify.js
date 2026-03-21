// scripts/verify.js
// Queries the final on-chain state of ZKRollupPayments.
// Runs a series of checks and writes a full verification report to logs/verify.json.
// Exit code 0 = all checks passed. Exit code 1 = one or more checks failed.

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getProvider, getContract, ROOT } from './utils/chain.js';

const ZERO_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a check result object.
 * @param {string}  label   - human-readable check name
 * @param {boolean} passed  - whether the check passed
 * @param {string}  detail  - explanation / actual value
 */
function makeCheck(label, passed, detail) {
  return { check: label, status: passed ? 'pass' : 'fail', detail };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider = getProvider();
  const rollup   = getContract('ZKRollupPayments', provider);

  // Load addresses for the report
  const addresses = JSON.parse(
    readFileSync(join(ROOT, 'deployments/addresses.json'), 'utf8')
  );

  console.log(`Verifying contract: ${addresses.ZKRollupPayments}`);

  // ── On-chain queries ─────────────────────────────────────────────────────
  const [batchCount, currentStateRoot] = await Promise.all([
    rollup.batchCount(),
    rollup.currentStateRoot(),
  ]);

  const batchCountNum = Number(batchCount);
  console.log(`batchCount       : ${batchCountNum}`);
  console.log(`currentStateRoot : ${currentStateRoot}`);

  // Fetch every BatchRecord
  const batchRecords = [];
  for (let i = 0; i < batchCountNum; i++) {
    const rec = await rollup.getBatch(i);
    batchRecords.push({
      index       : i,
      oldStateRoot: rec.oldStateRoot,
      newStateRoot: rec.newStateRoot,
      batchHash   : rec.batchHash,
      txCount     : Number(rec.txCount),
      committedAt : Number(rec.committedAt),
      relayer     : rec.relayer,
    });
    console.log(`Batch ${i}: txCount=${rec.txCount}  relayer=${rec.relayer}`);
  }

  // ── Run checks ───────────────────────────────────────────────────────────
  const checks = [];
  const expectedRelayer = addresses.relayer.toLowerCase();

  // Check 1: at least 3 batches committed
  checks.push(makeCheck(
    'batchCount >= 3',
    batchCountNum >= 3,
    `batchCount is ${batchCountNum}`
  ));

  // Check 2: final state root is not zero
  checks.push(makeCheck(
    'currentStateRoot is not zero hash',
    currentStateRoot !== ZERO_HASH,
    `currentStateRoot = ${currentStateRoot}`
  ));

  // Check 3: each batch was submitted by the expected relayer
  for (const rec of batchRecords) {
    checks.push(makeCheck(
      `batch[${rec.index}] committed by correct relayer`,
      rec.relayer.toLowerCase() === expectedRelayer,
      `relayer = ${rec.relayer}`
    ));
  }

  // Check 4: each batch has a non-zero batchHash
  for (const rec of batchRecords) {
    checks.push(makeCheck(
      `batch[${rec.index}] has non-zero batchHash`,
      rec.batchHash !== ZERO_HASH,
      `batchHash = ${rec.batchHash}`
    ));
  }

  // Check 5: each batch txCount is between 1 and 5
  for (const rec of batchRecords) {
    checks.push(makeCheck(
      `batch[${rec.index}] txCount is 1–5`,
      rec.txCount >= 1 && rec.txCount <= 5,
      `txCount = ${rec.txCount}`
    ));
  }

  // Check 6: state root chain is consistent (each batch's oldRoot matches previous newRoot)
  for (let i = 1; i < batchRecords.length; i++) {
    const prev = batchRecords[i - 1];
    const curr = batchRecords[i];
    checks.push(makeCheck(
      `batch[${i}].oldStateRoot links to batch[${i - 1}].newStateRoot`,
      curr.oldStateRoot === prev.newStateRoot,
      `batch[${i}].oldStateRoot=${curr.oldStateRoot}`
    ));
  }

  // ── Tally results ────────────────────────────────────────────────────────
  const passed = checks.filter(c => c.status === 'pass').length;
  const failed = checks.filter(c => c.status === 'fail').length;

  console.log(`\nChecks: ${passed} passed, ${failed} failed`);
  checks.filter(c => c.status === 'fail').forEach(c => {
    console.error(`  ✗ FAIL: ${c.check} — ${c.detail}`);
  });

  // ── Write report ─────────────────────────────────────────────────────────
  const output = {
    verifiedAt      : new Date().toISOString(),
    contractAddress : addresses.ZKRollupPayments,
    batchCount      : batchCountNum,
    currentStateRoot: currentStateRoot,
    passed,
    failed,
    checks,
  };

  mkdirSync(join(ROOT, 'logs'), { recursive: true });
  writeFileSync(join(ROOT, 'logs/verify.json'), JSON.stringify(output, null, 2));
  console.log('✅ Verification complete. Written to logs/verify.json');

  if (failed > 0) {
    console.error(`\n❌ ${failed} check(s) failed`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Verify failed:', err);
  process.exit(1);
});
