/** Đợt 11.8 · T1b — thủ tục xem / xác nhận / gỡ tin cậy: chỉ NGƯỜI, quyền, TOCTOU, hai tài khoản (đồ giả; DB thật ở aiAgentDefTrust.db.test). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bamNoiDung } from "@shared/agentCore";
import { napDinhNghiaTuRepo } from "./dinhNghiaAgentMayChu";
import { thuTucGoTinCayDinhNghia, thuTucXacNhanDinhNghia, thuTucXemDinhNghia, type PhuThuocThuTucDinhNghia } from "./thuTucDinhNghiaAgent";

const dinhNghia = (them = "") => `---\nname: doc-ma\ndescription: Doc ma\ntools: [read_file]\n${them}---\nYou read.\n`;
let goc = "";
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "thoca-tt-"));
  fs.mkdirSync(path.join(goc, ".thoca", "agents"), { recursive: true });
  fs.writeFileSync(path.join(goc, ".thoca", "agents", "doc-ma.md"), dinhNghia());
  process.env.AI_REPO_SANDBOX_ROOTS = `duan=Du an|${goc}`;
});
afterEach(() => {
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  fs.rmSync(goc, { recursive: true, force: true });
});

const A = { id: 1, role: "engineer" };
const B = { id: 2, role: "engineer" };

function dep(quyen: (id: number) => boolean = () => true) {
  const m = new Map<string, Set<string>>();
  const k = (u: number, p: string, t: string) => `${u}|${p}|${t}`;
  const d: PhuThuocThuTucDinhNghia & { m: typeof m } = {
    m,
    kiemQuyen: async (u) => quyen(u.id),
    nap: napDinhNghiaTuRepo,
    kho: {
      danhSachTinCay: async (u, p) => {
        const ra = new Map<string, Set<string>>();
        for (const [key, v] of m) {
          const [uu, pp, tt] = key.split("|");
          if (Number(uu) === u && pp === p) ra.set(tt, v);
        }
        return ra;
      },
      xacNhanTinCay: async (u, p, t, b) => {
        const s = m.get(k(u, p, t)) ?? new Set<string>();
        s.add(b);
        m.set(k(u, p, t), s);
        return true;
      },
      goTinCay: async (u, p, t) => (m.delete(k(u, p, t)) ? 1 : 0),
    },
  };
  return d;
}

describe("quyền + dự án", () => {
  it("không có ai_repo_read ⇒ PERMISSION_DENIED cho cả ba thủ tục, KHÔNG ghi", async () => {
    const d = dep(() => false);
    expect(await thuTucXemDinhNghia(A, "duan", d)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(await thuTucXacNhanDinhNghia(A, { projectId: "duan", ten: "doc-ma", bam: bamNoiDung(dinhNghia()) }, d)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(await thuTucGoTinCayDinhNghia(A, { projectId: "duan", ten: "doc-ma" }, d)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(d.m.size).toBe(0);
  });
  it("dự án ngoài danh sách trắng ⇒ PROJECT_NOT_FOUND (không nhận đường dẫn)", async () => {
    const d = dep();
    expect(await thuTucXemDinhNghia(A, "khong-co", d)).toMatchObject({ ok: false, note: "PROJECT_NOT_FOUND" });
    expect(await thuTucXacNhanDinhNghia(A, { projectId: "khong-co", ten: "doc-ma", bam: bamNoiDung(dinhNghia()) }, d)).toMatchObject({ note: "PROJECT_NOT_FOUND" });
  });
});

describe("xác nhận / gỡ — chỉ cho CHÍNH người gọi", () => {
  it("A xác nhận ⇒ A thấy daTinCay, B thì không; B gỡ không đụng của A", async () => {
    const d = dep();
    const bam = bamNoiDung(dinhNghia());
    expect(await thuTucXacNhanDinhNghia(A, { projectId: "duan", ten: "doc-ma", bam }, d)).toEqual({ ok: true, note: null, bam });
    const a = await thuTucXemDinhNghia(A, "duan", d);
    const b = await thuTucXemDinhNghia(B, "duan", d);
    expect(a.ok && a.muc.find((m) => m.ten === "doc-ma")!.daTinCay).toBe(true);
    expect(b.ok && b.muc.find((m) => m.ten === "doc-ma")!.daTinCay).toBe(false);
    expect(await thuTucGoTinCayDinhNghia(B, { projectId: "duan", ten: "doc-ma" }, d)).toMatchObject({ ok: true, daGo: 0 });
    expect((await thuTucXemDinhNghia(A, "duan", d)) as { muc: Array<{ ten: string; daTinCay: boolean }> }).toMatchObject({});
    expect(await thuTucGoTinCayDinhNghia(A, { projectId: "duan", ten: "doc-ma" }, d)).toMatchObject({ ok: true, daGo: 1 });
    const sau = await thuTucXemDinhNghia(A, "duan", d);
    expect(sau.ok && sau.muc.find((m) => m.ten === "doc-ma")!.daTinCay).toBe(false);
  });
  it("xác nhận ghi cho CHÍNH người gọi (B xác nhận ⇒ B tin, A không)", async () => {
    const d = dep();
    await thuTucXacNhanDinhNghia(B, { projectId: "duan", ten: "doc-ma", bam: bamNoiDung(dinhNghia()) }, d);
    const a = await thuTucXemDinhNghia(A, "duan", d);
    const b = await thuTucXemDinhNghia(B, "duan", d);
    expect(a.ok && a.muc.find((m) => m.ten === "doc-ma")!.daTinCay).toBe(false);
    expect(b.ok && b.muc.find((m) => m.ten === "doc-ma")!.daTinCay).toBe(true);
  });
  it("★★★ TOCTOU: băm đã xem lệch nội dung hiện tại ⇒ BAM_LECH và không ghi", async () => {
    const d = dep();
    const bamXem = bamNoiDung(dinhNghia());
    fs.writeFileSync(path.join(goc, ".thoca", "agents", "doc-ma.md"), dinhNghia("max_turns: 4\n"));
    expect(await thuTucXacNhanDinhNghia(A, { projectId: "duan", ten: "doc-ma", bam: bamXem }, d)).toEqual({ ok: false, note: "BAM_LECH" });
    expect(d.m.size).toBe(0);
  });
  it("hiển thị: dựng sẵn không có nội dung; tệp repo có nội dung chữ thuần", async () => {
    const r = await thuTucXemDinhNghia(A, "duan", dep());
    if (!r.ok) throw new Error("x");
    expect(r.muc.filter((m) => m.nguon === "dungSan").every((m) => m.noiDungHienThi === null)).toBe(true);
    expect(r.muc.find((m) => m.ten === "doc-ma")!.noiDungHienThi).toBe(dinhNghia());
  });
});

describe("router: chỉ người đăng nhập (không có đường qua công cụ agent)", () => {
  it("không phiên ⇒ từ chối; TEN_CONG_CU không có công cụ nào tên xác nhận/tin cậy", async () => {
    const { TEN_CONG_CU } = await import("@shared/agentCore");
    for (const t of TEN_CONG_CU) expect(t).not.toMatch(/xac|tin|trust|confirm/i);
    const { aiAgentRouter } = await import("../../../routers/aiAgentRouter");
    const c = aiAgentRouter.createCaller({ user: null } as never);
    await expect(c.xacNhanDinhNghia({ ten: "doc-ma", bam: "a".repeat(64) })).rejects.toThrow();
    await expect(c.goTinCayDinhNghia({ ten: "doc-ma" })).rejects.toThrow();
    await expect(c.dinhNghiaDanhSach()).rejects.toThrow();
  });
});
