// scripts/utils/chain.js
// Shared helper module — imported by deploy.js, setup.js, relay.js, verify.js


import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Resolve the project root (two levels up from scripts/utils/)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
export const ROOT = join(__dirname, '../..');

// ─────────────────────────────────────────────────────────────────────────────
// getProvider()
// Returns a JSON-RPC provider connected to the Hardhat node.
// Uses RPC_URL env var if set, otherwise defaults to the Docker service hostname.
// ─────────────────────────────────────────────────────────────────────────────
export function getProvider() {
  const url = process.env.RPC_URL ?? 'http://hardhat:8545';
  return new ethers.JsonRpcProvider(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// getContract(name, signerOrProvider)
// Loads a deployed contract instance by name.
//   name            — contract name, e.g. "ZKRollupPayments"
//   signerOrProvider — a Wallet (for writes) or Provider (for reads)
//
// Reads:
//   deployments/addresses.json   → contract address
//   artifacts/contracts/<name>.sol/<name>.json → ABI
// ─────────────────────────────────────────────────────────────────────────────
export function getContract(name, signerOrProvider) {
  const addresses = JSON.parse(
    readFileSync(join(ROOT, 'deployments/addresses.json'), 'utf8')
  );
  const artifact = JSON.parse(
    readFileSync(
      join(ROOT, `artifacts/contracts/${name}.sol/${name}.json`),
      'utf8'
    )
  );
  return new ethers.Contract(addresses[name], artifact.abi, signerOrProvider);
}

// ─────────────────────────────────────────────────────────────────────────────
// computeBatchHash(intentIds)
// Returns a bytes32 keccak256 hash that uniquely identifies a set of intents.
// Mirrors the off-chain commitment used to track which intents are in each batch.
//
//   intentIds — string[] — array of UUID intent IDs
// ─────────────────────────────────────────────────────────────────────────────
export function computeBatchHash(intentIds) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['string[]'],
    [intentIds]
  );
  return ethers.keccak256(encoded);
}

// ─────────────────────────────────────────────────────────────────────────────
// computeNewStateRoot(currentStateRoot, batchHash)
// Simulates a Merkle state root update.
// Each new root cryptographically depends on ALL previous roots + this batch.
//
//   currentStateRoot — bytes32 hex string
//   batchHash        — bytes32 hex string
// ─────────────────────────────────────────────────────────────────────────────
export function computeNewStateRoot(currentStateRoot, batchHash) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'bytes32'],
    [currentStateRoot, batchHash]
  );
  return ethers.keccak256(encoded);
}
