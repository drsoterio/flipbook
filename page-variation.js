// // page-variation.js — applies masked overlays as real elements (no PNGs)
// (function () {
//   const LIGHT_VARIANTS = ["fx--oily", "fx--mildew", "fx--holes"];

//   function ensureOverlay(page, cls) {
//     if (page.querySelector(`.fx.${cls}`)) return;
//     const el = document.createElement("i");
//     el.className = `fx ${cls}`;
//     // put overlays above content; prepend keeps them before .conteudo in DOM,
//     // but with higher z-index they render on top anyway.
//     page.prepend(el);
//   }

//   function ensureStamp(page, index) {
//     if (page.querySelector(".page-stamp")) return;
//     const stamp = document.createElement("div");
//     stamp.className = "page-stamp";
//     stamp.textContent = `LOT ${String(1000 + index).padStart(4,"0")} • ${new Date().getFullYear()}`;
//     page.appendChild(stamp);
//   }

//   function ensureCrease(page) {
//     if (page.querySelector(".page-crease")) return;
//     const crease = document.createElement("i");
//     crease.className = "page-crease";
//     page.appendChild(crease);
//   }

//   function applyToPages() {
//     // Use Turn.js pages if available, otherwise .parchment (pre-init)
//     const nodes = document.querySelectorAll(".flipbook .page:not(.hard), .flipbook .parchment");
//     const pages = Array.from(nodes).filter(p => !p.dataset.fxApplied);

//     if (!pages.length) return false;

//     pages.forEach((p, i) => {
//       // Clear any old overlays if re-running
//       p.querySelectorAll(".fx").forEach(n => n.remove());

//       // Randomized opt-in (soft & visible)
//       if (Math.random() < 0.45) ensureOverlay(p, "fx--edge");
//       if (Math.random() < 0.35) ensureOverlay(p, "fx--grit");
//       if (Math.random() < 0.50) ensureOverlay(p, LIGHT_VARIANTS[Math.floor(Math.random() * LIGHT_VARIANTS.length)]);

//       if (Math.random() < 0.55) ensureStamp(p, i);
//       if (Math.random() < 0.60) ensureCrease(p);

//       p.dataset.fxApplied = "1";
//     });

//     return true;
//   }

//   function waitAndApply(attempts = 0) {
//     const ok = applyToPages();
//     // If Turn.js recreates nodes, re-apply after turns
//     if (window.jQuery && jQuery(".flipbook").length) {
//       const $flip = jQuery(".flipbook");
//       $flip.off("turned._fx").on("turned._fx", function(){ applyToPages(); });
//     }
//     if (!ok && attempts < 80) {
//       setTimeout(() => waitAndApply(attempts + 1), 100);
//     }
//   }

//   document.addEventListener("DOMContentLoaded", waitAndApply);
//   window.addEventListener("load", waitAndApply);

//   // Tiny console API for manual testing:
//   window.PageFX = {
//     add(pageIndex, className){
//       const all = document.querySelectorAll(".flipbook .page:not(.hard), .flipbook .parchment");
//       const p = all[pageIndex];
//       if (!p) return;
//       ensureOverlay(p, className); p.dataset.fxApplied = "1";
//     },
//     reapply: applyToPages
//   };
// })();
