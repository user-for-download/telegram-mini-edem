import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindSessionDrafts,
  captureSessionDraftSubmission,
  clearSessionDraft,
  getSessionDraftScope,
  readSessionDraft,
  subscribeSessionDrafts,
  writeSessionDraft,
} from "@/helpers/sessionDrafts";

beforeEach(() => bindSessionDrafts(null));
afterEach(() => bindSessionDrafts(null));

describe("sessionDrafts", () => {
  it("preserves values (including undefined) when the same identity is rebound", () => {
    bindSessionDrafts("user-1");
    const scope = getSessionDraftScope("user-1");
    writeSessionDraft(scope, "profile", undefined);

    bindSessionDrafts("user-1");

    expect(getSessionDraftScope("user-1")).toBe(scope);
    expect(readSessionDraft(scope, "profile")).toEqual({ value: undefined });
    expect(getSessionDraftScope("user-2")).toBeNull();
  });

  it("rejects writes from the previous session even after the same user logs in again", () => {
    bindSessionDrafts("user-1");
    const oldScope = getSessionDraftScope("user-1");
    writeSessionDraft(oldScope, "profile", "private draft");

    bindSessionDrafts(null);
    bindSessionDrafts("user-1");
    writeSessionDraft(oldScope, "profile", "queued old draft");

    expect(getSessionDraftScope("user-1")).not.toBe(oldScope);
    expect(readSessionDraft(getSessionDraftScope("user-1"), "profile")).toBeUndefined();
  });

  it("old owners cannot read or clear another user's draft", () => {
    bindSessionDrafts("user-1");
    const oldScope = getSessionDraftScope("user-1");
    writeSessionDraft(oldScope, "profile", "old draft");
    bindSessionDrafts("user-2");
    const newScope = getSessionDraftScope("user-2");
    writeSessionDraft(newScope, "profile", "new draft");

    clearSessionDraft(oldScope, "profile");

    expect(readSessionDraft(oldScope, "profile")).toBeUndefined();
    expect(readSessionDraft(newScope, "profile")).toEqual({ value: "new draft" });
  });

  it("does not cache unauthenticated values", () => {
    writeSessionDraft(null, "profile", "private draft");
    bindSessionDrafts("user-1");
    expect(readSessionDraft(getSessionDraftScope("user-1"), "profile")).toBeUndefined();
  });

  it("bounds abandoned drafts to 100, keeping recently edited entries", () => {
    bindSessionDrafts("user-1");
    const scope = getSessionDraftScope("user-1");
    for (let index = 0; index < 100; index += 1) {
      writeSessionDraft(scope, `trip:${index}`, index);
    }
    writeSessionDraft(scope, "trip:0", "recent edit");
    writeSessionDraft(scope, "trip:100", 100);

    expect(readSessionDraft(scope, "trip:1")).toBeUndefined();
    expect(readSessionDraft(scope, "trip:0")).toEqual({ value: "recent edit" });
    expect(readSessionDraft(scope, "trip:100")).toEqual({ value: 100 });
  });

  it("clears only the captured revision and preserves the result on repeated success callbacks", () => {
    bindSessionDrafts("user-1");
    const scope = getSessionDraftScope("user-1");
    writeSessionDraft(scope, "profile", "submitted");
    const committed = captureSessionDraftSubmission(scope, "profile");

    expect(committed()).toBe(true);
    expect(readSessionDraft(scope, "profile")).toBeUndefined();
    writeSessionDraft(scope, "profile", "new draft");
    expect(committed()).toBe(true);
    expect(readSessionDraft(scope, "profile")).toEqual({ value: "new draft" });
  });

  it("does not clear a newer revision, even when its value equals the submitted value", () => {
    bindSessionDrafts("user-1");
    const scope = getSessionDraftScope("user-1");
    writeSessionDraft(scope, "profile", "same value");
    const committed = captureSessionDraftSubmission(scope, "profile");
    writeSessionDraft(scope, "profile", "same value");

    expect(committed()).toBe(false);
    expect(committed()).toBe(false);
    expect(readSessionDraft(scope, "profile")).toEqual({ value: "same value" });
  });

  it("does not clear another key or a reauthenticated session", () => {
    bindSessionDrafts("user-1");
    const oldScope = getSessionDraftScope("user-1");
    writeSessionDraft(oldScope, "profile", "submitted");
    writeSessionDraft(oldScope, "trip:1", "other entity");
    const committed = captureSessionDraftSubmission(oldScope, "profile");
    bindSessionDrafts(null);
    bindSessionDrafts("user-1");
    const newScope = getSessionDraftScope("user-1");
    writeSessionDraft(newScope, "profile", "new session draft");

    expect(committed()).toBe(false);
    expect(readSessionDraft(newScope, "profile")).toEqual({ value: "new session draft" });
  });

  it("an absent or unauthenticated submission callback is an idempotent no-op", () => {
    const unauthenticated = captureSessionDraftSubmission(null, "profile");
    bindSessionDrafts("user-1");
    const scope = getSessionDraftScope("user-1");
    const absent = captureSessionDraftSubmission(scope, "profile");
    writeSessionDraft(scope, "profile", "new draft");

    expect(unauthenticated()).toBe(false);
    expect(absent()).toBe(false);
    expect(absent()).toBe(false);
    expect(readSessionDraft(scope, "profile")).toEqual({ value: "new draft" });
  });

  it("notifies subscribers on writes, clears and auth purge, and unsubscribes", () => {
    bindSessionDrafts("user-1");
    const scope = getSessionDraftScope("user-1");
    const listener = vi.fn();
    const unsubscribe = subscribeSessionDrafts(listener);
    writeSessionDraft(scope, "profile", "draft");
    clearSessionDraft(scope, "profile");
    writeSessionDraft(scope, "profile", "next draft");
    bindSessionDrafts("user-2");
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    writeSessionDraft(getSessionDraftScope("user-2"), "profile", "another draft");
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("compare-and-set partial writes cannot overwrite a newer edit or resurrect a cleared draft", () => {
    bindSessionDrafts("user-1");
    const scope = getSessionDraftScope("user-1");
    writeSessionDraft(scope, "review", { recipients: ["a", "b"], text: "draft" });
    const submitted = readSessionDraft(scope, "review");
    writeSessionDraft(scope, "review", { recipients: ["a", "b"], text: "newer edit" });

    expect(writeSessionDraft(scope, "review", { recipients: ["b"], text: "draft" }, submitted ?? null)).toBe(false);
    const current = readSessionDraft<{ recipients: string[]; text: string }>(scope, "review");
    expect(writeSessionDraft(scope, "review", { recipients: ["b"], text: current?.value.text }, current ?? null)).toBe(true);
    expect(readSessionDraft(scope, "review")).toEqual({ value: { recipients: ["b"], text: "newer edit" } });

    const partial = readSessionDraft(scope, "review");
    clearSessionDraft(scope, "review");
    expect(writeSessionDraft(scope, "review", "stale queued write", partial ?? null)).toBe(false);
    expect(readSessionDraft(scope, "review")).toBeUndefined();
  });

  it("stores its successful result before notifying reentrant subscribers", () => {
    bindSessionDrafts("user-1");
    const scope = getSessionDraftScope("user-1");
    writeSessionDraft(scope, "profile", "submitted");
    const committed = captureSessionDraftSubmission(scope, "profile");
    const observed: boolean[] = [];
    const unsubscribe = subscribeSessionDrafts(() => { observed.push(committed()); });
    expect(committed()).toBe(true);
    expect(observed).toEqual([true]);
    unsubscribe();
  });
});
