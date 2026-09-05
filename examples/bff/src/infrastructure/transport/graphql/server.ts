// The schema, mounted on Yoga.
//
// One route, one document, and the two things a transport is for: reading the
// bearer off the request into the context, and turning a peer's failure into
// something a client can act on. A refusal a peer made travels as its own
// message; a peer that did not answer at all is a 502 in GraphQL's clothing,
// which is what `PeerError` marks.
import { createYoga, createSchema, type YogaServerInstance } from "graphql-yoga";
import { GraphQLError } from "graphql";
import type { Ports } from "../../../di/container.ts";
import { PeerError } from "../../errors.ts";
import { resolvers } from "../../../schema/resolvers.generated.js";
import { typeDefs } from "../../../schema/typeDefs.generated.js";
import type { GraphQLContext } from "./context.ts";

export function buildServer(ports: Ports): YogaServerInstance<object, GraphQLContext> {
  return createYoga<object, GraphQLContext>({
    schema: createSchema<GraphQLContext>({ typeDefs, resolvers }),
    graphqlEndpoint: "/graphql",
    landingPage: false,
    context: ({ request }) => ({ ...ports, bearer: bearerOf(request.headers.get("authorization")) }),
    maskedErrors: {
      maskError(error, message) {
        // `originalError` rather than `instanceof GraphQLError`: graphql ships
        // both an ESM and a CommonJS build, the server may end up holding one
        // and this file the other, and two copies of a class are two classes.
        // The field is on every error graphql wraps, whichever copy made it.
        const cause = (error as { originalError?: unknown }).originalError;
        if (cause instanceof PeerError) {
          return new GraphQLError(cause.message, { extensions: { code: "PEER_UNAVAILABLE", peer: cause.peer } });
        }
        // A refusal graphql itself made - an unknown field, a bad argument -
        // is about the request and is safe to hand back as it is. Anything
        // with something else behind it is this service's business and is
        // masked, which is what masking is for.
        if (!cause) return error as GraphQLError;

        return new GraphQLError(message);
      },
    },
  });
}

/** `Bearer abc` is a token; anything else is nobody. */
function bearerOf(header: string | null): string {
  const [scheme, token] = (header ?? "").split(" ");

  return scheme?.toLowerCase() === "bearer" && token ? token : "";
}
