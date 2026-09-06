// How a question reaches a model.
//
// Through the proxy it is one POST to the worker, which holds the key and the
// tools. With the reader's own key the whole loop runs in the browser: the
// agent, the read_page tool and the index it needs - fetched on the first
// question, not at load, because most readers never open the panel.

import {
  DefaultChatTransport,
  DirectChatTransport,
  ToolLoopAgent,
  stepCountIs,
} from "ai";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ChatRoute, OwnModel } from "./flags";
import { instructions, MAX_STEPS } from "./prompt";
import { useChatUi } from "./store";
import { browserTools, loadIndex } from "./tools";

type Answering = Extract<ChatRoute, { kind: "proxy" | "own" }>;

class OwnTransport implements ChatTransport<UIMessage> {
  private inner: Promise<ChatTransport<UIMessage>> | null = null;

  constructor(private readonly own: OwnModel) {}

  private async build(): Promise<ChatTransport<UIMessage>> {
    const ui = useChatUi.getState();
    ui.setPhase("index");
    let index: string;
    try {
      index = await loadIndex();
    } finally {
      useChatUi.getState().setPhase(null);
    }
    const provider = createOpenAICompatible({
      name: "own",
      baseURL: this.own.baseUrl.trim().replace(/\/+$/, ""),
      ...(this.own.apiKey.trim() ? { apiKey: this.own.apiKey.trim() } : {}),
    });
    const agent = new ToolLoopAgent({
      model: provider.chatModel(this.own.model.trim()),
      instructions: instructions(index),
      tools: browserTools(),
      stopWhen: stepCountIs(MAX_STEPS),
    });
    return new DirectChatTransport({ agent }) as unknown as ChatTransport<UIMessage>;
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    this.inner ??= this.build().catch((error: unknown) => {
      this.inner = null;
      throw error;
    });
    return (await this.inner).sendMessages(options);
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}

export function transportFor(route: Answering): ChatTransport<UIMessage> {
  return route.kind === "proxy"
    ? new DefaultChatTransport<UIMessage>({ api: route.url })
    : new OwnTransport(route.model);
}
