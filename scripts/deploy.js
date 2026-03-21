// scripts/deploy.js
// Deploys StubZKVerifier and ZKRollupPayments, adds the relayer to the
// whitelist, then writes deployments/addresses.json for downstream scripts.

import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getProvider, ROOT } from './utils/chain.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function loadArtifact(contractName) {
  const path = join(
    ROOT,
    `artifacts/contracts/${contractName}.sol/${contractName}.json`
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Validate required env vars before doing any work
  const { DEPLOYER_PRIVATE_KEY, RELAYER_ADDRESS } = process.env;
  if (!DEPLOYER_PRIVATE_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set');
  if (!RELAYER_ADDRESS)      throw new Error('RELAYER_ADDRESS not set');

  const provider = getProvider();
  const wallet   = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
  // NonceManager tracks on-chain nonce after each tx — required because
  // Hardhat automines instantly and ethers.js JsonRpcProvider caches nonces.
  const deployer = new ethers.NonceManager(wallet);
  console.log(`Deployer address : ${wallet.address}`);

  const network = await provider.getNetwork();
  console.log(`Connected network: chainId=${network.chainId}`);

  // ── 1. Deploy StubZKVerifier ─────────────────────────────────────────────
  console.log('\n[1/3] Deploying StubZKVerifier…');
  const stubArtifact = loadArtifact('StubZKVerifier');
  const StubFactory  = new ethers.ContractFactory(
    stubArtifact.abi,
    stubArtifact.bytecode,
    deployer
  );
  const stub        = await StubFactory.deploy();
  await stub.waitForDeployment();
  const stubAddress = await stub.getAddress();
  console.log(`  ✔ StubZKVerifier  → ${stubAddress}`);

  // ── 2. Deploy ZKRollupPayments ───────────────────────────────────────────
  console.log('\n[2/3] Deploying ZKRollupPayments…');
  const rollupArtifact = loadArtifact('ZKRollupPayments');
  const RollupFactory  = new ethers.ContractFactory(
    rollupArtifact.abi,
    rollupArtifact.bytecode,
    deployer
  );
  const rollup        = await RollupFactory.deploy(stubAddress);
  await rollup.waitForDeployment();
  const rollupAddress = await rollup.getAddress();
  console.log(`  ✔ ZKRollupPayments → ${rollupAddress}`);

  // ── 3. Whitelist the relayer ─────────────────────────────────────────────
  console.log(`\n[3/3] Adding relayer ${RELAYER_ADDRESS}…`);
  const addTx = await rollup.addRelayer(RELAYER_ADDRESS);
  await addTx.wait();
  console.log(`  ✔ Relayer whitelisted`);

  // ── Write output file ────────────────────────────────────────────────────
  const output = {
    network    : 'localhost',
    chainId    : Number(network.chainId),
    rpcUrl     : process.env.RPC_URL ?? 'http://hardhat:8545',
    ZKRollupPayments: rollupAddress,
    StubZKVerifier  : stubAddress,
    relayer    : RELAYER_ADDRESS,
    deployedAt : new Date().toISOString(),
  };

  mkdirSync(join(ROOT, 'deployments'), { recursive: true });
  const outPath = join(ROOT, 'deployments/addresses.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ Deployment complete. Written to deployments/addresses.json`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('Deploy failed:', err);
  process.exit(1);
});
