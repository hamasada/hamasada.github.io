/* ==========================================================================
 *  濵貞アプリ Service Worker   ver 1.0
 * --------------------------------------------------------------------------
 *  ①ホーム画面に追加（PWA）できるようにする
 *  ②電波が悪いところでも画面だけは開く（アプリの殻をキャッシュ）
 *  ③プッシュ通知を受け取って表示する
 *
 *  ★キャッシュ名にバージョンを入れてあります。index.html を更新したら
 *    build.py が自動でこの番号を書き換えるので、古いキャッシュは破棄されます。
 * ========================================================================== */
var VERSION = '1.0';
var CACHE = 'hamasada-' + VERSION;

/* アプリの殻（これだけあれば画面は出る） */
var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/icon-maskable-512.png',
  './img/apple-touch-icon.png',
  './img/favicon.ico',
  './img/pdf.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 1つでも失敗すると addAll は全部やめてしまうので個別に入れる
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { });
      }));
    })
    // skipWaiting はしない（画面側が「更新があります」と出して、ユーザーの操作で切り替える）
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return (k !== CACHE && k.indexOf('hamasada-') === 0) ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/** 画面から「今すぐ更新して」と言われたら切り替わる */
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'PING' && e.source) e.source.postMessage({ type: 'PONG', version: VERSION });
});

/* --------------------------------------------------------------------------
 *  取得の方針
 *    ・GASのAPI／Google（GA・カレンダー・認証）は絶対にキャッシュしない
 *    ・画面（ナビゲーション）はネット優先、駄目ならキャッシュ（＝オフラインでも開く）
 *    ・自分のところの画像などはキャッシュ優先
 * -------------------------------------------------------------------------- */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;          // 外部はそのまま通す
  if (url.pathname.indexOf('/sw.js') >= 0) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return r;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./') || new Response(
            '<meta charset="utf-8"><body style="font-family:sans-serif;padding:24px">' +
            'オフラインです。電波の届くところでもう一度開いてください。',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (r && r.status === 200 && r.type === 'basic') {
          var copy = r.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return r;
      }).catch(function () { return hit; });
    })
  );
});

/* ==========================================================================
 *  プッシュ通知
 * --------------------------------------------------------------------------
 *  本文は付けずに「届いたよ」だけを送り、中身はここでGASに取りに行きます。
 *  （本文を暗号化して送るには Apps Script に無い暗号処理が必要なため）
 * ========================================================================== */
var API_URL = 'https://script.google.com/macros/s/AKfycbydJ_T9jCDTlTYL85-CeNBkvyiFCaAsa_VSngnar1Qgqejta1GSEqmBp-0hPiOdWvo/exec';

self.addEventListener('push', function (e) {
  e.waitUntil((async function () {
    var d = null;
    try { d = e.data ? e.data.json() : null; } catch (err) { d = null; }

    if (!d) d = await pullMessage();
    if (!d) d = { title: '濵貞アプリ', body: '新しいお知らせがあります' };

    return self.registration.showNotification(d.title || '濵貞アプリ', {
      body: d.body || '',
      icon: './img/icon-192.png',
      badge: './img/icon-192.png',
      tag: d.tag || 'hamasada',
      renotify: true,
      requireInteraction: false,
      data: { url: d.url || './?src=push' },
      vibrate: [80, 40, 80]
    });
  })());
});

/** 通知の中身をGASから取ってくる */
async function pullMessage() {
  try {
    var sub = await self.registration.pushManager.getSubscription();
    if (!sub || !API_URL) return null;
    var u = API_URL + '?action=push.fetch&payload=' +
      encodeURIComponent(JSON.stringify({ endpoint: sub.endpoint }));
    var r = await fetch(u, { method: 'GET', redirect: 'follow' });
    var j = await r.json();
    if (j && j.ok && j.data && j.data.title) return j.data;
  } catch (err) { }
  return null;
}

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) {
          list[i].postMessage({ type: 'NOTIFICATION_CLICK', url: target });
          return list[i].focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

/** 購読が作り替えられたとき（ブラウザ都合で起こる）は登録し直す */
self.addEventListener('pushsubscriptionchange', function (e) {
  e.waitUntil((async function () {
    try {
      var old = e.oldSubscription || await self.registration.pushManager.getSubscription();
      var appKey = (e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey) ||
        (await self.registration.pushManager.getSubscription() || {}).options;
      if (!appKey) return;
      var fresh = e.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: appKey
      });
      if (!fresh || !API_URL) return;
      await fetch(API_URL, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'push.resubscribe', token: '',
          payload: { oldEndpoint: old && old.endpoint, sub: fresh.toJSON() }
        })
      });
    } catch (err) { }
  })());
});
