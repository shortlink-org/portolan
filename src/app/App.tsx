import { lazy, Suspense } from "react";
import { BrowserRouter, useLocation } from "react-router";
import { LandingPage } from "../landing/LandingPage";
import { paths } from "../routes";
import { MotionProvider } from "../lib/motion";
import { ThemeProvider } from "./theme";

// The catalog carries diagram runtimes, API viewers and every generated fact.
// Keep that weight out of the public page; it is fetched only when a catalog
// route is opened. The landing page itself stays immediately available.
const CatalogApp = lazy(() =>
  import("./CatalogApp").then((module) => ({ default: module.CatalogApp })),
);

function RoutedApp() {
  const { pathname } = useLocation();

  if (pathname === paths.landing()) return <LandingPage />;

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-canvas text-muted">
          <span className="mono">loading the catalog…</span>
        </div>
      }
    >
      <CatalogApp />
    </Suspense>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <MotionProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <RoutedApp />
        </BrowserRouter>
      </MotionProvider>
    </ThemeProvider>
  );
}
