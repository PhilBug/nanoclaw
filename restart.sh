#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Building TypeScript..."
pnpm run build 2>&1

echo "Building container image..."
./container/build.sh 2>&1

echo "Restarting nanoclaw..."
systemctl --user restart nanoclaw 2>&1

sleep 1
systemctl --user status nanoclaw 2>&1 | head -15

echo "Done. NanoClaw is up and running."
