/* CLAPP-012 — b01 fixture script (progressive enhancement only).
   Self-contained vanilla JS: no imports, no network calls, no external
   libraries. NOTE: the @clapp/journey DOM ActionApplier does NOT execute
   page scripts (documented limitation); these behaviors exist for real
   browsers and never gate seeded-journey assertions. */
/* global document */
(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.nav-toggle');

  if (header !== null && toggle !== null) {
    toggle.addEventListener('click', function () {
      var open = header.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  var yearSlots = document.querySelectorAll('[data-year]');
  for (var i = 0; i < yearSlots.length; i += 1) {
    yearSlots[i].textContent = String(new Date().getFullYear());
  }
})();
