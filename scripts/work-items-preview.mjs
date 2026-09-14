// A dedicated development preview of the REAL pages. Fictional work items are
// injected only into this server's data module; no catalog files are changed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const fixture = JSON.parse(readFileSync(new URL("../src/testing/fixtures/work-items.json", import.meta.url), "utf8"));
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 5191, strictPort: true },
  plugins: [{
    name: "work-items-ui-fixture",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0] !== resolve(root, "src/data.ts")) return null;
      const marker = "const merged = mergeCatalogs(sources);";
      if (!code.includes(marker)) throw new Error("work-items preview: data entry point changed");
      return code.replace(marker, `sources.push({ path: "work-items-ui-demo", catalog: ${JSON.stringify(fixture)} });\n  ${marker}`);
    },
    transformIndexHtml(html) {
      return html.replace("</body>", '<div style="position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:1000;padding:6px 12px;border:1px solid #d2a600;border-radius:6px;background:#fff5c2;color:#594500;font:12px system-ui;pointer-events:none">Demo · fictional tasks and commits</div></body>');
    },
  }],
});
await server.listen();
console.log("Work items UI: http://127.0.0.1:5191/flows/gen?catalog=portolan");
