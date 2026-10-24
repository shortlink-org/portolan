import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { ShapeRows } from "./ShapeRows";

it("stacks contract fields for a narrow detail rail", () => {
  const html = renderToStaticMarkup(
    <ShapeRows
      stacked
      fields={[
        { name: "order_id", type: "string", doc: "Order to cancel" },
      ]}
    />,
  );

  expect(html).toContain("<dl");
  expect(html).toContain("order_id");
  expect(html).toContain("string");
  expect(html).toContain("Order to cancel");
  expect(html).not.toContain("<table");
});

it("links a field type when its contract has a destination", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ShapeRows
        stacked
        fields={[
          { name: "money", type: "Money", ref: "shop.Money", doc: "" },
        ]}
        typeHref={() => "/registry/shop?tab=types#msg-shop-Money"}
      />
    </MemoryRouter>,
  );

  expect(html).toContain('href="/registry/shop?tab=types#msg-shop-Money"');
  expect(html).toContain("Money →");
});
