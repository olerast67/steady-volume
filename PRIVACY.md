# Privacy policy / Политика конфиденциальности

Steady Volume (Ровный звук) does not collect, store or transmit personal data or browsing data.

- The extension has no analytics, telemetry, accounts or ads. It makes one kind of network request: when a page plays a video or audio file from another server, the extension requests the headers of that same file from that server to check whether the server allows cross-origin processing (CORS). The request goes only to the server the page already loads the file from, carries no cookies and no data about you, and the extension stops it after the headers arrive.
- Audio is processed inside the browser in real time. Nothing is recorded or saved.
- The only stored data are the extension settings: volume, leveling mode, the Clearer speech switch and the list of sites where the extension is turned off. They are kept in the browser's `storage.sync`. If browser sync is on, the browser syncs them between your devices through your browser account; the extension author has no access to them.
- The content script reads the address of the page only to apply the per-site switch.

Ровный звук не собирает, не хранит и не передаёт персональные данные и данные о просмотре страниц.

- В расширении нет аналитики, телеметрии, аккаунтов и рекламы. Сетевой запрос оно делает в одном случае: когда страница играет видео или аудио с другого сервера, расширение запрашивает у этого сервера заголовки того же файла, чтобы узнать, разрешает ли он обработку (CORS). Запрос уходит только на сервер, с которого страница и так грузит файл, без cookie и без данных о вас, и расширение обрывает его после получения заголовков.
- Звук обрабатывается в браузере в реальном времени. Ничего не записывается и не сохраняется.
- Расширение хранит только свои настройки: громкость, режим выравнивания, переключатель «Чётче речь» и список сайтов, где оно выключено. Настройки лежат в `storage.sync` браузера. Если в браузере включена синхронизация, браузер переносит их между вашими устройствами через ваш аккаунт браузера, у автора расширения доступа к ним нет.
- Скрипт на странице читает её адрес только для переключателя «На этом сайте».

Contact: https://github.com/olerast67/steady-volume/issues
