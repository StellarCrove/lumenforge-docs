# Design Tradeoffs

Things that look like missing features but are deliberate choices,
collected in one place instead of scattered across ADRs and
`docs/security.md` in `lumenforge-contracts`. If you're wondering "why
doesn't it just—", check here first.

Each entry below follows the same structure: what the tradeoff is,
why it was made this way rather than the alternative, what you'd
actually have to build if the missing behavior turns out to be a
real requirement for your integration, and — where relevant — a
concrete scenario illustrating the consequence in practice rather
than leaving it abstract.

## Table of contents

- [No per-depositor accounting](#no-per-depositor-accounting)
- [`pause` doesn't block `withdraw`](#pause-doesnt-block-withdraw)
- [Salt management is on the caller](#salt-management-is-on-the-caller)
- [`rescue` can move any token except the vault's own](#rescue-can-move-any-token-except-the-vaults-own)
- [The factory's index is informational, not authoritative](#the-factorys-index-is-informational-not-authoritative)
- [TTL extension is a mechanism, not a policy](#ttl-extension-is-a-mechanism-not-a-policy)
- [Single token per vault, fixed at deployment](#single-token-per-vault-fixed-at-deployment)
- [Two-step ownership transfer, not one-step](#two-step-ownership-transfer-not-one-step)
- [Constructor-based initialization, not a callable `initialize()`](#constructor-based-initialization-not-a-callable-initialize)
- [No batch operations](#no-batch-operations)
- [No cross-vault atomicity](#no-cross-vault-atomicity)
- [`MAX_VAULTS_PER_OWNER` is a compile-time constant, not configurable per factory](#max_vaults_per_owner-is-a-compile-time-constant-not-configurable-per-factory)
- [No on-chain access control list beyond a single owner](#no-on-chain-access-control-list-beyond-a-single-owner)
- [How to tell "deliberate tradeoff" from "actual bug"](#how-to-tell-deliberate-tradeoff-from-actual-bug)

## No per-depositor accounting

**The tradeoff**: a vault's `Balance` is one pooled number. The
contract has no on-chain record of who deposited what — only the
owner can withdraw, and only in aggregate.

**Why**: this is [ADR-001](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/adr/001-single-balance-vault.md),
not an oversight. Per-depositor accounting is a fundamentally
different product — a shared pool with individually-tracked claims —
than what `LumenVault` is (one owner's custodied balance, where
"who deposited how much historically" is simply not information the
owner-withdrawal model needs to make decisions). Building that
tracking into `LumenVault` itself would mean every vault pays the
storage and computation cost of maintaining per-depositor records
even for the (likely common) case of a vault with exactly one
depositor who is also the owner — a personal savings/treasury vault,
which needs none of this.

**What you'd have to build if you need it**: either (a) an off-chain
ledger tracking claims against a vault's pooled balance, reconciled
against the vault's actual `Balance`/event history as the source of
truth for total funds available, or (b) a separate contract that
itself becomes the vault's owner and implements whatever claim
logic you need, calling `withdraw` only in ways consistent with the
claims it's tracking. Neither is provided by this project — both are
integration-specific enough that a one-size-fits-all implementation
inside `LumenVault` would inevitably be wrong for someone's actual
requirements.

**Concrete scenario**: three friends pool funds into one vault owned
by one of them, intending to split withdrawals proportionally later.
`LumenVault` has no way to know or enforce "friend A contributed 40%,
so 40% of any withdrawal is theirs" — that has to be tracked and
enforced entirely outside the contract, by whoever the owner is
(trusting them to actually honor the off-chain agreement, since the
contract itself provides no enforcement of it).

## `pause` doesn't block `withdraw`

**The tradeoff**: pausing stops new deposits, not withdrawals.

**Why**: the owner should always be able to retrieve funds, paused or
not — that's the whole point of who the "owner" is in this design.
There's no contract-level way to freeze withdrawals if it's the
*owner's* key that's compromised, because the owner is the trust
root; a mechanism that could override the owner's withdrawal would
just relocate the trust root to whoever controls *that* override
mechanism, not eliminate the single-point-of-trust problem.

**What you'd have to build if you need it**: recoverability from a
compromised owner key has to be solved *above* the contract, by
choosing a smarter thing to be the owner — a multisig account (so a
single compromised key isn't enough to withdraw) or a timelock
contract as the owner (so a withdrawal announced by a compromised key
has a window in which it can be challenged/cancelled by some other
mechanism you control). `LumenVault` itself intentionally has no
concept of any of this; it just enforces "the owner, whoever/whatever
that is, can withdraw" — the sophistication of who's *behind* that
owner address is entirely up to you.

**Concrete scenario**: an owner's key is phished. `pause()` called
by that same compromised key accomplishes nothing protective — the
attacker who has the key to call `pause` also has the key to call
`withdraw`, so pausing new deposits doesn't stop the actual fund-loss
vector at all. The only real mitigation is not having a single
plain key be the owner in the first place.

## Salt management is on the caller

**The tradeoff**: `LumenVaultFactory::deploy_vault` doesn't generate
or track salts for you.

**Why**: Soroban derives a deployed contract's address deterministically
from `(deployer, salt, wasm_hash)` — this is a platform-level fact
about how contract addressing works, not a choice `lumen_vault_factory`
made. There is no way for the factory to "not require a salt" without
either always deriving one the same deterministic way (which would
make the factory itself decide address predictability policy for
every caller, removing a capability some integrators want) or
managing salt state per-caller inside contract storage (adding
exactly the kind of persistent, unboundedly-growing state the factory
already works hard to bound elsewhere — see
[`MAX_VAULTS_PER_OWNER`](#max_vaults_per_owner-is-a-compile-time-constant-not-configurable-per-factory)
below for the general shape of that concern). See
[ADR-004](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/adr/004-permissionless-factory.md)
for the full reasoning.

**What's already built for you**: unlike most entries on this page,
this one *is* substantially closed at the integration layer — the SDK's
`randomSalt()`, `ownerNonceSalt()`, and `deployVaultViaFactory()`
mean most integrators genuinely never touch a raw salt buffer
themselves. This is documented at length in
[api-reference.md](api-reference.md#deployvaultviafactoryfactory-args-options)
and [integration-guide.md](integration-guide.md#2-get-a-vault). The
tradeoff described here is about the *contract's* design, not a gap
left unaddressed for integrators — it's listed here because the
underlying architectural fact (Soroban's addressing scheme) is worth
understanding even though its practical sting has been removed.

## `rescue` can move any token except the vault's own

**The tradeoff**: `rescue` is barred from moving the vault's
configured `token` (that balance is depositor funds), but it *can*
move any other token the vault happens to hold.

**Why**: `rescue` exists to recover a wrong-asset transfer sent to
the vault's address by mistake (e.g. someone fat-fingers a transfer
of some unrelated token directly to the vault's contract address,
bypassing `deposit` entirely — this happens more often in practice
across the broader Stellar/Soroban ecosystem than one might hope).
The contract has no way to distinguish "a stray token sent by
mistake, which the owner should be able to recover" from "a token
some other integration deliberately parked in this vault's address
for its own purposes, which the owner should *not* be able to touch"
— both look identical from the contract's perspective (a token
balance at this address that isn't the vault's own configured
`token`). Barring `rescue` from touching *only* the vault's own
`token` is the narrowest restriction that still closes the actual
funds-at-risk case (depositor funds, which are always denominated in
the vault's own `token`) without also disabling the legitimate
wrong-asset-recovery use case `rescue` exists for.

**What you'd have to build if you need it**: if you're building on
top of a vault in a way where some *other* token's balance at that
address matters to your own logic (e.g. a receipt token, an LP
token, anything not deliberately deposited via `deposit`), you need
to either avoid using a vault's own address as a place to park that
value, or explicitly account for the fact that the vault's owner has
unilateral reach over it via `rescue` — there's no contract-level
carve-out you can request for a specific non-`token` asset.

**Concrete scenario**: a third-party integration mints a
receipt/LP token and, as an implementation detail, holds a balance
of some other token at the vault's own contract address (rather than
at a separate contract it controls). The vault's owner can call
`rescue` on that balance at any time — nothing in `lumen_vault`
prevents it, since from the vault's perspective that balance is
indistinguishable from an ordinary wrong-asset mistake. This is a
design constraint any such integration needs to account for
explicitly, not something `lumen_vault` will ever special-case.

## The factory's index is informational, not authoritative

**The tradeoff**: `vaults_by_owner` is a convenience index, not a
source of truth for who currently controls a vault.

**Why**: the factory populates this index purely as a side effect of
`deploy_vault` — it has no mechanism (and no reason to have one) for
being told about ownership changes that happen entirely within a
*different* contract (`lumen_vault`'s own `propose_owner`/
`accept_owner`). Building that kind of cross-contract notification
would mean every ownership transfer on every vault pays an extra
cross-contract call back to whichever factory deployed it — a real
cost, for a benefit (keeping an index "correct" that was only ever
meant to answer "what did this factory deploy," not "who currently
owns what") that doesn't justify it. See
[data-model.md](data-model.md#the-factorys-index-is-a-cache-not-a-source-of-truth)
for the exact mechanics of why this happens.

**What you'd have to build if you need it**: nothing extra, really —
just discipline about which question you're asking. If the question
is "what has this factory deployed," `vaults_by_owner` answers it
correctly, always. If the question is "who currently controls this
specific vault," always call that vault's own `owner()` — never infer
current ownership from which factory-index bucket an address happens
to sit in.

**Concrete scenario**: Alice deploys a vault through a factory (now
indexed under Alice), then transfers ownership to Bob via
`propose_owner`/`accept_owner`. The factory's `vaults_by_owner(Alice)`
still lists that vault — forever, unless Alice deploys enough other
vaults to push it off whatever page you're reading, which doesn't
remove it, just relocates it within the list. Any code that treats
"appears in Alice's factory-index entry" as "Alice controls this"
is simply wrong, and would keep being wrong indefinitely after this
transfer, with no factory-level signal that anything changed.

## TTL extension is a mechanism, not a policy

**The tradeoff**: both contracts expose `extend_ttl` (and the factory
additionally `extend_vaults_by_owner_ttl`), callable by anyone, but
nothing calls these on a schedule automatically.

**Why**: Soroban contracts cannot wake themselves up — there is no
"cron trigger" primitive in the platform for a contract to schedule
its own future execution. Any "keep this alive automatically"
behavior necessarily has to be driven from *outside* the contract, by
something that itself runs on a schedule (a traditional off-chain
process). No contract-level design choice here could change this; it
is a hard platform constraint, not a preference `lumen_vault`/
`lumen_vault_factory` express.

**What's already built for you**: as with salt management, this is a
gap substantially closed at the SDK layer rather than left entirely
to integrators — `keepAlive`, `keepOwnerVaultsAlive`,
`extendTtl`, and `extendVaultsByOwnerTtl` are exactly the off-chain
"policy" half of this mechanism, meant to be run from any scheduler
you control (see [cli-reference.md's Automation recipes](cli-reference.md#automation-recipes)
for concrete setups across cron, systemd, GitHub Actions, Docker, and
launchd). What remains genuinely on you: actually running one of
those on an appropriate schedule, for every vault/factory you care
about — nothing forces this to happen, and letting a TTL genuinely
reach zero archives that storage, which is a real, if recoverable
(archived storage can, per the underlying Soroban state-archival
model, be restored — but that's a separate, more involved
operation than "just extend it before it expires").

## Single token per vault, fixed at deployment

**The tradeoff**: a `lumen_vault` instance custodies exactly one
SEP-41 token, set once at construction and never changeable
afterward — there's no method to swap which token a vault holds.

**Why**: see [ADR-005](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/adr/005-single-token-per-vault.md).
Allowing a vault to change which token it custodies mid-lifetime
would create an obvious hazard: any depositor who deposited under
token A would suddenly find their balance denominated in token B
after a switch, with no contract-level mechanism to make that
sensible (should their `Balance` number stay the same, get converted
at some rate, be locked out entirely?). Every option is either unsafe
or requires machinery — an exchange-rate oracle, a migration
process — well beyond what a "deposit/withdraw a single asset" vault
should need to reason about. Fixing the token at construction and
never allowing it to change sidesteps the entire problem by making
it structurally impossible for it to arise.

**What you'd have to build if you need it**: if you genuinely need
"the same conceptual vault, but now for a different token," deploy a
*new* `lumen_vault` for the new token — there is no migration path
that reuses the old vault's address, balance, or history. Any
"migration" is your own application-level bookkeeping connecting the
old vault's final state to the new vault's initial state, not
anything either contract provides.

## Two-step ownership transfer, not one-step

**The tradeoff**: transferring ownership takes two calls
(`propose_owner` by the current owner, `accept_owner` by the
proposed successor) rather than one (`transfer_owner(new_owner)`
that immediately takes effect).

**Why**: see [ADR-003](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/adr/003-two-step-ownership-transfer.md).
A one-step transfer that takes effect immediately on the current
owner's say-so has a well-known failure mode across smart contract
design generally: a mistyped or unreachable address as the argument
permanently locks the contract, since nothing can undo a completed
transfer to an address nobody controls. Requiring the *proposed*
successor to separately call `accept_owner` (proving, via
`require_auth()`, that they actually control that address) means a
typo in `propose_owner`'s argument is simply never accepted — nothing
happens until the correct party proves control, and
`cancel_pending_owner` lets the current owner withdraw a mistaken
proposal before that even happens.

**The cost of this safety**: an extra transaction, and (until
`accept_owner` is actually called) a window in which the *old* owner
is still fully in control, not the intended new one — a proposal
alone changes nothing about who can `withdraw`, `pause`, etc. If your
integration needs the transfer to be effective the instant
`propose_owner` is called, this contract's design doesn't support
that; the two-step process is not optional or configurable per call.

## Constructor-based initialization, not a callable `initialize()`

**The tradeoff**: both contracts set up their initial state
(`lumen_vault`'s owner/token/deposit-bounds, `lumen_vault_factory`'s
Wasm hash) via a Rust constructor that runs atomically at deployment,
rather than a separately-callable `initialize()` function invoked
after deployment.

**Why**: see [ADR-002](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/adr/002-constructor-based-initialization.md).
A separately-callable `initialize()` creates a window between
"contract deployed" and "contract initialized" during which an
unrelated third party could call `initialize()` first and claim
ownership — this is a well-documented front-running risk for exactly
this pattern across the smart-contract ecosystem generally, not
specific to Soroban. Soroban's constructor mechanism closes this
window structurally: the constructor runs as part of the same
operation that deploys the contract, so there's no separate,
interceptable "initialize" step for anyone else to race.

**Consequence**: since initialization now happens exactly once,
atomically, with deployment, there is no way to deploy a vault or
factory "uninitialized" and configure it later in a separate step —
every constructor argument must be known and correct at the moment of
deployment, which is why `deployVault`/`deployVaultViaFactory` both
take the full set of constructor arguments up front rather than
offering a two-phase "deploy, then configure" API.

## No batch operations

**The tradeoff**: there's no way to deposit into (or withdraw from,
or deploy) multiple vaults in a single transaction at the contract
level — every operation is one vault, one call.

**Why**: neither contract implements any batching primitive. This is
partly a consequence of keeping each contract's surface minimal and
auditable (batching logic is additional code with additional edge
cases — partial failure semantics, gas/resource accounting across the
batch — that neither contract's actual use cases have required), and
partly because Soroban transactions can already invoke multiple
operations (including multiple contract calls) within a single
transaction at the *transaction* level, via the standard Stellar
transaction envelope — so "batching" in the sense of "get several
calls included atomically" is already available without needing
either contract to implement it itself.

**What you'd have to build if you need it**: for "several independent
calls that should either all succeed or all fail together," construct
a single Stellar transaction with multiple operations, using
`@stellar/stellar-sdk`'s own transaction-building primitives rather
than this SDK's per-call `AssembledTransaction` pattern, which is
built around one call per transaction. This SDK does not currently
expose a helper for constructing such a multi-operation transaction
directly — `keepAlive`/`keepOwnerVaultsAlive`/`collectVaultSnapshotsByOwner`
all issue their *many* calls as *many separate* transactions/RPC
round trips (sequentially, as documented in
[api-reference.md](api-reference.md)), not as one batched transaction,
specifically because each target's `extend_ttl`/read is independent
and doesn't need all-or-nothing atomicity across the batch — which is
also why one target failing doesn't abort the others, a property that
would be lost if they were combined into a single atomic transaction.

## No cross-vault atomicity

**The tradeoff**: there's no contract-level way to make "withdraw
from vault A and deposit into vault B" atomic — if you need that,
you're relying on transaction-level atomicity (both calls in the same
Stellar transaction) rather than any guarantee either contract itself
provides about coordinating with another vault.

**Why**: `lumen_vault` has no concept of any other vault's existence
at all — each instance is entirely self-contained, with no
cross-contract calls to any other `lumen_vault` instance anywhere in
its code. This is consistent with the "single-balance, single-owner,
single-token" scope described in
[No per-depositor accounting](#no-per-depositor-accounting) above:
`lumen_vault` deliberately doesn't know about a wider system of
vaults it might be part of, leaving any cross-vault coordination
entirely to whatever's calling it.

**What you'd have to build if you need it**: as with
[No batch operations](#no-batch-operations), construct a single
Stellar transaction containing both the withdrawal operation and the
deposit operation — Stellar's transaction-level atomicity (the whole
transaction either fully applies or fully doesn't) gives you the
"both or neither" guarantee, without either vault needing to know
about the other.

## `MAX_VAULTS_PER_OWNER` is a compile-time constant, not configurable per factory

**The tradeoff**: every deployed `lumen_vault_factory` instance
enforces the same 100-vaults-per-owner cap — there's no constructor
argument or setter to configure a different cap for a specific
factory deployment.

**Why**: see [data-model.md](data-model.md#why-vaultsbyowner-is-capped-at-100)
for the mechanics of what this cap protects against (unbounded
per-owner storage growth). Making it configurable per instance would
mean the contract's own guarantee about that growth being bounded now
depends on whatever value the deployer happened to choose at deploy
time — a factory deployed with, say, `u32::MAX` as its configured cap
would have no meaningful protection at all, defeating the entire
point of having a cap. Baking in one fixed, reasonable value keeps
the protection unconditional rather than something a careless (or
adversarial) deployer could configure away.

**What you'd have to build if you need it**: if 100 vaults per owner
through one factory genuinely isn't enough for your use case, deploy
a *second* `lumen_vault_factory` instance (with the same
`lumen_vault` Wasm hash) — an owner's vaults through factory A and
factory B are entirely independent as far as either factory's own
`VaultsByOwner` cap is concerned, since each factory only tracks what
it itself deployed. There's no way to raise the cap on a single
existing factory instance; deploying a second one is the only lever
available.

## No on-chain access control list beyond a single owner

**The tradeoff**: every owner-gated method on `lumen_vault`
(`withdraw`, `pause`, `set_min_deposit`, etc.) checks against exactly
one stored `Address` — there's no concept of multiple authorized
addresses, roles, or permission levels within the contract itself.

**Why**: adding multi-address access control inside `lumen_vault`
would mean the contract taking on a job — access control policy — that
Stellar/Soroban already has a first-class primitive for at the
*account* level: a multisig account (multiple signers, configurable
weights/thresholds) can be set as the vault's single `owner`, and
Soroban's `require_auth()` check against that account already
enforces whatever multisig policy the account itself is configured
with, with zero additional code inside `lumen_vault`. Reimplementing
any part of that inside the contract would duplicate a
well-audited platform primitive with a bespoke, contract-specific
version — strictly more code, more audit surface, for a capability
the platform already provides for free to any contract willing to
accept an account (rather than requiring a plain keypair) as its
`owner`.

**What you'd have to build if you need it**: nothing inside
`lumen_vault` — set a Stellar multisig account (or another smart
contract implementing whatever access policy you need, since
`owner` is just an `Address` and Soroban addresses can be contracts
too) as the vault's `owner` at deployment, and let that account's own
configured signing policy govern who can actually authorize an
owner-gated call. This is exactly the same pattern referenced in
[`pause` doesn't block `withdraw`](#pause-doesnt-block-withdraw)
above for compromised-key recovery — the contract stays deliberately
ignorant of what's "behind" its owner address, and that's the
intended extension point for exactly this kind of requirement.

## How to tell "deliberate tradeoff" from "actual bug"

Every entry on this page has a specific, articulable *reason* tied to
either a Soroban platform constraint, an explicit ADR, or a
documented threat-model tradeoff in `lumenforge-contracts`' own
`docs/security.md`. If you encounter behavior that *looks* like it
belongs on this list but you can't find (or construct) a specific
reason for it here, in an ADR, or in `docs/security.md`'s Known
Limitations section, treat that as a signal worth investigating
further rather than assuming it must be intentional by default —
check `lumenforge-contracts`' issue tracker, or open a new issue
describing the specific behavior and asking directly, rather than
either (a) building a workaround around what might actually be an
unintentional gap, or (b) assuming every surprising behavior in this
codebase is necessarily deliberate just because *many* of them are.
This page documents the ones that are; it is not, and does not claim
to be, a complete list.
