/**
 * ★★★ Đợt 3c — DỊCH VỤ "Chạy & Xem trước" (tầng chính sách của tRPC `aiChayUngDung`): RBAC `ai_repo_exec/canCreate`
 * để CHẠY · chủ sở hữu để DỪNG/xem NHẬT KÝ · lệnh chạy CHỈ từ khai báo dự án · repo chính KHÔNG chạy được.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { QuanLyUngDung, type TienTrinhUngDung } from "./quanLyUngDung";
import { chayUngDungChoNguoi, dungUngDungChoNguoi, nhatKyChoNguoi, trangThaiChoNguoi, type PhuThuocDichVu } from "./dichVu";

let goc = "";
let gocRepo = "";
let quyen: Set<string>;
let ql: QuanLyUngDung;
let sinh: Array<{ file: string; args: string[] }>;

function deps(): PhuThuocDichVu {
  return {
    coQuyen: async (_u, _r, mod, act) => quyen.has(`${mod}/${act}`),
    // Mô phỏng repoProjects: "rieng-8" là dự án CÁ NHÂN của người 8 — người khác (không admin) ⇒ PROJECT_NOT_FOUND.
    phanGiaiGoc: (id, ng) =>
      id === "demo"
        ? { ok: true, id, goc }
        : id === "repo"
          ? { ok: true, id, goc: gocRepo }
          : id === "rieng-8" && (ng?.id === 8 || ng?.role === "admin")
            ? { ok: true, id, goc }
            : { ok: false, ma: "PROJECT_NOT_FOUND" },
    gocRepoChinh: () => gocRepo,
    ql: () => ql,
    cauHinhXemTruoc: () => ({ bat: true, lyDoTat: null }),
    diaChiUngDung: () => ({ ok: true, diaChi: "127.0.0.2" }),
  };
}

beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-dv-"));
  gocRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-repo-"));
  fs.writeFileSync(path.join(goc, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
  fs.writeFileSync(path.join(gocRepo, "package.json"), JSON.stringify({ scripts: { dev: "tsx server" } }));
  quyen = new Set(["ai_repo_read/canView", "ai_repo_exec/canCreate"]);
  sinh = [];
  ql = new QuanLyUngDung({ tu: 5100, den: 5109 }, {
    sinh: (l) => {
      sinh.push({ file: l.file, args: l.args });
      const p = new EventEmitter() as unknown as TienTrinhUngDung & EventEmitter;
      (p as any).pid = 4242;
      (p as any).stdout = new EventEmitter();
      (p as any).stderr = new EventEmitter();
      return p;
    },
    giet: () => "da-ra-lenh",
    bayGio: () => 1,
    congTrong: async () => true,
    thuKetNoi: async () => false,
    ngheSaiDiaChi: async () => false,
    ghiAudit: () => {},
    anHanGietMs: 10,
  });
});
afterEach(() => {
  fs.rmSync(goc, { recursive: true, force: true });
  fs.rmSync(gocRepo, { recursive: true, force: true });
});

const U7 = { id: 7, role: "engineer" };
const U8 = { id: 8, role: "engineer" };

describe("§1 — CHẠY: quyền + khai báo dự án", () => {
  it("★★★ thiếu ai_repo_exec/canCreate ⇒ PERMISSION_DENIED, KHÔNG sinh tiến trình", async () => {
    quyen.delete("ai_repo_exec/canCreate");
    const r = await chayUngDungChoNguoi({ user: U7, projectId: "demo" }, deps());
    expect(!r.ok && r.ma).toBe("PERMISSION_DENIED");
    expect(sinh.length).toBe(0);
  });

  it("★★★ có quyền ⇒ chạy `npm run dev` suy từ package.json, cổng trong dải", async () => {
    const r = await chayUngDungChoNguoi({ user: U7, projectId: "demo" }, deps());
    expect(r.ok).toBe(true);
    expect(sinh[0]!.args.slice(-2)).toEqual(["run", "dev"]);
    expect(r.ok && r.muc.cong).toBe(5100);
  });

  it("★★★ REPO CHÍNH (gốc = repo nền tảng) KHÔNG chạy được — 'dev' của nó là chính máy chủ này", async () => {
    const r = await chayUngDungChoNguoi({ user: U7, projectId: "repo" }, deps());
    expect(!r.ok && r.ma).toBe("REPO_CHINH_KHONG_CHAY");
    expect(sinh.length).toBe(0);
  });

  it("★★ dự án lạ ⇒ PROJECT_NOT_FOUND; dự án không có lệnh chạy ⇒ CHUA_KHAI_LENH_CHAY", async () => {
    expect(await chayUngDungChoNguoi({ user: U7, projectId: "khac" }, deps())).toMatchObject({ ok: false, ma: "PROJECT_NOT_FOUND" });
    fs.writeFileSync(path.join(goc, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
    expect(await chayUngDungChoNguoi({ user: U7, projectId: "demo" }, deps())).toMatchObject({ ok: false, ma: "CHUA_KHAI_LENH_CHAY" });
  });

  it("★★★ `.ai-chay.json` trỏ python NGOÀI gốc / không tồn tại ⇒ TEP_CHAY_KHONG_HOP_LE (không có chuỗi lệnh tự do)", async () => {
    fs.writeFileSync(path.join(goc, ".ai-chay.json"), JSON.stringify({ chay: { loai: "python", tep: "../ngoai.py" } }));
    expect(await chayUngDungChoNguoi({ user: U7, projectId: "demo" }, deps())).toMatchObject({ ok: false, ma: "TEP_CHAY_KHONG_HOP_LE" });
    fs.writeFileSync(path.join(goc, ".ai-chay.json"), JSON.stringify({ chay: { loai: "shell", lenh: "rm -rf /" } }));
    expect(await chayUngDungChoNguoi({ user: U7, projectId: "demo" }, deps())).toMatchObject({ ok: false, ma: "CAU_HINH_CHAY_SAI" });
    expect(sinh.length).toBe(0);
  });

  it("★★★ dự án CÁ NHÂN của người khác ⇒ PROJECT_NOT_FOUND (cửa phân giải gốc nhận DANH TÍNH người gọi)", async () => {
    expect(await chayUngDungChoNguoi({ user: U7, projectId: "rieng-8" }, deps())).toMatchObject({ ok: false, ma: "PROJECT_NOT_FOUND" });
    expect(sinh.length).toBe(0);
    expect((await chayUngDungChoNguoi({ user: U8, projectId: "rieng-8" }, deps())).ok).toBe(true);
  });

  it("★★ `.ai-chay.json` python hợp lệ ⇒ chạy đúng tệp khai", async () => {
    fs.writeFileSync(path.join(goc, "app.py"), "print(1)\n");
    fs.writeFileSync(path.join(goc, ".ai-chay.json"), JSON.stringify({ chay: { loai: "python", tep: "app.py" } }));
    const r = await chayUngDungChoNguoi({ user: U7, projectId: "demo" }, deps());
    expect(r.ok).toBe(true);
    expect(sinh[0]!.args).toEqual(["app.py"]);
  });
});

describe("§2 — DỪNG / NHẬT KÝ: chỉ chủ (hoặc admin)", () => {
  it("★★★ người KHÁC dừng ⇒ NOT_FOUND (không tiết lộ), tiến trình vẫn chạy; chủ dừng được", async () => {
    await chayUngDungChoNguoi({ user: U7, projectId: "demo" }, deps());
    expect(await dungUngDungChoNguoi({ user: U8, projectId: "demo" }, deps())).toMatchObject({ ok: false, ma: "NOT_FOUND" });
    expect(ql.trangThai("demo")?.cong).toBe(5100);
    expect((await dungUngDungChoNguoi({ user: U7, projectId: "demo" }, deps())).ok).toBe(true);
  });

  it("★★ nhật ký của người khác ⇒ NOT_FOUND; admin xem được", async () => {
    await chayUngDungChoNguoi({ user: U7, projectId: "demo" }, deps());
    expect(await nhatKyChoNguoi({ user: U8, projectId: "demo" }, deps())).toMatchObject({ ok: false, ma: "NOT_FOUND" });
    expect((await nhatKyChoNguoi({ user: { id: 1, role: "admin" }, projectId: "demo" }, deps())).ok).toBe(true);
  });

  it("★★ trạng thái cho người KHÔNG phải chủ: chỉ biết 'đang bận', không cổng/lệnh/nhật ký", async () => {
    await chayUngDungChoNguoi({ user: U7, projectId: "demo" }, deps());
    const r = await trangThaiChoNguoi({ user: U8, projectId: "demo" }, deps());
    expect(r.ok && r.ungDung).toEqual({ laChu: false, dangBan: true });
    const r7 = await trangThaiChoNguoi({ user: U7, projectId: "demo" }, deps());
    expect(r7.ok && (r7.ungDung as any).cong).toBe(5100);
  });

  it("★★ trạng thái gợi ý lệnh cài theo manifest + lệnh chạy suy được", async () => {
    const r = await trangThaiChoNguoi({ user: U7, projectId: "demo" }, deps());
    expect(r.ok && r.goiYCai).toEqual(["npm install"]);
    expect(r.ok && r.lenhChay).toMatchObject({ ok: true, moTa: "npm run dev" });
  });
});
