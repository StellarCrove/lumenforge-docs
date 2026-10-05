# Testnet deployment walkthrough

From an empty machine to a vault you deployed yourself on Stellar
testnet. There is no shared canonical factory address to copy: each
run installs the Wasm and prints the contract ids it just created.
Paste those into `.env`. The whole path is one script plus a wallet
signature for the first deposit.

## What you need

- Rust stable, with the `wasm32v1-none` target (`rustup target add wasm32v1-none`).
- [`soroban-cli`](https://developers.stellar.org/docs/tools/developer-tools#soroban-cli) on `PATH` (`stellar` CLI works the same if that is what you have installed; the script calls `soroban`).
- A testnet identity funded with Friendbot. The script creates one if `SOROBAN_SECRET` is empty.
- Node.js 22 or newer, only for the Freighter and Albedo snippet at the end. The deploy itself is the CLI.

## 1. Configure

Copy the template from this repo:

```bash
cp .env.example .env
```

Leave `FACTORY_ID` and `VAULT_ID` empty on the first run. The script fills them.

| Variable | Meaning |
|---|---|
| `SOROBAN_RPC_URL` | Testnet RPC. Default `https://soroban-testnet.stellar.org`. |
| `SOROBAN_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015`. |
| `SOROBAN_SECRET` | Secret key of the account that deploys and owns the vault. Empty means "generate one and fund it". |
| `TOKEN_CONTRACT_ID` | SEP-41 contract the vault will custody. Empty means "deploy a fresh Stellar Asset Contract and mint to yourself". |
| `MIN_DEPOSIT` | Smallest deposit the vault will accept, in stroops of that token. `0` is fine for a first vault. |
| `FACTORY_ID` | Printed by the script. Leave empty to deploy a new factory. |
| `VAULT_ID` | Printed by the script. Leave empty to deploy a new vault through the factory. |

Do not commit `.env`. It holds a secret key.

## 2. Deploy

From a checkout of [`lumenforge-contracts`](https://github.com/StellarCrove/lumenforge-contracts) and this docs repo side by side:

```bash
export CONTRACTS_DIR=../lumenforge-contracts
bash scripts/deploy-testnet.sh
```

The script:

1. Builds `lumen_vault.wasm` and `lumen_vault_factory.wasm`.
2. Funds the deployer with Friendbot when the account is new.
3. Installs the vault Wasm and deploys the factory with that hash.
4. Deploys a vault for `TOKEN_CONTRACT_ID` (or a new SAC) and prints both contract ids.

Copy the two `C...` ids back into `.env`. A second run with those set skips the deploy and only prints them.

A developer who already has the CLI configured (`soroban keys` and `soroban network add testnet`) can ignore the script and follow the same three commands in the contracts README under "Deploy (testnet)". The script is that sequence with the ids captured for you.

## 3. Deposit from a browser wallet

The CLI deploy above uses a secret key. A depositor in a browser should not paste a secret into a page. Freighter and Albedo both sign a transaction the SDK has already built. The shape is the same for both: build an unsigned transaction, hand it to the wallet, then submit the signed envelope.

```ts
import { connectVault } from "@lumenforge/sdk";
import {
  TransactionBuilder,
  Networks,
} from "@stellar/stellar-sdk";

const vault = await connectVault({
  contractId: process.env.VAULT_ID!,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
});

// `deposit` returns an assembled, unsigned Soroban transaction.
const tx = await vault.deposit({ from: publicKey, amount: 1_000_000n });

// Freighter: the extension popup asks the user to approve.
// https://docs.freighter.app
const signedXdr = await window.freighterApi.signTransaction(tx.toXDR(), {
  networkPassphrase: Networks.TESTNET,
});

// Albedo is the same hand-off, through its own popup.
// https://albedo.link
const albedo = await window.albedo.tx({
  xdr: tx.toXDR(),
  network: "testnet",
});

const signed = TransactionBuilder.fromXDR(
  signedXdr ?? albedo.signed_envelope_xdr,
  Networks.TESTNET,
);
await vault.server.sendTransaction(signed);
```

What the user sees:

1. The page asks Freighter or Albedo for permission to connect, and the user picks the testnet account.
2. The wallet shows the `deposit` invocation, the token, and the amount. The user confirms.
3. The page submits the signed envelope. `vault.balance()` then matches the tokens the vault contract holds.

Neither wallet needs the factory id after the vault exists. They need the vault contract id, the public key that is depositing, and a token balance in that account.

## 4. Confirm it worked

```bash
soroban contract invoke --id "$VAULT_ID" --source deployer --network testnet -- balance
```

The number is the vault's accounted balance. For a normal SEP-41 token it equals the token contract's balance for `VAULT_ID`. A fee-on-transfer token is rejected by `deposit` (the contract returns `InvalidAmount` and the transfer reverts), so a failed first deposit usually means the token, not the deploy.

Keep the vault alive with the daily keeper in [data-model.md](data-model.md#ttl-mechanics-worked-with-real-numbers): `threshold` 17280, `extend_to` 518400.
