/**
 * ★ Đợt 9 — KHOÁ KHE (dieu-phoi duyệt 2026-10-21): phép đo/đổi model ngoài app giữ tệp LLAMA_WATCHDOG_PAUSE_FILE mang
 * `{chu, lyDo, hetHan}`; bộ lập lịch khe nặng của app gặp khoá còn hạn ⇒ KHÔNG đổi khe (sự cố 14:00: :3000 đổi khe giết 27B
 * giữa lượt đo).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __xoaBoNhoKhoaKhe, docKhoaKhe, KHOA_HONG_MS } from "./khoaKhe";

let tep: string;
beforeEach(() => {
  tep = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "khoa-khe-")), "llama-watchdog.pause");
  __xoaBoNhoKhoaKhe();
});
afterEach(() => vi.restoreAllMocks());

describe("docKhoaKhe", () => {
  it("không có tệp ⇒ null", () => {
    expect(docKhoaKhe(tep, Date.now())).toBeNull();
  });

  it("JSON còn hạn ⇒ khoá {chu, lyDo, hetHan}; hết hạn ⇒ null", () => {
    const bayGio = Date.parse("2026-10-21T08:00:00Z");
    fs.writeFileSync(tep, JSON.stringify({ chu: "mot-luot PLC-x", lyDo: "đo plc-st-v1", hetHan: "2026-10-21T08:05:00Z" }));
    expect(docKhoaKhe(tep, bayGio)).toEqual({ chu: "mot-luot PLC-x", lyDo: "đo plc-st-v1", hetHan: Date.parse("2026-10-21T08:05:00Z"), hong: false });
    __xoaBoNhoKhoaKhe();
    expect(docKhoaKhe(tep, Date.parse("2026-10-21T08:05:01Z"))).toBeNull();
  });

  it("tệp HỎNG (không phải JSON khoá, vd định dạng cũ của doi-model) ⇒ khoá NGẮN tính từ mtime (fail-safe về phía không giết) + log", () => {
    const err = vi.spyOn(console, "warn").mockImplementation(() => {});
    fs.writeFileSync(tep, "doi-model.ps1 PID 123 2026-10-21T08:00:00 Qwen.gguf");
    const mtime = fs.statSync(tep).mtimeMs;
    const k = docKhoaKhe(tep, mtime + 1_000);
    expect(k?.hong).toBe(true);
    expect(k?.hetHan).toBe(mtime + KHOA_HONG_MS);
    expect(err).toHaveBeenCalled();
    __xoaBoNhoKhoaKhe();
    expect(docKhoaKhe(tep, mtime + KHOA_HONG_MS + 1)).toBeNull();
  });
});
