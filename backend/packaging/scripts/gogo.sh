#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GW="${DIR}/../../gogo-gateway"
if [[ ! -x "${GW}" ]]; then
  GW="${DIR}/../gogo-gateway"
fi
if [[ -x "${GW}" ]]; then
  exec "${GW}" --mode cli "$@"
fi
echo "gogo: gogo-gateway not found next to bundled CLI (expected under tools/gogo)" >&2
exit 127
