/* Обработчик офлайн-режима.
 *
 * Стратегия «сначала память устройства, обновление — следом».
 *
 * Раньше здесь было наоборот: сначала сеть, и только если её нет — то,
 * что сохранено. Звучит правильно, а на деле означало, что при каждом
 * запуске приложение заново скачивало себя целиком, четверть мегабайта,
 * и до конца загрузки человек смотрел на пустой экран. На домашнем
 * интернете это доли секунды, на мобильной связи — несколько секунд
 * чёрного экрана. Особенно заметно после полного закрытия приложения:
 * ничего готового в памяти нет, и ждать приходится всё.
 *
 * Теперь страница отдаётся из памяти сразу, а свежая версия скачивается
 * следом, в фоне, и ложится на её место. Она откроется при следующем
 * запуске — или прямо сейчас, если нажать «Обновить» в появившейся
 * полоске: как только новая версия скачалась, приложение об этом
 * говорит, а не молчит.
 *
 * Кешируется исключительно код приложения. Карточки и голосовые записи
 * сюда не попадают: они лежат в хранилище браузера на устройстве и
 * никуда не копируются.
 */
'use strict';

// Номер меняется при каждой правке обработчика. На «активации» все чужие
// кеши удаляются, поэтому смена номера — это ещё и способ выбросить
// накопленное старьё разом.
const VERSION = 'affirmations-v7';
const PAGE = './index.html';
const SHELL = [
  './',
  PAGE,
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

/** Сказать открытому приложению, что новая версия уже скачана. */
function tellFresh() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => { list.forEach((c) => c.postMessage({ kind: 'fresh' })); })
    .catch(() => {});
}

/**
 * Скачать страницу заново и заменить сохранённую, если она изменилась.
 *
 * Сравниваем именно содержимое. Проверять дату или метку хостинга
 * ненадёжно: разные хостинги отдают их по-своему, а некоторые не отдают
 * вовсе — и тогда «обновление» показывалось бы при каждом запуске.
 */
function refreshPage(href, known) {
  return fetch(href, { cache: 'no-store', credentials: 'same-origin' })
    .then((res) => {
      if (!res || !res.ok) return null;
      const copy = res.clone();
      return res.text().then((text) => {
        const put = caches.open(VERSION)
          .then((cache) => cache.put(PAGE, copy))
          .catch(() => {});
        if (known === null || known === text) return put;
        return put.then(tellFresh);
      });
    })
    .catch(() => null);   // сети нет — просто живём тем, что есть
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Трогаем только обычные запросы за своими же файлами. Чужие адреса
  // не перехватываем вовсе — их в приложении и нет.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // Отметку версии не трогаем вовсе.
  //
  // Это единственный файл, который обязан приходить с сайта, а не из
  // памяти: по нему приложение и узнаёт, что на сайте лежит версия
  // новее. Отдай мы сохранённую копию — приложение вечно сравнивало бы
  // себя с самим собой и уверяло, что всё свежее некуда.
  if (/version\.txt$/.test(url.pathname)) return;

  const page = req.mode === 'navigate' || /\.html?$/.test(url.pathname);

  // ------------------------------------------------------------------
  // Сама страница.
  //
  // ВАЖНО, как скачивается свежая копия. Напрашивается
  // new Request(req, {...}) — и это ошибка: у запроса за страницей
  // особый вид, «navigate», а пересоздать такой запрос нельзя, Safari
  // на iPhone бросает исключение. Бросается оно прямо в обработчике, до
  // respondWith, поэтому страница просто не загружается — открывается
  // пустой экран. Так однажды и случилось. Поэтому запрос собираем не
  // из запроса, а из адреса.
  // ------------------------------------------------------------------
  if (page) {
    const href = url.href;
    // Приложение попросило свежую страницу — отдаём только из сети.
    //
    // Так работает кнопка «Обновить»: она уходит на адрес с меткой
    // времени. Сохранённую копию здесь возвращать нельзя ни в коем
    // случае — ровно ради того, чтобы её обойти, всё и затевалось.
    // Сети нет — тогда уж лучше сохранённая, чем пустой экран.
    if (/[?&]fresh=/.test(url.search || '')) {
      event.respondWith(
        fetch(href, { cache: 'no-store', credentials: 'same-origin' })
          .then((res) => {
            if (res && res.ok) {
              try {
                const copy = res.clone();
                event.waitUntil(caches.open(VERSION)
                  .then((c) => c.put(PAGE, copy)).catch(() => {}));
              } catch (e) { /* не поместилась — не страшно */ }
            }
            return res;
          })
          .catch(() => caches.match(PAGE))
      );
      return;
    }
    event.respondWith(
      caches.match(PAGE).then((hit) => {
        if (hit) {
          // Отдаём немедленно, ничего не дожидаясь. Обновление поедет
          // своим чередом — waitUntil не даёт обработчику уснуть, пока
          // оно не закончится, но и человека не задерживает.
          const known = hit.clone().text().catch(() => null);
          event.waitUntil(known.then((text) => refreshPage(href, text)));
          return hit;
        }
        // Первый запуск: в памяти пусто, ждать придётся
        return fetch(href, { cache: 'no-store', credentials: 'same-origin' })
          .then((res) => {
            try {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(PAGE, copy)).catch(() => {});
            } catch (e) { /* не поместилась — не страшно */ }
            return res;
          })
          .catch(() => caches.match(PAGE));
      }).catch(() => fetch(href))
    );
    return;
  }

  // ------------------------------------------------------------------
  // Всё остальное: значки и манифест. Меняются раз в год, поэтому тоже
  // сначала из памяти — иначе запуск снова упирался бы в сеть.
  // ------------------------------------------------------------------
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        try {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        } catch (e) { /* не поместилась — не страшно */ }
        return res;
      });
    }).catch(() => fetch(req))
  );
});

// Приложение просит обновиться прямо сейчас — скачиваем и сообщаем.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.kind !== 'check') return;
  event.waitUntil(
    caches.match(PAGE)
      .then((hit) => (hit ? hit.clone().text().catch(() => null) : null))
      // Адрес собираем от места, где лежит сам обработчик: приложение
      // может стоять не в корне сайта, а во вложенной папке
      .then((text) => refreshPage(new URL(PAGE, self.location.href).href, text))
      .catch(() => {})
  );
});
