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
              │  pagination, snapshots, events,       │
              │  TTL keeper                           │
              └─────────────────────────────────────┘
                  talks to both contracts over RPC
                  also ships as a `lumenforge` CLI
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
Soroban itself makes awkward — salt management, pagination loops,
decoding contract error codes into readable messages, decoding raw
contract *events* into typed objects, batching a vault's/factory's
whole state into one read, and an off-chain keeper for the TTL renewal
neither contract can trigger itself. See the [integration
guide](integration-guide.md) for all of these in the order you'd
actually reach for them.

It also ships a `lumenforge` CLI for scripting the same operations
without writing TypeScript — a cron job that keeps vaults alive, a
quick balance check. See [cli-reference.md](cli-reference.md) for the
exhaustive command reference.

## Table of contents

- [`LumenVault`](#lumenvault)
- [`LumenVaultFactory`](#lumenvaultfactory)
- [`@lumenforge/sdk`](#lumenforgesdk)
- [The request lifecycle, end to end](#the-request-lifecycle-end-to-end)
- [Deployment topology options](#deployment-topology-options)
- [Security boundaries](#security-boundaries)
- [Repo map: where to look for what](#repo-map-where-to-look-for-what)
- [Versioning and compatibility](#versioning-and-compatibility)

## The request lifecycle, end to end

Tracing a single `deposit` call from the moment application code
invokes it to the moment it's confirmed on-chain, showing every layer
it passes through — useful for understanding where a failure at any
given layer would actually surface.

```
Application code
  │  vault.deposit({ from, amount })
  ▼
@lumenforge/sdk (VaultClient, from vaultClient.ts)
  │  dispatches to contract.Client's generated method
  ▼
@stellar/stellar-sdk's contract.Client
  │  encodes { from, amount } to XDR using the contract's on-chain spec
  │  (fetched once, when connectVault() was first called)
  ▼
Soroban RPC endpoint — simulateTransaction
  │  runs the call against current ledger state, without committing
  │  returns: what the call would return, and what resources it needs
  ▼
AssembledTransaction (wraps the built, simulated-but-unsent transaction)
  │  .result already holds the simulated return value here
  ▼
  [ application code decides whether to actually send it ]
  │  await tx.signAndSend()
  ▼
KeypairSigner (or a wallet's SEP-43 callback)
  │  signs the transaction envelope
  ▼
Soroban RPC endpoint — sendTransaction
  │  submits the signed envelope to the network
  ▼
Stellar Core / validators
  │  the transaction is included in a ledger close, or rejected
  ▼
Soroban RPC endpoint — getTransaction (polled by signAndSend internally)
  │  reports the final status once the ledger closes
  ▼
AssembledTransaction.result re-resolved from the confirmed outcome
  │  this is what your `await tx.signAndSend()` call actually returns
  ▼
Application code receives the final result (or a thrown error, at
  any layer above where something went wrong)
```

Each layer above is a place a failure can originate, and the error
message you see often tells you which layer it came from even when
the SDK doesn't explicitly label it: a `SyntaxError` or `TypeError`
almost always means something went wrong in the SDK/`contract.Client`
encoding layer (a malformed argument before anything reached the
network at all); a message matching one of the named error variants
in [api-reference.md's Errors section](api-reference.md#errors) means
the contract's own logic ran and explicitly rejected the call; a
generic network-sounding error (timeout, connection refused) means
the RPC layer itself, independent of anything either contract or this
SDK got right or wrong. See
[api-reference.md's error-handling patterns](api-reference.md#error-handling-patterns)
for how to branch on this distinction in code.

## Deployment topology options

There's more than one reasonable way to arrange factories, vaults,
and tokens for a real integration — the "one factory, many
owner-vault pairs" picture at the top of this document is the common
case, not the only one.

**One factory, many owners, one shared token.** The simplest
topology: a single deployed `lumen_vault_factory` (pointing at a
single `lumen_vault` Wasm hash), used by every user of your
integration, all custodying the same SEP-41 token. Every user's
vault(s) show up under their own `vaults_by_owner` entry within this
one factory. This is the shape [integration-guide.md's onboarding
scenario](integration-guide.md) assumes throughout.

**One factory, many owners, many tokens.** Also entirely supported —
`deploy_vault`'s `token` argument is per-call, not fixed at the
factory level, so the same factory can deploy vaults for entirely
different tokens for different owners (or even multiple tokens for
the same owner, as separate vaults). `vaults_by_owner` doesn't
distinguish by token — if you need "list this owner's vaults *for
this specific token*," that's a filter you apply yourself over the
full list (e.g. via `collectVaultSnapshotsByOwner` and filtering the
results by `.token`), not something the factory's own index provides
directly.

**Multiple factories.** As discussed in
[design-tradeoffs.md's `MAX_VAULTS_PER_OWNER` entry](design-tradeoffs.md#max_vaults_per_owner-is-a-compile-time-constant-not-configurable-per-factory),
deploying a second factory instance is the only way to raise an
owner's effective vault-count ceiling past what one factory allows.
It's also a reasonable choice for other organizational reasons
entirely independent of that cap — e.g. one factory per product line
or per token, if you want the on-chain indexes to naturally separate
along those lines rather than filtering a single shared index
yourself.

**Vaults deployed outside any factory at all.** Fully supported via
`deployVault` — see
[integration-guide.md's deployment-choice section](integration-guide.md#choosing-between-direct-deployment-and-factory-deployment)
for when this is the better fit. A given deployment doesn't have to
commit to one topology exclusively either — nothing prevents some
vaults for a given token being factory-deployed (and indexed) while
others for the same token are deployed directly (and tracked entirely
in your own application's database instead).

## Security boundaries

Where trust actually sits, and doesn't, across the whole system —
consolidating threat-model points that are otherwise scattered across
this doc set and `lumenforge-contracts`' own `docs/security.md`.

```
┌─────────────────────────────────────────────────────────────┐
│ Fully trusted: the vault's `owner` address                     │
│ Can withdraw, pause/unpause, rescue, reconfigure bounds,        │
│ transfer ownership. The contract enforces nothing about who or  │
│ what this address actually is — a plain keypair, a multisig     │
│ account, or another smart contract all work identically.        │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Semi-trusted: the custodied `token` contract                   │
│ Assumed to be a conforming SEP-41 implementation. If it isn't  │
│ (fee-on-transfer, rebasing, clawback, pausable, etc.), the      │
│ vault's own accounting can desync from reality — see            │
│ token-vetting-checklist.md for the full risk enumeration.       │
│ lumen_vault has no way to detect or defend against this itself. │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Untrusted: everyone else                                        │
│ Anyone can deposit (subject to the vault's own bounds), call    │
│ extend_ttl on either contract (no auth required — there's       │
│ nothing to gate, since extending a TTL only costs the caller    │
│ fees and benefits whoever's storage it is), and deploy their    │
│ own vault via the permissionless factory. None of this grants   │
│ any access to funds or configuration they don't already own.    │
└─────────────────────────────────────────────────────────────┘
```

The factory itself sits in an interesting middle position: it's
*permissionless* (anyone can call `deploy_vault`, for themselves),
but the vaults it deploys don't trust the factory in any ongoing
way after deployment — a vault's `owner()` is checked from the
vault's own storage, never re-derived from or re-confirmed against
the factory that happened to deploy it. This is precisely why the
factory's index is documented throughout this doc set as
"informational, not authoritative": the factory has no *security*
role after the deployment transaction completes, only a bookkeeping
one.

## Repo map: where to look for what

For anyone about to go read source code directly rather than relying
purely on this documentation:

| You want to understand... | Look in... |
|---|---|
| Exact contract logic, storage, and events for `lumen_vault` | `lumenforge-contracts/contracts/lumen_vault/src/lib.rs` |
| Exact contract logic, storage, and events for `lumen_vault_factory` | `lumenforge-contracts/contracts/lumen_vault_factory/src/lib.rs` |
| Why a specific contract design choice was made | `lumenforge-contracts/docs/adr/*.md` |
| The contracts' own threat model, known limitations, resolved history | `lumenforge-contracts/docs/security.md` |
| SDK client wrappers (`connectVault`/`connectFactory`, `deployVault`) | `lumenforge-sdk/src/vaultClient.ts`, `src/factoryClient.ts` |
| Pagination helpers | `lumenforge-sdk/src/factoryClient.ts` (co-located with `connectFactory`, since they only make sense in terms of a `FactoryClient`) |
| TTL keeper (`extendTtl`, `keepAlive`, etc.) | `lumenforge-sdk/src/keeper.ts` |
| State-snapshot helpers | `lumenforge-sdk/src/snapshot.ts` |
| Event decoding | `lumenforge-sdk/src/events.ts` — and its test file, `events.test.ts`, for the empirically-verified wire-format details referenced throughout [data-model.md](data-model.md#event-topic-and-data-encoding-precisely) |
| The CLI itself | `lumenforge-sdk/src/cli.ts` and `src/cli.test.ts` |
| Error code definitions | `lumenforge-sdk/src/errors.ts` |
| Salt helpers | `lumenforge-sdk/src/salt.ts` |
| Whether the SDK's method signatures still match the real compiled contract | `lumenforge-sdk/src/spec.test.ts` — this is the test that would fail first if a contract-side rename or signature change went unreflected in the SDK |

## Versioning and compatibility

`lumenforge-contracts` and `lumenforge-sdk` are versioned
independently — a contract version bump doesn't automatically imply
an SDK version bump, and vice versa, though a *breaking* contract
change (a renamed method, a changed argument list, a changed error
code) does require a corresponding SDK update to keep working, and
the SDK repository's own `spec.test.ts` (see the repo map above) is
specifically designed to catch exactly this class of drift during
the SDK's own CI rather than letting it surface as a confusing
runtime failure for an integrator later. When upgrading either repo's
dependency in your own project, check that repository's `CHANGELOG.md`
for whether the specific version range you're crossing includes a
breaking change, rather than assuming semantic-versioning discipline
alone guarantees you've read the right notes (a `CHANGELOG.md` entry
still requires actually reading it — semver only tells you *that*
something breaking happened between major versions, not *what*).
