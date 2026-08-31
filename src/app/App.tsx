import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
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
      <div className="flex min-h-0 flex-1">
        <div className="w-[248px] shrink-0">
          <Sidebar />
        </div>
        <main className="min-w-0 flex-1 overflow-hidden">
          {/* The detail rail rides along with every page that draws a diagram,
              so a selection made anywhere has somewhere to be read. */}
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/flows" element={<FlowIndex />} />
            <Route
              path="/flows/:flow"
              element={
                <WithDetail>
                  <FlowDetail />
                </WithDetail>
              }
            />
            <Route path="/adrs" element={<AdrIndex />} />
            <Route path="/adrs/:adr" element={<AdrDetail />} />
            <Route
              path="/c/:context"
              element={
                <WithDetail>
                  <ContextPage />
                </WithDetail>
              }
            />
            <Route
              path="/c/:context/:service"
              element={
                <WithDetail>
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
                <WithDetail>
                  <EventPage />
                </WithDetail>
              }
            />
            <Route
              path="/graph"
              element={
                <WithDetail>
                  <GraphPage />
                </WithDetail>
              }
            />
            <Route path="/index.html" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <SearchProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </SearchProvider>
    </ThemeProvider>
  );
}
