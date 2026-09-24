import type { DomainEvent, DomainEventType } from './DomainEvents';

type DomainEventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void> | void;

/**
 * In-process domain event mediator (Mediator + Observer patterns).
 *
 * Mirrors `AuditObserverRegistry` / `NotificationObserverRegistry`: `emit`
 * fans out via `Promise.allSettled` and never throws, so publishers
 * (routes, middleware) stay free of fan-out error handling. `withHandlers`
 * is the test seam; production wiring lives in
 * `registerDomainEventDefaults` (bound as `Tokens.DomainEventBus`).
 */
class DomainEventBus {
  private readonly handlers = new Map<DomainEventType, Array<(event: DomainEvent) => Promise<void>>>();

  public static withHandlers(entries: Array<{ type: DomainEventType; handler: DomainEventHandler }>): DomainEventBus {
    const bus = new DomainEventBus();
    for (const entry of entries) bus.on(entry.type, entry.handler);
    return bus;
  }

  public on<T extends DomainEventType>(type: T, handler: (event: Extract<DomainEvent, { type: T }>) => Promise<void> | void): () => void {
    const list = this.handlers.get(type) ?? [];
    // Normalize to async at registration so `emit` aggregates pure
    // promises (sync handlers stay ergonomic for tests).
    const wrapped = async (event: DomainEvent): Promise<void> => {
      await handler(event as Extract<DomainEvent, { type: T }>);
    };
    list.push(wrapped);
    this.handlers.set(type, list);
    return () => {
      const current = this.handlers.get(type) ?? [];
      this.handlers.set(
        type,
        current.filter((h) => h !== wrapped),
      );
    };
  }

  public get size(): number {
    let total = 0;
    for (const list of this.handlers.values()) total += list.length;
    return total;
  }

  public async emit(event: DomainEvent): Promise<void> {
    const list = this.handlers.get(event.type) ?? [];
    await Promise.allSettled(list.map((handler) => handler(event)));
  }
}

export { DomainEventBus };
export type { DomainEventHandler };
