// @vitest-environment jsdom
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AppConfig } from "@/AppConfig";
import { useAuthStore } from "@/store/useAuthStore";

vi.mock("@tma.js/sdk-react", () => ({
  retrieveLaunchParams: () => ({ tgWebAppPlatform: "android" }),
  InvalidLaunchParamsError: class extends Error {},
  LaunchParamsRetrieveError: class extends Error {},
  useSignal: (signal: () => unknown) => signal(),
  miniApp: {
    isDark: () => false,
    setHeaderColor: { ifAvailable: vi.fn() },
    setBgColor: { ifAvailable: vi.fn() },
    setBottomBarColor: { ifAvailable: vi.fn() },
  },
  themeParams: { bgColor: () => "#ffffff", state: () => ({}) },
  viewport: { requestFullscreen: { isAvailable: () => false }, isFullscreen: () => false },
}));
vi.mock("@/components/AuthGate", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/Onboarding/Onboarding", () => ({ Onboarding: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/providers/WebSocketProvider", () => ({ WsProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/providers/TelegramRealtimeListener", () => ({ TelegramRealtimeListener: () => null }));
vi.mock("@/components/DevToggles/DevToggles", () => ({ DevToggles: () => null }));
vi.mock("@/components/OfflineBanner", () => ({ OfflineBanner: () => null }));
vi.mock("@/hooks/useTelegramChromiumFallback", () => ({ useTelegramChromiumFallback: () => {} }));

const clients: QueryClient[] = [];
const revisions: Record<string, number> = {};
function Probe() {
  const client = useQueryClient();
  useEffect(() => { clients.push(client); }, [client]);
  return null;
}
function PrivateObservers() {
  const client = useQueryClient();
  const id = useAuthStore((state) => state.user!.id);
  const query = useQuery({ queryKey: ["private-record"], queryFn: async () => `${id}:${revisions[id] ?? 0}` });
  const mutation = useMutation({
    mutationFn: async () => { revisions[id] = (revisions[id] ?? 0) + 1; },
    onSuccess: () => client.invalidateQueries({ queryKey: ["private-record"] }),
  });
  return <><p>{query.data ?? "Loading"}</p><button type="button" onClick={() => mutation.mutate()}>Update</button></>;
}
function owner(id: string | null, token = "test") {
  useAuthStore.setState({
    status: id ? "authenticated" : "unauthenticated",
    user: id ? { id } as never : null,
    session: id ? { accessToken: token, refreshToken: token, expiresAt: 0 } : null,
  });
}
beforeEach(() => { clients.length = 0; revisions.alice = 0; revisions.bob = 0; owner("alice"); });
afterEach(() => { cleanup(); owner(null); });

describe("QueryClient owner isolation", () => {
  it("перемонтирует настоящие query/mutation observers и обновляет только кэш нового владельца", async () => {
    render(<AppConfig><PrivateObservers /></AppConfig>);
    await waitFor(() => expect(screen.getByText("alice:0")).toBeTruthy());
    act(() => { owner("bob"); });
    expect(screen.queryByText("alice:0")).toBeNull();
    await waitFor(() => expect(screen.getByText("bob:0")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(screen.getByText("bob:1")).toBeTruthy());
    expect(revisions.alice).toBe(0);
  });
  it("свежий приватный кэш Alice не виден Bob после смены владельца", () => {
    render(<AppConfig><Probe /></AppConfig>);
    const alice = clients.at(-1)!;
    alice.setQueryData(["users", "me"], { id: "alice", phone: "private", car: { plate: "private" } });
    act(() => { owner("bob"); });
    const bob = clients.at(-1)!;
    expect(bob).not.toBe(alice);
    expect(bob.getQueryData(["users", "me"])).toBeUndefined();
    expect(alice.getQueryCache().getAll()).toHaveLength(0);
  });

  it("обычная ротация токена той же личности сохраняет кэш", () => {
    render(<AppConfig><Probe /></AppConfig>);
    const before = clients.at(-1)!;
    before.setQueryData(["users", "me", "alice"], { id: "alice" });
    act(() => { owner("alice", "rotated"); });
    expect(clients.at(-1)).toBe(before);
    expect(before.getQueryData(["users", "me", "alice"])).toEqual({ id: "alice" });
  });

  it("выход и повторный вход даже тем же пользователем не возвращает старый кэш", () => {
    render(<AppConfig><Probe /></AppConfig>);
    const before = clients.at(-1)!;
    before.setQueryData(["private"], "old");
    act(() => { owner(null); });
    act(() => { owner("alice"); });
    expect(clients.at(-1)).not.toBe(before);
    expect(clients.at(-1)?.getQueryData(["private"])).toBeUndefined();
  });
});
