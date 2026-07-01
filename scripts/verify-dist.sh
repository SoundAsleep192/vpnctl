#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

bun run build

./scripts/codesign-dist.sh
./scripts/smoke-test-dist.sh

echo "verify-dist: OK"
