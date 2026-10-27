import {
  readSessionDraft,
  writeSessionDraft,
  type SessionDraftScope,
} from "./sessionDrafts";

export interface ReviewInput {
  rating: number;
  text: string;
}

export interface ReviewDraft {
  selectedTripId: string | null;
  selectedPassengerId: string | null;
  entries: Record<string, ReviewInput>;
}

/** Commit one recipient, not the whole editor; selections/other edits survive. */
export function captureReviewSubmission(
  scope: SessionDraftScope | null,
  formKey: string,
  entryKey: string,
  submitted: ReviewInput,
): () => boolean {
  let committed: boolean | undefined;
  return () => {
    if (committed !== undefined) return committed;
    const current = readSessionDraft<ReviewDraft>(scope, formKey);
    if (!current || current.value.entries[entryKey] !== submitted) {
      committed = false;
      return committed;
    }
    const entries = { ...current.value.entries };
    delete entries[entryKey];
    // Publish the result before synchronous subscribers can invoke us again.
    committed = true;
    committed = writeSessionDraft(scope, formKey, { ...current.value, entries }, current);
    return committed;
  };
}
