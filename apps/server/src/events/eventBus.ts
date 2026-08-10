import type { NormalizedEvent } from "@obs-effect/shared-types";

export type EventSubscriber = (event: NormalizedEvent) => void;

export class EventBus {
  private readonly subscribers = new Set<EventSubscriber>();

  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  publish(event: NormalizedEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        // Subscriber failures must not block other event consumers.
      }
    }
  }
}
