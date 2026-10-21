# Glossary

A comprehensive reference of domain-specific terminology across the
LumenForge ecosystem, the Stellar network, Soroban smart contracts, and
secure token custody architectures.

This glossary expands upon the overview in the main [README](../README.md#glossary)
into an authoritative, alphabetically indexed technical reference.

---

## Alphabetical Index

[A](#a) • [B](#b) • [C](#c) • [D](#d) • [E](#e) • [F](#f) • [H](#h) • [I](#i) • [K](#k) • [L](#l) • [M](#m) • [N](#n) • [O](#o) • [P](#p) • [R](#r) • [S](#s) • [T](#t) • [V](#v) • [W](#w) • [X](#x)

---

## A

### Address
On Soroban, `Address` is a unified identifier type representing either a
classic Stellar account (`G...` Ed25519 public key) or a deployed smart
contract (`C...`). The `lumen_vault` contract uses `Address` for its
`owner`, `token`, and depositor parameters, allowing custody to be managed
by individuals, multisig accounts, or autonomous contract logic identically.

### Architecture Decision Record (ADR)
A document recording an architectural decision, its context, consequences,
and rationale. LumenForge architecture decisions (such as ADR 006 for
depositor allowances) are maintained in the
[`lumenforge-contracts`](https://github.com/StellarCrove/lumenforge-contracts)
repository under `docs/adr/`.

### Archival & Restoration
Soroban's mechanism for managing ledger state size. When a storage entry's
Time-To-Live ([TTL](#time-to-live-ttl)) drops to zero, the network moves it to archive
storage. Archived entries cannot be read or modified by contract calls until
reactivated via a `restore_footprint` operation with valid ledger proofs.
LumenForge uses proactive [Keeper](#keeper) jobs to prevent archival of
active vaults.

### AssembledTransaction
A wrapper object returned by `@stellar/stellar-sdk/contract` representing a
built, simulated, and footprint-analyzed Soroban transaction before it is
signed and submitted to the network. See [API Reference](api-reference.md#the-assembledtransaction-lifecycle-in-depth).

### Auth Flags
Flags configured on a classic Stellar asset issuing account that govern
token behavior across trustlines:
- `AUTH_REQUIRED_FLAG`: The issuer must approve trustlines before holders can
  receive the token.
- `AUTH_REVOCABLE_FLAG`: The issuer can freeze or revoke balances held in
  trustlines.
- `AUTH_CLAWBACK_ENABLED_FLAG`: Enables the issuer to claw back funds.
Tokens with revocable or clawback flags require careful assessment before
custody; see [Token Vetting Checklist](token-vetting-checklist.md).

### Authorization (`require_auth`)
Soroban's declarative access-control host function. Calling
`address.require_auth()` verifies that the transaction was signed by the
given address (or approved via contract authorization tree). In LumenForge,
all owner-only administrative mutations enforce `owner.require_auth()`, and
deposit functions enforce `from.require_auth()`.

---

## B

### Base Reserve
The minimum balance of native Lumens (XLM) required by the Stellar ledger to
maintain accounts, trustlines, signers, and data entries. On classic Stellar,
each entry requires a 0.5 XLM reserve. Contrast with Soroban's rent-based
[Storage Rent](#storage-rent) model.

### Batch Deposit
A contract method (`batch_deposit`) introduced in `lumen_vault` v0.6.0
enabling multiple deposit items to be processed in a single transaction
call. Each item specifies a source address and amount. All items must pass
depositor allowance checks if allowances are enabled.

### Budget (CPU & Memory Limits)
The computation and memory quotas assigned by the Soroban virtual machine to
simulate and execute a transaction. If instruction counts or memory usage
exceed consensus limits, the invocation fails with a budget exhaustion error.
LumenForge contract operations (such as bounded allowance loops capped at 32
members) are engineered to stay well within budget margins.

---

## C

### Classic Account (`G...`)
A standard Stellar account identified by a 56-character strkey beginning
with `G` representing an Ed25519 public key. Classic accounts hold native XLM,
maintain trustlines to classic assets, and can configure multiple signers with
weighted thresholds.

### Clawback
A protocol feature allowing an asset issuer to claw back tokens from an
account or contract balance. Enabled via `AUTH_CLAWBACK_ENABLED_FLAG` or
SEP-41 clawback operations. If pointed at a clawback-enabled token, a vault's
balance can be reduced externally without owner action. See
[Token Vetting Checklist](token-vetting-checklist.md).

### Contract Address (`C...`)
A 56-character strkey beginning with `C` identifying an instantiated Soroban
smart contract on the Stellar network. Derived deterministically from deployer
salt, Wasm hash, and deploying address.

---

## D

### Depositor Allowance
An optional deposit cap configured per depositor address in `lumen_vault`
v0.6.0. When allowances are enabled (`set_allowances_enabled(true)`), any
deposit from an unapproved address or exceeding the assigned allowance cap
reverts with `AllowanceExceeded` (Error 12). Capped at 32 active members to
prevent unbounded iteration overhead. See [Allowances](allowances.md).

### Dust Prevention (`min_deposit`)
A configurable contract parameter in `lumen_vault` that rejects deposit
amounts below a non-zero threshold with `DepositBelowMinimum` (Error 7).
Protects the vault against spam micro-transactions and transaction fee griefing.

---

## E

### Emergency Pause
An owner-gated security circuit-breaker in `lumen_vault` (`pause()`). When
paused, incoming deposits are rejected (`VaultIsPaused`, Error 6). Critically,
pausing does *not* freeze withdrawals, ensuring depositors and owners can
always exit custody. See [Design Tradeoffs](design-tradeoffs.md#pause-doesnt-block-withdraw).

### Entry Rent
The network fee charged per ledger for storing contract state on Soroban.
Rent is paid during transaction execution and TTL extension calls. Rent rates
depend on entry size (bytes) and the storage tier ([Instance](#instance-storage)
vs. [Persistent](#persistent-storage)).

---

## F

### Fee-on-Transfer Protection
A design protection ensuring that tokens deducting internal transfer taxes or
burns do not cause accounting mismatches in the vault. `lumen_vault` queries
actual received balance deltas rather than blindly trusting the requested
parameter amount.

### Footprint
The explicit read-only and read-write storage keys declared in a Soroban
transaction envelope. The Soroban host inspects the footprint before execution
to ensure parallel validation and prevent unmetered storage access.

### Friendbot
The public faucet service on Stellar Testnet and standalone local networks
that funds newly generated keypairs with testnet XLM for development and testing.

---

## H

### Host Functions
Native environment functions provided by the Soroban runtime to contracts,
including cryptography, storage management, cross-contract calls, logging,
and authorization verification.

---

## I

### Instance Storage
One of Soroban's storage tiers. Instance storage holds contract metadata,
executable Wasm code binding, and shared contract configuration in a single
storage bucket. In `lumen_vault`, instance storage holds the owner, token
address, minimum deposit, maximum balance cap, and pause state. If an
instance entry's TTL expires, the entire contract instance is archived.

---

## K

### Keeper
An off-chain background agent, cron process, or automated daemon responsible
for periodically calling maintenance functions such as `extend_ttl` or
`extend_all_ttl`. Keepers prevent vault storage from expiring into archival.
See [CLI Reference](cli-reference.md#automation-recipes).

### KeypairSigner
A signer utility in `lumenforge-sdk` that wraps a raw secret seed (`S...`)
or cryptographic keypair to sign transactions locally in backend scripts and
CLI environments.

---

## L

### Ledger Sequence
A monotonically increasing integer identifying each ledger closed by the
Stellar consensus protocol. On Stellar, ledgers close approximately every 5
seconds. Soroban TTL values and lease durations are measured in ledger
increments rather than wall-clock timestamps.

### Lumen Vault (`lumen_vault`)
The core Soroban custody contract deployed by LumenForge. Holds an isolated
balance of one SEP-41 token for one owner address with configurable caps,
dust prevention, pause controls, and allowance management.

### Lumen Vault Factory (`lumen_vault_factory`)
The registry contract that permissionlessly deploys new `lumen_vault` instances
using deterministic salts and indexes deployed vaults by owner address up to
a 100-vault cap.

---

## M

### Max Balance Cap (`max_balance`)
An optional vault parameter set by the owner. When configured (`Some(cap)`),
any deposit that would cause the vault's total asset balance to exceed `cap`
reverts with `MaxBalanceExceeded` (Error 8).

### Multisig Account
A classic Stellar account or Soroban contract wallet configured with multiple
signer keys and signature weight thresholds (low, medium, high). Enables M-of-N
governance over vault ownership.

---

## N

### Nonce
A transaction sequence number used to ensure idempotency and prevent replay
attacks. On Soroban, invocation authorizations can also utilize nonces for
off-chain signature validation.

---

## O

### Owner
The controlling `Address` stored in `lumen_vault` instance storage. The owner
possesses administrative rights to withdraw assets, pause deposits, update
caps, rescue non-custodied tokens, and transfer ownership.

### Owner-Gated Vault
An architectural pattern where all vault administrative functions require
the explicit cryptographic authorization (`require_auth()`) of the registered
owner address.

---

## P

### Persistent Storage
Soroban's keyed storage tier where each key-value pair exists as an independent
ledger entry with its own individual TTL and rent counter. In `lumen_vault_factory`,
`VaultsByOwner` records are stored in persistent storage.

---

## R

### Rescue Asset (`rescue_token`)
An administrative emergency function allowing the vault owner to recover
foreign SEP-41 tokens accidentally sent to the vault contract address. The
vault strictly refuses to rescue its primary custodied asset to prevent owner
circumvention of withdrawal policies.

### Restore Footprint (`restore_footprint`)
A Stellar transaction operation that restores archived Soroban contract
storage back into active state upon payment of the restoration rent fee.

---

## S

### Salt
A 32-byte cryptographically random value used in conjunction with the deployer
address and Wasm hash to derive a unique, deterministic contract address
during deployment (`deployer.deploy(...)`).

### Stellar Asset Contract (SAC)
The canonical built-in Soroban contract wrapper that provides a SEP-41 token
interface for classic Stellar assets (including native XLM and issued credit
assets like USDC). Allows classic trustline assets to be seamlessly deposited
and custodied in Soroban vaults.

### SEP-41
Stellar Ecosystem Proposal 41: the standard token contract interface for
Soroban. Defines functions such as `transfer`, `transfer_from`, `balance`,
`decimals`, `name`, and `symbol`. `lumen_vault` expects all custodied tokens
to conform to SEP-41.

### SEP-43
Stellar Ecosystem Proposal 43: specifies wallet connection and remote
transaction signing interfaces (such as Freighter and Albedo) for Soroban dApps.

### Storage Rent
The fee assessed by the Stellar network to keep Soroban contract data
accessible in active ledger storage. Calculated based on storage size and
duration (ledgers). See [Data Model](data-model.md#ttl-mechanics-worked-with-real-numbers).

### Stroop
The smallest indivisible unit of native Lumens (XLM). 1 XLM = 10,000,000 stroops
($10^{-7}$ XLM). All on-chain asset balances and SDK values are represented as
integer stroops (or base units) using `bigint`.

---

## T

### Temporary Storage
Soroban's ephemeral storage tier designed for transient data. Temporary storage
entries cannot be restored once their TTL expires; they are permanently
deleted. LumenForge contracts intentionally avoid temporary storage for
custody records.

### Time-To-Live (TTL)
The remaining lifespan of a Soroban contract instance or storage entry,
expressed in ledger counts. Decrements by 1 every ledger (~5 seconds). Can be
extended via `extend_ttl` up to network maximum thresholds.

### Trustline
On classic Stellar, an explicit ledger entry established by an account that
authorizes holding a specific asset issued by an anchor or issuing account.
Each trustline consumes a 0.5 XLM base reserve. Soroban contracts do not use
trustlines; their balances are recorded directly inside the token contract.

### Two-Step Ownership Transfer
A security pattern implemented in `lumen_vault` to eliminate the risk of
accidentally transferring vault control to an invalid or mistyped address.
The current owner calls `propose_new_owner(candidate)`, and the transfer is
only finalized when the candidate calls `accept_ownership()`.

---

## V

### Vault Factory Index
The persistent map (`VaultsByOwner`) maintained by `lumen_vault_factory`
mapping each owner address to their deployed vault addresses (up to 100).
Informational in nature; ownership transfer inside the vault does not mutate
the deploying factory's historical index.

### Vault Snapshot (`VaultSnapshot`)
A batched SDK data structure returned by `getVaultSnapshot()` providing an
atomic view of a vault's configuration, including owner, token, balance,
minimum deposit, maximum balance, pause status, and allowance settings.

---

## W

### Wasm Hash
The 32-byte SHA-256 hash identifying the compiled WebAssembly bytecode
installed on the Stellar network. Deployed contracts reference the installed
Wasm hash rather than re-uploading duplicate bytecode.

---

## X

### XDR (External Data Representation)
The standard binary serialization format used across the Stellar network to
encode ledgers, transactions, operations, contract keys, and values. The
LumenForge SDK handles XDR serialization and deserialization transparently.
