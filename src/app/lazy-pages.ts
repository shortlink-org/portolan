import { lazy } from "react";
import type { ComponentType } from "react";
import { matchPath } from "react-router";
import { preloadC4View } from "../likec4/LazyC4View";
import { preloadFlowDetail } from "../pages/LazyFlowDetail";

// Every page but the overview is a chunk of its own, fetched the first time it
// is opened. The catalog shell - the tree, the bar, the palette, the rail - is
// what every URL waits for, and before this it also carried the code of the
// twenty-eight pages a reader was not on. The overview stays in the shell: it
// is where the catalog opens, and a page of its own there would only add a
// round trip to the first paint.
//
// Each page's loader is named once and used twice: by the lazy component the
// route renders, and by `preloadPage`, which the shell calls when a pointer
// or the keyboard settles on a link, so by the click the chunk is usually in.

// A module's named export as the default React.lazy wants, with its props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React.lazy's own bound
function lazyPage<T extends ComponentType<any>>(load: () => Promise<T>) {
  return lazy(async () => ({ default: await load() }));
}

const load = {
  flowIndex: () => import("../pages/FlowIndex"),
  adrIndex: () => import("../pages/AdrIndex"),
  adrDetail: () => import("../pages/AdrDetail"),
  adrCreate: () => import("../pages/AdrCreate"),
  rfcIndex: () => import("../pages/RfcIndex"),
  rfcDetail: () => import("../pages/RfcDetail"),
  language: () => import("../pages/Language"),
  pluginIndex: () => import("../pages/PluginIndex"),
  pluginSettings: () => import("../pages/PluginSettings"),
  problems: () => import("../pages/Problems"),
  settings: () => import("../pages/Settings"),
  changes: () => import("../pages/Changes"),
  drafts: () => import("../pages/Drafts"),
  taskCompare: () => import("../pages/TaskCompare"),
  draftCompare: () => import("../pages/DraftCompare"),
  draftEntity: () => import("../pages/DraftEntityPage"),
  external: () => import("../pages/ExternalPage"),
  registryIndex: () => import("../pages/RegistryIndex"),
  module: () => import("../pages/ModulePage"),
  contextMap: () => import("../pages/ContextMap"),
  context: () => import("../pages/ContextPage"),
  service: () => import("../pages/ServicePage"),
  store: () => import("../pages/StorePage"),
  aggregate: () => import("../pages/AggregatePage"),
  block: () => import("../pages/BlockPage"),
  enum: () => import("../pages/EnumPage"),
  event: () => import("../pages/EventPage"),
  graph: () => import("../pages/GraphPage"),
};

export const FlowIndex = lazyPage(() => load.flowIndex().then((m) => m.FlowIndex));
export const AdrIndex = lazyPage(() => load.adrIndex().then((m) => m.AdrIndex));
export const AdrDetail = lazyPage(() => load.adrDetail().then((m) => m.AdrDetail));
export const AdrCreate = lazyPage(() => load.adrCreate().then((m) => m.default));
export const RfcIndex = lazyPage(() => load.rfcIndex().then((m) => m.RfcIndex));
export const RfcDetail = lazyPage(() => load.rfcDetail().then((m) => m.RfcDetail));
export const Language = lazyPage(() => load.language().then((m) => m.Language));
export const PluginIndex = lazyPage(() => load.pluginIndex().then((m) => m.PluginIndex));
export const PluginSettings = lazyPage(() => load.pluginSettings().then((m) => m.PluginSettings));
export const Problems = lazyPage(() => load.problems().then((m) => m.Problems));
export const Settings = lazyPage(() => load.settings().then((m) => m.Settings));
export const Changes = lazyPage(() => load.changes().then((m) => m.Changes));
export const Drafts = lazyPage(() => load.drafts().then((m) => m.Drafts));
export const TaskCompare = lazyPage(() => load.taskCompare().then((m) => m.TaskCompare));
export const DraftCompare = lazyPage(() => load.draftCompare().then((m) => m.DraftCompare));
export const DraftEntityPage = lazyPage(() => load.draftEntity().then((m) => m.DraftEntityPage));
export const ExternalPage = lazyPage(() => load.external().then((m) => m.ExternalPage));
export const RegistryIndex = lazyPage(() => load.registryIndex().then((m) => m.RegistryIndex));
export const ModulePage = lazyPage(() => load.module().then((m) => m.ModulePage));
export const ContextMap = lazyPage(() => load.contextMap().then((m) => m.ContextMap));
export const ContextPage = lazyPage(() => load.context().then((m) => m.ContextPage));
export const ServicePage = lazyPage(() => load.service().then((m) => m.ServicePage));
export const StorePage = lazyPage(() => load.store().then((m) => m.StorePage));
export const AggregatePage = lazyPage(() => load.aggregate().then((m) => m.AggregatePage));
export const BlockPage = lazyPage(() => load.block().then((m) => m.BlockPage));
export const EnumPage = lazyPage(() => load.enum().then((m) => m.EnumPage));
export const EventPage = lazyPage(() => load.event().then((m) => m.EventPage));
export const GraphPage = lazyPage(() => load.graph().then((m) => m.GraphPage));

/** Settings is fetched once the first page has painted; see CatalogApp. */
export const preloadSettings = (): void => void load.settings();

/**
 * The routes of CatalogApp, in the order they have to be tried: a literal
 * segment before the parameter it would otherwise be read as. The overview
 * and the id redirect have no chunk of their own and are not listed.
 */
const ROUTES: [pattern: string, preload: () => unknown][] = [
  ["/flows", load.flowIndex],
  ["/flows/:flow", preloadFlowDetail],
  ["/adrs", load.adrIndex],
  ["/adrs/new", load.adrCreate],
  ["/adrs/:adr/edit", load.adrCreate],
  ["/adrs/:adr", load.adrDetail],
  ["/rfcs", load.rfcIndex],
  ["/rfcs/:rfc", load.rfcDetail],
  ["/language", load.language],
  ["/plugins", load.pluginIndex],
  ["/plugins/:name/settings", load.pluginSettings],
  ["/problems", load.problems],
  ["/settings/*", load.settings],
  ["/changes", load.changes],
  ["/drafts", load.drafts],
  ["/drafts/task/:task", load.taskCompare],
  ["/drafts/:project/:branch", load.draftCompare],
  ["/drafts/:project/:branch/e/:entity", load.draftEntity],
  ["/externals/:external", load.external],
  ["/registry", load.registryIndex],
  ["/registry/:module", load.module],
  ["/map", load.contextMap],
  ["/graph", load.graph],
  // Both draw a C4 view, whose chunk the page would otherwise only ask for
  // once it had arrived and rendered: fetched side by side instead.
  ["/c/:context", () => Promise.all([load.context(), preloadC4View()])],
  ["/c/:context/:service", () => Promise.all([load.service(), preloadC4View()])],
  ["/c/:context/:service/data/:store", load.store],
  ["/c/:context/:service/:aggregate/vo/:block", load.block],
  ["/c/:context/:service/:aggregate/entity/:block", load.block],
  ["/c/:context/:service/:aggregate/enum/:enum", load.enum],
  ["/c/:context/:service/:aggregate", load.aggregate],
  ["/c/:context/:service/:aggregate/:event", load.event],
];

/** Which route a pathname lands on, as the pattern CatalogApp declares it. */
export function pageRouteFor(pathname: string): string | null {
  return ROUTES.find(([pattern]) => matchPath(pattern, pathname))?.[0] ?? null;
}

/** Starts fetching the chunk of the page at `pathname`, if it has one. */
export function preloadPage(pathname: string): void {
  const route = ROUTES.find(([pattern]) => matchPath(pattern, pathname));
  // A failed fetch here is not the reader's problem: the click that follows
  // runs the same import, and that one reports.
  if (route) Promise.resolve(route[1]()).catch(() => {});
}
