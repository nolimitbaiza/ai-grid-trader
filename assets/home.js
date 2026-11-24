/*
 * Home page motion & micro-interactions. ~2 KB, no dependencies.
 * Loaded by index.html after site.js.
 *
 * Principles: IntersectionObserver instead of scroll listeners; rAF-batched writes;
 * only transform/opacity animate; everything degrades to a static, fully visible page.
 */
(function () {
  "use strict";

  const root = document.documentElement;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const hasIO = "IntersectionObserver" in window;

  // ------------------------------------------------------------------ 1. Scroll reveal
  // CSS hides [data-reveal] only under .reveal-on, which is set here — so if this file
  // never loads, nothing is hidden. Children of [data-stagger] get --i for a cascade.
  document.querySelectorAll("[data-stagger]").forEach((group) => {
    [...group.children].forEach((child, i) => {
      child.setAttribute("data-reveal", "");
      child.style.setProperty("--i", i);
    });
  });

  const revealEls = document.querySelectorAll("[data-reveal]");
  if (hasIO && revealEls.length) {
    root.classList.add("reveal-on");
    const revealIO = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        revealIO.unobserve(entry.target);          // reveal once; no work after that
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0 });
    revealEls.forEach((el) => revealIO.observe(el));
  }

  // ------------------------------------------------------------------ 2. Header state
  // A 1px sentinel at the top of the page: when it leaves the viewport, frost the header.
  const header = document.querySelector(".site-header");
  if (header && hasIO) {
    const sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "position:absolute;top:0;left:0;width:1px;height:8px;pointer-events:none";
    document.body.prepend(sentinel);
    new IntersectionObserver(([entry]) => {
      header.classList.toggle("is-scrolled", !entry.isIntersecting);
    }).observe(sentinel);
  }

  // ------------------------------------------------------------------ 3. Scroll-spy
  // Marks the nav link of the section crossing the middle of the viewport.
  const navLinks = [...document.querySelectorAll('.nav-link[href^="#"]')];
  if (navLinks.length && hasIO) {
    const byId = new Map(navLinks.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const spyIO = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        navLinks.forEach((a) => a.removeAttribute("aria-current"));
        const link = byId.get(entry.target.id);
        if (link) link.setAttribute("aria-current", "true");
      }
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main > section[id]").forEach((s) => spyIO.observe(s));
  }

  // ------------------------------------------------------------------ 4. Count-up metrics
  // Markup already holds the final value (no-JS + screen readers get it; the animated
  // copy is aria-hidden). Width is locked first so neighbours never shift.
  const counters = document.querySelectorAll("[data-count]");
  if (counters.length && hasIO && !reduceMotion.matches) {
    const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
    const run = (el) => {
      const target = parseFloat(el.dataset.count);
      const decimals = parseInt(el.dataset.decimals || "0", 10);
      const prefix = el.dataset.prefix || "";
      const suffix = el.dataset.suffix || "";
      const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      const duration = 1400;
      el.style.minWidth = el.getBoundingClientRect().width + "px";
      let start = 0;
      const tick = (now) => {
        if (!start) start = now;
        const t = Math.min((now - start) / duration, 1);
        el.textContent = prefix + fmt.format(target * easeOutExpo(t)) + suffix;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const countIO = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        countIO.unobserve(entry.target);
        run(entry.target);
      }
    }, { threshold: 0.6 });
    counters.forEach((el) => countIO.observe(el));
  }

  // ------------------------------------------------------------------ 5. Card spotlight
  // Mouse/trackpad only. One rAF write per frame; the CSS moves a pseudo-element with
  // transform, so the browser composites instead of repainting the card.
  if (finePointer.matches && !reduceMotion.matches) {
    document.querySelectorAll("[data-spotlight]").forEach((card) => {
      let rect = null, frame = 0, x = 0, y = 0;
      card.addEventListener("pointerenter", () => { rect = card.getBoundingClientRect(); }, { passive: true });
      card.addEventListener("pointermove", (e) => {
        if (!rect) rect = card.getBoundingClientRect();
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          card.style.setProperty("--mx", x + "px");
          card.style.setProperty("--my", y + "px");
          frame = 0;
        });
      }, { passive: true });
      card.addEventListener("pointerleave", () => { rect = null; }, { passive: true });
    });
  }

  // ------------------------------------------------------------------ 6. Copy email + toast
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");          // announced politely by screen readers
    document.body.append(toast);
  }
  let toastTimer = 0;
  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  };

  document.querySelectorAll("[data-copy-email]").forEach((btn) => {
    const label = btn.querySelector("span");
    btn.addEventListener("click", async () => {
      // site.js assembles the address at runtime (kept out of the HTML for scrapers).
      const email = window.Site && window.Site.email;
      if (!email) return;
      try {
        await navigator.clipboard.writeText(email);
        btn.setAttribute("data-copied", "");
        if (label) label.textContent = "Copied";
        showToast("Email address copied");
        setTimeout(() => { btn.removeAttribute("data-copied"); if (label) label.textContent = "Copy"; }, 2000);
      } catch (e) {
        location.href = "mailto:" + email;           // clipboard blocked: fall back to mail app
      }
    });
  });
})();
