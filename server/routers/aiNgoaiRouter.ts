/**
 * ★ Đợt 10.3 B3 — QUẢN TRỊ AI NGOÀI (`aiNgoai.*`): khoá theo nhà máy (tạo / xoay / thu hồi / danh sách). Chỉ admin, cổng giấy phép
 * MOD_AI, PHẠM VI NHÀ MÁY của người gọi (ngoài phạm vi ⇒ NOT_FOUND, không phân biệt với "không có"). Khoá KHÔNG BAO GIỜ trả về
 * (chỉ đuôi 4 ký tự khi khoá dài — `cuoi4AnToan`), không vào nhật ký; audit ghi người + giá trị CŨ / MỚI CÙNG GIAO DỊCH (audit lỗi ⇒
 * không đổi). Endpoint (tương thích OpenAI) kiểm TĨNH lúc lưu (`kiemEndpointLuu`). Chủ dự án tạo khoá ở màn quản trị — không qua
 * `.env`, không qua phiên Claude nào.
 */
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { appError } from "../_core/appError";
import { router, moduleGate } from "../_core/trpc";
import { adminProcedure as adminProcedureBase } from "./_shared";
import { aiApiKeys } from "../../drizzle/schema/ai";
import { aiFlowVersions, aiFlows } from "../../drizzle/schema/aiFlow";
import { aiNgoaiHostNoiBo, aiNgoaiModel, aiNgoaiNhaMay } from "../../drizzle/schema/aiNgoai";
import { nhaMayChoPhep } from "../services/flow/phamViLuong";
import { phamViCua } from "./_phamViNguoiXem";
import { encryptSecret } from "../services/security/secretBox";
import { NHA_CUNG_CAP_NGOAI } from "../services/ai/chonModel/kieu";
import { kiemEndpointLuu } from "../services/ai/ngoai/urlNgoai";
import { LoiNgoai } from "../services/ai/ngoai/loi";
import { auditTrongGiaoDich, cuoi4AnToan, cuoi4CuaBanMa, dbHoacLoi, khoaApiTrongPhamVi, khongCoKhoa, nhaMayNgoaiTrongPhamVi } from "./_aiNgoaiPhamVi";

const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
const KHOA_DANG = z.string().min(8).max(4096);

/** `host:cổng` nội bộ đã khai của nhà máy (cho kiểm endpoint lúc lưu). */
async function hostNoiBoCua(db: Awaited<ReturnType<typeof dbHoacLoi>>, factoryId: number): Promise<Set<string>> {
  const r = (await db.execute(sql`SELECT "hostCong" FROM ai_ngoai_host_noi_bo WHERE "factoryId" = ${factoryId}`)) as unknown as Array<{ hostCong: string }>;
  return new Set((Array.isArray(r) ? r : []).map((x) => x.hostCong));
}

/** Admin TOÀN HỆ (phạm vi "tất cả") — chỉ họ khai host nội bộ (rà kiem-dinh mục 9). */
async function laAdminToanHe(ctx: Parameters<typeof phamViCua>[0]): Promise<boolean> {
  return (await nhaMayChoPhep(phamViCua(ctx))) === null;
}

const CAU_HINH = z.object({
  factoryId: z.number().int().positive(),
  batNgoai: z.boolean(),
  choDuLieuVanHanh: z.boolean(),
  luuNguyenVan: z.boolean(),
  hanGiuNgay: z.number().int().min(1).max(365),
  tranTokenNgay: z.number().int().positive().nullable(),
  tranTienNgayUsd: z.number().positive().nullable(),
  tranTokenNguoiNgay: z.number().int().positive().nullable(),
  tranTokenLuongNgay: z.number().int().positive().nullable(),
  tranTokenLuot: z.number().int().positive().nullable(),
  tranLanPhut: z.number().int().min(1).max(600),
});

function loiUrl(e: unknown): never {
  if (e instanceof LoiNgoai) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "aiNgoaiEndpoint", reason: e.chiTiet ?? e.ma }, "endpoint không hợp lệ");
  throw e;
}

export const aiNgoaiRouter = router({
  /** Tạo khoá cho MỘT nhà máy trong phạm vi. Trả `{ id, cuoi4 }` — không bao giờ trả khoá. */
  taoKhoa: adminProcedure
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        nhaCungCap: z.enum(NHA_CUNG_CAP_NGOAI),
        ten: z.string().min(1).max(255),
        khoa: KHOA_DANG,
        endpoint: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
      const db = await dbHoacLoi();
      let endpoint: string | null = null;
      if (input.nhaCungCap === "openai_compat") {
        if (!input.endpoint) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "aiNgoaiEndpoint", reason: "thieu-endpoint" }, "cần endpoint");
        try {
          endpoint = kiemEndpointLuu(input.endpoint, await hostNoiBoCua(db, input.factoryId));
        } catch (e) {
          loiUrl(e);
        }
      }
      const ma = encryptSecret(input.khoa);
      if (!ma) throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "encryptApiKey" }, "encrypt failed");
      const c4 = cuoi4AnToan(input.khoa);
      const id = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(aiApiKeys)
          .values({ name: input.ten, provider: input.nhaCungCap, encryptedKey: ma, endpoint, status: "active", createdBy: ctx.user.id, factoryId: input.factoryId })
          .returning({ id: aiApiKeys.id });
        await auditTrongGiaoDich(tx, ctx, {
          action: "create",
          entityType: "ai_ngoai_khoa",
          entityId: r!.id,
          entityName: input.ten,
          details: { operation: "CREATE", after: { factoryId: input.factoryId, nhaCungCap: input.nhaCungCap, cuoi4: c4, doDai: input.khoa.length, endpoint, status: "active" } },
          status: "success",
        });
        return r!.id;
      });
      return { id, cuoi4: c4 };
    }),

  /** Xoay khoá: thay bản mã; lượt kế (kể cả lần thử lại đang dở) đọc khoá MỚI (thunk đọc tươi). Không đổi trạng thái. */
  xoayKhoa: adminProcedure.input(z.object({ id: z.number().int().positive(), khoa: KHOA_DANG })).mutation(async ({ ctx, input }) => {
    const { db, k } = await khoaApiTrongPhamVi(ctx, input.id);
    if (k.factoryId === null) throw khongCoKhoa();
    const ma = encryptSecret(input.khoa);
    if (!ma) throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "encryptApiKey" }, "encrypt failed");
    const c4 = cuoi4AnToan(input.khoa);
    await db.transaction(async (tx) => {
      await tx.update(aiApiKeys).set({ encryptedKey: ma, updatedAt: new Date() }).where(eq(aiApiKeys.id, input.id));
      await auditTrongGiaoDich(tx, ctx, {
        action: "update",
        entityType: "ai_ngoai_khoa",
        entityId: input.id,
        entityName: k.name,
        details: { operation: "XOAY", before: { cuoi4: cuoi4CuaBanMa(k.encryptedKey), status: k.status }, after: { cuoi4: c4, doDai: input.khoa.length, status: k.status } },
        status: "success",
      });
    });
    return { id: input.id, cuoi4: c4 };
  }),

  /** Thu hồi (inactive) — lượt kế bị từ chối `NGOAI_KHOA_KHONG_HOP_LE`. Không xoá (model ngoài còn trỏ tới — FK RESTRICT). */
  thuHoiKhoa: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { db, k } = await khoaApiTrongPhamVi(ctx, input.id);
    if (k.factoryId === null) throw khongCoKhoa();
    await db.transaction(async (tx) => {
      await tx.update(aiApiKeys).set({ status: "inactive", updatedAt: new Date() }).where(eq(aiApiKeys.id, input.id));
      await auditTrongGiaoDich(tx, ctx, {
        action: "update",
        entityType: "ai_ngoai_khoa",
        entityId: input.id,
        entityName: k.name,
        details: { operation: "THU_HOI", before: { status: k.status }, after: { status: "inactive" } },
        status: "success",
      });
    });
    return { id: input.id, status: "inactive" as const };
  }),

  /** Danh sách khoá của MỘT nhà máy trong phạm vi — chỉ đuôi an toàn. */
  dsKhoa: adminProcedure.input(z.object({ factoryId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
    const db = await dbHoacLoi();
    const ds = await db.select().from(aiApiKeys).where(eq(aiApiKeys.factoryId, input.factoryId)).orderBy(desc(aiApiKeys.createdAt));
    return ds.map((k) => ({ id: k.id, ten: k.name, nhaCungCap: k.provider, status: k.status, cuoi4: cuoi4CuaBanMa(k.encryptedKey), capNhatLuc: k.updatedAt }));
  }),

  // ═══════════════ Cấu hình nhà máy (Task 8) ═══════════════

  /** Cấu hình AI ngoài của nhà máy (vắng ⇒ mặc định TẮT hết). */
  cauHinh: adminProcedure.input(z.object({ factoryId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
    const db = await dbHoacLoi();
    const [r] = await db.select().from(aiNgoaiNhaMay).where(eq(aiNgoaiNhaMay.factoryId, input.factoryId));
    return r ?? null;
  }),

  /** Ghi cấu hình — audit cũ / mới CÙNG giao dịch. */
  ghiCauHinh: adminProcedure.input(CAU_HINH).mutation(async ({ ctx, input }) => {
    if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
    const db = await dbHoacLoi();
    const moi = { ...input, tranTienNgayUsd: input.tranTienNgayUsd === null ? null : String(input.tranTienNgayUsd), capNhatBoi: ctx.user.id, capNhatLuc: new Date() };
    await db.transaction(async (tx) => {
      const [cu] = await tx.select().from(aiNgoaiNhaMay).where(eq(aiNgoaiNhaMay.factoryId, input.factoryId));
      await tx.insert(aiNgoaiNhaMay).values(moi).onConflictDoUpdate({ target: aiNgoaiNhaMay.factoryId, set: moi });
      await auditTrongGiaoDich(tx, ctx, {
        action: "update",
        entityType: "ai_ngoai_cau_hinh",
        entityId: input.factoryId,
        // Rà kiem-dinh Task 8 D — MỞ cửa (tắt → bật) batNgoai / choDuLieuVanHanh / luuNguyenVan ⇒ mức CAO để soát.
        details: { operation: "CAU_HINH", before: cu ?? {}, after: input, metadata: { muc: (["batNgoai", "choDuLieuVanHanh", "luuNguyenVan"] as const).some((k) => input[k] && !cu?.[k]) ? "cao" : "thuong" } },
        status: "success",
      });
    });
    return { ok: true as const };
  }),

  /** Danh mục model ngoài của nhà máy. */
  dsModel: adminProcedure.input(z.object({ factoryId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
    const db = await dbHoacLoi();
    return db.select().from(aiNgoaiModel).where(eq(aiNgoaiModel.factoryId, input.factoryId)).orderBy(aiNgoaiModel.nhaCungCap, aiNgoaiModel.model);
  }),

  /** Thêm / sửa model ngoài. Khoá phải CÙNG nhà máy + CÙNG nhà cung cấp (rà Task 7 F5). Model không giá ⇒ bắt buộc trần lượt (CHECK). */
  datModel: adminProcedure
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        nhaCungCap: z.enum(NHA_CUNG_CAP_NGOAI),
        model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/),
        nhan: z.string().min(1).max(120),
        keyId: z.number().int().positive(),
        giaVaoUsdTrieu: z.number().nonnegative().nullable(),
        giaRaUsdTrieu: z.number().nonnegative().nullable(),
        tranTokenLuot: z.number().int().positive().nullable(),
        batModel: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
      const { db, k } = await khoaApiTrongPhamVi(ctx, input.keyId);
      if (k.factoryId !== input.factoryId || k.provider !== input.nhaCungCap) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "aiNgoaiDatModel", reason: "khoa-khac-nha-may-hoac-nha-cung-cap" }, "khoá không thuộc nhà máy / nhà cung cấp này");
      }
      if ((input.giaVaoUsdTrieu === null || input.giaRaUsdTrieu === null) && input.tranTokenLuot === null) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "aiNgoaiDatModel", reason: "can-gia-hoac-tran-luot" }, "model không giá phải có trần token mỗi lượt");
      }
      const moi = {
        ...input,
        giaVaoUsdTrieu: input.giaVaoUsdTrieu === null ? null : String(input.giaVaoUsdTrieu),
        giaRaUsdTrieu: input.giaRaUsdTrieu === null ? null : String(input.giaRaUsdTrieu),
        capNhatBoi: ctx.user.id,
        capNhatLuc: new Date(),
      };
      await db.transaction(async (tx) => {
        const [cu] = await tx
          .select()
          .from(aiNgoaiModel)
          .where(and(eq(aiNgoaiModel.factoryId, input.factoryId), eq(aiNgoaiModel.nhaCungCap, input.nhaCungCap), eq(aiNgoaiModel.model, input.model)));
        await tx.insert(aiNgoaiModel).values(moi).onConflictDoUpdate({ target: [aiNgoaiModel.factoryId, aiNgoaiModel.nhaCungCap, aiNgoaiModel.model], set: moi });
        await auditTrongGiaoDich(tx, ctx, {
          action: "update",
          entityType: "ai_ngoai_model",
          entityId: input.factoryId,
          entityName: `${input.nhaCungCap}:${input.model}`,
          details: { operation: "DAT_MODEL", before: cu ?? {}, after: input },
          status: "success",
        });
      });
      return { ok: true as const };
    }),

  /** Host nội bộ (endpoint tương thích) — CHỈ admin TOÀN HỆ ghi (rà kiem-dinh mục 9). */
  dsHostNoiBo: adminProcedure.input(z.object({ factoryId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
    const db = await dbHoacLoi();
    return db.select().from(aiNgoaiHostNoiBo).where(eq(aiNgoaiHostNoiBo.factoryId, input.factoryId));
  }),
  datHostNoiBo: adminProcedure
    .input(z.object({ factoryId: z.number().int().positive(), hostCong: z.string().regex(/^[A-Za-z0-9.-]{1,253}:[0-9]{1,5}$/), xoa: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await laAdminToanHe(ctx))) throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "aiNgoaiHostNoiBo", reason: "chi-admin-toan-he" }, "Chỉ quản trị viên toàn hệ khai host nội bộ.");
      if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
      const db = await dbHoacLoi();
      const hostCong = input.hostCong.toLowerCase().replace(/\.(?=:)/, "");
      await db.transaction(async (tx) => {
        if (input.xoa) await tx.delete(aiNgoaiHostNoiBo).where(and(eq(aiNgoaiHostNoiBo.factoryId, input.factoryId), eq(aiNgoaiHostNoiBo.hostCong, hostCong)));
        else await tx.insert(aiNgoaiHostNoiBo).values({ factoryId: input.factoryId, hostCong, taoBoi: ctx.user.id }).onConflictDoNothing();
        await auditTrongGiaoDich(tx, ctx, {
          action: input.xoa ? "delete" : "create",
          entityType: "ai_ngoai_host_noi_bo",
          entityId: input.factoryId,
          entityName: hostCong,
          details: { operation: input.xoa ? "XOA_HOST" : "THEM_HOST", after: { hostCong, xoa: input.xoa === true } },
          status: "success",
        });
      });
      return { ok: true as const, hostCong };
    }),

  /** Nội dung ĐÃ CHE của một lời gọi (chỉ khi nhà máy bật lưu) — phạm vi nhà máy của hàng + audit MỖI lần xem. */
  xemNoiDung: adminProcedure.input(z.object({ callId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await dbHoacLoi();
    const r = (await db.execute(sql`SELECT "factoryId", "noiDungDaChe", "hetHanLuc" FROM ai_external_call_noi_dung WHERE "callId" = ${input.callId}`)) as unknown as Array<{
      factoryId: number;
      noiDungDaChe: string;
      hetHanLuc: string;
    }>;
    const h = Array.isArray(r) ? r[0] : undefined;
    if (!h || !(await nhaMayNgoaiTrongPhamVi(ctx, Number(h.factoryId)))) throw khongCoKhoa();
    await db.transaction(async (tx) => {
      await auditTrongGiaoDich(tx, ctx, { action: "read", entityType: "ai_external_call_noi_dung", entityId: input.callId, details: { operation: "XEM_NOI_DUNG" }, status: "success" });
    });
    return { callId: input.callId, noiDungDaChe: h.noiDungDaChe, hetHanLuc: h.hetHanLuc };
  }),

  /**
   * DUYỆT NGOÀI một phiên bản luồng (rà kiem-dinh mục 7): ghi người duyệt + băm định nghĩa ĐẦY ĐỦ. Người duyệt ≠ người tạo phiên bản;
   * admin TỰ duyệt được nhưng ghi `ngoaiTuDuyet` + audit mức CAO, và BỊ CẤM khi luồng có node dữ liệu vận hành (mức tĩnh).
   */
  duyetNgoai: adminProcedure.input(z.object({ flowId: z.string().min(1).max(64), version: z.number().int().min(1) })).mutation(async ({ ctx, input }) => {
    const db = await dbHoacLoi();
    const [f] = await db.select({ factoryId: aiFlows.factoryId }).from(aiFlows).where(eq(aiFlows.id, input.flowId));
    if (!f || !(await nhaMayNgoaiTrongPhamVi(ctx, f.factoryId))) throw khongCoKhoa();
    const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, input.version)));
    if (!v) throw khongCoKhoa();
    const [{ coNodeNgoai, bamDinhNghia }, { mucTinhCuaDinhNghia }] = await Promise.all([import("../services/ai/ngoai/duyetNgoai"), import("../services/ai/ngoai/phanLoai")]);
    const def = v.definition as never;
    if (!coNodeNgoai(def)) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "aiNgoaiDuyet", reason: "khong-co-node-ngoai" }, "Phiên bản không dùng model ngoài.");
    const bam = bamDinhNghia(def);
    // Rà kiem-dinh Task 8 C — đã duyệt + băm còn khớp ⇒ KHÔNG ghi đè người duyệt / thời điểm / cờ tự duyệt (trả trạng thái hiện có).
    if (v.ngoaiDuyetLuc && v.ngoaiBamDuyet === bam) return { ok: true as const, tuDuyet: v.ngoaiTuDuyet, bam, daDuyetTruoc: true };
    const tuDuyet = v.createdBy === ctx.user.id;
    if (tuDuyet) {
      const muc = await mucTinhCuaDinhNghia(def, async (fid, ver) => {
        const [c] = await db.select({ d: aiFlowVersions.definition }).from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, fid), eq(aiFlowVersions.version, ver)));
        return (c?.d as never) ?? null;
      });
      if (muc === "van-hanh") throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "aiNgoaiDuyet", reason: "NGOAI_TU_DUYET_VAN_HANH" }, "Không tự duyệt luồng có dữ liệu vận hành gửi AI ngoài.");
    }
    const ghi = await db.transaction(async (tx) => {
      // Điều kiện trong CÙNG câu UPDATE: hai người duyệt đồng thời ⇒ người sau không ghi đè (0 dòng ⇒ không audit).
      const doi = await tx
        .update(aiFlowVersions)
        .set({ coNodeNgoai: true, ngoaiDuyetBoi: ctx.user.id, ngoaiDuyetLuc: new Date(), ngoaiTuDuyet: tuDuyet, ngoaiBamDuyet: bam })
        .where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, input.version), sql`("ngoaiDuyetLuc" IS NULL OR "ngoaiBamDuyet" IS DISTINCT FROM ${bam})`))
        .returning({ v: aiFlowVersions.version });
      if (!doi.length) return false;
      await auditTrongGiaoDich(tx, ctx, {
        action: "approve",
        entityType: "ai_flow_duyet_ngoai",
        entityName: `${input.flowId}@${input.version}`,
        details: { operation: tuDuyet ? "TU_DUYET_NGOAI" : "DUYET_NGOAI", metadata: { muc: tuDuyet ? "cao" : "thuong", bam, factoryId: f.factoryId } },
        status: "success",
      });
      return true;
    });
    return { ok: true as const, tuDuyet, bam, daDuyetTruoc: !ghi };
  }),
});
