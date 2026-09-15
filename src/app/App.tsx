import { lazy } from "react";
import { BrowserRouter, useLocation } from "react-router";
import { LandingPage } from "../landing/LandingPage";
import { isLandingPath } from "../routes";
import { MotionProvider } from "../lib/motion";
import { SuspenseReveal } from "../components/SuspenseReveal";
import { CatalogLoading } from "../components/CatalogLoading";
import { ThemeProvider } from "./theme";

// The catalog carries diagram runtimes, API viewers and every generated fact.
// Keep that weight out of the public page; it is fetched only when a catalog
// route is opened. The landing page itself stays immediately available.
const CatalogApp = lazy(() =>
  import("./CatalogApp").then((module) => ({ default: module.CatalogApp })),
);

function RoutedApp() {
  const { pathname } = useLocation();

  if (isLandingPath(pathname)) return <LandingPage />;

  return (
    <SuspenseReveal fallback={<CatalogLoading />}>
      <CatalogApp />
    </SuspenseReveal>
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
