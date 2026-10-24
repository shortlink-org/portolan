# Автоматический детект `aviaadmin`, `aviacore` и `aviasupp`

Дата исследования: 2026-10-24. Исходные деревья прочитаны локально и не изменялись:

- `/Users/batazor/myproject/etg/aviaadmin`
- `/Users/batazor/myproject/etg/aviacore`
- `/Users/batazor/myproject/etg/aviasupp`

## Краткий вывод

Portolan уже располагает почти всеми необходимыми одиночными экстракторами: Django, OpenAPI, Go HTTP clients, Watermill, Go/Python Kafka, Celery, River, Redis и SQL. На этих сервисах главный пробел находится между фрагментами: фактические значения из `.helm-ovh/configmap.<env>.yaml` не уточняют URL/broker/store, найденные в исходниках, поэтому доказуемые межсервисные связи остаются `unresolved` или требуют ручного `peers`.

Наиболее полезные улучшения в порядке приоритета:

1. Научить project discovery предлагать уже существующие `python-kafka` и `go-kafka`; сейчас `aviaadmin` и оба Go-сервиса проходят мимо этих plugins, хотя extractors читают используемые ими клиенты.
2. Добавить extractor deployment-values (или расширить `extract-project`) для `env:`-подобных словарей в Helm values/configmap-файлах и overlay по окружениям. Отдельно детектировать `.helm-ovh/application.yaml`; обычный `extract-k8s` для неотрендеренных values здесь недостаточен.
3. В merge сопоставлять `destination.environmentVariable` с deployment value и затем host/path с ingress/service identity других компонентов.
4. Сопоставлять Kafka-каналы по фактическому topic после overlay, сохраняя environment; это напрямую соединит `aviasupp → aviacore` для booking updates.
5. Извлекать зависимость на внутренний Go module как сильную связь с контрактом, но не как runtime RPC: `aviacore` компилируется против публичных DTO `aviasupp`.
6. Добавить отдельный источник для runtime Swagger (`drf_yasg`/`swaggo`) либо явно предпочитать checked-in `docs/swagger.{json,yaml}` и диагностировать drift относительно route extraction.

## Профили сервисов

### `aviaadmin`

- Python/Django 3.2 + DRF: зависимости зафиксированы в `aviaadmin/requirements.txt:88` и `aviaadmin/requirements.txt:124`.
- Корневой URLConf собирает подсистемы `acc-manager`, `book-store`, `geo`, `pricer`, `logger`, `mailer`, `settings` и runtime Swagger: `aviaadmin/adminavia/urls.py:40-62`.
- PostgreSQL через Django/`psqlextra`: две базы (`default`, `slave`) с env-derived host/name/port: `aviaadmin/adminavia/settings.py:132-151`.
- Redis одновременно используется как cache и как fallback от `CELERY_BROKER_URL`: `aviaadmin/adminavia/settings.py:287-303`.
- Celery beat запускает transactional-outbox задачу каждые 10 секунд: `aviaadmin/adminavia/settings.py:280-285`; сама задача объявлена в `aviaadmin/avia/tasks.py:6-8`.
- Kafka producer реализован через `confluent_kafka.Producer`, включая outbox locking и topic из settings: `aviaadmin/util/kafka_utils.py:8`, `aviaadmin/util/kafka_utils.py:49-67`.
- Богатая ORM-модель явно задаёт связи: `Order → Booking` в `aviaadmin/avia/models/booking.py:19-20`, `Booking → Route` в `aviaadmin/avia/models/route.py:7`, `Route → Segment` в `aviaadmin/avia/models/segment.py:9-11`, `Booking/Passenger/Route/Segment → Ticket` в `aviaadmin/avia/models/ticket.py:7-10`.
- Прямой вызов `aviasupp`: base URL берётся из `AVIASUPP_URL` (`aviaadmin/adminavia/settings.py:403-405`), запрос отправляется на `/service` (`aviaadmin/acc_manager/terminal.py:125`).
- Deployment config задаёт `AVIACORE_URL` и `AVIASUPP_URL` в `aviaadmin/.helm-ovh/configmap.prod.yaml:31-37`. Вызов `AVIASUPP_URL + "/service"` доказан call-site; для `AVIACORE_URL` в этом дереве найдено только чтение настройки и diagnostic exposure, поэтому runtime edge к `aviacore` создавать нельзя.

### `aviacore`

- Go 1.26, Gin, pgx, Redis, River, Watermill Kafka и generated Swagger: `aviacore/go.mod:1-3`, `aviacore/go.mod:8-9`, `aviacore/go.mod:15-16`, `aviacore/go.mod:22`, `aviacore/go.mod:31-40`.
- HTTP surface регистрируется напрямую в Gin; базовые business routes начинаются с `/search`, `/init`, `/prebook`, `/validate`, `/book`: `aviacore/internal/api/handlers/handlers_init.go:164-174`; protected/callback routes находятся в том же router, например `aviacore/internal/api/handlers/handlers_init.go:419-430` и `aviacore/internal/api/handlers/handlers_init.go:720`.
- `aviasupp` является HTTP peer: `AVIASUPP_ADDR` попадает в `cfg.SuppUrl` (`aviacore/internal/app/aviacore/config/config.go:75-77`), затем в `jsonapi.WithBaseURL` (`aviacore/internal/clients/aviasupp/aviasupp_cli/aviasupp.go:26-38`) и используется, например, для `/search` (`aviacore/internal/clients/aviasupp/aviasupp_cli/aviasupp.go:43-50`). Production value указывает на `http://aviasupp.srv.team`: `aviacore/.helm-ovh/configmap.prod.yaml:19`.
- `aviaadmin` выступает сразу несколькими API surfaces: booking store, config/settings, currencies, geo и pricer заданы отдельными env-полями в `aviacore/internal/app/aviacore/config/config.go:85-109`; production values сводят их к одному host `aviaadmin.srv.team` с разными path prefixes: `aviacore/.helm-ovh/configmap.prod.yaml:26-38`, `aviacore/.helm-ovh/configmap.prod.yaml:63`, `aviacore/.helm-ovh/configmap.prod.yaml:80`.
- `aviacore` также зависит от versioned Go module `gitlab.srv.team/avia/aviasupp v1.6.3`: `aviacore/go.mod:45`. Это контрактная/code dependency, отличная от runtime HTTP edge.
- Watermill handler принимает booking updates и публикует результат: registration/topics находятся в `aviacore/internal/messaging/bookingupdate/handler.go:38-46`, публикация — в `aviacore/internal/messaging/bookingupdate/handler.go:116-128`.
- Topic names параметризованы envconfig-тегами: `aviacore/internal/app/aviacore/config/config.go:49-52`; production overlay меняет input/output на `avia-suppliers-events` и `flight-changes.avia2crm`: `aviacore/.helm-ovh/configmap.prod.yaml:40-46`.
- pgx pool, Redis clients и River client создаются на startup: `aviacore/internal/app/aviacore/main.go:159-216`; River workers регистрируются в `aviacore/internal/app/aviacore/main.go:332-338`.

### `aviasupp`

- Go 1.26, Gin, pgx, Redis v9, River, Watermill Kafka, Swagger и oapi-codegen: `aviasupp/go.mod:1-3`, `aviasupp/go.mod:8-9`, `aviasupp/go.mod:14-15`, `aviasupp/go.mod:20`, `aviasupp/go.mod:26`, `aviasupp/go.mod:31-43`.
- Основной HTTP API регистрируется напрямую: `/search`, `/prebook`, `/upsells`, `/book`, `/get-booking`, `/commit`, `/cancel`, refund/void и ancillary routes: `aviasupp/internal/app/aviasupp/main.go:456-532`.
- Обратная связь на `aviacore` задаётся `AVIACORE_URL`: `aviasupp/internal/pkg/config/config.go:87-90`; deployment values указывают на `aviacore`: `aviasupp/.helm-ovh/configmap.prod.yaml:30-36`.
- Один доказуемый callback собирает `baseURL + /protected/additional/external/update` и делает `http.Client.Do`: `aviasupp/internal/pkg/coreclient/additional_update.go:13`, `aviasupp/internal/pkg/coreclient/additional_update.go:41-65`. Принимающий route `external/update` есть в `aviacore/internal/api/handlers/protected/addservice/routing.go:159-161` под группой `/protected/additional` из `aviacore/internal/api/handlers/handlers_init.go:395-402`.
- Другой callback скрыт за внешним module wrapper: `async.New(aviacoreURL, timeout)` в `aviasupp/internal/pkg/async/emitter.go:10-16`; использование `EmitVoidDone` находится в `aviasupp/internal/pkg/connector/websky/worker_void_cancel.go:83`. Для него syntax-only HTTP extractor без анализа зависимости не увидит конечный path.
- Watermill email router читает `cfg.SubscribeTopic`, публикует parsed event в `cfg.PublishTopic`, ошибки — в `cfg.ErrorTopic`: `aviasupp/internal/infrastructure/messagebus/emailparsers/email_handler_router.go:37-44`, `aviasupp/internal/infrastructure/messagebus/emailparsers/email_handler_router.go:72-92`. Defaults — `email.subscribe`, `email.publish`, `email.error`: `aviasupp/internal/pkg/config/config.go:110-115`.
- Redis создаётся из `AVIASUPP_REDIS_*`, pgx/River — из `PG_CONN_STR`; поля config находятся в `aviasupp/internal/pkg/config/config.go:51-53`, deployment values — в `aviasupp/.helm-ovh/configmap.prod.yaml:5-7`, `aviasupp/.helm-ovh/configmap.prod.yaml:40`.

## Подтверждённая топология

| From | To | Transport | Статическое доказательство |
| --- | --- | --- | --- |
| `aviaadmin` | `aviasupp` | HTTP `/service` | `aviaadmin/acc_manager/terminal.py:125`, production target в `aviaadmin/.helm-ovh/configmap.prod.yaml:37` |
| `aviacore` | `aviasupp` | HTTP | base client в `aviacore/internal/clients/aviasupp/aviasupp_cli/aviasupp.go:26-38`, target в `aviacore/.helm-ovh/configmap.prod.yaml:19` |
| `aviasupp` | `aviacore` | HTTP callbacks | `aviasupp/internal/pkg/coreclient/additional_update.go:41-65`, target в `aviasupp/.helm-ovh/configmap.prod.yaml:30-36` |
| `aviacore` | `aviaadmin` | HTTP, несколько prefixes | config fields в `aviacore/internal/app/aviacore/config/config.go:85-109`, targets в `aviacore/.helm-ovh/configmap.prod.yaml:26-38,63,80` |
| `aviasupp` | `aviacore` | Kafka booking update | publish route в `aviasupp/internal/infrastructure/messagebus/emailparsers/email_handler_router.go:87-92`, receive route в `aviacore/internal/messaging/bookingupdate/handler.go:38-46`; prod values сводят `EMAIL_PUBLISH_TOPIC` и `KAFKA_BOOKING_UPDATE_IN_TOPIC` к `avia-suppliers-events`: `aviasupp/.helm-ovh/configmap.prod.yaml:50-52`, `aviacore/.helm-ovh/configmap.prod.yaml:40-41` |
| `aviacore` | `aviasupp` | Go module contract | `aviacore/go.mod:45`; не следует смешивать с HTTP edge |

Отдельный настроенный, но не подтверждённый edge — `aviaadmin → aviacore`: `AVIACORE_URL` существует, однако вызова с этим base URL в исходниках не найдено. Это полезная проверка строгости: deployment value может уточнить уже найденный call-site, но не должен создавать RPC сам по себе.

Kafka-связь тоже показывает нужную строгость: source defaults `email.publish` и `booking-update-in` не совпадают, но checked-in prod и dev overlays сводят обе стороны к `avia-suppliers-events`. Portolan должен соединить их только внутри одного environment и сохранить цепочку provenance, а не объединять по сходству payload `BookingUpdateEvent`.

## Повторяющиеся паттерны, которые стоит детектить

### 1. Env field → deployment value → peer service

Во всех трёх сервисах endpoint проходит один и тот же путь:

1. поле/setting получает имя env variable;
2. client constructor принимает это поле как base URL;
3. `.helm-ovh/configmap.<env>.yaml` задаёт реальный host;
4. host совпадает с ingress/service name другого репозитория.

Примеры: `AVIASUPP_ADDR` (`aviacore/internal/app/aviacore/config/config.go:75` → `aviacore/.helm-ovh/configmap.prod.yaml:19`), `AVIACORE_URL` (`aviasupp/internal/pkg/config/config.go:87` → `aviasupp/.helm-ovh/configmap.prod.yaml:30`), `AVIASUPP_URL` (`aviaadmin/adminavia/settings.py:405` → `aviaadmin/.helm-ovh/configmap.prod.yaml:37`).

Предложение: новый fragment `configuration-bindings` с полями `component`, `environment`, `variable`, `valueSource`, `sanitizedValue`, `targetIdentity`; merge должен уточнять уже существующее `destination`, не создавать RPC без call-site.

### 2. Один peer, несколько URL prefixes

`aviacore` обращается к `aviaadmin` как к booking store, settings, geo, pricer и currencies. Это не пять сервисов: production values имеют один host, но разные paths (`aviacore/.helm-ovh/configmap.prod.yaml:26-38,63,80`), которые совпадают с Django mount points (`aviaadmin/adminavia/urls.py:43-53`).

Предложение: peer identity определять по normalized host/service, а contract/interface — по path prefix. Не делать component id из имени env variable (`BOOKINGSTORE`, `GEO`, `PRICER`).

### 3. Async topic через config default и environment override

Watermill уже умеет читать envconfig defaults, но здесь default — только local truth. `aviacore` меняет topic в Helm (`aviacore/.helm-ovh/configmap.prod.yaml:40-45`), а `aviasupp` переопределяет `EMAIL_*` topics (`aviasupp/.helm-ovh/configmap.prod.yaml:48-52`) относительно defaults из `aviasupp/internal/pkg/config/config.go:110-115`.

Предложение: хранить channel identity как `(protocol, effective address, environment)` и provenance chain. Неразрешённые или несовпадающие values оставлять отдельными каналами с диагностикой, не объединять по payload type.

### 4. Runtime-generated API contracts

`aviaadmin` публикует Swagger через `drf_yasg` во время выполнения (`aviaadmin/adminavia/urls.py:27-38`, `aviaadmin/adminavia/urls.py:55-56`), тогда как Go-сервисы коммитят `docs/swagger.json`/`yaml` и обслуживают Swagger (`aviasupp/internal/app/aviasupp/main.go:411`). Route extractors дают актуальный surface, checked-in spec — более богатые schemas, но может отстать.

Предложение: merge contracts по `(method,path)`, отметить basis `inferred`/`checked-in`, а расхождение route/spec вывести как problem. Для `drf_yasg` не импортировать Django project; продолжать AST extraction и использовать decorators как schema enrichment.

### 5. Внешние module wrappers скрывают transport

`aviasupp` вызывает `async.New` из `gitlab.srv.team/avia/tools/async` (`aviasupp/internal/pkg/async/emitter.go:7-12`), затем `EmitVoidDone` (`aviasupp/internal/pkg/connector/websky/worker_void_cancel.go:83`). Конечный HTTP path находится вне дерева сервиса. Похожим образом `aviacore` импортирует DTO/module `aviasupp` (`aviacore/go.mod:45`).

Предложение: различать `library dependency` и `transport implementation`. Для частных Go modules поддержать опциональный fetched source/module contract cache; если source отсутствует, сохранить unresolved call с module+symbol, не угадывать HTTP edge.

### 6. Shared stores и ownership

`aviaadmin` production database буквально называется `aviacore` (`aviaadmin/.helm-ovh/configmap.prod.yaml:6-16`), а `aviacore` получает PG DSN через opaque Vault reference (`aviacore/.helm-ovh/configmap.prod.yaml:58`). Равенство физического store из дерева не доказуемо. Аналогично Redis hosts/DB различаются по environment.

Предложение: deployment extractor должен сохранять несекретные `(host, port, db/name)` и secret reference identity без чтения секрета. Stores объединять только по доказуемому endpoint tuple или общей secret reference; совпадение слова `aviacore` считать hint/diagnostic, не identity.

## Как применить существующие extractors

Для этих репозиториев целевой pipeline должен включать:

- `extract-project` для всех трёх;
- `extract-django`, `extract-celery`, `extract-python-kafka` для `aviaadmin`;
- `extract-openapi`, `extract-http-clients`, `extract-watermill`, `extract-go-kafka`, `extract-river`, `extract-redis`, `extract-sql` для обоих Go-сервисов;
- отдельный deployment-values шаг до merge, чтобы заменить config defaults значениями конкретного окружения;
- cross-repository merge всех трёх fragments одновременно, иначе host→peer и producer→consumer не могут быть доказаны.

Текущий auto-discovery этого pipeline не собирает полностью: список detections в `scripts/local-discovery.mjs:480-529` включает Watermill/River/Celery, но не включает `python-kafka`, `go-kafka`, deployment values, `k8s` или `argocd-gitops`. Проверочный запуск существующего `python-kafka` при этом уже извлекает `avialogger.data` из `aviaadmin`; значит, ближайшее улучшение — подключить имеющуюся способность автоматически, а не писать новый Kafka parser.

Особые проверки fixtures, которые стоит добавить при реализации:

1. `AVIASUPP_ADDR` связывает `aviacore` call `/search` с `aviasupp POST /search` в `prod`.
2. Пять URL variables `aviacore → aviaadmin` дают один peer и разные interfaces.
3. `aviasupp → aviacore /protected/additional/external/update` соединяется по full path.
4. Kafka producer/consumer соединяются только после одинакового environment overlay.
5. Opaque Vault DSN не приводит к ложному объединению PostgreSQL stores.
6. Go module dependency `aviacore → aviasupp` отображается отдельно от runtime RPC.

## Ограничения исследования

- Исследование статическое: сервисы, базы и brokers не запускались.
- Vault values намеренно не разрешались; секреты не нужны для topology extraction.
- `.helm-ovh` похож на chart values/configmap input, а не на готовые Kubernetes manifests; обычный `extract-k8s` не должен притворяться, что это rendered workload.
- Kafka edge `aviasupp → aviacore` остаётся условным, пока источник deployment truth не докажет одинаковый effective topic.
