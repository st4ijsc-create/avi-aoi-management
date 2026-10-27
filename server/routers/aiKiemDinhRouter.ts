/**
 * ★ Đợt 10.4 (D5/D6, T1a/T1b) — `aiKiemDinh.{xemTruoc, chay}`: nút "Nhờ AI ngoài kiểm định" trên câu trả lời chat / lượt coding / lượt agent.
 * Sau MOD_AI, KHÔNG cần admin (người dùng thường bấm được). Ràng buộc (kế hoạch 10.4 v3, kiem-dinh + dieu-phoi duyệt):
 *   • input zod `.strict()` — CHỈ { chonModel, nguon (ID lượt đã lưu), tieuChi? }: không nhận văn bản / mức dữ liệu / nhà máy / công cụ / đính kèm.
 *   • Máy chủ đọc kho theo ID (`nguonKiemDinh.ts`), CHỈ chủ lượt (không ngoại lệ admin), suy mức dữ liệu (thiếu provenance ⇒ `van-hanh`).
 *   • Người gọi phải thuộc ĐÚNG MỘT nhà máy (kho không gắn nhà máy) — không có / nhiều ⇒ NOT_FOUND.
 *   • Model ngoài phải nằm trong danh mục của nhà máy VÀ `BE_MAT_NGOAI_DUOC_DUNG` chứa "kiem-dinh".
 *   • `xemTruoc`: chỉ THÔNG TIN — chạy cùng bước (1)–(5) của cổng (`kiemTruocNgoai`), KHÔNG giữ chỗ trần, KHÔNG gọi mạng.
 *   • `chay`: tự tính lại mọi thứ, gọi `kiemDinhNgoai` (hàm dùng chung với node). Chống lặp: cùng khoá đang chạy ⇒ 409 `NGOAI_DANG_CHAY`;
 *     xong trong 120 s ⇒ trả kết quả cũ `tuBoNho: true` (không gọi lại, không tính phí) — bộ nhớ trong tiến trình.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, moduleProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import { phamViCua } from "./_phamViNguoiXem";
import { BE_MAT_NGOAI_DUOC_DUNG, CHON_MODEL_RE } from "../services/ai/chonModel/kieu";
import type { KetQuaKiemDinhNgoai } from "../services/ai/ngoai/kiemDinhNgoai";
import type { NguonKiemDinh, NoiDungNguon } from "../services/ai/ngoai/nguonKiemDinh";
import type { YeuCauGoiNgoai } from "../services/ai/ngoai/congNgoai";
import type { MaLoiNgoai } from "../services/ai/ngoai/loi";

const thuTuc = moduleProcedure("MOD_AI");

const NGUON = z.discriminatedUnion("loai", [
  z.object({ loai: z.literal("chat"), cuocTroChuyenId: z.number().int().positive(), tinNhanId: z.number().int().positive() }).strict(),
  z.object({ loai: z.literal("agent"), runId: z.string().uuid() }).strict(),
  z.object({ loai: z.literal("coding"), phienId: z.string().uuid(), chiSoLuot: z.number().int().min(0).max(10_000) }).strict(),
]);
const INPUT = z
  .object({
    chonModel: z.string().max(200).refine((s) => s.startsWith("ngoai:") && CHON_MODEL_RE.test(s), "chonModel phải là model ngoài 'ngoai:<ncc>:<model>'"),
    nguon: NGUON,
    tieuChi: z.string().max(2000).optional(),
  })
  .strict();
type Input = z.infer<typeof INPUT>;

export const TRAN_BO_NHO_KIEM_DINH_MS = 120_000;

// ─── phụ thuộc (lưới thay) ──────────────────────────────────────────────────────────────────────────────────
interface PhuThuocKiemDinh {
  docNguon: (userId: number, nguon: NguonKiemDinh) => Promise<NoiDungNguon | null>;
  nhaMayCua: (ctx: unknown) => Promise<number[] | null>;
  goi: (yc: YeuCauGoiNgoai) => Promise<import("../services/ai/ngoai/congNgoai").KetQuaGoiNgoai>;
  kiemTruoc: (yc: YeuCauGoiNgoai) => Promise<import("../services/ai/ngoai/congNgoai").KiemTruocNgoai>;
}
const phuThuocThat: PhuThuocKiemDinh = {
  docNguon: async (u, n) => (await import("../services/ai/ngoai/nguonKiemDinh")).docNguonKiemDinh(u, n),
  nhaMayCua: async (ctx) => {
    const { resolveTenantFactoryScope } = await import("../db/reportAggregators");
    return (await resolveTenantFactoryScope(phamViCua(ctx as never))).factoryIds;
  },
  goi: async (yc) => (await import("../services/ai/ngoai/congNgoai")).goiAiNgoai(yc),
  kiemTruoc: async (yc) => (await import("../services/ai/ngoai/congNgoai")).kiemTruocNgoai(yc),
};
let dep: PhuThuocKiemDinh = phuThuocThat;
/** Chỉ lưới. `null` ⇒ thật. Luôn xoá bộ nhớ chống lặp. */
export function __datPhuThuocKiemDinhChoTest(d: Partial<PhuThuocKiemDinh> | null): void {
  dep = d ? { ...phuThuocThat, ...d } : phuThuocThat;
  boNho.clear();
}

// ─── chống lặp ──────────────────────────────────────────────────────────────────────────────────────────────
type MucNho = { trangThai: "dang-chay" } | { trangThai: "xong"; luc: number; kq: KetQuaKiemDinhNgoai };
const boNho = new Map<string, MucNho>();
const khoaLap = (userId: number, i: Input) => createHash("sha256").update(JSON.stringify([userId, i.nguon, i.chonModel, i.tieuChi ?? ""])).digest("hex");
function donBoNho(bayGio: number): void {
  for (const [k, v] of boNho) if (v.trangThai === "xong" && bayGio - v.luc > TRAN_BO_NHO_KIEM_DINH_MS) boNho.delete(k);
}

// ─── chung ──────────────────────────────────────────────────────────────────────────────────────────────────
const loiNgoai = (ma: MaLoiNgoai | string, http: TRPCError["code"]) => appError(http, "OPERATION_FAILED", { operation: "aiKiemDinh", reason: ma }, ma);
const khongCo = () => appError("NOT_FOUND", "OPERATION_FAILED", { operation: "aiKiemDinh", reason: "kiem-dinh-khong-co-nguon" }, "không có");

/** Phạm vi: CHỈ chủ lượt (đọc kho theo userId) + đúng MỘT nhà máy của người gọi; ngoài ⇒ NOT_FOUND. */
async function nguonKiemDinhTrongPhamVi(ctx: { user: { id: number } }, i: Input) {
  if (!BE_MAT_NGOAI_DUOC_DUNG.includes("kiem-dinh")) throw khongCo();
  const nm = await dep.nhaMayCua(ctx);
  if (!nm || nm.length !== 1) throw khongCo(); // B2: đúng MỘT nhà máy (kho không gắn nhà máy)
  const nguon = await dep.docNguon(ctx.user.id, i.nguon);
  if (!nguon) throw khongCo();
  if (!nguon.traLoi.trim()) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "aiKiemDinh", reason: "kiem-dinh-tra-loi-rong" }, "trống");
  const [, nhaCungCap = "", ...m] = i.chonModel.split(":");
  const F = nm[0]!;
  const ngu: YeuCauGoiNgoai["ngu"] = {
    userId: ctx.user.id,
    flowId: null,
    runId: null,
    tuDong: false,
    nhaMayNguoiGoi: [F],
    nhaMayChuDuLieu: [F],
    nguonMuc: { loai: "be-mat", beMat: nguon.beMat, phanDaGhep: [nguon.muc] },
  };
  return { F, nguon, dich: { nhaCungCap, model: m.join(":") }, ngu };
}

async function maTuLoi(e: unknown): Promise<never> {
  const ma = (e as { ma?: unknown })?.ma;
  if (typeof ma === "string" && /^NGOAI_/.test(ma)) {
    const { maTrpcCua } = await import("../services/ai/ngoai/loi");
    throw loiNgoai(ma, maTrpcCua(ma as MaLoiNgoai));
  }
  throw e;
}

export const aiKiemDinhRouter = router({
  /** THÔNG TIN trước khi gửi (không mạng, không giữ chỗ). `duocPhep` chỉ tham khảo — `chay` tự kiểm lại. */
  xemTruoc: thuTuc.input(INPUT).query(async ({ ctx, input }) => {
    const c = await nguonKiemDinhTrongPhamVi(ctx, input);
    const [{ lapTinNhanKiemDinh, MAX_TOKENS_KIEM_DINH_MAC_DINH }, { uocTokenVao, docConLaiNgay }, { TRAN_YEU_CAU_BYTE }, { LoiNgoai }] = await Promise.all([
      import("../services/ai/ngoai/kiemDinhNgoai"),
      import("../services/ai/ngoai/tranChiPhi"),
      import("../services/ai/ngoai/congNgoai"),
      import("../services/ai/ngoai/loi"),
    ]);
    const tinNhan = lapTinNhanKiemDinh({ cauHoi: c.nguon.cauHoi, traLoi: c.nguon.traLoi, ...(input.tieuChi ? { tieuChi: input.tieuChi } : {}) });
    const yc: YeuCauGoiNgoai = { dich: c.dich, tinNhan, maxTokens: MAX_TOKENS_KIEM_DINH_MAC_DINH, mucDich: "kiem-dinh", ngu: c.ngu };
    const kichThuocByte = Buffer.byteLength(JSON.stringify({ t: tinNhan, c: [] }), "utf8");
    let duocPhep = true;
    let lyDo: MaLoiNgoai | undefined;
    let tokenUoc = uocTokenVao({ tinNhan }) + MAX_TOKENS_KIEM_DINH_MAC_DINH;
    let chiPhiUocUsd: number | null = null;
    let conLaiTranNgay: Awaited<ReturnType<typeof docConLaiNgay>> = { nhaMay: { token: null, usd: null }, nguoi: { token: null } };
    try {
      const k = await dep.kiemTruoc(yc);
      tokenUoc = uocTokenVao({ tinNhan }) + k.maxTokens;
      if (k.model.giaVaoUsdTrieu !== null && k.model.giaRaUsdTrieu !== null) {
        chiPhiUocUsd = (uocTokenVao({ tinNhan }) * k.model.giaVaoUsdTrieu + k.maxTokens * k.model.giaRaUsdTrieu) / 1e6;
      }
      conLaiTranNgay = await docConLaiNgay(k.db, c.F, ctx.user.id, k.cfg).catch(() => conLaiTranNgay);
    } catch (e) {
      if (!(e instanceof LoiNgoai)) throw e;
      duocPhep = false;
      lyDo = e.ma;
    }
    return {
      duocPhep,
      ...(lyDo ? { lyDo } : {}),
      mucDuLieu: c.nguon.muc,
      tokenUoc,
      chiPhiUocUsd,
      nhaCungCap: c.dich.nhaCungCap,
      model: c.dich.model,
      dinhKemBiCam: true as const,
      kichThuocByte,
      tranByte: TRAN_YEU_CAU_BYTE,
      conLaiTranNgay,
    };
  }),

  /** Chạy kiểm định (TRẢ PHÍ). Tự tính lại mọi thứ; không nhận gì từ `xemTruoc`. */
  chay: thuTuc.input(INPUT).mutation(async ({ ctx, input }) => {
    const bayGio = Date.now();
    donBoNho(bayGio);
    const khoa = khoaLap(ctx.user.id, input);
    const cu = boNho.get(khoa);
    if (cu?.trangThai === "dang-chay") throw loiNgoai("NGOAI_DANG_CHAY", "CONFLICT");
    if (cu?.trangThai === "xong") return { ...cu.kq, tuBoNho: true as const };
    boNho.set(khoa, { trangThai: "dang-chay" });
    try {
      const c = await nguonKiemDinhTrongPhamVi(ctx, input);
      const { kiemDinhNgoai } = await import("../services/ai/ngoai/kiemDinhNgoai");
      const kq = await kiemDinhNgoai(
        { dich: c.dich, cauHoi: c.nguon.cauHoi, traLoi: c.nguon.traLoi, ...(input.tieuChi ? { tieuChi: input.tieuChi } : {}), ngu: c.ngu },
        dep.goi,
      ).catch(maTuLoi);
      boNho.set(khoa, { trangThai: "xong", luc: Date.now(), kq });
      return kq;
    } catch (e) {
      boNho.delete(khoa);
      throw e;
    }
  }),
});
