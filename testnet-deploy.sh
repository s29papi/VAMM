#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -f ./.env.testnet ]]; then
  set -a
  source ./.env.testnet
  set +a
fi

node ./scripts/testnet-deploy.mjs
