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

## Fee-on-transfer tokens

If `token` deducts a fee so the vault receives less than the `amount`
passed to `transfer`, the vault's internal `Balance` — which is
incremented by the full `amount` on `deposit` — will over-state what the
vault actually holds. Eventually a legitimate `withdraw` could fail
because the real balance ran out before `Balance` said it would.

**Check**: deposit a small test amount and compare the vault's real
token balance (query the token contract directly) against what
`vault.balance()` reports. They should match exactly.

## Rebasing tokens

If `token`'s own accounting changes holders' balances outside of
`transfer` calls (e.g. an elastic-supply token), the vault's `Balance`
— which only moves on `deposit`/`withdraw` — will drift from the
vault's actual token balance over time, in either direction.

**Check**: does the token's contract mutate balances via any mechanism
other than an explicit `transfer`? If yes, don't use it with `LumenVault`
as-is — `Balance` will not track reality.

## Pausable-by-issuer tokens

If the token issuer can freeze transfers, `withdraw` can fail for
reasons entirely outside the vault's or the owner's control — the
vault's own `pause` state is irrelevant if the token itself is frozen.
This isn't a vault bug, but it changes the actual risk profile you're
presenting to depositors.

**Check**: does the token have an issuer-controlled freeze/pause? If so,
document that dependency for anyone depositing into this vault — the
vault's `pause`/`unpause` is not the only thing standing between a
depositor and their funds.

## Authorization-required tokens

Some Stellar assets require the issuer to explicitly authorize each
holder's trustline (`AUTH_REQUIRED`). If `token` is one of these, the
vault's own contract address needs to be authorized to hold and transfer
it, or every `deposit`/`withdraw` will fail at the token layer regardless
of anything the vault does.

**Check**: does the token require per-holder authorization? If so,
confirm the vault's contract address has been authorized *before*
advertising the vault as ready to accept deposits.

## If in doubt

Deploy a throwaway vault against the candidate token on testnet first,
run a deposit/withdraw cycle, and compare `vault.balance()` against the
token's own balance query at each step. If they ever disagree, don't use
that token with `LumenVault` — see
[design-tradeoffs.md](design-tradeoffs.md) for why the contract doesn't
and can't detect this for you.
