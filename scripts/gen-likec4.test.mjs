import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const generator = fileURLToPath(new URL("./gen-likec4.mjs", import.meta.url));
const likec4 = join(dirname(dirname(generator)), "node_modules", ".bin", "likec4");

/** Runs the generator over one catalog in a scratch tree, and validates what it wrote. */
function generate(catalog) {
  const root = mkdtempSync(join(tmpdir(), "portolan-likec4-"));
  mkdirSync(join(root, "data"));
  writeFileSync(
    join(root, "portolan.json"),
    JSON.stringify({ sources: ["data/*.json"] }),
  );
  writeFileSync(
    join(root, "data", "catalog.json"),
    JSON.stringify({
      generatedAt: "2026-09-06T00:00:00Z",
      commit: "0000000000000000000000000000000000000000",
      adrs: [],
      defs: {},
      ...catalog,
    }),
  );
  execFileSync(process.execPath, [generator], { cwd: root });
  execFileSync(likec4, ["validate", "likec4"], { cwd: root });
  return {
    model: readFileSync(join(root, "likec4", "model.c4"), "utf8"),
    views: readFileSync(join(root, "likec4", "views.c4"), "utf8"),
  };
}

describe("the LikeC4 generator", () => {
  it("treats dots in a root participant id as data, not containment", () => {
    const { model, views } = generate({
      contexts: [
        {
          id: "demo",
          slug: "demo",
          name: "Demo",
          summary: "",
          services: [
            {
              id: "demo.app",
              slug: "app",
              name: "App",
              repo: "example/app",
              path: "",
              readme: "",
              provides: [],
              consumes: [],
              aggregates: [],
            },
          ],
        },
      ],
      flows: [
        {
          id: "flow.jobs",
          slug: "jobs",
          name: "Jobs",
          summary: "A queued job.",
          source: "jobs.go:1",
          owner: "demo",
          participants: [
            { id: "demo.app", kind: "service", context: "demo" },
            {
              id: "river.order-jobs",
              kind: "broker",
              context: null,
              label: "River orders",
            },
          ],
          steps: [
            {
              type: "step",
              id: "enqueue",
              from: "demo.app",
              to: "river.order-jobs",
              kind: "call",
              label: "enqueue",
              status: "declared",
            },
          ],
        },
      ],
    });
    expect(model).toContain("river_order_jobs = broker 'River orders'");
    expect(views).toContain("demo.app -> river_order_jobs 'enqueue'");
    expect(views).not.toContain("river.order_jobs");
  });

  it("draws level 2 with the bus between the boxes and one labelled edge per pair", () => {
    const service = (id, slug, name, extra) => ({
      id,
      slug,
      name,
      repo: "example/shop",
      path: slug,
      readme: "",
      provides: [],
      consumes: [],
      aggregates: [],
      ...extra,
    });
    const { model, views } = generate({
      contexts: [
        {
          id: "shop",
          slug: "shop",
          name: "Shop",
          summary: "",
          services: [
            service("shop.cart", "cart", "Cart", {
              technologies: ["Go"],
              provides: [
                {
                  id: "cart.v1",
                  source: "cart/openapi.yaml",
                  methods: [{ name: "getBasket" }, { name: "checkout" }],
                },
              ],
              aggregates: [
                {
                  id: "shop.cart.basket",
                  slug: "basket",
                  name: "Basket",
                  root: "Basket",
                  entities: [
                    {
                      id: "shop.cart.basket.basket",
                      slug: "basket",
                      name: "Basket",
                      fields: [{ name: "id", type: "string" }],
                    },
                  ],
                  valueObjects: [],
                  operations: [],
                  events: [
                    {
                      id: "shop.cart.basket.BasketCheckedOut",
                      slug: "basket-checked-out",
                      name: "BasketCheckedOut",
                      versions: [
                        { version: "v1", doc: "", source: "cart.go:1", fields: [] },
                      ],
                      consumers: [{ service: "shop.oms", status: "declared" }],
                    },
                  ],
                },
              ],
            }),
            service("shop.oms", "oms", "Orders", {
              consumes: [
                {
                  id: "cart.v1/getBasket",
                  peer: "shop.cart",
                  status: "declared",
                  source: "oms/vendor/cart/openapi.yaml",
                },
                {
                  id: "cart.v1/checkout",
                  peer: "shop.cart",
                  status: "verified",
                  source: "oms/vendor/cart/openapi.yaml",
                },
              ],
            }),
          ],
        },
      ],
      stores: [
        {
          id: "shop.cart.pg",
          slug: "pg",
          name: "Cart database",
          kind: "postgres",
          owner: "shop.cart",
          tables: [],
        },
      ],
      flows: [
        {
          id: "flow.checkout",
          slug: "checkout",
          name: "Checkout",
          summary: "A basket becomes an order.",
          source: "checkout.go:1",
          owner: "shop",
          participants: [
            { id: "shop.cart", kind: "service", context: "shop" },
            { id: "bus", kind: "broker", context: null },
            { id: "shop.oms", kind: "service", context: "shop" },
          ],
          steps: [
            {
              type: "step",
              id: "s1",
              from: "shop.cart",
              to: "bus",
              kind: "event",
              label: "BasketCheckedOut",
              status: "verified",
            },
            {
              type: "step",
              id: "s2",
              from: "bus",
              to: "shop.oms",
              kind: "event",
              label: "BasketCheckedOut",
              status: "declared",
            },
          ],
        },
      ],
    });

    // What a box is built with and what it speaks, and what a store is.
    expect(model).toContain("technology 'Go · HTTP'");
    expect(model).toContain("technology 'postgres'");
    // Every relation says what kind of fact it is; a call carries its protocol.
    expect(model).toContain("shop.oms -[calls]-> shop.cart 'getBasket' 'HTTP'");
    expect(model).toContain("shop.cart -[consumes]-> shop.oms 'BasketCheckedOut'");
    // The hop through the broker, once per direction, with the step's status.
    expect(model).toContain("shop.cart -[bus]-> bus 'BasketCheckedOut' {\n    style { color verified");
    expect(model).toContain("bus -[bus]-> shop.oms 'BasketCheckedOut' {\n    style { color declared");

    // The estate's containers: contexts opened, stores and the bus named.
    expect(views).toMatch(/view containers \{[^}]*include shop, shop\.cart, shop\.oms, shop\.cart\.pg, bus\n/);
    // One edge per pair, counted, with the protocol and the best status.
    const pair =
      "include shop.oms -> shop.cart with { title '2 calls'  technology 'HTTP'  color verified  line solid }";
    expect(views).toContain(`view containers {\n    title 'Containers'`);
    expect(views.split(pair)).toHaveLength(3); // containers, and ctx_shop
    // With the bus on the picture the direct consumer arrow is not drawn twice.
    expect(views).toContain(
      "view ctx_shop of shop {\n" +
        "    title 'Shop'\n" +
        "    include *, shop.cart.pg\n" +
        `    ${pair}\n` +
        "    exclude shop.cart -> shop.oms where kind is consumes\n" +
        "  }",
    );
    // The neighbours view keeps every method as its own relation.
    expect(views).toMatch(/view svc_shop_oms of shop\.oms \{\n    title[^\n]*\n    include \*, -> \*, \* ->\n  \}/);
  });
});
