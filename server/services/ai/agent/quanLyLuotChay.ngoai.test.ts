/**
 * ★ Đợt 10.4b L3 — bước NỐI lượt agent máy chủ với model NGOÀI vào `quanLyLuotChay` (hợp đồng
 * `docs/superpowers/plans/2026-10-30-dot10-4b-L3-agent-ngoai-hop-dong.md` §0 n1–n8 + §1). Lõi agent THẬT + bộ chuyển THẬT
 * (`vongAgentNgoai`); chỉ CỔNG (`kiemTruoc` / `goi`) và bộ đọc là giả trong tiến trình — KHÔNG gọi nhà cung cấp thật, không khoá thật.
 *
 * ĐỘT BIẾN PHẢI BẮT (mỗi mục một ca trở lên): bỏ kiểm bề mặt (a) · cho `sua` (b) · bỏ kiểm nhà máy / danh mục / phiên (c) · nuốt lỗi
 * cổng (d) · bỏ 428 / bỏ sàn mức phiên (e) · giữ chỗ trước khi kiểm · quảng bá `delegate` cho lượt ngoài (n2) · không ghi `nguonModel` /
 * `coLuotNgoai` (n3) · ngữ cảnh dự án ra ngoài · bỏ `vetNgoai` / `muc` ở sự kiện (u2/u3) · lượt cục bộ đi nhầm đường ngoài (n8) ·
 * "agent" lọt vào `BE_MAT_NGOAI_DUOC_DUNG` / chữ "agent-turn" rải nhiều chỗ (n6) · người khác đọc được lượt (k6) · huỷ vẫn gọi tiếp (n7).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

import type { GoiModel, SuKienAgent } from "@shared/agentCore";
import { taoQuanLyLuotChay, type MucSuKien } from "./quanLyLuotChay";
import type { PhuThuocLuotNgoai } from "./luotChayNgoai";
import type { KetQuaGoiNgoai, YeuCauGoiNgoai } from "../ngoai/congNgoai";
import { LoiNgoai } from "../ngoai/loi";
import { BE_MAT_NGOAI_DUOC_DUNG } from "../chonModel/kieu";
import { getDb } from "../../../db/connection";
import { aiAgentRuns } from "../../../../drizzle/schema";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";

/** Lớp 2 của "ngữ cảnh dự án không ra ngoài": host KHÔNG dựng ngữ cảnh (không đọc tệp quy ước) cho lượt ngoài — lớp 1 (bộ chuyển bỏ system lõi) che mất lớp này nếu chỉ soi thân gửi ra. */
const quyUoc = vi.hoisted(() => ({ n: 0 }));
vi.mock("./tepQuyUocAgent", async (io) => {
  const m = await io<typeof import("./tepQuyUocAgent")>();
  return { ...m, docTepQuyUoc: (goc: string) => (quyUoc.n++, m.docTepQuyUoc(goc)) };
});

const DU_AN = "l3ngoai";
const CHON = "ngoai:openai:gpt-test";
const CANH = "CANH_NGU_CANH_DU_AN_7f3a";
const SID = "11111111-2222-4333-8444-555555555555";
let REPO = "";
let uid = 0;
let uidKhac = 0;

interface Ghi {
  goi: YeuCauGoiNgoai[];
  kiemTruoc: YeuCauGoiNgoai[];
  tool: Array<{ ten: string; thamSo: Record<string, unknown> }>;
  coPhien: Array<[number, string]>;
}

/** Cổng giả: vòng 1 đòi read_file, vòng 2 trả lời (hoặc theo `kichBan`). */
function depGia(g: Ghi, o: Partial<PhuThuocLuotNgoai> & { kichBan?: Array<Partial<KetQuaGoiNgoai>> } = {}): PhuThuocLuotNgoai {
  const kb = o.kichBan ?? [{ noiDung: "", toolCalls: [{ ten: "read_file", thamSo: { path: "src/a.ts" } }] as never }, { noiDung: "Hàm cong trả a + b." }];
  let i = 0;
  return {
    beMatMo: async () => [...BE_MAT_NGOAI_DUOC_DUNG, "agent"],
    nhaMayCua: async () => [7],
    coTrongDanhMuc: async (c) => (c === CHON ? { nhaCungCap: "openai", model: "gpt-test" } : null),
    phien: async (u, s) => (u === uid && s === SID ? { projectId: DU_AN, soLuot: 0 } : null),
    datCoPhien: async (u, s) => {
      g.coPhien.push([u, s]);
    },
    kiemTruoc: async (yc) => {
      g.kiemTruoc.push(yc);
      return { muc: "ky-thuat", cfg: { tranByteDocLuot: 100_000, tranTepDocLuot: 5 } } as never;
    },
    goi: async (yc) => {
      g.goi.push(yc);
      const r = kb[Math.min(i++, kb.length - 1)]!;
      return { noiDung: "", toolCalls: [], khongTinCay: true, tokenVao: 100, tokenRa: 20, chiPhiUocUsd: 0.01, callId: 900 + i, ...r } as KetQuaGoiNgoai;
    },
    chayTool: async (ten, thamSo) => {
      g.tool.push({ ten, thamSo });
      return { ok: true, path: String(thamSo.path ?? ""), noiDung: "export const cong = (a: number, b: number) => a + b;" };
    },
    ...o,
  };
}
const moi = (): Ghi => ({ goi: [], kiemTruoc: [], tool: [], coPhien: [] });

/** Model CỤC BỘ giả — lượt ngoài mà gọi tới nó là sai đường. */
const modelCucBo = (dem: { n: number }): GoiModel =>
  async function* () {
    dem.n++;
    yield { loai: "chu", noiDung: "cục bộ" };
    yield { loai: "xong", toolCalls: [] };
  };

async function suKienCua(ql: ReturnType<typeof taoQuanLyLuotChay>, runId: string, userId: number): Promise<SuKienAgent[]> {
  const ds: MucSuKien[] = [];
  ql.nghe(runId, userId, 0, (m) => ds.push(m));
  return ds.map((m) => m.suKien);
}

const yc = (them: Record<string, unknown> = {}) => ({
  user: { id: uid, role: "admin", name: "Ky su L3" },
  cauHoi: "hàm cong làm gì?",
  projectId: DU_AN,
  cheDo: "hoi",
  chonModel: CHON,
  ...them,
});

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "l3-ngoai-")));
  const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(REPO, "src"));
  fs.writeFileSync(path.join(REPO, "src/a.ts"), "export const cong = (a: number, b: number) => a + b;\n");
  fs.writeFileSync(path.join(REPO, "AGENTS.md"), `# Quy ước\n${CANH}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=L3 ngoai|${REPO}`;
  uid = (await taoNguoiDungTest("l3ngoai", "admin")).id;
  uidKhac = (await taoNguoiDungTest("l3ngoaikhac", "admin")).id;
}, 60_000);

afterAll(async () => {
  delete process.env.AI_REPO_SANDBOX_ROOTS;
  const db = await getDb();
  if (db) for (const u of [uid, uidKhac]) if (u) await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, u));
  try {
    fs.rmSync(REPO, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}, 60_000);

let g: Ghi;
beforeEach(() => {
  g = moi();
});

async function soHangSo(u: number): Promise<number> {
  const db = await getDb();
  return db ? (await db.select({ id: aiAgentRuns.id }).from(aiAgentRuns).where(eq(aiAgentRuns.userId, u))).length : -1;
}

describe("L3 n1 — đường vào: mọi từ chối TRƯỚC giữ chỗ / hàng sổ / gọi mạng", () => {
  it("(a) bề mặt agent CHƯA mở ⇒ 404 CHON_MODEL_KHONG_CO như trước L3; không kiểm trước, không gọi", async () => {
    const ql = taoQuanLyLuotChay({ ngoai: depGia(g, { beMatMo: async () => BE_MAT_NGOAI_DUOC_DUNG }) });
    const kq = await ql.taoLuotChay(yc());
    expect(kq).toMatchObject({ ok: false, ma: "CHON_MODEL_KHONG_CO", http: 404 });
    expect([g.kiemTruoc.length, g.goi.length]).toEqual([0, 0]);
  });

  it("(b) cheDo 'sua' ⇒ 400 NGOAI_CHI_HOI; không hàng sổ, không kiểm trước", async () => {
    const truoc = await soHangSo(uid);
    const kq = await taoQuanLyLuotChay({ ngoai: depGia(g) }).taoLuotChay(yc({ cheDo: "sua" }));
    expect(kq).toMatchObject({ ok: false, ma: "NGOAI_CHI_HOI", http: 400 });
    expect(await soHangSo(uid)).toBe(truoc);
    expect(g.kiemTruoc.length).toBe(0);
  });

  it("(c) nhiều nhà máy / model ngoài danh mục / phiên của người khác hoặc khác dự án ⇒ 404 NGOAI_KHONG_TON_TAI", async () => {
    const ca: Array<Partial<PhuThuocLuotNgoai>> = [
      { nhaMayCua: async () => [7, 8] },
      { nhaMayCua: async () => null },
      { coTrongDanhMuc: async () => null },
    ];
    for (const o of ca) {
      const kq = await taoQuanLyLuotChay({ ngoai: depGia(g, o) }).taoLuotChay(yc());
      expect(kq).toMatchObject({ ok: false, ma: "NGOAI_KHONG_TON_TAI", http: 404 });
    }
    const khac = await taoQuanLyLuotChay({ ngoai: depGia(g) }).taoLuotChay(yc({ user: { id: uidKhac, role: "admin" }, sessionId: SID }));
    expect(khac).toMatchObject({ ok: false, ma: "NGOAI_KHONG_TON_TAI" });
    const duAnKhac = await taoQuanLyLuotChay({ ngoai: depGia(g, { phien: async () => ({ projectId: "khac", soLuot: 0 }) }) }).taoLuotChay(yc({ sessionId: SID }));
    expect(duAnKhac).toMatchObject({ ok: false, ma: "NGOAI_KHONG_TON_TAI" });
    expect(g.goi.length).toBe(0);
  });

  it("(d) lỗi cổng ⇒ mã + HTTP theo HTTP_LOI_TRUOC_SSE, vượt trần kèm tranVuot (u1)", async () => {
    const tran = await taoQuanLyLuotChay({
      ngoai: depGia(g, { kiemTruoc: async () => Promise.reject(new LoiNgoai("NGOAI_VUOT_TRAN", "nha-may")) }),
    }).taoLuotChay(yc());
    expect(tran).toMatchObject({ ok: false, ma: "NGOAI_VUOT_TRAN", http: 429, tranVuot: "nha-may" });
    const tat = await taoQuanLyLuotChay({ ngoai: depGia(g, { kiemTruoc: async () => Promise.reject(new LoiNgoai("NGOAI_TAT")) }) }).taoLuotChay(yc());
    expect(tat).toMatchObject({ ok: false, ma: "NGOAI_TAT", http: 404 });
  });

  it("(d) yêu cầu kiểm trước: qua bộ dựng, nguồn mức agent-turn, mục đích agent, đúng nhà máy", async () => {
    await taoQuanLyLuotChay({ ngoai: depGia(g, { kiemTruoc: async (y) => (g.kiemTruoc.push(y), Promise.reject(new LoiNgoai("NGOAI_TAT"))) }) }).taoLuotChay(yc());
    expect(g.kiemTruoc[0]!.ngu).toMatchObject({ userId: uid, nhaMayNguoiGoi: [7], nhaMayChuDuLieu: [7], nguonMuc: { loai: "be-mat", beMat: "agent-turn" } });
    expect(g.kiemTruoc[0]!.mucDich).toBe("agent");
  });

  it("(e) có lịch sử mà chưa xác nhận ⇒ 428 CAN_XAC_NHAN_VAN_HANH + muc; phiên đã có lượt (không gửi lịch sử) cũng vậy (k3)", async () => {
    const lichSu = [
      { role: "user", content: "trước" },
      { role: "assistant", content: "đáp" },
    ];
    const a = await taoQuanLyLuotChay({ ngoai: depGia(g) }).taoLuotChay(yc({ lichSu }));
    expect(a).toMatchObject({ ok: false, ma: "CAN_XAC_NHAN_VAN_HANH", http: 428, muc: "van-hanh" });
    const b = await taoQuanLyLuotChay({ ngoai: depGia(g, { phien: async () => ({ projectId: DU_AN, soLuot: 2 }) }) }).taoLuotChay(yc({ sessionId: SID }));
    expect(b).toMatchObject({ ok: false, ma: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" });
    // sàn mức tới cổng: phiên có lượt ⇒ nguonMuc khai van-hanh dù không có tin lịch sử nào
    expect(g.kiemTruoc.at(-1)!.ngu.nguonMuc).toMatchObject({ phanDaGhep: expect.arrayContaining(["van-hanh"]) });
    expect(g.goi.length).toBe(0);
  });

  it("(rà kiem-dinh n9) xác nhận van-hanh CHỈ boolean true — \"true\" / \"false\" / 1 / \"yes\" / {} vẫn 428", async () => {
    const lichSu = [{ role: "user", content: "trước" }];
    for (const x of ["true", "false", 1, "yes", {}]) {
      const kq = await taoQuanLyLuotChay({ ngoai: depGia(g) }).taoLuotChay(yc({ lichSu, xacNhanVanHanh: x }));
      expect(kq, JSON.stringify(x)).toMatchObject({ ok: false, ma: "CAN_XAC_NHAN_VAN_HANH", http: 428 });
    }
    expect(g.goi.length).toBe(0);
  });

  it("(f) đã có lượt chạy ⇒ 409 DANG_CO_LUOT_CHAY (sau mọi kiểm ngoài)", async () => {
    let tha!: () => void;
    const cho = new Promise<void>((r) => (tha = r));
    const ql = taoQuanLyLuotChay({ ngoai: depGia(g, { goi: async (y) => (g.goi.push(y), await cho, { noiDung: "x", toolCalls: [], khongTinCay: true, tokenVao: 1, tokenRa: 1, chiPhiUocUsd: 0, callId: 1 }) }) });
    const k1 = await ql.taoLuotChay(yc());
    expect(k1.ok).toBe(true);
    const k2 = await ql.taoLuotChay(yc());
    expect(k2).toMatchObject({ ok: false, ma: "DANG_CO_LUOT_CHAY", http: 409 });
    tha();
    if (k1.ok) await k1.luot.xong;
  });
});

describe("L3 — chạy: bộ chuyển ngoài, không ngữ cảnh dự án, không delegate, vết + mức ở sự kiện", () => {
  it("★★★ vòng read_file ⇒ trả lời; nguonModel ghi lúc tạo; bat-dau.model ngoài + muc; xong.vetNgoai cộng dồn; không can-duyet", async () => {
    const dem = { n: 0 };
    const ql = taoQuanLyLuotChay({ ngoai: depGia(g), goiModel: modelCucBo(dem), giaoViec: { bat: true } });
    const kq = await ql.taoLuotChay(yc());
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    await kq.luot.xong;
    const sk = await suKienCua(ql, kq.luot.id, uid);
    expect(dem.n).toBe(0); // model cục bộ KHÔNG được gọi
    expect(sk.find((e) => e.loai === "bat-dau")).toMatchObject({ model: { nguon: "ngoai", model: CHON, muc: "ky-thuat" } });
    expect(sk).toContainEqual({ loai: "dang-cho-model", phiaTruoc: 0 });
    expect(sk.find((e) => e.loai === "ket-qua-tool")).toMatchObject({ ten: "read_file", ok: true });
    expect(sk.some((e) => e.loai === "can-duyet" || e.loai === "de-xuat-nho" || e.loai === "checkpoint")).toBe(false);
    expect(sk.at(-1)).toMatchObject({
      loai: "xong",
      lyDo: "hoan-thanh",
      vetNgoai: { nhaCungCap: "openai", model: "gpt-test", tokenVao: 200, tokenRa: 40, chiPhiUocUsd: 0.02 },
    });
    expect(JSON.stringify(sk.at(-1))).not.toMatch(/callId/);
    expect(g.tool).toEqual([{ ten: "read_file", thamSo: { path: "src/a.ts" } }]);
    const db = await getDb();
    const [h] = await db!.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, kq.luot.id));
    expect(h!.nguonModel).toBe(CHON);
    expect((await ql.chiTiet(kq.luot.id, uid))!.nguonModel).toBe(CHON);
  });

  it("n2 (d1) — lượt ngoài: công cụ quảng bá ĐÚNG read_file · list_dir · grep · todo_write, KHÔNG delegate dù cờ giao việc BẬT", async () => {
    const kq = await taoQuanLyLuotChay({ ngoai: depGia(g), giaoViec: { bat: true } }).taoLuotChay(yc());
    if (kq.ok) await kq.luot.xong;
    const ten = (g.goi[0]!.congCu ?? []).map((t) => t.ten).sort();
    expect(ten).toEqual(["grep", "list_dir", "read_file", "todo_write"]);
  });

  it("ngữ cảnh dự án (AGENTS.md, cây, lệnh) KHÔNG có trong bất kỳ thân gửi ra nào", async () => {
    const kq = await taoQuanLyLuotChay({ ngoai: depGia(g) }).taoLuotChay(yc());
    if (kq.ok) await kq.luot.xong;
    const than = JSON.stringify([...g.kiemTruoc, ...g.goi].map((y) => y.tinNhan));
    expect(than).not.toContain(CANH);
    expect(than).not.toContain("Project:");
  });

  it("lớp 2 — host không dựng ngữ cảnh dự án cho lượt ngoài (không đọc tệp quy ước); đối chứng: lượt cục bộ CÓ đọc", async () => {
    quyUoc.n = 0;
    const kq = await taoQuanLyLuotChay({ ngoai: depGia(g) }).taoLuotChay(yc());
    if (kq.ok) await kq.luot.xong;
    expect(quyUoc.n).toBe(0);
    const cb = await taoQuanLyLuotChay({ goiModel: modelCucBo({ n: 0 }) }).taoLuotChay(yc({ chonModel: undefined }));
    if (cb.ok) await cb.luot.xong;
    expect(quyUoc.n).toBeGreaterThan(0);
    expect(g.goi.every((y) => y.ngu.runId === (kq.ok ? kq.luot.id : ""))).toBe(true);
  });

  it("n3 (d2) — có sessionId ⇒ coLuotNgoai đặt cho (chính người gọi, phiên) TRƯỚC khi gọi; đặt hỏng ⇒ 503, không giữ chỗ", async () => {
    const kq = await taoQuanLyLuotChay({ ngoai: depGia(g) }).taoLuotChay(yc({ sessionId: SID }));
    if (kq.ok) await kq.luot.xong;
    expect(g.coPhien).toEqual([[uid, SID]]);
    const ql = taoQuanLyLuotChay({ ngoai: depGia(g, { datCoPhien: async () => Promise.reject(new Error("db")) }) });
    expect(await ql.taoLuotChay(yc({ sessionId: SID }))).toMatchObject({ ok: false, ma: "NGOAI_SO_HONG", http: 503 });
    // chỗ đã nhả: lượt sau của cùng người KHÔNG bị 409
    const lai = await taoQuanLyLuotChay({ ngoai: depGia(moi()) }).taoLuotChay(yc());
    expect(lai.ok).toBe(true);
    if (lai.ok) await lai.luot.xong;
  });

  it("có lịch sử + xacNhanVanHanh ⇒ chạy, bat-dau.muc van-hanh, mọi vòng gửi mức van-hanh", async () => {
    const lichSu = [
      { role: "user", content: "trước" },
      { role: "assistant", content: "đáp" },
    ];
    const ql = taoQuanLyLuotChay({ ngoai: depGia(g) });
    const kq = await ql.taoLuotChay(yc({ lichSu, xacNhanVanHanh: true }));
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    await kq.luot.xong;
    expect((await suKienCua(ql, kq.luot.id, uid)).find((e) => e.loai === "bat-dau")).toMatchObject({ model: { muc: "van-hanh" } });
    expect(g.goi.length).toBe(2);
    for (const y of g.goi) expect(y.ngu.nguonMuc).toMatchObject({ phanDaGhep: expect.arrayContaining(["van-hanh"]) });
  });

  it("k6 — người khác không nghe / đọc / huỷ được lượt ngoài", async () => {
    const ql = taoQuanLyLuotChay({ ngoai: depGia(g) });
    const kq = await ql.taoLuotChay(yc());
    if (!kq.ok) throw new Error("không tạo được");
    await kq.luot.xong;
    expect(ql.nghe(kq.luot.id, uidKhac, 0, () => undefined)).toBeNull();
    expect(ql.layLuotChay(kq.luot.id, uidKhac)).toBeNull();
    expect(await ql.chiTiet(kq.luot.id, uidKhac)).toBeNull();
    expect(ql.huy(kq.luot.id, uidKhac)).toBe(false);
  });

  it("n7 — huỷ giữa vòng: cuộc gọi đang bay chạy hết (giới hạn có ghi), KHÔNG có vòng gọi tiếp, lượt dừng huy", async () => {
    let tha!: () => void;
    const cho = new Promise<void>((r) => (tha = r));
    const dep = depGia(g);
    const goiGoc = dep.goi;
    const ql = taoQuanLyLuotChay({
      ngoai: { ...dep, goi: async (y) => (g.goi.length === 0 ? (await cho, goiGoc(y)) : goiGoc(y)) },
    });
    const kq = await ql.taoLuotChay(yc());
    if (!kq.ok) throw new Error("không tạo được");
    await new Promise((r) => setTimeout(r, 20));
    expect(ql.huy(kq.luot.id, uid)).toBe(true);
    tha();
    await kq.luot.xong;
    expect(g.goi.length).toBe(1);
    expect((await suKienCua(ql, kq.luot.id, uid)).at(-1)).toMatchObject({ loai: "xong", lyDo: "huy" });
  });

  it("model ngoài đòi tool ngoài tập ⇒ không thực thi, lượt dừng lỗi NGOAI_TOOL_KHONG_CAP", async () => {
    const ql = taoQuanLyLuotChay({ ngoai: depGia(g, { kichBan: [{ toolCalls: [{ ten: "write_file", thamSo: { path: "x" } }] as never }] }) });
    const kq = await ql.taoLuotChay(yc());
    if (!kq.ok) throw new Error("không tạo được");
    await kq.luot.xong;
    const sk = await suKienCua(ql, kq.luot.id, uid);
    expect(g.tool).toEqual([]);
    expect(sk.find((e) => e.loai === "loi")).toMatchObject({ ma: "NGOAI_TOOL_KHONG_CAP" });
  });
});

describe("L3 n8 + n6 — hồi quy đường cục bộ, bề mặt chưa mở, ánh xạ một chỗ", () => {
  it("n8 — cheDo hoi + model cục bộ (vắng / auto): đường cũ y nguyên, KHÔNG chạm phụ thuộc ngoài; nguonModel null", async () => {
    for (const chonModel of [undefined, "auto"]) {
      const dem = { n: 0 };
      const ql = taoQuanLyLuotChay({ ngoai: depGia(g, { beMatMo: async () => Promise.reject(new Error("không được gọi")) }), goiModel: modelCucBo(dem) });
      const kq = await ql.taoLuotChay(yc({ chonModel }));
      expect(kq.ok).toBe(true);
      if (!kq.ok) return;
      await kq.luot.xong;
      expect(dem.n).toBe(1);
      expect(kq.luot.nguonModel).toBeNull();
      // bat-dau.model (nếu có) là nhánh CỤC BỘ (theo vai trò khi AI_AGENT_THEO_VAI_TRO bật) — không bao giờ nhánh ngoài
      const bd = (await suKienCua(ql, kq.luot.id, uid)).find((e) => e.loai === "bat-dau") as { model?: { nguon?: string; muc?: unknown } };
      expect(bd.model?.nguon).not.toBe("ngoai");
      expect(bd.model?.muc).toBeUndefined();
    }
    expect([g.kiemTruoc.length, g.goi.length]).toEqual([0, 0]);
  });

  it("(rà kiem-dinh n17) cờ AI_AGENT_THEO_VAI_TRO BẬT: lượt ngoài KHÔNG qua chọn model theo vai trò (không planInference, không khe GPU)", async () => {
    const cu = process.env.AI_AGENT_THEO_VAI_TRO;
    process.env.AI_AGENT_THEO_VAI_TRO = "1";
    const goiVaiTro: string[] = [];
    const spy = (ten: string) => () => {
      goiVaiTro.push(ten);
      throw new Error(`vai trò không được gọi: ${ten}`);
    };
    try {
      const kq = await taoQuanLyLuotChay({
        ngoai: depGia(g),
        vaiTro: { planInference: spy("planInference") as never, layAnh: spy("layAnh") as never, nguCanhKhe: spy("nguCanhKhe") as never, laDuAnPlc: spy("laDuAnPlc") as never },
      }).taoLuotChay(yc());
      expect(kq.ok).toBe(true);
      if (kq.ok) await kq.luot.xong;
      expect(goiVaiTro).toEqual([]);
      expect(g.goi.length).toBe(2);
    } finally {
      if (cu === undefined) delete process.env.AI_AGENT_THEO_VAI_TRO;
      else process.env.AI_AGENT_THEO_VAI_TRO = cu;
    }
  });

  it("(rà kiem-dinh n16) lượt ngoài không dựng chỉ mục mã nền (đối chứng: lượt cục bộ có chạm chỉ mục)", async () => {
    const cham: string[] = [];
    const chiMuc = new Proxy({} as never, {
      get: (_t, k) => (typeof k === "string" && k !== "then" ? async () => (cham.push(k), undefined) : undefined),
    });
    const kq = await taoQuanLyLuotChay({ ngoai: depGia(g), chiMucMa: chiMuc }).taoLuotChay(yc());
    if (kq.ok) await kq.luot.xong;
    await new Promise((r) => setTimeout(r, 50));
    expect(cham).toEqual([]);
    const cb = await taoQuanLyLuotChay({ goiModel: modelCucBo({ n: 0 }), chiMucMa: chiMuc }).taoLuotChay(yc({ chonModel: undefined }));
    if (cb.ok) await cb.luot.xong;
    await new Promise((r) => setTimeout(r, 50));
    expect(cham.length).toBeGreaterThan(0);
  });

  it("(rà kiem-dinh n24) taoHangLuotChay: nguonModel sai hình dạng ⇒ KHÔNG tạo hàng (trước cả CHECK 0419)", async () => {
    const { taoHangLuotChay } = await import("../../../db/aiAgentRuns");
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    // lớp mã chặn TRƯỚC khi chạm CSDL (CHECK 0419 là lớp sau): không có câu INSERT hỏng ⇒ không có cảnh báo degrade của sổ
    const canhBao = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const sai of ["openai:gpt", "ngoai:OPENAI:x", "ngoai:openai:", "ngoai:openai:a b"]) {
        expect(await taoHangLuotChay({ id, userId: uid, projectId: DU_AN, cheDo: "hoi", cauHoi: "q", nguonModel: sai }), sai).toBe(false);
      }
      expect(canhBao.mock.calls.filter((c) => String(c[0]).includes("taoHangLuotChay"))).toEqual([]);
    } finally {
      canhBao.mockRestore();
    }
    const db = await getDb();
    expect((await db!.select({ id: aiAgentRuns.id }).from(aiAgentRuns).where(eq(aiAgentRuns.id, id))).length).toBe(0);
  });

  it("n6 (k7) — \"agent\" CHƯA nằm trong BE_MAT_NGOAI_DUOC_DUNG (mở sau L3b)", () => {
    expect(BE_MAT_NGOAI_DUOC_DUNG).not.toContain("agent");
  });

  it("n6 — chữ \"agent-turn\" (ánh xạ bề mặt agent ⇒ nguồn mức) chỉ ở chonModel/kieu.ts; còn lại là KIỂU, ghim số", () => {
    const GOC = path.join(__dirname, "../../../..");
    const thay: Record<string, number> = {};
    const duyet = (d: string) => {
      for (const ten of fs.readdirSync(d)) {
        const p = path.join(d, ten);
        if (fs.statSync(p).isDirectory()) {
          if (ten !== "node_modules") duyet(p);
        } else if (/\.ts$/.test(ten) && !/\.test\.ts$/.test(ten)) {
          const s = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
          const n = (s.match(/["']agent-turn["']/g) ?? []).length;
          if (n) thay[path.relative(GOC, p).replace(/\\/g, "/")] = n;
        }
      }
    };
    duyet(path.join(GOC, "server"));
    expect(thay).toEqual({
      "server/services/ai/chonModel/kieu.ts": 1, // NGUON_MUC_LUOT_AGENT — ánh xạ DUY NHẤT
      "server/services/ai/ngoai/congNgoai.ts": 1, // kiểu NguonMuc
      "server/services/ai/ngoai/phanLoai.ts": 1, // kiểu tham số mucChoBeMat
      "server/services/ai/ngoai/nguonKiemDinh.ts": 2, // kiểu + nguồn KIỂM ĐỊNH đọc lượt agent đã lưu (không dựng lượt ngoài)
    });
  });
});
