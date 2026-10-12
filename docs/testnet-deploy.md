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

---

## Running a local Soroban standalone sandbox with Docker

For local offline development, integration tests, or environments without stable internet access to the public testnet, you can run a self-contained local Stellar/Soroban network using Docker.

### 1. Launch the standalone container

Run the official Stellar Quickstart container in `standalone` mode:

```bash
docker run --rm -it \
  -p 8000:8000 \
  --name stellar-sandbox \
  stellar/quickstart:testing \
  --standalone \
  --enable-soroban-rpc
```

This spins up:
- **Soroban RPC**: `http://localhost:8000/soroban/rpc`
- **Horizon API**: `http://localhost:8000`
- **Network Passphrase**: `Standalone Network ; February 2017`
- **Local Friendbot**: `http://localhost:8000/friendbot`

### 2. Configure CLI network and local identity

Add the local network profile to your `soroban-cli` (or `stellar-cli`):

```bash
# Add the local network endpoint
stellar network add \
  --rpc-url "http://localhost:8000/soroban/rpc" \
  --network-passphrase "Standalone Network ; February 2017" \
  local

# Generate a local identity
stellar keys generate local-alice --network local

# Fund local-alice with local Friendbot
curl "http://localhost:8000/friendbot?addr=$(stellar keys address local-alice)"
```

### 3. Deploy mock token, factory, and vault locally

1. **Deploy a local SAC test token**:
   ```bash
   # Deploy an asset contract for local testing
   TOKEN_ID=$(stellar contract asset deploy \
     --asset "USDC:$(stellar keys address local-alice)" \
     --source local-alice \
     --network local)
   echo "Mock Token Address: $TOKEN_ID"
   ```

2. **Install and deploy factory and vault**:
   ```bash
   # Build contract artifacts
   cargo build --target wasm32v1-none --release

   # Install vault wasm
   VAULT_HASH=$(stellar contract install \
     --wasm target/wasm32v1-none/release/lumen_vault.wasm \
     --source local-alice \
     --network local)

   # Deploy factory
   FACTORY_ID=$(stellar contract deploy \
     --wasm target/wasm32v1-none/release/lumen_vault_factory.wasm \
     --source local-alice \
     --network local \
     -- --vault_wasm_hash "$VAULT_HASH")

   # Deploy vault through factory
   VAULT_ID=$(stellar contract invoke \
     --id "$FACTORY_ID" \
     --source local-alice \
     --network local \
     -- deploy_vault \
     --owner "$(stellar keys address local-alice)" \
     --token "$TOKEN_ID" \
     --salt "0000000000000000000000000000000000000000000000000000000000000001" \
     --min_deposit 0 \
     --max_balance 0)
   ```

3. **Connect via SDK locally**:
   ```ts
   import { connectVault } from "@lumenforge/sdk";

   const vault = await connectVault({
     contractId: VAULT_ID,
     rpcUrl: "http://localhost:8000/soroban/rpc",
     networkPassphrase: "Standalone Network ; February 2017",
     secretKey: localAliceSecret,
   });

   const snapshot = await vault.getSnapshot();
   console.log("Local vault initialized:", snapshot);
   ```

