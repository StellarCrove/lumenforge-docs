# Integration Guide

A task-oriented walkthrough of integrating with LumenForge via
`@lumenforge/sdk`. For the full API, see the
[SDK README](https://github.com/StellarCrove/lumenforge-sdk#readme); this
guide is the order you'd actually do things in.

## 1. Install

```bash
npm install @lumenforge/sdk
```

Requires Node ≥ 22.

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

See the SDK README's [Keeping contracts alive](https://github.com/StellarCrove/lumenforge-sdk#keeping-contracts-alive-ttl)
section for `extendTtl`/`extendVaultsByOwnerTtl` if you need finer
control than the batch helper.

## Before you point a vault at a token

Read [token-vetting-checklist.md](token-vetting-checklist.md) first —
`LumenVault` assumes the token behaves like a conforming SEP-41
implementation, and a fee-on-transfer or rebasing token will desync the
vault's internal accounting from its real holdings.
