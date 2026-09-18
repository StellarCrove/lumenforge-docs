# lumenforge-docs

Documentation for the LumenForge Soroban vault ecosystem — the single
entry point for understanding how the pieces fit together, rather than
reverse-engineering it from source.

LumenForge is two repos:

- [`lumenforge-contracts`](https://github.com/StellarCrove/lumenforge-contracts)
  — the Soroban contracts (`lumen_vault`, `lumen_vault_factory`).
- [`lumenforge-sdk`](https://github.com/StellarCrove/lumenforge-sdk) —
  the TypeScript client for them (also ships a `lumenforge` CLI for
  scripting the same operations without writing TypeScript).

Each repo documents itself in detail (architecture, security model, ADRs,
API usage). This repo is the layer above that: how the contracts and SDK
relate, how to integrate end to end, and the tradeoffs that span both.

## Contents

- [`docs/architecture.md`](docs/architecture.md) — how the vault, the
  factory, and the SDK relate, in one picture.
- [`docs/integration-guide.md`](docs/integration-guide.md) — a
  task-oriented walkthrough: deploy a vault, deposit, withdraw, page
  through an owner's vaults, handle errors, track events, keep
  contracts alive, or do all of it from the CLI instead.
- [`docs/api-reference.md`](docs/api-reference.md) — every SDK
  function's parameters, return type, defaults, and errors, in tables —
  the reference to come back to once you know what you're looking for.
- [`docs/cli-reference.md`](docs/cli-reference.md) — the exhaustive
  `lumenforge` CLI reference: every flag, environment variable, exit
  code, error message, and automation recipe (cron, systemd, GitHub
  Actions, Docker, launchd).
- [`docs/data-model.md`](docs/data-model.md) — exactly what each
  contract stores, in which storage class, and why that governs which
  `extend_ttl`-family call keeps it alive.
- [`docs/design-tradeoffs.md`](docs/design-tradeoffs.md) — the
  intentional limitations that show up across both repos, summarized in
  one place instead of scattered across ADRs.
- [`docs/token-vetting-checklist.md`](docs/token-vetting-checklist.md) —
  what to check about a SEP-41 token before pointing a vault at it.

For contract-level detail (threat model, per-function auth rules,
resolved/open security issues), see `lumenforge-contracts`'
[`docs/security.md`](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/security.md)
directly — this repo links to it rather than duplicating it.

## Where to start, depending on what you're doing

| You're... | Start with |
|---|---|
| New to LumenForge entirely | [`docs/architecture.md`](docs/architecture.md), then [`docs/integration-guide.md`](docs/integration-guide.md)'s Prerequisites section |
| Integrating the SDK into an application | [`docs/integration-guide.md`](docs/integration-guide.md) |
| Looking up one specific function's exact signature | [`docs/api-reference.md`](docs/api-reference.md) |
| Scripting with the `lumenforge` CLI, or setting up a scheduled keeper job | [`docs/cli-reference.md`](docs/cli-reference.md) |
| Deciding whether a token is safe to point a vault at | [`docs/token-vetting-checklist.md`](docs/token-vetting-checklist.md) |
| Wondering why something behaves a certain way instead of how you expected | [`docs/design-tradeoffs.md`](docs/design-tradeoffs.md) |
| Debugging a TTL/storage-expiry issue, or wondering exactly what's stored where | [`docs/data-model.md`](docs/data-model.md) |
| About to read the contract or SDK source directly | [`docs/architecture.md`'s repo map](docs/architecture.md#repo-map-where-to-look-for-what) |

## What LumenForge actually is, in plain terms

If you're arriving here without prior context: LumenForge lets anyone
deploy a small, self-contained "vault" — a Soroban smart contract that
holds a balance of one specific token, controlled by one owner
address, that owner (or anyone acting on the owner's authorization)
can deposit into and withdraw from. A companion "factory" contract
lets anyone deploy these vaults permissionlessly and keeps a
browsable, paginated index of which addresses have deployed which
vaults. A TypeScript SDK (and a command-line tool built on top of it)
wraps both contracts so that integrating them into an application, a
script, or a scheduled job doesn't require hand-writing Soroban RPC
calls or XDR encoding/decoding.

It is deliberately *not*: a multi-asset wallet, a DeFi yield product,
a DAO treasury framework with voting built in, or a general-purpose
smart-contract platform. Every one of those could plausibly be built
*using* LumenForge as a building block (a vault as one component of a
larger system), but none of them is what `lumen_vault`/
`lumen_vault_factory` themselves try to be — see
[design-tradeoffs.md](docs/design-tradeoffs.md) at length for the
specific capabilities deliberately left out and why.

## Glossary

Terms used consistently across every document in this repository,
gathered in one place for anyone encountering them for the first
time or needing a precise definition rather than inferring one from
context.

| Term | Meaning |
|---|---|
| **Vault** | One deployed instance of the `lumen_vault` contract — custodies a balance of exactly one SEP-41 token, for exactly one owner. |
| **Factory** | One deployed instance of the `lumen_vault_factory` contract — permissionlessly deploys vaults and indexes them by owner. |
| **Owner** | The `Address` stored in a vault's own storage that controls it — can withdraw, pause, reconfigure bounds, rescue stray tokens, and transfer ownership. Not necessarily a plain keypair; can be a multisig account or another smart contract. |
| **SEP-41** | The Stellar Ecosystem Proposal defining a standard token-contract interface (`transfer`, `balance`, etc.) for Soroban — analogous to ERC-20 on Ethereum. `lumen_vault` assumes the token it custodies conforms to this standard; see [token-vetting-checklist.md](docs/token-vetting-checklist.md) for what happens when a token doesn't. |
| **Salt** | 32 arbitrary bytes that, combined with the deploying address and the Wasm hash, deterministically derive a newly-deployed contract's address on Soroban. The factory doesn't generate these for you at the contract level — see [design-tradeoffs.md](docs/design-tradeoffs.md#salt-management-is-on-the-caller) — though the SDK closes this gap at the integration layer. |
| **TTL** | Time to live, measured in ledgers (not wall-clock time) — how long a piece of Soroban storage survives before the network is permitted to archive it, absent an `extend_ttl` call renewing it. See [data-model.md's TTL section](docs/data-model.md#ttl-mechanics-worked-with-real-numbers) for the exact mechanics with worked numeric examples. |
| **Instance storage** | One of Soroban's two storage classes — a single bucket per contract; letting its TTL expire archives *everything* in that bucket at once. |
| **Persistent storage** | Soroban's other storage class — arbitrary keyed entries, each with an independent TTL; letting one entry expire only archives that entry. |
| **Snapshot** (as in `getVaultSnapshot`) | This SDK's term for a batched read of every field of a vault's (or factory's) state in one call, rather than sequencing several individual reads. Not a blockchain-level concept — a naming choice specific to this SDK's own API. |
| **Keeper** (as in the TTL keeper functions) | The off-chain process (a script, a cron job, a scheduled cloud function) that periodically calls `extend_ttl` so a vault's/factory's storage doesn't get archived. Neither contract can trigger this itself — see [design-tradeoffs.md's TTL entry](docs/design-tradeoffs.md#ttl-extension-is-a-mechanism-not-a-policy). |
| **`AssembledTransaction`** | `@stellar/stellar-sdk/contract`'s wrapper type returned by every contract call this SDK makes — represents a built, simulated, but not-yet-submitted transaction. See [api-reference.md's lifecycle section](docs/api-reference.md#the-assembledtransaction-lifecycle-in-depth) for the full explanation of what this means in practice. |
| **`Signer`** | Anything capable of signing a transaction on behalf of an address — a SEP-43 wallet callback (e.g. Freighter, for browser applications) or a `KeypairSigner` wrapping a local secret key (for scripts/backends). |
| **ADR** | Architecture Decision Record — a short document in `lumenforge-contracts/docs/adr/` explaining one specific design choice and its rationale, referenced throughout [design-tradeoffs.md](docs/design-tradeoffs.md) rather than re-explained inline every time. |
| **The factory's index** | Shorthand used throughout this doc set for `VaultsByOwner`, the factory's on-chain record of which addresses have deployed which vaults. Explicitly documented as informational rather than authoritative — see [design-tradeoffs.md](docs/design-tradeoffs.md#the-factorys-index-is-informational-not-authoritative). |

## Frequently asked questions

Cross-cutting questions that don't belong to any one document below —
each answer links to the page with the full detail rather than
repeating it here.

**Is LumenForge audited?** As of this writing, `lumenforge-contracts`
has not yet had a third-party audit — see that repository's own
`docs/security.md` Audit Checklist for the current pre-mainnet status
and what remains outstanding.

**Which network should I use while developing — testnet, or a local
standalone network?** Either works with this SDK and CLI
interchangeably; see
[integration-guide.md's Prerequisites](docs/integration-guide.md#prerequisites)
and [cli-reference.md's `LUMENFORGE_RPC_URL` section](docs/cli-reference.md#lumenforge_rpc_url)
for exactly how the choice of RPC URL scheme (`http://` vs. `https://`)
is handled automatically.

**Do I need to know Rust to use LumenForge?** No — only if you intend
to modify the contracts themselves (`lumenforge-contracts`). Using an
already-deployed factory/vault via the SDK or CLI requires only
TypeScript/JavaScript (or, via the CLI, no programming language at
all beyond shell scripting).

**Can I use LumenForge for a token other than the one it was first
deployed for?** Yes — `token` is a per-vault choice made at
deployment, not fixed at the factory or SDK level. See
[architecture.md's deployment topology section](docs/architecture.md#deployment-topology-options)
for the different ways factories, vaults, and tokens can be arranged.

**What happens if I lose access to a vault's owner key?** There is no
recovery mechanism inside the contract itself — the owner is the
trust root by design. See
[design-tradeoffs.md](docs/design-tradeoffs.md#pause-doesnt-block-withdraw)
for why, and what to do instead (use a multisig or another smart
contract as the owner, rather than a single plain keypair, if key-loss
recovery matters for your use case).

**Where do I report a bug or ask a question that isn't answered
anywhere in this doc set?** Each repository's own issue tracker —
`lumenforge-contracts` for contract-level questions,
`lumenforge-sdk` for SDK/CLI questions, or this repository
(`lumenforge-docs`) specifically for a documentation gap, error, or
stale cross-reference (see
[Keeping this documentation in sync with reality](#keeping-this-documentation-in-sync-with-reality)
below for what counts as a documentation bug worth reporting).

## Documentation conventions used throughout this repo

Consistent choices across every page, so you don't have to re-learn
them per document:

- **Placeholder addresses** are written as `G...`, `C...`, or `S...`
  followed by uppercase filler letters (e.g.
  `GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`) —
  these are never real, resolvable addresses; they exist purely to
  show the *shape* and *strkey prefix* (`G` for a classic
  account/Ed25519 public key, `C` for a contract address, `S` for a
  secret seed) an address of that kind actually has.
- **Code examples default to TypeScript** for the SDK-facing pages,
  and **bash** for the CLI-facing pages — a code block's fenced
  language tag (` ```ts ` vs. ` ```bash `) tells you which context
  it's meant to run in without needing to read the surrounding prose
  first.
- **Every internal link is a relative path** (`docs/foo.md`,
  `foo.md#section`, or `#section` within the same page) except when
  linking to `lumenforge-contracts`/`lumenforge-sdk`, which are always
  full `https://github.com/...` URLs, since those are different
  repositories entirely.
- **Bigint amounts in TypeScript examples always carry the `n`
  suffix** (`500n`, not `500`) — this is not a stylistic choice but a
  correctness one, since every amount-like value in this SDK's actual
  types is a `bigint`, and passing a plain `number` where a `bigint`
  is expected is a type error, not merely a style violation.
- **A worked numeric/concrete example follows almost every abstract
  claim** across this doc set (see, for instance, the TTL section of
  [data-model.md](docs/data-model.md#ttl-mechanics-worked-with-real-numbers)
  or the failure-mode walkthroughs in
  [token-vetting-checklist.md](docs/token-vetting-checklist.md)) —
  this is a deliberate choice to make every claim checkable against a
  concrete scenario rather than leaving it as an assertion to take on
  faith.

## Keeping this documentation in sync with reality

Every cross-reference and code example in this repository is checked
against the actual current source it describes rather than written
from memory or assumption — the empirically-verified event wire
format referenced throughout [`docs/data-model.md`](docs/data-model.md#event-topic-and-data-encoding-precisely)
and [`docs/api-reference.md`](docs/api-reference.md#events) is one
concrete example: rather than trusting the `#[contractevent]` macro's
source code alone, the actual wire format was confirmed by dumping
real event XDR from `lumenforge-contracts`' own test environment
before any decoder was written against it. When either
`lumenforge-contracts` or `lumenforge-sdk` changes in a way that
affects behavior documented here, the corresponding pages in this
repo should be updated in the same pass — a stale cross-reference
(a link to a section that no longer exists, a table listing a method
signature that's since changed) is treated as a bug in this
repository, not a cosmetic issue to get to later. If you find one,
it's worth reporting the same way you'd report any other
documentation defect.
