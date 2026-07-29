/* Обработчик офлайн-режима.
 *
 * Стратегия «сначала сеть, потом кеш». Обратный порядок — сначала кеш —
 * работает быстрее, но приводит к классической беде: после обновления
 * приложения человек неделями видит старую версию и не понимает, почему
 * исправления не появились. Здесь при наличии сети всегда приходит
 * свежее, а кеш выручает только когда сети нет.
 *
 * Кешируется исключительно код приложения. Карточки и голосовые записи
 * сюда не попадают: они лежат в хранилище браузера на устройстве и
 * никуда не копируются.
 */
'use strict';

const VERSION = 'affirmations-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      // Не ждём закрытия старых вкладок: обновление должно приезжать сразу
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Трогаем только обычные запросы за своими же файлами. Чужие адреса
  // не перехватываем вовсе — их в приложении и нет.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Копию кладём в кеш на случай, когда сети не будет
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit
        || caches.match('./index.html')))
  );
});
