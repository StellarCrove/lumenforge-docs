#!/usr/bin/env bash
# Deploy lumen_vault_factory and one vault on Stellar testnet.
# Reads .env from the current directory. Prints FACTORY_ID and VAULT_ID.
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${SOROBAN_RPC_URL:=https://soroban-testnet.stellar.org}"
: "${SOROBAN_NETWORK_PASSPHRASE:=Test SDF Network ; September 2015}"
: "${MIN_DEPOSIT:=0}"
: "${CONTRACTS_DIR:=../lumenforge-contracts}"

if ! command -v soroban >/dev/null 2>&1; then
  echo "soroban CLI is not on PATH" >&2
  exit 1
fi

if [[ -z "${SOROBAN_SECRET:-}" ]]; then
  SOROBAN_SECRET="$(soroban keys generate deploy-tmp --as-secret 2>/dev/null || true)"
  if [[ -z "${SOROBAN_SECRET}" ]]; then
    echo "Set SOROBAN_SECRET in .env to a funded testnet secret key." >&2
    exit 1
  fi
fi

DEPLOYER_PUBLIC="$(soroban keys address --secret-key "$SOROBAN_SECRET" 2>/dev/null || true)"
if [[ -z "${DEPLOYER_PUBLIC}" ]]; then
  echo "Could not derive a public key from SOROBAN_SECRET." >&2
  exit 1
fi

echo "Deployer: $DEPLOYER_PUBLIC"
curl -fsS "https://friendbot.stellar.org/?addr=${DEPLOYER_PUBLIC}" >/dev/null || true

soroban network add testnet \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "$SOROBAN_NETWORK_PASSPHRASE" \
  >/dev/null 2>&1 || true

echo "$SOROBAN_SECRET" | soroban keys add deployer --secret-key-stdin >/dev/null 2>&1 || \
  soroban keys add deployer --secret-key "$SOROBAN_SECRET"

if [[ ! -d "$CONTRACTS_DIR" ]]; then
  echo "CONTRACTS_DIR does not exist: $CONTRACTS_DIR" >&2
  exit 1
fi

echo "Building contracts..."
( cd "$CONTRACTS_DIR" && cargo build --target wasm32v1-none --release -p lumen-vault -p lumen-vault-factory )

VAULT_WASM="$CONTRACTS_DIR/target/wasm32v1-none/release/lumen_vault.wasm"
FACTORY_WASM="$CONTRACTS_DIR/target/wasm32v1-none/release/lumen_vault_factory.wasm"

echo "Installing vault Wasm..."
WASM_HASH="$(soroban contract install \
  --wasm "$VAULT_WASM" \
  --source deployer \
  --network testnet)"
echo "Wasm hash: $WASM_HASH"

if [[ -z "${FACTORY_ID:-}" ]]; then
  echo "Deploying factory..."
  FACTORY_ID="$(soroban contract deploy \
    --wasm "$FACTORY_WASM" \
    --source deployer \
    --network testnet \
    -- --vault_wasm_hash "$WASM_HASH")"
fi
echo "FACTORY_ID=$FACTORY_ID"

if [[ -z "${TOKEN_CONTRACT_ID:-}" ]]; then
  echo "Deploying a fresh SAC for the vault token..."
  TOKEN_CONTRACT_ID="$(soroban lab token wrap \
    --asset "VAULTDEMO:$(soroban keys address deployer)" \
    --source deployer \
    --network testnet || true)"
  if [[ -z "${TOKEN_CONTRACT_ID}" ]]; then
    echo "Set TOKEN_CONTRACT_ID in .env to a SEP-41 contract. Automatic SAC deploy did not return an id." >&2
    exit 1
  fi
fi
echo "TOKEN_CONTRACT_ID=$TOKEN_CONTRACT_ID"

if [[ -z "${VAULT_ID:-}" ]]; then
  SALT="$(openssl rand -hex 32)"
  echo "Deploying vault..."
  VAULT_ID="$(soroban contract invoke \
    --id "$FACTORY_ID" \
    --source deployer \
    --network testnet \
    -- deploy_vault \
    --owner "$DEPLOYER_PUBLIC" \
    --token "$TOKEN_CONTRACT_ID" \
    --min_deposit "$MIN_DEPOSIT" \
    --salt "$SALT")"
fi
echo "VAULT_ID=$VAULT_ID"
echo
echo "Write these into .env before the next run:"
echo "FACTORY_ID=$FACTORY_ID"
echo "VAULT_ID=$VAULT_ID"
echo "TOKEN_CONTRACT_ID=$TOKEN_CONTRACT_ID"
