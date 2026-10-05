# Depositor allowances

An optional cap on who may deposit into a vault, and how much. It does
not change who may withdraw. The owner is still the only address that
can call `withdraw`.

The implementation is `contracts/lumen_vault/src/allowance.rs` in
`lumen_vault` 0.6.0. The decision record is
[ADR 006](https://github.com/StellarCrove/lumenforge-contracts/blob/main/docs/adr/006-depositor-allowances.md).
The client helpers are `readAllowances`, `setAllowance`, and
`setAllowancesEnabled` in `@lumenforge/sdk`.

## Default

Allowances are off. A vault deployed before this feature, and a new
vault whose owner has not called `set_allowances_enabled(true)`, still
accepts a deposit from any address that authorizes it. A missing
storage key reads as off, so old contracts do not change behavior when
the Wasm is upgraded only if the owner redeploys. This contract has no
upgrade function: a new vault is a new deployment. Existing deployments
keep the Wasm they were deployed with.

## Turning it on

```ts
import { connectVault, setAllowance, setAllowancesEnabled } from "@lumenforge/sdk";

const vault = await connectVault({ contractId: process.env.VAULT_ID!, /* rpc, network */ });

// Stage the amounts first. They have no effect while the switch is off.
await (await setAllowance(vault, payroll, 5_000_000n)).signAndSend();
await (await setAllowancesEnabled(vault, true)).signAndSend();
```

After that, `deposit` and `batch_deposit` from `payroll` succeed until
the remaining amount is used. Anyone else receives `AllowanceExceeded`
(error 12). The token transfer is not attempted when the allowance is
too small.

`setAllowance(vault, payroll, 0n)` removes that address and frees a
slot. The member list holds at most 32 addresses (`AllowanceListFull`,
error 13). Replacing the remaining amount for someone already on the
list does not take a new slot.

## What it does not do

- It does not give the depositor a right to withdraw. The balance is
  still one pool, and only the owner withdraws it. See ADR 001.
- It does not survive on its own TTL. The member list and the remaining
  amounts are instance storage. The vault's existing `extend_ttl` covers
  them.
- It does not apply to `rescue` or to tokens sent to the vault outside
  `deposit`. Those are still the cases `rescue` and the exact-credit
  check exist for.

## Reading it back

```ts
import { readAllowances } from "@lumenforge/sdk";

const view = await readAllowances(vault);
// view.enabled, view.members, view.remaining[address]
```

`readAllowances` does one call for the switch, one for the member list,
and one per member. The list cannot be longer than 32.
