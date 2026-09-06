/**
 * server/routers/twinCanhRouter.ts — Đợt 3: ĐƯỜNG GHI của "dựng nhà xưởng" (§10A).
 *
 * Namespace `twinCanh`. Phục vụ CẢ HAI con đường của §10A — chúng ghi vào CÙNG
 * `twin_toa_nha` / `twin_tang` / `twin_vat_the`, nên nhập CAD xong vẫn sửa tay
 * được và ngược lại:
 *   • Con đường B (§10A.2) — form 3 bước: `luuToaNha` + `luuTang` + `dungNhaXuong`.
 *   • Con đường A (§10A.1) — nhập bản vẽ: cùng hai procedure trên, thêm
 *     `donViNguon`/`modelVoId` để mở lại được hộp thoại hiệu chỉnh.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ QUYỀN (§6.4) — `settings_factory` **HOẶC** `machine_control`
 * ════════════════════════════════════════════════════════════════════════════
 * Dùng `requireAnyPermission` (đã có sẵn từ Lô 6/BG-132) chứ KHÔNG gọi
 * `requirePermission` hai lần — hai middleware nối tiếp là phép AND, tức là
 * NGƯỢC hẳn ý §6.4 và sẽ chặn đúng những người mà spec muốn cho vào.
 *
 * ⚠⚠ **BÀI HỌC KHỐI D — "một lối vào rồi TỪ CHỐI".** Mục nav `/twin-studio`
 * trong `client/src/lib/navigation.tsx:418` khai `requiredPermission:
 * "settings_factory"`, và `RouteGuard navHref="/twin-studio"` TRA CHÍNH mục nav
 * đó nên hai bên không thể lệch. Router này mở RỘNG HƠN (thêm `machine_control`)
 * — mở rộng ở đường GHI trong khi đường VÀO hẹp hơn là an toàn theo hướng đúng:
 * không ai thấy mục menu rồi bị chặn. Chiều ngược lại (router hẹp hơn nav) mới
 * là lớp lỗi Khối D, và ở đây KHÔNG xảy ra.
 *
 * ⚠⚠ **admin BYPASS `requirePermission`** (`accessControl.ts:207` — `if (isAdmin
 * && !scopedAdminEnabled()) return true`). Nên MỌI phép đo quyền cho router này
 * phải chạy bằng tài khoản KHÔNG phải admin; đo bằng admin chứng minh số 0.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐƠN VỊ — vào bằng MILIMÉT, không bằng mét
 * ════════════════════════════════════════════════════════════════════════════
 * Quy đổi mét → mm xảy ra ở CLIENT, trong `boCucTang.ts` (dùng
 * `heToaDo.metSangMm`). API chỉ nói một thứ tiếng. Nếu API nhận cả hai đơn vị
 * thì sẽ có ngày một client gửi mét vào ô mm và không gì phát hiện được — nhà
 * xưởng nhỏ đi 1000 lần, đúng lớp lỗi §10A.1.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { requireAnyPermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import { phamViCua } from "./_phamViNguoiXem";
import {
  demVatTheTheoTang,
  ganAnhNenTang,
  ghiDeTuongBaoSinh,
  luuTang,
  luuToaNha,
  traToaNhaKemTang,
  traToaNhaTheoNhaMay,
  xoaTang,
  xoaToaNha,
} from "../db/twinCanh";

/**
 * §6.4 — cặp quyền chấp nhận được cho màn Thiết kế, theo từng hành động.
 * Tách thành hằng để `canView`/`canEdit`/`canCreate` không bị chép lệch giữa các
 * procedure (một chỗ sửa, không phải mười).
 */
function quyenThietKe(hanhDong: "canView" | "canCreate" | "canEdit" | "canDelete") {
  return requireAnyPermission([
    { module: "settings_factory", action: hanhDong },
    { module: "machine_control", action: hanhDong },
  ]);
}

/**
 * Giới hạn mm cho một cạnh: 1 mm tới 10 km.
 *
 * ⚠ Trần 10 km KHÔNG phải số tuỳ tiện — `numeric(14,3)` biểu diễn tới 10^11 mm,
 * nhưng một cạnh dài hơn 10 km chắc chắn là NHẬP SAI ĐƠN VỊ chứ không phải một
 * nhà xưởng. Đây là cùng cửa chặn mà §10A.0 dựng cho `floorWidthM = 1500`: đọc
 * đúng đơn vị là 1,5 km, và số đó lọt vào DB vì không ai đặt trần.
 */
const canhMm = z.number().finite().positive().max(10_000_000);

/** Cao độ có thể ÂM (tầng hầm) — nên không dùng `positive()`. */
const caoDoMm = z.number().finite().min(-1_000_000).max(10_000_000);

export const twinCanhRouter = router({
  // -------------------------------------------------------------------------
  // Đọc
  // -------------------------------------------------------------------------

  /** Danh sách toà nhà của một nhà máy. Ngoài phạm vi ⇒ mảng RỖNG. */
  danhSachToaNha: protectedProcedure
    .use(quyenThietKe("canView"))
    .input(z.object({ factoryId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return traToaNhaTheoNhaMay(input.factoryId, phamViCua(ctx));
    }),

  /** Một toà nhà kèm các tầng, numeric đã quy về number. */
  chiTietToaNha: protectedProcedure
    .use(quyenThietKe("canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return traToaNhaKemTang(input.id, phamViCua(ctx));
    }),

  // -------------------------------------------------------------------------
  // Toà nhà
  // -------------------------------------------------------------------------

  /**
   * Tạo/sửa một toà nhà. `id` có = sửa, không có = tạo.
   *
   * ★ `nguon` mặc định 'tay' ở tầng db: đây là số NGƯỜI GÕ trong form §10A.2.
   *   Đường sinh tự động (Đợt 4) phải truyền 'sinh' tường minh để badge vàng
   *   "chưa đo" hiện đúng (NT-4).
   */
  luuToaNha: protectedProcedure
    .use(quyenThietKe("canEdit"))
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        factoryId: z.number().int().positive(),
        ma: z.string().trim().min(1).max(64),
        ten: z.string().trim().min(1).max(255),
        rongMm: canhMm,
        sauMm: canhMm,
        caoMm: canhMm,
        viTriXMm: z.number().finite().optional(),
        viTriYMm: z.number().finite().optional(),
        viTriZMm: z.number().finite().optional(),
        /** §10A.4 — vỏ nhà nhập từ bản vẽ (con đường A). */
        modelVoId: z.number().int().positive().nullable().optional(),
        /** §10A.4 — đơn vị file gốc, để mở lại hộp thoại hiệu chỉnh. */
        donViNguon: z.enum(["mm", "cm", "m", "inch"]).nullable().optional(),
        nguon: z.enum(["sinh", "tay"]).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ket = await luuToaNha(input, phamViCua(ctx));
      if (!ket) {
        // Ngoài phạm vi và không-tồn-tại trả CÙNG một lỗi: một câu riêng cho ca
        // "có thật nhưng của tenant khác" là một oracle rò rỉ tồn-tại.
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinToaNha" },
          `Toà nhà không tồn tại hoặc ngoài phạm vi (factoryId=${input.factoryId})`,
        );
      }
      return ket;
    }),

  /**
   * Xoá MỀM một toà nhà. Xem `db/twinCanh.xoaToaNha` về lý do không xoá cứng
   * (CASCADE sẽ kéo theo mọi vị trí máy người dùng đã đặt tay).
   */
  xoaToaNha: protectedProcedure
    .use(quyenThietKe("canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const ket = await xoaToaNha(input.id, phamViCua(ctx));
      if (!ket) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinToaNha" },
          `Toà nhà id=${input.id} không tồn tại hoặc ngoài phạm vi`,
        );
      }
      return ket;
    }),

  // -------------------------------------------------------------------------
  // Tầng
  // -------------------------------------------------------------------------

  /**
   * Tạo/sửa một tầng.
   *
   * ⚠ `daiMm`/`rongMm` nhận `null` TƯỜNG MINH = "chưa ai đo mặt sàn này", và
   *   cảnh 3D lấy kích thước từ toà nhà cha. Đây KHÁC với việc không truyền
   *   trường — nên schema dùng `.nullable().optional()` chứ không chỉ optional.
   */
  luuTang: protectedProcedure
    .use(quyenThietKe("canEdit"))
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        toaNhaId: z.number().int().positive(),
        // capSo ÂM = hầm; 0 bị CẤM (nhập nhằng "tầng trệt" vs "chưa đặt", 0350).
        capSo: z.number().int().min(-20).max(200).refine((n) => n !== 0, {
          message: "capSo khong duoc bang 0",
        }),
        ten: z.string().trim().min(1).max(255),
        caoDoMm,
        caoThongThuyMm: canhMm,
        daiMm: canhMm.nullable().optional(),
        rongMm: canhMm.nullable().optional(),
        nguonHinhHoc: z.enum(["nhap_tay", "ban_ve", "sinh"]).optional(),
        nguon: z.enum(["sinh", "tay"]).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ket = await luuTang(input, phamViCua(ctx));
      if (!ket) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinTang" },
          `Tầng hoặc toà nhà id=${input.toaNhaId} không tồn tại hoặc ngoài phạm vi`,
        );
      }
      return ket;
    }),

  /** Xoá MỀM một tầng. */
  xoaTang: protectedProcedure
    .use(quyenThietKe("canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const ket = await xoaTang(input.id, phamViCua(ctx));
      if (!ket) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinTang" },
          `Tầng id=${input.id} không tồn tại hoặc ngoài phạm vi`,
        );
      }
      return ket;
    }),

  /**
   * Tải ảnh nền mặt bằng cho một tầng.
   *
   * ★ `daHieuChuan` KHÔNG được đặt true ở đây. Tải ảnh lên chỉ cho ta pixel;
   *   `tiLeMmMoiPx` chỉ đáng tin sau khi ai đó click hai điểm và nhập khoảng
   *   cách thật (công cụ "Đặt tỉ lệ", §7.4). Một ảnh nền chưa hiệu chuẩn mà UI
   *   vẽ như đã hiệu chuẩn là đúng lớp lỗi NT-3 — có số, không có xuất xứ.
   */
  taiAnhNen: protectedProcedure
    .use(quyenThietKe("canCreate"))
    .input(
      z.object({
        tangId: z.number().int().positive(),
        /** data-URL hoặc base64 thuần. */
        anhBase64: z.string().min(1),
        mimeType: z.string().max(100).optional(),
        /** Chỉ truyền khi ĐÃ hiệu chuẩn bằng công cụ Đặt tỉ lệ. */
        tiLeMmMoiPx: z.number().finite().positive().optional(),
        daHieuChuan: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      let mime = input.mimeType || "image/png";
      let payload = input.anhBase64.trim();
      const dataUrl = payload.match(/^data:([^;]+);base64,(.+)$/);
      if (dataUrl) {
        mime = dataUrl[1];
        payload = dataUrl[2];
      }
      if (!/^image\/(png|jpeg|jpg|webp)$/i.test(mime)) {
        throw appError(
          "BAD_REQUEST",
          "INVALID_VALUE",
          { field: "mimeType" },
          `Định dạng ảnh nền không nhận: ${mime}`,
        );
      }

      let url: string;
      let key: string | undefined;
      try {
        const buffer = Buffer.from(payload, "base64");
        const ext = mime.split("/")[1].replace("jpeg", "jpg");
        const fileKey = `twin-tang/${input.tangId}/nen-${Date.now()}-${nanoid(6)}.${ext}`;
        const daTai = await storagePut(fileKey, buffer, mime);
        url = daTai.url;
        key = daTai.key;
      } catch {
        // `Buffer.from` không ném với base64 hỏng (nó bỏ ký tự lạ); nguồn ném
        // thật còn lại là `storagePut` — đĩa đầy / S3 chết. Nên OPERATION_FAILED
        // (đi xem tầng lưu trữ) chứ không INVALID_VALUE (đi soi tấm ảnh).
        throw appError(
          "INTERNAL_SERVER_ERROR",
          "OPERATION_FAILED",
          { operation: "taiAnhNenTang" },
          `Không lưu được ảnh nền cho tầng ${input.tangId}`,
        );
      }

      const ket = await ganAnhNenTang(
        {
          tangId: input.tangId,
          anhNenUrl: url,
          anhNenKey: key ?? null,
          tiLeMmMoiPx: input.tiLeMmMoiPx ?? null,
          daHieuChuan: input.daHieuChuan ?? false,
        },
        phamViCua(ctx),
      );
      if (!ket) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinTang" },
          `Tầng id=${input.tangId} không tồn tại hoặc ngoài phạm vi`,
        );
      }
      return ket;
    }),

  // -------------------------------------------------------------------------
  // Dựng nguyên một nhà xưởng — bước [Tạo] của form 3 bước (§10A.2)
  // -------------------------------------------------------------------------

  /**
   * Tạo toà nhà + N tầng + (tuỳ chọn) tường bao trong MỘT lượt gọi.
   *
   * ⚠ KHÔNG bọc cả lượt trong một transaction ở tầng router: mỗi hàm db mở kết
   *   nối riêng và tự kiểm phạm vi. Đánh đổi khai rõ: một lỗi ở tầng thứ ba để
   *   lại toà nhà + hai tầng đã ghi. Chọn vậy vì hai lý do đo được — (a) hàng để
   *   lại đều HỢP LỆ và SỬA ĐƯỢC trong chính màn Thiết kế (không phải rác câm),
   *   (b) gom transaction đòi mọi phép kiểm phạm vi phải chạy trong cùng `tx`,
   *   tức viết lại `trongPhamVi` — một bộ luật phân quyền THỨ HAI, đúng thứ mà
   *   `hierarchy.ts` cấm. Nợ này ghi ở đây để Đợt 4 cân lại khi có `boCucService`.
   *
   * Trả về SỐ ĐẾM để bên gọi đối soát: `soTang` phải khớp số dòng người dùng
   * điền, `soTuong` phải bằng `soTang × 4` khi bật sinh tường.
   */
  dungNhaXuong: protectedProcedure
    .use(quyenThietKe("canCreate"))
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        toaNha: z.object({
          ma: z.string().trim().min(1).max(64),
          ten: z.string().trim().min(1).max(255),
          rongMm: canhMm,
          sauMm: canhMm,
          caoMm: canhMm,
          viTriXMm: z.number().finite().optional(),
          viTriYMm: z.number().finite().optional(),
          modelVoId: z.number().int().positive().nullable().optional(),
          donViNguon: z.enum(["mm", "cm", "m", "inch"]).nullable().optional(),
        }),
        tangs: z
          .array(
            z.object({
              capSo: z.number().int().min(-20).max(200).refine((n) => n !== 0),
              ten: z.string().trim().min(1).max(255),
              caoDoMm,
              caoThongThuyMm: canhMm,
              daiMm: canhMm.nullable().optional(),
              rongMm: canhMm.nullable().optional(),
              nguonHinhHoc: z.enum(["nhap_tay", "ban_ve", "sinh"]).optional(),
              nguon: z.enum(["sinh", "tay"]).optional(),
            }),
          )
          .min(1)
          .max(50),
        /** 4 tường bao mỗi tầng, đã tính ở client bằng `boCucTang.sinhTuongBao`. */
        tuongBaoTheoTang: z
          .array(
            z.object({
              capSo: z.number().int(),
              tuongs: z
                .array(
                  z.object({
                    ten: z.string().trim().min(1).max(255),
                    viTriXMm: z.number().finite(),
                    viTriYMm: z.number().finite(),
                    viTriZMm: z.number().finite(),
                    rongMm: canhMm,
                    caoMm: canhMm,
                    sauMm: canhMm,
                  }),
                )
                .max(64),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const scope = phamViCua(ctx);

      const toa = await luuToaNha({ ...input.toaNha, factoryId: input.factoryId }, scope);
      if (!toa) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "factory" },
          `Nhà máy id=${input.factoryId} không tồn tại hoặc ngoài phạm vi`,
        );
      }

      const idTheoCap = new Map<number, number>();
      for (const t of input.tangs) {
        const daGhi = await luuTang({ ...t, toaNhaId: toa.id }, scope);
        if (!daGhi) {
          throw appError(
            "INTERNAL_SERVER_ERROR",
            "OPERATION_FAILED",
            { operation: "dungNhaXuong" },
            `Không ghi được tầng ${t.capSo} của toà nhà ${toa.id}`,
          );
        }
        idTheoCap.set(t.capSo, daGhi.id);
      }

      let soTuong = 0;
      for (const nhom of input.tuongBaoTheoTang ?? []) {
        const tangId = idTheoCap.get(nhom.capSo);
        if (tangId === undefined) continue;
        const daGhi = await ghiDeTuongBaoSinh(tangId, nhom.tuongs, scope);
        soTuong += daGhi ?? 0;
      }

      return {
        toaNhaId: toa.id,
        tangIds: [...idTheoCap.values()],
        soTang: idTheoCap.size,
        soTuong,
      };
    }),

  /**
   * Sinh lại tường bao cho một tầng đã có (nút "Sinh tường bao" của Inspector).
   * Chỉ THAY tường `nguon='sinh'`; tường người dùng sửa tay được giữ (NT-4).
   */
  sinhTuongBao: protectedProcedure
    .use(quyenThietKe("canEdit"))
    .input(
      z.object({
        tangId: z.number().int().positive(),
        tuongs: z
          .array(
            z.object({
              ten: z.string().trim().min(1).max(255),
              viTriXMm: z.number().finite(),
              viTriYMm: z.number().finite(),
              viTriZMm: z.number().finite(),
              rongMm: canhMm,
              caoMm: canhMm,
              sauMm: canhMm,
            }),
          )
          .max(64),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const soGhi = await ghiDeTuongBaoSinh(input.tangId, input.tuongs, phamViCua(ctx));
      if (soGhi === null) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinTang" },
          `Tầng id=${input.tangId} không tồn tại hoặc ngoài phạm vi`,
        );
      }
      return { soTuong: soGhi };
    }),

  /** Đếm vật thể theo tầng — cho UI và cho phép đối soát hai mô hình rời. */
  demVatThe: protectedProcedure
    .use(quyenThietKe("canView"))
    .input(z.object({ tangIds: z.array(z.number().int().positive()).max(200) }))
    .query(async ({ input }) => {
      const hang = await demVatTheTheoTang(input.tangIds);
      return { tong: hang.length, hang };
    }),
});

export type TwinCanhRouter = typeof twinCanhRouter;
