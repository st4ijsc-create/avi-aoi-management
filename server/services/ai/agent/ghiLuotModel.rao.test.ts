/**
 * ★ Đợt 12 H4.2 (rà kiem-dinh 3f09f77a0) — rào thư mục của bộ ghi: thư mục TÊN bắt đầu ".." nằm TRONG gốc cấm ⇒ từ chối; gốc cấm bản
 * thân là junction ⇒ so bằng đường thật; không đọc được danh sách gốc dự án ⇒ KHÔNG ghi (fail-closed, công cụ đo).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GgufStreamChunk } from "../../aiGgufEngine";

const RUN = "12345678-1234-4234-8234-123456789abc";
const goc = async function* (): AsyncIterable<GgufStreamChunk> {
  yield { type: "done", fullText: "x" };
};
const tam = (t: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), t)));

afterEach(() => {
  vi.doUnmock("../../aiLocalTools/repoProjects");
  vi.resetModules();
});

describe("rào thư mục bộ ghi", () => {
  it("<gốc>/..ghi (tên bắt đầu '..') nằm TRONG gốc ⇒ từ chối; anh em '../ngoai' ⇒ cho", async () => {
    const { thuMucGhiHopLe } = await import("./ghiLuotModel");
    const g = tam("rao-goc-");
    expect(thuMucGhiHopLe(path.join(g, "..ghi"), "Z:/khac", [g])).toBe(false);
    expect(thuMucGhiHopLe(path.join(g, "..", path.basename(g) + "-ngoai"), "Z:/khac", [g])).toBe(true);
  });

  it("gốc cấm BẢN THÂN là junction ⇒ thư mục trong đích thật vẫn bị từ chối", async () => {
    const { thuMucGhiHopLe } = await import("./ghiLuotModel");
    const that = tam("rao-that-");
    const cho = tam("rao-cho-");
    const loiTat = path.join(cho, "goc-la-junction");
    fs.symlinkSync(that, loiTat, process.platform === "win32" ? "junction" : "dir");
    expect(thuMucGhiHopLe(path.join(that, "ghi"), "Z:/khac", [loiTat])).toBe(false);
  });

  it("không đọc được danh sách gốc dự án ⇒ KHÔNG ghi (trả hàm gốc) + cảnh báo", async () => {
    vi.doMock("../../aiLocalTools/repoProjects", () => ({
      danhSachDuAn: () => {
        throw new Error("db sập");
      },
    }));
    vi.resetModules();
    const canh = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { bocGhiLuot } = await import("./ghiLuotModel");
      expect(bocGhiLuot(goc, { thuMuc: path.join(tam("rao-ngoai-"), "ghi"), runId: RUN })).toBe(goc);
      expect(canh.mock.calls.some((c) => String(c[0]).includes("fail-closed"))).toBe(true);
    } finally {
      canh.mockRestore();
    }
  });
});
