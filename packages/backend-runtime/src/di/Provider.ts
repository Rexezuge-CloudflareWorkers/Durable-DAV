/**
 * Canonical lazy-dependency handle (Layer 1).
 *
 * Every service constructor takes `() => Promise<DAO>` thunks so DAO
 * construction stays lazy + memoized per request scope. This alias names
 * that shape once — service `*Deps` interfaces, `DaoThunks`, and `Tokens`
 * DAO bindings all spell the same `Provider<DAO>` instead of repeating the
 * raw function type. See `RepoServiceDepsBuilder` for the fluent composer.
 */
type Provider<T> = () => Promise<T>;

/**
 * Lift an already-constructed value (tests, fakes) into a `Provider`.
 */
function providerOf<T>(value: T): Provider<T> {
  return () => Promise.resolve(value);
}

export { providerOf };
export type { Provider };
