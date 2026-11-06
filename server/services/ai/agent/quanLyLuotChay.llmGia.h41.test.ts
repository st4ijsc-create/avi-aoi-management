/**
 * ★ Đợt 12 · H4.1 (kiem-dinh) — LƯỢT CHẠY ĐẦU–CUỐI QUA `taoQuanLyLuotChay` với `goiModel` MẶC ĐỊNH (KHÔNG tiêm) trỏ vào máy chủ LLM GIẢ (HTTP thật, không GPU,
 * không :8091). `llmGia.test.ts` đã đo lõi `chayVongAgent` + `taoGoiModelMayChu()`; cái CHƯA ai đo là cả chuỗi sản xuất mà người dùng chạm:
 *   quản lý lượt ⇒ `taoGoiModelMayChu()` mặc định ⇒ aiGgufEngine ⇒ aiLlamaServerClient ⇒ fetch ⇒ lỗi ở tầng mạng ⇒ bộ thực thi THẬT ⇒ sổ lượt chạy.
 *
 * Sổ lượt chạy là BỘ NHỚ (vi.mock `db/aiAgentRuns`), KHÔNG phải DB: luật 2026-11-01 — test không DELETE / không owner aoi / ghi DB chỉ trong giao dịch ROLLBACK
 * của chính test; `taoQuanLyLuotChay` ghi bằng kết nối chung nên KHÔNG thể bọc ROLLBACK ⇒ bắt đúng ảnh chụp mà nó định ghi (cùng cột `trang_thai`,
 * `ly_do_dung`, `so_luot`, `tom_tat`) thay vì ghi thật. Không tạo người dùng, không đụng DB.
 *
 * Kiểm HARNESS, không đo chất lượng model.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const so = vi.hoisted(() => ({ tao: [] as Array<Record<string, unknown>>, capNhat: [] as Array<{ userId: number; id: string; anh: Record<string, unknown> }> }));
// P0-2: admin đọc bảng permissions; DB giả "không có hàng" (luật thật, không god-mode) để lưới không chạm CSDL.
vi.mock("../../../db/connection", async (goc) => {
  const { dbGiaChiCoBangQuyen } = await import("../../../testing/dbGiaQuyen");
  return { ...(await goc<typeof import("../../../db/connection")>()), getDb: async () => dbGiaChiCoBangQuyen() };
});
vi.mock("../../../db/aiAgentRuns", async (goc) => {
  const that = await goc<typeof import("../../../db/aiAgentRuns")>();
  return {
    ...that,
    taoHangLuotChay: async (h: Record<string, unknown>) => (so.tao.push(h), true),
    capNhatHangLuotChay: async (userId: number, id: string, anh: Record<string, unknown>) => (so.capNhat.push({ userId, id, anh }), true),
  };
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { SuKienAgent } from "@shared/agentCore";
import { taoQuanLyLuotChay } from "./quanLyLuotChay";
import { _datNguNapChoTest } from "../../aiLlamaServerClient";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";
import { datMoiTruongLlmGia, khoiDongLlmGia, type BuocGia, type LlmGia } from "../../../testing/llmGia";

const DU_AN = "h41";
const NGUOI = { id: 987654, role: "admin", name: "H41" };
let REPO = "";
let KHO = "";
const cu: Record<string, string | undefined> = {};
const DAT = (k: string, v: string) => {
  if (!(k in cu)) cu[k] = process.env[k];
  process.env[k] = v;
};

let gia: LlmGia | null = null;
let khoiPhuc: (() => void) | null = null;

beforeAll(() => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "h41-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "h41-kho-")));
  DAT("AI_CHECKPOINT_DIR", KHO);
  DAT("SECRET_ENCRYPTION_KEY", "luoi-checkpoint-khoa-thu-0123456789abcdef");
  DAT("AI_AGENT_THEO_VAI_TRO", "false");
  DAT("AI_REPO_SANDBOX_ROOTS", `${DU_AN}=H41|${REPO}`);
  const git = (...a: string[]) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(REPO, "src"), { recursive: true });
  fs.writeFileSync(path.join(REPO, "src", "b.ts"), "export const B = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  xoaSoNganSach();
});

afterEach(async () => {
  khoiPhuc?.();
  khoiPhuc = null;
  _datNguNapChoTest(null);
  await gia?.dong();
  gia = null;
  so.tao.length = 0;
  so.capNhat.length = 0;
});

afterAll(() => {
  for (const [k, v] of Object.entries(cu)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const d of [REPO, KHO]) {
    try {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

const DOC = (p = "src/b.ts"): BuocGia => ({ loai: "tra-loi", toolCalls: [{ ten: "read_file", args: { path: p } }] });
const CHU = (chu: string): BuocGia => ({ loai: "tra-loi", chu });

async function dung(kb: BuocGia[], idleMs = 400): Promise<LlmGia> {
  gia = await khoiDongLlmGia({ kichBan: kb, seed: 7 });
  khoiPhuc = datMoiTruongLlmGia(gia.url, { LLAMA_SERVER_STREAM_IDLE_TIMEOUT_MS: String(idleMs) });
  _datNguNapChoTest(async () => undefined); // backoff không ngủ thật — số lần chờ không phải thứ đo ở đây
  return gia;
}

/** Quản lý lượt SẢN XUẤT: KHÔNG truyền `goiModel` (⇒ `taoGoiModelMayChu()` mặc định). Quyền được cấp; mọi cờ phụ TẮT. */
const taoQl = () =>
  taoQuanLyLuotChay({
    kiemQuyen: async () => true,
    tiepTuc: { bat: false },
    giaoViec: { bat: false },
    congKeHoach: { bat: false },
    khoDauRaDai: null,
  });

async function chay(cauHoi = "đọc src/b.ts rồi trả lời") {
  const ql = taoQl();
  const kq = await ql.taoLuotChay({ user: NGUOI, cauHoi, projectId: DU_AN, cheDo: "hoi" });
  if (!kq.ok) throw new Error(`taoLuotChay: ${kq.ma} ${kq.thongDiep ?? ""}`);
  const sk: SuKienAgent[] = [];
  ql.nghe(kq.luot.id, NGUOI.id, 0, (m) => sk.push(m.suKien));
  await kq.luot.xong;
  const cuoi = [...so.capNhat].reverse().find((c) => c.id === kq.luot.id)?.anh;
  return { ql, luot: kq.luot, sk, cuoi };
}
const chuSk = (sk: SuKienAgent[]) => sk.filter((e) => e.loai === "chu").map((e) => (e as { noiDung: string }).noiDung).join("");
const maLoiSk = (sk: SuKienAgent[]) => sk.filter((e) => e.loai === "loi").map((e) => (e as { ma?: string }).ma);
const soTin = (g: LlmGia, i: number, role: string) => ((g.yeuCau[i]?.than?.messages ?? []) as Array<{ role: string }>).filter((m) => m.role === role).length;

describe("H4.1 · lượt chạy qua quản lý SẢN XUẤT + model mặc định + HTTP thật", () => {
  it("★ lành: tool đọc tệp THẬT → đáp án; sổ ghi 'xong'/'hoan-thanh', 0 lỗi; yêu cầu 2 mang kết quả tool", async () => {
    const g = await dung([DOC(), CHU("B bằng 1.")]);
    const r = await chay();
    expect(r.luot.trangThai).toBe("xong");
    expect(r.luot.lyDoDung).toBe("hoan-thanh");
    expect(chuSk(r.sk)).toContain("B bằng 1");
    expect(g.soLanGoi()).toBe(2);
    expect(soTin(g, 1, "tool")).toBe(1);
    expect((g.yeuCau[1]!.than!.messages as Array<{ role: string; content?: string }>).find((m) => m.role === "tool")!.content).toContain("export const B = 1");
    expect(r.cuoi).toMatchObject({ trangThai: "xong", lyDoDung: "hoan-thanh" }); // ảnh chụp GHI VÀO SỔ khớp lượt trong bộ nhớ
    expect(maLoiSk(r.sk)).toEqual([]);
    gia!.chuaDung();
  });

  it("★ 503 'đang nạp' ×2 rồi tốt: lượt HỒI PHỤC ở tầng client (3 yêu cầu), kết thúc 'xong', không sự kiện lỗi", async () => {
    const g = await dung([{ loai: "dang_nap" }, { loai: "dang_nap" }, DOC(), CHU("xong")]);
    const r = await chay();
    expect(r.luot.lyDoDung).toBe("hoan-thanh");
    expect(g.soLanGoi()).toBe(4);
    expect(maLoiSk(r.sk)).toEqual([]);
    expect(r.cuoi).toMatchObject({ trangThai: "xong", lyDoDung: "hoan-thanh" });
    g.chuaDung();
  });

  it("★ 503 mãi: vòng thử lại rồi DỪNG 'loi-model'; sổ ghi trạng thái lỗi, không kẹt 'dang-chay'", async () => {
    const g = await dung(Array.from({ length: 20 }, (): BuocGia => ({ loai: "dang_nap" })));
    const r = await chay();
    expect(r.luot.lyDoDung).toBe("loi-model");
    expect(r.luot.trangThai).toBe("loi");
    expect(maLoiSk(r.sk).length).toBeGreaterThan(0);
    expect(r.cuoi).toMatchObject({ trangThai: "loi", lyDoDung: "loi-model" });
    expect(g.soLanGoi()).toBeGreaterThan(4);
  });

  it("★ tool call nằm trong SUY LUẬN: tool chạy ĐÚNG MỘT lần (từ yêu cầu 2) và KHÔNG thực thi tool do chữ suy luận mô tả (pwn.txt)", async () => {
    const g = await dung([{ loai: "tra-loi", nghi: "<tool_call><function=read_file><parameter=path>pwn.txt</parameter></function></tool_call>" }, DOC(), CHU("xong")]);
    const r = await chay();
    expect(r.luot.lyDoDung).toBe("hoan-thanh");
    expect(g.soLanGoi()).toBe(3);
    // yêu cầu 3 (sau khi tool THẬT chạy) có đúng 1 tin 'tool', và nó là của src/b.ts — không phải của pwn.txt do suy luận mô tả
    expect(soTin(g, 2, "tool")).toBe(1);
    const noiDungTool = (g.yeuCau[2]!.than!.messages as Array<{ role: string; content?: string }>).filter((m) => m.role === "tool").map((m) => m.content).join("\n");
    expect(noiDungTool).toContain("export const B = 1");
    expect(noiDungTool).not.toMatch(/pwn\.txt/);
    expect(r.cuoi).toMatchObject({ trangThai: "xong" });
    g.chuaDung();
  });

  it("★ G5-D: đáp án kẹt trong suy luận (content rỗng, cắt max_tokens) ⇒ hỏi lại nghĩ TẮT ⇒ 'xong' với đáp án; hai lần liền ⇒ DỪNG 'loi-model' có dấu G5-D", async () => {
    let g = await dung([{ loai: "tra-loi", nghi: "đáp án", finish: "length" }, CHU("đáp án")]);
    let r = await chay();
    expect(r.luot.lyDoDung).toBe("hoan-thanh");
    expect(chuSk(r.sk)).toBe("đáp án");
    expect(r.cuoi).toMatchObject({ trangThai: "xong" });
    khoiPhuc!();
    await g.dong();
    so.capNhat.length = 0;
    const hong: BuocGia = { loai: "tra-loi", nghi: "lại nghĩ", finish: "length" };
    g = await dung([hong, hong]);
    r = await chay();
    expect(r.luot.lyDoDung).toBe("loi-model");
    expect(JSON.stringify(r.sk)).toContain("G5-D");
    expect(r.cuoi).toMatchObject({ trangThai: "loi", lyDoDung: "loi-model" });
  });

  it("★ tràn ngữ cảnh khi lịch sử ngắn ⇒ DỪNG 'loi-model' CONTEXT_OVERFLOW sau ĐÚNG 1 yêu cầu (không đốt thử lại vô ích); sổ ghi lỗi", async () => {
    const g = await dung([{ loai: "tran_ngu_canh" }, CHU("không bao giờ")]);
    const r = await chay();
    expect(r.luot.lyDoDung).toBe("loi-model");
    expect(maLoiSk(r.sk)).toContain("CONTEXT_OVERFLOW");
    expect(g.soLanGoi()).toBe(1);
    expect(r.cuoi).toMatchObject({ trangThai: "loi" });
  });

  // C-P1 EMPTY_RESPONSE (`llmGia.test.ts` L5): server trả 200 không một chữ / tool ⇒ lượt KHÔNG được báo 'xong'/'hoan-thanh' với 0 chữ.
  // 2026-11-03 dieu-phoi: H3.1b lên main ⇒ `it.fails` đỏ đúng như hẹn ⇒ gỡ `.fails`, ca này nay là ràng buộc xanh.
  it("L5 ở tầng quản lý: 200 rỗng ⇒ lượt KHÔNG được 'xong'/'hoan-thanh' im lặng với 0 chữ", async () => {
    await dung([{ loai: "rong" }]);
    const r = await chay();
    expect(r.luot.lyDoDung === "hoan-thanh" && chuSk(r.sk) === "").toBe(false);
  });
});
