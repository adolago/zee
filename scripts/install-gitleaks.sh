#!/bin/bash
# install-gitleaks.sh -- Download gitleaks binary for the current platform
#
# Usage: ./scripts/install-gitleaks.sh
#
# Installs to ~/.local/bin/gitleaks (ensure ~/.local/bin is in PATH).

set -euo pipefail

VERSION="8.24.3"
INSTALL_DIR="${HOME}/.local/bin"

if command -v gitleaks >/dev/null 2>&1; then
  CURRENT=$(gitleaks version 2>/dev/null || echo "unknown")
  echo "gitleaks already installed: ${CURRENT}"
  exit 0
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "${ARCH}" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: ${ARCH}"
    exit 1
    ;;
esac

case "${OS}" in
  linux)  OS="linux" ;;
  darwin) OS="darwin" ;;
  *)
    echo "Unsupported OS: ${OS}"
    exit 1
    ;;
esac

FILENAME="gitleaks_${VERSION}_${OS}_${ARCH}.tar.gz"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${FILENAME}"

mkdir -p "${INSTALL_DIR}"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "Downloading gitleaks v${VERSION} for ${OS}/${ARCH}..."
curl -fsSL "${URL}" -o "${TMP}/${FILENAME}"
tar -xzf "${TMP}/${FILENAME}" -C "${TMP}"
mv "${TMP}/gitleaks" "${INSTALL_DIR}/gitleaks"
chmod +x "${INSTALL_DIR}/gitleaks"

echo "Installed: ${INSTALL_DIR}/gitleaks"
"${INSTALL_DIR}/gitleaks" version
