package org.portolan.extract;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The reader, held to a fixture.
 *
 * No framework, because the plugin has no dependencies and a test that needed
 * one would put a build system back. Compiled beside the plugin, since it reads
 * the same package:
 *
 * <pre>
 * javac -d plugins/extract-java/build -cp plugins/extract-java/build \
 *     plugins/extract-java/test/org/portolan/extract/ExtractTest.java
 * java -cp plugins/extract-java/build org.portolan.extract.ExtractTest
 * </pre>
 *
 * UPDATE_GOLDEN=1 writes `testdata/ledger/expected.json` again after a
 * deliberate change, and the diff is the review.
 */
public final class ExtractTest {

    private static final List<String> FAILURES = new ArrayList<>();

    public static void main(String[] args) throws Exception {
        Path cwd = Path.of("").toAbsolutePath();
        Protocol.Builder b = new Protocol.Builder();
        Protocol.Options options = Protocol.Options.of(Json.parse("""
                {
                  "context": "payments",
                  "service": "ledger",
                  "store": "pg",
                  "peers": { "shop.v1": "shop.oms" },
                  "events": { "org.portolan.payments.ledger.infrastructure.oms.event": "shop.oms.order" }
                }
                """));
        Extract.run(
                new Protocol.Input("plugins/extract-java/testdata/ledger", "abc1234", "2026-09-05T00:00:00Z"),
                options,
                b,
                cwd);

        Map<String, Object> response = b.response();
        List<?> files = (List<?>) response.get("files");
        String fragment = String.valueOf(((Map<?, ?>) files.get(0)).get("contents"));

        golden(cwd.resolve("plugins/extract-java/testdata/ledger/expected.json"), fragment);
        claims(Json.object(Json.parse(fragment)), b.warnings());

        if (FAILURES.isEmpty()) {
            System.out.println("extract-java: every claim holds");
            return;
        }
        FAILURES.forEach(failure -> System.out.println("FAIL " + failure));
        System.exit(1);
    }

    /** The whole fragment, against the record of what it was. */
    private static void golden(Path path, String fragment) throws Exception {
        if ("1".equals(System.getenv("UPDATE_GOLDEN"))) {
            Files.writeString(path, fragment);
            System.out.println("golden rewritten: " + path.getFileName());
            return;
        }
        String want = Files.readString(path);
        if (!want.equals(fragment)) {
            FAILURES.add("the fragment differs from expected.json" + firstDifference(want, fragment));
        }
    }

    /** The claims the golden holds, named one at a time. */
    private static void claims(Map<String, Object> fragment, List<?> warnings) {
        Map<String, Object> service = Json.object(Json.array(Json.object(Json.array(fragment.get("contexts")).get(0)).get("services")).get(0));
        Map<String, Object> aggregate = Json.object(Json.array(service.get("aggregates")).get(0));

        is("the aggregate is the one the annotation declares", "payments.ledger.payment", aggregate.get("id"));
        is("the root is the annotated class", "Payment", aggregate.get("root"));
        is("an @Entity beside it is an entity", "[Payment, Posting]", names(aggregate.get("entities")));
        is("a @ValueObject is a value object", "[Money]", names(aggregate.get("valueObjects")));

        is("a use case is a @Service, and a write makes it a command",
                "[AuthorizePayment=command, CapturePayment=command, GetPayment=query]",
                pairs(aggregate.get("operations"), "id", "kind"));
        is("the endpoint that runs an operation names it, by the rpc the contract declares",
                "[AuthorizePayment=[Authorize], CapturePayment=[Capture], GetPayment=[GetPayment]]",
                pairs(aggregate.get("operations"), "id", "exposedBy"));

        is("an event carries the name it travels under",
                "[PaymentAuthorized=ledger.PaymentAuthorized, PaymentCaptured=ledger.PaymentCaptured, PaymentDeclined=ledger.PaymentDeclined]",
                wires(aggregate.get("events")));

        Map<String, Object> lifecycle = Json.object(aggregate.get("lifecycle"));
        is("the states are the enum's, in the order it declares them",
                "[PENDING, AUTHORIZED, CAPTURED, DECLINED, VOIDED]", String.valueOf(lifecycle.get("states")));
        is("every edge of the table is made by a method",
                "[PENDING->AUTHORIZED by authorize, AUTHORIZED->CAPTURED by capture, PENDING->DECLINED by decline, AUTHORIZED->VOIDED by voidAuthorization]",
                moves(lifecycle.get("transitions")));

        is("a call to another service is the id the callee would give it",
                "[psp/reserve=unresolved, psp/settle=unresolved, shop.v1.OrderService/GetOrder=declared]",
                pairs(service.get("consumes"), "id", "status"));

        List<?> flows = Json.array(fragment.get("flows"));
        is("an endpoint opens a flow and a listener opens one from the bus",
                "[ledger-authorize, ledger-capture, ledger-get-payment, ledger-void-payment-on-order-cancelled]",
                slugs(flows));

        // The gateway is a port too, and the difference is where it lands: a
        // repository is the store, a gateway is somebody else's system.
        Map<String, Object> authorize = Json.object(flows.get(0));
        List<?> steps = Json.array(authorize.get("steps"));
        is("a repository call lands in the store", "ledger-pg", Json.object(steps.get(4)).get("to"));
        is("a gateway call lands on the peer's lane", "psp", Json.object(steps.get(2)).get("to"));
        is("and stays unresolved, because nothing in the catalog answers it", "unresolved", Json.object(steps.get(2)).get("status"));

        is("what it reports beside the fragment", 2, warnings.size());
    }

    private static String names(Object blocks) {
        List<String> out = new ArrayList<>();
        for (Object block : Json.array(blocks)) {
            out.add(Json.string(Json.object(block).get("name")));
        }
        return out.toString();
    }

    private static String slugs(Object flows) {
        List<String> out = new ArrayList<>();
        for (Object flow : Json.array(flows)) {
            out.add(Json.string(Json.object(flow).get("slug")));
        }
        return out.toString();
    }

    private static String pairs(Object items, String key, String value) {
        List<String> out = new ArrayList<>();
        for (Object item : Json.array(items)) {
            Map<String, Object> map = Json.object(item);
            out.add(map.get(key) + "=" + (map.get(value) == null ? "[]" : map.get(value)));
        }
        return out.toString();
    }

    private static String wires(Object events) {
        List<String> out = new ArrayList<>();
        for (Object event : Json.array(events)) {
            Map<String, Object> map = Json.object(event);
            out.add(map.get("name") + "=" + Json.object(map.get("wire")).get("name"));
        }
        return out.toString();
    }

    private static String moves(Object transitions) {
        List<String> out = new ArrayList<>();
        for (Object transition : Json.array(transitions)) {
            Map<String, Object> map = Json.object(transition);
            out.add(map.get("from") + "->" + map.get("to") + " by " + map.get("on"));
        }
        return out.toString();
    }

    private static void is(String claim, Object want, Object got) {
        if (!String.valueOf(want).equals(String.valueOf(got))) {
            FAILURES.add(claim + "\n  want: " + want + "\n  got:  " + got);
        }
    }

    private static String firstDifference(String want, String got) {
        int at = 0;
        while (at < want.length() && at < got.length() && want.charAt(at) == got.charAt(at)) {
            at++;
        }
        int from = Math.max(0, at - 60);
        return "\n  want: …" + want.substring(from, Math.min(want.length(), at + 60))
                + "\n  got:  …" + got.substring(from, Math.min(got.length(), at + 60));
    }
}
