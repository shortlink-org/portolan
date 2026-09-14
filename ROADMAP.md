# Portolan roadmap

Этот документ собирает открытые идеи и проблемы Portolan. Завершённые задачи
из roadmap удаляются.

## Статусы

- **open** — проблема подтверждена, решения ещё нет.
- **investigate** — симптом подтверждён, но сначала нужно выбрать модель решения.
- **source quality** — Portolan корректно сообщает о недостатке в исходном
  проекте; можно улучшить диагностику или добавить явную конфигурацию.

## P2 — качество извлечения и UX

### PORTOLAN-21. Показывать feature-ветки в общем каталоге как draft

**Status:** open

Если feature-ветка добавляет то, чего на main ещё нет (flow, шаг, сервис,
событие), читатель должен видеть это в общем каталоге на своём месте с
пометкой `draft`, именем ветки и ссылкой на PR.

- Пикер веток: на каждую feature-ветку своя галочка, по умолчанию все
  выключены. Выбор живёт у читателя и не меняет сгенерированный main-каталог.
- Draft-сущность несёт source evidence из своей ветки и исчезает после мержа
  или удаления ветки.
- Конфликт (один идентификатор изменён и на main, и в ветке): показывать обе
  версии, ветвевая помечена `draft`.

Открытые вопросы: откуда брать список веток и PR (fetch-git, forge API), где
хранить извлечение по ветке (отдельный snapshot на ветку), как считать
«добавляет», а не «меняет».

### PORTOLAN-22. Go extractor: unpack embedded structs and interfaces

**Status:** open

An embedded field is read as one field named after its type, so an event that
embeds `ddd.Base` lists a `ddd.Base` row instead of the `aggregateID` and
`occurredAt` it actually carries, and an interface that embeds another lists
nothing of the embedded method set.

The reader should resolve the embedded type - in the same package, or in an
imported one reached through the module's `replace` directives and the module
cache - and splice its fields and methods in place of the embedded row,
recursively. When the package cannot be found, today's behaviour stays.

Follows the `pkg/ddd/event` change that made embedding `Base` the house style
for domain events.
