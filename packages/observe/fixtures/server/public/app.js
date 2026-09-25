// CLAPP-010 fixture app — deterministic behavior for observation capture.
//
// Load sequence is SERIALIZED by design (fetch resolves, THEN the service
// worker registers) so capture sequences are replay-stable: competing
// async operations would make record order jitter run-to-run.
/* global window, document, console, fetch, navigator, location, WebSocket, localStorage, sessionStorage */
(function () {
  'use strict';

  function log() {
    console.log.apply(console, arguments);
  }

  window.addEventListener('load', function () {
    log('fixture:load', 'v1');
    fetch('/api/data')
      .then(function (response) { return response.json(); })
      .then(function (data) {
        log('fixture:data', data.count);
        if ('serviceWorker' in navigator) {
          return navigator.serviceWorker.register('/sw.js').then(function (registration) {
            log('fixture:sw-registered', registration.scope);
          });
        }
        return undefined;
      })
      .catch(function (error) { log('fixture:load-error', String(error)); });
  });

  document.getElementById('load-data').addEventListener('click', function () {
    fetch('/api/user')
      .then(function (response) { return response.json(); })
      .then(function (user) { log('fixture:user', user); })
      .catch(function (error) { log('fixture:user-error', String(error)); });
  });

  document.getElementById('open-ws').addEventListener('click', function () {
    var protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var socket = new WebSocket(protocol + location.host + '/ws');
    socket.onopen = function () {
      log('fixture:ws-open');
      socket.send('ping-from-fixture');
    };
    socket.onmessage = function (event) {
      log('fixture:ws-echo', event.data);
      socket.close();
    };
    socket.onclose = function () {
      log('fixture:ws-close');
    };
  });

  document.getElementById('save-storage').addEventListener('click', function () {
    localStorage.setItem('fixture:theme', 'dark');
    localStorage.setItem('fixture:settings', '{"size":"md","verbose":false}');
    sessionStorage.setItem('fixture:flag', 'on');
    document.cookie = 'fixture_session=user-session-token-here; path=/';
    log('fixture:storage-saved');
  });

  document.getElementById('note').addEventListener('input', function (event) {
    document.getElementById('status').textContent = 'note:' + event.target.value;
  });
})();
