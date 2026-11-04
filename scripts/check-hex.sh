#!/usr/bin/env bash
# Enforces UI contract rule 1 (docs/UI_CONTRACT.md Section 3): the Section 4 palette is the only
# palette, and it lives in `apps/web/src/app/globals.css`. A colour written anywhere else in
# `apps/web/src` or `packages/ui/src` is a colour outside the contract, so this fails the build.
#
# What counts as a colour: a hex literal (#rgb, #rrggbb, #rrggbbaa) and a raw rgb()/rgba()/hsl()/
# hsla() value. Tailwind utilities (`text-accent`, `bg-up-soft`) and `var(--color-*)` are the
# sanctioned way to reach a colour and are untouched by this check.
#
# The three exceptions, each deliberate:
#   globals.css               Where the palette is defined. The point of the rule, not a breach.
#   lib/theme-colors.ts       The browser-chrome themeColor, the edge-rendered OG image and the
#                             hero canvas render outside Tailwind's reach and need literals. Holding
#                             them in one file is what keeps them in sync with globals.css.
#   components/BrandLogos.tsx Third-party marks: Tesla red, NVIDIA green, Robinhood green. These are
#                             other companies' brand colours, not Zeno's palette, and recolouring a
#                             logo to fit the palette would misrepresent it.
# Add an exception only with a reason of that kind, never to silence a finding.
set -euo pipefail

cd "$(dirname "$0")/.."

PATTERN='#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\('

set +e
hits=$(git grep --untracked -n -I -E "$PATTERN" -- 'apps/web/src' 'packages/ui/src' \
  ':!apps/web/src/app/globals.css' \
  ':!apps/web/src/lib/theme-colors.ts' \
  ':!apps/web/src/components/BrandLogos.tsx')
status=$?
set -e
if [ "$status" -gt 1 ]; then
  echo "Hex check could not run: git grep exited $status"
  exit 2
fi

if [ -n "$hits" ]; then
  echo "Colour literal outside the palette (docs/UI_CONTRACT.md rule 1). Use a token from"
  echo "globals.css — a Tailwind utility such as text-accent, or var(--color-*):"
  echo "$hits"
  exit 1
fi

echo "Hex check passed: no colour literal in apps/web/src or packages/ui/src outside globals.css."
