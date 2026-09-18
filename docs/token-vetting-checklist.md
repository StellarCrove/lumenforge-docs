# Token Vetting Checklist

`LumenVault` assumes `token` behaves like a conforming
[SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
implementation: `transfer(from, to, amount)` moves exactly `amount`, and
either succeeds or aborts the whole transaction — nothing else. Neither
the vault nor the factory checks this at deployment; vetting `token`
before deploying a vault for it is the integrator's job. This is the
checklist to run through first — it's the unchecked item in
`lumenforge-contracts`' pre-mainnet audit checklist
("Document a token vetting checklist... before recommending a `token`
address to integrators").

## Table of contents

- [Why this is on the integrator, not the contract](#why-this-is-on-the-integrator-not-the-contract)
- [Fee-on-transfer tokens](#fee-on-transfer-tokens)
- [Rebasing tokens](#rebasing-tokens)
- [Pausable-by-issuer tokens](#pausable-by-issuer-tokens)
- [Authorization-required tokens](#authorization-required-tokens)
- [Clawback-enabled tokens](#clawback-enabled-tokens)
- [Tokens with non-standard decimals](#tokens-with-non-standard-decimals)
- [Wrapped/bridged tokens](#wrappedbridged-tokens)
- [Tokens with a blacklist/denylist](#tokens-with-a-blacklistdenylist)
- [A single runnable verification script covering every check](#a-single-runnable-verification-script-covering-every-check)
- [A decision framework: red flags vs. yellow flags vs. acceptable](#a-decision-framework-red-flags-vs-yellow-flags-vs-acceptable)
- [If in doubt](#if-in-doubt)

## Why this is on the integrator, not the contract

It would be technically possible for `lumen_vault` to run some of
these checks itself at deployment time — attempt a test transfer,
inspect the token contract's own metadata, and refuse to construct if
something looks wrong. This project deliberately doesn't do that, for
reasons worth spelling out rather than leaving implicit: any such
check the contract could run is inherently incomplete (a token can
behave conformingly during a check and non-conformingly later, or
under conditions the check didn't happen to trigger — a rebasing
token's rebase might not fire during a single deployment-time probe),
and building an increasingly elaborate on-chain heuristic to catch
more cases adds real complexity and audit surface to a contract whose
actual job (holding and moving a balance) doesn't need any of it.
Keeping the vault itself simple and pushing this judgment call to
whoever is choosing which token to point a vault at — a decision
that requires understanding a specific token's actual behavior, not
something a generic on-chain heuristic can substitute for — is
consistent with this project's broader design philosophy documented
throughout [design-tradeoffs.md](design-tradeoffs.md).

## Fee-on-transfer tokens

**The risk**: if `token` deducts a fee so the vault receives less than
the `amount` passed to `transfer`, the vault's internal `Balance` —
which is incremented by the full `amount` on `deposit` — will
over-state what the vault actually holds. Eventually a legitimate
`withdraw` could fail because the real token balance ran out before
`Balance` said it would.

**Worked example of the failure**: suppose `token` deducts a flat 1%
fee on every transfer. A depositor calls `deposit({ from, amount: 1000n })`.
`lumen_vault`'s `Balance` becomes `1000`. But the actual SEP-41
`transfer` call only delivered `990` tokens to the vault's address (1%
— 10 tokens — went wherever the fee logic sends it). The vault now
*believes* it holds 1000, but *actually* holds 990. If the owner later
calls `withdraw({ amount: 1000n })`, the contract's own bookkeeping
says that's fine (`amount <= Balance`), and it will attempt to
transfer 1000 tokens out — but the vault's real balance is only 990,
so the underlying token-level transfer fails. Worse: if multiple
depositors have added funds, an earlier withdrawal by one party can
succeed while draining real balance faster than `Balance` accounts
for, leaving a *later* depositor's nominally-available balance
actually unbacked by real tokens — a shortfall that surfaces
unpredictably, not necessarily on the transaction that caused it.

**Check**: deposit a small test amount and compare the vault's real
token balance (query the token contract directly) against what
`vault.balance()` reports. They should match exactly.

```ts
async function checkFeeOnTransfer(
  vault: VaultClient,
  tokenClient: { balance(args: { id: string }): Promise<{ result: bigint }> },
  vaultAddress: string,
  depositorAddress: string,
  testAmount: bigint,
) {
  const before = (await tokenClient.balance({ id: vaultAddress })).result;
  await (await vault.deposit({ from: depositorAddress, amount: testAmount })).signAndSend();
  const after = (await tokenClient.balance({ id: vaultAddress })).result;
  const actualReceived = after - before;
  const vaultBalance = (await vault.balance()).result;

  if (actualReceived !== testAmount) {
    console.error(
      `FEE-ON-TRANSFER DETECTED: sent ${testAmount}, vault's real token balance only increased by ${actualReceived}`,
    );
    return false;
  }
  if (vaultBalance !== after) {
    console.error(
      `Vault's internal Balance (${vaultBalance}) doesn't match its real token holdings (${after}) — do not use this token.`,
    );
    return false;
  }
  return true;
}
```

## Rebasing tokens

**The risk**: if `token`'s own accounting changes holders' balances
outside of `transfer` calls (e.g. an elastic-supply token that
periodically rebases every holder's balance up or down), the vault's
`Balance` — which only moves on `deposit`/`withdraw` — will drift
from the vault's actual token balance over time, in either direction.

**Worked example of the failure**: `lumen_vault`'s `Balance` reads
`1000` after a deposit. The token then rebases +5% across all
holders (a positive rebase, common for some yield-bearing token
designs) — the vault's *actual* SEP-41 balance is now `1050`, but
`Balance` still says `1000`. This particular direction (real balance
ahead of recorded balance) isn't a fund-loss risk by itself — the
extra 50 is simply "invisible" to the contract, permanently stuck
unless a future `rescue` or accounting reconciliation on your part
recovers it (and `rescue` explicitly cannot touch the vault's own
`token`, so even that door is closed — see
[design-tradeoffs.md](design-tradeoffs.md#rescue-can-move-any-token-except-the-vaults-own)).
The dangerous direction is a *negative* rebase: if the token loses
5% instead, `Balance` still says `1000` but only `950` real tokens
back it — the exact same under-collateralization failure mode as a
fee-on-transfer token, just triggered by a mechanism entirely outside
any `deposit`/`withdraw` call rather than by the transfer itself.

**Check**: does the token's contract mutate balances via any
mechanism other than an explicit `transfer`? If yes, don't use it with
`LumenVault` as-is — `Balance` will not track reality. Unlike
fee-on-transfer (which a single test deposit reveals immediately),
detecting a rebase mechanism generally requires either reading the
token contract's own source/documentation directly (there's no
universal on-chain probe that reliably detects "this contract might
rebase balances at some future time for reasons unrelated to any
transfer you initiate") or observing the vault's balance drift over
a real time window:

```ts
async function checkForBalanceDrift(
  vault: VaultClient,
  tokenClient: { balance(args: { id: string }): Promise<{ result: bigint }> },
  vaultAddress: string,
  waitMs: number,
) {
  const before = (await tokenClient.balance({ id: vaultAddress })).result;
  await new Promise((r) => setTimeout(r, waitMs));
  const after = (await tokenClient.balance({ id: vaultAddress })).result;

  if (before !== after) {
    console.error(
      `Vault's real token balance changed from ${before} to ${after} with no deposit/withdraw call in between — this token likely rebases. Do not use it with LumenVault.`,
    );
    return false;
  }
  return true;
}
```

This test is inherently probabilistic — it only catches a rebase that
happens to occur during `waitMs`. A token that rebases infrequently
(e.g. once a day) needs a correspondingly long observation window to
catch reliably; absence of drift during a short test window is
evidence, not proof, of non-rebasing behavior. Reading the token's
actual contract code/documentation remains the more reliable check
when available.

## Pausable-by-issuer tokens

**The risk**: if the token issuer can freeze transfers, `withdraw`
can fail for reasons entirely outside the vault's or the owner's
control — the vault's own `pause` state is irrelevant if the token
itself is frozen. This isn't a vault bug, but it changes the actual
risk profile you're presenting to depositors, who might reasonably
assume "the vault isn't paused" means "I can withdraw," when a
completely separate, token-level freeze can block them regardless.

**Worked example of the failure**: a depositor confirms
`vault.paused()` returns `false` and attempts a `withdraw`. The
underlying token's issuer has independently frozen the asset globally
(a capability many token/asset designs on Stellar and elsewhere
support for regulatory or operational reasons). The `withdraw` call
fails — not with any of `lumen_vault`'s own `Error` variants
(`InsufficientBalance`, etc.), but with a token-contract-level
rejection the vault has no way to anticipate, explain, or work around.

**Check**: does the token have an issuer-controlled freeze/pause? If
so, document that dependency for anyone depositing into this vault —
the vault's `pause`/`unpause` is not the only thing standing between a
depositor and their funds. There's no universal on-chain probe for
this either (a freeze capability, if present, might not be exercised
during your test, so absence of an observed freeze proves nothing) —
this is fundamentally a question you answer by reading the token
issuer's own published terms/documentation, not one you can safely
infer from a successful test transaction alone.

## Authorization-required tokens

**The risk**: some Stellar assets require the issuer to explicitly
authorize each holder's trustline (`AUTH_REQUIRED`, a classic-Stellar-
asset flag with a Soroban-asset-wrapper analogue). If `token` is one
of these, the vault's own contract address needs to be authorized to
hold and transfer it, or every `deposit`/`withdraw` will fail at the
token layer regardless of anything the vault does.

**Worked example of the failure**: you deploy a vault for such a
token without first arranging for the vault's own contract address to
be authorized by the issuer. The very first `deposit` call fails — not
because of anything wrong with `lumen_vault`, but because the token
contract itself refuses to move funds into (or out of) an
unauthorized address. This is often discovered embarrassingly late —
after announcing the vault as ready — if the authorization step isn't
explicitly checked beforehand as its own item, separate from "does the
token/vault deploy successfully" (deployment succeeds regardless;
only the first real transfer reveals the problem).

**Check**: does the token require per-holder authorization? If so,
confirm the vault's contract address has been authorized *before*
advertising the vault as ready to accept deposits — and re-confirm
after any event that could plausibly revoke authorization (some
issuers reserve the right to revoke it later, not just grant it once).

## Clawback-enabled tokens

**The risk**: some Stellar assets support issuer-initiated clawback —
the issuer can reclaim tokens from any holder's balance, including a
vault contract's, without that holder's cooperation or consent. If
`token` has clawback enabled, the issuer can reduce the vault's real
token holdings at will, again completely independent of anything
`lumen_vault`'s own `pause`/owner mechanisms could prevent.

**Worked example of the failure**: `Balance` says `1000`; the issuer
claws back `400` of the vault's real holdings for whatever reason its
own policy permits. The vault's real balance is now `600`, but
`Balance` still says `1000` — the exact same under-collateralization
shape as fee-on-transfer and negative-rebase tokens above, just
triggered by a third party's unilateral action rather than by any
transfer or rebase mechanism the vault participated in.

**Check**: does the token have clawback enabled? This is a property
of the underlying asset's configuration (visible via the classic
Stellar asset's flags, or the issuing contract's own documentation
for a Soroban-native asset) — check it directly rather than assuming
its absence from a successful test transaction, since clawback being
*possible* and clawback actually being *exercised* during your brief
test window are entirely different things; a token can pass every
other check in this document and still carry this risk silently until
the issuer chooses to use it.

## Tokens with non-standard decimals

**The risk**: this isn't a fund-loss risk the same way the others
above are, but a UX/integration correctness one:
`lumen_vault`'s `Balance` (and every amount this SDK handles) is a
raw `i128`/`bigint` — the *smallest unit* of whatever token you point
it at, with no built-in awareness of how many decimal places that
token's human-readable display representation implies. Assuming
every token uses the same decimal convention (e.g. always treating
`amount` as if it were denominated in a 7-decimal unit, a common
Stellar convention, when the actual token uses a different decimal
count) produces a UI or accounting layer that's off by orders of
magnitude from what a user actually intended.

**Check**: confirm the token's actual decimal convention (via its own
metadata/documentation — SEP-41 tokens commonly expose a `decimals()`
read method, though this SDK doesn't wrap it itself since it's a
token-contract concern, not a `lumen_vault` one) before building any
UI or off-chain accounting layer on top of amounts read from this
SDK. `getVaultSnapshot`'s `balance`/`minDeposit`/`maxBalance` are
always raw smallest-unit integers; converting them to a human-
readable display value is entirely your own application's
responsibility, informed by the specific token's actual decimals.

## Wrapped/bridged tokens

**The risk**: a token representing a bridged/wrapped asset from
another chain carries custody risk at the bridge layer, entirely
separate from anything `lumen_vault` or the wrapped token's own
Soroban-side contract does correctly. If the bridge holding the
underlying collateral is compromised, under-collateralized, or
otherwise fails, the wrapped token on Stellar/Soroban can lose its
backing while continuing to behave perfectly conformingly from
`lumen_vault`'s perspective — every `transfer` still moves exactly
`amount`, so none of the checks above would catch this at all.

**Check**: this is fundamentally a due-diligence question about the
bridge's own security model and track record, not something any
on-chain probe against the wrapped token's Soroban contract can
reveal — a wrapped token can pass every SEP-41-conformance check in
this document while still being backed by nothing, if the bridge
itself has been drained. Treat "is this specific bridge
trustworthy" as its own separate research question, independent of
and prior to the mechanical checks this document otherwise focuses on.

## Tokens with a blacklist/denylist

**The risk**: some token designs let the issuer block specific
addresses from transacting, distinct from a global pause. If the
vault's own contract address (or a specific depositor's address) ever
ends up on such a list — whether through the issuer's own judgment,
an automated compliance system, or simple error — transfers involving
that address fail, again independent of anything `lumen_vault` itself
tracks or exposes.

**Check**: does the token support address-level blocking? If so, and
if that's a realistic operational risk for your use case (e.g. a
token whose issuer actively enforces sanctions/compliance denylists),
document this dependency the same way as the pausable-by-issuer case
above — depositors should understand that "the vault permits this"
is not the same guarantee as "the token layer will actually allow
this."

## A single runnable verification script covering every check

Combining the mechanically-checkable items above (fee-on-transfer,
balance drift, and a basic real-vs-recorded balance comparison) into
one script to run against a candidate token before recommending it to
anyone. The items that aren't mechanically checkable this way
(pausable-by-issuer, clawback, wrapped-token custody risk,
blacklist/denylist support) are called out explicitly as requiring
separate documentation research, not because this script forgot
them, but because no on-chain probe can substitute for reading the
actual token's own documentation for those specific properties.

```ts
import { connectVault, deployVaultViaFactory, connectFactory, getVaultSnapshot } from "@lumenforge/sdk";
import { Keypair } from "@stellar/stellar-sdk";
import { KeypairSigner } from "@stellar/stellar-sdk/contract";

interface TokenClient {
  balance(args: { id: string }): Promise<{ result: bigint }>;
}

interface VettingReport {
  feeOnTransferDetected: boolean;
  balanceDriftDetected: boolean;
  recordedBalanceMatchesReal: boolean;
  passed: boolean;
  manualChecksStillRequired: string[];
}

async function vetToken(
  factoryContract: string,
  tokenContract: string,
  tokenClient: TokenClient,
  rpcUrl: string,
  networkPassphrase: string,
  testerSecret: string,
): Promise<VettingReport> {
  const keypair = Keypair.fromSecret(testerSecret);
  const signer = new KeypairSigner(keypair, networkPassphrase);

  const factory = await connectFactory({
    contractId: factoryContract, rpcUrl, networkPassphrase,
    publicKey: signer.address, signTransaction: signer,
  });

  console.log("Deploying a throwaway vault for vetting...");
  const deployTx = await deployVaultViaFactory(
    factory,
    { owner: signer.address, token: tokenContract, min_deposit: 0n },
  );
  const { result: vaultAddress } = await deployTx.signAndSend();
  const vault = await connectVault({
    contractId: vaultAddress, rpcUrl, networkPassphrase,
    publicKey: signer.address, signTransaction: signer,
  });

  const testAmount = 1000n;

  const beforeReal = (await tokenClient.balance({ id: vaultAddress })).result;
  await (await vault.deposit({ from: signer.address, amount: testAmount })).signAndSend();
  const afterReal = (await tokenClient.balance({ id: vaultAddress })).result;
  const actualReceived = afterReal - beforeReal;

  const feeOnTransferDetected = actualReceived !== testAmount;

  const snapshot = await getVaultSnapshot(vault);
  const recordedBalanceMatchesReal = snapshot.balance === afterReal;

  console.log("Waiting 30 seconds to check for balance drift (increase this for a more thorough check)...");
  await new Promise((r) => setTimeout(r, 30_000));
  const afterWait = (await tokenClient.balance({ id: vaultAddress })).result;
  const balanceDriftDetected = afterWait !== afterReal;

  const passed = !feeOnTransferDetected && !balanceDriftDetected && recordedBalanceMatchesReal;

  return {
    feeOnTransferDetected,
    balanceDriftDetected,
    recordedBalanceMatchesReal,
    passed,
    manualChecksStillRequired: [
      "Pausable-by-issuer: read the token issuer's own documentation.",
      "Clawback: check the asset's clawback flag / issuing contract's documentation.",
      "Authorization-required: confirm AUTH_REQUIRED status and, if set, that this vault's address is pre-authorized.",
      "Blacklist/denylist: confirm whether the issuer enforces address-level blocking.",
      "If a wrapped/bridged asset: research the bridge's own security model and track record separately.",
      "Non-standard decimals: confirm the token's actual decimals() value before building any display/UI layer.",
    ],
  };
}
```

A `passed: true` result from this script means the mechanically
checkable properties look clean over the (necessarily short) test
window — it is not a certification that the token is safe overall.
Every item in `manualChecksStillRequired` still needs to be
separately confirmed before recommending the token to real
depositors; this script narrows the manual-review surface, it doesn't
replace it.

## A decision framework: red flags vs. yellow flags vs. acceptable

| Finding | Classification | Recommendation |
|---|---|---|
| Fee-on-transfer detected | Red flag | Do not use with `LumenVault` as-is; the accounting will eventually desync. |
| Balance drift detected during the test window | Red flag | Do not use; the token rebases or otherwise mutates balances outside `transfer`. |
| Clawback enabled, actively used by the issuer historically | Red flag | Avoid, or only use with depositors who explicitly understand and accept this risk. |
| Pausable-by-issuer, issuer has a documented, narrow, disclosed policy for when it would be exercised | Yellow flag | Usable, but document the dependency explicitly for depositors. |
| Clawback enabled, but issuer has a credible, narrow, disclosed policy (e.g. only for confirmed fraud/legal order) and no history of misuse | Yellow flag | Usable with disclosure; understand this is a trust assumption about the issuer's stated policy, not a contract-enforced guarantee. |
| `AUTH_REQUIRED`, vault address successfully pre-authorized and confirmed | Yellow flag (operational dependency, not a red flag once actually handled) | Usable — just don't skip the authorization step, and re-verify after any issuer action that could plausibly revoke it. |
| Non-standard decimals, correctly handled in your own display/accounting layer | Not a flag | No contract-level risk; purely an integration-correctness item to get right once. |
| Wrapped/bridged asset, bridge has a long track record and transparent, audited custody | Yellow flag | Usable, with the underlying bridge risk understood and disclosed as a separate, ongoing dependency — not eliminated just because it's "yellow" rather than "red." |
| None of the above apply; passed the mechanical script above | Acceptable | Proceed, having still confirmed the non-mechanical items by other means (documentation, direct confirmation with the issuer) rather than by their absence from a short test. |

## If in doubt

Deploy a throwaway vault against the candidate token on testnet first,
run a deposit/withdraw cycle, and compare `vault.balance()` against the
token's own balance query at each step. If they ever disagree, don't use
that token with `LumenVault` — see
[design-tradeoffs.md](design-tradeoffs.md) for why the contract doesn't
and can't detect this for you.

If mainnet behavior needs to be confirmed rather than assumed to
match testnet (a reasonable caution for a token whose issuer maintains
separate testnet/mainnet deployments that could, in principle, behave
differently), repeat the same verification script against mainnet
with a small real amount before committing to recommending the token
broadly — the cost of a small real test transaction is far lower than
the cost of discovering a discrepancy after depositors have committed
meaningful funds.
