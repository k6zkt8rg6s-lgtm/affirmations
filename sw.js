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
const VERSION = 'affirmations-v3';
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

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // Саму страницу берём в обход кеша браузера.
  //
  // Без этого приложение, поставленное в док или на экран «Домой», может
  // неделями показывать старую версию: хостинг разрешает хранить страницу
  // десять минут, а установленное приложение лишний раз её не
  // перезапрашивает.
  //
  // ВАЖНО, как именно это делается. Напрашивается new Request(req, {...})
  // — и это ошибка: у запроса за страницей особый вид, «navigate», а
  // пересоздать такой запрос нельзя, Safari на iPhone бросает исключение.
  // Бросается оно прямо в обработчике, до respondWith, поэтому страница
  // просто не загружается — открывается пустой экран. Так и случилось.
  // Поэтому запрос собираем не из запроса, а из адреса.
  const page = req.mode === 'navigate' || /\.html?$/.test(url.pathname);

  let ask;
  try {
    ask = page
      ? fetch(url.href, { cache: 'no-store', credentials: 'same-origin' })
      : fetch(req);
  } catch (e) {
    // Что бы ни случилось — молчим и отдаём запрос браузеру как есть.
    // Сломанный обработчик офлайна не имеет права оставить человека
    // с пустым экраном.
    return;
  }

  event.respondWith(
    ask
      .then((res) => {
        // Копию кладём в кеш на случай, когда сети не будет
        try {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        } catch (e) { /* не поместилась — не страшно */ }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit
        || caches.match('./index.html')))
  );
});
