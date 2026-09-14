// backend/tests/unit/telegramMetrics.test.ts
//
// Чистая свёртка агрегатов outbox (bot-api shadow): foldGroups без БД,
// renderTelegramMetrics в Prometheus-формате. Kill-switch отражается
// гейджем канала, skipped — по причинам, delivered/shadow отдельно.
import { describe, expect, it } from "vitest";

const { foldGroups, renderTelegramMetrics } = await import(
  "../../src/services/telegramMetrics.js"
);

describe("foldGroups — свёртка статусов", () => {
  it("пустой список → нули", () => {
    const m = foldGroups([], true);
    expect(m).toEqual({
      channelEnabled: true,
      total: 0,
      pending: 0,
      processing: 0,
      delivered: 0,
      deliveredShadow: 0,
      failed: 0,
      skipped: {},
    });
  });

  it("все статусы считаются, shadow выделяется из delivered", () => {
    const m = foldGroups(
      [
        { status: "pending", error: null, count: 3n },
        { status: "processing", error: null, count: 1n },
        { status: "delivered", error: "shadow", count: 10n },
        { status: "delivered", error: null, count: 2n },
        { status: "failed", error: "max_retries_exceeded", count: 1n },
        { status: "skipped", error: "no_chat", count: 4n },
        { status: "skipped", error: "admin_stopped", count: 2n },
      ],
      true,
    );
    expect(m.total).toBe(23);
    expect(m.pending).toBe(3);
    expect(m.processing).toBe(1);
    expect(m.delivered).toBe(12);
    expect(m.deliveredShadow).toBe(10);
    expect(m.failed).toBe(1);
    expect(m.skipped).toEqual({ no_chat: 4, admin_stopped: 2 });
  });

  it("kill-switch отражается в channelEnabled", () => {
    const m = foldGroups([], false);
    expect(m.channelEnabled).toBe(false);
  });
});

describe("renderTelegramMetrics — Prometheus text", () => {
  it("ключевые серии присутствуют и согласованы с JSON", () => {
    const m = foldGroups(
      [
        { status: "delivered", error: "shadow", count: 7n },
        { status: "skipped", error: "no_chat", count: 3n },
      ],
      true,
    );
    const text = renderTelegramMetrics(m);
    expect(text).toContain("tg_outbox_channel_enabled 1");
    expect(text).toContain("tg_outbox_total 10");
    expect(text).toContain('tg_outbox_status{status="delivered"} 7');
    expect(text).toContain("tg_outbox_delivered_shadow 7");
    expect(text).toContain('tg_outbox_skipped{reason="no_chat"} 3');
  });

  it("без skipped блок причин не рисуется", () => {
    const text = renderTelegramMetrics(foldGroups([], true));
    expect(text).not.toContain("tg_outbox_skipped{");
  });
});
