// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode, useLayoutEffect } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { clearSessionDraft, getSessionDraftScope, readSessionDraft, writeSessionDraft } from "@/helpers/sessionDrafts";
import { useAuthStore } from "@/store/useAuthStore";
import type { User } from "@/types";

vi.mock("@/utils/telegram-adapter", () => ({
  getRawInitData: vi.fn(),
  purgeLaunchParamsCache: vi.fn(),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const user: User = {
  id: "user-1",
  name: "Draft tester",
  avatar: "https://example.com/avatar.svg",
  rating: 5,
  reviewsCount: 0,
  tripsCount: 0,
  isVerified: true,
  notificationsEnabled: true,
  verifiedAt: null,
  onboardingVersion: null,
  createdAt: "2026-10-24T00:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

function authenticate(id = "user-1") {
  useAuthStore.setState({
    status: "authenticated",
    user: { ...user, id },
    session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 },
  });
}

function render(node: ReactNode) {
  act(() => root.render(<StrictMode>{node}</StrictMode>));
}

function click(label: string) {
  const button = Array.from(container.querySelectorAll("button"))
    .find((node) => node.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  act(() => button.click());
}

function value() {
  return container.querySelector("output")?.textContent;
}

function DraftForm({
  formKey = "profile",
  initialValue = "server value",
  clearBeforeEffects = false,
  onCapture,
  onInspectSetter,
}: {
  formKey?: string;
  initialValue?: string | (() => string);
  clearBeforeEffects?: boolean;
  onCapture?: (committed: () => boolean) => void;
  onInspectSetter?: (setter: Dispatch<SetStateAction<string>>) => void;
}) {
  const [draft, setDraft, clearDraft, captureSubmission] = useSessionDraft(formKey, initialValue);
  useLayoutEffect(() => {
    if (clearBeforeEffects) clearDraft();
  }, [clearBeforeEffects, clearDraft]);
  return (
    <>
      <output>{draft}</output>
      <button type="button" onClick={() => setDraft("edited draft")}>Edit</button>
      <button type="button" onClick={() => {
        setDraft((previous) => `${previous}a`);
        setDraft((previous) => `${previous}b`);
      }}>Batch</button>
      <button type="button" onClick={clearDraft}>Clear</button>
      <button type="button" onClick={() => {
        setDraft("queued draft");
        clearDraft();
      }}>Edit and clear</button>
      <button type="button" onClick={() => onCapture?.(captureSubmission())}>Submit</button>
      <button type="button" onClick={() => onInspectSetter?.(setDraft)}>Inspect setter</button>
    </>
  );
}

beforeEach(() => {
  useAuthStore.setState({ status: "idle", user: null, session: null });
  authenticate();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useAuthStore.setState({ status: "idle", user: null, session: null });
  vi.restoreAllMocks();
});

describe("useSessionDraft", () => {
  it("retains input across unmount/remount for the same user and skips the lazy initializer", () => {
    render(<DraftForm />);
    click("Edit");
    render(null);
    const initialize = vi.fn(() => "new server value");

    render(<DraftForm initialValue={initialize} />);

    expect(value()).toBe("edited draft");
    expect(initialize).not.toHaveBeenCalled();
  });

  it("uses new initial data for pristine forms and ignores initial-value changes while mounted", () => {
    render(<DraftForm />);
    render(<DraftForm initialValue="changed server value" />);
    expect(value()).toBe("server value");
    render(null);
    render(<DraftForm initialValue="changed server value" />);
    expect(value()).toBe("changed server value");
  });

  it("isolates entity keys, including changes without unmounting the component", () => {
    render(<DraftForm formKey="trip:1" />);
    click("Edit");
    render(<DraftForm formKey="trip:2" initialValue="trip two" />);
    expect(value()).toBe("trip two");
    click("Batch");
    expect(value()).toBe("trip twoab");

    render(<DraftForm formKey="trip:1" />);
    expect(value()).toBe("edited draft");
    render(<DraftForm formKey="trip:2" />);
    expect(value()).toBe("trip twoab");
  });

  it("clears synchronously without resetting visible input or re-saving on rerender/unmount", () => {
    render(<DraftForm />);
    click("Edit");
    click("Clear");
    expect(readSessionDraft(getSessionDraftScope("user-1"), "profile")).toBeUndefined();
    expect(value()).toBe("edited draft");
    render(<DraftForm initialValue="different baseline" />);
    render(null);
    render(<DraftForm />);
    expect(value()).toBe("server value");
  });

  it("does not restore a state update queued before clear, but accepts new edits after clear", () => {
    render(<DraftForm />);
    click("Edit and clear");
    expect(value()).toBe("queued draft");
    render(null);
    render(<DraftForm />);
    expect(value()).toBe("server value");
    click("Edit");
    click("Clear");
    click("Batch");
    render(null);
    render(<DraftForm />);
    expect(value()).toBe("edited draftab");
  });

  it("clear in the layout phase cannot be undone by a later persistence effect", () => {
    render(<DraftForm />);
    click("Edit");
    act(() => {
      const button = Array.from(container.querySelectorAll("button"))
        .find((node) => node.textContent === "Batch");
      button?.click();
      root.render(<StrictMode><DraftForm clearBeforeEffects /></StrictMode>);
    });
    expect(value()).toBe("edited draftab");
    expect(readSessionDraft(getSessionDraftScope("user-1"), "profile")).toBeUndefined();
    render(null);
    render(<DraftForm />);
    expect(value()).toBe("server value");
  });

  it("behaves as plain state while unauthenticated without adopting that input after login", () => {
    act(() => useAuthStore.setState({ status: "unauthenticated", user: null, session: null }));
    render(<DraftForm />);
    click("Batch");
    expect(value()).toBe("server valueab");
    render(null);
    render(<DraftForm />);
    expect(value()).toBe("server value");
    click("Edit");
    act(() => authenticate());
    expect(value()).toBe("server value");
  });

  it("purges all prior user drafts and resets a mounted form on identity change", () => {
    render(<DraftForm formKey="trip:1" />);
    click("Edit");
    render(<DraftForm />);
    click("Edit");

    act(() => authenticate("user-2"));
    expect(value()).toBe("server value");
    click("Batch");
    act(() => authenticate("user-1"));
    expect(value()).toBe("server value");
    render(<DraftForm formKey="trip:1" />);
    expect(value()).toBe("server value");
  });

  it("rejects pending edits across batched logout/relogin of the same identity", async () => {
    render(<DraftForm />);
    click("Edit");
    await act(async () => {
      container.querySelector("button")?.click();
      await useAuthStore.getState().clearSession("test logout");
      authenticate();
    });
    expect(value()).toBe("server value");
    render(null);
    render(<DraftForm />);
    expect(value()).toBe("server value");
  });

  it("never writes drafts to localStorage or sessionStorage", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    render(<DraftForm />);
    click("Edit");
    render(null);
    render(<DraftForm />);
    click("Clear");
    await act(async () => useAuthStore.getState().clearSession("test logout"));
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("late success after unmount clears the reopened clean editor and follows fresh server data", () => {
    let committed: () => boolean = () => false;
    render(<DraftForm onCapture={(callback) => { committed = callback; }} />);
    click("Edit");
    click("Submit");
    render(null);
    const initial = vi.fn(() => "fresh server value");
    render(<DraftForm initialValue={initial} />);
    expect(value()).toBe("edited draft");
    expect(initial).not.toHaveBeenCalled();

    act(() => { expect(committed()).toBe(true); });

    expect(value()).toBe("fresh server value");
    render(<DraftForm initialValue={() => "later refetched server value"} />);
    expect(value()).toBe("later refetched server value");
    render(null);
    render(<DraftForm initialValue="later refetched server value" />);
    expect(value()).toBe("later refetched server value");
  });

  it("late success cannot clear newer edits made by the reopened editor", () => {
    let committed: () => boolean = () => false;
    render(<DraftForm onCapture={(callback) => { committed = callback; }} />);
    click("Edit");
    click("Submit");
    render(null);
    render(<DraftForm />);
    click("Batch");

    act(() => { expect(committed()).toBe(false); });

    expect(value()).toBe("edited draftab");
    render(null);
    render(<DraftForm />);
    expect(value()).toBe("edited draftab");
    expect(committed()).toBe(false);
  });

  it("late success for another entity clears only its captured key", () => {
    let committed: () => boolean = () => false;
    render(<DraftForm formKey="trip:1" onCapture={(callback) => { committed = callback; }} />);
    click("Edit");
    click("Submit");
    render(<DraftForm formKey="trip:2" initialValue="trip two" />);
    click("Batch");

    act(() => { expect(committed()).toBe(true); });

    expect(value()).toBe("trip twoab");
    render(<DraftForm formKey="trip:1" initialValue="fresh trip one" />);
    expect(value()).toBe("fresh trip one");
  });

  it("repeated successful callbacks do not clear drafts edited after the first cleanup", () => {
    let committed: () => boolean = () => false;
    render(<DraftForm onCapture={(callback) => { committed = callback; }} />);
    click("Edit");
    click("Submit");
    act(() => { expect(committed()).toBe(true); });
    click("Batch");

    act(() => { expect(committed()).toBe(true); });

    expect(value()).toBe("server valueab");
    expect(readSessionDraft(getSessionDraftScope("user-1"), "profile")).toEqual({ value: "server valueab" });
  });

  it("captures synchronous pending input and success cannot be undone by queued renders or unmount", () => {
    let committed: () => boolean = () => false;
    render(<DraftForm onCapture={(callback) => { committed = callback; }} />);
    const buttons = Array.from(container.querySelectorAll("button"));
    act(() => {
      buttons.find((button) => button.textContent === "Edit")?.click();
      buttons.find((button) => button.textContent === "Submit")?.click();
      expect(readSessionDraft(getSessionDraftScope("user-1"), "profile")).toEqual({ value: "edited draft" });
      expect(committed()).toBe(true);
      root.render(null);
    });

    render(<DraftForm initialValue="fresh baseline" />);

    expect(value()).toBe("fresh baseline");
    expect(readSessionDraft(getSessionDraftScope("user-1"), "profile")).toBeUndefined();
  });

  it("captures pristine authenticated submissions without calling the initializer while cached", () => {
    let committed: () => boolean = () => false;
    render(<DraftForm onCapture={(callback) => { committed = callback; }} />);
    click("Submit");
    render(null);
    const initial = vi.fn(() => "fresh baseline");
    render(<DraftForm initialValue={initial} />);
    expect(value()).toBe("server value");
    expect(initial).not.toHaveBeenCalled();
    act(() => { expect(committed()).toBe(true); });
    expect(value()).toBe("fresh baseline");
  });

  it("same-user refresh keeps the captured revision but identity change fails closed", () => {
    let committed: () => boolean = () => false;
    render(<DraftForm onCapture={(callback) => { committed = callback; }} />);
    click("Edit");
    click("Submit");
    act(() => useAuthStore.setState({
      status: "authenticated",
      user: { ...user, name: "Refreshed same user" },
      session: { accessToken: "new-access", refreshToken: "new-refresh", expiresAt: 1 },
    }));
    expect(value()).toBe("edited draft");
    act(() => { expect(committed()).toBe(true); });
    click("Edit");
    click("Submit");
    act(() => authenticate("user-2"));
    click("Batch");

    act(() => { expect(committed()).toBe(false); });

    expect(value()).toBe("server valueab");
  });

  it.each(["logout", "ban", "delete"] as const)("late success after %s cannot clear a reauthenticated draft", async (reason) => {
    let committed: () => boolean = () => false;
    render(<DraftForm onCapture={(callback) => { committed = callback; }} />);
    click("Edit");
    click("Submit");
    await act(async () => {
      if (reason === "logout") await useAuthStore.getState().clearSession("test logout");
      if (reason === "ban") useAuthStore.getState().markBanned(null);
      if (reason === "delete") useAuthStore.getState().markAccountDeleted();
      authenticate();
    });
    click("Batch");

    act(() => { expect(committed()).toBe(false); });

    expect(value()).toBe("server valueab");
  });

  it("external partial writes notify the reopened editor and pending edits read the latest revision", () => {
    render(<DraftForm formKey="review" />);
    click("Edit");
    render(null);
    render(<DraftForm formKey="review" />);
    const scope = getSessionDraftScope("user-1");
    const submitted = readSessionDraft(scope, "review");
    const batch = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Batch");
    act(() => {
      expect(writeSessionDraft(scope, "review", "remaining recipients", submitted ?? null)).toBe(true);
      batch?.click();
    });
    expect(value()).toBe("remaining recipientsab");

    act(() => {
      expect(writeSessionDraft(scope, "review", "stale partial result", submitted ?? null)).toBe(false);
    });
    expect(value()).toBe("remaining recipientsab");
    act(() => { clearSessionDraft(scope, "review"); });
    expect(value()).toBe("server value");
    render(<DraftForm formKey="review" initialValue={() => "updated server value"} />);
    expect(value()).toBe("updated server value");
  });

  it("a stale event handler after external clear cannot seed the old cached value again", () => {
    render(<DraftForm />);
    click("Edit");
    const batch = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Batch");
    act(() => {
      clearSessionDraft(getSessionDraftScope("user-1"), "profile");
      batch?.click();
    });
    expect(value()).toBe("server valueab");
  });

  it("unauthenticated submission callbacks do not persist or reset ordinary local state", () => {
    let committed: () => boolean = () => true;
    act(() => useAuthStore.setState({ status: "unauthenticated", user: null, session: null }));
    render(<DraftForm onCapture={(callback) => { committed = callback; }} />);
    click("Batch");
    click("Submit");
    expect(committed()).toBe(false);
    expect(value()).toBe("server valueab");
    click("Clear");
    expect(value()).toBe("server valueab");
    render(null);
    render(<DraftForm />);
    expect(value()).toBe("server value");
  });

  it("late success and external partial writes never write browser storage", () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    let committed: () => boolean = () => false;
    render(<DraftForm onCapture={(callback) => { committed = callback; }} />);
    click("Edit");
    click("Submit");
    render(null);
    render(<DraftForm />);
    act(() => { expect(committed()).toBe(true); });
    act(() => { writeSessionDraft(getSessionDraftScope("user-1"), "profile", "partial update", null); });
    expect(value()).toBe("partial update");
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("keeps dispatch identity stable while values change", () => {
    const setters: Dispatch<SetStateAction<string>>[] = [];
    const inspect = (setter: Dispatch<SetStateAction<string>>) => { setters.push(setter); };
    render(<DraftForm onInspectSetter={inspect} />);
    click("Inspect setter");
    click("Edit");
    click("Inspect setter");
    expect(setters[1]).toBe(setters[0]);
  });

  it("an unmounted editor's retained setter cannot resurrect a submitted draft", () => {
    let committed: () => boolean = () => false;
    let staleSetter: Dispatch<SetStateAction<string>> = () => {};
    render(<DraftForm
      onCapture={(callback) => { committed = callback; }}
      onInspectSetter={(setter) => { staleSetter = setter; }}
    />);
    click("Edit");
    click("Submit");
    click("Inspect setter");
    render(null);
    expect(committed()).toBe(true);
    staleSetter("stale async update");

    render(<DraftForm initialValue="fresh server value" />);

    expect(value()).toBe("fresh server value");
    expect(readSessionDraft(getSessionDraftScope("user-1"), "profile")).toBeUndefined();
  });
});
