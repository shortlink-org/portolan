# extract-java

A Java service in, a catalog fragment out. The fifth extractor, and the first
that reads a language with a vocabulary for the model.

Go, TypeScript, Rust and Python have no word for "aggregate root", so those
extractors infer the role of a class from where it sits. Java does have one:
[jMolecules](https://github.com/xmolecules/jmolecules) writes `@AggregateRoot`,
`@Entity`, `@ValueObject`, `@Repository` and `@DomainEvent` into the source, and
Spring Modulith writes `@ApplicationModuleListener`. So here the code *declares*
its own model and this reads the declaration. Where the annotations are absent
the layout answers instead, and that is said in a diagnostic — a guess and a
claim should not read the same on the page.

Written in Java, **JDK only**: no Gradle, no Maven, no third-party library. The
parser is javac's own — `com.sun.source.util.JavacTask`, stopped after `parse()`
— which is the same stance every other extractor takes (`syn` for Rust, `ast`
for Python, oxc for TypeScript). Nothing is resolved and no classpath is
assembled: the service's dependencies are not this plugin's to fetch, and what
is read is what the author wrote. The protocol's JSON is read and written by
`Json.java`, because the JDK ships no JSON API and pulling one in would need the
build system this avoids.

## The layout it reads

```
src/main/java/<package>/
  domain/<aggregate>/
    Payment.java              @AggregateRoot - the root; failing that, the class named after the package
    Posting.java              @Entity
    vo/Money.java             @ValueObject, usually a record
    event/PaymentCaptured.java  @DomainEvent, with NAME and CHANNEL constants
    PaymentRepository.java    @Repository - the port whose other end is the store
    PaymentGateway.java       @SecondaryPort - a port to somebody else's system
    PaymentStatus.java        the states, and TRANSITIONS beside them
  application/<aggregate>/usecase/
    AuthorizePayment.java     @Service, one public method - handle, execute, or the only one
  application/policy/
    VoidPaymentOnOrderCancelled.java   @ApplicationModuleListener, the event is the argument's type
  infrastructure/transport/grpc/<aggregate>/
    PaymentGrpcService.java   @GrpcService
    proto/**/*.proto          the contract it answers, vendored
  infrastructure/<peer>/
    OrderClient.java          the adapter, @SecondaryAdapter or a class filling a port
    proto/**/*.proto          the callee's contract, vendored narrow
  infrastructure/bus/Bus.java  how an event leaves
```

## What becomes what

**Aggregate.** A package under `domain` is one. Its root is the class saying
`@AggregateRoot`; without one, the class named after the package, and a
diagnostic saying the role was read off the layout. Every `@Entity` beside it
is an entity, the root included and first; every `@ValueObject` is a value
object. Fields keep the type as written — `Association<Object, String>` stays
that, because a typed reference to another aggregate is a fact worth seeing.
A class that extends an exception is a sentinel - what a command refuses with
- and a class under the aggregate's `services` package is a domain service;
neither holds anything of the aggregate, so neither is a block of it. The doc
of anything is its javadoc, first paragraph.

**Event.** A class saying `@DomainEvent`, or any class in the aggregate's
`event` package. Its `NAME` constant is the name on the wire and `CHANNEL` is
where it goes out; without a `NAME` the wire name is assumed from the service
and that is reported. A record's components are the payload.

**Operation.** A class saying `@Service` — jMolecules' one — or a class under
`application/**/usecase`. Its entry is `handle`, `execute`, or the single public
method it has. It is a command when it saves, deletes, publishes or sends, and
a query when it does not. `exposedBy` names the rpcs that run it.

**Endpoint.** A method of a `@GrpcService` whose name is an rpc of the contract
vendored beside it — `getOrder` and `GetOrder` are one name. The endpoint's id
is the proto's spelling, so what this says and what `extract-proto` puts in
`provides` are the same string; an rpc the contract declares and no method
answers is reported.

**Lifecycle.** Read off the table the code keeps, never off the branches of the
methods: a `TRANSITIONS` map beside the status enum, and the method of the root
that assigns `this.status` is the mover. `emits` is the event the mover's return
type names. An edge the table has and no method makes, a move into a state the
enum lacks, and a status assigned to something the states do not name are each
reported.

**Ports, and the difference between them.** A port is an interface of the
domain, and what a call on it means depends on which one it is. A `@Repository`
(or a name ending in `Repository`) is the store: the call is a hop into the
service's own database. Any other port is filled by an adapter under
`infrastructure/<peer>/`, and the call goes wherever that adapter reaches — an
rpc named by the contract vendored beside it, or, when there is no contract
because the far end is a third party, the adapter's own method, recorded and
left unresolved. A port nothing fills at all is reported. A port a use case
declares for itself, under `application`, is filled the same way, by the
adapter that implements it; and an adapter's method is the rpc it is named
after or, when the port speaks the use case's words rather than the
contract's, the rpc its body invokes on the stub. A port named for publishing
- `Publisher`, `Bus`, or a name ending in `Events` - is the bus wherever it is
declared, and a call on it is an event leaving.

A call made inside the condition of an `if` is a hop before the branch it
decides. **Flow, from an endpoint.** Each handler method opens one: `client → service :
rpc <rpc>`, then the steps of every use case it runs, in order. **Flow, from a
policy.** Each `@ApplicationModuleListener`, `@EventListener` or
`@DomainEventHandler` method opens one on the bus: `bus → service
: event <ref>`, where the event is the type of its argument — one of this
service's own, or another service's placed by the manifest's `events`.

**Inside a body.** Statements are read in source order, and a chain left to
right. `if` becomes an alt when some arm holds a hop, and a branch ending in a
return or a throw is terminal; a `for`, a `while` and a `catch` are a note on
the steps inside them. A call into another use case is followed, two deep at
most. Every step is `declared`.

## What it does not read

Named here rather than left to be discovered: **JPA mappings** (the schema is
`extract-sql`'s to read, off the migrations), **Spring configuration**,
**`@RestController` routes** (the class is read, the route is the OpenAPI
document's business), **Axon's** event sourcing annotations, and **records of
what ran** — every step here is a claim about behaviour, not a recording.

## Options

```json
{
  "context": "payments",
  "service": "ledger",
  "store": "pg",
  "peers": { "shop.v1": "shop.oms" },
  "events": { "org.portolan.payments.ledger.infrastructure.oms.event": "shop.oms.order" },
  "source": "src/main/java",
  "out": "domain.json"
}
```

`peers` is keyed by the proto package of the contract vendored beside an
adapter; `events` by the package a listener reads a foreign event from.
Everything else means what it means for `extract-ts`.

## Building, and running it

```bash
javac --release 21 -d plugins/extract-java/build plugins/extract-java/src/org/portolan/extract/*.java
java -cp plugins/extract-java/build org.portolan.extract.Main
```

The first line is in `plugins:build`, so `npm run schema` and `npm run gen`
compile it before they ask it anything. Startup is a tenth of a second, which is
why it is a jar-less class directory and not a Gradle run.

## Tests

```bash
javac --release 21 -d plugins/extract-java/build -cp plugins/extract-java/build \
    plugins/extract-java/test/org/portolan/extract/ExtractTest.java
java -cp plugins/extract-java/build org.portolan.extract.ExtractTest
```

The reader is held to `testdata/ledger`: a service in the layout above with each
shape it claims to read present once, against the golden `expected.json`, plus
the claims named one at a time so a failure says which rule stopped being true.
`UPDATE_GOLDEN=1` writes the golden again after a deliberate change.
