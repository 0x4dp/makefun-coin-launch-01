// makefun-coin-launch-01 — main.ts
// Luncurkan coin di pump.fun secara otonomis, lalu tulis LAUNCH.json.
//
// Setup (jalankan di komputer kamu, jangan upload keypair ke GitHub):
//   npm install @solana/web3.js bs58
//   simpan private key (base58) di SOLANA_PRIVATE_KEY env, atau
//   simpan keypair JSON di C:/Users/fourdepe/.makefun/keypairs/linked.json
//   node main.ts
//
// Keluaran: LAUNCH.json dengan mint + signature.

import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { createInitializeMintInstruction } from '@solana/spl-token';

// Token program IDs (dari @solana/spl-token, tidak ada di web3.js v1.95.8)
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// --- KONFIGURASI ---
// Path keypair — prioritas: env SOLANA_KEYPAIR_PATH > linked.json (wallet dengan SOL) > default .makefun/keypair.json
const WALLET_PATH =
  process.env.SOLANA_KEYPAIR_PATH ||
  'C:/Users/fourdepe/.makefun/keypairs/linked.json' ||
  'C:/Users/fourdepe/.makefun/keypair.json';
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const COIN_NAME = 'MakeFun Ghost';
const COIN_SYMBOL = 'GHOST';
const LOGO_URL = 'https://make.fun/press/ghost.svg'; // tanpa modifikasi

// Pump.fun program ID
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
// Pump.fun global account PDA (seed: "global")
const [GLOBAL_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('global')],
  PUMP_PROGRAM_ID
);
// Pump.fun mint authority PDA (seed: "mint-authority")
const [MINT_AUTHORITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('mint-authority')],
  PUMP_PROGRAM_ID
);
// Pump.fun event authority (from #[event_cpi], seed: "__event_authority")
const [EVENT_AUTHORITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('__event_authority')],
  PUMP_PROGRAM_ID
);
// Token metadata program
const TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
// System program
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
// Rent sysvar
const RENT_SYSVAR = new PublicKey('SysvarRent111111111111111111111111111111111');

// --- MAIN ---
async function main() {
  console.log('[makefun] Memulai launch agent...');

  // 1. Load wallet dari file lokal atau env SOLANA_PRIVATE_KEY (jangan commit ke GitHub)
  let wallet: Keypair;
  const privateKeyEnv = process.env.SOLANA_PRIVATE_KEY;
  if (privateKeyEnv) {
    const bs58 = require('bs58');
    const secretKey = bs58.decode(privateKeyEnv);
    wallet = Keypair.fromSecretKey(secretKey);
    console.log('[makefun] Wallet dari env SOLANA_PRIVATE_KEY:', wallet.publicKey.toBase58());
  } else if (fs.existsSync(WALLET_PATH)) {
    const keyData = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
    const secretKey = Uint8Array.from(keyData);
    wallet = Keypair.fromSecretKey(secretKey);
    console.log('[makefun] Wallet dari file:', WALLET_PATH, '->', wallet.publicKey.toBase58());
  } else {
    throw new Error(
      'Keypair tidak ditemukan. Simpan private key (base58) di env SOLANA_PRIVATE_KEY, atau\n' +
      'simpan keypair JSON di ' + WALLET_PATH
    );
  }

  // 2. Cek saldo SOL
  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('[makefun] Saldo:', balance / LAMPORTS_PER_SOL, 'SOL');
  if (balance < LAMPORTS_PER_SOL / 10) {
    throw new Error('Saldo SOL terlalu rendah untuk launch');
  }

  // 3. Buat coin di pump.fun
  const { mint, signature } = await launchCoin(connection, wallet);

  // 4. Tulis LAUNCH.json
  const launch = {
    mint: mint.toBase58(),
    signature: signature.toString(),
  };
  fs.writeFileSync('LAUNCH.json', JSON.stringify(launch, null, 2));
  console.log('[makefun] LAUNCH.json:', JSON.stringify(launch));
  console.log('[makefun] Selesai. Submit di https://make.fun/bounty/makefun-coin-launch-01');
}

async function launchCoin(
  connection: Connection,
  wallet: Keypair
): Promise<{ mint: PublicKey; signature: string }> {
  // 3a. Buat mint keypair baru untuk coin
  const mintKeypair = Keypair.generate();
  console.log('[makefun] Mint:', mintKeypair.publicKey.toBase58());

  // 3b. Derive PDAs
  const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mintKeypair.publicKey.toBuffer()],
    PUMP_PROGRAM_ID
  );
  const [associatedBondingCurvePDA] = PublicKey.findProgramAddressSync(
    [bondingCurvePDA.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintKeypair.publicKey.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM.toBuffer(), mintKeypair.publicKey.toBuffer()],
    TOKEN_METADATA_PROGRAM
  );

  console.log('[makefun] Bonding curve:', bondingCurvePDA.toBase58());
  console.log('[makefun] Metadata:', metadataPDA.toBase58());

  // 3c. Bangun transaksi (pump.fun program sendiri membuat dan inisialisasi mint)
  const transaction = new Transaction();

  // Compute budget
  transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
  transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }));

  // Pump.fun create instruction data (termasuk creator pubkey)
  const createData = buildPumpCreateInstructionData(COIN_NAME, COIN_SYMBOL, LOGO_URL, wallet.publicKey);

  const pumpCreateInstruction = new TransactionInstruction({
    keys: [
      { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: MINT_AUTHORITY_PDA, isSigner: false, isWritable: false },
      { pubkey: bondingCurvePDA, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurvePDA, isSigner: false, isWritable: true },
      { pubkey: GLOBAL_PDA, isSigner: false, isWritable: false },
      { pubkey: TOKEN_METADATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: metadataPDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PUMP_PROGRAM_ID,
    data: createData,
  });
  transaction.add(pumpCreateInstruction);

  // 3e. Sign dan kirim
  const signature = await sendAndConfirmTransaction(connection, transaction, [
    wallet,
    mintKeypair,
  ], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });

  console.log('[makefun] Transaksi dikonfirmasi:', signature);

  return { mint: mintKeypair.publicKey, signature };
}

function buildPumpCreateInstructionData(
  name: string,
  symbol: string,
  uri: string,
  creator: PublicKey
): Buffer {
  // Compute Anchor discriminator: first 8 bytes of SHA256("global:create")
  const discriminator = crypto.createHash('sha256').update('global:create').digest().slice(0, 8);

  const nameBuf = Buffer.from(name, 'utf8');
  const symbolBuf = Buffer.from(symbol, 'utf8');
  const uriBuf = Buffer.from(uri, 'utf8');

  const parts: Buffer[] = [Buffer.from(discriminator)];

  // Anchor string encoding: u32 length (LE) + bytes
  parts.push(Buffer.from([nameBuf.length & 0xff, (nameBuf.length >> 8) & 0xff, (nameBuf.length >> 16) & 0xff, (nameBuf.length >> 24) & 0xff]));
  parts.push(nameBuf);
  parts.push(Buffer.from([symbolBuf.length & 0xff, (symbolBuf.length >> 8) & 0xff, (symbolBuf.length >> 16) & 0xff, (symbolBuf.length >> 24) & 0xff]));
  parts.push(symbolBuf);
  parts.push(Buffer.from([uriBuf.length & 0xff, (uriBuf.length >> 8) & 0xff, (uriBuf.length >> 16) & 0xff, (uriBuf.length >> 24) & 0xff]));
  parts.push(uriBuf);

  // Creator pubkey (32 bytes)
  parts.push(creator.toBuffer());

  return Buffer.concat(parts);
}

main().catch((err) => {
  console.error('[makefun] ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
