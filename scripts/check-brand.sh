#!/usr/bin/env bash
# Fails when a shipped file names a retired brand or a removed product. The venue is ZENOMARKETS; no
# earlier name may reach code, metadata, UI copy, an asset filename or the SDK package name.
# pnpm-lock.yaml is generated and this file names what it bans, so both are skipped. Untracked files are
# scanned too, so a bad name fails here rather than after it is committed.
set -euo pipefail

cd "$(dirname "$0")/.."

# The retired spellings are written as fragments on purpose, so that a plain repository-wide grep for
# the old name returns only real occurrences and never this file's own pattern.
PATTERN='h''ume|w''alter|citadel|ctdl|orionis|alpha-?markets?|levier|levera-|levera(market|pair|vault|router)|\bp''ons\b'

# git grep exits 1 for "no match" and 2 or more for a real failure. Treat only 0 and 1 as answers, so a
# mistyped pathspec can never read as a clean repository.
set +e
hits=$(git grep --untracked -n -I -i -E "$PATTERN" -- . \
  ':!pnpm-lock.yaml' ':!scripts/check-brand.sh' ':!apps/web/src/assets/*.svg')
status=$?
set -e
if [ "$status" -gt 1 ]; then
  echo "Brand check could not run: git grep exited $status"
  exit 2
fi
names=$(git ls-files --cached --others --exclude-standard | grep -i -E "$PATTERN" || true)

if [ -n "$hits$names" ]; then
  echo "Retired brand or removed product found. The venue is ZENOMARKETS:"
  [ -n "$hits" ] && echo "$hits"
  [ -n "$names" ] && echo "$names"
  exit 1
fi

echo "Brand check passed."
