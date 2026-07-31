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

// Номер меняется при каждой правке обработчика. На «активации» все чужие
// кеши удаляются, поэтому смена номера — это ещё и способ выбросить
// накопленное старьё разом.
const VERSION = 'affirmations-v2';
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

  // Саму страницу берём в обход кеша браузера.
  //
  // Без этого приложение, поставленное в док или на экран «Домой», может
  // неделями показывать старую версию: хостинг отдаёт страницу с
  // разрешением хранить её десять минут, а установленное приложение
  // страницу лишний раз не перезапрашивает вовсе. Человек обновляет файл
  // на хостинге, на телефоне видит новое, на компьютере — старое, и
  // понять, почему, невозможно.
  const fresh = (req.mode === 'navigate' || /\.html?$/.test(new URL(req.url).pathname))
    ? new Request(req, { cache: 'no-store' })
    : req;

  event.respondWith(
    fetch(fresh)
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
