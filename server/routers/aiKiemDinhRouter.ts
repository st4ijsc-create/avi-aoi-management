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

/** Độ dài trích câu trả lời nguồn trong `xemTruoc`. */
export const TRAN_TRICH_TRA_LOI = 200;

export const aiKiemDinhRouter = router({
  /** THÔNG TIN trước khi gửi (không mạng, không giữ chỗ). `duocPhep` chỉ tham khảo — `chay` tự kiểm lại. */
  xemTruoc: thuTuc.input(INPUT).query(async ({ ctx, input }) => {
    const c = await nguonKiemDinhTrongPhamVi(ctx, input);
    const [{ lapTinNhanKiemDinh, MAX_TOKENS_KIEM_DINH_MAC_DINH }, { uocTokenVao, docConLaiNgay, chotTranLuot, xemTranNgay, raToiThieuCho }, { TRAN_YEU_CAU_BYTE }, { LoiNgoai }, { cheChuoi }] = await Promise.all([
      import("../services/ai/ngoai/kiemDinhNgoai"),
      import("../services/ai/ngoai/tranChiPhi"),
      import("../services/ai/ngoai/congNgoai"),
      import("../services/ai/ngoai/loi"),
      import("../services/ai/ngoai/cheDuLieu"),
    ]);
    const tinNhan = lapTinNhanKiemDinh({ cauHoi: c.nguon.cauHoi, traLoi: c.nguon.traLoi, ngu: c.ngu, ...(input.tieuChi ? { tieuChi: input.tieuChi } : {}) });
    const yc: YeuCauGoiNgoai = { dich: c.dich, tinNhan, maxTokens: MAX_TOKENS_KIEM_DINH_MAC_DINH, mucDich: "kiem-dinh", ngu: c.ngu };
    const kichThuocByte = Buffer.byteLength(JSON.stringify({ t: tinNhan, c: [] }), "utf8");
    let duocPhep = true;
    let lyDo: MaLoiNgoai | undefined;
    /** Trần nào bị vượt (cho UI nói đúng): mỗi lượt / ngày nhà máy / ngày người / số lần phút. */
    let tranVuot: string | undefined;
    let tokenUoc = uocTokenVao({ tinNhan }) + MAX_TOKENS_KIEM_DINH_MAC_DINH;
    let chiPhiUocUsd: number | null = null;
    let conLai: Awaited<ReturnType<typeof docConLaiNgay>> = { nhaMay: { token: null, usd: null }, nguoi: { token: null } };
    try {
      // ★ 10.4 (luong-ui / dieu-phoi) — CÙNG mọi trần mà `chay` (cổng) tính, bằng CÙNG hàm: bước (1)–(5) (`kiemTruocNgoai`), trần MỖI
      //   LƯỢT co maxTokens (`chotTranLuot`), trần NGÀY nhà máy / người + số lần / phút (`xemTranNgay` — cùng khoá với `datTruoc`).
      const k = await dep.kiemTruoc(yc);
      const vao = uocTokenVao({ model: k.model.model, tinNhan, maxTokens: k.maxTokens, nhietDo: 0.2 }); // cùng hình dạng cổng ước
      const ra = chotTranLuot(vao, k.maxTokens, k.tran.tranTokenLuot, null, raToiThieuCho(yc.mucDich));
      tokenUoc = vao + ra;
      if (k.model.giaVaoUsdTrieu !== null && k.model.giaRaUsdTrieu !== null) chiPhiUocUsd = (vao * k.model.giaVaoUsdTrieu + ra * k.model.giaRaUsdTrieu) / 1e6;
      conLai = await docConLaiNgay(k.db, c.F, ctx.user.id, k.cfg).catch(() => conLai);
      const vuot = await xemTranNgay(k.db, { factoryId: c.F, userId: ctx.user.id, flowId: null, runId: null, tokenUoc, tienUocUsd: chiPhiUocUsd }, k.tran);
      if (vuot) {
        duocPhep = false;
        lyDo = "NGOAI_VUOT_TRAN";
        tranVuot = vuot;
      }
    } catch (e) {
      if (!(e instanceof LoiNgoai)) throw e;
      duocPhep = false;
      lyDo = e.ma;
      if (e.ma === "NGOAI_VUOT_TRAN" && e.chiTiet) tranVuot = e.chiTiet;
    }
    // dieu-phoi Q2 (quyền tối thiểu): người KHÔNG phải admin chỉ thấy phần CỦA MÌNH + cờ "nhà máy đủ trần cho ước tính bi quan của lượt
    // này"; số tuyệt đối token / USD của NHÀ MÁY chỉ trả cho admin (đã trong phạm vi nhà máy — quy tắc đúng MỘT nhà máy).
    const nhaMayDuChoLuotNay = tranVuot !== "nha-may";
    const laAdmin = (ctx.user as { role?: string }).role === "admin";
    // Hình dạng chốt với luong-ui (T4b): `nhaMay.duTranChoLuotNay` luôn có; `nhaMay.token` / `nhaMay.usd` CHỈ khi admin (vắng ⇒ client không hiện số).
    const conLaiTranNgay = { nguoi: conLai.nguoi, nhaMay: { duTranChoLuotNay: nhaMayDuChoLuotNay, ...(laAdmin ? conLai.nhaMay : {}) } };
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
      ...(tranVuot ? { tranVuot } : {}),
      // ★ 10.4 (rà client luong-ui) — người dùng thấy ĐÚNG câu trả lời nào sẽ gửi đi: trích ĐÃ CHE (che CẢ chuỗi rồi mới cắt — cắt trước
      //   có thể chẻ đôi một bí mật để nửa đầu lọt qua bộ che) + độ dài gốc.
      trichTraLoi: String(cheChuoi(c.nguon.traLoi).giaTri).slice(0, TRAN_TRICH_TRA_LOI),
      doDaiTraLoi: c.nguon.traLoi.length,
    };
  }),

  /** Chạy kiểm định (TRẢ PHÍ). Tự tính lại mọi thứ; không nhận gì từ `xemTruoc`. */
  chay: thuTuc.input(INPUT).mutation(async ({ ctx, input }) => {
    // Rà kiem-dinh T1: phạm vi (chủ lượt + đúng MỘT nhà máy — chỉ đọc CSDL, không mạng) kiểm TRƯỚC khi trả bộ nhớ ⇒ người vừa rời nhà máy /
    // lượt vừa bị xoá trong 120 s không nhận lại kết quả cũ. Cờ / model của nhà máy: `kiemTruocNgoai` (không mạng) cũng chạy trước bộ nhớ.
    const c = await nguonKiemDinhTrongPhamVi(ctx, input);
    const bayGio = Date.now();
    donBoNho(bayGio);
    const khoa = khoaLap(ctx.user.id, input);
    const cu = boNho.get(khoa);
    if (cu?.trangThai === "dang-chay") throw loiNgoai("NGOAI_DANG_CHAY", "CONFLICT");
    if (cu?.trangThai === "xong") {
      await dep.kiemTruoc({ dich: c.dich, tinNhan: [], maxTokens: 1, mucDich: "kiem-dinh", ngu: c.ngu }).catch(maTuLoi);
      return { ...cu.kq, tuBoNho: true as const };
    }
    boNho.set(khoa, { trangThai: "dang-chay" });
    try {
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
