#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --test
node scripts/privacy-scan.mjs tests/fixtures templates dashboard examples references
