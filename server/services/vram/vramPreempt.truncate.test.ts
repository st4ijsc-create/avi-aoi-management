/**
 * ★★★ Pha 4 Task 4 — **M-5 NỬA SAU: "ĐÃ CẮT HAY CHƯA" ĐO Ở NGUỒN, MỘT LẦN.**
 *
 * Bàn giao nguyên văn từ review Task 3: *"`VramPreemptCommandResult` phơi thêm `detailTruncated`
 * (đo Ở ĐÚNG chỗ cắt, nguồn duy nhất của sự thật) … **KHÔNG được tự đoán bằng cách đo
 * `detail.length === 400` ở phía client** — đó là bản sao thứ hai của MỘT vị từ"*.
 *
 * ⚠ Ca **ranh giới 400** ở đây là thứ chứng minh bản sao client sẽ SAI, không chỉ "thừa": một câu
 * dài **đúng 400** ký tự **chưa bị cắt**, nhưng `length === 400` khai là đã cắt.
 *
 * ⚠ Lưới đi theo ĐƯỜNG THOÁT: gọi `vramPreemptCommand()` (mặt lệnh THẬT) → `preemptOwner()` →
 * `thiHanhMotBuoc()` → `catCau()`. Chỉ **người thi hành LÁ** (`stopSidecar`) bị thay.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const sidecar = vi.hoisted(() => ({ stop: null as null | (() => Promise<boolean>) }));
vi.mock("../llamaVisionSidecar", () => ({
  stopSidecar: async () => (sidecar.stop === null ? false : sidecar.stop()),
  isVisionSidecarAvailable: () => false,
  getVisionSidecarConfig: () => null,
}));

/** Ô nhật ký bị bắt lại để kiểm cờ cũng đi vào vết BỀN (`vram_events`), không chỉ vào API. */
const events = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("./vramEventLog", () => ({
  logVramEvent: (e: Record<string, unknown>) => {
    events.rows.push(e);
  },
  flushVramEvents: async () => 0,
  sanitizeVramEvent: (e: unknown) => e,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
  __vramDroppedEventCount: () => 0,
}));

import * as broker from "./vramBroker";
import { vramPreemptCommand } from "./vramCommands";

const MIB = 1024 * 1024;
/** ĐÚNG hằng số cắt ở `vramPreempt.catCau()`. */
const CAT = 400;

beforeEach(() => {
  broker.__resetBrokerForTests();
  sidecar.stop = null;
  events.rows = [];
});

function hoSidecar() {
  const r = broker.reserve(
    {
      owner: "sidecar:vision",
      kind: "external-process",
      estimatedBytes: 7_825 * MIB,
      priority: "interactive",
      reclaimer: "vision-sidecar",
    },
    { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
  );
  if (r.lease === null) throw new Error("phải cấp được");
  broker.setLeaseRefCount(r.lease.id, 0);
  return r.lease;
}

describe("M-5 nửa sau — `detailTruncated` đo TẠI CHỖ CẮT", () => {
  it("★★★ câu DÀI HƠN 400 ⇒ `detail` đúng 400 ký tự VÀ `detailTruncated: true`", async () => {
    hoSidecar();
    const cauDai = "X".repeat(CAT + 137);
    sidecar.stop = async () => {
      throw new Error(cauDai);
    };

    const r = await vramPreemptCommand("sidecar:vision");

    expect(r.outcome).toBe("failed");
    expect(r.reason).toBe("reclaimer-threw");
    expect(r.detail).toHaveLength(CAT);
    expect(r.detailTruncated).toBe(true);
  });

  it("★★★ RANH GIỚI: câu dài ĐÚNG 400 ⇒ CHƯA cắt ⇒ `false` (đây là chỗ bản sao `length === 400` SAI)", async () => {
    hoSidecar();
    sidecar.stop = async () => {
      throw new Error("Y".repeat(CAT));
    };

    const r = await vramPreemptCommand("sidecar:vision");

    expect(r.detail).toHaveLength(CAT);
    // Một phép so `detail.length === 400` ở client sẽ khai `true` ở ĐÚNG dòng này.
    expect(r.detailTruncated, "chưa mất một ký tự nào ⇒ KHÔNG được khai là đã cắt").toBe(false);
  });

  it("câu ngắn ⇒ `false`; và cờ đi vào CẢ vết bền `vram_events`, không chỉ API", async () => {
    hoSidecar();
    sidecar.stop = async () => {
      throw new Error("cong 8081 khong phan hoi");
    };

    const r = await vramPreemptCommand("sidecar:vision");
    expect(r.detailTruncated).toBe(false);

    const nem = events.rows.find(
      (e) => (e.detail as Record<string, unknown> | undefined)?.reason === "reclaimer-threw",
    );
    expect(nem, "lượt NÉM phải để lại một dòng nhật ký").toBeTruthy();
    expect((nem!.detail as Record<string, unknown>).messageTruncated).toBe(false);
  });

  it("người thi hành trả `false` (KHÔNG ném) ⇒ `detail: null` + `detailTruncated: false` — không bịa một lời khai", async () => {
    hoSidecar();
    sidecar.stop = async () => false;

    const r = await vramPreemptCommand("sidecar:vision");
    expect(r.reason).toBe("reclaimer-returned-false");
    expect(r.detail).toBeNull();
    expect(r.detailTruncated).toBe(false);
  });

  it("lượt bị TỪ CHỐI ở cổng quyền/khả năng ⇒ `detailTruncated: false` (chưa có câu nào để cắt)", async () => {
    const r = await vramPreemptCommand("khong-co-ho-nao-ten-nay");
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("owner-not-in-local-ledger");
    expect(r.detail).toBeNull();
    expect(r.detailTruncated).toBe(false);
  });
});
