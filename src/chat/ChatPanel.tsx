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

function ChatBody({
  onClose,
  onSettings,
  embedded,
}: {
  onClose?: () => void;
  onSettings: () => void;
  embedded: boolean;
}) {
  const route = useChatRoute();
  const answering = route.kind === "proxy" || route.kind === "own";

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      {answering ? (
        <Conversation
          route={route}
          onOwnKey={onSettings}
          onSettings={onSettings}
          {...(onClose ? { onClose } : {})}
        />
      ) : (
        <>
          <Header
            route={route}
            onSettings={onSettings}
            {...(onClose ? { onClose } : {})}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {embedded ? (
              <>
                <Notice tone="info" title="bring the model you already use">
                  Connect any OpenAI-compatible endpoint. Its address and key
                  stay in this browser; Portolan supplies the catalog context.
                </Notice>
                <div className="mt-5">
                  <ModelForm />
                </div>
              </>
            ) : (
              <Notice
                tone="info"
                title="nothing answers yet"
                actions={
                  <button
                    type="button"
                    onClick={onSettings}
                    className={ACTION_ACCENT}
                  >
                    <KeyRound size={13} aria-hidden /> set a model
                  </button>
                }
              >
                This build has no proxy of its own, so the chat needs a model of
                yours: any OpenAI-compatible endpoint and, usually, a key. Both
                stay in this browser.
              </Notice>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ModelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Model settings"
      width="min(540px,92vw)"
    >
      <div className="overflow-y-auto p-4">
        <ModelForm onDone={onClose} />
      </div>
    </Modal>
  );
}

export function ChatSurface({ embedded = false }: { embedded?: boolean }) {
  const [settings, setSettings] = useState(false);

  return (
    <>
      <ChatBody embedded={embedded} onSettings={() => setSettings(true)} />
      <ModelModal open={settings} onClose={() => setSettings(false)} />
    </>
  );
}

export default function ChatPanel() {
  const open = useChatUi((s) => s.open);
  const setOpen = useChatUi((s) => s.setOpen);
  const phone = usePhone();
  const [settings, setSettings] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <SidePanel
        open={open}
        onClose={close}
        side="right"
        label="Ask the catalog"
        width={phone ? "100vw" : "min(560px,92vw)"}
      >
        <ChatBody
          embedded={false}
          onClose={close}
          onSettings={() => setSettings(true)}
        />
      </SidePanel>
      <ModelModal open={settings} onClose={() => setSettings(false)} />
    </>
  );
}
