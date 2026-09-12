# Modular Monolith with DDD, read by Portolan

[modular-monolith-with-ddd](https://github.com/kgrzybek/modular-monolith-with-ddd)
is Kamil Grzybek's reference application for a modular monolith in .NET:
five modules under `src/Modules/<Module>/{Domain,Application,Infrastructure,IntegrationEvents}`,
one API host, one SQL Server database with a schema per module, MediatR
commands and queries, domain events dispatched in process, integration
events on an in-memory bus, an outbox, an inbox and an internal command
queue per module, and one module - Payments - event-sourced. Where
CodelyTV's php-ddd-example is the small one by the book in PHP, this is the
same lesson in C#, and it is here because the layout is what
`extract-csharp-ddd` reads: nothing is annotated for the catalog.

This directory holds what the extractors produced and the commit they were
produced from, not the project's source. The paths inside the fragments
start with `vendor/repos/kgrzybek/modular-monolith-with-ddd/`, which is where
`fetch-git` would have put a copy, and that is what makes every "view
source" link on the site open the file on GitHub at the pinned commit.

| file | what it is |
| --- | --- |
| `git.repo.json` | the pin: `github.com/kgrzybek/modular-monolith-with-ddd` at `91c8ef24`, `master` on 2024-04-20, read on 2026-09-12 |
| `catalog/domain.json` | 5 contexts, 5 services, 19 aggregates and 5 model groups, 60 domain events and 7 integration events, 61 commands and 29 queries, 16 bus channels (one per integration event) and 4 internal command queues, 102 flows |
| `catalog/stores.json` | 5 SQL Server schemas as stores with 43 tables from the database project, 17 views, 145 places the code reads or writes them |
| `catalog/openapi.*.yaml` | 51 operations across four modules' controllers, one document each, inferred from the ASP.NET Core attributes |
| `catalog/adr.json` | the project's 17 architecture decision records, from `docs/architecture-decision-log` |

The fragments sit in `catalog/` rather than the usual `portolan/`, for the
reason `vendor/repos/bagisto/bagisto/README.md` gives: the estate's own
`sources` take every `vendor/repos/**/portolan/*.json`, and a showcase has
no place in its diff or its dynamic views. Its own profile reads `catalog/`.

The project's `docs/catalog-of-terms` is not read: it defines the patterns
- aggregate, command, domain event - rather than the words of MyMeetings,
and a glossary in the catalog is one context's vocabulary.

## Reproducing it

The fragments are static: no step in `portolan.json` regenerates them, and
`portolan check` does not compare them. To refresh them after a change to
the extractor or to the project, from the root of this repository, with the
.NET SDK installed:

```bash
git clone --depth 1 https://github.com/kgrzybek/modular-monolith-with-ddd /tmp/mm
git -C /tmp/mm rev-parse HEAD                              # goes into git.repo.json
npm run plugins:build                                      # builds plugins/extract-csharp-ddd/bin and the wasm
mv vendor/repos/kgrzybek/modular-monolith-with-ddd /tmp/mm-fragments   # the clone stands in for the run
ln -s /tmp/mm vendor/repos/kgrzybek/modular-monolith-with-ddd
printf '%s' '{"portolanVersion":"0.1.0","input":{"root":"vendor/repos/kgrzybek/modular-monolith-with-ddd","output":"vendor/repos/kgrzybek/modular-monolith-with-ddd/catalog"},"options":{"classification":"core","repo":"github.com/kgrzybek/modular-monolith-with-ddd"}}' \
  | dotnet plugins/extract-csharp-ddd/bin/portolan-extract-csharp-ddd.dll > /tmp/mm-out.json
node --input-type=module -e '
  import { runPlugin } from "./scripts/plugin-host.mjs";
  const root = "vendor/repos/kgrzybek/modular-monolith-with-ddd";
  const result = await runPlugin({ name: "adr", wasm: { url: "file://plugins/portolan-go.wasm" } },
    { portolanVersion: "0.1.0", input: { root, output: root + "/catalog" },
      options: { files: ["docs/architecture-decision-log/*.md"], scope: "org", history: "none", out: "adr.json" } },
    {}, { workspace: process.cwd() });
  for (const w of result.warnings) console.error("warning:", w);
  console.log(JSON.stringify(result));' > /tmp/mm-adr.json
rm vendor/repos/kgrzybek/modular-monolith-with-ddd && mv /tmp/mm-fragments vendor/repos/kgrzybek/modular-monolith-with-ddd
for out in /tmp/mm-out.json /tmp/mm-adr.json; do
  for i in $(seq 0 $(( $(jq '.files | length' $out) - 1 ))); do
    jq -j ".files[$i].contents" $out > "vendor/repos/kgrzybek/modular-monolith-with-ddd/catalog/$(jq -r ".files[$i].name" $out)"
  done
done
```

The clone stands in at the vendor path only for the run, so that the paths
the extractors write are the vendor ones. The ADR records are read with
`history: "none"` because a shallow clone has one commit and would date
every record from it; the records carry their own dates. The warnings on
stderr are part of the result: see the README's section on this example for
what they say.

## What to look at

Open the site, pick **Modular Monolith with DDD** in the catalog selector:

- **the context map** - Administration, Meetings, Payments, Registrations
  and User Access, one service each, with the integration events crossing
  between them on the in-memory bus: `NewUserRegistered` from Registrations
  to three modules, `MeetingGroupProposed` from Meetings to Administration
  and back as `MeetingGroupProposalAccepted`, `MeetingFeePaid` and
  `SubscriptionExpirationDateChanged` from Payments to Meetings.
- **user-access.module → flows → register-new-user** - the one HTTP request
  that crosses a module boundary: the User Access controller hands
  `RegisterNewUserCommand` to the Registrations module's facade, in process,
  and the flow follows it there, to `NewUserRegisteredDomainEvent` and the
  save.
- **registrations.module → flows → new-user-registered-publish-event-handler**
  - the same event heard from the outbox after the commit, and republished
  to the bus as an integration event; then, in Meetings,
  `new-user-registered-integration-event-handler` hears it and enqueues
  `CreateMemberCommand` on the module's internal queue, and
  `create-member-job` is the job that takes it.
- **meetings.module → flows → create-new-meeting** - the request, the
  meeting group read, `MeetingCreatedDomainEvent` raised by the factory and
  `MeetingAttendeeAddedDomainEvent` raised from inside it when the hosts are
  added, and the save.
- **payments.module** - the event-sourced module: aggregates with `id` and
  `version` from their own `AggregateRoot`, no table persisting them, an
  `IAggregateStore` whose calls land on the `Messages` table, and the
  `SubscriptionDetails`, `Payers`, `PriceListItems` and `MeetingFees`
  tables read as projections because the application layer writes them
  with SQL. `expire-subscriptions-scheduled` is a recurring command.
- **data** - a store per schema, the root tables with their columns mapped
  to fields through the EF configurations, `MeetingAttendees` and the other
  child tables keyed to their parents, the outbox, inbox and
  `InternalCommands` tables in every schema, and the eleven `v_*` views
  Meetings' queries read.
- **decisions** - the project's own decision log, from "Use modular
  monolith system architecture" to "Use in-memory events bus".
