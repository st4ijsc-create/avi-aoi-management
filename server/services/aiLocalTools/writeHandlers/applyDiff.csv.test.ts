/**
 * B1 `.csv` — GHI CHƯA ĐƯỢC DUYỆT (chủ dự án 14/11 chỉ duyệt ĐỌC). Mọi cửa GHI `.csv` vẫn bị từ chối `DENIED_EXT` kể cả khi cờ AI_AGENT_CSV_DOC=1 và đích nằm trong chính dự án
 * dưới sandbox-projects. THUẦN: thư mục tạm thật, không CSDL / git.
 * ĐỘT BIẾN PHẢI BẮT: applyDiff.ts nhập csvTrongDuAn / gọi csvDuocPhep · phanQuyetChinhSachDuong nhận gốc để mở `.csv` · phanQuyet mở `.csv` mới.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { phanQuyet, phanQuyetChinhSachDuong } from "./applyDiff";

let goc: string;
let duAn: string;
const NOI_DUNG = ["a,b", "1,2", ""].join("\n");
beforeEach(() => {
  goc = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csv-wr-")));
  duAn = path.join(goc, "sandbox-projects", "agent-f");
  fs.mkdirSync(path.join(duAn, "tests"), { recursive: true });
  fs.writeFileSync(path.join(duAn, "tests", "co.csv"), NOI_DUNG);
  vi.stubEnv("AI_AGENT_CSV_DOC", "1");
  vi.spyOn(process, "cwd").mockReturnValue(goc);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(goc, { recursive: true, force: true });
});

describe("GHI `.csv` vẫn DENIED_EXT dù cờ đọc BẬT", () => {
  it("★★★ phanQuyetChinhSachDuong: `.csv` mới / đã có, trong dự án ⇒ DENIED_EXT chi tiết `.csv`", () => {
    for (const d of ["tests/co.csv", "tests/moi.csv", "moi.csv", "tests/data/moi.csv"]) {
      expect(phanQuyetChinhSachDuong(d), d).toEqual({ ok: false, ma: "DENIED_EXT", chiTiet: ".csv" });
    }
  });
  it("★★★ phanQuyet (cửa apply_diff thật): tạo `.csv` mới hoặc sửa `.csv` có sẵn trong dự án ⇒ DENIED_EXT", async () => {
    expect(await phanQuyet({ path: "tests/moi.csv", original: "", modified: NOI_DUNG }, duAn)).toMatchObject({ ok: false, ma: "DENIED_EXT" });
    expect(await phanQuyet({ path: "tests/co.csv", original: NOI_DUNG, modified: ["x,y", ""].join("\n") }, duAn)).toMatchObject({ ok: false, ma: "DENIED_EXT" });
    expect(await phanQuyet({ path: "sandbox-projects/agent-f/tests/moi.csv", original: "", modified: NOI_DUNG }, goc)).toMatchObject({ ok: false, ma: "DENIED_EXT" });
  });
  it("★★★ cờ vắng / 0 cũng vậy (không đổi gì so với main)", () => {
    for (const v of [undefined, "0"]) {
      vi.unstubAllEnvs();
      if (v !== undefined) vi.stubEnv("AI_AGENT_CSV_DOC", v);
      else delete process.env.AI_AGENT_CSV_DOC;
      expect(phanQuyetChinhSachDuong("tests/moi.csv")).toEqual({ ok: false, ma: "DENIED_EXT", chiTiet: ".csv" });
    }
  });
  it("★★ đuôi khác không bị ảnh hưởng: `.py` / `.ts` vẫn ok, `.exe` vẫn DENIED_EXT", () => {
    expect(phanQuyetChinhSachDuong("a.py")).toEqual({ ok: true });
    expect(phanQuyetChinhSachDuong("a.ts")).toEqual({ ok: true });
    expect(phanQuyetChinhSachDuong("a.exe")).toEqual({ ok: false, ma: "DENIED_EXT", chiTiet: ".exe" });
  });
});
