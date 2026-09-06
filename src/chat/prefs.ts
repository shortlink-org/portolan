// The reader's side of the chat: the switch and their own model, in this
// browser. The decision that combines them with the build is in flags.ts.

import { useMemo } from "react";
import { create } from "zustand";
import { BUILD, chatRoute, parsePrefs } from "./flags";
import type { ChatPrefs, ChatRoute, OwnModel } from "./flags";

const KEY_ENABLED = "portolan.chat.enabled";
const KEY_OWN = "portolan.chat.model";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: this session keeps the setting, the next one starts over */
  }
}

interface PrefsState extends ChatPrefs {
  setEnabled: (enabled: boolean) => void;
  setOwn: (own: OwnModel | null) => void;
}

export const usePrefs = create<PrefsState>()((set) => ({
  ...parsePrefs(read(KEY_ENABLED), read(KEY_OWN)),
  setEnabled: (enabled) => {
    write(KEY_ENABLED, enabled ? "on" : "off");
    set({ enabled });
  },
  setOwn: (own) => {
    write(KEY_OWN, own ? JSON.stringify(own) : null);
    set({ own });
  },
}));

/** Who answers, for this build and this reader. */
export function useChatRoute(): ChatRoute {
  const enabled = usePrefs((s) => s.enabled);
  const own = usePrefs((s) => s.own);
  return useMemo(() => chatRoute(BUILD, { enabled, own }), [enabled, own]);
}

/** Whether the top bar shows the button at all. */
export function useChatAvailable(): boolean {
  return useChatRoute().kind !== "off";
}
