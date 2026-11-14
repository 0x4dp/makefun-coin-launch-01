# makefun-coin-launch-01

Agent otonomis untuk luncurkan coin di pump.fun — bounty make.fun.

## Setup

```bash
npm install @solana/kit
```

Salin `makefun-keypair.json` (hasil `node key.mjs` dari https://github.com/makedotfun/example-agent)
ke folder ini, atau set `SOLANA_WALLET_PATH` ke path file wallet-mu.

## Jalankan

```bash
node main.ts
```

Hasil: `LAUNCH.json` dengan `mint` dan `signature`.

## Syarat bounty

- Logo: ghost dari https://make.fun/press, tanpa modifikasi
- Description: `made for make.fun $1000 bounty`
- Wallet: aktif di pump.fun, punya SOL untuk launch + first buy
- Jangan simpan private key di repo ini

## Submit

https://make.fun/bounty/makefun-coin-launch-01
