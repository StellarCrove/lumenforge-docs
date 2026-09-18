# Integration Guide

A task-oriented walkthrough of integrating with LumenForge via
`@lumenforge/sdk`. For every function's exact parameters, return type,
and errors, see [api-reference.md](api-reference.md); this guide is the
order you'd actually do things in.

## Table of contents

- [Prerequisites](#prerequisites)
- [1. Install](#1-install)
- [2. Get a vault](#2-get-a-vault)
- [3. Deposit and withdraw](#3-deposit-and-withdraw)
- [4. List an owner's vaults](#4-list-an-owners-vaults)
- [4a. Read a single vault's full state at once](#4a-read-a-single-vaults-full-state-at-once)
- [5. Handle errors](#5-handle-errors)
- [6. Track activity (events)](#6-track-activity-events)
- [7. Keep it alive](#7-keep-it-alive)
- [8. Or skip the code: the CLI](#8-or-skip-the-code-the-cli)
- [Choosing between direct deployment and factory deployment](#choosing-between-direct-deployment-and-factory-deployment)
- [A complete walkthrough: zero to a running integration](#a-complete-walkthrough-zero-to-a-running-integration)
- [Migrating existing code to the newer helpers](#migrating-existing-code-to-the-newer-helpers)
- [Framework-specific notes](#framework-specific-notes)
- [Troubleshooting](#troubleshooting)
- [Before you point a vault at a token](#before-you-point-a-vault-at-a-token)

## Prerequisites

Before starting, you'll want:

1. **A Node.js ≥ 22 environment.** This matches `@stellar/stellar-sdk`
   16's own engine requirement; the SDK's `.nvmrc` pins the exact
   version this project develops against.
2. **A Soroban RPC endpoint and matching network passphrase.** For
   testnet, `https://soroban-testnet.stellar.org` and
   `"Test SDF Network ; September 2015"` respectively. For a local
   standalone network, whatever your local setup exposes (commonly
   `http://localhost:8000` with `"Standalone Network ; February 2017"`,
   though a differently-configured local network could use different
   values — check your own setup rather than assuming these).
3. **A funded Stellar keypair** to act as at least one test user. On
   testnet, generate one and fund it via Friendbot:

   ```ts
   import { Keypair } from "@stellar/stellar-sdk";

   const keypair = Keypair.random();
   console.log("Public key:", keypair.publicKey());
   console.log("Secret key:", keypair.secret());

   await fetch(`https://friendbot.stellar.org/?addr=${keypair.publicKey()}`);
   ```

   Friendbot funds the account with a starting balance of the native
   XLM asset — it does **not** fund it with the SEP-41 token you
   intend to use with `lumen_vault`, which is a separate asset you'll
   need to either issue yourself (for a token you control, e.g. via a
   Stellar Asset Contract you mint from) or otherwise acquire before
   `deposit` calls involving it can succeed.
4. **A deployed factory (or vault) contract address** to point the SDK
   at. If none exists yet for your target network, see
   `lumenforge-contracts`' own README for the `soroban-cli`-based
   deployment steps — that's outside this SDK's scope (this document
   assumes a contract is already deployed and you're integrating
   *against* it, not deploying the contract code itself).

## 1. Install

```bash
npm install @lumenforge/sdk
```

Requires Node ≥ 22.

If you also want the CLI available as a standalone binary on your
`PATH` (rather than only importable as a library within a Node
project), see [cli-reference.md's Installation section](cli-reference.md#installation)
for the global-install and `npx` alternatives.

## 2. Get a vault

Two paths, depending on whether you want the factory's on-chain index to
know about the vault:

- **Through the factory** (recommended for most integrations — the
  vault shows up in `vaults_by_owner`):

  ```ts
  import { connectFactory, deployVaultViaFactory } from "@lumenforge/sdk";

  const factory = await connectFactory({ contractId: "C...", /* ... */ });
  const tx = await deployVaultViaFactory(factory, {
    owner: "G...",
    token: "C...", // the SEP-41 token this vault will custody
    min_deposit: 0n,
  });
  const { result: vaultAddress } = await tx.signAndSend();
  ```

  You don't need to think about salts here — `deployVaultViaFactory`
  generates a random one by default, or derives a deterministic one from
  `{ salt: { nonce } }` if you want the same `(owner, nonce)` to always
  resolve to the same address (e.g. "give this user their 3rd vault at a
  predictable address before it's even deployed").

- **Directly** (no factory, no on-chain index entry):

  ```ts
  import { deployVault } from "@lumenforge/sdk";

  const tx = await deployVault(
    { owner: "G...", token: "C...", min_deposit: 0n },
    { wasmHash: "<lumen_vault wasm hash>", /* ... */ },
  );
  const { result: vault } = await tx.signAndSend(); // a connected VaultClient
  ```

Already deployed? Connect to it directly instead of deploying:

```ts
import { connectVault } from "@lumenforge/sdk";
const vault = await connectVault({ contractId: "C...", /* ... */ });
```

### What `/* ... */` actually stands for

Every abbreviated example in this guide elides the same handful of
options, spelled out in full once here rather than repeated in every
snippet:

```ts
import { connectVault } from "@lumenforge/sdk";
import { Keypair } from "@stellar/stellar-sdk";
import { KeypairSigner } from "@stellar/stellar-sdk/contract";

const keypair = Keypair.fromSecret(process.env.SECRET_KEY!);
const signer = new KeypairSigner(keypair, "Test SDF Network ; September 2015");

const vault = await connectVault({
  contractId: "CVAULTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  publicKey: signer.address,       // needed even for read-only calls
  signTransaction: signer,          // only needed if you'll call a state-changing method
});
```

For a purely read-only integration (you'll only ever call `balance()`,
`owner()`, `getVaultSnapshot`, etc. — never `deposit`/`withdraw`/
anything that mutates state), you can omit `signTransaction`
entirely and still connect successfully; `publicKey` is still
required, since Soroban's simulation needs *some* account to
construct the transaction's source, even for a call that will never
actually be signed or sent. Any valid `G...` address works for this
purpose — it does not need to hold any balance, and does not need to
be an address you control, since nothing gets submitted.

In a browser context (rather than a Node script), `signTransaction`
would instead be a SEP-43 wallet's own callback (Freighter, or any
compatible wallet extension) rather than a `KeypairSigner` — see
[Framework-specific notes](#framework-specific-notes) below.

## 3. Deposit and withdraw

```ts
const tx = await vault.deposit({ from: "G...", amount: 500n });
await tx.signAndSend();

const tx2 = await vault.withdraw({ amount: 200n }); // owner-only
await tx2.signAndSend();
```

`deposit` will reject with `Paused`, `BelowMinimumDeposit`, or
`ExceedsMaxBalance` depending on the vault's current configuration —
see [Errors](#5-handle-errors) below rather than assuming a bare
`amount` is always accepted.

### A more complete deposit flow, with actual error handling

The two-liner above is the shape of the call; a real integration
almost always wants to check the vault's current configuration first
(to give a good error message *before* attempting the call, not just
after it fails) and handle the failure modes that can still occur
despite that check:

```ts
import { getVaultSnapshot } from "@lumenforge/sdk";

async function depositWithValidation(vault: VaultClient, from: string, amount: bigint) {
  const snapshot = await getVaultSnapshot(vault);

  if (snapshot.paused) {
    throw new Error("This vault is not currently accepting deposits.");
  }
  if (amount < snapshot.minDeposit) {
    throw new Error(`Minimum deposit is ${snapshot.minDeposit}; you tried ${amount}.`);
  }
  if (snapshot.maxBalance !== undefined && snapshot.balance + amount > snapshot.maxBalance) {
    const room = snapshot.maxBalance - snapshot.balance;
    throw new Error(`This deposit would exceed the vault's cap; at most ${room} more can be deposited.`);
  }

  try {
    const tx = await vault.deposit({ from, amount });
    const result = await tx.signAndSend();
    return result.result; // the new balance
  } catch (err) {
    // Even with the pre-checks above, a race is possible: another
    // deposit could land between our snapshot read and our own
    // deposit's submission, changing whether this one still fits
    // under maxBalance. The pre-checks are a UX nicety (fail fast
    // with a specific message before spending a transaction fee on
    // a call we can already tell will fail); they are not a
    // substitute for handling the contract's own rejection, which
    // remains the actual source of truth.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Deposit failed on-chain: ${message}`);
  }
}
```

The comment in the `catch` block matters more than it might first
appear: **never treat a client-side pre-check as sufficient on its
own** for anything involving concurrent on-chain state. The pre-check
exists purely to give a better user experience (an immediate,
specific error instead of waiting for a transaction to fail), not to
replace the contract's own validation — which is exactly why the
`try`/`catch` around the actual `deposit` call is still there,
handling the case the pre-check didn't (and structurally couldn't)
catch.

## 4. List an owner's vaults

Don't call `vaults_by_owner` in a loop by hand — use the pagination
helpers, which are guaranteed to terminate even against a misbehaving
contract:

```ts
import { collectVaultsByOwner, iterateVaultsByOwner } from "@lumenforge/sdk";

const all = await collectVaultsByOwner(factory, "G...");

for await (const v of iterateVaultsByOwner(factory, "G...", { pageSize: 50 })) {
  // stops fetching further pages if you `break` here
}
```

That gives you addresses. For a dashboard showing balances, use
`collectVaultSnapshotsByOwner` instead — it resolves each address into
its full state (see step 4a) without you writing the connect-then-read
loop yourself:

```ts
import { collectVaultSnapshotsByOwner } from "@lumenforge/sdk";

const vaults = await collectVaultSnapshotsByOwner(factory, "G...", (address) =>
  connectVault({ contractId: address, /* same rpcUrl/networkPassphrase/... */ }),
);
```

## 4a. Read a single vault's full state at once

`balance()`, `owner()`, `token()`, etc. are each their own round trip.
`getVaultSnapshot`/`getFactorySnapshot` batch them:

```ts
import { getVaultSnapshot } from "@lumenforge/sdk";

const { balance, owner, paused, minDeposit, maxBalance } = await getVaultSnapshot(vault);
```

## 5. Handle errors

`connectVault`/`connectFactory`/`deployVault` wire up readable error
messages automatically — a failed call throws something like
`InsufficientBalance: withdrawal exceeds the vault's balance.` instead of
a raw host trap. Catch and branch on the message, or on the underlying
error code if you need to localize it.

## 6. Track activity (events)

A call's return value tells you the *result*; it doesn't tell you what
happened on-chain if you're building an indexer or activity feed off
`getEvents` instead of watching your own calls. Decode raw events with
`decodeVaultEvent`/`decodeFactoryEvent`:

```ts
import { decodeVaultEvent } from "@lumenforge/sdk";

const { events } = await server.getEvents({
  filters: [{ type: "contract", contractIds: [vaultContractId] }],
  startLedger,
});

for (const raw of events) {
  const decoded = decodeVaultEvent(raw);
  if (decoded?.type === "deposit") {
    // decoded.from, decoded.amount, decoded.new_balance
  }
}
```

Returns `undefined` (never throws) for anything that isn't a recognized
`lumen_vault`/`lumen_vault_factory` event — including the SEP-41 token's
own `transfer` event, which shows up alongside `deposit`/`withdraw`/
`rescue` as a side effect of moving the underlying token.

Decoding a whole batch at once and dropping anything unrecognized —
what most callers actually want, instead of filtering `undefined`s
themselves — is `decodeVaultEvents`/`decodeFactoryEvents`:

```ts
import { decodeVaultEvents } from "@lumenforge/sdk";

const deposits = decodeVaultEvents(events).filter((e) => e.type === "deposit");
```

## 7. Keep it alive

Neither contract can renew its own storage TTL on-chain — that has to be
called periodically from off-chain, or the network archives the storage.
Run `keepAlive` from a cron job against every vault/factory you care
about:

```ts
import { keepAlive } from "@lumenforge/sdk";

// e.g. on a daily cron
await keepAlive([vault, factory]);
```

Don't have the vault addresses handy — just a factory and an owner?
`keepOwnerVaultsAlive` discovers them first:

```ts
import { keepOwnerVaultsAlive } from "@lumenforge/sdk";

await keepOwnerVaultsAlive(factory, "G...", (address) =>
  connectVault({ contractId: address, /* same rpcUrl/networkPassphrase/... */ }),
);
```

See the SDK README's [Keeping contracts alive](https://github.com/StellarCrove/lumenforge-sdk#keeping-contracts-alive-ttl)
section for `extendTtl`/`extendVaultsByOwnerTtl` if you need finer
control than the batch helpers.

## 8. Or skip the code: the CLI

Every operation above is also a `lumenforge` command — for a cron job
or a one-off check where writing a script is overkill:

```bash
export LUMENFORGE_RPC_URL="https://soroban-testnet.stellar.org"
export LUMENFORGE_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

lumenforge vault snapshot --contract C... --public-key G...
lumenforge factory keep-owner-vaults-alive --contract C... --owner G...
```

State-changing commands need `LUMENFORGE_SECRET_KEY` set (an env var
only — never a `--flag`, which would be visible to `ps` and land in
shell history). See the SDK README's
[CLI section](https://github.com/StellarCrove/lumenforge-sdk#cli) for
the full command list.

## Choosing between direct deployment and factory deployment

Step 2 above mentions both `deployVault` (direct) and
`deployVaultViaFactory` (through the factory) without dwelling on
*why* you'd pick one over the other. In practice:

**Use `deployVaultViaFactory` when:**

- You want the vault to show up in `vaults_by_owner` — e.g. any
  "list all of this user's vaults" UI depends on this.
- You want a predictable address before deployment, via a
  deterministic `{ salt: { nonce } }`, so your backend can reference
  the address in the same request that triggers deployment, before
  waiting for confirmation.
- You're building a multi-tenant product where "one factory, many
  owners, each with their own vault(s)" is the natural shape — this
  is the scenario the factory pattern exists for.

**Use `deployVault` directly when:**

- You specifically don't want the on-chain index overhead — the
  factory's `VaultsByOwner` entry write on every `deploy_vault` call
  costs more than a bare constructor call, and if you're already
  tracking vault addresses in your own database, the factory's index
  is redundant for your use case.
- You're deploying a single, one-off vault not meant to be part of a
  larger indexed collection (e.g. a project's own treasury vault,
  where "list every vault this owner has" was never a requirement).
- You need a vault whose owner is not the same account paying for
  deployment, or some other topology the factory's
  `owner.require_auth()` constraint on `deploy_vault` doesn't fit —
  though note `lumen_vault`'s own constructor has exactly the same
  "owner set at deployment, immutable via constructor" shape either
  way; this isn't a reason `deployVault` gives you something
  `deployVaultViaFactory` structurally couldn't.

You can also **switch your mind after the fact**, partially: a vault
deployed directly can still be discovered later if you separately
track its address (in your own database, or by watching
`VaultDeployed`-shaped activity you generate yourself) — it simply
never appears in any factory's on-chain index, since nothing
retroactively registers it there. There is no operation that moves an
already-deployed vault into a factory's index after the fact.

## A complete walkthrough: zero to a running integration

Every prior section covers one operation. This section is a single,
runnable Node.js script exercising the entire lifecycle end to end —
deploy, deposit, read, list, keep alive — against testnet, meant to
be copied, filled in with your own contract addresses, and run
directly to confirm your setup works before writing any application-
specific code on top of it.

```ts
// walkthrough.ts — run with: npx tsx walkthrough.ts
import {
  connectFactory,
  connectVault,
  deployVaultViaFactory,
  getVaultSnapshot,
  collectVaultsByOwner,
  keepOwnerVaultsAlive,
  decodeVaultEvents,
} from "@lumenforge/sdk";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { KeypairSigner } from "@stellar/stellar-sdk/contract";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const FACTORY_CONTRACT = process.env.FACTORY_CONTRACT!; // fill in your deployed factory
const TOKEN_CONTRACT = process.env.TOKEN_CONTRACT!;       // fill in a SEP-41 token you control

async function main() {
  // Step 0: a fresh, funded test account.
  const keypair = Keypair.random();
  console.log("Test account:", keypair.publicKey());
  await fetch(`https://friendbot.stellar.org/?addr=${keypair.publicKey()}`);
  const signer = new KeypairSigner(keypair, NETWORK_PASSPHRASE);

  // Step 1: connect to the factory.
  const factory = await connectFactory({
    contractId: FACTORY_CONTRACT,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: signer.address,
    signTransaction: signer,
  });

  // Step 2: deploy a vault through it, with a deterministic address
  // for this walkthrough's own nonce so re-running this script
  // against the same account resolves to the same vault instead of
  // deploying a fresh one every time (and failing on the second run,
  // per the "reusing a salt" note in api-reference.md).
  console.log("Deploying vault...");
  const deployTx = await deployVaultViaFactory(
    factory,
    { owner: signer.address, token: TOKEN_CONTRACT, min_deposit: 0n },
    { salt: { nonce: 0 } },
  );
  const { result: vaultAddress } = await deployTx.signAndSend();
  console.log("Vault deployed at:", vaultAddress);

  const vault = await connectVault({
    contractId: vaultAddress,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: signer.address,
    signTransaction: signer,
  });

  // Step 3: read its initial state.
  console.log("Initial snapshot:", await getVaultSnapshot(vault));

  // Step 4: deposit — this requires TOKEN_CONTRACT tokens actually
  // being available to `signer`'s account already; if this step
  // fails with a token-contract-level error rather than one of
  // lumen_vault's own error codes, that's the likely cause — see
  // token-vetting-checklist.md and this token's own issuance process.
  console.log("Depositing 100...");
  const depositTx = await vault.deposit({ from: signer.address, amount: 100n });
  const depositResult = await depositTx.signAndSend();
  console.log("New balance after deposit:", depositResult.result);

  // Step 5: list this owner's vaults via the factory (should include
  // the one we just deployed).
  const allVaults = await collectVaultsByOwner(factory, signer.address);
  console.log("This owner's vaults:", allVaults);

  // Step 6: read events from around the ledger we just deposited on.
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  const { events } = await server.getEvents({
    filters: [{ type: "contract", contractIds: [vaultAddress] }],
    startLedger: Math.max(0, latest.sequence - 100),
  });
  console.log("Recent vault events:", decodeVaultEvents(events));

  // Step 7: keep this owner's vaults alive (harmless to run
  // immediately after deployment — extend_ttl only actually extends
  // anything if the remaining TTL is at or below the threshold, which
  // a freshly-deployed vault's TTL almost certainly isn't yet, so
  // this call is expected to be a no-op extension in this
  // walkthrough, not an error).
  const keepAliveResults = await keepOwnerVaultsAlive(
    factory,
    signer.address,
    (address) => connectVault({ contractId: address, rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, publicKey: signer.address, signTransaction: signer }),
  );
  console.log("Keep-alive results:", keepAliveResults);

  console.log("\nWalkthrough complete. Vault address:", vaultAddress);
}

main().catch((err) => {
  console.error("Walkthrough failed:", err);
  process.exitCode = 1;
});
```

Running this against a factory with no `TOKEN_CONTRACT` balance
available to the freshly-generated test account will fail at step 4
(deposit) — that's expected and not a bug in this script; either fund
the test account with the token first (outside this script's scope,
since it depends entirely on how your specific token is issued/
distributed), or comment out steps 4 onward to confirm the deployment-
and-read path works before tackling token funding separately.

## Migrating existing code to the newer helpers

If you started integrating with this SDK before the snapshot/event/
keeper helpers existed (any version prior to 0.7.0) and have hand-
rolled equivalents already, here's the direct mapping to replace them
with the now-standard helpers — each of these is a drop-in
replacement, not a behavior change:

| If your code currently does this | Replace with |
|---|---|
| `Promise.all([vault.balance(), vault.owner(), vault.token(), ...])` and manually unwraps each `.result` | `getVaultSnapshot(vault)` |
| A hand-written loop calling `factory.vaults_by_owner({ owner, offset, limit })` and tracking `offset` yourself | `collectVaultsByOwner(factory, owner)` / `iterateVaultsByOwner(factory, owner)` |
| A loop over addresses from `vaults_by_owner`, individually calling `connectVault` + your own balance/state reads for each | `collectVaultSnapshotsByOwner(factory, owner, connect)` / `iterateVaultSnapshotsByOwner(...)` |
| Manually parsing `server.getEvents()`'s raw `xdr.ScVal` topics/data yourself | `decodeVaultEvent`/`decodeFactoryEvent` (single) or `decodeVaultEvents`/`decodeFactoryEvents` (batch) |
| A cron script calling `vault.extend_ttl(...)`/`factory.extend_ttl(...)` directly with hand-picked threshold/extend_to values | `extendTtl(target)` (sane defaults) or `keepAlive([target1, target2, ...])` for a batch with per-target failure isolation |
| A cron script that first calls `vaults_by_owner` to get addresses, then extends each one's TTL in a loop you wrote | `keepOwnerVaultsAlive(factory, owner, connect)` |
| Passing a raw random `Buffer` you generated yourself as `deploy_vault`'s `salt` | `randomSalt()` (equivalent, just named) or — if you actually wanted a deterministic address — `deployVaultViaFactory(factory, args, { salt: { nonce } })`, which almost certainly better expresses the actual intent than a raw random buffer would |

None of these migrations change on-chain behavior — they're purely
call-site simplifications. The one exception worth flagging: if your
hand-rolled pagination loop assumed a fixed page size without ever
checking `vaults_by_owner_count`, migrating to `collectVaultsByOwner`
means you get the count-driven termination path "for free" (see
[api-reference.md](api-reference.md#pagination-iteratevaultsbyowner-collectvaultsbyowner))
— strictly more robust, never less.

## Framework-specific notes

### Browser / frontend applications

Replace the `Keypair`/`KeypairSigner` pattern shown throughout this
guide with a SEP-43 wallet's own `signTransaction` callback (e.g. from
Freighter or any compatible wallet extension) — never construct a
`Keypair` from a user's secret key in frontend code; the whole point
of a wallet extension is that the application never sees the secret
at all.

```ts
// Freighter example — check that extension's own docs for the exact
// current API shape, since wallet integration APIs evolve
// independently of this SDK.
import { signTransaction as freighterSign, getPublicKey } from "@stellar/freighter-api";

const publicKey = await getPublicKey();
const vault = await connectVault({
  contractId: "C...",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  publicKey,
  signTransaction: (xdr, opts) => freighterSign(xdr, opts),
});
```

### Server-side / backend applications

The `Keypair`/`KeypairSigner` pattern shown throughout this guide is
exactly right for a backend service holding its own signing key (a
service account, a keeper, a deployment script) — this is the
intended use case for that pattern, not a workaround.

### Serverless / edge functions

Nothing about this SDK is incompatible with a serverless environment
(no persistent local state is required between invocations — every
`connectVault`/`connectFactory` call fetches the contract spec fresh
each time, as noted in [api-reference.md](cli-reference.md#frequently-asked-questions)
for the CLI, and the same is true of the library used directly). The
one practical consideration is cold-start latency: each invocation
pays the cost of fetching the contract spec again, since there's no
persistent process to cache it in memory across invocations the way a
long-running server process naturally would. For a high-traffic
serverless integration where this overhead matters, consider whether
your platform offers any persistent-connection or warm-instance
mechanism, and cache the connected client across invocations within
that mechanism if so.

## Troubleshooting

### "Missing required environment variable" when using the CLI, but my script uses different variable names

The CLI's environment variables (`LUMENFORGE_RPC_URL`, etc.,
documented exhaustively in [cli-reference.md](cli-reference.md)) are
specific to the CLI binary — the library itself has no equivalent
environment-variable requirement, since every `connectVault`/
`connectFactory` call takes its configuration as explicit function
arguments. If you're writing a script (not using the CLI) and want to
source configuration from environment variables for your own
convenience, that's your own code's design choice, not something this
SDK requires or reads automatically.

### A deposit/withdraw call hangs

Most likely one of: an unreachable RPC endpoint, a signer that never
resolves (e.g. a wallet-extension callback waiting on user approval
that never comes because the extension popup is blocked or the
`signTransaction` promise was never actually connected to real UI),
or — less commonly — an RPC endpoint that accepted the submission but
is slow to report confirmation, which `signAndSend()`'s own polling
will eventually resolve or time out on, depending on the underlying
library's configured timeout.

### `TypeError: Cannot read properties of undefined` somewhere deep in `@stellar/stellar-sdk`

Usually means a malformed or mismatched `contractId` — one that isn't
a valid address, or one that IS valid but doesn't correspond to a
contract matching the spec `connectVault`/`connectFactory` expects
(e.g. you connected with `connectVault` to an address that's actually
a `lumen_vault_factory`, or a completely unrelated contract). Double-
check the address and which connect function you used.

### My deployed vault doesn't show up in `vaults_by_owner`

Check whether it was deployed via `deployVault` (direct) rather than
`deployVaultViaFactory` — only the latter registers the vault in any
factory's index. See
[Choosing between direct deployment and factory deployment](#choosing-between-direct-deployment-and-factory-deployment)
above.

### I'm getting `InsufficientBalance` but I'm sure the vault has enough

`InsufficientBalance` on `withdraw` compares against the vault's
*own* internal `Balance` counter, not the underlying SEP-41 token's
real balance held by the vault's contract address — these are
supposed to always agree for a conforming token, but can drift apart
for a fee-on-transfer or rebasing token; see
[token-vetting-checklist.md](token-vetting-checklist.md) for exactly
this failure mode and how to check for it before it happens.

## Before you point a vault at a token

Read [token-vetting-checklist.md](token-vetting-checklist.md) first —
`LumenVault` assumes the token behaves like a conforming SEP-41
implementation, and a fee-on-transfer or rebasing token will desync the
vault's internal accounting from its real holdings.
