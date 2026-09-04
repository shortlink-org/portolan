// The routes described by the document, mounted on Fastify, with the server
// span named per route so a trace reads back to the operation. Errors are
// mapped in one place: a basket's refusal is a 409, a rule broken is a 400,
// nothing to show is a 404, no session is a 401, and a peer not answering is
// a 502 - the document says so, and this is where it is made true.
import { trace } from "@opentelemetry/api";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { BasketError } from "../../../domain/basket/errors.ts";
import type { BasketHandlers } from "./basket/handlers.ts";

export function buildServer(handlers: BasketHandlers): FastifyInstance {
  const app = Fastify({ logger: false });

  // otelhttp's counterpart: the request span carries the route template, and
  // is named after it, which is what lets a recording be read back to the
  // operation the document names.
  app.addHook("onRequest", async (req) => {
    const span = trace.getActiveSpan();
    const route = req.routeOptions?.url;
    if (span && route) {
      span.updateName(`${req.method} ${route}`);
      span.setAttribute("http.route", route);
    }
  });

  app.post("/v1/baskets", (req, reply) => handlers.createBasket(req, reply));
  app.get("/v1/baskets/:basketId", (req) => handlers.getBasket(req));
  app.post("/v1/baskets/:basketId/items", (req) => handlers.addItem(req));
  app.delete("/v1/baskets/:basketId/items/:sku", (req) => handlers.removeItem(req));
  app.post("/v1/baskets/:basketId/merge", (req) => handlers.mergeBaskets(req));
  app.post("/v1/baskets/:basketId/checkout", (req) => handlers.checkout(req));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ message: "the request does not satisfy a rule of the basket" });
    if (err instanceof BasketError) {
      const code = { invalid: 400, refused: 409, "not-open": 409, conflict: 409, "not-found": 404, "not-yours": 401 }[err.code];
      return reply.code(code).send({ message: err.message });
    }
    if (err instanceof PeerError) return reply.code(502).send({ message: err.message });
    app.log.error(err);
    return reply.code(500).send({ message: "internal error" });
  });

  return app;
}

/** A peer that did not answer: not the basket's fault, and not the customer's. */
export class PeerError extends Error {}
