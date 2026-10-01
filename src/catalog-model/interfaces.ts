// What a service answers on and what it calls: RPC interfaces and their
// methods, messages and enums, the routes behind them, outbound calls with
// their resolved destinations, and the schema modules that declare them.

import type { Catalog } from "./catalog.ts";
import type { EdgeVia, Field, RelationEvidence, Status } from "./shared.ts";

export interface RpcService {
  id: string;
  methods: RpcMethod[];
  source: string;
  /**
   * Request and response shapes, when the generator could read them. Optional:
   * a service whose protos were not parsed still lists its methods.
   */
  messages?: RpcMessage[];
  /**
   * The enums the messages' fields name, reached the way `messages` are:
   * from the methods, through the fields, as far as the document declares.
   */
  enums?: RpcEnum[];
  /** The schema module declaring this interface, by `ProtoModule.id`. */
  module?: string;
}

/**
 * One method of one interface.
 *
 * A string would have done for the name, and did until protos were read. What
 * a string could not carry is the shapes on either side: an endpoint whose
 * request and response are named is one a reader can follow without opening
 * the source, and a streaming method drawn as a unary call is a lie about how
 * the two ends are coupled.
 *
 * Only `name` is required. An interface read from an OpenAPI document supplies
 * nothing else, and must keep reading the way it always did.
 *
 * There is no id here. `<rpcServiceId>/<name>` is already how the app spells
 * one, everywhere it needs one, and a stored copy would be a second place for
 * it to be wrong.
 */
export interface RpcMethod {
  /**
   * The name as the interface declares it - a proto method, an OpenAPI
   * `operationId`. This is what `Operation.exposedBy` names.
   */
  name: string;
  doc?: string;
  /**
   * The request and response messages, by the name they carry in
   * `RpcService.messages`. `ref` keys `catalog.defs` when the shape is shared -
   * the same pairing, for the same reason, as `Field.type` and `Field.ref`.
   */
  request?: string;
  requestRef?: string;
  response?: string;
  responseRef?: string;
  /** How the method streams. Absent is unary, which is most of them. */
  streaming?: Streaming;
  deprecated?: boolean;
  /**
   * The route, for a method read from an OpenAPI document: the verb and the
   * path template as the document writes them. This is what lets a request
   * seen on the wire be read back to the operation it ran.
   */
  http?: HttpRoute;
  /** Concrete SOAP binding read from a WSDL operation. */
  soap?: SoapRoute;
}

export interface HttpRoute {
  /**
   * Upper case: `POST`. Empty when a framework extractor proved the mount but
   * neither a declaration nor the handler's reads name the verb; such a route
   * is never matched against an outbound call, and renderers show the path
   * alone.
   */
  method: string;
  /** As templated in the document: `/v1/users/{id}`. */
  path: string;
  /**
   * Who named the verb. Absent reads `declared`: a document, a decorator or a
   * route table spelled it. `inferred` is a verb no declaration names and the
   * handler's reads imply (extract-django: `request.FILES` means POST). The
   * merge links a call to such a route at medium confidence.
   */
  methodBasis?: HttpMethodBasis;
  /** The reading an inferred verb rests on. */
  methodEvidence?: HttpMethodEvidence;
}

export type HttpMethodBasis = "declared" | "inferred";

export const HTTP_METHOD_BASES: readonly HttpMethodBasis[] = [
  "declared",
  "inferred",
] as const;

export interface HttpMethodEvidence {
  /** What was read: `reads request.FILES`. */
  rule: string;
  /** Where: `geo/views.py:64`. */
  source: string;
}

/** The basis a route's verb carries, `declared` when it carries none. */
export function httpMethodBasis(route: HttpRoute): HttpMethodBasis {
  return route.methodBasis ?? "declared";
}

export interface SoapRoute {
  action?: string;
  version?: "1.1" | "1.2";
  style?: string;
  endpoint?: string;
  binding?: string;
  faults?: string[];
  headers?: string[];
}

export type Streaming = "client" | "server" | "bidi";

export const STREAMING: readonly Streaming[] = [
  "client",
  "server",
  "bidi",
] as const;
/** An enum a proto declares. The number is what a binary message carries. */
export interface RpcEnum {
  name: string;
  doc?: string;
  values: RpcEnumValue[];
}
export interface RpcEnumValue {
  name: string;
  number: number;
  doc?: string;
}

export interface RpcMessage {
  name: string; // "PlaceOrderRequest"
  fields: Field[];
  /** How this OpenAPI message selects one concrete variant on the wire. */
  discriminator?: RpcDiscriminator;
}

export interface RpcDiscriminator {
  /** JSON property carrying the discriminator value. */
  property: string;
  variants: RpcVariant[];
}

export interface RpcVariant {
  /** Value carried in `property`. */
  value: string;
  /** Concrete message selected by that value. */
  message: string;
}
/** Source facts remain separate from the merge's choice of provider. */
export interface HTTPDestination {
  callSite: string;
  endpointExpression: string;
  method: string;
  localPath?: string;
  baseURL?: HTTPBaseURL;
  serviceDiscoveryAlias?: string;
  fullPath?: string;
  join?: { expression: string; source: string };
  /** Runtime URL modifiers after the proven join; not evaluated statically. */
  transforms?: { expression: string; source: string }[];
  resolution?: HTTPDestinationResolution;
}
export interface HTTPDestinationResolution {
  basis: "full-path" | "exact-route" | "unique-suffix" | "kubernetes-host";
  provider: string;
  route: string;
  /**
   * Absent for a link whose route and verb are both declared, and reads
   * `high`. `medium` is a link to a route whose verb is inferred; the status
   * stays `declared`, because the route is, and this says what it rests on.
   */
  confidence?: "high" | "medium" | "low";
  /** The provider route's reading, when its verb is inferred. */
  methodEvidence?: HttpMethodEvidence;
}
export interface HTTPBaseURL {
  expression: string;
  configField?: string;
  environmentVariable?: string;
  value?: string;
  kind: "literal" | "config-default" | "symbolic";
  source: string;
  optionSource?: string;
}
export interface RpcCall {
  evidence?: RelationEvidence[];
  destination?: HTTPDestination;
  id: string; // "<proto.package.Service>/<Method>"
  peer: string; // service id if resolved, else raw name
  status: Status;
  source: string;
  note?: string;
  /** The module the vendored copy this call was read from belongs to. */
  module?: string;
  /** Set when the call was derived from a flow step rather than declared. */
  via?: EdgeVia;
}

/**
 * A schema module: a set of .proto files with a name, a version and a
 * publisher - `buf.build/acme/shop`.
 *
 * It sits at the top level rather than inside the service that publishes it,
 * because the interesting fact about a module is usually who ELSE reads it.
 *
 * Its id is the module's own registry-global name and NOT `<owner>.<slug>` the
 * way a store's is. A store is declared by exactly one source - the service
 * that owns it - so deriving its id from its owner is safe. A module is
 * declared by several sources that do not know each other: the producer's
 * extractor knows which service publishes it, and the consumer's extractor,
 * reading a vendored copy in another repository, knows only the module name.
 * Since the merge unions top-level entities BY ID, an owner-derived id would
 * grow one module per consumer.
 *
 * What it carries is identity and inventory, not schema. The interfaces are
 * found through `RpcService.module` and the shapes live in `RpcService.messages`
 * and `catalog.defs`, in one place rather than two that can disagree.
 */
export interface ProtoModule {
  /** "buf.build/acme/shop", or "local:proto/shop" for a set never published. */
  id: string;
  /** Unique across the catalog, and what the URL uses: "acme-shop". */
  slug: string;
  name: string; // "acme/shop"
  /** "buf.build". Absent when the module was never published to one. */
  registry?: string;
  /**
   * The service that publishes it, by id, when the estate knows.
   *
   * Optional on purpose, and the first entity where "nobody here owns this" is
   * an honest answer rather than a defect: a module published by a team, or by
   * a repository outside the estate, is the ordinary case.
   */
  owner?: string;
  /** The commit this catalog was built from. */
  commit?: string;
  /** The registry's content digest of that commit - what makes a copy checkable. */
  digest?: string;
  /** Proto packages declared inside it, sorted. */
  packages: string[];
  /** Files, module-relative and sorted. */
  files: string[];
  /** Modules it depends on, by id. */
  deps?: string[];
  /** Where the copy in this repository lives, as a reader would type it. */
  source: string;
}

export function allModules(catalog: Catalog): ProtoModule[] {
  return catalog.modules ?? [];
}
