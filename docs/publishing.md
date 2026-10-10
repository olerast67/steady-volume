# Публикация в магазинах

Архив для всех магазинов собирает `npm run build`, он появляется в `dist/steady-volume-<версия>.zip`. Перед каждой публикацией я поднимаю `version` в `src/manifest.json` и `package.json` и ставлю тег `v<версия>`.

| Магазин | Стоимость | Что известно о проверке | Кто получает расширение |
|---|---|---|---|
| Chrome Web Store | $5 один раз | От нескольких дней до недель, широкий доступ к сайтам удлиняет проверку | Chrome, Brave, Яндекс Браузер, Opera через дополнение «Install Chrome Extensions» |
| Microsoft Edge Add-ons | бесплатно | До 7 рабочих дней | Edge |
| addons.mozilla.org (AMO) | бесплатно | Автоматическая подпись обычно в течение суток, ручная проверка может занять дольше | Firefox на компьютере и Android |
| Opera add-ons | бесплатно | На форуме разработчиков жалуются на ожидание в недели | Opera, Яндекс Браузер |

Сведения в таблице я собрал в октябре 2026 года по документации магазинов и форумам разработчиков. Оплату взноса Chrome Web Store российской картой я не проверял, на Хабре пишут, что она не проходит.

## Chrome Web Store

1. Регистрация на https://chrome.google.com/webstore/devconsole и оплата взноса.
2. «New item» → архив из `dist/`.
3. Store listing: тексты из раздела «Тексты для магазинов», категория Tools, языки English и Русский, иконка `docs/icon-512.png` (магазин просит 128×128, её можно взять из `src/icons/icon-128.png`), минимум один скриншот 1280×800 или 640×400.
4. Privacy practices: single purpose и обоснования разрешений из раздела ниже, на вопрос о сборе данных отвечать «не собирает», Privacy policy URL указывает на `PRIVACY.md` в репозитории.

## Microsoft Edge Add-ons

Регистрация на https://partner.microsoft.com/dashboard/microsoftedge, вход через аккаунт Microsoft или GitHub. Тексты и разрешения те же, что для Chrome.

## Firefox (AMO)

1. Аккаунт на https://addons.mozilla.org/developers/.
2. Для публикации в каталоге: «Submit a New Add-on» → «On this site» → архив из `dist/`. AMO может попросить исходный код, если он собран инструментами; здесь код в архиве совпадает с исходниками, сборки нет.
3. Для подписанного `.xpi` на GitHub без каталога: в кабинете AMO «Manage API Keys» выдаёт JWT issuer и JWT secret. Я кладу их в секреты репозитория `AMO_JWT_ISSUER` и `AMO_JWT_SECRET`, после этого workflow `release.yml` подписывает `.xpi` при каждом теге.

В манифесте уже есть всё, что AMO требует для новых расширений с ноября 2025: `browser_specific_settings.gecko.id` и `data_collection_permissions` со значением `none`.

## Тексты для магазинов

### Название

- English: Steady Volume: booster and leveler
- Русский: Ровный звук: усилитель и выравниватель громкости

### Краткое описание (до 132 символов)

- English: Boosts quiet videos up to 600% and evens out loudness: louder dialog, quieter explosions. Works on any site.
- Русский: Усиливает тихие видео до 600% и выравнивает громкость: диалоги громче, взрывы тише. Работает на любом сайте.

### Полное описание, English

```
Steady Volume raises quiet video and audio on websites and evens out the difference between quiet and loud scenes. Dialog in films becomes louder, explosions and music become quieter, and you stop reaching for the volume.

Settings:
- Volume from 100% to 600%. A limiter keeps the boosted sound from distorting.
- Leveling: Off, Light, Medium or Strong. Medium suits films and series, Strong is for night time.
- Clearer speech: less low rumble, more voice presence.
- A switch to turn the extension off on a particular site.

Works with <video> and <audio> on any site, including embedded players.

Does not work with DRM-protected video (Netflix and other paid streaming services): the browser does not let extensions process their sound. Calls and voice chats are left untouched.

The extension collects no data and makes no network requests. Source code (MIT): https://github.com/Erop404iv/steady-volume
```

### Полное описание, русский

```
Ровный звук поднимает громкость тихих видео и аудио на сайтах и выравнивает разницу между тихими и громкими сценами. Диалоги в фильмах становятся громче, взрывы и музыка тише.

Настройки:
- Громкость от 100% до 600%. Лимитер не даёт усиленному звуку хрипеть.
- Выравнивание: выкл, мягко, средне или сильно. Средний режим подходит для фильмов и сериалов, сильный для ночного просмотра.
- «Чётче речь»: меньше низкого гула, голос выходит вперёд.
- Переключатель, который выключает расширение на конкретном сайте.

Работает с <video> и <audio> на любом сайте, в том числе во встроенных плеерах.

Не работает с видео под защитой DRM (Netflix и другие платные онлайн-кинотеатры): браузер не даёт расширениям обрабатывать их звук. Звонки и голосовые чаты расширение не трогает.

Расширение не собирает данные и не делает сетевых запросов. Исходный код (MIT): https://github.com/Erop404iv/steady-volume
```

## Обоснования разрешений

Single purpose: Boosts and levels the volume of video and audio played on web pages.

| Разрешение | Текст для формы |
|---|---|
| `storage` | Stores the user's settings: volume level, leveling mode, the Clearer speech switch and the list of sites where the extension is turned off. |
| `activeTab` | When the user opens the popup, it reads the address of the current tab to show and change the "On this site" switch for that site. |
| Host access `<all_urls>` (content script) | Video and audio players appear on any website and inside embedded players from other domains. The content script finds playing <video> and <audio> elements on the page and routes their sound through the volume processing. It does not read page content, does not modify the page and sends nothing anywhere. |
| Remote code | No. All code is in the package. |
| Data collection | None. |
