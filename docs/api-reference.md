# API Reference

The full surface of `@lumenforge/sdk`, in detail: every exported
function's parameters, return type, defaults, and failure modes — not
just a pointer to go read the source. For *when* to reach for each of
these, see [integration-guide.md](integration-guide.md); this page is
the reference you come back to once you know what you're looking for.

All contract calls go through `contract.Client` under the hood: each
returns an `AssembledTransaction<T>`. Read-only calls already have
`.result` populated from simulation; state-changing calls need
`.signAndSend()` first, after which `.result` holds the resolved value.

## Vault client

### `connectVault(options)`

Connects to an already-deployed `lumen_vault` contract.

| Param | Type | Required | Notes |
|---|---|---|---|
| `options.contractId` | `string` | yes | The vault's `C…` address. |
| `options.rpcUrl` | `string` | yes | Soroban RPC endpoint. |
| `options.networkPassphrase` | `string` | yes | e.g. `"Test SDF Network ; September 2015"`. |
| `options.publicKey` | `string` | yes | The invoking account (`G…`) — needed even for reads, to simulate against. |
| `options.signTransaction` | `SignTransactionLike` | for writes | A SEP-43 callback, a `Signer`, or a `Keypair`. Omit for read-only use. |
| `options.allowHttp` | `boolean` | no | Set for an `http://` RPC endpoint (a local network). Never for production. |

Returns `Promise<VaultClient>`. Throws if `contractId` doesn't resolve
to a contract with the expected spec.

### `deployVault(args, options)`

Deploys a new `lumen_vault` **directly** — not through the factory, so
it will not appear in `vaults_by_owner`. Use `deployVaultViaFactory`
(below) unless you specifically don't want the on-chain index entry.

| Param | Type | Required | Notes |
|---|---|---|---|
| `args.owner` | `string` | yes | `G…` address that will control the vault. |
| `args.token` | `string` | yes | `C…` address of the SEP-41 token this vault custodies. |
| `args.min_deposit` | `bigint` | yes | Minimum accepted `deposit` amount. `0n` for no minimum. |
| `args.max_balance` | `bigint \| undefined` | no | Cap on total `Balance`. `undefined` for no cap. |
| `options.wasmHash` | `Buffer \| string` | yes | Hash of the `lumen_vault` Wasm, already installed on-chain. |
| `options.salt` | `Buffer \| Uint8Array` | no | Deployment salt. Default: a fresh random 32 bytes. |
| ...plus all of `connectVault`'s network/signing options | | yes | |

Returns `Promise<AssembledTransaction<VaultClient>>`. After
`.signAndSend()`, `.result` is a `VaultClient` already connected to the
new instance.

### Vault methods (`VaultClient`)

Every method below is called as `vault.<name>(args?, options?)` and
returns `Promise<AssembledTransaction<ReturnType>>`. State-changing
methods require `.signAndSend()`; the "Auth" column names whose
signature the transaction needs.

| Method | Args | Returns | Auth | Errors it can throw |
|---|---|---|---|---|
| `deposit` | `{ from: string, amount: bigint }` | `bigint` (new balance) | `from` | `InvalidAmount`, `Paused`, `BelowMinimumDeposit`, `Overflow`, `ExceedsMaxBalance` |
| `withdraw` | `{ amount: bigint }` | `bigint` (new balance) | `owner` | `InvalidAmount`, `InsufficientBalance`, `Overflow` |
| `pause` | — | `null` | `owner` | — |
| `unpause` | — | `null` | `owner` | — |
| `set_min_deposit` | `{ min_deposit: bigint }` | `null` | `owner` | `InvalidConfiguration` |
| `set_max_balance` | `{ max_balance: bigint \| undefined }` | `null` | `owner` | `InvalidConfiguration` |
| `rescue` | `{ token: string, to: string, amount: bigint }` | `null` | `owner` | `InvalidAmount`, `CannotRescueVaultToken` |
| `propose_owner` | `{ new_owner: string }` | `null` | `owner` | — |
| `cancel_pending_owner` | — | `null` | `owner` | `NoPendingOwner` |
| `accept_owner` | — | `null` | `pending_owner` | `NoPendingOwner` |
| `balance` | — | `bigint` | none (read) | — |
| `owner` | — | `string` | none (read) | `NotInitialized` |
| `pending_owner` | — | `string \| undefined` | none (read) | — |
| `token` | — | `string` | none (read) | `NotInitialized` |
| `min_deposit` | — | `bigint` | none (read) | — |
| `max_balance` | — | `bigint \| undefined` | none (read) | — |
| `paused` | — | `boolean` | none (read) | — |
| `extend_ttl` | `{ threshold: number, extend_to: number }` | `null` | none — callable by anyone | — |

`extend_ttl`'s `threshold`/`extend_to` are ledger counts, not
durations: `extend_to` is the ledger number to extend *to* (relative to
current), and `extend_to` must be `>= threshold`. Prefer
`extendTtl(vault)` (below) over calling this directly — it fills in
sane defaults and validates them.

## Factory client

### `connectFactory(options)`

Same shape as `connectVault`, for a deployed `lumen_vault_factory`.
Returns `Promise<FactoryClient>`.

### `deployVaultViaFactory(factory, args, options?)`

Deploys a `lumen_vault` **through the factory** — it lands in
`vaults_by_owner`. Handles salt derivation so most callers never touch
a raw salt.

| Param | Type | Required | Notes |
|---|---|---|---|
| `factory` | `VaultDeployer` (a `FactoryClient` works) | yes | |
| `args.owner` | `string` | yes | |
| `args.token` | `string` | yes | |
| `args.min_deposit` | `bigint` | yes | |
| `args.max_balance` | `bigint \| undefined` | no | |
| `options.salt` | `Buffer \| Uint8Array \| { nonce: number }` | no | Explicit 32-byte salt, a deterministic `{ nonce }` (via `ownerNonceSalt`), or omit for `randomSalt()`. |

Returns `Promise<AssembledTransaction<string>>` — `.result` after
`.signAndSend()` is the new vault's `C…` address. Throws synchronously
(before any network call) if an explicit `salt` isn't exactly 32 bytes.
Rejects with `TooManyVaultsForOwner` if `owner` has hit the per-factory
cap (100 vaults), `CountOverflow` if the factory's global counter would
overflow `u32`.

### Factory methods (`FactoryClient`)

| Method | Args | Returns | Auth | Errors |
|---|---|---|---|---|
| `deploy_vault` | `{ owner, token, min_deposit, max_balance, salt: Buffer }` | `string` (new vault address) | `owner` | `NotInitialized`, `TooManyVaultsForOwner`, `CountOverflow` |
| `vault_count` | — | `number` | none (read) | — |
| `vaults_by_owner` | `{ owner: string, offset: number, limit: number }` | `string[]` | none (read) | — |
| `vaults_by_owner_count` | `{ owner: string }` | `number` | none (read) | — |
| `vault_wasm_hash` | — | `Buffer` | none (read) | `NotInitialized` |
| `extend_ttl` | `{ threshold, extend_to }` | `null` | none | — |
| `extend_vaults_by_owner_ttl` | `{ owner, threshold, extend_to }` | `null` | none | `NoVaultsForOwner` |

### Pagination: `iterateVaultsByOwner` / `collectVaultsByOwner`

```ts
iterateVaultsByOwner(factory, owner, options?): AsyncGenerator<string>
collectVaultsByOwner(factory, owner, options?): Promise<string[]>
```

`options`: `{ pageSize?: number (default 50), maxPages?: number (default 1000) }`.

Both are **guaranteed to terminate**. If `factory` exposes
`vaults_by_owner_count` (any real `FactoryClient` does), the total is
read once and iteration stops at exactly that many — `maxPages` is
unused on this path. Otherwise it stops at the first page shorter than
`pageSize`, and throws if `maxPages` is hit first without that ever
happening (protection against a contract that always returns full
pages). Throws synchronously if `pageSize`/`maxPages` isn't a positive
integer.

### `iterateVaultSnapshotsByOwner` / `collectVaultSnapshotsByOwner`

```ts
iterateVaultSnapshotsByOwner(factory, owner, connect, options?): AsyncGenerator<VaultWithSnapshot>
collectVaultSnapshotsByOwner(factory, owner, connect, options?): Promise<VaultWithSnapshot[]>
```

Same pagination as above, but each address is resolved into its full
`getVaultSnapshot` (see below) before being yielded.
`VaultWithSnapshot` is `VaultSnapshot & { address: string }`.

`connect: (address: string) => Promise<VaultReader>` is supplied by the
caller — typically `(address) => connectVault({ contractId: address, ...sameNetworkOptions })`.
Vaults are connected and read **sequentially**, not in parallel — a
page of N vaults costs N round trips, trading speed for a predictable
request rate against the RPC endpoint.

### `keepOwnerVaultsAlive(factory, owner, connect, options?)`

Discovers every vault `owner` has (via `iterateVaultsByOwner`) and
extends each one's TTL (see [TTL keeper](#ttl-keeper) below).

```ts
keepOwnerVaultsAlive(
  factory: VaultsByOwnerReader,
  owner: string,
  connect: (address: string) => Promise<TtlExtendable>,
  options?: PaginationOptions & KeepAliveOptions,
): Promise<KeepOwnerVaultsAliveResult[]>
```

Returns one `{ address, status: "ok" | "error", error? }` per
discovered vault — one failing doesn't stop the rest. Does **not** also
extend the factory's own `VaultsByOwner(owner)` entry TTL; pair with
`extendVaultsByOwnerTtl` if you want both.

## Salts

### `randomSalt(): Buffer`

32 cryptographically random bytes (`crypto.getRandomValues`). No
arguments, never throws.

### `ownerNonceSalt(owner, nonce): Promise<Buffer>`

Deterministic: `SHA-256("${owner}:${nonce}")`. The same `(owner, nonce)`
always produces the same salt, hence the same deployed vault address.

`nonce` must be a non-negative safe integer (`Number.isSafeInteger`) —
throws synchronously (`ownerNonceSalt: nonce must be a non-negative safe integer, got ${nonce}`)
otherwise, rather than hashing a value the caller couldn't reproduce by
counting.

## Errors

`connectVault`/`connectFactory`/`deployVault` all wire up `errorTypes`
automatically, so a failed call throws with the message below instead
of a raw host trap.

**`VAULT_ERROR_TYPES`** (mirrors `lumen_vault`'s `Error` enum):

| Code | Name | Message |
|---|---|---|
| 1 | `NotInitialized` | the vault has no owner set. |
| 2 | `InvalidAmount` | amount must be a positive integer. |
| 3 | `InsufficientBalance` | withdrawal exceeds the vault's balance. |
| 4 | `Paused` | the vault is paused and is not accepting deposits. |
| 5 | `NoPendingOwner` | there is no pending ownership transfer to accept or cancel. |
| 6 | `Overflow` | deposit would overflow the balance. |
| 7 | `BelowMinimumDeposit` | amount is below the vault's min_deposit. |
| 8 | `ExceedsMaxBalance` | deposit would push balance above max_balance. |
| 9 | `CannotRescueVaultToken` | rescue cannot move the vault's own token. |
| 10 | `InvalidConfiguration` | min_deposit/max_balance cannot be negative. |

**`FACTORY_ERROR_TYPES`** (mirrors `lumen_vault_factory`'s `Error` enum):

| Code | Name | Message |
|---|---|---|
| 1 | `NotInitialized` | the factory has no vault Wasm hash set. |
| 2 | `NoVaultsForOwner` | this owner has never deployed a vault through this factory. |
| 3 | `CountOverflow` | the factory's vault counter would exceed u32::MAX. |
| 4 | `TooManyVaultsForOwner` | this owner has hit the per-owner vault cap for this factory. |

## TTL keeper

Neither contract can renew its own storage TTL — Soroban contracts
can't self-trigger. These are the off-chain half of that mechanism.

### `extendTtl(target, options?)`

```ts
extendTtl(target: TtlExtendable, options?: KeepAliveOptions): Promise<AssembledTransaction<null>>
```

`target` is a `VaultClient` or `FactoryClient` (anything with
`extend_ttl`). `KeepAliveOptions`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `threshold` | `number` | `17280` (~1 day at 5s/ledger) | Only extend if remaining TTL is at or below this. |
| `extendTo` | `number` | `518400` (~30 days) | Ledger to extend *to* (absolute distance from current, not a duration). |

Throws synchronously if `threshold` isn't a non-negative integer, or if
`extendTo < threshold`.

### `extendVaultsByOwnerTtl(factory, owner, options?)`

Same options, but extends a factory's per-owner `VaultsByOwner` entry
instead of the target's own instance TTL. Rejects with
`NoVaultsForOwner` if `owner` has never deployed through this factory.

### `keepAlive(targets, options?)`

```ts
keepAlive<T extends TtlExtendable>(targets: readonly T[], options?: KeepAliveOptions): Promise<KeepAliveResult<T>[]>
```

Runs `extendTtl` + `.signAndSend()` across every target in `targets`
(mix vaults and factories freely). Returns one
`{ target, status: "ok" | "error", error? }` per target — one failing
doesn't stop the rest, so a scheduled run can retry just what failed.

`keepOwnerVaultsAlive` (documented under Factory client above) is the
fleet-discovery version of this — use it when you don't already have
the list of vault addresses in hand.

## State snapshots

### `getVaultSnapshot(vault): Promise<VaultSnapshot>`

Reads `balance`, `owner`, `pending_owner`, `token`, `min_deposit`,
`max_balance`, `paused` in one `Promise.all` batch instead of seven
sequential round trips.

```ts
interface VaultSnapshot {
  balance: bigint;
  owner: string;
  pendingOwner: string | undefined;
  token: string;
  minDeposit: bigint;
  maxBalance: bigint | undefined;
  paused: boolean;
}
```

Rejects if any individual read would (e.g. `NotInitialized` for a
vault that somehow isn't) — this doesn't swallow that, it just doesn't
make you sequence the calls to find out.

### `getFactorySnapshot(factory): Promise<FactorySnapshot>`

```ts
interface FactorySnapshot {
  vaultCount: number;
  vaultWasmHash: Buffer;
}
```

Reads `vault_count` and `vault_wasm_hash` in parallel. This is the
factory's *own* state — not any specific owner's vaults (use
`collectVaultSnapshotsByOwner` for that).

## Events

Neither client decodes event bodies from a call's return value —
these decode the raw events themselves (e.g. from
`server.getEvents()`, whose response shape they match directly).

### `decodeVaultEvent(event): VaultEvent | undefined`

`event: { topic: xdr.ScVal[], value: xdr.ScVal }`. Returns `undefined`
for anything that isn't a recognized `lumen_vault` event — including
the SEP-41 token's own `transfer` event, which appears alongside
`deposit`/`withdraw`/`rescue`. Never throws.

**`VaultEvent` variants** (discriminated by `.type`):

| `.type` | Fields | Emitted by |
|---|---|---|
| `deposit` | `from: string, amount: bigint, new_balance: bigint` | `deposit` |
| `withdraw` | `owner: string, amount: bigint, new_balance: bigint` | `withdraw` |
| `paused` | `owner: string` | `pause` |
| `resumed` | `owner: string` | `unpause` |
| `owner_proposed` | `new_owner: string` | `propose_owner` |
| `owner_proposal_cancelled` | `cancelled_owner: string` | `cancel_pending_owner` |
| `owner_transferred` | `new_owner: string` | `accept_owner` |
| `min_deposit_updated` | `min_deposit: bigint` | `set_min_deposit` |
| `max_balance_updated` | `max_balance: bigint \| undefined` | `set_max_balance` |
| `rescued` | `token: string, to: string, amount: bigint` | `rescue` |

### `decodeFactoryEvent(event): FactoryEvent | undefined`

**`FactoryEvent` variants:**

| `.type` | Fields | Emitted by |
|---|---|---|
| `vault_deployed` | `owner: string, vault: string` | `deploy_vault` |

### `decodeVaultEvents(events)` / `decodeFactoryEvents(events)`

Batch versions: map + filter a whole `events` array (e.g.
`getEvents()`'s response), dropping anything unrecognized. Equivalent
to `events.map(decodeVaultEvent).filter((e) => e !== undefined)`, just
without writing that every time.

## Complete examples

Every section above documents one function in isolation. These
combine several into a complete, runnable program for a realistic
task — the level most integrators actually need, once they know
*which* functions to reach for.

### Example: a minimal deposit/withdraw script

```ts
import { connectVault } from "@lumenforge/sdk";
import { Keypair } from "@stellar/stellar-sdk";
import { KeypairSigner } from "@stellar/stellar-sdk/contract";

async function main() {
  const rpcUrl = "https://soroban-testnet.stellar.org";
  const networkPassphrase = "Test SDF Network ; September 2015";
  const keypair = Keypair.fromSecret(process.env.SECRET_KEY!);
  const signer = new KeypairSigner(keypair, networkPassphrase);

  const vault = await connectVault({
    contractId: process.env.VAULT_CONTRACT!,
    rpcUrl,
    networkPassphrase,
    publicKey: signer.address,
    signTransaction: signer,
  });

  console.log("Balance before:", (await vault.balance()).result);

  const depositTx = await vault.deposit({ from: signer.address, amount: 500n });
  const depositResult = await depositTx.signAndSend();
  console.log("Balance after deposit:", depositResult.result);

  const withdrawTx = await vault.withdraw({ amount: 200n });
  const withdrawResult = await withdrawTx.signAndSend();
  console.log("Balance after withdrawal:", withdrawResult.result);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

### Example: deploying a new vault via the factory, with a deterministic address

```ts
import { connectFactory, deployVaultViaFactory } from "@lumenforge/sdk";
import { Keypair } from "@stellar/stellar-sdk";
import { KeypairSigner } from "@stellar/stellar-sdk/contract";

async function deployUserVault(userNonce: number, ownerSecret: string, token: string) {
  const rpcUrl = "https://soroban-testnet.stellar.org";
  const networkPassphrase = "Test SDF Network ; September 2015";
  const keypair = Keypair.fromSecret(ownerSecret);
  const signer = new KeypairSigner(keypair, networkPassphrase);

  const factory = await connectFactory({
    contractId: process.env.FACTORY_CONTRACT!,
    rpcUrl,
    networkPassphrase,
    publicKey: signer.address,
    signTransaction: signer,
  });

  const tx = await deployVaultViaFactory(
    factory,
    { owner: signer.address, token, min_deposit: 0n },
    { salt: { nonce: userNonce } },
  );
  const { result: vaultAddress } = await tx.signAndSend();
  return vaultAddress;
}
```

Calling `deployUserVault(0, secret, token)` twice for the same
`(ownerSecret, userNonce)` pair does **not** deploy a second vault —
the second call's transaction fails at the host level, since Soroban
refuses to deploy a contract to an address that already exists (the
address is fully determined by `(factory, salt, wasmHash)`, and the
salt here is deterministic). If you want a genuinely new vault for
the same owner, either increment `userNonce` or omit the `salt`
option entirely for a fresh random one.

### Example: a dashboard backend listing every vault an owner has

```ts
import { connectFactory, connectVault, collectVaultSnapshotsByOwner } from "@lumenforge/sdk";

async function getUserDashboard(ownerAddress: string) {
  const rpcUrl = "https://soroban-testnet.stellar.org";
  const networkPassphrase = "Test SDF Network ; September 2015";
  const factory = await connectFactory({
    contractId: process.env.FACTORY_CONTRACT!,
    rpcUrl,
    networkPassphrase,
    publicKey: ownerAddress, // read-only; no signer needed
  });

  const vaults = await collectVaultSnapshotsByOwner(
    factory,
    ownerAddress,
    (address) => connectVault({ contractId: address, rpcUrl, networkPassphrase, publicKey: ownerAddress }),
  );

  const totalBalance = vaults.reduce((sum, v) => sum + v.balance, 0n);
  return { vaults, totalBalance, vaultCount: vaults.length };
}
```

Note `totalBalance` is accumulated as a `bigint` (`0n` seed, `+`
between two `bigint`s) rather than converting to `number` first —
this is the correct pattern any time you're aggregating amounts from
this SDK, since converting to `number` risks precision loss for
values beyond `Number.MAX_SAFE_INTEGER` (about 9 * 10^15), which a
sufficiently large token amount can exceed even though it fits
comfortably in Soroban's `i128`.

### Example: a minimal event-driven indexer

```ts
import { rpc } from "@stellar/stellar-sdk";
import { decodeVaultEvents } from "@lumenforge/sdk";

interface DepositRecord {
  ledger: number;
  from: string;
  amount: bigint;
  newBalance: bigint;
}

async function indexDeposits(
  vaultContractId: string,
  fromLedger: number,
): Promise<DepositRecord[]> {
  const server = new rpc.Server("https://soroban-testnet.stellar.org");
  const records: DepositRecord[] = [];

  const { events, latestLedger } = await server.getEvents({
    filters: [{ type: "contract", contractIds: [vaultContractId] }],
    startLedger: fromLedger,
  });

  for (const decoded of decodeVaultEvents(events)) {
    if (decoded.type === "deposit") {
      records.push({
        ledger: fromLedger, // see note below
        from: decoded.from,
        amount: decoded.amount,
        newBalance: decoded.new_balance,
      });
    }
  }

  console.log(`Indexed ${records.length} deposits up to ledger ${latestLedger}`);
  return records;
}
```

This example glosses over one real detail worth flagging explicitly:
`Api.EventResponse` (what `getEvents`'s `events` array actually
contains) carries its own `ledger` field per event — the snippet above
uses the loop's `fromLedger` as a placeholder rather than
`raw.ledger`, which is wrong for anything spanning more than one
ledger. A correct version reads `event.ledger` from each raw event
before decoding, since `decodeVaultEvent`/`decodeVaultEvents` only
return the decoded *event data*, not the surrounding ledger/
transaction metadata that came with it on the wire — you have to
capture that yourself from the original `Api.EventResponse` object,
zipped against the decoded results by index if you go through the
batch `decodeVaultEvents` (which drops entries, so a naive index-
based zip is also wrong once any event in the batch is unrecognized
and dropped — decode one at a time with `decodeVaultEvent` in the
loop, as shown, when you need to correlate decoded events back to
their raw metadata).

### Example: a keeper microservice

```ts
import { connectFactory, connectVault, keepOwnerVaultsAlive } from "@lumenforge/sdk";
import { extendVaultsByOwnerTtl } from "@lumenforge/sdk";
import { Keypair } from "@stellar/stellar-sdk";
import { KeypairSigner } from "@stellar/stellar-sdk/contract";

async function runKeeperCycle(owners: string[]) {
  const rpcUrl = process.env.LUMENFORGE_RPC_URL!;
  const networkPassphrase = process.env.LUMENFORGE_NETWORK_PASSPHRASE!;
  const keypair = Keypair.fromSecret(process.env.KEEPER_SECRET_KEY!);
  const signer = new KeypairSigner(keypair, networkPassphrase);

  const factory = await connectFactory({
    contractId: process.env.FACTORY_CONTRACT!,
    rpcUrl,
    networkPassphrase,
    publicKey: signer.address,
    signTransaction: signer,
  });

  for (const owner of owners) {
    const results = await keepOwnerVaultsAlive(
      factory,
      owner,
      (address) => connectVault({ contractId: address, rpcUrl, networkPassphrase, publicKey: signer.address, signTransaction: signer }),
    );

    const failures = results.filter((r) => r.status === "error");
    if (failures.length > 0) {
      console.error(`Owner ${owner}: ${failures.length} vault(s) failed to extend`, failures);
    }

    // Also keep the factory's own per-owner index entry alive.
    await (await extendVaultsByOwnerTtl(factory, owner)).signAndSend();
  }
}

// e.g. invoked by a scheduler every night
runKeeperCycle(["G...", "G...", "G..."]).catch(console.error);
```

## Common mistakes

Patterns that compile, often even run without immediately throwing,
but produce wrong or fragile results.

**Converting a `bigint` amount to `number` before comparing or doing
arithmetic on it.** `Number(someBigint) > Number(otherBigint)` looks
correct and usually *is* correct for small values, but silently loses
precision for large ones. Compare/add/subtract `bigint`s directly
(`someBigint > otherBigint`, `a + b`) and only convert to `number` at
the very last step, for display, and only after confirming the value
is within safe integer range if that matters for your use case.

**Assuming `vaults_by_owner`'s index reflects current ownership.** As
documented in [data-model.md](data-model.md#the-factorys-index-is-a-cache-not-a-source-of-truth),
the factory's index reflects who *deployed* a vault, not who
currently *owns* it after any `propose_owner`/`accept_owner` transfer.
Always read a vault's own `owner()` (or the `owner` field from
`getVaultSnapshot`) if current ownership is what actually matters for
your logic.

**Reusing a deterministic salt/nonce expecting a new address.**
`deployVaultViaFactory(factory, args, { salt: { nonce: 0 } })` always
resolves to the same address for the same owner. Calling it twice
doesn't deploy a second vault — the second call fails outright at the
host level, before any of `lumen_vault_factory`'s own error codes
would even apply. Increment the nonce (or track a per-owner counter
yourself, e.g. from `vault_count`/`vaults_by_owner_count`) for each
new vault you actually want deployed.

**Forgetting that `iterateVaultSnapshotsByOwner`/`collectVaultSnapshotsByOwner`/`keepOwnerVaultsAlive`
are sequential, not parallel.** For an owner with many vaults, this
can be slow — N vaults costs N round trips, one after another, by
design (see the note on request-rate predictability in each
function's documentation above). If you need faster fan-out and know
your RPC endpoint tolerates it, batch your own `Promise.all` over
`collectVaultsByOwner`'s plain address list plus your own
`getVaultSnapshot` calls, rather than assuming these particular
helpers parallelize for you.

**Calling a method and never calling `.signAndSend()` on a
state-changing one.** `const tx = await vault.deposit(...)` alone
does nothing on-chain — see
[The `AssembledTransaction` lifecycle](#the-assembledtransaction-lifecycle-in-depth)
above. This is an easy mistake to make when refactoring code that
used to immediately chain `.signAndSend()` and no longer does; nothing
throws when you forget it; the deposit simply never happens, silently,
from the chain's perspective (your local `tx.result` still shows the
simulated value, which can make the mistake harder to notice than it
otherwise would be).

**Assuming `getVaultSnapshot`/`getFactorySnapshot` are atomic
snapshots of a single ledger.** They issue several separate RPC calls
in parallel via `Promise.all`, each simulated independently. In the
narrow window between them, it is theoretically possible (though
practically rare, for calls issued milliseconds apart) for a
concurrent transaction to change one field before another field's
read completes, producing a snapshot that never existed as a single
consistent on-chain state. For most integrations this is an
acceptable approximation; if you need genuinely atomic multi-field
reads, that requires a lower-level approach reading all fields from
one ledger's state directly, which this SDK does not currently
provide a helper for.

## Full type reference

Every type this package exports, gathered in one place for quick
lookup — cross-referenced above where each is introduced, repeated
here without the surrounding prose.

```ts
// vaultClient.ts
interface VaultMethods { /* see "Vault methods" table above */ }
type VaultClient = Client & VaultMethods;
interface DeployVaultArgs {
  owner: string;
  token: string;
  min_deposit: bigint;
  max_balance?: bigint;
}
interface DeployVaultOptions extends MethodOptions, Omit<ClientOptions, "contractId" | "errorTypes"> {
  wasmHash: Buffer | string;
  salt?: Buffer | Uint8Array;
  format?: "hex" | "base64";
  address?: string;
}

// factoryClient.ts
interface FactoryMethods { /* see "Factory methods" table above */ }
type FactoryClient = Client & FactoryMethods;
interface DeployVaultViaFactoryArgs {
  owner: string;
  token: string;
  min_deposit: bigint;
  max_balance?: bigint;
}
interface DeployVaultViaFactoryOptions extends MethodOptions {
  salt?: Buffer | Uint8Array | { nonce: number };
}
interface VaultDeployer {
  deploy_vault(args: { owner: string; token: string; min_deposit: bigint; max_balance: bigint | undefined; salt: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<string>>;
}
interface VaultsByOwnerReader {
  vaults_by_owner(args: { owner: string; offset: number; limit: number }): Promise<{ result: string[] }>;
  vaults_by_owner_count?(args: { owner: string }): Promise<{ result: number }>;
}
interface PaginationOptions {
  pageSize?: number;
  maxPages?: number;
}
type VaultWithSnapshot = VaultSnapshot & { address: string };
interface KeepOwnerVaultsAliveResult {
  address: string;
  status: "ok" | "error";
  error?: unknown;
}

// keeper.ts
interface TtlExtendable {
  extend_ttl(args: { threshold: number; extend_to: number }, options?: MethodOptions): Promise<AssembledTransaction<null>>;
}
interface VaultsByOwnerTtlExtendable {
  extend_vaults_by_owner_ttl(args: { owner: string; threshold: number; extend_to: number }, options?: MethodOptions): Promise<AssembledTransaction<null>>;
}
interface KeepAliveOptions {
  threshold?: number;
  extendTo?: number;
}
interface KeepAliveResult<T> {
  target: T;
  status: "ok" | "error";
  error?: unknown;
}

// snapshot.ts
interface VaultSnapshot {
  balance: bigint;
  owner: string;
  pendingOwner: string | undefined;
  token: string;
  minDeposit: bigint;
  maxBalance: bigint | undefined;
  paused: boolean;
}
interface VaultReader {
  balance(): Promise<{ result: bigint }>;
  owner(): Promise<{ result: string }>;
  pending_owner(): Promise<{ result: string | undefined }>;
  token(): Promise<{ result: string }>;
  min_deposit(): Promise<{ result: bigint }>;
  max_balance(): Promise<{ result: bigint | undefined }>;
  paused(): Promise<{ result: boolean }>;
}
interface FactorySnapshot {
  vaultCount: number;
  vaultWasmHash: Buffer;
}
interface FactoryReader {
  vault_count(): Promise<{ result: number }>;
  vault_wasm_hash(): Promise<{ result: Buffer }>;
}

// events.ts
interface RawContractEvent {
  topic: xdr.ScVal[];
  value: xdr.ScVal;
}
interface DepositEvent { type: "deposit"; from: string; amount: bigint; new_balance: bigint; }
interface WithdrawEvent { type: "withdraw"; owner: string; amount: bigint; new_balance: bigint; }
interface PausedEvent { type: "paused"; owner: string; }
interface ResumedEvent { type: "resumed"; owner: string; }
interface OwnerProposedEvent { type: "owner_proposed"; new_owner: string; }
interface OwnerProposalCancelledEvent { type: "owner_proposal_cancelled"; cancelled_owner: string; }
interface OwnerTransferredEvent { type: "owner_transferred"; new_owner: string; }
interface MinDepositUpdatedEvent { type: "min_deposit_updated"; min_deposit: bigint; }
interface MaxBalanceUpdatedEvent { type: "max_balance_updated"; max_balance: bigint | undefined; }
interface RescuedEvent { type: "rescued"; token: string; to: string; amount: bigint; }
type VaultEvent = DepositEvent | WithdrawEvent | PausedEvent | ResumedEvent
  | OwnerProposedEvent | OwnerProposalCancelledEvent | OwnerTransferredEvent
  | MinDepositUpdatedEvent | MaxBalanceUpdatedEvent | RescuedEvent;
interface VaultDeployedEvent { type: "vault_deployed"; owner: string; vault: string; }
type FactoryEvent = VaultDeployedEvent;
```

## Error handling patterns

Every error this SDK's contract calls can throw arrives as a
JavaScript `Error` whose `.message` is the readable string from
`VAULT_ERROR_TYPES`/`FACTORY_ERROR_TYPES` (see [Errors](#errors)
above) — but a real integration usually wants to branch on *which*
error occurred, not just log the message. Two approaches, in order of
robustness:

### Matching on the error name prefix

Every message in `VAULT_ERROR_TYPES`/`FACTORY_ERROR_TYPES` is
formatted as `"ErrorName: human-readable explanation."` — the error
name always precedes the first colon. This is stable enough to match
on:

```ts
try {
  await (await vault.deposit({ from, amount })).signAndSend();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith("Paused:")) {
    // Handle a paused vault specifically — e.g. surface a friendly
    // "this vault isn't accepting deposits right now" to a UI.
  } else if (message.startsWith("BelowMinimumDeposit:")) {
    // Surface the vault's configured minimum, via a fresh min_deposit() read.
  } else {
    throw err; // re-throw anything we don't have specific handling for
  }
}
```

### Reading the raw error code

For code that needs to be resilient to the *message text* changing
(a wording tweak that doesn't change the error's meaning) but still
branch precisely, go one level lower and inspect the numeric error
code directly rather than the formatted message. This requires
digging into `AssembledTransaction`'s own error-parsing rather than
relying on the thrown `Error`'s `.message` — consult
`@stellar/stellar-sdk/contract`'s own type definitions for
`AssembledTransaction`'s simulation/send-result error shape, since
that's a lower-level API this document's scope (the LumenForge-
specific layer) doesn't itself re-document. In practice, matching on
the message prefix as shown above is what this project's own test
suites and examples do, and is considered a reasonable level of
coupling for most integrations — the error *names* (as opposed to
their numeric codes or exact wording) are treated as the stable part
of the contract's interface, changed only alongside a deliberate,
`CHANGELOG.md`-documented contract upgrade.

### A complete retry-with-backoff wrapper

Network-level failures (a transient RPC timeout, a rate limit) are
not contract errors at all, and deserve different handling — retrying
the whole call, rather than branching on error type. A minimal
wrapper:

```ts
async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 500 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      // Don't retry a genuine contract-level rejection — retrying
      // "InvalidAmount" or "Paused" wastes time and fees on a call
      // that will fail identically every time until something about
      // the actual on-chain state changes.
      const isContractError = /^[A-Za-z]+: /.test(message) &&
        (message in VAULT_ERROR_TYPES || message in FACTORY_ERROR_TYPES);
      if (isContractError || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastError;
}

// Usage:
const result = await withRetry(() =>
  vault.balance().then((tx) => tx.result),
);
```

The `isContractError` check above is illustrative rather than exact —
matching a message against the *values* of `VAULT_ERROR_TYPES` isn't
quite right since those are `{ message: string }` objects, not the
messages themselves used as object keys; a correct version would
check `Object.values(VAULT_ERROR_TYPES).some((e) => e.message === message)`
or, more robustly, match on the name prefix technique shown earlier
rather than exact full-message equality, since the exact phrasing
after the colon is more likely to drift across versions than the
name before it.

## Testing code that uses this SDK

Every interface this SDK exports for composition (`VaultReader`,
`FactoryReader`, `VaultsByOwnerReader`, `TtlExtendable`,
`VaultDeployer`, `RawContractEvent`) is a plain TypeScript interface,
not a class you're required to instantiate through a specific
constructor — which means you can satisfy any of them with a hand-
written fake object in a test, without spinning up a real (or even
simulated) Soroban network. This is exactly the pattern this SDK's own
test suite uses internally, and it's worth adopting for code that
*calls* this SDK, not just for the SDK's own tests.

### Faking a `VaultReader` for testing `getVaultSnapshot`-dependent code

```ts
import { describe, expect, it } from "vitest";
import { getVaultSnapshot, type VaultReader } from "@lumenforge/sdk";

function fakeVault(overrides: Partial<VaultReader> = {}): VaultReader {
  return {
    balance: async () => ({ result: 500n }),
    owner: async () => ({ result: "GOWNER" }),
    pending_owner: async () => ({ result: undefined }),
    token: async () => ({ result: "CTOKEN" }),
    min_deposit: async () => ({ result: 0n }),
    max_balance: async () => ({ result: undefined }),
    paused: async () => ({ result: false }),
    ...overrides,
  };
}

describe("my dashboard's balance formatting", () => {
  it("shows a paused badge when the vault is paused", async () => {
    const snapshot = await getVaultSnapshot(fakeVault({ paused: async () => ({ result: true }) }));
    expect(formatDashboardRow(snapshot)).toContain("PAUSED");
  });
});
```

### Faking a `VaultsByOwnerReader` for testing pagination-dependent code

```ts
import { collectVaultsByOwner, type VaultsByOwnerReader } from "@lumenforge/sdk";

function fakeReader(pages: string[][]): VaultsByOwnerReader {
  return {
    async vaults_by_owner({ offset, limit }) {
      const page = pages[Math.floor(offset / limit)] ?? [];
      return { result: page };
    },
    // Omit vaults_by_owner_count entirely to exercise the fallback
    // short-page-detection path instead of the count-driven one —
    // useful for testing that your code doesn't assume a specific
    // pagination strategy.
  };
}

const reader = fakeReader([["v1", "v2"], ["v3"]]);
const all = await collectVaultsByOwner(reader, "GOWNER", { pageSize: 2 });
// all === ["v1", "v2", "v3"]
```

### Faking a `RawContractEvent` for testing event-decoding-dependent code

Building a syntactically valid fake `xdr.ScVal` by hand (rather than
one that happens to work purely by coincidence) requires going
through `@stellar/stellar-sdk`'s own `nativeToScVal`/`xdr` helpers
correctly — this project's own `events.test.ts` (in the
`lumenforge-sdk` repository) is the canonical worked example of doing
this precisely, including the empirically-verified detail that a
zero-data-field event's data arrives as an *empty map*, not `Void`,
and that `Option::None` arrives as `Void` *inside* a data map rather
than as an absent key. Read that file directly rather than
re-deriving the pattern from scratch, since getting this wrong
produces tests that pass against your own incorrect assumption about
the wire format rather than against the format the real contract
actually produces.

### Why these fakes are safe to trust

Every one of the interfaces shown above (`VaultReader`,
`VaultsByOwnerReader`, etc.) is defined as *exactly* the subset of
methods the corresponding SDK function actually calls — not the full
`VaultClient`/`FactoryClient` surface. This is a deliberate API design
choice (documented inline in each interface's own source comment,
e.g. `VaultReader`'s "The subset of `VaultClient` this needs — any
real one has all of it") specifically so that a test fake only has to
implement the handful of methods actually exercised, rather than the
entire client surface, and so that a real `VaultClient` you already
have connected satisfies the interface without any adapter — you can
pass either a fake or a real connected client to `getVaultSnapshot`
interchangeably, which is what makes it possible to write a unit test
that exercises your *own* logic around `getVaultSnapshot` without a
live network, while still trusting that the same code path runs
against a real vault in production.

## CLI

The `lumenforge` binary wraps a subset of the above for scripting. See
[cli-reference.md](cli-reference.md) for the exhaustive command
reference — every flag, environment variable, exit code, and
automation recipe.

## The `AssembledTransaction` lifecycle, in depth

Every function documented above that touches the chain — every
`VaultClient`/`FactoryClient` method, `deployVault`,
`deployVaultViaFactory`, `extendTtl`, `extendVaultsByOwnerTtl` —
returns a `Promise<AssembledTransaction<T>>`, not the resolved value
`T` directly. Understanding what that object actually is and does
matters for using this SDK correctly, so it's worth spelling out in
full rather than assuming familiarity.

### What "assembled" means

Calling e.g. `vault.deposit({ from, amount })` does **not** submit
anything to the network by itself. It:

1. Encodes `{ from, amount }` into the XDR arguments the contract's
   `deposit` function expects, using the contract's own on-chain spec
   (fetched when you called `connectVault`) to know the exact
   parameter types and order.
2. Builds a Soroban `InvokeHostFunction` operation wrapping that call.
3. **Simulates** it against the RPC endpoint — this is a real network
   round trip, but not a submission; simulation tells you what the
   call *would* return and what resources it would consume, without
   committing anything.
4. Returns an `AssembledTransaction` wrapping the built (but not yet
   signed or sent) transaction, with `.result` already populated from
   the simulation's return value.

This is why a **read-only** call's `.result` is already meaningful
immediately after `await`ing the call, with no further action needed
— `balance()`, `owner()`, every `*Snapshot` helper, all rely on this:
simulation alone is enough to get an accurate answer for a call that
doesn't modify state, since there's nothing to actually commit.

### Why a state-changing call still needs `.signAndSend()`

For a call that *does* modify state (`deposit`, `withdraw`,
`deploy_vault`, `extend_ttl`, etc.), the simulation's result reflects
what *would* happen if the transaction were submitted and applied —
useful for a preview, and it's why `.result` is still populated
immediately (e.g. `deposit`'s `.result` before `.signAndSend()`
already tells you the balance the deposit would produce) — but the
actual state change on-chain doesn't happen until you call
`.signAndSend()`, which:

1. Signs the transaction using whatever `signTransaction` was supplied
   to `connectVault`/`connectFactory` (or thrown at construction time
   if none was supplied and the call needs signing).
2. Submits it to the network.
3. Polls until it's confirmed (or fails, or times out).
4. Re-resolves `.result` from the *actual* transaction outcome, not
   just the pre-submission simulation — in the overwhelmingly common
   case these agree, but they are not the same value by construction,
   and a lot can happen between simulation and confirmation (another
   transaction changing relevant state first, for instance) that
   could make them diverge.

```ts
const tx = await vault.deposit({ from: "G...", amount: 500n });
// tx.result here is from simulation — a preview, not yet real.
console.log("Simulated result:", tx.result);

const sent = await tx.signAndSend();
// sent.result here is from the actually-confirmed transaction.
console.log("Confirmed result:", sent.result);
```

### Why every code example in this document calls `.signAndSend()`
immediately, without inspecting the pre-submission `.result`

Purely for brevity in the examples — nothing prevents you from
holding onto the `AssembledTransaction`, inspecting its simulated
`.result`, its resource-fee estimate, or its built XDR, and deciding
*not* to send it after all. This is exactly the capability a
"dry run" workflow needs, referenced in
[cli-reference.md's FAQ](cli-reference.md#frequently-asked-questions)
as something the CLI doesn't expose but the library does, simply by
not calling `.signAndSend()` unconditionally.

### Options accepted at call time vs. at connect time

Every `VaultClient`/`FactoryClient` method accepts an optional
trailing `options?: MethodOptions` argument, distinct from the
`ClientOptions` passed to `connectVault`/`connectFactory` at
connection time. `MethodOptions` lets you override signing behavior
*per call* rather than for the whole connected client — useful if,
for instance, one client instance needs to make calls on behalf of
different signers at different times (rare, but the API supports it):

```ts
const vault = await connectVault({
  contractId,
  rpcUrl,
  networkPassphrase,
  publicKey: defaultSigner.address,
  signTransaction: defaultSigner,
});

// Uses defaultSigner, from the connect-time options above.
await (await vault.withdraw({ amount: 100n })).signAndSend();

// Overrides for just this one call.
await (await vault.withdraw({ amount: 100n }, {
  signTransaction: someOtherSigner,
})).signAndSend();
```

This SDK's own helpers (`deployVaultViaFactory`, `extendTtl`,
`keepAlive`, etc.) all forward their own `options` parameter straight
through to the underlying method call's `MethodOptions`, so anything
you could pass to a raw `vault.deposit(args, options)` call, you can
also pass through these higher-level wrappers — check each wrapper's
type signature (documented above) for exactly which options it
accepts versus which it computes itself (e.g. `deployVaultViaFactory`
computes `salt` itself from its own `options.salt`, but forwards
everything else in its `options` object unchanged).
