export type SessionStoreRecord = Record<string, unknown>;

let store: SessionStoreRecord = {};

/**
 * Minimal session-store helpers used by parity tests in this subtree.
 * The full Zee runtime store wiring lives outside this embedded Swabble snapshot.
 */
export function loadSessionStore(): SessionStoreRecord {
  return store;
}

export function setSessionStore(next: SessionStoreRecord): void {
  store = next;
}
