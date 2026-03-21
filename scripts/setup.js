// scripts/setup.js
// Reads payment_intents.json, derives the unique set of sender addresses,
// and deposits 1 ETH into ZKRollupPayments from each user's account.
// Writes a summary report to logs/setup.json.

import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getProvider, getContract, ROOT } from './utils/chain.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a map of checksummed address → Wallet for every user private key
 * found in the environment (USER_A_PRIVATE_KEY, USER_B_PRIVATE_KEY, …).
 */
function buildUserWallets(provider) {
  const keys = [
    process.env.USER_A_PRIVATE_KEY,
    process.env.USER_B_PRIVATE_KEY,
  ].filter(Boolean);

  if (keys.length === 0) throw new Error('No USER_*_PRIVATE_KEY env vars set');

  return Object.fromEntries(
    keys.map(pk => {
      const wallet = new ethers.Wallet(pk, provider);
      return [wallet.address.toLowerCase(), wallet];
    })
  );
}

/**
 * Extract the unique fromAddress values from the intents file.
 */
function uniqueSenders(intents) {
  return [...new Set(intents.map(i => i.fromAddress.toLowerCase()))];
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider    = getProvider();
  const userWallets = buildUserWallets(provider);

  // Load intents
  const { intents } = JSON.parse(
    readFileSync(join(ROOT, 'intents/payment_intents.json'), 'utf8')
  );
  console.log(`Loaded ${intents.length} intents`);

  const senders = uniqueSenders(intents);
  console.log(`Unique senders: ${senders.length}`);

  const depositAmount = ethers.parseEther('1'); // 1 ETH per user
  const depositLog   = [];

  for (const senderAddr of senders) {
    const wallet = userWallets[senderAddr];
    if (!wallet) {
      throw new Error(
        `No private key found for sender ${senderAddr}. ` +
        `Add USER_*_PRIVATE_KEY to your .env file.`
      );
    }

    // Connect contract with this user's signer
    const rollup = getContract('ZKRollupPayments', wallet);

    console.log(`\nDepositing 1 ETH for ${wallet.address}…`);
    const tx      = await rollup.deposit({ value: depositAmount });
    const receipt = await tx.wait();

    console.log(`  ✔ txHash=${receipt.hash}  block=${receipt.blockNumber}`);

    depositLog.push({
      user       : wallet.address,
      amountEth  : '1',
      txHash     : receipt.hash,
      blockNumber: receipt.blockNumber,
    });
  }

  // Write log 
  const output = {
    completedAt: new Date().toISOString(),
    deposits   : depositLog,
  };

  mkdirSync(join(ROOT, 'logs'), { recursive: true });
  writeFileSync(join(ROOT, 'logs/setup.json'), JSON.stringify(output, null, 2));
  console.log('\n✅ Setup complete. Written to logs/setup.json');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
