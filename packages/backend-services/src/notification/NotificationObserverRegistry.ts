type NotificationEvent = {
  kind: string;
  repoId?: string;
  actorEmail?: string;
  payload?: Record<string, unknown>;
};

type NotificationObserver = (event: NotificationEvent) => Promise<void> | void;

class NotificationObserverRegistry {
  private readonly observers: NotificationObserver[];

  private constructor(observers: NotificationObserver[]) {
    this.observers = [...observers];
  }

  public static withDefaults(extra: NotificationObserver[] = []): NotificationObserverRegistry {
    return new NotificationObserverRegistry([...extra]);
  }

  public static withObservers(observers: NotificationObserver[]): NotificationObserverRegistry {
    return new NotificationObserverRegistry(observers);
  }

  public async emit(event: NotificationEvent): Promise<void> {
    for (const observer of this.observers) {
      try {
        await observer(event);
      } catch {
        // Best-effort fan-out: one observer must not break the request.
      }
    }
  }

  public get size(): number {
    return this.observers.length;
  }
}

export { NotificationObserverRegistry };
export type { NotificationEvent, NotificationObserver };
