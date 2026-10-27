import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  captureSessionDraftSubmission,
  clearSessionDraft,
  getSessionDraftScope,
  readSessionDraft,
  subscribeSessionDrafts,
  writeSessionDraft,
} from "@/helpers/sessionDrafts";
import type { SessionDraftScope, SessionDraftSnapshot } from "@/helpers/sessionDrafts";
import { useAuthStore } from "@/store/useAuthStore";

interface DraftState<T> {
  scope: SessionDraftScope | null;
  formKey: string;
  snapshot: SessionDraftSnapshot<T> | undefined;
  value: T;
  followInitial: boolean;
}

interface DraftEditor<T> {
  scope: SessionDraftScope | null;
  formKey: string;
  snapshot: SessionDraftSnapshot<T> | undefined;
  value: T;
  initialValue: T | (() => T);
}

function initial<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function initialize<T>(
  scope: SessionDraftScope | null,
  formKey: string,
  snapshot: SessionDraftSnapshot<T> | undefined,
  initialValue: T | (() => T),
): DraftState<T> {
  return {
    scope,
    formKey,
    snapshot,
    value: snapshot ? snapshot.value : initial(initialValue),
    followInitial: false,
  };
}

/**
 * In-memory state for one form/entity in the current authenticated session.
 * Include the entity id in formKey. Initial values are lazy and not cached until
 * edited. clearDraft preserves this editor's visible value (explicit discard).
 * Capture submission BEFORE awaiting; invoke its callback from mutation execution
 * on success, not an observer's per-call callback. Reopened editors observe cleanup.
 */
export function useSessionDraft<T>(
  formKey: string,
  initialValue: T | (() => T),
): [T, Dispatch<SetStateAction<T>>, () => void, () => (() => boolean)] {
  const scope = useAuthStore((state) =>
    getSessionDraftScope(state.session ? state.user?.id ?? null : null),
  );
  const getSnapshot = useCallback(() => readSessionDraft<T>(scope, formKey), [scope, formKey]);
  const snapshot = useSyncExternalStore(subscribeSessionDrafts, getSnapshot, () => undefined);
  const [state, setState] = useState(() => initialize(scope, formKey, snapshot, initialValue));

  // Reset before children render, rather than exposing another entity/user's input.
  if (state.scope !== scope || state.formKey !== formKey) {
    setState(initialize(scope, formKey, snapshot, initialValue));
  } else if (state.snapshot !== snapshot) {
    setState({
      ...state,
      snapshot,
      value: snapshot ? snapshot.value : state.value,
      followInitial: !snapshot,
    });
  }

  // After external cleanup, follow CURRENT server data, including a later refetch.
  // Normal pristine local state remains lazy; cached drafts never call the initializer.
  const value = snapshot ? snapshot.value : state.followInitial ? initial(initialValue) : state.value;
  const editor = useRef<DraftEditor<T> | null>(null);
  // Stable dispatchers read committed data only in handlers, never refs in render.
  useLayoutEffect(() => {
    editor.current = { scope, formKey, snapshot: state.snapshot, value, initialValue };
    return () => { editor.current = null; };
  }, [scope, formKey, state.snapshot, value, initialValue]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const local = editor.current;
    if (!local || local.scope !== scope || local.formKey !== formKey) return;
    if (scope) {
      if (getSessionDraftScope(scope.userId) !== scope) return;
      const current = readSessionDraft<T>(scope, formKey);
      const previous = current ? current.value : local.snapshot ? initial(local.initialValue) : local.value;
      // Persist in the event, not in a React updater/effect that can run after cleanup.
      writeSessionDraft(scope, formKey, typeof next === "function"
        ? (next as (previous: T) => T)(previous)
        : next);
      return;
    }
    setState((previous) => {
      if (previous.scope !== scope || previous.formKey !== formKey) return previous;
      return {
        ...previous,
        value: typeof next === "function" ? (next as (value: T) => T)(previous.value) : next,
      };
    });
  }, [scope, formKey]);

  const clearDraft = useCallback(() => {
    const local = editor.current;
    if (!local || local.scope !== scope || local.formKey !== formKey) return;
    if (!scope || getSessionDraftScope(scope.userId) !== scope) return;
    const current = readSessionDraft<T>(scope, formKey);
    clearSessionDraft(scope, formKey);
    setState({ scope, formKey, snapshot: undefined, value: current ? current.value : local.value, followInitial: false });
  }, [scope, formKey]);

  const captureSubmission = useCallback(() => {
    const local = editor.current;
    if (!local || local.scope !== scope || local.formKey !== formKey) return () => false;
    if (scope && getSessionDraftScope(scope.userId) === scope && !readSessionDraft(scope, formKey)) {
      // Even a pristine submitted form needs a revision to distinguish newer edits.
      writeSessionDraft(scope, formKey, local.snapshot ? initial(local.initialValue) : local.value, null);
    }
    return captureSessionDraftSubmission(scope, formKey);
  }, [scope, formKey]);

  return [value, setValue, clearDraft, captureSubmission];
}
