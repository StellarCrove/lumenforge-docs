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
