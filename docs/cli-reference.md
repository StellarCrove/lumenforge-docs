# CLI Reference

A complete, exhaustive reference for the `lumenforge` command-line tool
that ships alongside `@lumenforge/sdk`. Where
[api-reference.md](api-reference.md) documents the TypeScript library,
this page documents the same functionality exposed as a script-friendly
binary — every flag, every environment variable, every exit code,
every error message you can hit, and worked examples for each command.

If you're integrating LumenForge into an application, you almost
certainly want the SDK directly (see
[integration-guide.md](integration-guide.md)). The CLI exists for the
cases where writing a TypeScript file is more ceremony than the task
deserves: a cron job that keeps a handful of vaults alive, a one-off
balance check from a terminal, exercising a fresh deployment by hand
before wiring up real application code, or gluing LumenForge into a
shell pipeline alongside other tools.

This document assumes `@lumenforge/sdk` 0.14.0 or later. Command
behavior for earlier versions may differ; always cross-check against
`lumenforge --help` for the binary you actually have installed, since
that output is generated from the same source as this document and is
the ground truth if the two ever disagree.

## Table of contents

- [Philosophy and scope](#philosophy-and-scope)
- [Installation](#installation)
- [Environment variables](#environment-variables)
- [Global behavior](#global-behavior)
- [Command: `vault snapshot`](#command-vault-snapshot)
- [Command: `vault deposit`](#command-vault-deposit)
- [Command: `vault withdraw`](#command-vault-withdraw)
- [Command: `vault keep-alive`](#command-vault-keep-alive)
- [Command: `factory snapshot`](#command-factory-snapshot)
- [Command: `factory deploy-vault`](#command-factory-deploy-vault)
- [Command: `factory list-vaults`](#command-factory-list-vaults)
- [Command: `factory keep-owner-vaults-alive`](#command-factory-keep-owner-vaults-alive)
- [Command: `events list`](#command-events-list)
- [Automation recipes](#automation-recipes)
- [Scripting and JSON output](#scripting-and-json-output)
- [Troubleshooting](#troubleshooting)
- [CLI vs. the library: when to use which](#cli-vs-the-library-when-to-use-which)
- [Full flag index](#full-flag-index)

## Philosophy and scope

The CLI is deliberately a thin wrapper — every command maps to a small
number of SDK calls documented in [api-reference.md](api-reference.md),
with no logic that doesn't already exist in the library. This matters
for two reasons.

First, it means the CLI can never be "more correct" or "more buggy"
than the library for the operations it wraps — a fixed contract
behavior, error message, or default value shows up identically whether
you called the TypeScript function yourself or ran the equivalent
`lumenforge` command. There is no separate code path to drift out of
sync, beyond the argument-parsing and formatting layer itself.

Second, it means the CLI is intentionally incomplete: it wraps the
common scripting cases (read a vault, deposit, withdraw, deploy through
the factory, list an owner's vaults, keep things alive, read decoded
events), not the library's entire surface. There is currently no CLI
command for `pause`/`unpause`, `propose_owner`/`accept_owner`/
`cancel_pending_owner`, `set_min_deposit`/`set_max_balance`, or
`rescue` — those remain library-only. If you need one of those from a
script today, write a short TypeScript file that imports
`connectVault` and calls the method directly; see
[api-reference.md](api-reference.md#vault-methods-vaultclient) for the
exact signature.

## Installation

Three ways to run the CLI, in order of how "installed" it ends up
being on your system:

### Global install

```bash
npm install -g @lumenforge/sdk
lumenforge --help
```

Puts a `lumenforge` binary on your `PATH`. Best for a machine you use
LumenForge on repeatedly — a personal workstation, a dedicated ops
box, a long-lived CI runner.

### `npx`, no install

```bash
npx @lumenforge/sdk lumenforge --help
```

Downloads and runs the package for a single invocation, without
touching global state. Best for a one-off check on a machine you don't
otherwise manage, or a CI job that shouldn't leave behind installed
global packages.

Note the double name — `npx @lumenforge/sdk lumenforge ...` — because
the package name (`@lumenforge/sdk`) and the binary name it exposes
(`lumenforge`) differ. `npx` needs the package name to know what to
download; the trailing `lumenforge` is which binary from that package
to actually run.

### From a local project dependency

If your project already has `@lumenforge/sdk` in `package.json`:

```bash
npm install @lumenforge/sdk
npx lumenforge --help
# or, inside package.json scripts:
# "keeper": "lumenforge factory keep-owner-vaults-alive --contract ... --owner ..."
```

`npx` here resolves `lumenforge` from `node_modules/.bin` first, so it
picks up the exact version pinned in your `package.json` rather than
whatever the global install (if any) happens to be. This is the
recommended approach for anything checked into a repository — a
`package.json` script wrapping a `lumenforge` invocation is
reproducible across machines and CI runners in a way a globally
installed binary isn't.

## Environment variables

Every command reads its network configuration from environment
variables rather than flags. This is a deliberate, consistent design
choice across the whole CLI — not just for the secret key (where the
security reasoning is obvious) but for the RPC URL and network
passphrase too, since those rarely change between invocations in a
given environment and repeating them as flags on every command would
be pure noise.

### `LUMENFORGE_RPC_URL`

**Required for every command.** The Soroban RPC endpoint to connect
to.

```bash
export LUMENFORGE_RPC_URL="https://soroban-testnet.stellar.org"
```

The scheme of this URL matters beyond just routing: the CLI inspects
it to decide whether to pass `allowHttp: true` to the underlying
`rpc.Server`/`contract.Client` construction. Specifically, `allowHttp`
is set if and only if the URL starts with the literal string
`http://` — an `https://` URL, or any other scheme, never sets it.
This means a local standalone Soroban network (typically served over
plain `http://localhost:8000` or similar) works without any extra
configuration, while a normal `https://` production or testnet
endpoint gets the secure default. There is no separate flag or
environment variable to force this either way — it is inferred purely
from the URL scheme, precisely so that switching between a local
network and testnet/mainnet is just a matter of changing this one
variable.

Missing this variable produces:

```
lumenforge: missing required environment variable LUMENFORGE_RPC_URL
```

on every command, before any network activity is attempted.

### `LUMENFORGE_NETWORK_PASSPHRASE`

**Required for every command.** The network passphrase identifying
which Stellar network you're transacting against — this is baked into
every transaction's signature, so a mismatch between this value and
the network the RPC endpoint actually serves produces authentication
failures that can be confusing to diagnose if you don't immediately
suspect this variable.

Common values:

| Network | Passphrase |
|---|---|
| Testnet | `Test SDF Network ; September 2015` |
| Public/mainnet | `Public Global Stellar Network ; September 2015` |
| A local standalone network | `Standalone Network ; February 2017` (the default `stellar-core` standalone config uses this, but a differently configured local network could use anything — check your network's own configuration) |

```bash
export LUMENFORGE_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

Missing this variable produces:

```
lumenforge: missing required environment variable LUMENFORGE_NETWORK_PASSPHRASE
```

### `LUMENFORGE_SECRET_KEY`

**Required only for state-changing commands** — `vault deposit`,
`vault withdraw`, `vault keep-alive`, `factory deploy-vault`, `factory
keep-owner-vaults-alive`. Read-only commands (`vault snapshot`,
`factory snapshot`, `factory list-vaults`, `events list`) never
require it, though they'll use it opportunistically to derive a
`--public-key` if you don't pass one explicitly (see below).

This is a Stellar secret key (`S...`, the strkey-encoded Ed25519
seed), used to construct a `Keypair` and sign transactions via
`@stellar/stellar-sdk/contract`'s own `KeypairSigner` — the CLI
performs no custom cryptography, it delegates entirely to the same
signing primitive the library documents in
[api-reference.md](api-reference.md).

**This is deliberately an environment variable, never a `--flag`,
and the CLI enforces this by simply not defining a
`--secret-key` option at all** — there is no flag you could
accidentally pass it as, even if you tried. The reasoning, stated
plainly:

- A command-line flag's value is visible to every other process on
  the same machine that can run `ps aux` (or platform equivalent)
  while your command is executing — an environment variable is not
  visible this way (though it is visible to any process with access
  to `/proc/<pid>/environ` on Linux, so this is a meaningfully better
  posture, not a perfect one).
- A flag typed at an interactive shell prompt lands in that shell's
  history file (`~/.bash_history`, `~/.zsh_history`, etc.) by default,
  often persisted indefinitely and readable by anyone with access to
  your home directory or a backup of it. An environment variable set
  with `export` in the same session is not written to shell history
  merely by being exported (though scripts that `echo` it, or shells
  configured to log environment changes, could still leak it — no
  mechanism here is bulletproof, only meaningfully better than the
  alternative).
- Environment variables are the conventional mechanism CI systems
  (GitHub Actions secrets, GitLab CI variables, etc.) use to inject
  credentials into a job without ever writing them into the job's
  command line or logs, so this design also happens to compose
  naturally with how you'd actually run this in CI.

```bash
export LUMENFORGE_SECRET_KEY="SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

Attempting a state-changing command without this set produces:

```
lumenforge: missing required environment variable LUMENFORGE_SECRET_KEY
```

**On the trust model**: this CLI is not a wallet, and the secret you
give it is held in the plain in this process's memory for the
duration of one command's execution, then the process exits and (in
the absence of a bug in Node.js's own memory management — outside
this project's control) that memory is reclaimed. This is an
appropriate model for a secret you control, running a script you
control, on a machine you control — a scheduled keeper job, a
personal deployment script. It is not an appropriate way to let a
third party's funds pass through your control; nothing about this
tool changes who is trusted to hold the money a vault's `owner` key
can move.

### Precedence and interaction between variables

There is no precedence to speak of between `LUMENFORGE_RPC_URL` and
`LUMENFORGE_NETWORK_PASSPHRASE` — both are always required, and
neither influences the other. `LUMENFORGE_SECRET_KEY` interacts with
the `--public-key` flag on read-only commands specifically: if you
pass `--public-key` explicitly, that value is used outright and
`LUMENFORGE_SECRET_KEY` (even if set) is never consulted for the
purpose of deriving a public key. If you omit `--public-key` and
`LUMENFORGE_SECRET_KEY` is set, the CLI derives the corresponding
public key from it (`Keypair.fromSecret(secret).publicKey()`) and uses
that. If both are absent on a command that needs a source account to
simulate against, you get:

```
lumenforge: pass --public-key, or set LUMENFORGE_SECRET_KEY, for a source account to simulate against
```

## Global behavior

### Invocation shape

Every command has the shape:

```
lumenforge <resource> <action> [--flag value ...]
```

`<resource>` is one of `vault`, `factory`, or `events`. `<action>` is
one of that resource's supported actions (see the command reference
sections below). Flags are always `--flag-name value` (space-
separated) or `--flag-name=value` (equals-sign form) — both are
accepted, since the CLI's argument parsing is built on Node's built-in
`node:util.parseArgs`, which supports both forms natively. The
equals-sign form is specifically useful for one edge case: passing a
value that itself looks like a flag, most commonly a negative number.
`--start-ledger -5` is ambiguous to the parser (it can't tell if `-5`
is `--start-ledger`'s value or the start of a separate, unrecognized
flag) and is rejected outright; `--start-ledger=-5` is unambiguous and
parses correctly, whether or not the resulting value then passes this
particular flag's own validation (a negative ledger number is
rejected anyway, just with a different, clearer error — see the
[`events list`](#command-events-list) section).

### `--help`

```bash
lumenforge --help
```

Prints the command summary (a condensed version of what this document
covers in full) and exits `0`. This is the fastest way to check
exactly which flags a version of the CLI you actually have installed
supports, since — as noted above — it's generated from the same
source as this document.

### No arguments

Running `lumenforge` with no resource/action at all prints the same
usage text as `--help`, but exits `1` instead of `0` — this
distinguishes "you asked for help" from "you forgot to say what you
wanted," which matters if a script checks the exit code to decide
whether a `lumenforge` invocation embedded in it "worked."

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — including `--help` and any command that completed. Note that "completed" is not the same as "every operation inside it succeeded" for commands like `keepAlive`/`keepOwnerVaultsAlive`, which report per-target success/failure in their JSON output rather than failing the whole process for one bad target — see those commands' sections. |
| `1` | Any failure: a missing/invalid argument, a missing environment variable, a network error, a contract call rejecting with an on-chain error, or no arguments given at all. The CLI does not currently distinguish different failure categories with different exit codes — everything that isn't success is `1`. If your automation needs to distinguish failure types, parse the printed error message (see [Scripting and JSON output](#scripting-and-json-output)) rather than relying on a richer exit-code scheme that doesn't exist yet. |

### Output format

Every command that produces output prints exactly one JSON value to
stdout, pretty-printed with 2-space indentation, and nothing else on
stdout (diagnostic/error text goes to stderr, always prefixed
`lumenforge: `). This makes every command's output pipeable directly
into `jq` or any other JSON-aware tool without needing to strip
surrounding text first. `bigint` values (amounts, balances) are
serialized as JSON strings (since JSON has no native 64-bit-plus
integer type and naively serializing a `bigint` throws), so expect
`"500"` rather than `500` for amount fields — see
[Scripting and JSON output](#scripting-and-json-output) for how to
handle this when parsing.

### Malformed arguments

Node's own `parseArgs` throws synchronously on certain malformed
inputs — most commonly an unrecognized flag, or a value that looks
like another flag (see the negative-number case above). The CLI
catches this and reports it the same way as any other failure:

```
lumenforge: invalid arguments: Unknown option '--totally-bogus-flag'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--totally-bogus-flag"
```

exiting `1`. Prior to CLI version 0.14.0 (SDK version, not a separate
CLI version number — this tool doesn't have independent versioning),
this specific class of error was not caught and instead crashed with
a raw, uncaught Node.js exception and stack trace; if you're
scripting against an older installed version and see a stack trace
instead of a `lumenforge: ...` line, that's the symptom, and
upgrading resolves it.

## Command: `vault snapshot`

Reads a vault's complete on-chain state in one call — the CLI
equivalent of the library's `getVaultSnapshot`, documented in
[api-reference.md](api-reference.md#getvaultsnapshotvault-promisevaultsnapshot).

### Synopsis

```
lumenforge vault snapshot --contract <C...> [--public-key <G...>]
```

### Flags

| Flag | Required | Type | Notes |
|---|---|---|---|
| `--contract` | yes | `C...` address | The vault to read. |
| `--public-key` | no | `G...` address | Account to simulate the read as. If omitted, derived from `LUMENFORGE_SECRET_KEY` if set; otherwise the command fails (see [Environment variables](#precedence-and-interaction-between-variables)). |

### Environment

`LUMENFORGE_RPC_URL`, `LUMENFORGE_NETWORK_PASSPHRASE` required.
`LUMENFORGE_SECRET_KEY` optional (used only to derive `--public-key`
if that flag is absent) — this is a read-only operation and nothing
is ever signed or submitted.

### Example

```bash
export LUMENFORGE_RPC_URL="https://soroban-testnet.stellar.org"
export LUMENFORGE_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

lumenforge vault snapshot \
  --contract CVAULTEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --public-key GEXAMPLEPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Sample output:

```json
{
  "balance": "500",
  "owner": "GOWNERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "pendingOwner": null,
  "token": "CTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "minDeposit": "0",
  "maxBalance": null,
  "paused": false
}
```

Note `pendingOwner`/`maxBalance` render as JSON `null` here — this is
`JSON.stringify`'s standard handling of a JavaScript `undefined` value
inside an object being serialized (the key is kept, the value becomes
`null`), not a distinct "explicitly null" state the contract has. The
underlying library type is `string | undefined` /
`bigint | undefined`, exactly as documented in
[api-reference.md](api-reference.md#getvaultsnapshotvault-promisevaultsnapshot);
the CLI's JSON serialization is simply where that `undefined` becomes
visible as `null` to a downstream consumer like `jq`.

### Failure modes

| Cause | Message |
|---|---|
| Missing `--contract` | `lumenforge: missing required --contract` |
| Missing both `--public-key` and `LUMENFORGE_SECRET_KEY` | `lumenforge: pass --public-key, or set LUMENFORGE_SECRET_KEY, for a source account to simulate against` |
| `--contract` doesn't resolve to a deployed `lumen_vault` (wrong address, wrong contract type, or a vault whose constructor never ran successfully) | A network/simulation error from the underlying RPC call — the exact text depends on what the RPC endpoint reports, since this isn't a CLI-level validation but a failure of the actual `connectVault`/`getVaultSnapshot` calls it wraps. |

## Command: `vault deposit`

Deposits into a vault. State-changing — requires
`LUMENFORGE_SECRET_KEY` belonging to the depositing account (`--from`
must be that key's own address, since `deposit` requires
`from.require_auth()` on-chain — see
[api-reference.md](api-reference.md#vault-methods-vaultclient)).

### Synopsis

```
lumenforge vault deposit --contract <C...> --from <G...> --amount <n>
```

### Flags

| Flag | Required | Type | Notes |
|---|---|---|---|
| `--contract` | yes | `C...` address | The vault to deposit into. |
| `--from` | yes | `G...` address | The depositing account. Must match `LUMENFORGE_SECRET_KEY`'s own address, or the on-chain `from.require_auth()` check fails. |
| `--amount` | yes | integer string | Parsed as a `bigint`. Must be a positive integer per the contract's own validation (`InvalidAmount` otherwise) — the CLI does not pre-validate positivity itself, only that the string parses as *some* integer. |

### Environment

`LUMENFORGE_RPC_URL`, `LUMENFORGE_NETWORK_PASSPHRASE`,
`LUMENFORGE_SECRET_KEY` all required.

### Example

```bash
export LUMENFORGE_SECRET_KEY="SDEPOSITORSECRETKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

lumenforge vault deposit \
  --contract CVAULTEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --from GDEPOSITORPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 500
```

Sample output — the transaction's resolved result, which for `deposit`
is the vault's new total balance after this deposit:

```json
"500"
```

(A bare JSON string/number here, not an object — `deposit`'s return
type is `bigint`, and the CLI prints whatever `AssembledTransaction`'s
`.result` resolves to after `signAndSend()`, without wrapping it.)

### Failure modes

| Cause | Message / behavior |
|---|---|
| Missing `--contract`/`--from` | `lumenforge: missing required --contract` / `--from` |
| Missing or non-integer `--amount` | `lumenforge: --amount must be an integer, got "<value>"` — this is a CLI-level check, catching what would otherwise be a raw `SyntaxError` from `BigInt()` |
| Missing `LUMENFORGE_SECRET_KEY` | `lumenforge: missing required environment variable LUMENFORGE_SECRET_KEY` |
| `--from` doesn't match the secret key's own address | An authorization failure surfaced by the RPC simulation/submission — Soroban's `from.require_auth()` check fails because the signed transaction's auth entries don't cover the `from` address you specified. |
| Amount is zero or negative | Contract-level `InvalidAmount` error, via `VAULT_ERROR_TYPES` |
| Vault is paused | Contract-level `Paused` error |
| Amount below the vault's configured minimum | Contract-level `BelowMinimumDeposit` error |
| Deposit would exceed the vault's configured maximum balance | Contract-level `ExceedsMaxBalance` error |
| Depositing account lacks sufficient token balance/trustline for the underlying SEP-41 token | A token-contract-level failure, not one of `lumen_vault`'s own error codes — the exact message depends on the token contract. |

## Command: `vault withdraw`

Withdraws from a vault. Owner-only — requires `LUMENFORGE_SECRET_KEY`
belonging to the vault's current owner.

### Synopsis

```
lumenforge vault withdraw --contract <C...> --amount <n>
```

### Flags

| Flag | Required | Type | Notes |
|---|---|---|---|
| `--contract` | yes | `C...` address | The vault to withdraw from. |
| `--amount` | yes | integer string | Parsed as a `bigint`. |

Note there is no `--from`/`--to` flag here, unlike `deposit` — the
recipient of a withdrawal is always the vault's owner (read from the
vault's own storage, on-chain), never a caller-supplied argument. This
mirrors the contract's own signature exactly:
`withdraw(env, amount) -> Result<i128, Error>` takes no address
argument at all.

### Environment

`LUMENFORGE_RPC_URL`, `LUMENFORGE_NETWORK_PASSPHRASE`,
`LUMENFORGE_SECRET_KEY` all required. The secret key must belong to
the vault's current owner.

### Example

```bash
export LUMENFORGE_SECRET_KEY="SOWNERSECRETKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

lumenforge vault withdraw \
  --contract CVAULTEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 200
```

Sample output — the new balance after withdrawal:

```json
"300"
```

### Failure modes

| Cause | Message / behavior |
|---|---|
| Missing `--contract`/`--amount` | as above |
| `LUMENFORGE_SECRET_KEY` doesn't belong to the vault's current owner | Authorization failure — `owner.require_auth()` fails on-chain. |
| Amount is zero or negative | `InvalidAmount` |
| Amount exceeds the vault's current balance | `InsufficientBalance` |

## Command: `vault keep-alive`

Extends a single vault's storage TTL. Anyone can pay for this — the
underlying `extend_ttl` contract method requires no authorization at
all — but the CLI still requires `LUMENFORGE_SECRET_KEY` because
*something* has to sign and pay the transaction fee, even for a call
that needs no on-chain permission check.

### Synopsis

```
lumenforge vault keep-alive --contract <C...> [--threshold <n>] [--extend-to <n>]
```

### Flags

| Flag | Required | Type | Default | Notes |
|---|---|---|---|---|
| `--contract` | yes | `C...` address | — | The vault to keep alive. |
| `--threshold` | no | integer | `17280` (~1 day at 5s/ledger) | Only extends if the remaining TTL is at or below this many ledgers. |
| `--extend-to` | no | integer | `518400` (~30 days) | Ledger distance from current to extend *to* — an absolute target, not a duration added on top of the current TTL. |

These defaults and semantics are identical to the library's
`extendTtl`/`KeepAliveOptions`, documented in full in
[api-reference.md](api-reference.md#extendttltarget-options).

### Environment

`LUMENFORGE_RPC_URL`, `LUMENFORGE_NETWORK_PASSPHRASE`,
`LUMENFORGE_SECRET_KEY` all required.

### Example

```bash
lumenforge vault keep-alive --contract CVAULTEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Custom thresholds — extend only if within ~2 days of expiry, out to ~60 days
lumenforge vault keep-alive \
  --contract CVAULTEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --threshold 34560 \
  --extend-to 1036800
```

Sample output (the resolved result of `extend_ttl`, which is `null`):

```json
null
```

### Failure modes

| Cause | Message |
|---|---|
| Non-integer `--threshold`/`--extend-to` | `lumenforge: --threshold must be an integer, got "<value>"` (same pattern for `--extend-to`) |
| `--extend-to` less than `--threshold` | A validation error from the underlying `extendTtl` call: `extendTtl: extendTo must be an integer >= threshold, got <value>` |

Note `--threshold`/`--extend-to` here accept *any* integer, including
negative ones, at the CLI argument-parsing layer — the negative-value
rejection happens one layer down, inside the library's own
`resolveOptions` validation (which requires a non-negative threshold),
not inside the CLI's flag parsing itself. This is intentional
consistency with how the library behaves when called directly; the
CLI doesn't duplicate validation the library already does correctly.

## Command: `factory snapshot`

Reads a factory's own state (not any specific owner's vaults) — the
CLI equivalent of `getFactorySnapshot`.

### Synopsis

```
lumenforge factory snapshot --contract <C...> [--public-key <G...>]
```

### Flags

Same shape as [`vault snapshot`](#command-vault-snapshot): `--contract`
required, `--public-key` optional (falls back to
`LUMENFORGE_SECRET_KEY`-derived).

### Example

```bash
lumenforge factory snapshot \
  --contract CFACTORYEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --public-key GEXAMPLEPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Sample output:

```json
{
  "vaultCount": 42,
  "vaultWasmHash": "a1b2c3d4e5f6..."
}
```

`vaultWasmHash` here is a `Buffer` in the library, serialized by
`JSON.stringify` as... actually as an object of numbered byte keys
unless specially handled — see the note in
[Scripting and JSON output](#scripting-and-json-output) about `Buffer`
serialization quirks if you're parsing this programmatically, since
this is one of the rougher edges of piping CLI output through generic
JSON tooling.

## Command: `factory deploy-vault`

Deploys a new `lumen_vault` **through the factory**, so it's indexed
in `vaults_by_owner`. Requires `LUMENFORGE_SECRET_KEY` belonging to
the new vault's intended owner (`deploy_vault` requires
`owner.require_auth()`).

### Synopsis

```
lumenforge factory deploy-vault --contract <C...> --owner <G...> --token <C...> --min-deposit <n> [--max-balance <n>] [--nonce <n>]
```

### Flags

| Flag | Required | Type | Notes |
|---|---|---|---|
| `--contract` | yes | `C...` address | The factory to deploy through. |
| `--owner` | yes | `G...` address | Must match `LUMENFORGE_SECRET_KEY`'s own address. |
| `--token` | yes | `C...` address | The SEP-41 token the new vault will custody. |
| `--min-deposit` | yes | integer string | Passed straight through to the vault's constructor. |
| `--max-balance` | no | integer string | Omit for no cap. |
| `--nonce` | no | non-negative integer | If given, derives a deterministic salt via `ownerNonceSalt(owner, nonce)` — the same `(owner, nonce)` pair always produces the same vault address. If omitted, a fresh random salt is used, and the resulting address can't be predicted in advance. |

### Environment

`LUMENFORGE_RPC_URL`, `LUMENFORGE_NETWORK_PASSPHRASE`,
`LUMENFORGE_SECRET_KEY` all required. The secret key must belong to
`--owner`.

### Example

```bash
export LUMENFORGE_SECRET_KEY="SOWNERSECRETKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# Random salt — address not known until after deployment
lumenforge factory deploy-vault \
  --contract CFACTORYEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --owner GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --token CTOKENADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --min-deposit 0

# Deterministic salt — this owner's 3rd vault via this factory always
# resolves to the same address, predictable before deployment
lumenforge factory deploy-vault \
  --contract CFACTORYEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --owner GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --token CTOKENADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --min-deposit 0 \
  --max-balance 1000000 \
  --nonce 3
```

Sample output — the new vault's address:

```json
"CNEWVAULTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

### Failure modes

| Cause | Message / behavior |
|---|---|
| Missing required flags | as above per flag |
| Non-integer `--min-deposit`/`--max-balance` | `lumenforge: --min-deposit must be an integer, got "<value>"` (same pattern for `--max-balance`) |
| Non-integer `--nonce` | `lumenforge: --nonce must be an integer, got "<value>"` |
| `--owner` doesn't match the secret key | Authorization failure |
| Owner has already hit the per-factory vault cap (100) | Contract-level `TooManyVaultsForOwner` |
| Deterministic salt collides with an already-deployed address (reusing the same `--nonce` for the same owner) | The deployment itself fails at the host level — Soroban rejects deploying to an address that already exists. This surfaces as a lower-level transaction/simulation failure rather than one of `lumen_vault_factory`'s own named error codes, since address collision isn't something the contract code detects and reports — it's the platform rejecting the operation before the contract's own logic runs. |

## Command: `factory list-vaults`

Lists the vaults a given owner has deployed through this factory —
either as bare addresses, or with each one's full snapshot.

### Synopsis

```
lumenforge factory list-vaults --contract <C...> --owner <G...> [--with-snapshots] [--public-key <G...>]
```

### Flags

| Flag | Required | Type | Notes |
|---|---|---|---|
| `--contract` | yes | `C...` address | The factory to query. |
| `--owner` | yes | `G...` address | Whose vaults to list. |
| `--with-snapshots` | no | boolean (presence-only) | If given, resolves each address into its full `getVaultSnapshot`. Costs one extra RPC round trip per vault, sequentially — not parallelized (see [api-reference.md](api-reference.md#iteratevaultsnapshotsbyowner-collectvaultsnapshotsbyowner) for why). |
| `--public-key` | no | `G...` address | Falls back to `LUMENFORGE_SECRET_KEY`-derived, same as the other read-only commands. |

Without `--with-snapshots`, this command paginates internally via
`collectVaultsByOwner` and returns a bare array of addresses — a
single RPC round trip regardless of how many vaults the owner has (up
to the pagination helper's internal page-size handling, which is
transparent to CLI callers; you always get the complete list in one
invocation, never a partial page).

### Environment

`LUMENFORGE_RPC_URL`, `LUMENFORGE_NETWORK_PASSPHRASE` required.
`LUMENFORGE_SECRET_KEY` optional (for `--public-key` derivation only).

### Example

```bash
# Just addresses
lumenforge factory list-vaults \
  --contract CFACTORYEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --owner GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --public-key GEXAMPLEPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

```json
[
  "CVAULTONEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "CVAULTTWOXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
]
```

```bash
# With full state per vault
lumenforge factory list-vaults \
  --contract CFACTORYEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --owner GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --public-key GEXAMPLEPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --with-snapshots
```

```json
[
  {
    "address": "CVAULTONEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "balance": "500",
    "owner": "GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "pendingOwner": null,
    "token": "CTOKENAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "minDeposit": "0",
    "maxBalance": null,
    "paused": false
  },
  {
    "address": "CVAULTTWOXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "balance": "0",
    "owner": "GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "pendingOwner": null,
    "token": "CTOKENBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "minDeposit": "100",
    "maxBalance": "1000000",
    "paused": false
  }
]
```

### Failure modes

| Cause | Message |
|---|---|
| Missing `--contract`/`--owner` | as above |
| Owner has never deployed a vault through this factory | An empty array `[]` — this is not an error, `vaults_by_owner`/`vaults_by_owner_count` both return cleanly for an owner with zero vaults. |

## Command: `factory keep-owner-vaults-alive`

Discovers every vault an owner has (via the same pagination as
`list-vaults`) and extends each one's TTL — the fleet-wide keeper
operation.

### Synopsis

```
lumenforge factory keep-owner-vaults-alive --contract <C...> --owner <G...> [--threshold <n>] [--extend-to <n>]
```

### Flags

Same `--threshold`/`--extend-to` semantics as
[`vault keep-alive`](#command-vault-keep-alive), applied to every
discovered vault uniformly (there is currently no way to pass
different threshold/extendTo values per vault from the CLI — if you
need that, use the library's `keepOwnerVaultsAlive` directly and
compute per-vault options yourself).

| Flag | Required | Type | Default |
|---|---|---|---|
| `--contract` | yes | `C...` address | — |
| `--owner` | yes | `G...` address | — |
| `--threshold` | no | integer | `17280` |
| `--extend-to` | no | integer | `518400` |

### Environment

`LUMENFORGE_RPC_URL`, `LUMENFORGE_NETWORK_PASSPHRASE`,
`LUMENFORGE_SECRET_KEY` all required. The secret key signs and pays
for every extension — it does not need to be the vaults' own owner
key, since `extend_ttl` requires no authorization at all; any funded
account can run this command on any owner's vaults.

### Example

```bash
lumenforge factory keep-owner-vaults-alive \
  --contract CFACTORYEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --owner GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Sample output — one entry per discovered vault, each with its own
independent outcome:

```json
[
  {
    "address": "CVAULTONEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "status": "ok"
  },
  {
    "address": "CVAULTTWOXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "status": "error",
    "error": "..."
  }
]
```

**This command can exit `0` even when one or more vaults failed to
extend** — a per-vault `status: "error"` entry in the array does not
by itself make the overall process exit non-zero, because the whole
point of this operation's design (mirroring the library's
`keepOwnerVaultsAlive`/`keepAlive`) is that one vault's failure
shouldn't stop the rest from being attempted. If your automation needs
to alert on partial failure, check the JSON output for any
`status: "error"` entry yourself (e.g. with `jq 'any(.[]; .status == "error")'`)
rather than relying on the process exit code — see
[Scripting and JSON output](#scripting-and-json-output).

Reminder, restated here because it's easy to miss: this command does
**not** also extend the factory's own `VaultsByOwner(owner)`
persistent entry — pair it with a call to `extendVaultsByOwnerTtl`
(library-only; there's no CLI command for it yet) if you need that
kept alive too. See [data-model.md](data-model.md#lumen_vault_factory)
for exactly why these are separate TTLs.

## Command: `events list`

Reads and decodes contract events over a ledger range.

### Synopsis

```
lumenforge events list --contract <C...> --start-ledger <n> --kind vault|factory
```

### Flags

| Flag | Required | Type | Notes |
|---|---|---|---|
| `--contract` | yes | `C...` address | Whose events to read — either a vault or a factory address, matching `--kind`. |
| `--start-ledger` | yes | non-negative integer | The ledger sequence to start reading from. |
| `--kind` | yes | `"vault"` or `"factory"` | Which decoder to apply — `decodeVaultEvents` or `decodeFactoryEvents`. Any other value is rejected. |

There is currently no `--end-ledger` flag — this command always reads
to the RPC endpoint's most recent retained ledger. There is also no
pagination/cursor flag; for a very large range, you may hit whatever
limits the RPC endpoint itself imposes on a single `getEvents` call,
in which case you'll need to call this multiple times with increasing
`--start-ledger` values, or use the library's `rpc.Server.getEvents`
directly with its own cursor-based pagination for full control.

### Environment

`LUMENFORGE_RPC_URL`, `LUMENFORGE_NETWORK_PASSPHRASE` required. No
secret key needed — reading events requires no signing.

### Example

```bash
lumenforge events list \
  --contract CVAULTEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --start-ledger 123456 \
  --kind vault
```

Sample output:

```json
[
  {
    "type": "deposit",
    "from": "GDEPOSITORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "amount": "500",
    "new_balance": "500"
  },
  {
    "type": "withdraw",
    "owner": "GOWNERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "amount": "200",
    "new_balance": "300"
  }
]
```

Note that the SEP-41 token's own `transfer` events, which occur as a
side effect of `deposit`/`withdraw`/`rescue` internally calling the
token contract, are **not** included here — `decodeVaultEvents`
silently drops anything that isn't a recognized `lumen_vault` event,
exactly as documented in
[api-reference.md](api-reference.md#decodevaulteventsevents-decodefactoryeventsevents).
If you need the raw token transfer events too, you'll need to call
`server.getEvents` yourself via the library and skip the decoding step
for those entries.

### Failure modes

| Cause | Message |
|---|---|
| Missing `--contract` | `lumenforge: missing required --contract` |
| Missing or non-numeric `--start-ledger` | `lumenforge: --start-ledger must be a non-negative integer, got "<value>"` |
| Negative `--start-ledger` | Same message as above — negative values fail the same non-negative check as non-numeric ones. |
| `--start-ledger` passed as a negative literal without `=` (e.g. `--start-ledger -5`) | Caught one layer up, by the `parseArgs` wrapper, before even reaching this command's own validation: `lumenforge: invalid arguments: Option '--start-ledger' argument is ambiguous. ... To specify an option argument starting with a dash use '--start-ledger=-XYZ'.` Use `--start-ledger=-5` if you genuinely need to pass a negative literal through the parser (though the command will then reject it anyway for being negative — this is purely about which layer produces the error message). |
| Missing or invalid `--kind` | `lumenforge: missing required --kind` or `lumenforge: --kind must be "vault" or "factory"` |
| `--start-ledger` refers to a ledger the RPC endpoint no longer retains (too far in the past) | An RPC-level error, whose exact text depends on the endpoint — this is not something the CLI validates itself, since "how far back does this endpoint retain events" varies by provider and configuration. |

## Automation recipes

Concrete, copy-pasteable setups for running `lumenforge` on a
schedule, across a few common environments. All of these assume the
environment variables are made available to the scheduled job by
whatever mechanism that scheduler provides for secrets/environment —
never hardcode a secret key into a crontab line, a systemd unit file
checked into version control, or a CI workflow file's plain text.

### `cron` on Linux/macOS

A crontab entry itself typically doesn't have access to your
interactive shell's exported environment variables, so either source
an env file first or set the variables inline. Sourcing an env file
(kept out of version control, permissions locked to your user) is
the cleaner approach:

```bash
# /home/deploy/.lumenforge.env — chmod 600, not committed anywhere
LUMENFORGE_RPC_URL=https://soroban-testnet.stellar.org
LUMENFORGE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
LUMENFORGE_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

```cron
# crontab -e
# Every night at 02:00, keep this owner's vaults alive
0 2 * * * . /home/deploy/.lumenforge.env && /usr/local/bin/lumenforge factory keep-owner-vaults-alive --contract CFACTORY... --owner GOWNER... >> /var/log/lumenforge-keeper.log 2>&1
```

The `. /path/to/env-file &&` idiom sources the file into the shell
`cron` invokes the command with before running the actual command —
this only works because both are chained with `&&` in a single
crontab line (each cron line runs in its own fresh shell, so exported
variables from one line never carry over to another).

### `systemd` timer (Linux)

More robust than plain cron for anything you want proper logging and
restart semantics for:

```ini
# /etc/systemd/system/lumenforge-keeper.service
[Unit]
Description=LumenForge vault keeper

[Service]
Type=oneshot
EnvironmentFile=/etc/lumenforge/keeper.env
ExecStart=/usr/local/bin/lumenforge factory keep-owner-vaults-alive --contract CFACTORY... --owner GOWNER...
```

```ini
# /etc/systemd/system/lumenforge-keeper.timer
[Unit]
Description=Run the LumenForge vault keeper nightly

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo chmod 600 /etc/lumenforge/keeper.env
sudo systemctl enable --now lumenforge-keeper.timer
journalctl -u lumenforge-keeper.service   # check logs
```

### GitHub Actions scheduled workflow

Store `LUMENFORGE_SECRET_KEY` (and the RPC URL/passphrase, if you'd
rather not hardcode even those in the workflow file) as repository or
environment secrets, never as plain workflow-file values:

```yaml
# .github/workflows/keeper.yml
name: LumenForge keeper
on:
  schedule:
    - cron: "0 2 * * *"
  workflow_dispatch: {}

jobs:
  keep-alive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx @lumenforge/sdk lumenforge factory keep-owner-vaults-alive --contract "$FACTORY_CONTRACT" --owner "$OWNER_ADDRESS"
        env:
          LUMENFORGE_RPC_URL: ${{ secrets.LUMENFORGE_RPC_URL }}
          LUMENFORGE_NETWORK_PASSPHRASE: ${{ secrets.LUMENFORGE_NETWORK_PASSPHRASE }}
          LUMENFORGE_SECRET_KEY: ${{ secrets.LUMENFORGE_SECRET_KEY }}
          FACTORY_CONTRACT: ${{ vars.FACTORY_CONTRACT }}
          OWNER_ADDRESS: ${{ vars.OWNER_ADDRESS }}
```

GitHub Actions automatically redacts any workflow secret's exact
value from job logs if it happens to be printed, which is one more
reason environment-variable-based secret injection (as opposed to a
command-line flag, which this CLI doesn't even offer for the secret
key) composes well with this kind of automation.

### Docker / containerized cron

If running inside a container on its own schedule (e.g. a Kubernetes
`CronJob`), pass the environment variables via the container runtime's
own secret-injection mechanism (a Kubernetes `Secret` mounted as env
vars, a Docker `--env-file`, etc.) rather than baking them into the
image:

```dockerfile
FROM node:22-slim
RUN npm install -g @lumenforge/sdk
ENTRYPOINT ["lumenforge"]
```

```bash
docker run --rm \
  --env-file /secure/lumenforge.env \
  lumenforge-image:latest \
  factory keep-owner-vaults-alive --contract CFACTORY... --owner GOWNER...
```

### macOS `launchd`

For a personal machine rather than a server, a `launchd` plist under
`~/Library/LaunchAgents/` achieves the same nightly-schedule effect as
`cron` without needing `cron` itself (which is deprecated on modern
macOS in favor of `launchd`):

```xml
<!-- ~/Library/LaunchAgents/com.lumenforge.keeper.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.lumenforge.keeper</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/lumenforge</string>
    <string>factory</string>
    <string>keep-owner-vaults-alive</string>
    <string>--contract</string>
    <string>CFACTORY...</string>
    <string>--owner</string>
    <string>GOWNER...</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LUMENFORGE_RPC_URL</key>
    <string>https://soroban-testnet.stellar.org</string>
    <key>LUMENFORGE_NETWORK_PASSPHRASE</key>
    <string>Test SDF Network ; September 2015</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>2</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
</dict>
</plist>
```

Note `LUMENFORGE_SECRET_KEY` is deliberately omitted from this plist's
`EnvironmentVariables` block — a plist file is plain text on disk,
readable by anything with your user's file permissions, so putting a
secret directly in it defeats much of the purpose of not passing it
as a CLI flag. Load it instead from the macOS Keychain via a wrapper
script that `launchd` invokes instead of `lumenforge` directly, or
from a separately-permissioned file your wrapper script sources
before calling `lumenforge` — the exact mechanism is up to you, but
avoid the plist itself.

```bash
sudo launchctl load -w ~/Library/LaunchAgents/com.lumenforge.keeper.plist
```

## Scripting and JSON output

### Checking success with `jq`

Since every command emits exactly one JSON value and nothing else on
stdout, `jq` composes directly:

```bash
BALANCE=$(lumenforge vault snapshot --contract "$VAULT" --public-key "$PUBKEY" | jq -r '.balance')
echo "Current balance: $BALANCE"
```

### Handling `bigint` fields

Amount-like fields (`balance`, `minDeposit`, `maxBalance`, `amount`,
`new_balance`, `min_deposit`) serialize as JSON strings, not numbers,
because they originate from TypeScript `bigint` values and
`JSON.stringify` cannot represent an arbitrary-precision integer as a
native JSON number without risking precision loss for very large
values. `jq`'s `-r` (raw output) flag combined with reading the field
as a string handles this correctly in shell:

```bash
lumenforge vault snapshot --contract "$VAULT" --public-key "$PUBKEY" | jq -r '.balance'
# => 500   (a plain string in the shell, not JSON-quoted)
```

If you need to do arithmetic on these values in a script, treat them
as arbitrary-precision integers (e.g. via `bc`, or a language runtime
with its own bigint/bignum support) rather than assuming they fit in
a standard 64-bit or `double` numeric type — the whole reason the
library uses `bigint` in the first place is that token amounts can
exceed what a JavaScript `number` can represent exactly.

### Detecting partial failure in `keepAlive`/`keepOwnerVaultsAlive` output

As noted in the [`factory keep-owner-vaults-alive`](#command-factory-keep-owner-vaults-alive)
section, these commands can exit `0` with some entries failed. Check
for that explicitly:

```bash
OUTPUT=$(lumenforge factory keep-owner-vaults-alive --contract "$FACTORY" --owner "$OWNER")
if echo "$OUTPUT" | jq -e 'any(.[]; .status == "error")' > /dev/null; then
  echo "One or more vaults failed to extend:" >&2
  echo "$OUTPUT" | jq -c '.[] | select(.status == "error")' >&2
  exit 1
fi
```

### The `Buffer` serialization quirk

`vaultWasmHash` in `factory snapshot`'s output originates from a
`Buffer` (32 raw bytes) in the library. `JSON.stringify`'s default
handling of a Node.js `Buffer` produces
`{"type":"Buffer","data":[161,178,...]}` (an array of byte values,
each 0-255) rather than a hex or base64 string, unless the CLI's own
serialization explicitly converts it first. Check the actual shape
with `--help`-adjacent experimentation against your installed
version before writing a parser that assumes one representation or
the other, since this is exactly the kind of formatting detail that
can shift between versions without necessarily being called out as a
breaking change in the changelog, if it's considered a formatting
fix rather than a behavior change.

### Composing multiple commands in a shell pipeline

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${LUMENFORGE_RPC_URL:?must be set}"
: "${LUMENFORGE_NETWORK_PASSPHRASE:?must be set}"
: "${LUMENFORGE_SECRET_KEY:?must be set}"

FACTORY="CFACTORYEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
OWNER="GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

echo "Vaults for $OWNER:"
lumenforge factory list-vaults --contract "$FACTORY" --owner "$OWNER" --public-key "$OWNER" \
  | jq -r '.[]' \
  | while read -r vault; do
      echo "  $vault:"
      lumenforge vault snapshot --contract "$vault" --public-key "$OWNER" \
        | jq -r '"    balance=\(.balance) paused=\(.paused)"'
    done
```

`set -euo pipefail` at the top is a standard defensive Bash idiom
worth adopting for any script wrapping this CLI: `-e` exits on the
first command that returns non-zero (so a failed `lumenforge` call
stops the script instead of continuing with garbage downstream data),
`-u` catches references to unset variables (catching a typo'd
environment variable name before it silently becomes an empty
string), and `-o pipefail` makes a pipeline's exit status reflect the
first failing command in it rather than only the last one.

## Troubleshooting

### "missing required environment variable" but I definitely set it

Environment variables set with `export` in one shell session are not
visible to a `cron` job, a `systemd` service, or a fresh terminal tab
— each of those starts with its own environment, populated from
wherever *that* context's configuration says to load it from (a
crontab's own `SHELL`/`PATH` handling, a systemd unit's
`EnvironmentFile`, your shell's own startup files). Check the
[Automation recipes](#automation-recipes) section for the specific
context you're running in.

### The negative-number flag problem

Covered in detail in [Global behavior](#invocation-shape) and the
[`events list`](#command-events-list) failure-modes table: any flag
value starting with `-` that isn't recognized as a valid flag of its
own is ambiguous to the underlying argument parser. Use the
`--flag=value` form (not `--flag value`) whenever the value itself
starts with a dash.

### "invalid arguments: Unknown option"

You passed a flag this CLI doesn't recognize — check the spelling
against this document's per-command flag tables, or run
`lumenforge --help` for the version you actually have installed
(flags have been added across versions; an older installed version
may genuinely not support a flag documented here for a newer one).

### A command hangs with no output

Most likely a network-level issue reaching `LUMENFORGE_RPC_URL` — a
wrong URL, a firewall blocking the connection, or (for a local
standalone network) the network not actually running yet. The CLI
does not currently impose its own request timeout beyond whatever the
underlying `@stellar/stellar-sdk` RPC client defaults to, so a
genuinely unreachable endpoint can hang for a while before the
underlying HTTP client's own timeout (if any) kicks in, rather than
failing fast with a CLI-level message.

### Getting a raw stack trace instead of a clean `lumenforge: ...` message

As of CLI (SDK package) version 0.14.0, this should not happen for any
input this document describes as producing a clean error — if you see
a raw Node.js stack trace, either you're running a version older than
0.14.0 (upgrade), or you've found a genuine gap in this project's
error handling worth reporting.

## CLI vs. the library: when to use which

| Scenario | Recommended |
|---|---|
| Building an application (web backend, mobile app backend, indexer service) that needs LumenForge integration as part of its normal request-handling logic | The library, directly. See [integration-guide.md](integration-guide.md). |
| A scheduled job (cron, systemd timer, CI schedule) whose entire job is "run one or a few LumenForge operations" | The CLI — no need to maintain a whole TypeScript file and its dependencies for a single scheduled task. |
| A one-off check from a terminal ("what's this vault's balance right now?") | The CLI. |
| You need `pause`/`unpause`, ownership transfer, `set_min_deposit`/`set_max_balance`, or `rescue` from a script | The library — these have no CLI command yet. |
| You need fine-grained control over pagination page size, concurrency of snapshot reads across many vaults, or custom TTL thresholds per vault in a batch | The library — the CLI's commands use fixed/simple defaults for these. |
| You're prototyping or exploring a freshly deployed factory/vault before writing real application code against it | The CLI — faster to iterate with than writing and re-running a script for each check. |

## Worked scenarios

Complete, end-to-end walkthroughs combining several commands to
accomplish a realistic task — more than any single command's example
shows in isolation.

### Scenario: onboarding a new user with their own vault

A common integration pattern: a new user signs up, and you want to
give them a personal vault with a predictable address (so your
backend can reference it before the deployment transaction even
lands), capped so they can't accidentally over-deposit while you're
still testing their onboarding flow.

```bash
export LUMENFORGE_RPC_URL="https://soroban-testnet.stellar.org"
export LUMENFORGE_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export LUMENFORGE_SECRET_KEY="$USER_ONBOARDING_SECRET"

FACTORY="CFACTORYEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
USER_ADDRESS="GNEWUSERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
TOKEN="CTOKENADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# nonce 0 — this user's first vault through this factory. The address
# is now deterministic: computing ownerNonceSalt(USER_ADDRESS, 0) and
# deriving the contract address from it would give the same answer
# before this command even runs, if your backend needs to know it
# ahead of the transaction landing.
VAULT_ADDRESS=$(lumenforge factory deploy-vault \
  --contract "$FACTORY" \
  --owner "$USER_ADDRESS" \
  --token "$TOKEN" \
  --min-deposit 0 \
  --max-balance 100000 \
  --nonce 0 \
  | jq -r '.')

echo "Deployed vault for new user at $VAULT_ADDRESS"

# Confirm it landed correctly before telling the user it's ready
lumenforge vault snapshot --contract "$VAULT_ADDRESS" --public-key "$USER_ADDRESS"
```

### Scenario: a nightly reconciliation report across every vault an owner has

```bash
#!/usr/bin/env bash
set -euo pipefail

FACTORY="CFACTORYEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
OWNER="GOWNERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
REPORT_DATE=$(date -u +%Y-%m-%d)

echo "LumenForge reconciliation report for $OWNER — $REPORT_DATE"
echo "======================================================="

VAULTS_JSON=$(lumenforge factory list-vaults \
  --contract "$FACTORY" --owner "$OWNER" --public-key "$OWNER" --with-snapshots)

TOTAL=$(echo "$VAULTS_JSON" | jq -r '[.[].balance | tonumber] | add // 0')
COUNT=$(echo "$VAULTS_JSON" | jq -r 'length')
PAUSED_COUNT=$(echo "$VAULTS_JSON" | jq -r '[.[] | select(.paused == true)] | length')

echo "Vaults: $COUNT (of which $PAUSED_COUNT paused)"
echo "Combined balance across all vaults: $TOTAL"
echo
echo "Per-vault detail:"
echo "$VAULTS_JSON" | jq -r '.[] | "  \(.address): balance=\(.balance) paused=\(.paused) token=\(.token)"'
```

Note the `[.[].balance | tonumber] | add` idiom for summing the
`balance` fields — `jq`'s `tonumber` converts each balance string to
a `jq` number for the sum. This is fine for balances that fit within
IEEE 754 double precision (roughly up to 2^53), but for genuinely huge
token amounts near the outer range of what a Soroban `i128` can hold,
`jq`'s numeric type isn't precise enough and you'd need a proper
bignum tool (e.g. piping through `bc`, or doing the sum in a language
runtime with real bigint support) instead of `jq` arithmetic.

### Scenario: watching for deposits in near-real-time

There's no `events watch`/`events tail` command — `events list` is a
one-shot read of everything from `--start-ledger` to the most recent
retained ledger. Polling it in a loop, advancing the starting ledger
each time, approximates a live feed:

```bash
#!/usr/bin/env bash
set -euo pipefail

VAULT="CVAULTEXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
LAST_LEDGER=${1:-0}   # pass a starting ledger, or 0 to (re-)read everything retained

while true; do
  EVENTS=$(lumenforge events list --contract "$VAULT" --start-ledger "$LAST_LEDGER" --kind vault)
  DEPOSITS=$(echo "$EVENTS" | jq -c '.[] | select(.type == "deposit")')
  if [ -n "$DEPOSITS" ]; then
    echo "$DEPOSITS" | while read -r deposit; do
      FROM=$(echo "$deposit" | jq -r '.from')
      AMOUNT=$(echo "$deposit" | jq -r '.amount')
      echo "$(date -u +%FT%TZ) deposit: $AMOUNT from $FROM"
    done
  fi
  # Advance past what we've already seen. In a real deployment you'd
  # track the actual latest ledger number seen, not just re-run from
  # the same starting point — this simplified loop will re-report
  # everything on every iteration; it's illustrative, not production-ready.
  sleep 10
done
```

This is explicitly a starting point, not a robust event-watching
implementation — it re-fetches and re-decodes the entire event range
on every iteration rather than tracking a cursor, has no
deduplication, and has no backoff on RPC errors. For anything beyond
a quick manual watch, use the library's `rpc.Server.getEvents`
directly with its cursor-based pagination (`GetEventsRequest`'s
`cursor` field, from a prior response's `cursor`) and proper state
persistence between polls — this is exactly the class of
"fine-grained control" the [CLI vs. the library](#cli-vs-the-library-when-to-use-which)
table above says to reach for the library for.

## Design decisions, explained in full

Several choices in this CLI's design are visible in its behavior but
not fully justified anywhere above this section. Documented here in
depth, since "why does it work this way" is a legitimate question
independent of "how do I use it."

### Why environment variables for *everything* network-related, not just the secret

It would be entirely possible to accept `--rpc-url` and
`--network-passphrase` as flags — they carry no secrecy requirement,
so the security argument that rules out a `--secret-key` flag doesn't
apply to them. They're environment variables anyway, for a different
reason: in virtually every realistic use of this CLI, the RPC
endpoint and network passphrase are fixed for an entire session of
work — you're either working against testnet, or a specific
production deployment, or a local network, for the duration of
however many commands you run. Repeating `--rpc-url
https://soroban-testnet.stellar.org --network-passphrase "Test SDF
Network ; September 2015"` on every single invocation is pure
repetition with no informational value, and a strong temptation to
alias/script around — at which point you've just reinvented an
environment variable anyway, less consistently. Requiring them as
environment variables makes the "set once per session" pattern the
only pattern, rather than leaving it as an optional convenience on top
of a flag-based default.

### Why JSON-only output, no `--format table`/`--format csv`

A CLI that prints human-readable tables by default and JSON only
behind a flag optimizes for interactive terminal use at the cost of
scriptability — every automation built on top of it then has to
remember the flag, and any future change to the "pretty" table format
(spacing, column order, a new field) is a silent breaking change for
anyone parsing it as text. Emitting only structured JSON, always,
makes scriptability the default rather than an opt-in, and pushes any
desired human formatting to the well-established, dedicated tool for
that job (`jq`, with its own extensive formatting/filtering
capabilities) rather than reinventing a worse version of it inside
this CLI. The tradeoff is that a raw, un-piped `lumenforge vault
snapshot ...` in an interactive terminal shows JSON rather than a
neatly aligned table — considered acceptable, since `jq .` (or even
just eyeballing indented JSON, which is already fairly readable) closes
most of that gap without this project needing to maintain a second
output format.

### Why exit code `1` for everything, rather than a richer scheme

A CLI could reserve `2` for "bad arguments," `3` for "network error,"
`4` for "contract rejected the call," and so on, letting scripts
branch on exit code alone. This CLI doesn't, for two reasons. First,
many of the failure categories genuinely can't be cleanly
distinguished at the point where the CLI would need to pick an exit
code — a network timeout partway through a multi-step operation
(like `keepOwnerVaultsAlive`'s per-vault loop) could be "network," or
could be indistinguishable from a contract-level rejection by the time
it surfaces as a thrown JavaScript error, depending on exactly where
in the underlying library call it occurred. Second, and more
fundamentally: the actually useful signal for automation isn't "which
numbered bucket did this fall into" but "what does the error message
actually say" — and since every failure already produces a specific
`lumenforge: <message>` string on stderr, that's the thing worth
parsing if you need to branch on failure type, not a lossy numeric
code that would need its own documentation to map back to meaning
anyway.

### Why `keepAlive`/`keepOwnerVaultsAlive` don't fail the whole process for one bad target

Discussed briefly in the relevant command sections; restated here with
the full reasoning. The alternative design — abort the whole command,
non-zero exit, on the first target that fails — has an obviously worse
failure mode for the actual use case these commands exist for: a
scheduled keeper job running against a fleet of vaults. If vault #3
out of 50 has some transient issue (a brief RPC hiccup, an
insufficient-fee edge case, whatever), aborting there means vaults #4
through #50 never even get attempted this run — they silently miss
their TTL extension for a reason entirely unrelated to their own
state. Reporting each target's outcome independently and letting the
overall process succeed means the other 49 vaults get extended
regardless of #3's fate, and a monitoring script watching the output
(as shown in [Scripting and JSON output](#scripting-and-json-output))
can still alert specifically on #3 without that alert coming at the
cost of the other 49 silently not being kept alive. This exact
tradeoff and its consequences are also documented at the library
level for `keepAlive`, in
[api-reference.md](api-reference.md#keepalivetargets-options) — the
CLI's behavior here is not a CLI-specific decision, just the library's
own design surfacing through the wrapper unchanged.

### Why the CLI doesn't parallelize `--with-snapshots` or `keep-owner-vaults-alive` across vaults

Both ultimately call library functions
(`collectVaultSnapshotsByOwner`, `keepOwnerVaultsAlive`) that are
themselves documented as sequential, not parallel, for the same
reason in both places: a predictable, bounded request rate against
whatever RPC endpoint you're using, rather than firing N simultaneous
requests that a rate-limited or resource-constrained endpoint might
reject some fraction of. The CLI doesn't add its own concurrency on
top of what the library already does — if you need faster fan-out and
know your endpoint can tolerate it, that has to be done at the library
level with your own `Promise.all`-based composition, which the CLI
doesn't currently offer as a flag (e.g. there is no
`--concurrency <n>` option).

## Version history and behavioral changes

This section tracks changes to the CLI's own behavior across
`@lumenforge/sdk` releases, distinct from the SDK's general
`CHANGELOG.md` (which covers the whole package, not just the CLI in
isolation). Consult this if something documented here doesn't match
what an older installed version actually does.

### 0.13.0 — initial release

The CLI first shipped in this version: `vault`
snapshot/deposit/withdraw/keep-alive, `factory`
snapshot/deploy-vault/list-vaults/keep-owner-vaults-alive, `events
list`. Environment-variable-only secret handling and the `allowHttp`
auto-detection were both present from this first release, not added
later — they were treated as non-negotiable from the start rather
than retrofitted.

### 0.13.1 — edge-case hardening

A follow-up release fixing several rough edges found by explicit
adversarial testing (feeding the CLI deliberately malformed input)
rather than by a user report:

- `--start-ledger`/`--threshold`/`--extend-to`/`--nonce` previously
  used `Number(value)` with no validation, so non-numeric input
  silently became `NaN` and reached downstream RPC/library calls
  unvalidated, producing confusing errors far from the actual mistake.
  Fixed to validate and fail with a clear message at the CLI layer
  itself.
- `--amount`/`--min-deposit`/`--max-balance` fed directly into
  `BigInt()`, so a bad value (`"10.5"`, `"abc"`) surfaced as a raw
  `SyntaxError` rather than a `lumenforge: ...`-prefixed message.
  Fixed with an explicit try/catch producing a clean error.
  ​
- The most serious fix in this release: Node's own `parseArgs` throws
  synchronously on certain malformed input (a negative number as a
  flag's value, an unrecognized flag) — and that call happened before
  any of the CLI's own error handling existed to catch it, so these
  cases crashed with a raw, uncaught Node.js exception and stack
  trace rather than any clean message. Fixed by wrapping the
  `parseArgs` call in its own try/catch.
- `allowHttp` auto-detection was added in this release (it's listed
  above as part of the "initial release," but is called out again
  here because the exact mechanism — scheme-based inference with no
  separate flag — was finalized in this pass alongside the other
  fixes, having initially been absent entirely and causing every
  attempt to point at a local standalone network to fail outright
  before this fix).

### 0.14.0 — testability refactor

No user-visible behavior change in this release — it exists purely to
make the CLI's internals unit-testable (a `CliError` class instead of
directly calling `process.exit`, argument parsing moved inside
`main()` instead of at module load time, and an explicit
`isDirectRun` guard so importing the CLI's module for tests doesn't
itself trigger argument parsing or command execution against the test
runner's own `process.argv`). Every behavior documented in the
0.13.1 section above was explicitly re-verified against the refactored
build and confirmed unchanged before this release shipped.

## Frequently asked questions

**Can I run multiple commands against different networks in the same
shell session?**

Only by re-exporting the environment variables between commands, since
they're read fresh from `process.env` on every invocation (the CLI is
a new process each time — there's no persistent daemon holding state
between commands). Switching from testnet to a local network mid-
session means re-running the `export LUMENFORGE_RPC_URL=...` line with
the new value before your next command. If you regularly switch
between networks, consider maintaining separate env files per network
(`testnet.env`, `local.env`) and sourcing the one you need:

```bash
set -a; source testnet.env; set +a
lumenforge vault snapshot --contract "$VAULT" --public-key "$PUBKEY"
```

**Does the CLI cache anything between runs (contract specs,
connection state)?**

No. Every invocation is a fresh process that connects from scratch —
`connectVault`/`connectFactory` re-fetch the contract's on-chain spec
every time, there's no local cache file, and no persistent connection
pool. This keeps the CLI simple and stateless at the cost of a small
amount of redundant network overhead if you're calling it repeatedly
in a tight loop; the library, used directly in a long-running process,
avoids that overhead by reusing a single connected client across many
calls.

**Can I use a `.env` file directly, without manually exporting
variables?**

The CLI itself does not read `.env` files — it only reads
`process.env`, however that got populated. If you want `.env`-file
support, use a tool that loads one into the environment before
invoking the CLI (`dotenv-cli`'s `dotenv -e .env -- lumenforge ...`,
or the `set -a; source .env; set +a` shell idiom shown above) rather
than expecting the CLI to parse a file itself.

**Is there a way to dry-run a state-changing command — see what it
would do without submitting?**

Not currently. Every state-changing command builds, signs, and
submits a real transaction; there's no `--dry-run`/`--simulate-only`
flag that stops before submission. If you want to inspect a
transaction before deciding whether to send it, that requires using
the library directly: build the `AssembledTransaction` (e.g. via
`vault.deposit(...)`, without yet calling `.signAndSend()`), inspect
it, and only call `.signAndSend()` once you're satisfied — see
[api-reference.md](api-reference.md) for the exact shape of what
`vault.deposit()` returns before it's sent.

**Why does `factory deploy-vault` need `--min-deposit` but not
`--max-balance`?**

Because the underlying `lumen_vault` constructor takes `min_deposit`
as a required `i128` (pass `0` for "no effective minimum," since any
non-negative amount then satisfies it) but `max_balance` as a genuine
`Option<i128>` — "no cap" is a real, distinct state from "cap of
zero," which passing `0` for `min_deposit` doesn't have an analogous
ambiguity for. This is a contract-level design choice, not a CLI one —
see [api-reference.md's Vault client section](api-reference.md#vault-client)
and `lumenforge-contracts`' own ADRs for the reasoning.

**Can two people run `keep-owner-vaults-alive` for the same owner at
the same time without conflict?**

Yes — `extend_ttl` is idempotent in effect (extending a TTL that's
already been extended past the requested point simply doesn't move it
further backward; Soroban's semantics only ever extend forward from
the current ledger, they never shorten a TTL), and it requires no
authorization, so there's no ownership conflict between two callers
targeting the same vaults. Running it redundantly from two different
scheduled jobs wastes a small amount of transaction fees on the
redundant call but causes no correctness issue.

**Does `vault snapshot`/`factory snapshot` cost anything (transaction
fees)?**

No — both are pure reads (simulation only, no submission), so no
transaction is ever built or signed for them, and no fee is paid.
Every other command that changes state does submit a real transaction
and does pay whatever fee applies on the network you're connected to.

**What Node.js versions does the CLI support?**

The same floor as the rest of the SDK: Node.js ≥ 22, matching
`@stellar/stellar-sdk`'s own engine requirement (see the SDK's
`.nvmrc` and `package.json` `engines` field). Running it on an older
Node version is not tested or supported and may fail in ways this
document doesn't account for.

**Is the CLI's exact output format (field names, ordering, JSON
structure) considered a stable public API, or could it change without
notice?**

Treat it as part of the package's public surface, versioned the same
way as the rest of `@lumenforge/sdk` — a field being renamed or
removed would be called out in `CHANGELOG.md` as a breaking change,
following normal semantic-versioning discipline for the package as a
whole. A purely cosmetic change (e.g. whitespace/indentation of the
pretty-printed JSON) is less likely to be called out explicitly, so
avoid depending on exact byte-for-byte output formatting — depend on
the JSON *structure* (parse it, don't string-match it) as shown
throughout this document's examples.

## Full flag index

Every flag this CLI defines, across every command, in one place —
useful as a quick lookup if you've forgotten which command a flag
belongs to.

| Flag | Type | Used by |
|---|---|---|
| `--contract` | string | every command |
| `--owner` | string | `factory deploy-vault`, `factory list-vaults`, `factory keep-owner-vaults-alive` |
| `--token` | string | `factory deploy-vault` |
| `--from` | string | `vault deposit` |
| `--amount` | string (parsed as bigint) | `vault deposit`, `vault withdraw` |
| `--min-deposit` | string (parsed as bigint) | `factory deploy-vault` |
| `--max-balance` | string (parsed as bigint, optional) | `factory deploy-vault` |
| `--nonce` | string (parsed as integer, optional) | `factory deploy-vault` |
| `--public-key` | string | `vault snapshot`, `factory snapshot`, `factory list-vaults` |
| `--threshold` | string (parsed as integer, optional) | `vault keep-alive`, `factory keep-owner-vaults-alive` |
| `--extend-to` | string (parsed as integer, optional) | `vault keep-alive`, `factory keep-owner-vaults-alive` |
| `--start-ledger` | string (parsed as non-negative integer) | `events list` |
| `--kind` | string (`"vault"` or `"factory"`) | `events list` |
| `--with-snapshots` | boolean (presence-only) | `factory list-vaults` |
| `--help` | boolean (presence-only) | global |
