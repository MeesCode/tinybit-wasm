#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi

cargo build --target wasm32-wasip1 --release

mkdir -p web
cp target/wasm32-wasip1/release/tinybit_wasm.wasm web/tinybit_wasm.wasm

echo "Built web/tinybit_wasm.wasm ($(stat -c %s web/tinybit_wasm.wasm) bytes)"
