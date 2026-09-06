// Ask the catalog.
//
// A panel on the right: the conversation, the question box, and the state of
// whoever is answering. The messages are the SDK's; what is added here is the
// catalog - ids in an answer become links, and a show_* call becomes a card
// drawn from the data the app already holds.
//
// Loaded lazily from the shell. The SDK and the transports ride in this chunk,
// so a reader who never opens the panel never downloads them, and a build
// with VITE_CHAT=off never emits it.

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router";
import { Chat, useChat } from "@ai-sdk/react";
import { getToolName, isToolUIPart } from "ai";
import type { ChatStatus, UIMessage } from "ai";
import {
  Eraser,
  FileText,
  KeyRound,
  MessageSquare,
  Send,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { usePhone } from "../app/responsive";
import { Markdown } from "../components/Markdown";
import { Modal, SidePanel } from "../components/Overlay";
import { catalog } from "../data";
import { paletteItems } from "../lib/palette";
import { ToolCard, toolOutput } from "./Cards";
import { ModelForm } from "./ChatSettings";
import { routeLabel } from "./flags";
import type { ChatRoute } from "./flags";
import { LimitCard, classify } from "./LimitCard";
import { linkify } from "./linkify";
import { useChatRoute } from "./prefs";
import { DISPLAY_TOOLS } from "./prompt";
import type { ToolName } from "./prompt";
import { useChatUi } from "./store";
import { transportFor } from "./transport";
import { Waiting } from "./Waiting";

type Answering = Extract<ChatRoute, { kind: "proxy" | "own" }>;

const base = import.meta.env.BASE_URL;

/** Every id the catalog has a page for, and the page. */
const LINKS: ReadonlyMap<string, string> = (() => {
  const links = new Map<string, string>();
  for (const item of paletteItems(catalog)) {
    if (item.path && !links.has(item.id))
      links.set(item.id, `${base}${item.path.replace(/^\//, "")}`);
  }
  return links;
})();

/**
 * One conversation per answerer, kept for the tab's lifetime: the panel is a
 * dialog and unmounts when it closes, and a reader who closes it to look at a
 * page should find their question still there when they come back.
 */
const chats = new Map<string, Chat<UIMessage>>();
function chatFor(route: Answering): Chat<UIMessage> {
  const key = JSON.stringify(route);
  let chat = chats.get(key);
  if (!chat) {
    chat = new Chat<UIMessage>({
      transport: transportFor(route),
      onFinish: ({ message }) => {
        const ui = useChatUi.getState();
        if (ui.askedAt !== null) {
          ui.noteTook(message.id, Math.round((Date.now() - ui.askedAt) / 1000));
          ui.setAskedAt(null);
        }
      },
    });
    chats.set(key, chat);
  }
  return chat;
}

/** Questions this catalog can answer, offered under an empty conversation. */
function examples(): string[] {
  const contexts = catalog.contexts.map((c) => c.id);
  const flow = catalog.flows[0];
  const out: string[] = [];
  if (contexts.length >= 2)
    out.push(`What runs between ${contexts[0]} and ${contexts[1]}?`);
  if (contexts[1]) out.push(`Which events does ${contexts[1]} consume?`);
  if (flow) out.push(`Show the "${flow.name}" flow`);
  if (contexts[0]) out.push(`Which decisions touch ${contexts[0]}?`);
  return out;
}

function isDisplayTool(name: string): name is ToolName {
  return (DISPLAY_TOOLS as readonly string[]).includes(name);
}

/** The line under the sprite, or null when the answer itself is arriving. */
function waitingLabel(
  messages: UIMessage[],
  status: ChatStatus,
  phase: "index" | null,
): string | null {
  if (status !== "submitted" && status !== "streaming") return null;
  if (phase === "index") return "reading the catalog…";
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return "thinking…";
  const part = last.parts[last.parts.length - 1];
  if (!part) return "thinking…";
  if (part.type === "text") return part.state === "streaming" ? null : "thinking…";
  if (isToolUIPart(part) && getToolName(part) === "read_page") {
    if (part.state === "input-streaming" || part.state === "input-available") {
      const path = (part.input as { path?: unknown } | undefined)?.path;
      return `reading ${typeof path === "string" ? path : "a page"}`;
    }
  }
  return "thinking…";
}

function Header({
  route,
  onSettings,
  onClear,
  onClose,
}: {
  route: ChatRoute;
  onSettings: () => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const ICON =
    "flex size-8 items-center justify-center rounded-control text-muted t-micro transition-colors hover:bg-surface hover:text-ink";
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
      <MessageSquare size={16} aria-hidden className="shrink-0 text-accent" />
      <div className="min-w-0">
        <div className="font-semibold leading-tight text-ink">ask the catalog</div>
        <div className="mono truncate text-muted">{routeLabel(route) || "not configured"}</div>
      </div>
      <div className="ml-auto flex shrink-0 items-center">
        {onClear ? (
          <button type="button" onClick={onClear} aria-label="Clear the conversation" title="Clear" className={ICON}>
            <Eraser size={15} aria-hidden />
          </button>
        ) : null}
        <button type="button" onClick={onSettings} aria-label="Model settings" title="Model settings" className={ICON}>
          <Settings2 size={15} aria-hidden />
        </button>
        <button type="button" onClick={onClose} aria-label="Close" title="Close — Esc" className={ICON}>
          <X size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function ReadRow({ path, done }: { path: string; done: boolean }) {
  return (
    <div className="mono flex items-center gap-1.5 text-muted">
      <FileText size={13} aria-hidden className="shrink-0" />
      <span>{done ? "read" : "reading"}</span>
      <a
        href={`${base}${path}`}
        target="_blank"
        rel="noreferrer"
        className="truncate text-accent hover:underline"
      >
        {path}
      </a>
    </div>
  );
}

function MessageView({
  message,
  seconds,
  onNavigate,
}: {
  message: UIMessage;
  seconds: number | undefined;
  onNavigate: () => void;
}) {
  if (message.role === "user") {
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    return (
      <div className="ml-8 whitespace-pre-wrap rounded-card bg-surface px-3 py-2 text-ink">
        {text}
      </div>
    );
  }
  if (message.role !== "assistant") return null;
  return (
    <div className="space-y-2">
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return part.text ? (
            <Markdown key={index}>{linkify(part.text, LINKS)}</Markdown>
          ) : null;
        }
        if (isToolUIPart(part)) {
          const name = getToolName(part);
          if (name === "read_page") {
            const path = (part.input as { path?: unknown } | undefined)?.path;
            return typeof path === "string" ? (
              <ReadRow key={index} path={path} done={part.state === "output-available" || part.state === "output-error"} />
            ) : null;
          }
          if (isDisplayTool(name) && part.state !== "input-streaming") {
            return <ToolCard key={index} name={name} input={part.input} onNavigate={onNavigate} />;
          }
        }
        return null;
      })}
      {seconds !== undefined ? (
        <div className="mono text-muted">took {seconds}s</div>
      ) : null}
    </div>
  );
}

function Conversation({
  route,
  onOwnKey,
  onSettings,
  onClose,
}: {
  route: Answering;
  onOwnKey: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const chat = useMemo(() => chatFor(route), [route]);
  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    setMessages,
    addToolOutput,
    regenerate,
    clearError,
  } = useChat({ chat });
  const phase = useChatUi((s) => s.phase);
  const took = useChatUi((s) => s.took);
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const waiting = waitingLabel(messages, status, phase);

  // A show_* call ends the answer; its "output" is a note for the record,
  // written once the stream is over and never sent on its own. It reaches
  // the model only with the reader's next question.
  useEffect(() => {
    if (busy) return;
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== "input-available") continue;
        const name = getToolName(part);
        if (!isDisplayTool(name)) continue;
        void addToolOutput({
          tool: name,
          toolCallId: part.toolCallId,
          output: toolOutput(name, part.input),
        });
      }
    }
  }, [messages, busy, addToolOutput]);

  useEffect(() => {
    const node = list.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, waiting, error]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    useChatUi.getState().setAskedAt(Date.now());
    void sendMessage({ text: question });
    setDraft("");
  };

  const onNavigate = () => onClose();

  // Links in an answer point into the app; follow them without a reload, and
  // get out of the way of the page they open.
  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor || anchor.target === "_blank") return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href.startsWith(base) || /^[a-z]+:/i.test(href)) return;
    event.preventDefault();
    navigate(`/${href.slice(base.length)}`);
    onClose();
  };

  return (
    <>
      <Header
        route={route}
        onSettings={onSettings}
        onClose={onClose}
        {...(messages.length > 0 && !busy ? { onClear: () => setMessages([]) } : {})}
      />
      <div ref={list} onClick={onClick} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="pt-2">
            <p className="text-muted">
              Ask about a service, a flow, a decision, or what stands between two contexts. The answer is read from the catalog's own pages.
            </p>
            <div className="mt-3 space-y-1.5">
              {examples().map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => send(question)}
                  className="block w-full rounded-control border border-line px-3 py-2 text-left text-ink transition-colors hover:border-accent hover:text-accent"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((message) => (
          <MessageView
            key={message.id}
            message={message}
            seconds={took[message.id]}
            onNavigate={onNavigate}
          />
        ))}
        {waiting ? <Waiting label={waiting} /> : null}
        {error && !busy ? (
          <LimitCard
            trouble={classify(error)}
            demo={route.kind === "proxy"}
            onRetry={() => {
              clearError();
              useChatUi.getState().setAskedAt(Date.now());
              void regenerate();
            }}
            onOwnKey={onOwnKey}
          />
        ) : null}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
        className="border-t border-line p-3"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(draft);
            }
          }}
          rows={2}
          placeholder="ask about a service, a flow, a decision…"
          aria-label="Your question"
          className="mono w-full resize-none rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="mono text-muted">⏎ to send · shift ⏎ for a new line</span>
          {busy ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="mono flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1 text-ink transition-colors hover:border-line-strong"
            >
              <Square size={12} aria-hidden /> stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={draft.trim() === ""}
              className="mono flex items-center gap-1.5 rounded-control border border-accent px-2.5 py-1 text-accent transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-50"
            >
              <Send size={12} aria-hidden /> ask
            </button>
          )}
        </div>
      </form>
    </>
  );
}

function Unconfigured({
  route,
  onSettings,
  onClose,
}: {
  route: ChatRoute;
  onSettings: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <Header route={route} onSettings={onSettings} onClose={onClose} />
      <div className="flex-1 px-3 py-4">
        <p className="text-muted">
          Nothing answers yet. This build has no proxy of its own, so the chat needs a model of yours: any OpenAI-compatible endpoint and, usually, a key. Both stay in this browser.
        </p>
        <button
          type="button"
          onClick={onSettings}
          className="mono mt-3 flex items-center gap-1.5 rounded-control border border-accent px-3 py-1.5 text-accent transition-colors hover:bg-raised"
        >
          <KeyRound size={13} aria-hidden /> set a model
        </button>
      </div>
    </>
  );
}

export default function ChatPanel() {
  const open = useChatUi((s) => s.open);
  const setOpen = useChatUi((s) => s.setOpen);
  const route = useChatRoute();
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
        width={phone ? "100vw" : "min(480px,92vw)"}
      >
        <div className="flex h-full flex-col bg-canvas text-ink">
          {route.kind === "proxy" || route.kind === "own" ? (
            <Conversation
              route={route}
              onOwnKey={() => setSettings(true)}
              onSettings={() => setSettings(true)}
              onClose={close}
            />
          ) : (
            <Unconfigured route={route} onSettings={() => setSettings(true)} onClose={close} />
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
