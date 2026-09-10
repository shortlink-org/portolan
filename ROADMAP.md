# Portolan roadmap

Этот документ собирает проблемы и идеи, обнаруженные при подключении реальных
репозиториев `aviaadmin`, `aviacore` и `aviasupp` через локальный UI Portolan.
Это материал для обсуждения, а не обещание реализовать всё перечисленное.

## Статусы

- **open** — проблема подтверждена, решения ещё нет.
- **patch ready** — локальный фикс и сфокусированные тесты уже есть, но изменение
  ещё не оформлено отдельным коммитом или PR.
- **investigate** — симптом подтверждён, но сначала нужно выбрать модель решения.
- **source quality** — Portolan корректно сообщает о недостатке в исходном
  проекте; можно улучшить диагностику или добавить явную конфигурацию.

## P0 — безопасный и ограниченный ввод

### PORTOLAN-1. Не передавать бинарные файлы как Base64 плагинам

**Status:** open; defensive patch ready

При чтении `aviacore` файл `tests/integration/resources/GeoLite2-Country.mmdb`
размером около 9.7 MiB попал в ответ git-плагина как Base64-строка размером
около 13 MiB. Проверка Base64 через regexp переполнила стек V8.

Локальный патч заменяет regexp на итеративную проверку и устраняет падение, но
это только защита последнего рубежа. Бинарный файл вообще не должен доходить до
экстракторов и занимать место в RPC/JSON payload.

Предлагаемое решение:

1. Определять бинарные файлы до чтения содержимого: известные расширения,
   наличие NUL в начальном блоке и, при необходимости, MIME/sniffing.
2. Не кодировать бинарники в Base64 по умолчанию.
3. Передавать плагину только метаданные пропущенного файла: путь, размер и
   причина пропуска, если плагину это действительно нужно.
4. Оставить итеративную Base64-валидацию как защиту для плагинов, которые
   намеренно возвращают бинарный артефакт.

**Done when:** `.mmdb`, изображения, архивы, исполняемые файлы и другие
бинарники не попадают в обычный extractor payload; тест с большим `.mmdb`
проходит без заметного роста памяти и без Base64 в запросе.

### PORTOLAN-2. Каждый экстрактор должен получать только релевантные файлы

**Status:** fixed locally; rendered UI verified

Сейчас подключение трёх проектов читает тысячи файлов, хотя каждому экстрактору
нужен небольшой поднабор. Это увеличивает время пробного запуска, память и
поверхность для ошибок.

Предлагаемая модель:

- плагин в `describe` объявляет include/exclude globs, поддерживаемые расширения
  и максимальный размер файла;
- host применяет общие исключения (`.git`, build/cache directories, бинарники),
  затем plugin-specific фильтры;
- большие текстовые файлы пропускаются по настраиваемому лимиту, например 2 MiB
  по умолчанию;
- исключения можно явно переопределить в `portolan.json` для WSDL/XSD, больших
  OpenAPI-документов и других осознанных случаев;
- trial UI показывает количество прочитанных и пропущенных файлов и общий объём.

**Done when:** объём входа зависит от потребностей конкретного плагина, а не от
полного размера репозитория; причина каждого пропуска воспроизводима.

## P1 — корректность и воспроизводимость

### PORTOLAN-3. Поддержать git-репозиторий без первого коммита

**Status:** open

После `portolan init` в пустом репозитории нет `HEAD`. Dev server периодически
печатает `fatal: bad revision 'HEAD'`, а `portolan check` видит новый
`generatedAt` в `git.repo.json` при каждом запуске. Проверка становится чистой
только с вручную закреплённым `PORTOLAN_GENERATED_AT`.

Нужно:

- не вызывать git-команды с `HEAD`, если репозиторий находится в unborn state;
- получить детерминированный stamp для vendored git step без часов реального
  времени;
- обеспечить последовательность `init -> generate -> check` без обязательного
  первого коммита и без специальной переменной окружения.

**Done when:** новый пустой репозиторий проходит `generate` и затем `check`, а
dev server не пишет git-ошибок.

### PORTOLAN-4. Пустые коллекции фрагмента должны сериализоваться как `[]`

**Status:** patch ready

River и Watermill возвращали `"flows": null`, когда ничего не нашли. Для
каталожного контракта отсутствие элементов должно быть пустым массивом, а не
сменой типа значения.

Локальные изменения и regression tests находятся в:

- `plugins/extract-river/extract.go`;
- `plugins/extract-river/extract_test.go`;
- `plugins/extract-watermill/extract.go`;
- `plugins/extract-watermill/extract_test.go`.

**Done when:** все плагины используют одинаковый JSON-контракт для пустых
коллекций, желательно проверяемый общим contract test suite.

### PORTOLAN-5. SQL extractor не должен ссылаться на отсутствующее хранилище

**Status:** patch ready

Если миграций нет, SQL extractor не создавал store, но оставлял его ID в
`service.stores`. Merge получал ссылку на несуществующий объект.

Локальный фикс очищает `service.stores` в сценарии без таблиц и покрыт тестом в
`plugins/extract-sql/store_test.go`.

**Done when:** фрагмент без найденной схемы валиден сам по себе и сообщает о
stateless результате только предупреждением.

### PORTOLAN-6. Typed Go call graph не работает в WASI host

**Status:** investigate

На `aviacore` и `aviasupp` HTTP client extractor сообщил:
`pipe: Not implemented on wasip1` и перешёл на синтаксический fallback. Каталог
создаётся, но точность интеграций и flows ниже ожидаемой.

Варианты для решения:

- убрать зависимость анализа от pipe/process API;
- вынести typed-анализ в host capability с ограниченным протоколом;
- иметь native sidecar для тяжёлого language-aware анализа;
- явно показывать в UI, какая часть результата получена fallback-режимом.

**Done when:** typed-анализ Go работает в поддерживаемой sandbox-модели либо
capability честно отключена до trial, а не деградирует только во время запуска.

### PORTOLAN-7. Разрешать интеграции между добавленными проектами

**Status:** investigate

После добавления всех трёх проектов карта показывает `0 of 3 pairs joined`, хотя
в `aviacore` и `aviasupp` обнаружены реальные HTTP/SOAP вызовы. Большинство
вызовов остаются вида `http-client/POST /book` или `dynamic endpoint` и не
связываются с API другого проекта.

Идеи:

- aliases для base URL, service discovery names и Kubernetes service names;
- сопоставление HTTP method + normalized path с OpenAPI operations;
- явные `peers`/`externals` в project configuration;
- confidence score и UI для подтверждения предложенной связи;
- хранить подтверждённые пользователем связи, чтобы повторная генерация была
  детерминированной.

Реализовано локально: после merge HTTP client calls сопоставляются с
server-side HTTP routes по verb и нормализованному path. Сначала используется
полный path, затем уникальный посегментный suffix для mounted routes вроде
`/get-admin-settings` -> `/settings/get-admin-settings`. Self-call исключается,
а несколько кандидатов не разрешаются автоматически. На каталоге ETG это дало
21 связь `aviacore -> aviasupp` и 18 связей `aviacore -> aviaadmin`.

Осталось отдельными задачами: `dynamic endpoint`, маршруты Django без
определённого HTTP verb и сохранение base-URL provenance непосредственно в
HTTP client extractor вместо suffix inference.

**Done when:** известный вызов `aviacore -> aviasupp` отображается на context map
с источником доказательства и не требует ручного редактирования generated JSON.

### PORTOLAN-8. Карточки проектов показывают неверную provenance-статистику

**Status:** open

В Settings после успешной генерации карточки имеют status `healthy`, но
показывают `fragments: 0` и `commit: not stamped`, хотя vendored fragments и
закреплённые commit SHA существуют. Source links при этом уже используют SHA.

**Done when:** карточка показывает фактическое количество фрагментов и commit
из provenance выбранного проекта; значения совпадают после полной перезагрузки
preview.

## P2 — качество извлечения и UX

### PORTOLAN-9. Сделать предупреждения пригодными для работы

**Status:** open

Trial для `aviacore` показал 64 предупреждения, для `aviasupp` — 30. Длинный
плоский список скрывает важные ошибки среди повторяющихся сообщений.

Нужно группировать предупреждения по plugin, rule и severity, показывать счётчик
повторов, фильтры и короткое рекомендуемое действие. Для осознанных ограничений
нужна конфигурируемая suppression с причиной, а не глобальное отключение.

### PORTOLAN-10. OpenAPI без `operationId`

**Status:** source quality

В `aviacore` найдено 53, в `aviasupp` — 25 операций без `operationId`. Сейчас
они перечисляются по verb и path, что корректно, но создаёт шум и менее стабильные
идентификаторы.

Идея: генерировать стабильный synthetic ID из method + normalized path, помечать
его provenance как inferred и выдавать одно агрегированное предупреждение на
контракт.

### PORTOLAN-11. Дубликаты деклараций WSDL/XSD

**Status:** source quality / investigate

В Amadeus schemas присутствуют повторные declarations в одном namespace.
Экстрактор выбирает первую, но одинаковое предупреждение затем повторяется в
WSDL и HTTP client extraction.

Нужно дедуплицировать диагностику и добавить provenance выбранной декларации.
Если несколько определений несовместимы, severity должна быть выше обычного
warning.

### PORTOLAN-12. ADR detection видит файлы, но не распознаёт формат

**Status:** open

В обоих Go-проектах UI обнаруживает `docs/ADR/*.md`, но предлагает ADR extractor
неактивным с пометкой `format not recognized`.

Идея: tolerant parser для common Markdown ADR formats плюс preview найденных
полей до включения capability.

### PORTOLAN-13. Помощь с неоднозначными Django aggregates

**Status:** source quality / UX

`aviaadmin` содержит приложения с несколькими моделями, где extractor не может
сам выбрать aggregate root. Вместо повторяющихся предупреждений UI может
предложить кандидатов и записать выбор в `aggregates` options.

### PORTOLAN-14. Улучшить River и Watermill discovery

**Status:** investigate

В `aviacore` River inserts не сопоставились с частью workers, а Watermill topics
оказались динамическими и Router handlers не были найдены. Нужны:

- разрешение constants/config defaults и простых wrapper functions;
- поиск registration composition root;
- связь producer/consumer через тип аргументов и topic aliases;
- отдельное различие между «доказано отсутствует» и «анализатор не смог
  разрешить».

### PORTOLAN-15. Проверять автоматическое architecture placement

**Status:** investigate

UI автоматически разместил `aviacore` и `aviasupp` как `system/application`, а
`aviaadmin` как `bounded-context/service`. Это может быть верно технически, но
решение основано на эвристике и заметно влияет на карту.

Идея: показывать evidence и confidence для kind/placement, а при средней
уверенности просить пользователя подтвердить выбор до trial extraction.

### PORTOLAN-16. Управлять масштабом generated views

**Status:** investigate

Для трёх проектов LikeC4 создал около 590 dynamic views. Нужно измерить время
генерации, размер frontend bundle и удобство навигации. Возможные меры: lazy
generation, лимиты по типам flows, grouping и генерация подробного view только
по запросу.

## Предлагаемый порядок

1. **Safety pass:** PORTOLAN-1 и PORTOLAN-2.
2. **Correctness pass:** PORTOLAN-3, затем оформить готовые PORTOLAN-4 и
   PORTOLAN-5.
3. **Architecture value:** PORTOLAN-6 и PORTOLAN-7, потому что без них карта
   межсервисных связей остаётся неполной.
4. **UI trust:** PORTOLAN-8 и PORTOLAN-9.
5. **Extractor depth:** PORTOLAN-10—PORTOLAN-16 по фактической ценности для
   следующих подключаемых проектов.

## Решения, которые нужно принять

1. Какой default max size разрешать для текстового файла: 1, 2 или 5 MiB?
2. Должны ли плагины получать список metadata обо всех пропущенных файлах или
   только агрегированную статистику?
3. Typed language analysis должен оставаться внутри WASM или может выполняться
   отдельным sandboxed native process?
4. Межпроектные связи должны подтверждаться пользователем или confidence выше
   заданного порога можно принимать автоматически?
5. Какие warning categories должны ломать `check`, а какие остаются только
   информационными?

## Уже проверено

- `npx vitest run scripts/plugin-host.test.mjs` — 16 tests passed.
- `go test ./plugins/extract-river ./plugins/extract-watermill ./plugins/extract-sql`
  — passed.
- `npm run gen` — passed.
- `npm run likec4:gen` — passed.
- Итоговый ETG catalog с тремя проектами отрисован в UI; Settings показывает
  три healthy проекта, context map показывает три домена.
