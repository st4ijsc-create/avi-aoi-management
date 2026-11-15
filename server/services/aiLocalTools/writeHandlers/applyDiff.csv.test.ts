/**
 * B1 `.csv` ở CỬA GHI: `phanQuyetChinhSachDuong(duong, goc?)` — chỉ `apply_diff.phanQuyet` (và đọc-trước-khi-ghi) truyền gốc dự án; `delete_file` / `rename_file` (xoaDoiTenTep)
 * gọi KHÔNG truyền gốc ⇒ `.csv` vẫn bị từ chối ở đó. THUẦN: thư mục tạm thật, không CSDL / git.
 * ĐỘT BIẾN PHẢI BẮT: mặc định BẬT · ghi khi gốc là gốc repo · ghi `.csv` ngoài sandbox-projects · xoá/đổi tên cũng mở · cờ khác `1` bật.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { phanQuyet, phanQuyetChinhSachDuong } from "./applyDiff";

let goc: string;
let sb: string;
let duAn: string;
beforeEach(() => {
  goc = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csv-wr-")));
  sb = path.join(goc, "sandbox-projects");
  duAn = path.join(sb, "agent-f");
  fs.mkdirSync(path.join(duAn, "tests"), { recursive: true });
  fs.mkdirSync(path.join(goc, "docs"), { recursive: true });
  vi.stubEnv("AI_AGENT_CSV_DOC", "1");
  vi.spyOn(process, "cwd").mockReturnValue(goc); // gốc sandbox-projects mặc định = <cwd>/sandbox-projects
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(goc, { recursive: true, force: true });
});

describe("phanQuyetChinhSachDuong — `.csv` chỉ khi có gốc dự án dưới sandbox-projects", () => {
  it("★★★ có gốc dự án (dưới sandbox-projects) + cờ bật ⇒ ok, kể cả tệp / thư mục chưa có", () => {
    expect(phanQuyetChinhSachDuong("tests/data/moi.csv", duAn)).toEqual({ ok: true });
    expect(phanQuyetChinhSachDuong("moi.csv", duAn)).toEqual({ ok: true });
  });
  it("★★★ KHÔNG truyền gốc (delete_file / rename_file / mọi điểm gọi cũ) ⇒ DENIED_EXT như cũ", () => {
    expect(phanQuyetChinhSachDuong("tests/data/moi.csv")).toEqual({ ok: false, ma: "DENIED_EXT", chiTiet: ".csv" });
  });
  it("★★★ gốc là GỐC REPO (không phải dự án) ⇒ từ chối, kể cả đường đi vào sandbox-projects", () => {
    expect(phanQuyetChinhSachDuong("sandbox-projects/agent-f/moi.csv", goc)).toEqual({ ok: false, ma: "DENIED_EXT", chiTiet: ".csv" });
    expect(phanQuyetChinhSachDuong("docs/x.csv", goc)).toEqual({ ok: false, ma: "DENIED_EXT", chiTiet: ".csv" });
  });
  it("★★★ gốc ngoài sandbox-projects (docs/) ⇒ từ chối", () => {
    expect(phanQuyetChinhSachDuong("x.csv", path.join(goc, "docs"))).toEqual({ ok: false, ma: "DENIED_EXT", chiTiet: ".csv" });
  });
  it("★★★ cờ TẮT (vắng / 0 / true / rỗng) ⇒ từ chối dù có gốc dự án", () => {
    for (const v of [undefined, "0", "true", ""]) {
      vi.unstubAllEnvs();
      if (v !== undefined) vi.stubEnv("AI_AGENT_CSV_DOC", v);
      else delete process.env.AI_AGENT_CSV_DOC;
      expect(phanQuyetChinhSachDuong("moi.csv", duAn), String(v)).toEqual({ ok: false, ma: "DENIED_EXT", chiTiet: ".csv" });
    }
  });
  it("★★★ không đụng các đuôi khác: `.exe` vẫn DENIED_EXT dù có gốc; `.ts` vẫn ok; `.env.csv` vẫn bị chính sách cấm", () => {
    expect(phanQuyetChinhSachDuong("a.exe", duAn)).toEqual({ ok: false, ma: "DENIED_EXT", chiTiet: ".exe" });
    expect(phanQuyetChinhSachDuong("a.ts", duAn)).toEqual({ ok: true });
    const r = phanQuyetChinhSachDuong(".env.csv", duAn);
    expect(r.ok).toBe(false);
  });
  it("★★★ `..` thoát ra ngoài vẫn bị từ chối ở chính sách đường (PATH_REJECTED), trước cả `.csv`", () => {
    const r = phanQuyetChinhSachDuong("../../docs/x.csv", duAn);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe("PATH_REJECTED");
  });
});

describe("apply_diff.phanQuyet (cửa thật) truyền gốc dự án vào chính sách đường", () => {
  it("★★★ tạo `.csv` MỚI trong dự án ⇒ không còn DENIED_EXT (đi tiếp qua các hàng rào sau); cờ tắt / gốc repo ⇒ DENIED_EXT", async () => {
    const p = { path: "tests/data/moi.csv", original: "", modified: ["a,b", "1,2", ""].join("\n") };
    const ok = await phanQuyet(p, duAn);
    expect(ok.ok === false ? ok.ma : "OK").not.toBe("DENIED_EXT");
    const goc_ = await phanQuyet({ ...p, path: "sandbox-projects/agent-f/tests/data/moi.csv" }, goc);
    expect(goc_).toMatchObject({ ok: false, ma: "DENIED_EXT" });
    vi.stubEnv("AI_AGENT_CSV_DOC", "0");
    expect(await phanQuyet(p, duAn)).toMatchObject({ ok: false, ma: "DENIED_EXT" });
  });
});
