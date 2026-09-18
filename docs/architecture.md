# Architecture

LumenForge is three pieces working together: one contract that holds
funds, one contract that deploys and indexes the first kind, and a
TypeScript client for talking to both.

```
                    deploys, tracked by owner
   ┌────────────────────┐   ────────────────►   ┌──────────────┐
   │ LumenVaultFactory   │                       │  LumenVault    │  (one per
   │  - deploy_vault()   │                       │  - deposit()   │   owner,
   │  - vaults_by_owner()│  ◄────────────────    │  - withdraw()  │   per token)
   └────────────────────┘   owner() is source        │  - pause()     │
                             of truth, not the        │  - rescue()    │
                             factory's index           └──────┬─────────┘
                                                                │ transfer()
                                                                ▼
                                                      real SEP-41 token

              ┌─────────────────────────────────────┐
              │        @lumenforge/sdk (TS)           │
              │  connectVault / connectFactory        │
              │  deployVault / deployVaultViaFactory  │
              │  collectVaultsByOwner / iterate...    │
              └─────────────────────────────────────┘
                  talks to both contracts over RPC
```

## `LumenVault`

One vault instance custodies a single SEP-41 token for a single owner,
set atomically at deployment (constructor-based init — no front-running
window). Deposits are open to any authorized address; only the owner can
withdraw. See
[`lumen_vault/src/lib.rs`](https://github.com/StellarCrove/lumenforge-contracts/blob/main/contracts/lumen_vault/src/lib.rs)
for the full method list (pause/unpause, min/max deposit bounds, `rescue`
for stray tokens, two-step ownership transfer).

**Why single-balance, not per-depositor accounting**: a vault pools
everyone's deposits into one `Balance`; only the owner can move money
out, in aggregate. That's deliberate, not a missing feature — see
[design-tradeoffs.md](design-tradeoffs.md#no-per-depositor-accounting).

## `LumenVaultFactory`

Permissionless: anyone can deploy a vault for themselves via
`deploy_vault(owner, token, min_deposit, max_balance, salt)`. The factory
also keeps a paginated index, `VaultsByOwner`, so you can list every
vault an address deployed without knowing addresses in advance.

That index is **informational, not authoritative** — if you're checking
who really controls a vault, call that vault's own `owner()`, never the
factory's index. The factory can't force a vault to exist in its index
(nor would that matter for control), and a vault deployed directly
(bypassing the factory) simply won't appear in it.

Salts are the caller's responsibility (Soroban derives a deployed
address from `(deployer, salt, wasm_hash)`, so reusing a salt for the
same owner collides). The SDK's `randomSalt()` / `ownerNonceSalt()` and
`deployVaultViaFactory()` exist specifically so integrators don't have
to think about this — see the [integration guide](integration-guide.md).

## `@lumenforge/sdk`

A thin, typed wrapper over `@stellar/stellar-sdk`'s `contract.Client`.
Each `connectVault`/`connectFactory` call fetches the deployed contract's
on-chain spec, so arguments are validated and results decoded without
hand-written XDR conversion — and `src/spec.test.ts` in the SDK repo
asserts the SDK's method signatures and error codes still match the real
compiled contract, so a Rust-side rename fails the SDK's own tests
rather than surfacing as a runtime error for an integrator.

The SDK is deliberately thin: it doesn't add business logic the
contracts don't have (e.g. it won't invent per-depositor accounting on
top of a pooled `Balance`). What it adds is ergonomics around things
Soroban itself makes awkward — salt management, pagination loops, and
decoding contract error codes into readable messages.
