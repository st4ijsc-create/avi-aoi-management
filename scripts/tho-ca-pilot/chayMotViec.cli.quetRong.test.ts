/**
 * ĐƯỜNG DÒNG LỆNH THẬT cho HA-6d: gọi `main(argv)` (cùng `docThamSo` + dựng ThamSoViec như khi chạy `tsx chayMotViec.ts …`) với `--cho-phep-db --tep-url-csdl <tệp>` và `--quet-rong` / `--quet-rong-cham`,
 * rồi đọc JSON ở stdout. Bộ quét / bộ đếm bị thay bằng bản giả (`vi.mock("./mayDemPg")`) — KHÔNG chạm CSDL, KHÔNG mở kết nối.
 * Lý do tồn tại: các ca `chayMotViec(...)` tiêm tham số trực tiếp nên KHÔNG bắt được lỗi bỏ truyền cờ ở `main()`.
 * ĐỘT BIẾN PHẢI BẮT: main không truyền quetRong / quetRongCham · -cham không hàm ý quét · URL không tới bộ quét.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gia = vi.hoisted(() => ({ lan: 0, url: [] as string[], quet: [{ a: 1, b: 5 }, { a: 1, b: 9 }] as Array<Record<string, number>> }));
vi.mock("./mayDemPg", async (importOriginal) => {
  const goc = await importOriginal<typeof import("./mayDemPg")>();
  return {
    ...goc,
    moMayDemTuUrl: async () => ({ may: { kiemDinhDanh: async () => null, dem: async () => 0 }, dong: async () => undefined }),
    moMayQuetTuUrl: async (url: string) => {
      const kq = gia.quet[Math.min(gia.lan++, gia.quet.length - 1)]!;
      gia.url.push(url);
      return { may: { lietKe: async () => Object.keys(kq), dem: async (b: string) => kq[b] ?? null }, dong: async () => undefined };
    },
  };
});
import { main } from "./chayMotViec";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const MAT_KHAU = "MatKhauCLIQuet4321";
const URL_TEST = `postgresql://tho_ca_test:${MAT_KHAU}@127.0.0.1:5434/aoi_management_test`;
const THE = `MÃ: TC-91
MỤC TIÊU: thử cờ quét rộng qua dòng lệnh
TỆP ĐƯỢC PHÉP SỬA/TẠO: docs/ghi-chu.md
CSDL: chạm aoi_management_test (CHỈ CSDL _test)
LỆNH KIỂM: node -v
GIỚI HẠN: 1 phút, 3 vòng`;

let goc: string;
let wt: string;
let ra: string;
let baseSha: string;
let tepThe: string;
let tepUrl: string;
beforeEach(() => {
  gia.lan = 0;
  gia.url = [];
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tccq-"));
  const kho = path.join(goc, "kho-chinh");
  wt = path.join(goc, "_tho_ca_wt_cq");
  ra = path.join(goc, "ra");
  fs.mkdirSync(path.join(kho, "docs"), { recursive: true });
  git(kho, "init", "-q");
  git(kho, "config", "user.email", "t@t");
  git(kho, "config", "user.name", "t");
  git(kho, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(kho, "docs/ghi-chu.md"), "cu\n");
  git(kho, "add", ".");
  git(kho, "commit", "-q", "-m", "init");
  baseSha = git(kho, "rev-parse", "HEAD");
  git(kho, "worktree", "add", "-q", "--detach", wt, "HEAD");
  tepThe = path.join(goc, "the.txt");
  fs.writeFileSync(tepThe, THE);
  tepUrl = path.join(goc, "url.txt");
  fs.writeFileSync(tepUrl, URL_TEST);
});
afterEach(() => {
  fs.rmSync(goc, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function chayCli(them: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((s: string | Uint8Array) => (out.push(String(s)), true)) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string | Uint8Array) => (err.push(String(s)), true)) as never);
  let ma: number;
  try {
    ma = await main(["--the", tepThe, "--wt", wt, "--base", baseSha, "--driver", "kho", "--ra", ra, "--kho-ghi", JSON.stringify({ "docs/ghi-chu.md": "moi\n" }), ...them]);
  } finally {
    vi.restoreAllMocks();
  }
  const dong = out.join("").split("\n").filter((x) => x.trim().startsWith("{")).pop();
  return { ma, json: dong ? (JSON.parse(dong) as Record<string, any>) : null, err: err.join(""), out: out.join("") };
}
const CO_DB = () => ["--cho-phep-db", "--tep-url-csdl", tepUrl];

describe("main() — cờ quét rộng (HA-6d)", () => {
  it("★★★ KHÔNG cờ quét ⇒ JSON không có quetRong; bộ quét không được mở lần nào", async () => {
    const r = await chayCli(CO_DB());
    expect(r.json, r.err).not.toBeNull();
    expect(r.json!.ketCuc).toBe("xong");
    expect("quetRong" in r.json!).toBe(false);
    expect(gia.lan).toBe(0);
  });
  it("★★★ --quet-rong ⇒ main truyền cờ: JSON có quetRong (ok, 2 lần quét, đúng URL), bảng ngoài thẻ đổi được ghi nhưng ketCuc VẪN xong; canhBaoQuet đứng ngay sau ketCuc", async () => {
    const r = await chayCli([...CO_DB(), "--quet-rong"]);
    expect(r.json, r.err).not.toBeNull();
    expect(r.json!.ketCuc).toBe("xong");
    expect(r.json!.quetRong).toMatchObject({ ok: true, ngoaiThe: ["b"], tongChenh: 4 });
    expect("cham" in r.json!.quetRong).toBe(false);
    expect(gia.lan).toBe(2);
    expect(gia.url).toEqual([URL_TEST, URL_TEST]);
    const khoa = Object.keys(r.json!);
    expect(khoa[khoa.indexOf("ketCuc") + 1]).toBe("canhBaoQuet");
    expect(r.err).toContain("CẢNH BÁO HA-6d");
    expect(r.out + r.err).not.toContain(MAT_KHAU);
  });
  it("★★★ --quet-rong-cham (KHÔNG kèm --quet-rong) ⇒ main truyền cờ, hàm ý quét: bảng ngoài thẻ đổi ⇒ ketCuc hau-qua-xau, mã thoát 1, quetRong.cham=true", async () => {
    const r = await chayCli([...CO_DB(), "--quet-rong-cham"]);
    expect(r.json, r.err).not.toBeNull();
    expect(r.json!.ketCuc).toBe("hau-qua-xau");
    expect(r.json!.ok).toBe(false);
    expect(r.ma).toBe(1);
    expect(r.json!.quetRong).toMatchObject({ ok: true, cham: true, ngoaiThe: ["b"] });
    expect(gia.lan).toBe(2);
    expect(r.out + r.err).not.toContain(MAT_KHAU);
  });
  it("★★★ --quet-rong-cham mà bảng không đổi ⇒ ketCuc xong, mã thoát 0", async () => {
    gia.quet = [{ a: 1, b: 5 }, { a: 1, b: 5 }];
    const r = await chayCli([...CO_DB(), "--quet-rong-cham"]);
    expect(r.json!.ketCuc).toBe("xong");
    expect(r.ma).toBe(0);
    expect(r.json!.quetRong).toMatchObject({ ok: true, cham: true, doi: [], ngoaiThe: [] });
    gia.quet = [{ a: 1, b: 5 }, { a: 1, b: 9 }];
  });
  it("★★★ cờ quét mà thiếu --cho-phep-db ⇒ mã 2, thông báo nêu cờ, chưa mở bộ quét", async () => {
    const a = await chayCli(["--quet-rong"]);
    expect(a.ma).toBe(2);
    expect(a.err).toContain("--quet-rong cần --cho-phep-db");
    const b = await chayCli(["--quet-rong-cham"]);
    expect(b.ma).toBe(2);
    expect(b.err).toContain("--quet-rong-cham cần --cho-phep-db");
    expect(gia.lan).toBe(0);
  });
});

describe("main() — dòng tổng kết cuối nhật ký (HA-6d F)", () => {
  const dongCuoi = (err: string) => err.trim().split("\n").pop()!;
  it("★★★ có cảnh báo quét ⇒ DÒNG CUỐI của stderr là dòng tổng kết có 'CẢNH BÁO QUÉT' và tên bảng; không cờ quét ⇒ dòng cuối là dòng tổng kết ngắn", async () => {
    const co = await chayCli([...CO_DB(), "--quet-rong"]);
    expect(dongCuoi(co.err)).toBe(`[tho-ca-pilot] TỔNG KẾT TC-91: ketCuc=xong ok=true | CẢNH BÁO QUÉT: ${co.json!.canhBaoQuet[0]}`);
    expect(dongCuoi(co.err)).toContain("b 5→9 (+4)");
    gia.lan = 0;
    const khong = await chayCli(CO_DB());
    expect(dongCuoi(khong.err)).toBe("[tho-ca-pilot] TỔNG KẾT TC-91: ketCuc=xong ok=true");
  });
});
