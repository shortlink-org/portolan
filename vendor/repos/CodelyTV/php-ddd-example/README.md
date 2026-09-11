# CodelyTV php-ddd-example, read by Portolan

[php-ddd-example](https://github.com/CodelyTV/php-ddd-example) is CodelyTV's
reference application for Domain-Driven Design, hexagonal architecture and
CQRS in PHP: a Symfony monorepository with the bounded contexts under
`src/<Context>/<Module>/{Domain,Application,Infrastructure}`, the
deployables under `apps/<context>/<app>`, domain events on RabbitMQ and the
aggregates mapped to MySQL by Doctrine XML. Where Bagisto is the large
framework application, this is the small one laid out by the book, and it is
here because the layout is what `extract-php-ddd` reads: nothing is
annotated for the catalog.

This directory holds what the extractor produced and the commit it was
produced from, not the project's source. The paths inside the fragments
start with `vendor/repos/CodelyTV/php-ddd-example/`, which is where
`fetch-git` would have put a copy, and that is what makes every "view
source" link on the site open the file on GitHub at the pinned commit.

| file | what it is |
| --- | --- |
| `git.repo.json` | the pin: `github.com/CodelyTV/php-ddd-example` at `9271c467`, `main` on 2026-09-11 |
| `catalog/domain.json` | 4 contexts, 6 services, 5 aggregates and 2 model groups, 3 domain events, 7 commands and queries, 4 channels, 16 flows |
| `catalog/stores.json` | 2 MySQL stores with 8 tables from the Doctrine mappings, 15 places the code reads or writes them, and the Elasticsearch index the back office reads |
| `catalog/openapi.*.yaml` | 13 operations across three applications, one document each, inferred from `config/routes/*.yaml` |

The fragments sit in `catalog/` rather than the usual `portolan/`, for the
reason `vendor/repos/bagisto/bagisto/README.md` gives: the estate's own
`sources` take every `vendor/repos/**/portolan/*.json`, and a showcase has
no place in its diff or its dynamic views. Its own profile reads `catalog/`.

## Reproducing it

The fragments are static: no step in `portolan.json` regenerates them, and
`portolan check` does not compare them. To refresh them after a change to
the extractor or to the project, from the root of this repository:

```bash
git clone --depth 1 https://github.com/CodelyTV/php-ddd-example /tmp/codely
git -C /tmp/codely rev-parse HEAD                         # goes into git.repo.json
cargo build --release --manifest-path plugins/extract-php-ddd/Cargo.toml
mv vendor/repos/CodelyTV/php-ddd-example /tmp/codely-fragments  # the clone stands in for the run
ln -s /tmp/codely vendor/repos/CodelyTV/php-ddd-example
printf '%s' '{"portolanVersion":"0.1.0","input":{"root":"vendor/repos/CodelyTV/php-ddd-example","output":"vendor/repos/CodelyTV/php-ddd-example/catalog"},"options":{"classification":"core","repo":"github.com/CodelyTV/php-ddd-example"}}' \
  | ./plugins/extract-php-ddd/target/release/portolan-extract-php-ddd > /tmp/codely-out.json
rm vendor/repos/CodelyTV/php-ddd-example && mv /tmp/codely-fragments vendor/repos/CodelyTV/php-ddd-example
for i in 0 1 2 3 4; do
  jq -j ".files[$i].contents" /tmp/codely-out.json > "vendor/repos/CodelyTV/php-ddd-example/catalog/$(jq -r ".files[$i].name" /tmp/codely-out.json)"
done
```

The clone stands in at the vendor path only for the run, so that the paths
the extractor writes are the vendor ones. The warnings on stderr are part of
the result: see the README's section on this example for what they say.

## What to look at

Open the site, pick **CodelyTV php-ddd-example** in the catalog selector:

- **the context map** - Mooc, Backoffice, Analytics and Retention, with
  `CourseCreated` crossing from Mooc to Backoffice and the front end's
  in-process call back into Mooc.
- **mooc.backend → flows** - `backoffice-frontend-courses-post` is the
  interesting one: the back office's form dispatches Mooc's
  `CreateCourseCommand` on an in-memory bus, so the flow crosses to
  `mooc.backend` with a `call` step, records `CourseCreated` and saves the
  course; `mooc-increment-courses-counter-on-course-created` is the
  subscriber that hears it, reads the counter, increments it and records an
  event of its own.
- **bus** - the `domain_events` exchange with what Mooc publishes, and one
  queue per subscriber named the way `RabbitMqQueueNameFormatter` names it.
- **data** - `courses`, `courses_counter`, `videos` and the `steps` family:
  a JOINED inheritance, one table per step kind keyed to the parent's.
- **Backoffice → courses** - the read model: `BackofficeCourse` has both a
  Doctrine mapping and an Elasticsearch adapter, and the Symfony wiring
  aliases the port to Elasticsearch, so that is the store the flows reach.
