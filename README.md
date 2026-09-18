# lumenforge-docs

Documentation for the LumenForge Soroban vault ecosystem — the single
entry point for understanding how the pieces fit together, rather than
reverse-engineering it from source.

LumenForge is two repos:

- [`lumenforge-contracts`](https://github.com/StellarCrove/lumenforge-contracts)
  — the Soroban contracts (`lumen_vault`, `lumen_vault_factory`).
- [`lumenforge-sdk`](https://github.com/StellarCrove/lumenforge-sdk) —
  the TypeScript client for them.

Each repo documents itself in detail (architecture, security model, ADRs,
API usage). This repo is the layer above that: how the contracts and SDK
relate, how to integrate end to end, and the tradeoffs that span both.

## Contents

- [`docs/architecture.md`](docs/architecture.md) — how the vault, the
  factory, and the SDK relate, in one picture.
- [`docs/integration-guide.md`](docs/integration-guide.md) — a
  task-oriented walkthrough: deploy a vault, deposit, withdraw, page
  through an owner's vaults, handle errors.
- [`docs/design-tradeoffs.md`](docs/design-tradeoffs.md) — the
  intentional limitations that show up across both repos, summarized in
  one place instead of scattered across ADRs.
- [`docs/token-vetting-checklist.md`](docs/token-vetting-checklist.md) —
  what to check about a SEP-41 token before pointing a vault at it.

For contract-level detail (threat model, per-function auth rules,
resolved/open security issues), see `lumenforge-contracts`'
[`docs/security.md`](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/security.md)
directly — this repo links to it rather than duplicating it.
