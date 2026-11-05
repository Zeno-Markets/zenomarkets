"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./theme-script";

/// Dark is the default for every visitor: the server renders `data-theme="dark"` on `<html>`. The OS preference is
/// not consulted; a visitor's own choice is stored per device, and choosing light removes the attribute.
export type Theme = "light" | "dark";


const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/// The current theme. Canvas surfaces that read the tokens once (the price chart, the landing scene)
/// key on it so they re-read them when the theme changes.
export const useTheme = () => useSyncExternalStore<Theme>(subscribe, read, () => "dark");

export function setTheme(theme: Theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked (private mode): the choice lasts for this page only.
  }
}
