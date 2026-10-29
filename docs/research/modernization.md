# fastify-tma: исследование и согласованный план модернизации

Дата исследования: 29 октября 2026 года. Исходная точка: `d91820f65619608dcb218e57f11d27de794e5dbf`.

Документ разделяет факты исходного проекта, проверенные свойства опубликованных пакетов и согласованный контракт будущей версии. Реализация не выполнена: исходники, зависимости, конфигурация и тесты проекта не изменены. Разрешённый результат этой работы — только данный документ. Номер будущей версии не выбран; публикация сейчас не требуется.

## Цель и границы

Подготовить проект к публичному npm-релизу: обновить совместимый инструментарий, реализовать согласованный API авторизации, добавить содержательные проверки и провести финальное review. Breaking changes допустимы. Плагин должен выполнять HMAC-проверку Telegram init data, разбирать подтверждённые данные, прикреплять их к запросу и предоставлять готовый Fastify hook.

Поддерживаются Fastify 5 и LTS-ветки Node.js 22, 24, 26. Пакет выпускается только как ESM. CommonJS, Ed25519/third-party validation, отдельные низкоуровневые helpers, пользовательские имена декораторов, сессии и replay storage в объём не входят. Обычная регистрация Fastify hook определяет, какие маршруты защищены.

## Согласованный публичный контракт

Все положения этого раздела — требования к будущей реализации, а не описание текущего кода.

| Область | Согласованное поведение |
| --- | --- |
| Регистрация | Обязательный непустой строковый `botToken`; необязательный `expiresIn`. Неверные options приводят к ошибке регистрации, а не к request-time 401. |
| TTL | `expiresIn` — положительное целое конечное число секунд, default `3600`. Значения `0`, отрицательные, дробные, `NaN`, `Infinity` и значения другого типа недопустимы. |
| API | Готовый **асинхронный** hook `fastify.tmaAuth` и фиксированное поле `request.tmaInitData`. `request.tmaValidate`, `fastify.tma.validate` и `decoratorName` удаляются. |
| Подключение защиты | Приложение использует `onRequest: fastify.tmaAuth` либо регистрирует hook в нужной Fastify scope. Плагин не включает авторизацию всех маршрутов автоматически. |
| Транспорт | Только заголовок `Authorization: tma <rawInitData>` с одним непустым credential. Cookie, query/body fallback и альтернативные схемы отсутствуют. |
| HTTP-семантика | Имя authentication scheme `tma` сравнивается без учёта регистра по RFC 9110. При 401 возвращается `WWW-Authenticate: tma`.[32] |
| Проверка подписи | Только HMAC с `botToken`; проверяется исходная строка данных. Мутации параметров до проверки подписи недопустимы. |
| Данные | Нативные snake_case-поля SDK: `auth_date`, `query_id`, `user.first_name` и другие. `auth_date` остаётся объектом `Date`. |
| Пользователь | `user` необязателен. Требование наличия `user.id` относится к приложению; отсутствие `user` само по себе не является отказом авторизации. Присутствующий некорректный `user` отклоняется парсером. |
| Legacy init data | Корректный HMAC без поля `signature` принимается. Только после проверки оригинала допустимо добавить `signature: ''` в копию параметров для совместимости с parser schema. |
| Дата | `auth_date` обязателен и представляет целое число Unix-секунд. Дробные, пустые, нечисловые значения и числовой префикс с мусором отклоняются. |
| Будущее время | Дата создания может опережать серверное время максимум на **60 секунд включительно**. |
| Повторяющиеся параметры | Дубликаты любых query keys запрещены, в том числе неизвестных полей, `hash`, `signature` и `auth_date`. |
| Ошибки авторизации | Все ожидаемые отказы: HTTP **401**, единый code `FST_ERR_TMA_UNAUTHORIZED`, общее сообщение клиенту. Исходная причина доступна приложению через `cause`, но не раскрывается в JSON-ответе. |
| Состояние request | В scope зарегистрированного плагина до авторизации поле равно `null`; успешный hook прикрепляет данные. Перед каждой проверкой поле очищается, после неудачной повторной проверки старых доверенных данных нет. |
| Stateless | Повторное использование корректных данных внутри TTL допускается. Хранилище использованных подписей и защита от replay не добавляются. |
| Выпуск | Plain `tsc`, ESM JavaScript и `.d.ts`; публикация root-пакета с exports в `dist`. Перед релизом проверяется установленный packed ESM consumer. |

Для серверного времени `now`, Unix-времени `issuedAt` и TTL в секундах допустимый временной интервал:

```text
now - expiresIn * 1000 <= issuedAt * 1000 <= now + 60_000
```

Обе границы включительны. Следовательно, при default TTL возраст ровно 3600 секунд допустим, больше 3600 — нет; смещение ровно +60 секунд допустимо, +61 — нет. Неоднозначный или неразбираемый timestamp не должен попадать в эту арифметику.

## Что есть в исходном HEAD

В [package.json](../../package.json) версия проекта — `0.0.3`, root отмечен `private: true`, пакет имеет TypeScript entry point для SmartBundle. Runtime-зависимости: `@fastify/error`, `@telegram-apps/init-data-node`, `fastify-plugin`. Fastify 5.1.0 установлен для разработки, но peer dependency Fastify отсутствует. [Единственный тест](../../test/index.test.ts) проверяет `1 === 1`.

[Плагин](../../src/plugin.ts) предоставляет `request.tmaValidate()` и `fastify.tma.validate`, использует фиксированный TTL 3600 и camelCase-парсер прежнего SDK. Имя request-декоратора настраивается через `decoratorName`. Эти свойства описывают старый API; сохранять их совместимость не требуется.

### Code review исходного кода

P1 — устранить до нового релиза; P2 — включить в подготовку релиза. Findings основаны на чтении указанного HEAD, а не на ещё не созданных регрессионных тестах.

| Приоритет | Свидетельство | Последствие и действие в новом контракте |
| --- | --- | --- |
| P1 | [plugin.ts](../../src/plugin.ts): `decoratorName` учитывается при объявлении, но результат всегда записывается в `this.tmaInitData`. | Пользовательское поле остаётся `null`. В новой версии саму опцию удалить; исправление совместимости старого custom decorator не требуется. |
| P1 | [errors.ts](../../src/errors.ts): ошибки авторизации созданы без HTTP-статуса. | Ожидаемый отказ получает 500. Заменить старые auth errors на единый 401/code; старые error codes не сохранять.[8] |
| P1 | [plugin.ts](../../src/plugin.ts): предыдущие данные не очищаются перед повторной проверкой. | Если приложение перехватило исключение второй проверки, request сохраняет старую авторизацию. Новый hook должен очищать фиксированное поле перед работой. |
| P1 | [README](../../README.md) и [playground](../../playground/index.js): `req => req.tmaValidate()` не возвращает Promise и не вызывает `done`. | Успешный запрос не продолжает Fastify lifecycle. Готовый async hook заменяет такой способ подключения.[24] |
| P2 | [plugin.ts](../../src/plugin.ts): `split(' ')` игнорирует части после второго токена. | `tma <valid-data> extra` принимается вопреки формату. Новый parser заголовка должен отклонять лишние credentials; само по себе это не обход HMAC. |
| P2 | [CI workflow](../../.github/workflows/ci.yml): матрица называется `node`, но setup action читает `matrix.node-version`. | Задуманная версия Node не передаётся. Согласовать имя и проверять LTS 22/24/26. |
| P2 | [playground/package.json](../../playground/package.json): используется `fastify start`, но `fastify-cli` отсутствует; pretty-режим не имеет явного `pino-pretty`. | Запуск зависит от внешнего окружения. Объявить необходимые CLI-зависимости и проверить документированную команду. |
| P2 | [Playground](../../playground/package.json) ссылается на `fastify-tma: latest`; root использует `resolutions`. | Нет явной гарантии проверки локальной библиотеки. Заменить на `workspace:*`, использующий root exports после сборки. |
| P2 | [package.json](../../package.json) не объявляет Fastify peer; [тест](../../test/index.test.ts) не проверяет ни поведение, ни собранный пакет. | Объявить Fastify 5 peer, добавить HMAC integration, typecheck и отдельный packed ESM consumer. |

Политики будущего времени, строгого целого timestamp и запрета всех duplicate keys — согласованные дополнительные требования. Отсутствие этих политик не следует смешивать с обнаруженным обходом подписи. Отдельных содержательных нарушений документированного coding standard не выявлено; форматирование оставляется ESLint/EditorConfig.

## Проверенные факты опубликованного SDK

`@telegram-apps/init-data-node` latest 2.0.10 помечен deprecated с прямым указанием использовать `@tma.js/init-data-node`. У замены опубликована версия **2.0.8**. API ниже проверен по tarball 2.0.8 и его декларациям.[6][9][25]

```text
validate(value: string | URLSearchParams, token: Text, options?: ValidateOptions): void
parse(value: string | URLSearchParams): parsed snake_case init data
```

Корневой Node entry выполняет `validate` синхронно и не возвращает parsed data. Для будущего async hook это внутренняя операция; публичный hook всё равно должен завершаться Promise. `parse` вызывается отдельно после проверки HMAC.[25]

- `ValidateOptions` содержит `expiresIn?: number` и `tokenHashed?: boolean`; последний не становится публичной опцией плагина.[25]
- Default upstream TTL равен 86400 секундам; `expiresIn: 0` отключает expiry check. Плагин должен явно передавать согласованный TTL и самостоятельно отклонять недопустимые options.[25]
- Expiry check отклоняет `auth_date + expiresIn < Date.now()`, то есть граница включительна.[25]
- HMAC validator использует `parseInt` для `auth_date`, не вводит лимит +60 секунд и не запрещает все duplicate keys. Эти проверки нужны на границе плагина.[25]
- Отсутствующий/пустой `hash`, неверная дата, истечение и несовпадение HMAC представлены отдельными upstream errors. Публичный API плагина сводит ожидаемые отказы к единому 401.[25]
- Структурный parser проверяет JSON и поля `user`/`chat`; корректная HMAC-подпись не гарантирует допустимую структуру. Известные duplicate поля parser может отклонить как массивы, но это не общая политика запрета дубликатов.[28]
- `parse` принимает один аргумент, возвращает snake_case и `auth_date: Date`. Опции `parse(data, true)` нет; camelCase-адаптер новому контракту не нужен.[25]
- Parser schema требует `signature: string`, хотя HMAC validator не требует этот параметр. Поэтому legacy-адаптация должна происходить после проверки неизменённой строки.[25][28]
- `user` опционален; присутствующий объект должен соответствовать SDK schema. Отсутствие поля и объект `{}` — разные случаи.[28]

Страница документации `packages/tma-js-init-data-node/validating` на дату исследования показывает примеры другого `@tma.js/init-data` с async `validate` и `safeValidate`. Они расходятся с реально опубликованным 2.0.8; реализацию следует сверять с фиксированным пакетом, а не переносить эти примеры напрямую.[26]

Telegram предписывает отправлять серверу исходную строку `Telegram.WebApp.initData`, проверять HMAC-SHA-256 и учитывать `auth_date`. `initDataUnsafe` не является подтверждённой авторизацией.[27]

## Зависимости и runtime/dev ограничения

Версии получены из npm Registry 29 октября 2026 года; таблица не означает, что они уже установлены в проекте. Перед реализацией и публикацией требуется повторная проверка metadata и lockfile.

| Пакет | Исходный проект | Проверенный кандидат / вывод |
| --- | --- | --- |
| `fastify` | 5.1.0 | 5.12.7; оставаться на major 5, объявить peer `^5.0.0`.[10] |
| `fastify-plugin` | 5.0.1 | 6.0.1; опубликованный проект тестируется с Fastify 5.[11] |
| `@fastify/error` | ^4.0.0 | 4.2.1 для собственных ошибок.[8] |
| `@telegram-apps/init-data-node` | ^1.1.1 | Удалить deprecated namespace; latest 2.0.10.[9] |
| `@tma.js/init-data-node` | отсутствует | 2.0.8; нативные типы и parser.[6] |
| `@tma.js/toolkit` | отсутствует | Прямая зависимость для адаптера не нужна; прежний SDK использует другой пакет `@telegram-apps/toolkit`.[7] |
| `typescript` | 5.6.3 | 6.0.3; latest 7.0.2 не входит в peer диапазон текущего typescript-eslint.[2][3] |
| `vitest` | ^2.1.5 | 5.0.5; отказ от SmartBundle устраняет прежнее ограничение peer на Vitest 3/4.[12][33] |
| `@vitest/coverage-v8` | отсутствует | При использовании coverage выбирать 5.0.5, совпадающий с Vitest.[34] |
| `eslint` / Antfu | ^9.14.0 / ^3.9.2 | 10.13.0 / 10.0.0, с учётом dev Node.[1][5] |
| `@types/node` | ^20.17.6 | Ветка 22: 22.20.5; latest 26.6.6 не должна разрешать случайное использование Node 26-only API.[13] |
| `bumpp` | ^9.8.1 | 12.3.0; dev engines ^22.18.0 / ^24.11.0 / >=26.[14] |
| `lefthook` / pnpm | 1.8.2 / 9.13.1 | 2.2.2 / 12.16.1; проверить lifecycle и воспроизводимость установки.[15][16] |

Runtime библиотеки — согласованные Node 22/24/26; ограничивать его patch-версией, нужной только линтеру, нельзя. Fastify 5 документирует технический минимум Node 20, но Node 20 завершил поддержку 2026-04-30 и не входит в выбранный runtime scope.[20][21][22]

Для разработки с Antfu 10 рекомендуется **Node 24.15+ либо Node 26**: его обязательный eslint-plugin-jsdoc требует `^22.22.2 || >=24.15.0`. Другие новые ESLint-плагины также повышают dev minimum. Эти ограничения относятся к инструментам, а не автоматически к production-коду.[17][18][19]

Vitest 5.0.5 объявляет Node `^22.12.0 || ^24.0.0 || >=26.0.0`, обязательный Vite peer `^6.4.0 || ^7.0.0 || ^8.0.0`, а TypeScript peer не объявляет. TypeScript 6.0.3 входит в диапазон typescript-eslint `>=4.8.4 <6.1.0`. Следовательно, выбор Vitest 5 и TS 6 обоснован metadata, но требует проверки реальным набором зависимостей.[2][33]

На дату исследования официальный индекс содержит Node 26.13.0 LTS; окончания поддержки веток: 22 — 2027-04-30, 24 — 2028-04-30, 26 — 2029-04-30. CI должен использовать актуальные patch-релизы выбранных LTS.[20][21]

## Сборка, упаковка и playground

Согласованный вариант — обычный `tsc`: `module` и `moduleResolution` = `NodeNext`, `target: ES2022`, `rootDir: src`, `outDir: dist`, `declaration: true`. Отдельная build-конфигурация включает production source, а тесты проверяются без emit.[35]

В исходных относительных import/export specifiers нужны расширения `.js`: TypeScript разрешает их в соответствующие `.ts`, а emitted JavaScript остаётся исполнимым Node ESM. Декларации Fastify augmentation должны быть достижимы из публичного `.d.ts` entry; одной декларации в исключённом из build файле недостаточно.[35][36]

Root package становится публикуемым: убрать `private: true`, оставить `type: module`, задать `files: ["dist"]`, направить root exports на `dist/index.js` и `dist/index.d.ts` через условия `import` и `types`. Заявить Fastify 5 peer, production dependencies и обоснованный runtime engines; сохранить license/repository metadata. CommonJS entry и `require` condition не добавляются.[37][38]

`prepack` должен собирать пакет перед упаковкой; публикуется root package, а не отдельный SmartBundle-generated package. `files` ограничивает содержимое tarball; README/LICENSE включаются по правилам npm. Playground использует `fastify-tma: workspace:*`, поэтому обращается к локальным root exports и запускается после build.[38][39]

SmartBundle 0.17.0 рассмотрен и исключён из согласованного плана: опубликованный код жёстко создаёт ESM+CJS, обе группы деклараций и отдельный package metadata; ESM-only переключателя CLI нет. Поэтому его compiler-bridge и peer Vitest 3/4 больше не ограничивают проект.[4][29][30]

## Миграция API

| Старый API / поведение | Новый согласованный контракт |
| --- | --- |
| `request.tmaValidate()` в пользовательском hook | Готовый async `fastify.tmaAuth`, подключаемый приложением. |
| `fastify.tma.validate` | Удаляется; низкоуровневые helpers не экспортируются. |
| `decoratorName` | Удаляется; только `request.tmaInitData`. |
| camelCase, например `authDate`, `user.firstName` | snake_case `auth_date: Date`, `user.first_name`. |
| TTL захардкожен внутри request validator | Options `expiresIn`, default 3600, только положительное целое. |
| Разные auth error codes без явного статуса | 401 / `FST_ERR_TMA_UNAUTHORIZED`, generic message, `cause`, challenge header. |
| Неявные временные/duplicate политики SDK | Явные +60 секунд и запрет всех duplicate keys. |
| SmartBundle / публикация dist-пакета | `tsc`, root publish, ESM + `.d.ts`. |
| Непроверенная совместимость форматов | Только ESM; CommonJS не обещается и не тестируется. |

README будущей версии должен объяснять эти breaking changes и показывать реальную защиту маршрута. Номер релиза выбирается отдельно перед публикацией.

## Предлагаемые проверки и критерии приёмки

Это будущие проверки; документ не заявляет существующее количество тестов, процент покрытия или нулевой audit.

- Реальные Fastify registration/inject tests с HMAC, рассчитанным независимо от production validator; закрытие приложений после тестов.[31]
- Готовый `tmaAuth` работает как route hook и scope hook; публичный маршрут остаётся доступен, дочерние и соседние scopes соблюдают Fastify encapsulation.[23][24]
- Bot token обязателен; неверный тип/пустое значение и недопустимые `expiresIn` отклоняются при регистрации. Options errors не маскируются как 401.
- Валидная HMAC с user и без user; `auth_date instanceof Date`, snake_case nested fields. Присутствующий `{}`/malformed JSON/wrong shape user получает 401.
- Изменённое поле после подписи, другой bot token, пустой/отсутствующий hash, неполные данные: единый 401/code/message/challenge. В клиентском JSON нет `cause` или секретов; обработчик приложения видит причину.
- Legacy без signature проходит при правильном HMAC; существующий signature участвует в проверке оригинала. Нормализация отсутствующего поля не меняет проверяемую строку.
- Header missing/empty/другая схема/лишние credentials отклоняются; `tma` и `TMA` эквивалентны. Query/body/cookie не становятся fallback.
- TTL default: возраст 3599 / **3600** / 3601 секунд → pass / pass / fail. При пользовательском TTL `N` проверяются ровно `N` и превышение; часы контролируются.
- Future clock skew: +59 / **+60** / +61 секунд → pass / pass / fail. Проверяются миллисекундные границы и отсутствие округления, продлевающего интервал.
- Timestamp: дробь, мусор после числа, пустое значение, NaN/Infinity отклоняются. Дубликаты известных и неизвестных ключей отвергаются даже с корректно рассчитанным HMAC.
- До hook данные `null`; после успешного вызова прикреплены; после неудачной повторной проверки очищены. Параллельные request не разделяют объект данных.
- Повтор той же корректной строки внутри TTL проходит: это согласованное stateless-поведение. После истечения TTL она отклоняется.
- Typecheck публичных options, async hook, Fastify augmentation и нативных optional user/snake_case/Date; примеры старых удалённых API больше не предлагаются.
- `pack` → установка tarball в отдельный ESM consumer → import, успешный/ошибочный HTTP request и проверка деклараций NodeNext. Consumer не должен зависеть от исходников или workspace symlinks.
- Воспроизводимая установка и CI на Node 22/24/26; поведенческое покрытие согласованных ветвей. Числовая цель coverage заранее не обещается.

## Этапный план

| Этап | Работа | Завершённость этапа определяется так |
| --- | --- | --- |
| 1. API и тестовый контракт | Зафиксировать options/types/errors, публичный hook и acceptance fixtures. | Все требования выше сопоставлены с проверками; удаляемые API и новый формат отражены в migration notes. |
| 2. Граница авторизации | HMAC original → строгие timestamp/duplicates/TTL/future → parse/legacy normalization → attach; async hook и единые 401. | Проходят позитивные/негативные сценарии, временные границы, статeless replay и очистка при revalidation. |
| 3. Зависимости и ESM выпуск | Обновить согласованный стек, удалить SmartBundle, добавить tsc build/prepack/root exports и Fastify peer. | Чистая установка и build воспроизводимы; установленный packed ESM consumer и typecheck проходят. |
| 4. Примеры и CI | Переписать README, связать playground через workspace, исправить matrix и проверить LTS. | Документированные команды запускают локальный build; CI проверяет заявленные Node и поведение. |
| 5. Release review | Standards/Spec review, аудит итогового lockfile, осмотр tarball, выбор release version. | Нет неразобранных блокеров; фактические проверки и оставшиеся ограничения записаны. Публикация требует отдельного действия. |

При обновлении нужно проверить транзитивные development-зависимости и advisory, а не переносить overrides заранее. Для tar/KaTeX известны [tar advisory](https://github.com/advisories/GHSA-r292-9mhp-454m) и [KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7). Обновления upstream предпочтительны; исключения требуют подтверждения цепочки и API-совместимости. Состояние будущего audit пока неизвестно.

## Первичные источники

1. [ESLint registry](https://registry.npmjs.org/eslint) — опубликованные версии и engines.
2. [typescript-eslint parser metadata](https://registry.npmjs.org/@typescript-eslint%2fparser/8.72.1) — TypeScript peer range.
3. [TypeScript registry](https://registry.npmjs.org/typescript) — версии 6.0.3 и 7.0.2.
4. [SmartBundle 0.17.0 README/metadata](https://registry.npmjs.org/smartbundle/0.17.0) — рассмотренный прежний инструмент.
5. [Antfu config registry](https://registry.npmjs.org/@antfu%2feslint-config) — dependencies/peers.
6. [init-data-node 2.0.8 metadata](https://registry.npmjs.org/@tma.js%2finit-data-node/2.0.8) и [tarball](https://registry.npmjs.org/@tma.js/init-data-node/-/init-data-node-2.0.8.tgz).
7. [@tma.js/toolkit metadata](https://registry.npmjs.org/@tma.js%2ftoolkit/1.0.4) — отдельный пакет, прямой адаптер не требуется.
8. [@fastify/error registry](https://registry.npmjs.org/@fastify%2ferror) и [README](https://github.com/fastify/fastify-error).
9. [Deprecated SDK metadata](https://registry.npmjs.org/@telegram-apps%2finit-data-node/latest).
10. [Fastify registry](https://registry.npmjs.org/fastify).
11. [fastify-plugin 6.0.1 package.json](https://github.com/fastify/fastify-plugin/blob/v6.0.1/package.json) и [README](https://github.com/fastify/fastify-plugin/blob/v6.0.1/README.md).
12. [Vitest registry](https://registry.npmjs.org/vitest).
13. [Node type definitions registry](https://registry.npmjs.org/@types%2fnode).
14. [bumpp registry](https://registry.npmjs.org/bumpp).
15. [lefthook registry](https://registry.npmjs.org/lefthook).
16. [pnpm registry](https://registry.npmjs.org/pnpm).
17. [eslint-plugin-jsdoc engines](https://registry.npmjs.org/eslint-plugin-jsdoc/65.4.1).
18. [eslint-plugin-n engines](https://registry.npmjs.org/eslint-plugin-n/18.5.0).
19. [@eslint/markdown engines](https://registry.npmjs.org/@eslint%2fmarkdown/8.0.3).
20. [Node.js официальный индекс релизов](https://nodejs.org/dist/index.json).
21. [Node Release Working Group schedule](https://github.com/nodejs/Release/blob/main/schedule.json).
22. [Fastify V5 Migration Guide](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/).
23. [Fastify Decorators](https://fastify.dev/docs/latest/Reference/Decorators/).
24. [Fastify Hooks](https://fastify.dev/docs/latest/Reference/Hooks/).
25. Tarball из источника 6: `dist/entries/node.d.ts`, `dist/parsing.d.ts`, `dist/validation.d.ts`, `dist/errors.d.ts`, `dist/entries/parsing-Cn-1lfce.js`.
26. [SDK validating docs](https://docs.telegram-mini-apps.com/packages/tma-js-init-data-node/validating) — зафиксировано расхождение с опубликованным API.
27. [Telegram: validating Mini App data](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
28. [Transformers 1.2.0 metadata](https://registry.npmjs.org/@tma.js%2ftransformers/1.2.0) и [tarball](https://registry.npmjs.org/@tma.js/transformers/-/transformers-1.2.0.tgz).
29. [SmartBundle package metadata guide](https://github.com/xavescor/smartbundle/blob/v0.17.0/docs/package-json.md) — прежний вариант сборки.
30. [SmartBundle TypeScript guide](https://github.com/xavescor/smartbundle/blob/v0.17.0/docs/ts-guide.md) и [tarball 0.17.0](https://registry.npmjs.org/smartbundle/-/smartbundle-0.17.0.tgz) — dual output, ESM-only CLI отсутствует.
31. [Fastify Testing](https://fastify.dev/docs/latest/Guides/Testing/).
32. [RFC 9110 §11.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-11.1), [§11.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-11.3), [§15.5.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.2) — scheme case и challenge при 401.
33. [Vitest 5.0.5 metadata](https://registry.npmjs.org/vitest/5.0.5) — Node/Vite peers.
34. [Coverage V8 5.0.5 metadata](https://registry.npmjs.org/@vitest%2fcoverage-v8/5.0.5) — matching Vitest peer.
35. [TypeScript modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html) и [declaration emit](https://www.typescriptlang.org/tsconfig/declaration.html).
36. [Node ESM: mandatory file extensions](https://nodejs.org/docs/latest-v22.x/api/esm.html#mandatory-file-extensions).
37. [Node package exports](https://nodejs.org/docs/latest-v22.x/api/packages.html#package-entry-points).
38. [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json) и [lifecycle scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts).
39. [pnpm workspace protocol](https://pnpm.io/workspaces).
