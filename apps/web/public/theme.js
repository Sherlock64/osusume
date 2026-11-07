/* global window, localStorage, matchMedia, document */
// Runs before first paint so the page never flashes the wrong theme. A file rather than an inline
// script, so it keeps working under a Content-Security-Policy of script-src 'self'.
window.osusumeApplyTheme = function () {
  var choice = null;
  try {
    choice = localStorage.getItem('osusume-theme');
  } catch {
    // Storage blocked: follow the system.
  }
  var dark =
    choice === 'dark' ||
    (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  // Same as --background in index.css: the browser's own bar on phones.
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0b0e17' : '#f4eedf';
};
window.osusumeApplyTheme();
