"use client";

import { chip, cn } from "@zeno/ui";
import { setTheme, useTheme } from "@/lib/theme";

/// Switches between the light (default) and dark themes. The icon shows the theme a press moves to:
/// a moon in light, a sun in dark.
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      className={cn(chip, "size-11 shrink-0 justify-center rounded-control! max-xl:size-10", className)}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="size-4">
        {theme === "dark" ? (
          <>
            <circle cx="10" cy="10" r="3.5" />
            <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4" />
          </>
        ) : (
          <path d="M16.5 12.3A7 7 0 017.7 3.5a7 7 0 108.8 8.8z" />
        )}
      </svg>
    </button>
  );
}
