import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";

// A deploy replaces every hashed chunk at once, but a static host may keep
// serving the old index.html from cache for a while (GitLab Pages caches every
// file for ten minutes and lets a project set no headers of its own). A tab
// that opened on the old page then asks for chunks that no longer exist, the
// lazy import fails, and the reader sees an empty canvas. Vite reports that
// failure here before it throws; one reload revalidates the document and
// picks up the new names. The guard is keyed by the chunk that failed, so a
// chunk that is truly missing cannot reload the page forever.
const RELOADED = "portolan:reloaded-for";
window.addEventListener("vite:preloadError", (event) => {
  const failed = String((event as Event & { payload?: unknown }).payload ?? "");
  let already = "";
  try {
    already = sessionStorage.getItem(RELOADED) ?? "";
    sessionStorage.setItem(RELOADED, failed);
  } catch {
    // Storage may be unavailable; a single reload is still worth trying.
  }
  if (already === failed) return;
  event.preventDefault();
  window.location.reload();
});

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
