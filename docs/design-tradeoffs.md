# Design Tradeoffs

Things that look like missing features but are deliberate choices,
collected in one place instead of scattered across ADRs and
`docs/security.md` in `lumenforge-contracts`. If you're wondering "why
doesn't it just—", check here first.

### No per-depositor accounting

A vault's `Balance` is one pooled number. The contract has no on-chain
record of who deposited what — only the owner can withdraw, and only in
aggregate. This is [ADR-001](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/adr/001-single-balance-vault.md),
not an oversight: per-depositor accounting is a different product (a
shared pool with individual claims) than what `LumenVault` is (an
owner's custodied balance). If you need the former, build it as a layer
that tracks claims off-chain or in a separate contract that itself
becomes the vault's owner — don't expect it inside `LumenVault`.

### `pause` doesn't block `withdraw`

Pausing stops new deposits, not withdrawals — the owner should always be
able to retrieve funds, paused or not. There's no contract-level way to
freeze withdrawals if it's the *owner's* key that's compromised, because
the owner is the trust root; a mechanism that could override the owner's
withdrawal would just move the trust root somewhere else. If you need
recoverability from a compromised owner key, that has to be solved above
the contract (e.g. a multisig or timelock as the owner), not inside it.

### Salt management is on the caller

`LumenVaultFactory::deploy_vault` doesn't generate or track salts —
Soroban derives a deployed address from `(deployer, salt, wasm_hash)`,
so this is inherent to how the factory pattern works on Soroban, not a
gap the factory could close itself ([ADR-004](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/adr/004-permissionless-factory.md)).
The SDK closes this gap at the integration layer instead: `randomSalt()`,
`ownerNonceSalt()`, and `deployVaultViaFactory()` handle it so most
integrators never touch a salt directly.

### `rescue` can move any token except the vault's own

`rescue` is barred from moving the vault's configured `token` (that
balance is depositor funds), but it *can* move any other token the vault
happens to hold — including one some other integration expected to stay
put. Not a fund-loss risk for the vault's own depositors, but relevant
if you're building on top of a vault rather than depositing into it
directly: the owner has this reach, so don't park value in a vault via a
side channel `rescue` could touch.

### The factory's index is informational, not authoritative

`vaults_by_owner` is a convenience index, not a source of truth. A
vault's own `owner()` always governs who controls it; a vault deployed
directly (bypassing the factory) simply won't appear in the index, and
that's fine — it doesn't change who owns it.

### TTL extension is a mechanism, not a policy

Both contracts expose `extend_ttl` (and the factory additionally
`extend_vaults_by_owner_ttl`), callable by anyone, but nothing calls
these on a schedule automatically — Soroban contracts can't wake
themselves up. That's why the SDK ships `keepAlive` as an off-chain
keeper you're expected to run periodically (see the
[integration guide](integration-guide.md#7-keep-it-alive)) rather than
the contract trying to solve scheduling itself.
