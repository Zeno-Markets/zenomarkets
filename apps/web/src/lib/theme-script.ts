/// Where a visitor's theme choice is stored. Shared by the inline script and the toggle.
export const THEME_KEY = "zeno-theme";

/// Runs inline in `<head>` before first paint. Dark is the default, so the server sends `data-theme="dark"` and this
/// only takes it off for a visitor who chose light, before they see a dark flash. Kept apart from `theme.ts` (a client
/// module) because the server layout imports it as a plain string.
export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="light")document.documentElement.removeAttribute("data-theme")}catch(e){}`;
