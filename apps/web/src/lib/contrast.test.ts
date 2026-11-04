import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

/// Reads the colour tokens out of globals.css, so a palette edit that drops a ratio fails here and not in review.
const css = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));
}
const light = tokens(css.slice(css.indexOf("@theme {"), css.indexOf(":root {")));
const dark = { ...light, ...tokens(css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf("html {"))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("the light tokens keep the ratios recorded in globals.css", () => {
  assert.ok(ratio(light.text!, light.ground!) >= 15.4, "text on ground, recorded 15.40:1");
  assert.ok(ratio(light.muted!, light.ground!) >= 6.2, "muted on ground, recorded 6.23:1");
  assert.ok(ratio(light.faint!, light.ground!) >= 4.9, "faint on ground, recorded 4.94:1");
});

for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
  test(`${name}: the gold watchlist star clears 3:1 on every surface`, () => {
    for (const surface of ["ground", "surface", "raised"]) {
      assert.ok(ratio(theme.gold!, theme[surface]!) >= 3, `${name} gold on ${surface}: ${ratio(theme.gold!, theme[surface]!).toFixed(2)}`);
    }
  });
  test(`${name}: text, muted, faint and the accent ink clear 4.5:1 where they are used`, () => {
    for (const surface of ["ground", "surface", "raised"]) {
      for (const ink of ["text", "muted", "faint", "accent-fg"]) {
        assert.ok(ratio(theme[ink]!, theme[surface]!) >= 4.5, `${name} ${ink} on ${surface}: ${ratio(theme[ink]!, theme[surface]!).toFixed(2)}`);
      }
    }
    assert.ok(ratio(theme["accent-ink"]!, theme.accent!) >= 4.5, `${name} accent ink on accent`);
    for (const direction of ["up", "down"]) {
      assert.ok(ratio(theme[direction]!, theme.ground!) >= 4.5, `${name} ${direction} on ground: ${ratio(theme[direction]!, theme.ground!).toFixed(2)}`);
    }
  });
}
