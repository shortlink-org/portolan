import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import type { Location } from "react-router";
import {
  Panel,
  ResizeHandle,
  SavedGroup,
  useCanvasResize,
  usePanelRef,
} from "./panels";
import { FlowDetail } from "../pages/FlowDetail";
import { FlowIndex } from "../pages/FlowIndex";
import { AdrIndex } from "../pages/AdrIndex";
import { Language } from "../pages/Language";
import { AdrDetail } from "../pages/AdrDetail";
import { Overview } from "../pages/Overview";
import { ContextMap } from "../pages/ContextMap";
import { ContextPage } from "../pages/ContextPage";
import { ServicePage } from "../pages/ServicePage";
import { AggregatePage } from "../pages/AggregatePage";
import { BlockPage } from "../pages/BlockPage";
import { EnumPage } from "../pages/EnumPage";
import { EventPage } from "../pages/EventPage";
import { StorePage } from "../pages/StorePage";
import { GraphPage } from "../pages/GraphPage";
import { Problems } from "../pages/Problems";
import { Settings } from "../pages/Settings";
import { Changes } from "../pages/Changes";
import { RegistryIndex } from "../pages/RegistryIndex";
import { ModulePage } from "../pages/ModulePage";
import { ExternalPage } from "../pages/ExternalPage";
import { NotFoundPage } from "../pages/NotFound";
import { CatalogFailure } from "../pages/CatalogFailure";
import { activeCatalogProfile, catalogError } from "../data";
import { SidePanel } from "../components/Overlay";
import { Empty } from "../components/PageHeader";
import { WithDetail } from "../selection/DetailPanel";
import { SelectionSync } from "../selection/sync";
import { Trail } from "../trail/Trail";
import { TrailRecorder } from "../trail/record";
import { HashScroll } from "./HashScroll";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ThemeProvider } from "./theme";
import { DensityProvider } from "./density";
import { useNarrow, usePhone } from "./responsive";
import { ShortcutsSheet, useShortcuts } from "./shortcuts";
import { Toaster } from "./toast";
import { useUiStore } from "./ui-store";
import { ForgeAccessProvider } from "./forge-access";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./query-client";
import { AnimatePresence, MotionProvider, m, page } from "../lib/motion";
import { useChatUi } from "../chat/store";
import { projectPreview } from "../lib/project-preview";

// The chat is a chunk of its own, and a build with VITE_CHAT=off has no such
// chunk: the test is on the literal Vite substitutes, so the import below is
// dead code to the bundler and is dropped with everything it would pull in.
const ChatPanel =
  import.meta.env.VITE_CHAT !== "off"
    ? lazy(() => import("../chat/ChatPanel"))
    : null;

/**
 * What the click shows while that chunk is on its way: the same sheet, at the
 * same width, with a word in it. A fallback of nothing meant the first "ask"
 * on a slow line did nothing for a second and the reader clicked again.
 */
function ChatLoading() {
  const phone = usePhone();
  return (
    <SidePanel
      open
      onClose={() => useChatUi.getState().setOpen(false)}
      side="right"
      label="Ask the catalog"
      width={phone ? "100vw" : "min(560px,92vw)"}
    >
      <div className="h-full bg-canvas p-gutter text-ink">
        <Empty>loading the chat…</Empty>
      </div>
    </SidePanel>
  );
}

/**
 * Every route, once. Rendered inside a pane on wide layouts and alone below.
 *
 * The location is a prop, not read from the router: while a page is on its
 * way out the router already says the next address, and the page leaving
 * must keep drawing the one it was.
 */
function AppRoutes({ location }: { location: Location }) {
  return (
    <Routes location={location}>
      <Route path="/" element={<Overview />} />
      <Route path="/flows" element={<FlowIndex />} />
      <Route
        path="/flows/:flow"
        element={
          <WithDetail id="flow">
            <FlowDetail />
          </WithDetail>
        }
      />
      <Route path="/adrs" element={<AdrIndex />} />
      <Route path="/language" element={<Language />} />
      <Route path="/adrs/:adr" element={<AdrDetail />} />
      <Route path="/problems" element={<Problems />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/changes" element={<Changes />} />
      <Route path="/externals/:external" element={<ExternalPage />} />
      {/* A module sits at the estate level, not under a service: it is
          published by one and read by four, so hanging it off a service would
          put one entity at four URLs. */}
      <Route path="/registry" element={<RegistryIndex />} />
      <Route
        path="/registry/:module"
        element={
          <WithDetail id="module">
            <ModulePage />
          </WithDetail>
        }
      />
      <Route
        path="/map"
        element={
          <WithDetail id="map">
            <ContextMap />
          </WithDetail>
        }
      />
      <Route
        path="/c/:context"
        element={
          <WithDetail id="context">
            <ContextPage />
          </WithDetail>
        }
      />
      <Route
        path="/c/:context/:service"
        element={
          <WithDetail id="service">
            <ServicePage />
          </WithDetail>
        }
      />
      {/* Before the aggregate routes: "data" is a literal sitting where an
          aggregate slug would, and "/c/x/y/data/z" would otherwise be read as
          the event "z" of an aggregate called "data". */}
      <Route
        path="/c/:context/:service/data/:store"
        element={
          <WithDetail id="store">
            <StorePage />
          </WithDetail>
        }
      />
      <Route
        path="/c/:context/:service/:aggregate"
        element={<AggregatePage />}
      />
      {/* The two literal segments come first: a block page must not be
          read as an event whose slug happens to be "vo". */}
      <Route
        path="/c/:context/:service/:aggregate/vo/:block"
        element={<BlockPage kind="vo" />}
      />
      <Route
        path="/c/:context/:service/:aggregate/entity/:block"
        element={<BlockPage kind="entity" />}
      />
      <Route
        path="/c/:context/:service/:aggregate/enum/:enum"
        element={<EnumPage />}
      />
      <Route
        path="/c/:context/:service/:aggregate/:event"
        element={
          <WithDetail id="event">
            <EventPage />
          </WithDetail>
        }
      />
      <Route
        path="/graph"
        element={
          <WithDetail id="graph">
            <GraphPage />
          </WithDetail>
        }
      />
      <Route path="/index.html" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/**
 * The catalog tree as an overlay, below the narrow breakpoint. It is the same
 * Sidebar; only the box around it changes, so nothing about the tree has two
 * implementations.
 */
function SidebarDrawer() {
  const open = useUiStore((s) => s.drawer);
  const setDrawer = useUiStore((s) => s.setDrawer);
  const { pathname } = useLocation();

  // Navigating is what the tree is for, so a click that moves the reader ends
  // the drawer's job. Without this the page they asked for is behind a scrim.
  useEffect(() => setDrawer(false), [pathname, setDrawer]);

  return (
    <SidePanel
      open={open}
      onClose={() => setDrawer(false)}
      side="left"
      label="Catalog"
      width="min(320px,85vw)"
    >
      <Sidebar />
    </SidePanel>
  );
}

function Shell() {
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const chatOpen = useChatUi((s) => s.open);
  const [railed, setRailed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { pathname } = location;
  const settle = useCanvasResize();
  const sidebarRef = usePanelRef();
  const narrow = useNarrow();
  const toggleDrawer = useUiStore((s) => s.toggleDrawer);
  const setDrawer = useUiStore((s) => s.setDrawer);
  const toggleDetail = useUiStore((s) => s.toggleDetail);
  const revealNonce = useUiStore((s) => s.revealNonce);

  // Keep the selected catalog shareable even though most route builders do
  // not know about presentation state. Changing the profile itself reloads
  // the bundle; ordinary navigation only restores its URL marker.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("catalog") === activeCatalogProfile.id) return;
    params.set("catalog", activeCatalogProfile.id);
    navigate(
      { pathname: location.pathname, search: `?${params}`, hash: location.hash },
      { replace: true },
    );
  }, [location.hash, location.pathname, location.search, navigate]);

  // Collapsed is a fact about pixels, not about who dragged: the rail appears
  // whether the reader dragged past the minimum or pressed a rail button.
  const onSidebarResize = useCallback(
    (size: { inPixels: number }) => setRailed(size.inPixels <= 56),
    [],
  );

  // The rail's buttons ask the panel to expand; `railed` then follows from the
  // resize that answers, so the flag can never disagree with the layout.
  //
  // `expand()` restores the width the panel had before it collapsed, which
  // after a drag all the way to the edge is the minimum - a tree too narrow to
  // read the names in. Anything at or under the minimum is treated as "no
  // remembered width" and goes back to the default instead.
  const expandSidebar = useCallback(() => {
    const panel = sidebarRef.current;
    if (!panel) return;
    panel.expand();
    if (panel.getSize().asPercentage <= 13) panel.resize("18");
  }, [sidebarRef]);

  // A layout restored from a previous session can arrive already collapsed,
  // and no resize fires for a size that never changed - so the rail has to be
  // read off the panel once on mount, or the full tree renders into 48px.
  useEffect(() => {
    setRailed(sidebarRef.current?.isCollapsed() ?? false);
  }, [sidebarRef]);

  // "[" means the same thing at both widths - show me the tree, or stop
  // showing it - and reaches for whichever mechanism is on screen.
  const toggleSidebar = useCallback(() => {
    if (narrow) {
      toggleDrawer();
      return;
    }
    const panel = sidebarRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) expandSidebar();
    else panel.collapse();
  }, [narrow, toggleDrawer, sidebarRef, expandSidebar]);

  // "Reveal in tree" selects; the tree then opens its own ancestors and scrolls
  // itself. The one thing it cannot do from inside a collapsed pane is become
  // visible, which is this.
  useEffect(() => {
    if (revealNonce === 0) return;
    if (narrow) setDrawer(true);
    else if (sidebarRef.current?.isCollapsed()) expandSidebar();
  }, [revealNonce, narrow, setDrawer, sidebarRef, expandSidebar]);

  useShortcuts(
    {
      openPalette: () => setPalette(true),
      openHelp: () => setHelp(true),
      toggleSidebar,
      toggleDetail,
    },
    // While a modal owns the keyboard the global bindings stand down; ⌘K and
    // Esc are handled inside the modals themselves.
    !palette && !help && !chatOpen,
  );

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <SelectionSync />
      <TrailRecorder />
      <HashScroll />
      <TopBar
        onOpenPalette={() => setPalette(true)}
        onOpenHelp={() => setHelp(true)}
        onToggleSidebar={toggleSidebar}
        narrow={narrow}
      />
      {projectPreview ? (
        <div className="shrink-0 border-b border-declared/40 bg-declared/10 px-gutter py-2 text-center text-sm text-declared">
          Temporary project preview · the repository has not been changed · expires after 15 minutes
        </div>
      ) : null}
      {/* Under the bar, above everything: the trail is about the whole shell,
          not about the page inside it. */}
      <Trail />

      {narrow ? (
        <>
          {/* `key` on the route content is what makes the page transition
              fire: a new pathname is a new element. The old one leaves first,
              on the micro duration, then the new one rises. */}
          <AnimatePresence mode="wait">
            <m.main
              key={pathname}
              {...page}
              className="min-h-0 flex-1 overflow-hidden"
            >
              <AppRoutes location={location} />
            </m.main>
          </AnimatePresence>
          <SidebarDrawer />
        </>
      ) : (
        <SavedGroup
          id="portolan:shell"
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <Panel
            id="sidebar"
            defaultSize="18"
            minSize="12"
            maxSize="28"
            collapsible
            collapsedSize="48px"
            className="h-full text-sm"
            panelRef={sidebarRef}
            onResize={onSidebarResize}
          >
            <Sidebar railed={railed} onExpand={expandSidebar} />
          </Panel>

          <ResizeHandle id="shell" />

          {/* The main pane owns a canvas on most routes, so a drag here has to
              reach the diagram - debounced, once the reader lets go. */}
          <Panel id="main" className="h-full min-w-0" onResize={settle}>
            {/* The detail rail rides along with every page that draws a
                diagram, so a selection made anywhere has somewhere to be read. */}
            <AnimatePresence mode="wait">
              <m.main
                key={pathname}
                {...page}
                className="h-full overflow-hidden"
              >
                <AppRoutes location={location} />
              </m.main>
            </AnimatePresence>
          </Panel>
        </SavedGroup>
      )}

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <ShortcutsSheet open={help} onClose={() => setHelp(false)} />
      {ChatPanel && chatOpen ? (
        <Suspense fallback={<ChatLoading />}>
          <ChatPanel />
        </Suspense>
      ) : null}
      {/* The one thing the app says out loud, and it says it here rather than
          in the sidebar: a pin can be taken from a page whose tree is folded
          away to a 48px rail. */}
      <Toaster />
    </div>
  );
}

export function App() {
  // A catalog that failed validation is the whole app's answer, so it is
  // decided above the router: there is no route worth reaching.
  if (catalogError) {
    return (
      <ThemeProvider>
        <CatalogFailure error={catalogError} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <MotionProvider>
        <DensityProvider>
          <QueryClientProvider client={queryClient}>
            <ForgeAccessProvider>
              <BrowserRouter basename={import.meta.env.BASE_URL}>
                <Shell />
              </BrowserRouter>
            </ForgeAccessProvider>
          </QueryClientProvider>
        </DensityProvider>
      </MotionProvider>
    </ThemeProvider>
  );
}
