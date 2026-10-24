# Что действительно нужно для каталога AsyncAPI масштаба TransferGo

Дата исследования: 2026-10-24
Область: только пользовательский опыт документации и информационная архитектура. CI, генерация кода, contract testing, публикация и runtime-проверки намеренно исключены.

## Решение в одном абзаце

Для сценария с 50+ сервисами и 300+ каналами Portolan не нужен второй портал документации. Нужен один новый вход в уже существующий каталог: **глобальный Messaging inventory** с представлениями Channels и Messages, поиском, фильтрами, producer/consumer-контекстом, provenance и shareable selection. Страница сервиса и официальный AsyncAPI renderer уже позволяют прочитать отдельный контракт; сегодня нельзя начать с известного channel address или message name и увидеть его место во всём estate. Разбор payload и отдельные message/channel pages нужны следующим этапом, только если inventory подтвердит, что читателям недостаточно перехода к точному service contract.

## Почему это не просто «ещё один AsyncAPI viewer»

TransferGo описывает две разные проблемы:

1. YAML был неудобен для чтения, а документацию отдельных сервисов приходилось искать по разным URL или через центральный список. Переход к единому порталу позволил просматривать сервисы и их контракты в одном месте ([официальная история TransferGo](https://www.asyncapi.com/blog/transfergo-asyncapi-story#documentation-showcase)).
2. При 300+ каналах стало трудно понять, что, где и когда публикуется; Event Catalog дал общую картину и показал сценарии, требующие внимания ([официальная история TransferGo](https://www.asyncapi.com/blog/transfergo-asyncapi-story#event-catalog)).

Это разные уровни чтения: **контракт одного сервиса** и **связи между контрактами всего ландшафта**. Один embedded AsyncAPI renderer решает первый лишь частично и не решает второй.

Масштаб кейса — более 50 сервисов и 300 каналов; официальный case study прямо связывает его с проблемами discoverability, adoption и visibility ([AsyncAPI case study: TransferGo](https://www.asyncapi.com/casestudies/transfergo#challenges)).

## Что Portolan уже покрывает

Рекомендация ниже — не предложение заново построить EventCatalog. У Portolan уже есть существенная часть нужного UX:

- service page имеет отдельный **Bus** tab, где каналы и сообщения показаны с `send`/`receive`, фильтром направления, группировкой и ссылками на известные domain events ([`ServicePage.tsx`](../../src/pages/ServicePage.tsx), [`ChannelRows.tsx`](../../src/components/ChannelRows.tsx));
- полный исходный AsyncAPI уже доступен через официальный renderer в том же tab ([`AsyncApiReference.tsx`](../../src/components/AsyncApiReference.tsx));
- domain event уже имеет самостоятельную страницу со схемой, версиями/diff, примером, consumers, focused producer → event → consumers graph и продолжением по flows ([`EventPage.tsx`](../../src/pages/EventPage.tsx));
- глобальная command palette уже индексирует services и domain events, а навигация имеет recent pages и pins ([`palette.ts`](../../src/lib/palette.ts), [README](../../README.md#the-site));
- Problems уже показывает async drift: second publisher, event/channel mismatch, unused declared channel и subscription without publisher ([README](../../README.md#what-it-checks), [`rules/builtin.json`](../../rules/builtin.json)).

Пробел проявляется именно в **AsyncAPI-only estate**:

- extractor сохраняет channel/message name, prose, direction и content type, но не читает payload fields, headers, correlation ID или examples; external `$ref` тоже не разрешаются ([`extract-asyncapi` limits](../../plugins/extract-asyncapi/README.md#limits));
- channel и произвольный AsyncAPI message не имеют самостоятельной route/page и не попадают в command palette; ссылка появляется лишь тогда, когда message удалось сопоставить с уже существующим domain event ([`ChannelRows.tsx`](../../src/components/ChannelRows.tsx), [`routes.ts`](../../src/routes.ts), [`palette.ts`](../../src/lib/palette.ts));
- поэтому готовый EventPage UX обслуживает сообщения, найденные в domain model/code, но не делает каждый AsyncAPI contract полноценным объектом документации.

Следовательно, реальный продуктовый эпик один: **сделать существующие AsyncAPI message/channel declarations глобально находимыми и сопоставимыми**, переиспользовав service, search, Problems и source-evidence mechanics. Сначала это derived inventory над текущей моделью, а не новые глобальные сущности: одинаковое имя или адрес ещё не доказывают, что два документа говорят об одном контракте. Отдельный портал, новый raw renderer и новая система drift rules не нужны.

## Пользовательские задачи

### Разработчик-потребитель

- Найти событие или команду по известному имени, адресу канала, сервису либо бизнес-термину.
- Понять, что означает сообщение, когда оно возникает и можно ли использовать его в своём сервисе.
- Увидеть payload, headers, обязательные поля, форматы, enum, correlation ID и реалистичный пример без чтения YAML.
- Узнать, какой сервис отправляет сообщение, через какой канал и какие сервисы его получают.
- Найти владельца и исходный документ, если описание неполно или нужна договорённость об изменении.

### Разработчик-владелец сервиса

- Увидеть все send/receive операции своего сервиса в одном списке.
- Проверить, как его сообщения выглядят для читателя и где они появляются в общей карте.
- Отличить факт из собственного AsyncAPI от связи, добавленной другим источником или выведенной каталогом.

### Архитектор или platform engineer

- Перейти от домена/системы к сервисам, сообщениям и каналам, не открывая граф из сотен узлов сразу.
- Ответить «кто публикует и кто потребляет это сообщение?» и «что проходит через этот канал?».
- Найти документальные пробелы: неизвестный владелец, отсутствующее описание или пример, операция без разрешённого сообщения, ссылка на отсутствующий ресурс.

## Обязательная модель чтения

AsyncAPI 3 описывает API **конкретного приложения**, а его операции — действия именно этого приложения. `send` означает, что приложение отправляет сообщение в канал; `receive` — что приложение ожидает сообщение из канала ([AsyncAPI 3.0, Operation Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#operationObject)). Поэтому подписи «publisher» и «consumer» допустимы только рядом с явно названным приложением.

Спецификация также предупреждает, что она не предполагает конкретную топологию и что нельзя автоматически получить receiver-документ из sender-документа: канал отправки и канал получения могут различаться, а между ними может быть посредник ([AsyncAPI 3.0, Introduction](https://www.asyncapi.com/docs/reference/specification/v3.0.0#introduction)). Следствия для документации:

- не соединять сервисы только по совпавшему имени сообщения или channel ID;
- не считать одинаково названные сообщения одним контрактом без устойчивой идентичности или явной связи;
- не рисовать SNS → SQS, topic → queue или другую маршрутизацию, если её не утверждает доступный источник;
- показывать неизвестную связь как неизвестную, а не как отсутствие связи.

Это особенно важно для самого production-примера TransferGo: summary говорит о публикации в SNS, но операция помечена `receive`; summary потребления из SQS помечен `send` ([production-use документ в case study](https://www.asyncapi.com/casestudies/transfergo#production-use-asyncapi-document)). Документация должна сохранять точную семантику источника и делать противоречие заметным, а не молча переименовывать действие по тексту summary.

### Ресурсы и их роль в IA

| Ресурс | Роль в документации | Нужна отдельная глобальная директория |
| --- | --- | --- |
| Сервис / application | Точка входа для владельца сервиса; описание API, версия, операции, серверы | Да |
| Operation | Контекстное действие одного сервиса: send/receive, channel, messages | Нет в первом релизе; живёт на странице сервиса и в связях |
| Message declaration | Имя и описание в scope одного application/channel; где отправляется или получается | Один глобальный inventory; отдельная entity только после устойчивой identity |
| Channel declaration | Адрес/протокол в scope одного application и связанные операции | Один глобальный inventory; одинаковые адреса группируются как claims, не сливаются молча |
| Server | Среда и connection details для каналов | Нет в первом релизе; раскрывается из сервиса/канала |

Такое разделение следует самой структуре AsyncAPI 3: root document отдельно содержит application metadata, servers, channels и operations, а channel содержит допустимые messages ([AsyncAPI 3.0, AsyncAPI Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#asyncapiObject), [Channel Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#channelObject)).

## Must-have для закрытия реального пробела

### 1. Единый Discover для сервисов, сообщений и каналов

Нужен один вход в каталог, а не отдельная страница «AsyncAPI documents» рядом с архитектурой.

Минимальное поведение:

- поиск по human name, machine ID, summary, service/application, channel address и owner;
- фильтры по виду ресурса, домену/контексту, сервису, протоколу и направлению send/receive;
- результаты явно показывают вид ресурса, его scope и владельца, чтобы одинаковые имена не выглядели одним объектом;
- фильтр и выбранный scope сохраняются в URL для передачи ссылки;
- counts на страницах ведут в тот же список с применённым фильтром.

Это непосредственно отвечает проблеме TransferGo «не помнить URL каждого сервиса». В качестве проверенной модели каталогов: EventCatalog по умолчанию ищет по именам, summary, type и identifiers, а индексированный режим добавляет содержимое страниц и changelog ([EventCatalog Search](https://www.eventcatalog.dev/docs/development/customization/search)); Port делает глобально доступными entity title, identifier, description и другие свойства ([Port Global Search](https://docs.port.io/interface-builder/global-search/)). Эти продукты — evidence паттерна, а не требование копировать их UI.

Поиск по каждому payload field пока не обязателен: это отдельная задача анализа схемы, а не базовая discoverability.

Для Portolan это расширение существующей command palette и/или отдельный фильтруемый async index, а не новый параллельный search. Главный delta — индексировать channel addresses и AsyncAPI messages, у которых нет связанного domain event.

### 2. Довести существующую страницу сервиса до точной точки перехода

Страница должна отвечать «что этот сервис отправляет и получает?» до открытия полного спецификационного документа.

Порядок информации:

1. название, стабильный ID, краткое назначение, owner/contact, версия API и источник;
2. два отчётливых списка **Sends** и **Receives** (или один фильтруемый список с неизменяемым direction);
3. для каждой операции: operation ID/title, summary, message, channel address, protocol/server;
4. ссылки на страницу сообщения, страницу канала и точное место в исходном AsyncAPI;
5. raw/rendered AsyncAPI как audit view, а не единственное представление.

Направление всегда показывается с точки зрения названного сервиса. AsyncAPI определяет operation как обязательство application и связывает её с одним channel и подмножеством messages этого канала ([AsyncAPI 3.0, Operations Object и Operation Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#operationsObject)).

Для длинных списков нужны текстовый фильтр, direction/type filters, sorting и pagination либо виртуализация. EventCatalog применяет такой lookup-паттерн к связанным ресурсам сервиса: direction/type filters, search, sorting и pagination ([EventCatalog Service resources page](https://www.eventcatalog.dev/docs/development/guides/resources/services/resources-page)).

У Portolan эта страница уже существует как Bus tab. В первом релизе нужны стабильные anchors/query selection для channel/message declaration и, при длинных списках, текстовый фильтр поверх существующих direction/group controls. Ссылка из inventory должна открывать тот же service, Bus tab, channel и message, а не только начало страницы.

### 3. Структурированная страница message contract — второй этап

Сообщение должно становиться самостоятельной ссылочной единицей, когда extractor может сохранить его устойчивую scoped identity и структуру. Это не блокирует первый inventory: до этого его строка ведёт к точному declaration в service Bus tab и к raw/rendered AsyncAPI.

Orientation path:

- human title + machine name/ID;
- summary и более длинное «что произошло / зачем это сообщение существует»;
- lifecycle, если он есть в источнике;
- owner, версия и provenance;
- компактное «sent by / received by / via channels».

Contract path:

- payload как читаемая таблица/дерево с type, required, format, enum/default и description;
- отдельные headers;
- correlation ID и content type;
- examples с copy action;
- raw schema и ссылка на исходный AsyncAPI как fallback.

Это не произвольное расширение модели: Message Object AsyncAPI уже предусматривает payload, headers, correlation ID, content type, title/summary/description, tags, bindings и examples ([AsyncAPI 3.0, Message Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#messageObject)). Официальный пример TransferGo содержит обязательные поля, форматы, enum и полный пример payload ([production-use документ](https://www.asyncapi.com/casestudies/transfergo#production-use-asyncapi-document)); если портал показывает только имя сообщения, он скрывает большую часть полезного контракта.

EventCatalog подтверждает практичность одной deep-linkable schema page с отдельными представлениями properties, examples, producers/consumers, versions и details ([EventCatalog Schema Explorer](https://www.eventcatalog.dev/docs/development/guides/resources/schemas/explore-schemas/schema-explorer)). Для второго этапа нужны properties, examples, producers/consumers и details; history/diff можно отложить.

В Portolan не требуется вторая реализация EventPage. Нужен общий presentation layer либо адаптация существующего EventPage для message contract, который пришёл только из AsyncAPI. Новая работа — payload/headers/examples из extractor и устойчивая identity; schema tree, example, consumers и focused graph уже имеют продуктовый прецедент.

### 4. Отдельная страница channel — второй этап

Она должна отвечать не «что такое канал вообще», а «что может пройти по этому адресу и кто взаимодействует с ним».

Показывать:

- human title, channel ID и фактический address;
- summary/description;
- параметры address с default/enum/examples;
- servers/protocol и bindings, если они присутствуют;
- допустимые messages;
- операции, сгруппированные в **applications sending to this channel** и **applications receiving from this channel**;
- только явно подтверждённые связи channel → channel.

AsyncAPI различает channel ID и address и позволяет описать title, summary, description, servers, parameters, bindings, tags и messages ([AsyncAPI 3.0, Channel Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#channelObject)). EventCatalog тоже использует отдельные channel pages и связывает сервисные send/receive с конкретными `to`/`from` channels; channel chaining моделируется отдельно, а не выводится из похожих имён ([EventCatalog: Routing messages through channels](https://v2.eventcatalog.dev/docs/development/guides/channels/adding-messages-to-services)).

До появления надёжной identity эту задачу решает выбранная строка/группа в Messaging inventory: она показывает все application claims с provenance и не утверждает, что совпавшие адреса обязательно являются одним transport resource. Отдельная entity page оправдана, когда extractor сохраняет server identity, parameters и bindings.

### 5. Producer/consumer-контекст без «графа-волосатого шара»

Для выбранной строки inventory нужен локальный relationship detail:

`service → send operation → message → channel → receive operation → service`

Он должен:

- начинаться с выбранного объекта и ближайших соседей;
- позволять переходить на страницу каждого узла;
- различать message contract и transport channel;
- сохранять direction, protocol и source evidence;
- уметь скрывать/раскрывать группы и возвращаться к полному scope;
- не заявлять end-to-end маршрут там, где AsyncAPI сообщает только две независимые application perspectives.

На уровне домена/системы нужна progressive disclosure: сначала домены/системы, затем сервисы, затем messages/channels. EventCatalog применяет именно три уровня: L1 domains/systems, L2 services/data stores, L3 messages/channels; выбранный уровень сохраняется в URL ([EventCatalog Domain diagram](https://www.eventcatalog.dev/docs/development/guides/domains/visualize-domains/domain-diagram)). Это более подходящий масштабный паттерн, чем canvas со всеми 300 каналами по умолчанию.

### 6. Владелец и источник рядом с declaration

На service/message/channel page должны быть видимы:

- owning team/contact, если источник их задаёт;
- API version из `info.version` отдельно от версии AsyncAPI specification;
- repository/source file и deep link, если доступны;
- provenance каждой агрегированной связи;
- честное `unknown`, если owner/source/version отсутствует.

TransferGo распределяет ответственность: Backend Guild поддерживает общие библиотеки и tooling, а команды сервисов — свои AsyncAPI schemas; versioning привязан к репозиториям и service releases ([AsyncAPI case study: ownership and versioning](https://www.asyncapi.com/casestudies/transfergo#more-details-about-asyncapi)). Значит, один глобальный «owner документации» был бы неверной моделью.

AsyncAPI `info` содержит API title, version, description, contact, tags и external docs; сама версия API явно не равна версии спецификации ([AsyncAPI 3.0, Info Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#infoObject)).

### 7. Новые проверяемые пробелы должны войти в существующий Problems, а не в новый score

Минимальный documentation-quality view должен перечислять только проверяемые недостатки представления:

- нет summary/description;
- нет owner/contact;
- нет payload/schema или example;
- unresolved reference;
- нет ни одной подтверждённой producer/consumer relationship;
- одинаковое имя имеет несколько несовпадающих контрактов.

Свободный текст summary/title нельзя надёжно превратить в правило направления. Противоречие вроде примера TransferGo можно обнаружить только при наличии второго структурированного источника или показать читателю как source text рядом с точным `send`/`receive`; эвристический lint текста в обязательный объём не входит.

Это не отдельный dashboard, score или CI gate. Portolan уже имеет Problems и async drift rules; достаточно добавить туда лишь те concrete conditions, которые появятся с first-class AsyncAPI contracts. TransferGo прямо называет trust и visibility проблемой на масштабе 300+ каналов, а Event Catalog помог выделить сценарии, требующие внимания ([AsyncAPI case study](https://www.asyncapi.com/casestudies/transfergo#challenges), [TransferGo story](https://www.asyncapi.com/blog/transfergo-asyncapi-story#event-catalog)).

## Nice-to-have после базового каталога

### История версий и schema diff

Полезно для ответа «что изменилось и затронет ли это меня», но сначала каталог должен надёжно идентифицировать current contract и его consumers. EventCatalog уже демонстрирует выбор версии и side-by-side schema comparison на schema page ([EventCatalog Schema Explorer](https://www.eventcatalog.dev/docs/development/guides/resources/schemas/explore-schemas/schema-explorer#schema-tabs)).

### Поиск и lineage по полям payload

Задачи вроде «в каких сообщениях есть `transactionId`?» и «кто потребляет поле `currency`?» ценны, но требуют отдельного индекса схем и корректного field identity. EventCatalog Fields Explorer ищет поля по path/type/description и трассирует producer → message → consumer; Consumer Field Usage требует отдельно заявить, какие поля реально читает consumer ([Fields Explorer](https://www.eventcatalog.dev/docs/development/guides/resources/schemas/explore-schemas/fields-explorer), [Consumer Field Usage](https://www.eventcatalog.dev/docs/development/guides/resources/schemas/explore-schemas/consumer-field-usage)). Без таких данных нельзя честно вывести field-level impact из одного AsyncAPI.

### Курируемые business flows

Flow полезен для нескольких важных пользовательских сценариев и для объяснения branching/failures, но AsyncAPI не содержит бизнес-последовательность целиком. Это отдельный authored resource, а не автоматически достраиваемая «полная трасса». EventCatalog позволяет проходить flow пошагово и группировать steps по domain/system/team ([EventCatalog Explore flows](https://www.eventcatalog.dev/docs/development/guides/resources/flows/explore-flows)).

### Changelog и lifecycle/deprecation narratives

Имеют смысл, когда команды готовы поддерживать объяснение причин изменений. Автоматический diff схемы и написанный человеком changelog — разные вещи. EventCatalog рассматривает changelog как отдельный Markdown-документ для контекста изменения ([EventCatalog channel changelogs](https://v2.eventcatalog.dev/docs/development/guides/channels/changelog)).

### Персонализация

Favorites, recently viewed, saved views и team landing pages ускоряют повторные сценарии, но не компенсируют отсутствие нормального search, identity и cross-navigation.

### Copy snippets и «как подключиться»

SDK snippets, CLI publish examples и download artifacts полезны после появления надёжного server/protocol/binding представления. Они не должны генерироваться из неполных connection details.

## Что не нужно добавлять в рамках этой задачи

- собственный AsyncAPI editor;
- code generation или DTO reflection;
- validation/optimization/scoring pipeline;
- contract-test results и runtime health;
- автоматическое сравнение с deployed infrastructure;
- Port.io-style scorecards или self-service actions;
- AI/chat как замена search и явной навигации;
- одна глобальная интерактивная диаграмма всех сервисов и каналов как главный экран;
- произвольный «schema quality score», скрывающий конкретные документальные пробелы.

Эти возможности могут быть полезны продукту в других эпиках, но не являются ответом на задачу «быстро найти и понять внутренний async contract».

## Рекомендуемый объём первого релиза

1. **Добавить `/messaging`:** одна table-driven index page с режимами Channels и Messages поверх всех `service.channels` declarations.
2. **Сделать lookup пригодным для масштаба:** поиск по address/name/title/doc и фильтры context, service, protocol, direction и problem state; состояние и selection сохраняются в URL.
3. **Показывать claims, а не выдуманную глобальную сущность:** service/application, send/receive, source и evidence рядом с каждой записью; совпавшие address/name группируются для сравнения, но не сливаются без доказательства.
4. **Дать выбранной записи relationship detail:** известные sending/receiving services, связанные domain event и Problems, каналы/сообщения и переход к точному service Bus declaration.
5. **Расширить существующую command palette:** channel address и AsyncAPI-only message name ведут в тот же inventory/selection.
6. **Добавить стабильные anchors в Bus tab и тот же inventory в documentation exports**, чтобы ссылка оставалась полезной вне интерактивного приложения.

Этот релиз не требует менять catalog schema или парсить payload. После измерения использования следующий самостоятельный этап — scoped identity, payload/headers/examples/parameters/bindings и first-class message/channel pages. Новый service page, raw renderer, search engine, Problems dashboard и глобальный canvas не нужны: соответствующие Portolan mechanics уже существуют.

## Проверка результата на пользовательских задачах

Релиз можно считать достаточным для сценария TransferGo, если читатель может без открытия YAML:

1. по имени сервиса увидеть всё, что он отправляет и получает;
2. по имени сообщения найти все scoped declarations, отправителей/получателей и открыть точный rendered contract с payload/example;
3. по адресу канала увидеть разрешённые сообщения, связанные service operations и provenance каждого claim;
4. перейти из relationship detail к сервису, точному Bus declaration и источнику факта;
5. поделиться URL, который сохраняет выбранную запись и фильтры inventory;
6. отличить `unknown` от «нет consumers» и source fact от агрегированной/inferred связи;
7. при одинаковых именах понять, это один подтверждённый контракт или несколько scoped occurrences.

Если эти задачи не решены, schema diff, AI-поиск и красивые глобальные диаграммы не устраняют исходную проблему discoverability и доверия.

## Источники

- [AsyncAPI case study: TransferGo](https://www.asyncapi.com/casestudies/transfergo)
- [How TransferGo adopted AsyncAPI](https://www.asyncapi.com/blog/transfergo-asyncapi-story)
- [AsyncAPI Specification 3.0.0](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
- [EventCatalog: Search](https://www.eventcatalog.dev/docs/development/customization/search)
- [EventCatalog: Schema Explorer](https://www.eventcatalog.dev/docs/development/guides/resources/schemas/explore-schemas/schema-explorer)
- [EventCatalog: Domain diagram](https://www.eventcatalog.dev/docs/development/guides/domains/visualize-domains/domain-diagram)
- [EventCatalog: Routing messages through channels](https://v2.eventcatalog.dev/docs/development/guides/channels/adding-messages-to-services)
- [EventCatalog: Service resources page](https://www.eventcatalog.dev/docs/development/guides/resources/services/resources-page)
- [EventCatalog: Fields Explorer](https://www.eventcatalog.dev/docs/development/guides/resources/schemas/explore-schemas/fields-explorer)
- [EventCatalog: Consumer Field Usage](https://www.eventcatalog.dev/docs/development/guides/resources/schemas/explore-schemas/consumer-field-usage)
- [Port: Global Search](https://docs.port.io/interface-builder/global-search/)
