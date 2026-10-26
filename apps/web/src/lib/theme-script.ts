// Runs before first paint so the saved or system theme is applied without a light flash.
// Kept outside any "use client" module so the server layout receives the actual string.
export const THEME_STORAGE_KEY = "nd-theme";

export const themeInitScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var t=d?"dark":"light";document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}})()`;
