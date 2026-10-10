# Contributing / Как помочь проекту

## Reporting a site / Сайт, где не работает

Open an issue with the "Site not working" template. It asks for the page address, the browser and the text from the bottom of the popup while the video plays.

Откройте issue по шаблону «Не работает на сайте». В нём нужны адрес страницы, браузер и текст из нижней части окна расширения во время воспроизведения.

## Translations / Переводы

All languages except English and Russian live in `scripts/locales.py`. Edit the strings there and run `python scripts/locales.py`: it writes `src/_locales/<lang>/messages.json` and checks keys, `$1`/`$2` placeholders and the store limits (name up to 75 characters, description up to 132). English and Russian are edited directly in `src/_locales/en` and `src/_locales/ru`.

Все языки, кроме английского и русского, лежат в `scripts/locales.py`. Поправьте строки и запустите `python scripts/locales.py`: скрипт пишет `src/_locales/<язык>/messages.json` и проверяет ключи, подстановки `$1`/`$2` и ограничения магазинов (название до 75 символов, описание до 132). Английский и русский правятся прямо в `src/_locales/en` и `src/_locales/ru`.

## Code / Код

```bash
npm install
npm run lint                 # builds build/chromium and build/firefox, lints the Firefox one
node test/make-movie.mjs     # test sound file
node test/e2e.mjs msedge     # Chromium end-to-end test (or chrome, chromium)
node test/e2e-capture.mjs msedge
node test/e2e-firefox.mjs    # after npm run lint
```

The audio chain is in `src/engine.js`, page logic in `src/content.js`, CORS rules and tab capture in `src/background.js`. A pull request should keep `npm run lint` and the three end-to-end tests passing.

Цепочка обработки звука лежит в `src/engine.js`, работа со страницей в `src/content.js`, правила CORS и захват вкладки в `src/background.js`. Pull request должен проходить `npm run lint` и три сквозных теста.
