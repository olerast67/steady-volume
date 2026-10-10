# Privacy policy / Политика конфиденциальности

Steady Volume (Ровный звук) does not collect, store or transmit personal data or browsing data.

- The extension has no analytics, telemetry, accounts or ads and makes no network requests of its own.
- When a page plays a video or audio file from another server, the extension adds CORS headers to that server's responses for that page (a browser request rule, `declarativeNetRequest`), so the browser allows processing the sound. The rule applies only to media requests between that page and that server and is removed when the browser closes.
- In Chromium browsers the extension can capture the sound of a tab (`tabCapture`) when a video cannot be connected directly. The captured sound is processed and played to your speakers right away; it is not recorded, stored or sent anywhere.
- Audio is processed inside the browser in real time. Nothing is recorded or saved.
- The only stored data are the extension settings: volume, leveling mode, the Clearer speech switch and the list of sites where the extension is turned off. They are kept in the browser's `storage.sync`. If browser sync is on, the browser syncs them between your devices through your browser account; the extension author has no access to them.
- The content script reads the address of the page only to apply the per-site switch.

Ровный звук не собирает, не хранит и не передаёт персональные данные и данные о просмотре страниц.

- В расширении нет аналитики, телеметрии, аккаунтов и рекламы, само оно сетевых запросов не делает.
- Когда страница играет видео или аудио с другого сервера, расширение добавляет к ответам этого сервера для этой страницы заголовки CORS (правило браузера `declarativeNetRequest`), чтобы браузер разрешил обработку звука. Правило касается только медиазапросов между этой страницей и этим сервером и удаляется при закрытии браузера.
- В браузерах на Chromium расширение может захватить звук вкладки (`tabCapture`), если к видео нельзя подключиться напрямую. Захваченный звук обрабатывается и сразу выводится в колонки, он не записывается, не хранится и никуда не отправляется.
- Звук обрабатывается в браузере в реальном времени. Ничего не записывается и не сохраняется.
- Расширение хранит только свои настройки: громкость, режим выравнивания, переключатель «Чётче речь» и список сайтов, где оно выключено. Настройки лежат в `storage.sync` браузера. Если в браузере включена синхронизация, браузер переносит их между вашими устройствами через ваш аккаунт браузера, у автора расширения доступа к ним нет.
- Скрипт на странице читает её адрес только для переключателя «На этом сайте».

Contact: https://github.com/olerast67/steady-volume/issues
