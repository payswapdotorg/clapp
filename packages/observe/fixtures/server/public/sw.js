// CLAPP-010 fixture service worker — registration AWARENESS target.
// Deliberately NO fetch handler: it must not intercept subsequent loads
// (recorded network must reflect the fixture server only — determinism).
/* global self */
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
