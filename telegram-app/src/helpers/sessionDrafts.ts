export interface SessionDraftScope {
  readonly userId: string;
}

/** Immutable wrapper identity is the revision; callers must replace, not mutate, values. */
export interface SessionDraftSnapshot<T> {
  readonly value: T;
}

const MAX_DRAFTS = 100;
let scope: SessionDraftScope | null = null;
const drafts = new Map<string, SessionDraftSnapshot<unknown>>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeSessionDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Only the auth boundary binds this cache; no browser storage or auth imports. */
export function bindSessionDrafts(userId: string | null): void {
  if ((scope?.userId ?? null) === userId) return;
  drafts.clear();
  // Object identity also rejects queued writes after logout/relogin as the same user.
  scope = userId === null ? null : { userId };
  notify();
}

export function getSessionDraftScope(userId: string | null): SessionDraftScope | null {
  return scope?.userId === userId ? scope : null;
}

export function readSessionDraft<T>(
  owner: SessionDraftScope | null,
  formKey: string,
): SessionDraftSnapshot<T> | undefined {
  if (!owner || owner !== scope) return undefined;
  // Each form key must always use the same value type.
  return drafts.get(formKey) as SessionDraftSnapshot<T> | undefined;
}

export function writeSessionDraft(
  owner: SessionDraftScope | null,
  formKey: string,
  value: unknown,
  expected?: SessionDraftSnapshot<unknown> | null,
): boolean {
  if (!owner || owner !== scope) return false;
  // Optional compare-and-set for delayed partial writes; null expects no draft.
  if (expected !== undefined && drafts.get(formKey) !== (expected ?? undefined)) return false;
  drafts.delete(formKey);
  drafts.set(formKey, { value });
  // Bound abandoned entity drafts; evict the least recently written entry.
  if (drafts.size > MAX_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest !== undefined) drafts.delete(oldest);
  }
  notify();
  return true;
}

export function clearSessionDraft(
  owner: SessionDraftScope | null,
  formKey: string,
  expected?: SessionDraftSnapshot<unknown> | null,
): boolean {
  if (!owner || owner !== scope) return false;
  if (expected !== undefined && drafts.get(formKey) !== (expected ?? undefined)) return false;
  const removed = drafts.delete(formKey);
  if (removed) notify();
  return removed;
}

/** Capture BEFORE awaiting the request; safe to invoke after the editor unmounts. */
export function captureSessionDraftSubmission(
  owner: SessionDraftScope | null,
  formKey: string,
): () => boolean {
  const submitted = readSessionDraft(owner, formKey);
  let result: boolean | undefined;
  return () => {
    if (result === undefined) {
      result = owner !== null && owner === scope && submitted !== undefined && drafts.get(formKey) === submitted;
      // Set the result before notifying subscribers, including reentrant callers.
      if (result) clearSessionDraft(owner, formKey, submitted);
    }
    return result;
  };
}
