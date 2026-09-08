// The conversation: the SDK's messages, arranged.
//
// What is added to useChat here is the catalog - ids in an answer become
// links, and a show_* call becomes a card drawn from the data the app
// already holds - and the shape of the wait, which on a free tier is long
// enough to need a shape.

import { useEffect, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { Chat, useChat } from "@ai-sdk/react";
import { getToolName, isToolUIPart } from "ai";
import type { ChatStatus, UIMessage } from "ai";
import { Markdown } from "../components/Markdown";
import { activeCatalogProfile, catalog } from "../data";
import { paletteItems } from "../lib/palette";
import { ToolCard, toolOutput } from "./Cards";
import { Composer } from "./Composer";
import { routeLabel } from "./flags";
import type { ChatRoute } from "./flags";
import { Header } from "./Header";
import { linkify } from "./linkify";
import { Message } from "./Message";
import { TroubleNotice, classify } from "./Notice";
import { DISPLAY_TOOLS } from "./prompt";
import type { ToolName } from "./prompt";
import { Starter } from "./Starter";
import { ReadSteps } from "./Steps";
import type { Read } from "./Steps";
import { useChatUi } from "./store";
import { transportFor } from "./transport";
import { Sprite } from "./Waiting";
import { pageContext } from "./page-context";

export type Answering = Extract<ChatRoute, { kind: "proxy" | "own" }>;

const base = import.meta.env.BASE_URL;
const stayHere = () => {};

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

function isDisplayTool(name: string): name is ToolName {
  return (DISPLAY_TOOLS as readonly string[]).includes(name);
}

function pathOf(input: unknown): string | null {
  const path = (input as { path?: unknown } | undefined)?.path;
  return typeof path === "string" ? path : null;
}

/** The line beside the moving boat, or null when the answer itself is arriving. */
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
  if (part.type === "text")
    return part.state === "streaming" ? null : "thinking…";
  if (isToolUIPart(part) && getToolName(part) === "read_page") {
    if (part.state === "input-streaming" || part.state === "input-available") {
      return `reading ${pathOf(part.input) ?? "a page"}`;
    }
  }
  return "thinking…";
}

function Answer({
  message,
  onNavigate,
}: {
  message: UIMessage;
  onNavigate: () => void;
}) {
  // The pages read, gathered into one line where the first of them was.
  const reads: Read[] = [];
  for (const part of message.parts) {
    if (
      isToolUIPart(part) &&
      getToolName(part) === "read_page" &&
      (part.state === "output-available" || part.state === "output-error")
    ) {
      const path = pathOf(part.input);
      if (path) reads.push({ path });
    }
  }
  let readsShown = false;

  return (
    <>
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return part.text ? (
            <Markdown key={index}>{linkify(part.text, LINKS)}</Markdown>
          ) : null;
        }
        if (!isToolUIPart(part)) return null;
        const name = getToolName(part);
        if (name === "read_page") {
          if (readsShown) return null;
          readsShown = true;
          return <ReadSteps key={index} reads={reads} />;
        }
        if (isDisplayTool(name) && part.state !== "input-streaming") {
          return (
            <ToolCard
              key={index}
              name={name}
              input={part.input}
              onNavigate={onNavigate}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function SeededExchange({ onNavigate }: { onNavigate: () => void }) {
  return (
    <>
      <Message role="user">Show the “Checkout” flow.</Message>
      <Message role="assistant" foot="grounded in flows/cart-checkout.md">
        <ReadSteps reads={[{ path: "flows/cart-checkout.md" }]} />
        <p className="leading-6 text-muted">
          <span className="font-medium text-ink">shop.cart</span> validates the
          session with auth.auth, loads the basket, requests its total from
          shop.pricing, saves it, then publishes BasketCheckedOut.
        </p>
        <ToolCard
          name="show_flow"
          input={{ id: "flow.cart-checkout" }}
          onNavigate={onNavigate}
        />
      </Message>
    </>
  );
}

export function Conversation({
  route,
  onOwnKey,
  onSettings,
  onClose,
  seeded = false,
}: {
  route: Answering;
  onOwnKey: () => void;
  onSettings: () => void;
  /** Omitted when the conversation is embedded in a page. */
  onClose?: () => void;
  /** Show one useful, catalog-grounded exchange before the reader asks. */
  seeded?: boolean;
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
  const location = useLocation();
  const page = useMemo(() => pageContext(location.pathname), [location.pathname]);
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

  const send = (question: string) => {
    if (busy) return;
    useChatUi.getState().setAskedAt(Date.now());
    void sendMessage(
      { text: question },
      {
        body: {
          catalogId: activeCatalogProfile.id,
          ...(page ? { pageContext: page } : {}),
        },
      },
    );
  };

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
    onClose?.();
  };

  return (
    <>
      <Header
        route={route}
        page={page}
        onSettings={onSettings}
        {...(onClose ? { onClose } : {})}
        {...(messages.length > 0 && !busy
          ? { onClear: () => setMessages([]) }
          : {})}
      />
      <div
        ref={list}
        onClick={onClick}
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
      >
        {seeded ? (
          <SeededExchange onNavigate={onClose ?? stayHere} />
        ) : messages.length === 0 ? (
          <Starter onAsk={send} page={page} />
        ) : null}
        {messages.map((message) =>
          message.role === "user" ? (
            <Message key={message.id} role="user">
              {message.parts
                .map((part) => (part.type === "text" ? part.text : ""))
                .join("")}
            </Message>
          ) : message.role === "assistant" ? (
            <Message
              key={message.id}
              role="assistant"
              {...(took[message.id] !== undefined
                ? { foot: `took ${took[message.id]}s` }
                : {})}
            >
              <Answer message={message} onNavigate={onClose ?? stayHere} />
            </Message>
          ) : null,
        )}
        {waiting ? (
          <Message role="assistant" glyph={<Sprite className="text-accent" />}>
            <span role="status" className="mono text-muted">
              {waiting}
            </span>
          </Message>
        ) : null}
        {error && !busy ? (
          <div className="pl-10">
            <TroubleNotice
              trouble={classify(error)}
              demo={route.kind === "proxy"}
              where={routeLabel(route)}
              onRetry={() => {
                clearError();
                useChatUi.getState().setAskedAt(Date.now());
                void regenerate({
                  body: {
                    catalogId: activeCatalogProfile.id,
                    ...(page ? { pageContext: page } : {}),
                  },
                });
              }}
              onOwnKey={onOwnKey}
            />
          </div>
        ) : null}
      </div>
      <Composer busy={busy} onSend={send} onStop={() => void stop()} />
    </>
  );
}
