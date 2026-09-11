// The optional hand-off from the catalog to the Notion workspace where a
// team writes.
//
// Notion has no search address a link can open, so this is the workspace or
// teamspace itself: a page says where the documentation lives without
// pretending to know the page. An exact page would need the catalog to carry
// its URL, which is a field, not a reader preference.

import { createIntegrationStore } from "./integration-url";

export const NOTION_KEY = "portolan.integrations.notion";

export const useNotion = createIntegrationStore(NOTION_KEY);
