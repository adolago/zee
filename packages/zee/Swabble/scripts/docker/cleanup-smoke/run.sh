#!/usr/bin/env bash
set -euo pipefail

cd /repo

export ZEE_STATE_DIR="/tmp/zee-test"
export ZEE_CONFIG_PATH="${ZEE_STATE_DIR}/zee.json"

echo "==> Seed state"
mkdir -p "${ZEE_STATE_DIR}/credentials"
mkdir -p "${ZEE_STATE_DIR}/agents/main/sessions"
echo '{}' >"${ZEE_CONFIG_PATH}"
echo 'creds' >"${ZEE_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${ZEE_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm zee reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${ZEE_CONFIG_PATH}"
test ! -d "${ZEE_STATE_DIR}/credentials"
test ! -d "${ZEE_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${ZEE_STATE_DIR}/credentials"
echo '{}' >"${ZEE_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm zee uninstall --state --yes --non-interactive

test ! -d "${ZEE_STATE_DIR}"

echo "OK"
