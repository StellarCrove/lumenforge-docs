# Data Model

What each contract actually stores, in which storage class, and why
that governs which `extend_ttl`-family call keeps it alive. This is the
detail behind [design-tradeoffs.md](design-tradeoffs.md#ttl-extension-is-a-mechanism-not-a-policy)'s
TTL note — verified directly against `lumen_vault`/`lumen_vault_factory`'s
source, not inferred from behavior.

Soroban has two storage classes relevant here:

- **Instance storage** — one bucket per contract, holding config/state
  that's small and always needed. Its TTL is bumped by
  `extend_ttl(threshold, extend_to)`, and letting it expire archives
  the *entire contract's* storage (every key in it) at once.
- **Persistent storage** — arbitrary keyed entries, each with its own
  independent TTL. Letting one entry's TTL expire archives only that
  entry — other persistent entries and the contract's instance storage
  are unaffected.

## `lumen_vault`

Every key `lumen_vault` stores is **instance storage** — there is no
persistent storage in this contract at all:

| `DataKey` | Type | Set by | Read by |
|---|---|---|---|
| `Owner` | `Address` | constructor, `accept_owner` | `owner()`, every owner-gated method |
| `PendingOwner` | `Address` (removed when absent) | `propose_owner` | `pending_owner()`, `accept_owner`, `cancel_pending_owner` |
| `Token` | `Address` | constructor (immutable after) | `token()`, `deposit`, `withdraw`, `rescue` |
| `Balance` | `i128` | constructor (`0`), `deposit`, `withdraw` | `balance()` |
| `Paused` | `bool` | constructor (`false`), `pause`, `unpause` | `paused()`, `deposit` |
| `MinDeposit` | `i128` | constructor, `set_min_deposit` | `min_deposit()`, `deposit` |
| `MaxBalance` | `i128` (absent = no cap) | constructor (if given), `set_max_balance` | `max_balance()`, `deposit` |

Because everything lives in instance storage, a single
`extend_ttl(threshold, extend_to)` call keeps the **entire vault**
alive — there's nothing else to separately extend. This is why
`lumen_vault`'s SDK surface has exactly one TTL method
(`VaultMethods.extend_ttl`, wrapped by `extendTtl`) and no per-key
equivalent.

## `lumen_vault_factory`

Mixed: two instance keys plus one persistent key *per owner*.

| `DataKey` | Storage | Type | Set by | Read by |
|---|---|---|---|---|
| `VaultWasmHash` | instance | `BytesN<32>` | constructor (immutable) | `vault_wasm_hash()`, `deploy_vault` |
| `VaultCount` | instance | `u32` | constructor (`0`), `deploy_vault` | `vault_count()` |
| `VaultsByOwner(Address)` | **persistent**, one entry per owner | `Vec<Address>`, capped at `MAX_VAULTS_PER_OWNER` (100) | `deploy_vault` (appends) | `vaults_by_owner()`, `vaults_by_owner_count()` |

This split is exactly why the factory exposes **two** TTL methods
instead of one:

- `extend_ttl(threshold, extend_to)` — extends the factory's instance
  storage (`VaultWasmHash`, `VaultCount`). Callable by anyone; wrapped
  by the SDK's `extendTtl`.
- `extend_vaults_by_owner_ttl(owner, threshold, extend_to)` — extends
  *one specific owner's* `VaultsByOwner` persistent entry. Independent
  of the instance TTL and of every other owner's entry. Rejects with
  `NoVaultsForOwner` if that owner has never deployed through this
  factory. Wrapped by the SDK's `extendVaultsByOwnerTtl`.

**Consequence for integrators**: keeping a factory "fully alive" for a
given owner means calling *both* — `keepOwnerVaultsAlive` (which walks
`VaultsByOwner` and extends each *vault's own* instance TTL) does not
also touch the factory's per-owner entry. See the [API reference's TTL
keeper section](api-reference.md#ttl-keeper) for the exact call to pair
it with, and
[integration-guide.md's "Keep it alive" step](integration-guide.md#7-keep-it-alive)
for the runnable version.

## Why `VaultsByOwner` is capped at 100

`deploy_vault` appends to `VaultsByOwner(owner)` on every call. Without
a cap, that Vec — and the cost of writing it — grows unboundedly with
however many vaults one owner deploys through this factory. `MAX_VAULTS_PER_OWNER`
(100) bounds both the entry's storage footprint and the per-deploy
write cost; `deploy_vault` checks the current length *before* running
the Wasm deploy, so a doomed call (`TooManyVaultsForOwner`) fails
cheaply rather than deploying a vault it then can't index. This cap
only applies to vaults deployed **through this factory** — a vault
deployed directly (`deployVault` in the SDK, bypassing the factory)
never touches `VaultsByOwner` and isn't counted.

## The factory's index is a cache, not a source of truth

`VaultsByOwner` is convenience data the factory happens to maintain —
nothing forces it to stay consistent with reality beyond `deploy_vault`
appending correctly. In particular:

- A vault deployed directly never appears in any factory's index.
- If ownership transfers (`propose_owner`/`accept_owner`) on a vault
  that *is* indexed, the factory's `VaultsByOwner` entry for the old
  owner still lists that vault's address — the index reflects who
  *deployed* it, not who currently *owns* it.

Always call a vault's own `owner()` to find out who actually controls
it. See [design-tradeoffs.md](design-tradeoffs.md#the-factorys-index-is-informational-not-authoritative)
for the reasoning.

## TTL mechanics, worked with real numbers

"TTL" (time to live) in Soroban is measured in **ledgers**, not wall-
clock time — but since Stellar targets roughly one ledger every 5
seconds in normal operation, ledger counts translate to an
approximate duration that's useful for reasoning about real schedule
intervals, even though the protocol itself has no concept of seconds
baked into the TTL mechanism.

### The two numbers: `threshold` and `extend_to`

`extend_ttl(threshold, extend_to)` (and every SDK wrapper around it —
`extendTtl`, `keepAlive`, `keepOwnerVaultsAlive`) takes two numbers
that are easy to conflate but mean different things:

- **`threshold`**: only actually extend if the entry's *current
  remaining* TTL (in ledgers, counted from the current ledger) is at
  or below this value. If the remaining TTL is already higher than
  `threshold`, the call is a no-op with respect to the TTL itself
  (though it may still cost a small transaction fee for the call
  itself, depending on how the network prices reads that make no
  storage change).
- **`extend_to`**: if extending, extend the TTL *to* this many ledgers
  from the current ledger — an absolute target measured from "now,"
  not an amount added on top of whatever the current remaining TTL
  already was.

### A worked example

Suppose a vault's instance storage currently has 10,000 ledgers of
remaining TTL, and the current ledger is 5,000,000 (so the entry
expires at ledger 5,010,000 if nothing extends it further).

Calling `extendTtl(vault, { threshold: 17280, extendTo: 518400 })`
(the SDK's own defaults):

- Is `10,000 <= 17280`? Yes — the remaining TTL is below the
  threshold, so the extension proceeds.
- The entry's new expiration becomes ledger `5,000,000 + 518,400 =
  5,518,400` — regardless of what the old expiration (`5,010,000`)
  was; `extend_to` is not added to the old value, it *replaces* the
  remaining-TTL calculation with a fresh one counted from now.

If instead the vault's remaining TTL had been 20,000 ledgers (above
the 17,280 threshold), the call would be a no-op — the entry's
expiration would stay at whatever it already was, since the condition
for extending wasn't met.

### Translating ledger counts to rough durations

At the commonly-cited ~5 seconds per ledger (this varies slightly in
practice and is not a protocol-guaranteed constant, so treat this as
approximate, not exact):

| Ledgers | Approximate duration |
|---|---|
| 17,280 | ~1 day |
| 120,960 | ~1 week |
| 518,400 | ~30 days |
| 1,036,800 | ~60 days |
| 6,307,200 | ~1 year |

The SDK's defaults (`threshold: 17280`, `extendTo: 518400`) translate
to "extend to roughly 30 days out, whenever the remaining TTL drops to
roughly 1 day or below" — chosen so that a keeper scheduled to run
daily has a full day of margin before the deadline, even if one run
is missed or delayed, without needing the keeper to run more
frequently than daily to stay safely ahead of expiration.

### Why a keeper that runs less often than the threshold implies is risky

If your keeper only runs, say, weekly, but you leave the default
`threshold: 17280` (~1 day) unchanged, you're relying on the
remaining TTL never dropping *below* what one week's gap between runs
would consume. Since a week is roughly 120,960 ledgers and the
default only re-extends when remaining TTL drops to ~17,280 ledgers
(~1 day), a weekly-scheduled keeper using the default threshold would
miss the window entirely on some runs — by the time it runs again,
the TTL may have already reached zero and the storage archived. If
your keeper's actual run interval is longer than roughly a day, raise
`threshold` to comfortably exceed that interval (e.g.
`threshold: 129600` — about 1.5 weeks of margin — for a weekly
keeper), rather than leaving the default tuned for daily runs.

## Constructor encoding and immutability

Both contracts' constructors run exactly once, atomically with
deployment — this is a Soroban platform guarantee (a constructor-
based contract cannot be invoked a second time; there is no
`initialize()`-style function callable after the fact, which is
exactly the front-running protection documented in
`lumenforge-contracts`' ADR-002). Fields set only in the constructor
and never touched by any other method — `lumen_vault`'s `Token`,
`lumen_vault_factory`'s `VaultWasmHash` — are therefore genuinely
immutable for the contract's entire lifetime, not merely "not
currently exposed as mutable by any method today." Relying on this
immutability (e.g. caching a vault's `token()` result indefinitely
rather than re-reading it on every use) is a safe optimization
specifically *because* of this guarantee — the same optimization
would be incorrect for a field that any method can still change
(`Balance`, `Paused`, `MinDeposit`, `MaxBalance`, `Owner`, all of
which have at least one non-constructor method that can update them).

## Error encoding

Both contracts declare their errors as a `#[contracterror]`-annotated
Rust `enum` with an explicit `#[repr(u32)]` and explicit discriminant
values (`NotInitialized = 1`, `InvalidAmount = 2`, and so on) — this
is why [api-reference.md's Errors section](api-reference.md#errors)
can present them as a stable numbered table: the numbers are baked
into the contract's compiled Wasm and its published spec, not an
incidental ordering that could silently shift between contract
versions the way an unannotated enum's discriminants could. Client
code (this SDK's `VAULT_ERROR_TYPES`/`FACTORY_ERROR_TYPES`) maps these
same numbers to the human-readable messages documented throughout
this doc set; `lumenforge-sdk`'s own `spec.test.ts` asserts this
mapping covers *exactly* the codes the compiled contract actually
declares — no missing entries, no stale extras left over from a
removed error — so a mismatch here fails that SDK's test suite before
ever reaching an integrator as a confusing raw error code.

## Contract metadata

Both contracts declare on-chain metadata via `contractmeta!`, visible
to any tool that inspects a contract's spec (`soroban-cli contract
info`, block explorers, this SDK's own `Client.from` spec-fetching):

| Contract | `Name` | `Description` |
|---|---|---|
| `lumen_vault` | `lumen_vault` | Owner-gated SEP-41 deposit/withdraw vault |
| `lumen_vault_factory` | `lumen_vault_factory` | Permissionless factory for deploying and indexing lumen_vault instances |

This is purely descriptive metadata, not consulted by any of this
SDK's own logic (`connectVault`/`connectFactory` don't check it to
decide which client type to construct — that's determined entirely
by which function you called and what `VaultMethods`/`FactoryMethods`
interface you're relying on TypeScript to enforce, not by anything
read from the contract itself at runtime). It exists for human/tool
discoverability, not machine dispatch.

## Event topic and data encoding, precisely

[api-reference.md's Events section](api-reference.md#events) documents
each event's fields; this section documents the underlying wire
format those fields are decoded *from*, which matters if you're
writing your own decoder against raw `getEvents` output rather than
using this SDK's `decodeVaultEvent`/`decodeFactoryEvent`.

Every event `#[contractevent]` publishes has its topics structured as
`[event_name_symbol, ...topic_fields_in_declaration_order]` — the
first topic is always a `Symbol` holding the event's own name in
snake_case (e.g. `"deposit"`, `"vault_deployed"`), and every field
marked `#[topic]` in the originating Rust struct follows, in the
exact order declared, as its own topic entry. Fields *not* marked
`#[topic]` go into the event's `data`, which — since neither contract
overrides `#[contractevent]`'s default `data_format` — always arrives
as a `Map` keyed by `Symbol`, **even when there is only one data
field**. This is easy to get wrong writing a decoder from scratch:
it's tempting to assume a single-field event's data arrives as that
field's bare value rather than a one-entry map, and this SDK's own
`events.ts` carries an explicit comment (and a set of tests verified
against real event XDR dumped from the contracts' own test
environment, not merely inferred from reading the macro's source) to
avoid exactly that mistake.

A zero-data-field event (e.g. `Paused`, whose only field is the
`#[topic]`-marked `owner`) still carries an **empty** map as its data
— not `Void`/absent — since the underlying macro's `Map` code path
constructs a map from however many data fields there are, including
zero, rather than special-casing zero into a different
representation. `Option::None` (e.g. `MaxBalanceUpdated` when the cap
is removed) becomes `Void` *inside* that data map, at the key for
that field — the key itself is still present, its value is `Void`,
which is why `decodeVaultEvent` normalizes that specific case to
`undefined` (matching this SDK's convention elsewhere) rather than
leaving it as the native `null` that `scValToNative` would otherwise
produce.
