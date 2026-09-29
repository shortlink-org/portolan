// The abbreviations a picture or a name uses, and what each one stands for.
//
// A reader of a diagram should understand every abbreviation on it. The
// estate's glossary says what its own words mean, and is asked first; the
// handful of technical abbreviations every estate uses - HTTP, gRPC, SQS - are
// spelled out here, because no glossary should have to define them. An
// abbreviation neither knows is reported as such, never guessed at.

import type { Term } from "../catalog";

/** Common technical abbreviations, as a reader new to them would want them said. */
export const COMMON_ABBREVIATIONS: Readonly<Record<string, string>> = {
  ADR: "architecture decision record",
  AMQP: "Advanced Message Queuing Protocol",
  API: "application programming interface",
  AWS: "Amazon Web Services",
  BFF: "backend for frontend: a server shaped for one kind of client",
  CDC: "change data capture: a database's changes read off its log",
  CLI: "command-line interface",
  CQRS: "command and query responsibility segregation",
  DB: "database",
  DDD: "domain-driven design",
  DNS: "Domain Name System",
  gRPC: "remote procedure calls over HTTP/2, with Protocol Buffers",
  HTTP: "Hypertext Transfer Protocol",
  HTTPS: "HTTP over TLS",
  JSON: "JavaScript Object Notation",
  JWT: "JSON Web Token",
  MQTT: "a lightweight publish-subscribe messaging protocol",
  NATS: "a message broker; the name is not expanded",
  OMS: "order management system",
  REST: "representational state transfer: resources over HTTP",
  RPC: "remote procedure call",
  SDK: "software development kit",
  SNS: "Amazon Simple Notification Service",
  SOAP: "Simple Object Access Protocol",
  SQL: "Structured Query Language",
  SQS: "Amazon Simple Queue Service",
  TCP: "Transmission Control Protocol",
  TLS: "Transport Layer Security",
  UI: "user interface",
  URL: "uniform resource locator",
  WSDL: "Web Services Description Language",
};

/**
 * The abbreviations in a piece of text, in order of first use: a word of two to
 * six capitals and digits (SQS, HTTP2), or one with a single lowercase lead
 * (gRPC). A capitalised word is a name, not an abbreviation, and is left alone.
 */
export function abbreviationsIn(text: string): string[] {
  const found = text.match(/\b(?:[A-Z][A-Z0-9]{1,5}|[a-z][A-Z]{2,5})\b/g) ?? [];
  // Two capitals at least: V1 is a version, not an abbreviation.
  return [...new Set(found.filter((word) => /[A-Z].*[A-Z]/.test(word)))];
}

export interface Explanation {
  abbreviation: string;
  /** What it stands for; empty when neither the glossary nor the common list says. */
  meaning: string;
  /** Where the meaning came from. */
  from: "glossary" | "common" | "none";
}

/** A glossary term that defines the abbreviation: named by it, or spelling it out as "Name (ABBR)". */
function termFor(abbreviation: string, terms: readonly Term[]): Term | undefined {
  const lower = abbreviation.toLowerCase();
  return terms.find(
    (term) =>
      term.name.toLowerCase() === lower ||
      new RegExp(`\\(${abbreviation}\\)`).test(term.name),
  );
}

/** The first sentence of a glossary definition, as plain text. */
function firstSentence(markdown: string): string {
  const plain = markdown.replace(/`([^`]*)`/g, "$1").replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1").replace(/\s+/g, " ").trim();
  return /^(.+?[.!?])(?=\s|$)/.exec(plain)?.[1] ?? plain;
}

export function explain(abbreviation: string, terms: readonly Term[]): Explanation {
  const term = termFor(abbreviation, terms);
  if (term) {
    const spelled = term.name.toLowerCase() === abbreviation.toLowerCase() ? "" : `${term.name.replace(/\s*\([^)]*\)\s*$/, "")}: `;
    return { abbreviation, meaning: `${spelled}${firstSentence(term.definition)}`, from: "glossary" };
  }
  const common = COMMON_ABBREVIATIONS[abbreviation];
  if (common) return { abbreviation, meaning: common, from: "common" };
  return { abbreviation, meaning: "", from: "none" };
}
