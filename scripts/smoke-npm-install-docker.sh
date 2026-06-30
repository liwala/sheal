#!/usr/bin/env bash
set -euo pipefail

# Smoke-test the npm install path in a clean Linux container.
# Run with: npm run smoke:install:docker
# This exists to catch tarball/install regressions such as unpublished bundled
# workspace dependencies before publishing @liwala/sheal to npm.

image="${SHEAL_DOCKER_IMAGE:-node:22-bookworm-slim}"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

pack_json="$(npm pack --json --pack-destination "$tmp_dir")"
tarball="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(data[0].filename);' "$pack_json")"

docker run --rm \
  --volume "$tmp_dir:/pkg:ro" \
  "$image" \
  sh -lc '
    set -eu
    npm install --global "/pkg/'"$tarball"'"
    sheal --help >/tmp/sheal-help.txt
    agent_sessions="$(npm root --global)/@liwala/sheal/node_modules/@liwala/agent-sessions"
    test -f "$agent_sessions/package.json"
    node -e "import(process.argv[1]).then(() => console.log(\"installed sheal with bundled agent-sessions\"))" "$agent_sessions/dist/index.js"
  '
