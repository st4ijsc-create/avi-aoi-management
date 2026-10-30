/**
 * ★ Đợt 10.1 A1 — `aiChonModel.danhMuc`: danh mục model chọn được cho MỌI bề mặt (ô chọn của chat, lập trình, agent,
 * node Luồng). Không cần admin — chỉ cổng giấy phép MOD_AI; không trả tên tệp / đường dẫn / cổng (xem `chonModel/danhMuc.ts`).
 *
 * ★ Đợt 10.4b L0a' — `aiChonModel.thongTinNgoai {chonModel, beMat}`: THÔNG TIN cho hộp đồng ý (hợp đồng `shared/ai/sinhChuNgoai.ts`) —
 * KHÔNG giữ chỗ, KHÔNG gọi mạng; cùng bước (1)–(5) của cổng (`kiemTruocNgoai`) + cùng trần (`chotTranLuot` / `xemTranNgay`) như
 * `aiKiemDinh.xemTruoc`; quyền tối thiểu (dieu-phoi Q2b): số tuyệt đối của NHÀ MÁY chỉ cho admin.
 */
import { router, moduleProcedure } from "../_core/trpc";
import { phamViCua } from "./_phamViNguoiXem";
import { thongTinNgoaiInput, type MucDuLieuChung, type ThongTinNgoai, type TranVuot } from "../../shared/ai/sinhChuNgoai";

const protectedProcedure = moduleProcedure("MOD_AI");

/** Token ra ước cho thông tin (bề mặt sinh chữ — cùng mặc định kiểm định). */
export const MAX_TOKENS_THONG_TIN_NGOAI = 4000;

/** Mức máy chủ suy cho BỀ MẶT (kế hoạch 10.4b D2): chat = trợ lý VẬN HÀNH ⇒ câu người gõ `van-hanh`; màn lập trình ⇒ `ky-thuat`. */
export const MUC_THEO_BE_MAT: Readonly<Record<"chat" | "coding" | "agent", MucDuLieuChung>> = Object.freeze({ chat: "van-hanh", coding: "ky-thuat", agent: "ky-thuat" });

export const aiChonModelRouter = router({
  danhMuc: protectedProcedure.query(async ({ ctx }) => {
    const [{ layDanhMucModel, layPhuThuocDanhMucMacDinh }, { resolveTenantFactoryScope }] = await Promise.all([
      import("../services/ai/chonModel/danhMuc"),
      import("../db/reportAggregators"),
    ]);
    // Nhà máy người gọi (cho mục model NGOÀI — 10.3): nhà máy đầu của phạm vi; admin không gắn nhà máy ⇒ null ⇒ không có mục ngoài.
    const { factoryIds } = await resolveTenantFactoryScope(phamViCua(ctx));
    return layDanhMucModel(factoryIds?.[0] ?? null, await layPhuThuocDanhMucMacDinh());
  }),

  thongTinNgoai: protectedProcedure.input(thongTinNgoaiInput).query(async ({ ctx, input }): Promise<ThongTinNgoai> => {
    const [{ resolveTenantFactoryScope }, cong, tc, { LoiNgoai }, { ghepPhan }, { BE_MAT_NGOAI_DUOC_DUNG }, { layCauHinhNhaMay }] = await Promise.all([
      import("../db/reportAggregators"),
      import("../services/ai/ngoai/congNgoai"),
      import("../services/ai/ngoai/tranChiPhi"),
      import("../services/ai/ngoai/loi"),
      import("../services/ai/ngoai/ghepPhan"),
      import("../services/ai/chonModel/kieu"),
      import("../services/ai/ngoai/cauHinhNgoai"),
    ]);
    const [, nhaCungCap = "", ...m] = input.chonModel.split(":");
    const model = m.join(":");
    const muc = MUC_THEO_BE_MAT[input.beMat];
    const ra: ThongTinNgoai = {
      nhaCungCap,
      model,
      duocPhep: false,
      lyDo: "NGOAI_KHONG_TON_TAI",
      mucDuLieu: muc,
      choDuLieuVanHanh: false,
      conLaiTranNgay: { nguoi: { token: null }, nhaMay: { duTranChoLuotNay: false } },
      dinhKemBiCam: true,
    };
    // bề mặt chưa mở cho model ngoài ⇒ như không tồn tại (không lộ thêm gì)
    if (!BE_MAT_NGOAI_DUOC_DUNG.includes(input.beMat)) return ra;
    const { factoryIds } = await resolveTenantFactoryScope(phamViCua(ctx));
    if (!factoryIds || factoryIds.length !== 1) return ra; // đúng MỘT nhà máy (cùng luật kiểm định / chat ngoài)
    const F = factoryIds[0]!;
    const tin = ghepPhan([{ vaiTro: "user", phan: [{ loai: input.beMat === "chat" ? "cau-go-van-hanh" : "cau-go-lap-trinh", noiDung: "" }] }]).tinNhan;
    const yc = {
      dich: { nhaCungCap, model },
      tinNhan: tin,
      maxTokens: MAX_TOKENS_THONG_TIN_NGOAI,
      mucDich: input.beMat,
      ngu: {
        userId: ctx.user.id,
        flowId: null,
        runId: null,
        tuDong: false,
        nhaMayNguoiGoi: [F],
        nhaMayChuDuLieu: [F],
        nguonMuc: { loai: "be-mat" as const, beMat: input.beMat === "agent" ? ("agent-turn" as const) : input.beMat, phanDaGhep: [muc] },
      },
    };
    let tranVuot: TranVuot | undefined;
    let conLai: Awaited<ReturnType<typeof tc.docConLaiNgay>> = { nhaMay: { token: null, usd: null }, nguoi: { token: null } };
    try {
      const k = await cong.kiemTruocNgoai(yc);
      ra.choDuLieuVanHanh = k.cfg.choDuLieuVanHanh;
      const vao = tc.uocTokenVao({ model: k.model.model, tinNhan: tin, maxTokens: k.maxTokens, nhietDo: 0.2 });
      const raTok = tc.chotTranLuot(vao, k.maxTokens, k.tran.tranTokenLuot, null);
      const tien = k.model.giaVaoUsdTrieu !== null && k.model.giaRaUsdTrieu !== null ? (vao * k.model.giaVaoUsdTrieu + raTok * k.model.giaRaUsdTrieu) / 1e6 : null;
      conLai = await tc.docConLaiNgay(k.db, F, ctx.user.id, k.cfg).catch(() => conLai);
      const vuot = await tc.xemTranNgay(k.db, { factoryId: F, userId: ctx.user.id, flowId: null, runId: null, tokenUoc: vao + raTok, tienUocUsd: tien }, k.tran);
      if (vuot) {
        ra.lyDo = "NGOAI_VUOT_TRAN";
        tranVuot = vuot as TranVuot;
      } else {
        ra.duocPhep = true;
        delete ra.lyDo;
      }
    } catch (e) {
      if (!(e instanceof LoiNgoai)) throw e;
      ra.lyDo = e.ma;
      if (e.ma === "NGOAI_VUOT_TRAN" && e.chiTiet) tranVuot = e.chiTiet as TranVuot;
      // chính sách nhà máy vẫn đọc được để hộp đồng ý nói đúng (vd van-hanh chưa cho)
      const db = await cong.phuThuocMacDinh.db().catch(() => null);
      if (db) ra.choDuLieuVanHanh = (await layCauHinhNhaMay(db as never, F).catch(() => null))?.choDuLieuVanHanh === true;
    }
    const laAdmin = (ctx.user as { role?: string }).role === "admin";
    ra.conLaiTranNgay = { nguoi: conLai.nguoi, nhaMay: { duTranChoLuotNay: tranVuot !== "nha-may" && ra.lyDo !== "NGOAI_KHONG_TON_TAI", ...(laAdmin ? conLai.nhaMay : {}) } };
    return tranVuot ? { ...ra, tranVuot } : ra;
  }),
});
