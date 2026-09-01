import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
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
import { AdrDetail } from "../pages/AdrDetail";
import { Overview } from "../pages/Overview";
import { ContextMap } from "../pages/ContextMap";
import { ContextPage } from "../pages/ContextPage";
import { ServicePage } from "../pages/ServicePage";
import { AggregatePage } from "../pages/AggregatePage";
import { BlockPage } from "../pages/BlockPage";
import { EventPage } from "../pages/EventPage";
import { GraphPage } from "../pages/GraphPage";
import { Problems } from "../pages/Problems";
import { NotFoundPage } from "../pages/NotFound";
import { CatalogFailure } from "../pages/CatalogFailure";
import { catalogError } from "../data";
import { SidePanel } from "../components/Overlay";
import { WithDetail } from "../selection/DetailPanel";
import { SelectionSync } from "../selection/sync";
import { Trail } from "../trail/Trail";
import { TrailRecorder } from "../trail/record";
import { HashScroll } from "./HashScroll";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SearchProvider } from "./search";
import { ThemeProvider } from "./theme";
import { DensityProvider } from "./density";
import { useNarrow } from "./responsive";
import { ShortcutsSheet, useShortcuts } from "./shortcuts";
import { useUiStore } from "./ui-store";

/** Every route, once. Rendered inside a pane on wide layouts and alone below. */
function AppRoutes() {
  return (
    <Routes>
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
      <Route path="/adrs/:adr" element={<AdrDetail />} />
      <Route path="/problems" element={<Problems />} />
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
  const [railed, setRailed] = useState(false);
  const { pathname } = useLocation();
  const settle = useCanvasResize();
  const sidebarRef = usePanelRef();
  const narrow = useNarrow();
  const toggleDrawer = useUiStore((s) => s.toggleDrawer);
  const setDrawer = useUiStore((s) => s.setDrawer);
  const toggleDetail = useUiStore((s) => s.toggleDetail);
  const revealNonce = useUiStore((s) => s.revealNonce);

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
    !palette && !help,
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
      {/* Under the bar, above everything: the trail is about the whole shell,
          not about the page inside it. */}
      <Trail />

      {narrow ? (
        <>
          {/* `key` on the route content is what makes the page transition fire:
              a new pathname is a new element, so the mount animation runs again. */}
          <main
            key={pathname}
            className="page-in min-h-0 flex-1 overflow-hidden"
          >
            <AppRoutes />
          </main>
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
            <main key={pathname} className="page-in h-full overflow-hidden">
              <AppRoutes />
            </main>
          </Panel>
        </SavedGroup>
      )}

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <ShortcutsSheet open={help} onClose={() => setHelp(false)} />
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
      <DensityProvider>
        <SearchProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Shell />
          </BrowserRouter>
        </SearchProvider>
      </DensityProvider>
    </ThemeProvider>
  );
}
