import { renderToStaticMarkup } from "react-dom/server";
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
