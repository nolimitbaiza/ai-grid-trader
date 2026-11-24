/*
 * Shared by every page: the light/dark switch, the contact email and offline support.
 *
 * Exposes window.Site so the demo (app.js) can redraw its charts when the theme changes and
 * postpone an update reload while someone is presenting.
 */
(function () {
  "use strict";

  const SUN = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

  // ---------------------------------------------------------------------------- light / dark
  // The theme follows the system unless the visitor picks one; the choice is remembered in this
  // browser (an inline script in each page's <head> applies it before first paint).
  const root = document.documentElement;
  const systemDark = matchMedia("(prefers-color-scheme: dark)");
  const theme = () => root.getAttribute("data-theme") || (systemDark.matches ? "dark" : "light");
  const button = document.getElementById("btn-theme");

  function paintButton() {
    if (!button) return;
    const dark = theme() === "dark";
    button.innerHTML = dark ? SUN : MOON;
    button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  // Pages that draw their own colours (the demo's charts) listen for this event.
  const announce = () => document.dispatchEvent(new CustomEvent("site:theme", { detail: theme() }));

  function toggleTheme() {
    const next = theme() === "dark" ? "light" : "dark";
    const apply = () => {
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("agt-theme", next); } catch (e) { /* storage unavailable: still switches */ }
      paintButton();
      announce();
    };
    // Home page: cross-fade the switch (View Transitions; timing in home.css). Not on the demo,
    // whose charts redraw after the switch and would be caught mid-way.
    const fade = document.startViewTransition && document.body.classList.contains("about-page") &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (fade) document.startViewTransition(apply); else apply();
  }

  if (button) button.addEventListener("click", toggleTheme);
  systemDark.addEventListener("change", () => { paintButton(); announce(); });
  paintButton();

  // ---------------------------------------------------------------------------- contact email
  // The address is assembled at runtime to keep it away from simple scrapers.
  const email = ["baizak", "baizakisaev.com"].join("@");
  const emailButton = document.getElementById("email-link");
  const emailText = document.getElementById("email-text");
  const mailto = `mailto:${email}?subject=${encodeURIComponent("Hello from your website")}`;
  if (emailButton) { emailButton.href = mailto; emailButton.title = email; }
  if (emailText) { emailText.href = mailto; emailText.textContent = email; }

  const Site = { theme, toggleTheme, email, canReload: () => true };
  window.Site = Site;

  // ---------------------------------------------------------------------------- offline support
  // The service worker caches the site after the first visit (only over http/https, not file://).
  // When a new release takes over from an older one, reload once so the page and its files match.
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    const updating = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updating && !reloaded && Site.canReload()) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
