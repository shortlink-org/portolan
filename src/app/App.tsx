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
import { ContextPage } from "../pages/ContextPage";
import { ServicePage } from "../pages/ServicePage";
import { AggregatePage } from "../pages/AggregatePage";
import { BlockPage } from "../pages/BlockPage";
import { EventPage } from "../pages/EventPage";
import { GraphPage } from "../pages/GraphPage";
import { NotFoundPage } from "../pages/NotFound";
import { WithDetail } from "../selection/DetailPanel";
import { SelectionSync } from "../selection/sync";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SearchProvider } from "./search";
import { ThemeProvider } from "./theme";

function Shell() {
  const [palette, setPalette] = useState(false);
  const [railed, setRailed] = useState(false);
  const { pathname } = useLocation();
  const settle = useCanvasResize();
  const sidebarRef = usePanelRef();

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <SelectionSync />
      <TopBar onOpenPalette={() => setPalette(true)} />
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
          {/* `key` on the route content is what makes the page transition fire:
              a new pathname is a new element, so the mount animation runs again.
              There is no exit - the outgoing page is simply gone. */}
          <main key={pathname} className="page-in h-full overflow-hidden">
            {/* The detail rail rides along with every page that draws a diagram,
              so a selection made anywhere has somewhere to be read. */}
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
          </main>
        </Panel>
      </SavedGroup>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <SearchProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Shell />
        </BrowserRouter>
      </SearchProvider>
    </ThemeProvider>
  );
}
