# Bagisto, read by Portolan

[Bagisto](https://github.com/bagisto/bagisto) is an open-source e-commerce
platform on Laravel: 41 packages under `packages/Webkul/`, one per module,
talking to each other through named events, with the database written as
PHP migrations. It is here as the example of a real, large application that
the small services under `examples/` are not - read by `extract-laravel`
alone, with nothing annotated for the catalog.

This directory holds what the extractor produced and the commit it was
produced from, not Bagisto's source: `packages/` is 67 MB of which the
extractor reads 8, so the tree stays where it lives. The paths inside the
fragments start with `vendor/repos/bagisto/bagisto/`, which is where
`fetch-git` would have put a copy, and that is what makes every "view source"
link on the site open the file on GitHub at the pinned commit.

| file | what it is |
| --- | --- |
| `git.repo.json` | the pin: `github.com/bagisto/bagisto` at `7b5df45a`, branch `2.4` on 2026-09-11 |
| `catalog/domain.json` | 28 model groups, 125 models, 22 enums, 309 events, 17 jobs on one queue, 610 flows |
| `catalog/stores.json` | the MySQL schema: 138 tables and 1300 columns replayed from 189 migrations, 185 foreign keys, 120 places the code reads or writes them |
| `catalog/openapi.inferred.yaml` | 520 operations across 10 route files, inferred from `Route::` declarations |

The fragments sit in `catalog/` rather than the usual `portolan/` on
purpose. The manifest's top-level `sources` - what `portolan diff` and the
LikeC4 views read - take every `vendor/repos/**/portolan/*.json`, and 610
flows of a showcase have no place in the estate's own diff or its dynamic
views. Its own profile reads `catalog/`; nothing else does. (The site still
merges every profile's sources once and filters per profile, which is why
a foreign key named `orders` in the delivery example is now told apart from
Bagisto's `orders` by who the referencing service talks to.)

## Reproducing it

The fragments are static: no step in `portolan.json` regenerates them, and
`portolan check` does not compare them. To refresh them after a change to
the extractor or to Bagisto, from the root of this repository:

```bash
git clone --depth 1 --branch 2.4 https://github.com/bagisto/bagisto /tmp/bagisto
git -C /tmp/bagisto rev-parse HEAD                      # goes into git.repo.json
cargo build --release --manifest-path plugins/extract-laravel/Cargo.toml
mv vendor/repos/bagisto/bagisto /tmp/bagisto-fragments  # the clone stands in for the run
ln -s /tmp/bagisto vendor/repos/bagisto/bagisto
printf '%s' '{"portolanVersion":"0.1.0","input":{"root":"vendor/repos/bagisto/bagisto","output":"vendor/repos/bagisto/bagisto/catalog"},"options":{"context":"commerce","contextName":"Commerce","classification":"core","service":"bagisto","serviceName":"Bagisto","repo":"github.com/bagisto/bagisto"}}' \
  | ./plugins/extract-laravel/target/release/portolan-extract-laravel > /tmp/bagisto-out.json
rm vendor/repos/bagisto/bagisto && mv /tmp/bagisto-fragments vendor/repos/bagisto/bagisto
for i in 0 1 2; do
  jq -j ".files[$i].contents" /tmp/bagisto-out.json > "vendor/repos/bagisto/bagisto/catalog/$(jq -r ".files[$i].name" /tmp/bagisto-out.json)"
done
```

The clone stands in at the vendor path only for the run, so that the paths
the extractor writes are the vendor ones. The warnings on stderr are part of
the result: see the README's section on this example for what they say.

## What to look at

Open the site, pick **Bagisto** in the catalog selector and go to the
service:

- **bus** - one queue, seventeen jobs; `send` is where a job is put on it,
  `receive` the worker. `by message` folds the two rows of a job into one.
- **data** - 138 tables laid out by model group, each group a tinted frame;
  `flow` puts them back into one left-to-right layout, the picker beside it
  switches groups off, and the search brings a table up close.
- **flows** - `shop-checkout-onepage-orders-store` is the checkout: the
  request, `Order.create` in the store lane, four events on the bus, and
  the order handed to the indexing queue, followed from the controller
  through `OrderRepository` by the constructor parameter that holds it.
- **provides** - the storefront and admin HTTP APIs, one operation per route.
