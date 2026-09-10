# Portolan roadmap

Этот документ собирает оставшиеся проблемы и идеи, обнаруженные при подключении
реальных репозиториев `aviaadmin`, `aviacore` и `aviasupp` через локальный UI
Portolan. Завершённые задачи из roadmap удаляются.

## Статусы

- **open** — проблема подтверждена, решения ещё нет.
- **investigate** — симптом подтверждён, но сначала нужно выбрать модель решения.
- **source quality** — Portolan корректно сообщает о недостатке в исходном
  проекте; можно улучшить диагностику или добавить явную конфигурацию.

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

### PORTOLAN-8. Карточки проектов показывают неверную provenance-статистику

**Status:** open

В Settings после успешной генерации карточки имеют status `healthy`, но
показывают `fragments: 0` и `commit: not stamped`, хотя vendored fragments и
закреплённые commit SHA существуют. Source links при этом уже используют SHA.

**Done when:** карточка показывает фактическое количество фрагментов и commit
из provenance выбранного проекта; значения совпадают после полной перезагрузки
preview.

## P2 — качество извлечения и UX

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

### PORTOLAN-18. Сохранять destination provenance HTTP-вызова

**Status:** investigate

Сейчас HTTP client extractor сохраняет verb, локальный path и текстовую note,
но часто теряет base URL за functional options и config fields. После merge
приходится использовать уникальный suffix route, например
`/get-admin-settings` -> `/settings/get-admin-settings`.

Нужна структурированная provenance-модель: call site, endpoint expression,
base URL/config field, service-discovery alias и полный path после доказуемого
join. UI должен показывать, на каком именно evidence основана связь.

**Done when:** вызов через `WithBaseURL(cfg.SettingAddr)` связывается с
`aviaadmin` по восстановленному `/settings/...`, а не только по уникальности
суффикса среди текущих проектов.

### PORTOLAN-19. Не склеивать одинаковые HTTP routes к разным destinations

**Status:** open

HTTP client extractor дедуплицирует consumers по `call.ID`. Два реальных
вызова `POST /foo` к разным hosts получают одинаковый ID и могут схлопнуться в
одну запись до того, как merged catalog увидит destination evidence.

Нужно определить устойчивую identity outbound call: protocol operation плюс
destination identity или отдельный call-site ID. Несколько call sites к одному
контракту можно агрегировать только после разрешения peer, сохраняя список
provenance.

**Done when:** fixture с двумя `POST /foo` к разным сервисам создаёт две
корректные связи и ни порядок обхода файлов, ни deduplication не меняют
результат.

### PORTOLAN-20. Выводить HTTP verb для mounted Django views

**Status:** investigate

Django extractor видит URLConf и flow для views вроде `Planet.fetch`, но
исключает route из inferred OpenAPI, если verb не объявлен явно. Из-за этого
известный путь `/geo/planet/fetch` нельзя сопоставить с outbound HTTP call.

Нужно собирать evidence из `require_http_methods`, DRF action metadata,
`http_method_names`, branch logic по `request.method` и вызываемых wrappers.
Если verb всё равно неизвестен, route можно хранить как диагностический
кандидат без автоматического подтверждения связи.

**Done when:** поддержанные декларативные Django-паттерны дают verb + mounted
path; неизвестный verb остаётся явно неизвестным и не исчезает из модели.

## Предлагаемый порядок

1. **Correctness:** PORTOLAN-3 и PORTOLAN-8.
2. **Extractor depth:** PORTOLAN-10, PORTOLAN-11, PORTOLAN-13—16 и
   PORTOLAN-18—20 по фактической ценности для следующих подключаемых проектов.

## Решения, которые нужно принять

1. Межпроектные связи должны подтверждаться пользователем или confidence выше
   заданного порога можно принимать автоматически?
2. Какие warning categories должны ломать `check`, а какие остаются только
   информационными?
