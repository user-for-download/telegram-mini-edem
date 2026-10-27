import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureReviewSubmission, type ReviewDraft } from "../reviewDraftCommit";
import { bindSessionDrafts, getSessionDraftScope, readSessionDraft, subscribeSessionDrafts, writeSessionDraft } from "../sessionDrafts";

const submitted = { rating: 5, text: "Отзыв" };
const draft: ReviewDraft = {
  selectedTripId: "t1", selectedPassengerId: "p1",
  entries: { "t1:p1": submitted, "t1:p2": { rating: 3, text: "Другой" } },
};
beforeEach(() => { bindSessionDrafts(null); bindSessionDrafts("owner"); });
afterEach(() => bindSessionDrafts(null));

describe("review recipient commit", () => {
  it("is idempotent even when a synchronous subscriber invokes it again", () => {
    const scope = getSessionDraftScope("owner");
    writeSessionDraft(scope, "review:new", draft);
    const commit = captureReviewSubmission(scope, "review:new", "t1:p1", submitted);
    const results: boolean[] = [];
    const unsubscribe = subscribeSessionDrafts(() => { results.push(commit()); });
    try {
      expect(commit()).toBe(true);
      expect(results).toEqual([true]);
      expect(commit()).toBe(true);
      expect(readSessionDraft<ReviewDraft>(scope, "review:new")?.value).toEqual({
        ...draft, entries: { "t1:p2": draft.entries["t1:p2"] },
      });
    } finally {
      unsubscribe();
    }
  });

  it("rejects an edited recipient and does not retry against later identical text", () => {
    const scope = getSessionDraftScope("owner");
    writeSessionDraft(scope, "review:new", draft);
    const commit = captureReviewSubmission(scope, "review:new", "t1:p1", submitted);
    writeSessionDraft(scope, "review:new", { ...draft, entries: { ...draft.entries, "t1:p1": { ...submitted } } });
    expect(commit()).toBe(false);
    writeSessionDraft(scope, "review:new", draft);
    expect(commit()).toBe(false);
    expect(readSessionDraft(scope, "review:new")?.value).toBe(draft);
  });
});
