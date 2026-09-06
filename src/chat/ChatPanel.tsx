// Ask the catalog: the panel itself.
//
// A sheet on the right, and inside it the conversation - or, with nothing
// set to answer, a word on what to set. Loaded lazily from the shell: the
// SDK and the transports ride in this chunk, so a reader who never opens the
// panel never downloads them, and a build with VITE_CHAT=off never emits it.

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { usePhone } from "../app/responsive";
import { Modal, SidePanel } from "../components/Overlay";
import { ModelForm } from "./ChatSettings";
import { Conversation } from "./Conversation";
import { Header } from "./Header";
import { ACTION_ACCENT, Notice } from "./Notice";
import { useChatRoute } from "./prefs";
import { useChatUi } from "./store";

export default function ChatPanel() {
  const open = useChatUi((s) => s.open);
  const setOpen = useChatUi((s) => s.setOpen);
  const route = useChatRoute();
  const phone = usePhone();
  const [settings, setSettings] = useState(false);
  const close = () => setOpen(false);
  const answering = route.kind === "proxy" || route.kind === "own";

  return (
    <>
      <SidePanel
        open={open}
        onClose={close}
        side="right"
        label="Ask the catalog"
        width={phone ? "100vw" : "min(560px,92vw)"}
      >
        <div className="flex h-full flex-col bg-canvas text-ink">
          {answering ? (
            <Conversation
              route={route}
              onOwnKey={() => setSettings(true)}
              onSettings={() => setSettings(true)}
              onClose={close}
            />
          ) : (
            <>
              <Header route={route} onSettings={() => setSettings(true)} onClose={close} />
              <div className="px-4 py-4">
              <Notice
                tone="info"
                title="nothing answers yet"
                actions={
                  <button type="button" onClick={() => setSettings(true)} className={ACTION_ACCENT}>
                    <KeyRound size={13} aria-hidden /> set a model
                  </button>
                }
              >
                This build has no proxy of its own, so the chat needs a model of
                yours: any OpenAI-compatible endpoint and, usually, a key. Both
                stay in this browser.
              </Notice>
              </div>
            </>
          )}
        </div>
      </SidePanel>
      <Modal
        open={settings}
        onClose={() => setSettings(false)}
        label="Model settings"
        width="min(540px,92vw)"
      >
        <div className="overflow-y-auto p-4">
          <ModelForm onDone={() => setSettings(false)} />
        </div>
      </Modal>
    </>
  );
}
