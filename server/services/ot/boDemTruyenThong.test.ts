/**
 * SCADA R0 Task 6 (C8) — bộ đếm truyền thông theo adapter/tag.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { __datLaiBoDem, ghiNhanDoc, ghiNhanLenh, ghiNhanPhien, layBoDem } from "./boDemTruyenThong";
import { tinhDeadlineMs } from "./reconnectNhanh";
import type { SuKienDoc } from "./otDriver";

const T0 = Date.UTC(2026, 9, 23, 10, 0, 30);
const okTick = (ms: number): SuKienDoc => ({
  ok: true,
  timeout: false,
  ms,
  tags: [
    { tagKey: "t1", quality: "good" },
    { tagKey: "t2", quality: ms % 20 === 0 ? "uncertain" : "good" },
  ],
});

beforeEach(() => __datLaiBoDem());

describe("boDemTruyenThong — đếm đọc", () => {
  it("10 tick ok + 2 lỗi (1 timeout) ⇒ request 12, loi 2, timeout 1, p50/p95 từ tick ok", () => {
    for (let i = 1; i <= 10; i++) ghiNhanDoc(1, okTick(i * 10), T0 + i);
    ghiNhanDoc(1, { ok: false, timeout: true, ms: 6000, tags: [] }, T0 + 20);
    ghiNhanDoc(1, { ok: false, timeout: false, ms: 5, tags: [] }, T0 + 21);
    const b = layBoDem(1, undefined, T0 + 100);
    expect(b.request).toBe(12);
    expect(b.loi).toBe(2);
    expect(b.timeout).toBe(1);
    expect(b.p50Ms).toBeGreaterThanOrEqual(50);
    expect(b.p50Ms).toBeLessThanOrEqual(60);
    expect(b.p95Ms).toBeGreaterThanOrEqual(90);
    expect(b.theoTag.t1.good).toBe(10);
    expect(b.theoTag.t1.request).toBe(10);
    expect(b.theoTag.t2.uncertain).toBe(5);
    expect(b.theoTag.t2.good).toBe(5);
  });

  it("adapter chưa có số liệu ⇒ toàn 0, p50/p95 null", () => {
    const b = layBoDem(99, undefined, T0);
    expect(b).toMatchObject({ phien: 0, phienLoi: 0, request: 0, loi: 0, timeout: 0, lenh: 0, lenhLoi: 0, p50Ms: null, p95Ms: null });
    expect(b.theoTag).toEqual({});
  });

  it("tag mẫu bad ⇒ đếm bad và loi của tag", () => {
    ghiNhanDoc(1, { ok: true, timeout: false, ms: 5, tags: [{ tagKey: "x", quality: "bad" }] }, T0);
    const b = layBoDem(1, undefined, T0);
    expect(b.theoTag.x).toMatchObject({ request: 1, bad: 1, loi: 1, good: 0 });
  });

  it("hai adapter không lẫn số liệu", () => {
    ghiNhanDoc(1, okTick(10), T0);
    expect(layBoDem(2, undefined, T0).request).toBe(0);
  });
});

describe("boDemTruyenThong — phiên và lệnh", () => {
  it("ghiNhanPhien đếm phien/phienLoi", () => {
    ghiNhanPhien(1, true, T0);
    ghiNhanPhien(1, false, T0);
    ghiNhanPhien(1, false, T0);
    const b = layBoDem(1, undefined, T0);
    expect(b.phien).toBe(3);
    expect(b.phienLoi).toBe(2);
  });

  it("ghiNhanLenh đếm lenh/lenhLoi cấp adapter và theo tag", () => {
    ghiNhanLenh(1, "w1", true, T0);
    ghiNhanLenh(1, "w1", false, T0);
    ghiNhanLenh(1, "w2", true, T0);
    const b = layBoDem(1, undefined, T0);
    expect(b.lenh).toBe(3);
    expect(b.lenhLoi).toBe(1);
    expect(b.theoTag.w1).toMatchObject({ lenh: 2, lenhLoi: 1 });
    expect(b.theoTag.w2).toMatchObject({ lenh: 1, lenhLoi: 0 });
  });
});

describe("boDemTruyenThong — cửa sổ thời gian", () => {
  it("sự kiện 61 phút trước bị loại khỏi cửa sổ 1 h, sự kiện 30 phút trước còn", () => {
    ghiNhanDoc(1, okTick(10), T0 - 61 * 60_000);
    ghiNhanDoc(1, okTick(10), T0 - 30 * 60_000);
    ghiNhanPhien(1, false, T0 - 61 * 60_000);
    ghiNhanLenh(1, "w", true, T0 - 61 * 60_000);
    const b = layBoDem(1, undefined, T0);
    expect(b.request).toBe(1);
    expect(b.phien).toBe(0);
    expect(b.lenh).toBe(0);
    expect(b.theoTag.t1.request).toBe(1);
    expect(b.theoTag.w).toBeUndefined();
  });

  it("p50/p95 chỉ tính mẫu trong cửa sổ", () => {
    ghiNhanDoc(1, okTick(9000), T0 - 61 * 60_000);
    ghiNhanDoc(1, okTick(10), T0);
    const b = layBoDem(1, undefined, T0);
    expect(b.p95Ms).toBe(10);
  });

  it("giữ tối đa 60 thùng: ghi trải 100 phút rồi hỏi cửa sổ 24 h chỉ thấy 60 phút gần nhất", () => {
    for (let m = 99; m >= 0; m--) ghiNhanDoc(1, okTick(10), T0 - m * 60_000);
    const b = layBoDem(1, 24 * 3_600_000, T0);
    expect(b.request).toBe(60);
  });

  it("p50/p95 từ tối đa 600 mẫu gần nhất", () => {
    for (let i = 0; i < 700; i++) ghiNhanDoc(1, okTick(i < 100 ? 5000 : 10), T0 + i);
    const b = layBoDem(1, undefined, T0 + 700);
    // 100 mẫu chậm đầu tiên đã bị đẩy ra khỏi vòng 600 mẫu
    expect(b.p95Ms).toBe(10);
    expect(b.request).toBe(700);
  });
});

describe("tinhDeadlineMs — hạn một lần đọc của otManager (phán quyết điều phối)", () => {
  it("max(2×poll, timeout+1000)", () => {
    expect(tinhDeadlineMs(1000, 800)).toBe(2000);
    expect(tinhDeadlineMs(500, undefined)).toBe(6000);
    expect(tinhDeadlineMs(5000, 5000)).toBe(10000);
    expect(tinhDeadlineMs(1000, 10000)).toBe(11000);
  });
});
