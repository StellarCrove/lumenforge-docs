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

## CLI

The `lumenforge` binary wraps a subset of the above for scripting.
Full command reference (flags, environment variables, the secret-key
handling model) lives in the SDK README's
[CLI section](https://github.com/StellarCrove/lumenforge-sdk#cli) — not
duplicated here since the source of truth for exact flag names is the
CLI's own `--help` output, which that section is kept in sync with.
