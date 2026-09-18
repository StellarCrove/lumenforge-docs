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
