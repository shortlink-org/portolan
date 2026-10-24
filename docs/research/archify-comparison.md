# Archify: конкурентный срез для Portolan

Дата исследования: 2026-10-24. Источники ограничены официальным сайтом Archify и официальным репозиторием `tt-a1i/archify`. Состояние Portolan взято из текущего `README.md`; это не полный UI-аудит.

## Короткий вывод

Archify и Portolan пересекаются в визуальном объяснении архитектуры, но решают разные главные задачи:

- **Archify** — локальный Agent Skill для ответа на один вопрос: агент пишет typed JSON или Markdown, а Archify выпускает проверяемый интерактивный HTML-артефакт. Его сильная сторона — «последняя миля»: понятный формат ответа, управляемое исследование диаграммы, экспорт, доказательства и проверенная доставка.
- **Portolan** — долговечный каталог архитектуры, извлекаемый из code/specs/traces/ADRs и объединяемый на уровне всего estate. Его сильная сторона — ширина и честность модели: происхождение фактов, семантические сущности, проверки архитектурных правил, branch drafts и много источников.

Главная возможность для Portolan — не копировать генератор произвольных диаграмм, а перенести лучшие reader-facing механики Archify поверх уже более богатой модели: «ответ как страница», вопрос-ориентированные виды, share/export, проверка конечного UI и точечное продолжение разговора.

## Что подтверждено первичными источниками

### Формат продукта и позиционирование

Archify позиционируется как open-source Agent Skill: принимает описание, план, Mermaid или доказательства из репозитория; агент готовит typed JSON для диаграммы либо Markdown для one-page answer, после чего локальные renderers создают автономный HTML. Сам Archify подчёркивает, что это **не** hosted collaboration service и **не** универсальный WYSIWYG-редактор. Проверка гарантирует целостность authored artifact, но не истинность каждого утверждения и не реальное runtime-поведение системы. [Официальный product FAQ](https://archify.si/#product-facts), [README](https://github.com/tt-a1i/archify#readme)

Это существенно отличается от Portolan: Archify оптимизирован под артефакт для конкретного вопроса, Portolan — под постоянно пересобираемую модель estate.

### Десять типов диаграмм

Поддерживаются Architecture, Workflow, Sequence, Data Flow, Lifecycle, ERD, Class, Tree, Timeline и Waterfall. Для каждого типа сайт формулирует вопрос, на который он отвечает, а Scenario Guide дополнительно задаёт границы применения, обязательные evidence и copy-ready prompt. [Официальный обзор типов](https://archify.si/#diagram-types), [Scenario Guide](https://archify.si/guide)

Из них в текущем README Portolan явно заявлены C4/architecture, dependency/context maps, dynamic flow views, ER canvases и state-machine cards. Отдельные first-class виды Class, Tree, Timeline и Waterfall там не заявлены. Это означает «не заявлено», а не доказанное отсутствие во всём коде.

### One-page answers

Версия 3.2 добавила conclusion-first страницы: один panel на вопрос, prose, tables, steps, checklists, charts, code и нативные валидируемые диаграммы. Шаги могут синхронно подсвечивать части диаграммы; клик по node открывает полный viewer; citations и source-linked nodes открывают source cards. Пользователь может сформировать follow-up для выбранного panel/фрагмента, а команда patch заменяет один panel, сохраняя остальные. Есть четыре стиля (clean/editorial/product/Swiss), light/dark, long-image export и печать в PDF. [Официальный release v3.2.0](https://github.com/tt-a1i/archify/releases/tag/v3.2.0), [живые примеры в Proof Lab](https://archify.si/gallery#explainers)

У Portolan есть Ask the catalog и богатые entity/flow pages, но в README не заявлен сохраняемый conclusion-first answer artifact, собранный вокруг вопроса, с независимым patch одного panel. Это наиболее сильный продуктовый пробел для обсуждения.

### Reader UX

Автономный viewer поддерживает:

- поиск и фокус node;
- upstream/downstream reach без заявления о runtime impact;
- инспекцию и проигрывание authored route;
- semantic lens для сравнения ролей и overview radar;
- presentation stage, zoom/reset, тему и visual style;
- стабильные hash-links на focus, reach, relation, route и lens;
- уважение `prefers-reduced-motion`;
- contextual Diagram Guide;
- клавиатурное управление.

Эти возможности и конкретные controls перечислены в [официальном README, Explore and share the output](https://github.com/tt-a1i/archify#explore-and-share-the-output) и на [главной странице](https://archify.si/#quick-start).

Portolan уже сильнее в переходах между сущностями, поиске, breadcrumbs, backlinks, recent/pins и источниках, но отдельные «режимы чтения» route/reach/lens/presentation и shareable deep links на состояние диаграммы в README не заявлены.

### Sharing и экспорт

Основной deliverable — один self-contained HTML без server/runtime dependency для просмотра. Viewer экспортирует PNG, JPEG, WebP, dual-theme SVG, WebM и clipboard; raster export заявлен до 4×. Route и reach можно выгрузить как share card 1200×630; one-page answer — как long image или PDF. Внешние ссылки внутри артефакта, разумеется, требуют сети. [Официальный раздел Output](https://archify.si/#output), [README Preview](https://github.com/tt-a1i/archify#preview)

Portolan публикуется статически и имеет Mermaid/Backstage/DX exports, но README не обещает single-file snapshot текущего вида, media exports из viewer или share cards. Это хороший слой поверх существующего каталога, особенно для PR, incident review и onboarding.

### Проверенная доставка

Официально описан pipeline `validate → deliver → check → browser-check`:

- schema, IDs/references и layout constraints;
- рендер во staging-файл рядом с target и атомарная замена только после успешных checks;
- повторное чтение доставленного HTML и receipt с hash исходника и конечного файла;
- браузерная проверка Chrome на нескольких desktop viewport: overflow, читаемость текста и controls;
- browser-check обязателен для диаграмм, для one-page answers — по запросу;
- поздний check failure сообщается, но не откатывает уже доставленный файл.

Это подтверждается [официальным описанием Verified delivery](https://archify.si/#verified-delivery). Proof Lab показывает реальные HTML, JSON IR и receipts, но честно уточняет: gallery фиксирует automated structure/layout checks, а не человеческий visual review. [Proof Lab](https://archify.si/gallery)

Portolan уже валидирует merged model и generated LikeC4 against catalog. Полезный заимствуемый принцип — отдельный end-product contract: проверять именно доставленную страницу/диаграмму на viewport и выдавать machine-readable receipt, а не считать успешную генерацию доказательством хорошего UI.

### Источники и evidence

Nodes и page claims могут ссылаться на источники; repository links закрепляются на полном commit GitHub/GitLab, а page показывает code excerpt в source card. Changelog также описывает проверку Git top-level, origin, commit, blob, path containment и line bounds и упоминает GitHub, Gitee и `local-only`. [Официальный Output](https://archify.si/#output), [Changelog 2.12.0](https://github.com/tt-a1i/archify/blob/main/CHANGELOG.md#2120--2026-07-19)

Portolan уже делает source provenance частью каталога и показывает inline code window, поэтому здесь скорее UX-ориентир, чем новый фундамент.

### Изменения и итерация

Typed source сохраняется для точечных правок через chat. `archify compare` рисует before/after архитектуры как delta diagram (added/removed/rerouted relationships) и выпускает machine-readable receipt. Для explainer доступен patch отдельного panel. [Официальный README Quick start](https://github.com/tt-a1i/archify#quick-start), [официальный раздел Output](https://archify.si/#output)

Portolan branch drafts семантически богаче: сравниваются entity versions в контексте всего каталога. Визуальный delta-режим Archify может подсказать компактное представление уже имеющихся draft-данных.

### Установка и интеграции

Официальные инструкции покрывают Claude Code, Codex, Cursor, OpenCode и GitHub Copilot через один Skill; есть Claude.ai/Project Knowledge варианты с ограничениями среды и community integrations для Hermes Agent и DeepSeek Harness. Нужен Node.js 18+ для основной Skill-сборки. Это интеграции с agent hosts, а не integrations с системами-источниками архитектуры. [Installation options](https://github.com/tt-a1i/archify#installation-options), [Quick start](https://archify.si/#quick-start)

У Portolan гораздо больше data-source integrations/extractors. Но установка Archify ближе к нулевому порогу: одна команда и одна фраза агенту. Для Portolan полезен agent-native entry point, который знает каталог и создаёт bounded answer/view без изучения интерфейса.

### Локальность, privacy, deployment и цена

- Archify бесплатен и open source, renderers и Skill лицензированы MIT; отдельного платного Archify-тарифа в официальных материалах не заявлено. Третьесторонние online services и их paid plans не являются Archify. [README](https://github.com/tt-a1i/archify#readme), [MIT License](https://github.com/tt-a1i/archify/blob/main/LICENSE)
- Это локальный CLI/Skill, не hosted service; получатель HTML не обязан устанавливать Archify. [Product FAQ](https://archify.si/#product-facts), [README: Download it](https://github.com/tt-a1i/archify#download-it-open-it-explore-it)
- В stable installation есть optional update check: GET фиксированного manifest; сервер видит обычные HTTP metadata (IP/time), но по официальному описанию не получает version, agent, project data, prompts, account/device ID или ETag. Он не скачивает/ставит обновления автоматически и отключается через `ARCHIFY_UPDATE_CHECK_DISABLED=1`. Это заявление maintainer, а не независимый privacy audit. [README: update checks](https://github.com/tt-a1i/archify#quick-start)
- Заявление «zero runtime dependencies» относится к готовому артефакту/установленному renderer flow; разработка самого репозитория имеет dev dependencies. [Product page](https://archify.si/#output), [официальный package.json](https://github.com/tt-a1i/archify/blob/main/archify/package.json)

## Подтверждённые ограничения

Archify сам ограничивает свои обещания:

- validation проверяет authored artifact, не фактическую истинность claims и не runtime behavior;
- не генерирует photos/illustrations;
- не является hosted collaboration service или general-purpose WYSIWYG;
- Mermaid — один из входов, но не обещано автоматическое покрытие каждой конструкции;
- доступность экспортов зависит от artifact type, browser и local tooling;
- агент, его модель, доступ к файлам и нужные инструменты остаются частью среды пользователя.

Источник: [официальный Product facts FAQ](https://archify.si/#product-facts).

## Маркетинговые утверждения, которые нельзя считать доказанными

Следующие формулировки стоит воспринимать как positioning, а не установленный факт:

- «answers you can trust» и «the whole system, in one readable frame»;
- «beautiful» и общая обещанная читаемость;
- пригодность для «any idea, plan, or codebase»;
- реальная экономия времени и качество agent-generated content;
- достаточность layout checks для человеческого понимания.

Proof Lab повышает доверие: можно открыть artifact, JSON IR и receipt. Но сам сайт уточняет, что automated checks не заменяют human visual review, а truth of claims не валидируется. Поэтому доказаны работающие примеры и механика checks, но не универсальное качество на произвольных входах.

## Идеи для Portolan, в порядке потенциальной ценности

1. **Answer artifact поверх каталога.** «Ответить как страница» на вопрос пользователя: conclusion first, panels, source-backed claims, встроенные существующие flow/C4/ER views, permalink и экспорт. Главное преимущество Portolan — ответ строится не из свободно придуманного JSON, а из merged catalog.
2. **Question-first view chooser.** На входе спрашивать не тип диаграммы, а «что нужно понять», затем предлагать bounded view и required evidence. Сценарии: ownership boundary, request chain, event topology, incident/runbook, deployment change, branch impact.
3. **Share/export layer.** Single-file snapshot выбранного вида, PNG/SVG/clipboard, route/draft share card и сохранение текущего focus/path/version в URL.
4. **Reader modes для существующих графов.** Upstream/downstream reach, finite path playback, presentation mode и semantic lens. В Portolan они могут опираться на реальные call/event/data-lineage semantics, а не только authored edges.
5. **End-product verification receipt.** После `gen` проверять конкретные user-visible regions на целевых viewport, фиксировать hashes, overflow/readability/source consistency и не подменять этим human visual review.
6. **Panel-scoped follow-up.** Из страницы/панели генерировать точный prompt для Ask the catalog; результат обновляет только выбранный answer panel, не постоянную модель estate.
7. **Visual delta branch drafts.** Превратить уже имеющийся entity diff в компактный added/removed/rerouted diagram и shareable artifact для PR.
8. **Agent-native onboarding.** Skill/command вроде «прочитай Portolan catalog и объясни X», который открывает bounded answer без необходимости заранее знать страницы и сущности продукта.

## Что не стоит копировать

- Не смещать источник истины из extractors/catalog в agent-authored JSON: это разрушит ключевое отличие Portolan.
- Не обещать truth через layout/schema validation: отделять integrity артефакта, provenance фактов и наблюдаемое runtime evidence.
- Не расширяться в бытовые планы и generic diagramming, пока core architecture workflows не доведены: у Archify это growth surface, у Portolan — вероятное размытие positioning.
- Не делать animation самоцелью. Ценность есть только там, где motion объясняет route, state transition или delta.

## Рекомендуемый первый эксперимент

Сделать один source-backed «answer page» для вопроса: **«Что изменит эта ветка и какие потоки/контракты она затрагивает?»**

Он использует уникальные данные Portolan (branch draft, affected entities, flows, problems, source lines), но заимствует у Archify форму: conclusion, 3–5 panels, синхронная подсветка шага и диаграммы, citations, точечный follow-up, permalink и export. Это проверит конкурентную гипотезу без превращения Portolan в generic diagram generator.
