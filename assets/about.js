// About page: light/dark switch (shared with the demo) and the email link.
(function () {
  "use strict";
  const SUN = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  const root = document.documentElement;
  const theme = () => root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const btn = document.getElementById("btn-theme");
  const paint = () => {
    const dark = theme() === "dark";
    btn.innerHTML = dark ? SUN : MOON;
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  };
  btn.addEventListener("click", () => {
    const next = theme() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("agt-theme", next); } catch (e) { /* storage unavailable: still switches */ }
    paint();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
  paint();

  // The address is assembled at runtime to keep it away from simple scrapers.
  const email = ["baizak", "baizakisaev.com"].join("@");
  const link = document.getElementById("email-link");
  link.href = `mailto:${email}?subject=${encodeURIComponent("Hello from your website")}`;
  link.title = email;
  const text = document.getElementById("email-text");
  if (text) { text.href = link.href; text.textContent = email; }

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
