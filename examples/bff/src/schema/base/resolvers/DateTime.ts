import { GraphQLScalarType, Kind } from "graphql";

/**
 * An instant, as a string, in and out.
 *
 * The storefront does not do arithmetic on time, so parsing one into a Date
 * would be work done for nobody; what it does do is refuse a value that is
 * not a string, so a peer's `null` cannot arrive at a client as an instant.
 */
export const DateTime = new GraphQLScalarType<string, string>({
  name: "DateTime",
  description: "An instant, ISO 8601 with an offset.",
  serialize(value) {
    if (typeof value === "string") return value;
    if (value instanceof Date) return value.toISOString();
    throw new TypeError("DateTime must be a string or a Date");
  },
  parseValue(value) {
    if (typeof value !== "string") throw new TypeError("DateTime must be a string");

    return value;
  },
  parseLiteral(node) {
    if (node.kind !== Kind.STRING) throw new TypeError("DateTime must be a string");

    return node.value;
  },
});
