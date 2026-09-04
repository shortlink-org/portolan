// The bus, in process: what the relay delivers to and policies subscribe on.
// A message is what the outbox row held; the event's name is on its metadata,
// so a subscriber dispatches without parsing the payload.
export interface Message {
  uuid: string;
  topic: string;
  payload: unknown;
  metadata: Record<string, string>;
}

export type Handler = (message: Message) => Promise<void>;

export const METADATA_EVENT_NAME = "event_name";

export class Bus {
  private readonly handlers = new Map<string, Handler[]>();

  subscribe(topic: string, handler: Handler): void {
    this.handlers.set(topic, [...(this.handlers.get(topic) ?? []), handler]);
  }

  async publish(message: Message): Promise<void> {
    for (const handler of this.handlers.get(message.topic) ?? []) await handler(message);
  }
}
