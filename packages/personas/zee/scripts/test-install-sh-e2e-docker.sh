#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${ZEE_INSTALL_E2E_IMAGE:-zee-install-e2e:local}"
INSTALL_URL="${ZEE_INSTALL_URL:-https://zee-bot.com/install.sh}"

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_API_TOKEN="${ANTHROPIC_API_TOKEN:-}"
ZEE_E2E_MODELS="${ZEE_E2E_MODELS:-}"

echo "==> Build image: $IMAGE_NAME"
docker build \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/scripts/docker/install-sh-e2e/Dockerfile" \
  "$ROOT_DIR/scripts/docker/install-sh-e2e"

echo "==> Run E2E installer test"
docker run --rm \
  -e ZEE_INSTALL_URL="$INSTALL_URL" \
  -e ZEE_INSTALL_TAG="${ZEE_INSTALL_TAG:-latest}" \
  -e ZEE_E2E_MODELS="$ZEE_E2E_MODELS" \
  -e ZEE_INSTALL_E2E_PREVIOUS="${ZEE_INSTALL_E2E_PREVIOUS:-}" \
  -e ZEE_INSTALL_E2E_SKIP_PREVIOUS="${ZEE_INSTALL_E2E_SKIP_PREVIOUS:-0}" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e ANTHROPIC_API_TOKEN="$ANTHROPIC_API_TOKEN" \
  "$IMAGE_NAME"
