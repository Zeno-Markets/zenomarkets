/// Where a visitor's theme choice is stored. Shared by the inline script and the toggle.
export const THEME_KEY = "zeno-theme";

/// Runs inline in `<head>` before first paint, so a dark-theme visitor never sees a light flash. Kept apart
/// from `theme.ts` (a client module) because the server layout imports it as a plain string.
export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;
