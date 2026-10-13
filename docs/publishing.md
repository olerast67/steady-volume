# Публикация в магазинах

Архивы собирает `npm run build`: `dist/steady-volume-<версия>-chromium.zip` для Chrome Web Store, Edge Add-ons и Opera, `dist/steady-volume-<версия>-firefox.zip` для addons.mozilla.org. Перед каждой публикацией я поднимаю `version` в `src/manifest.json` и `package.json` и ставлю тег `v<версия>`.

| Магазин | Статус |
|---|---|
| addons.mozilla.org | Версия 1.2.1 одобрена 13 октября 2026, [страница в каталоге](https://addons.mozilla.org/firefox/addon/steady-volume/) |
| Edge Add-ons | не отправлено |
| Opera add-ons | не отправлено |
| Chrome Web Store | не отправлено |

| Магазин | Стоимость | Что известно о проверке | Кто получает расширение |
|---|---|---|---|
| Chrome Web Store | $5 один раз | От нескольких дней до недель, широкий доступ к сайтам удлиняет проверку | Chrome, Brave, Яндекс Браузер, Opera через дополнение «Install Chrome Extensions» |
| Microsoft Edge Add-ons | бесплатно | До 7 рабочих дней | Edge |
| addons.mozilla.org (AMO) | бесплатно | Автоматическая подпись обычно в течение суток, ручная проверка может занять дольше | Firefox на компьютере и Android |
| Opera add-ons | бесплатно | На форуме разработчиков жалуются на ожидание в недели | Opera, Яндекс Браузер |

Сведения в таблице я собрал в октябре 2026 года по документации магазинов и форумам разработчиков. Оплату взноса Chrome Web Store российской картой я не проверял, на Хабре пишут, что она не проходит.

## Chrome Web Store

1. Регистрация на https://chrome.google.com/webstore/devconsole и оплата взноса.
2. «New item» → `steady-volume-<версия>-chromium.zip`.
3. Store listing: тексты из раздела «Тексты для магазинов», категория Tools, языки English и Русский, иконка `docs/icon-512.png` (магазин просит 128×128, её можно взять из `src/icons/icon-128.png`), минимум один скриншот 1280×800 или 640×400.
4. Privacy practices: single purpose и обоснования разрешений из раздела ниже, на вопрос о сборе данных отвечать «не собирает», Privacy policy URL указывает на `PRIVACY.md` в репозитории.

## Microsoft Edge Add-ons

Регистрация на https://partner.microsoft.com/dashboard/microsoftedge, вход через аккаунт Microsoft или GitHub. Тексты и разрешения те же, что для Chrome.

## Firefox (AMO)

1. Аккаунт на https://addons.mozilla.org/developers/.
2. Для публикации в каталоге: «Submit a New Add-on» → «On this site» → `steady-volume-<версия>-firefox.zip`. AMO может попросить исходный код, если он собран инструментами; здесь код в архиве совпадает с исходниками, сборки нет.
3. Новые версии можно отправлять из GitHub Actions. В кабинете AMO «Tools → Manage API Keys» выдаёт JWT issuer и JWT secret. Я кладу их в секреты репозитория `AMO_JWT_ISSUER` и `AMO_JWT_SECRET`, после этого workflow `release.yml` при каждом теге отправляет новую версию в каталог и не ждёт окончания проверки.

В манифесте уже есть всё, что AMO требует для новых расширений с ноября 2025: `browser_specific_settings.gecko.id` и `data_collection_permissions` со значением `none`.

## Языки

Название и краткое описание расширения переведены на 18 языков в `src/_locales`. Chrome Web Store, Edge Add-ons и AMO сами показывают их пользователям с этим языком браузера и ищут по ним. Полное описание в кабинете магазина можно оставить английским и русским: для остальных языков магазин покажет английское.

## Тексты для магазинов

### Название

- English: Steady Volume: booster and leveler
- Русский: Ровный звук: усилитель и выравниватель громкости

### Краткое описание (до 132 символов)

- English: Boosts quiet videos up to 600% and evens out loudness: louder dialog, quieter explosions. Works on any site.
- Русский: Усиливает тихие видео до 600% и выравнивает громкость: диалоги громче, взрывы тише. Работает на любом сайте.

### Полное описание, English

Магазины ищут по названию и описанию, поэтому в описании стоят слова, по которым ищут такие расширения: volume booster, loudness, normalizer, compressor, limiter.

```
Steady Volume is a volume booster and loudness leveler for video and audio on websites. It raises quiet dialog in films and series, lowers explosions and loud music, and keeps the boosted sound from distorting with a limiter.

How to use: install, play a video. Auto mode is on by default, nothing needs setting up.

Settings:
- Volume boost from 100% to 600%.
- Leveling modes: Off, Light (music), Auto (films, series, YouTube), Night (quiet watching at night).
- Clearer speech: less low rumble, more voice presence.
- Fine-tuning for those who want it: target loudness, compressor threshold and ratio, limiter ceiling, gain recovery time.
- A switch to turn the extension off on a particular site.

Works with <video> and <audio> players on any site, including YouTube, HLS and DASH players, embedded players from other domains and players built as web components. When a video can't be connected directly, for example DRM-protected streaming, the extension processes the sound of the whole tab (open the popup or press Alt+Shift+V). Calls and voice chats are left untouched.

No data collection, no ads, no accounts. Source code (MIT): https://github.com/olerast67/steady-volume
```

Для AMO уберите из описания предложение про обработку звука всей вкладки: в Firefox её нет.

### Полное описание, русский

```
Ровный звук усиливает громкость видео и аудио на сайтах и выравнивает её. Тихие диалоги в фильмах и сериалах становятся громче, взрывы и громкая музыка тише, а лимитер не даёт усиленному звуку хрипеть. Усилитель звука, нормализатор громкости, компрессор и лимитер в одном расширении.

Как пользоваться: установите и включите видео. Режим «Авто» работает по умолчанию, настраивать ничего не нужно.

Настройки:
- Усиление громкости от 100% до 600%.
- Режимы выравнивания: выкл, мягко (музыка), авто (фильмы, сериалы, YouTube), ночь (тихий просмотр ночью).
- «Чётче речь»: меньше низкого гула, голос выходит вперёд.
- Тонкая настройка: целевая громкость, порог и степень сжатия компрессора, потолок лимитера, время возврата громкости.
- Переключатель, который выключает расширение на конкретном сайте.

Работает с плеерами на <video> и <audio> на любом сайте, в том числе на YouTube, в плеерах HLS и DASH, во встроенных плеерах с других доменов и в плеерах-веб-компонентах. Если к видео нельзя подключиться напрямую, например в онлайн-кинотеатре с защитой DRM, расширение обрабатывает звук всей вкладки (откройте окно расширения или нажмите Alt+Shift+V). Звонки и голосовые чаты расширение не трогает.

Без сбора данных, рекламы и аккаунтов. Исходный код (MIT): https://github.com/olerast67/steady-volume
```

## Обоснования разрешений

Single purpose: Boosts and levels the volume of video and audio played on web pages.

| Разрешение | Текст для формы |
|---|---|
| `storage` | Stores the user's settings: volume level, leveling mode, the Clearer speech switch and the list of sites where the extension is turned off. |
| `activeTab` | When the user opens the popup, it reads the address of the current tab to show and change the "On this site" switch for that site. |
| Host access `<all_urls>` | Video and audio players appear on any website and inside embedded players from other domains. The content script finds playing <video> and <audio> elements and routes their sound through the volume processing. Host access is also required for the declarativeNetRequest rule described below. The extension does not read page content and sends nothing anywhere. |
| `declarativeNetRequestWithHostAccess` | When a page plays a media file from another server, the browser lets Web Audio process its sound only if the response carries CORS headers. The extension adds a session rule that sets these headers for media requests between that one page host and that one media host, so the volume processing can work. No requests are blocked or redirected. |
| `tabCapture` | When a video cannot be connected directly (DRM-protected streaming, sites that use their own audio processing), the user opens the popup or presses the shortcut and the extension captures that tab's audio to level and boost it. The audio is played back to the user immediately and is never recorded or transmitted. |
| `offscreen` | The captured tab audio is processed in an offscreen document with the Web Audio API, because the service worker has no audio output. |
| Remote code | No. All code is in the package. |
| Data collection | None. |

## Скриншоты для магазинов

Первым скриншотом в магазине стоит `docs/store/store-real-youtube.png`: настоящее окно расширения поверх ролика на YouTube в Firefox, 1280×800. За ним идут `store-ru.png` или `store-en.png` с тонкой настройкой.

`python scripts/store-assets.py` после `node scripts/screenshots.mjs msedge` собирает из скриншотов окна расширения картинки 1280×800 для магазинов и превью репозитория 1280×640 в `docs/store/`.
