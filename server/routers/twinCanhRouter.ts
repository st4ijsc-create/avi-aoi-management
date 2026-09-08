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
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { requireAnyPermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
// ── #18 (§7.4, §10B.2) — nhập model 3D. TÁI DÙNG đăng bạ đã có, không dựng bản
//    thứ hai: `registerModel` idempotent theo `modelKey` và `pickBestModel` của
//    cùng module đã cài đúng thứ tự ưu tiên ba cấp mà §10B.2 mô tả.
import { listModels, registerModel } from "../services/twin/modelRegistry";
import { validateUpload } from "../_core/uploadValidation";

/**
 * Trần dung lượng cho model MÁY — 15 MB (§7.4 và §10B.2 ghi cùng con số).
 *
 * ⚠ CHẶT HƠN trần `model3d` = 100 MB của `uploadValidation.ts`. Xem docblock của
 *   `taiModelMay` để biết vì sao kiểm thêm ở đây thay vì hạ trần chung.
 */
const NGUONG_BYTE_MODEL = 15 * 1024 * 1024;
import { phamViCua } from "./_phamViNguoiXem";
import {
  demVatTheTheoTang,
  traVungAnToan,
  luuVungAnToan,
  xoaVungAnToan,
  ganAnhNenTang,
  duocGanModel,
  // ── Đợt 12 lô M (#55) — bản ghi bố cục theo tên ──
  traBanGhi,
  traMotBanGhi,
  luuBanGhi,
  xuatBanBanGhi,
  xoaBanGhi,
  ghiDeTuongBaoSinh,
  luuTang,
  luuToaNha,
  traToaNhaKemTang,
  traToaNhaTheoNhaMay,
  xoaTang,
  xoaToaNha,
  // ── Đợt 4 (§7) — đường ghi màn Thiết kế ──
  TRAN_LO_DAT_CHO,
  ghiDatChoHangLoat,
  goKhoiMatBang,
  traCayPhanCapNhaMay,
  traDatChoTheoTang,
  traKichThuocTheoLoai,
  // ── Đợt 6 (§6.3) — trạng thái hàng loạt cho vòng render `/twin` ──
  traTrangThaiHangLoat,
  traAnhLichSu,
  // ── Đóng nợ #26 (§11) — E-STOP nổi lên Twin ──
  traAnToanRobot,
  traSucKhoeMay,
} from "../db/twinCanh";

/**
 * ★ Thuật toán sinh là MODULE THUẦN nằm ở `client/src/components/twin3d/` và
 *   server import THẲNG nó qua đường dẫn tương đối. Có tiền lệ trong repo
 *   (`server/services/aiCopilotActions.ts` import `client/src/lib/diffHunks`).
 *
 *   Vì sao KHÔNG chép lại thuật toán sang server: `sinhBoCuc` có 38 test T1-T9
 *   ghim tính TẤT ĐỊNH và luật không-đè. Một bản sao ở server là bản KHÔNG có
 *   test đó, và hai bản sẽ trôi khỏi nhau — lúc ấy xem trước ở client và ghi
 *   thật ở server cho hai kết quả khác nhau, đúng thứ mà cả §7.3 lẫn G1 cấm.
 *   Module này không import react/three nên nó chạy được trong Node.
 */
import {
  CAU_HINH_SINH_MAC_DINH,
  khoaThucThe,
  sinhBoCuc,
  type CauHinhSinh,
} from "../../client/src/components/twin3d/sinhBoCuc";

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
 * §6.4 — cổng quyền màn **VẬN HÀNH** (`/twin`): `analytics_oee` **HOẶC**
 * `machine_status`.
 *
 * ⚠⚠ KHÁC `quyenThietKe` và sự khác đó là CỐ Ý. `/twin` (xem) và `/twin-studio`
 * (sửa bố cục) là hai màn khác nhau với hai tập người dùng khác nhau; dùng chung
 * một cổng sẽ hoặc chặn người trực ca khỏi màn xem, hoặc mở đường sửa bố cục cho
 * người chỉ được xem. Đo trên seed thật (`congQuyenTwin.unit.test.ts`): trong 4
 * vai non-admin chỉ `supervisor1` có `analytics_oee`, ba vai kia có
 * `machine_status` ⇒ nếu cổng này chỉ khai `analytics_oee` thì 3/4 người trực ca
 * mất màn Vận hành.
 *
 * ★ Khớp ĐÚNG tập mà ô nav `/twin` khai (`requiredPermissionAny:
 *   ["analytics_oee", "machine_status"]`) — luật Khối D "một lối vào rồi TỪ
 *   CHỐI": nav và router phải nói cùng một câu.
 */
function quyenVanHanh(hanhDong: "canView" | "canEdit") {
  return requireAnyPermission([
    { module: "analytics_oee", action: hanhDong },
    { module: "machine_status", action: hanhDong },
  ]);
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 10 LÔ H2 — CỔNG **ĐỌC HÌNH HỌC**, chỗ lớp lỗi Khối D thật sự nằm
 * ════════════════════════════════════════════════════════════════════════════
 * Ba thủ tục ĐỌC (`danhSachToaNha`, `chiTietToaNha`, `canhThietKe`) phục vụ
 * **HAI** màn: `/twin-studio` (sửa bố cục) và `/twin` (chỉ xem). Trước lô H
 * chúng đứng trên `quyenThietKe` — cổng của màn SỬA. Hậu quả **đo được trên
 * tài khoản thật**, không phải suy luận:
 *
 *   `operator1` (userId 48, seed) có **ĐÚNG MỘT** quyền: `machine_status`.
 *   · `navigation.tsx:446` cho vào `/twin` bằng `analytics_oee` HOẶC
 *     `machine_status` ⇒ mục menu HIỆN, `RouteGuard` CHO QUA.
 *   · rồi `canhThietKe` đòi `settings_factory`/`machine_control` ⇒ **FORBIDDEN**.
 *   ⇒ Thấy menu, bấm vào, và màn nói "không có quyền đọc bố cục nhà máy".
 *   Đây ĐÚNG là "một lối vào rồi TỪ CHỐI" của Khối D, chiều XUÔI.
 *
 * ⚠ Vì sao KHÔNG siết cổng nav lại cho khớp (phương án (a)): làm thế là **xoá
 *   `/twin` khỏi `operator1`/`maint1`** — chính những vai mà màn Vận hành sinh
 *   ra để phục vụ, và là đảo ngược bản vá Đợt 5 CHẶN-1 vốn đã đo được (1/4 vai
 *   → 4/4). Sửa một lỗi "vào rồi bị chặn" bằng cách "không cho vào nữa" là
 *   đóng cửa thay vì mở đường.
 *
 * ⚠⚠ **KHÔNG PHẢI NỚI QUYỀN ÂM THẦM.** Ba điều được ĐO, không được khai:
 *   1. Chỉ ĐỌC hình học được mở. MỌI đường GHI (`luuToaNha`, `luuTang`,
 *      `xoaToaNha`, `luuHangLoat`, `dungNhaXuong`, `sinhTuongBao`,
 *      `vungAnToan*`, `goKhoiMatBang`) **giữ nguyên `quyenThietKe`**.
 *      `congDocHinhHoc.unit.test.ts` liệt kê TOÀN BỘ thủ tục của router và ghim
 *      danh sách ĐỌC-mở là đúng ba tên — thêm tên thứ tư vào đây thì test đỏ.
 *   2. **Phạm vi tenant KHÔNG đi qua cổng quyền.** Nó đi qua
 *      `trongPhamVi("factory", factoryId, phamViCua(ctx))`
 *      (`server/db/twinCanh.ts:250,270`) — một trục HOÀN TOÀN RỜI với module
 *      quyền. Mở `analytics_oee`/`machine_status` không cho ai thấy thêm một
 *      nhà máy nào; nó chỉ đổi *quyền nào* mở được hình học của nhà máy mà
 *      người đó **vốn đã ở trong phạm vi**.
 *   3. `/twin-studio` KHÔNG bị mở ra: lối vào của nó là ô nav riêng
 *      (`settings_factory`/`machine_control`) mà `RouteGuard navHref` tra lại.
 *
 * ★ Cổng này là HỢP của hai cổng, không phải cổng thứ ba: ai vào được màn Thiết
 *   kế vẫn đọc được y như trước (không ai mất gì), ai vào được màn Vận hành nay
 *   đọc được thứ màn đó cần. Viết bằng `quyenThietKe`+`quyenVanHanh` gộp lại
 *   thay vì gõ lại bốn tên module: gõ tay lần thứ ba là chỗ hai bản cài đặt bắt
 *   đầu lệch nhau (G12).
 */
export const MODULE_DOC_HINH_HOC = [
  "settings_factory",
  "machine_control",
  "analytics_oee",
  "machine_status",
] as const;

function quyenDocHinhHoc() {
  return requireAnyPermission(
    MODULE_DOC_HINH_HOC.map((module) => ({ module, action: "canView" as const })),
  );
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


/**
 * Tham số sinh (§8.1). Trần trên mỗi ô KHÔNG phải trang trí: `buocChuyenMm` =
 * 10^9 làm thuật toán xếp ra toạ độ vượt `numeric(14,3)` và lượt ghi ném lỗi
 * sau khi đã chạy xong — người dùng chờ rồi nhận lỗi DB thô. Chặn ở biên rẻ hơn.
 */
const cauHinhSinhSchema = z.object({
  buocChuyenMm: z.number().finite().positive().max(1_000_000),
  buocTramMm: z.number().finite().positive().max(1_000_000),
  buocMayTrongTramMm: z.number().finite().positive().max(1_000_000),
  loiDiMm: z.number().finite().positive().max(1_000_000),
  rongSanToiDaMm: z.number().finite().positive().max(10_000_000),
  kichThuocMacDinh: z.object({
    rongMm: canhMm,
    caoMm: canhMm,
    sauMm: canhMm,
  }),
});

/**
 * Chạy `sinhBoCuc` cho một nhà máy — dùng CHUNG bởi `xemTruocSinh` (query) và
 * `sinhTuDong` (mutation).
 *
 * ★★★ MỘT hàm cho CẢ HAI đường là điểm mấu chốt, không phải tiết kiệm dòng.
 *   Nếu xem trước và ghi thật đi qua hai đường mã khác nhau thì bảng tổng kết
 *   "sẽ tạo N, giữ nguyên M" mô tả một phép tính KHÁC với phép tính sắp chạy, và
 *   người dùng bấm Áp dụng dựa trên một lời hứa không ai kiểm. Đây chính là hình
 *   dạng lỗi mà §12.3/G1 gọi là "khai mà không đo".
 */
async function chuanBiSinh(
  input: { factoryId: number; tangIds: number[]; cauHinh?: CauHinhSinh },
  scope: ReturnType<typeof phamViCua>,
) {
  const [toaNhas, cay, kichThuocLoai] = await Promise.all([
    traToaNhaTheoNhaMay(input.factoryId, scope),
    traCayPhanCapNhaMay(input.factoryId, scope),
    traKichThuocTheoLoai(),
  ]);

  // Tầng của các toà nhà trong phạm vi. `sinhBoCuc` đòi `toaNha` và `tang` là
  // BẮT BUỘC (GC-1 của module) — thiếu chúng thì mọi xưởng rơi về tầng mặc định
  // và lựa chọn tầng của người dùng bị xoá âm thầm.
  const tangs: { id: number; toaNhaId: number; capSo: number }[] = [];
  for (const t of toaNhas) {
    const chiTiet = await traToaNhaKemTang(t.id, scope);
    for (const tg of chiTiet?.tangs ?? []) {
      tangs.push({ id: tg.id, toaNhaId: t.id, capSo: tg.capSo });
    }
  }

  const tangHopLe =
    input.tangIds.length > 0 ? tangs.filter((t) => input.tangIds.includes(t.id)) : tangs;

  const datChoHienCo = await traDatChoTheoTang(
    tangHopLe.map((t) => t.id),
    scope,
  );

  // ★★★ Tập khoá 'tay' — dựng bằng ĐÚNG `khoaThucThe` mà `sinhBoCuc` dùng để so
  // khớp. Một công thức khác dạng ở đây tái sinh lớp lỗi BG-127: tập không rỗng,
  // hàm chạy, `boQua` rỗng, mọi chỉnh tay bị đè sạch, không lỗi nào nổ.
  const daCoThuCong = new Set<string>();
  for (const d of datChoHienCo) {
    if (d.nguon === "tay") daCoThuCong.add(khoaThucThe(d.loaiThucThe, d.thucTheId));
  }

  const bangKichThuoc = new Map(
    kichThuocLoai.map((k) => [
      k.loaiMay,
      { rongMm: k.rongMm, caoMm: k.caoMm, sauMm: k.sauMm },
    ]),
  );

  const ketQua = sinhBoCuc(
    {
      nhaMay: [{ id: input.factoryId, ma: String(input.factoryId), isActive: true }],
      toaNha: toaNhas.map((t) => ({ id: t.id, factoryId: t.factoryId, ma: t.ma })),
      tang: tangHopLe,
      xuong: cay.xuong.map((x) => ({
        id: x.id,
        factoryId: x.factoryId,
        ma: x.ma,
        // Xưởng chưa gắn tầng ⇒ null, và `sinhBoCuc` sẽ dùng tầng đầu của toà đầu.
        tangId: null,
      })),
      chuyen: cay.chuyen.map((c) => ({ id: c.id, workshopId: c.workshopId, ma: c.ma })),
      tram: cay.tram.map((t) => ({
        id: t.id,
        lineId: t.lineId,
        ma: t.ma,
        thuTu: t.thuTu,
      })),
      may: cay.may.map((m) => ({
        id: m.id,
        stationId: m.stationId,
        ma: m.ma,
        loaiMay: String(m.loaiMay),
        isActive: m.isActive,
      })),
    },
    bangKichThuoc,
    daCoThuCong,
    input.cauHinh ?? CAU_HINH_SINH_MAC_DINH,
  );

  return { ...ketQua, datChoHienCo };
}
export const twinCanhRouter = router({
  // -------------------------------------------------------------------------
  // Đọc
  // -------------------------------------------------------------------------

  /** Danh sách toà nhà của một nhà máy. Ngoài phạm vi ⇒ mảng RỖNG. */
  danhSachToaNha: protectedProcedure
    .use(quyenDocHinhHoc())
    .input(z.object({ factoryId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return traToaNhaTheoNhaMay(input.factoryId, phamViCua(ctx));
    }),

  /** Một toà nhà kèm các tầng, numeric đã quy về number. */
  chiTietToaNha: protectedProcedure
    .use(quyenDocHinhHoc())
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
  // Nhập model 3D cho máy / chủng loại (§7.4, §10B.2) — #18
  // -------------------------------------------------------------------------

  /**
   * Danh sách model đã đăng ký, ĐỦ để client tự giải phân giải 3 cấp.
   *
   * ★★★ VÌ SAO MỘT LƯỢT `list` CHỨ KHÔNG 43 LƯỢT `resolve`.
   *   `twin.models.resolve` trả model cho MỘT thiết bị. Cảnh Twin có 42 máy;
   *   gọi resolve cho từng máy là 42 vòng mạng mỗi lần mở màn, và mỗi vòng lại
   *   quét cả bảng (`resolveModel` `select ... where status='active'`). Bảng
   *   registry rất nhỏ (5 hàng đo được 2026-09-07), nên tải nguyên nó MỘT LẦN
   *   rồi để `napModel.chonModelChoMay` áp cùng thứ tự ưu tiên là rẻ hơn hai bậc
   *   độ lớn — và `napModel.unit.test.ts` ghim rằng hai bên cho CÙNG kết quả.
   */
  danhSachModel: protectedProcedure
    .use(quyenThietKe("canView"))
    .query(async ({ ctx }) => {
      /*
       * ★★★ VÌ SAO ĐỌC KHÔNG LỌC MÀ VẪN BÓC `ctx` — VÀ VÌ SAO KHÔNG IM LẶNG.
       *   `equipment_3d_models` KHÔNG có cột phạm vi cho hàng cấp chủng loại
       *   (xem `duocGanModel`), nên không có gì để lọc theo tenant ở đây. Nhưng
       *   danh tính vẫn được TRÍCH và ĐI XUỐNG: lời gọi dưới đây quyết định
       *   những hàng cấp MÁY nào người này được thấy — một hàng trỏ tới máy
       *   ngoài phạm vi là một lời khai về máy mà người này không được biết là
       *   có tồn tại (oracle rò rỉ tồn-tại).
       */
      const scope = phamViCua(ctx);
      const hang = await listModels({ status: "active", limit: 500 });
      const loc: typeof hang = [];
      for (const m of hang) {
        if (m.machineId == null) {
          loc.push(m);
          continue;
        }
        if (await duocGanModel({ phamVi: "may", machineId: m.machineId }, scope)) loc.push(m);
      }
      // Trả ĐÚNG các cột client cần. Không trả `notes`/`createdBy`/`scope`:
      // cảnh 3D không dùng chúng, và mỗi cột thừa là một cột phải giữ tương
      // thích về sau.
      return loc.map((m) => ({
        id: m.id,
        modelKey: m.modelKey,
        modelUri: m.modelUri,
        machineId: m.machineId,
        equipmentId: m.equipmentId,
        equipmentClass: m.equipmentClass,
        version: m.version,
        status: m.status,
        conversionStatus: m.conversionStatus,
        bounds: m.bounds,
      }));
    }),

  /**
   * Tải một tệp .glb/.gltf lên và ĐĂNG KÝ nó cho MỘT MÁY hoặc cho CẢ CHỦNG LOẠI.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ VÌ SAO CÓ THỦ TỤC NÀY KHI `twin.models.uploadAndRegister` ĐÃ TỒN TẠI
   * ════════════════════════════════════════════════════════════════════════
   * `twinRouter.ts:129 uploadAndRegister` chạy thật và có người dùng thật
   * (`MachineCockpit.tsx:740`) — nhưng nó **chỉ gán được cấp MÁY**: `machineId`
   * là trường bắt buộc và `modelKey` viết cứng `machine-<id>`. §10B.2 gọi cấp
   * CHỦNG LOẠI là "cấp đáng dùng nhất" (một tệp cho `AOI` là 14 máy đổi hình
   * cùng lúc) và không có đường nào tới nó từ giao diện.
   *
   * ⚠ KHÔNG sửa `uploadAndRegister` để nới `machineId` thành optional: nó là
   *   đường đang phục vụ màn cockpit, và nới một trường bắt buộc thành tuỳ chọn
   *   làm mọi lỗi "quên truyền machineId" từ chỗ BỊ TỪ CHỐI thành chỗ GHI NHẦM
   *   một hàng vô chủ. Thủ tục mới nói rõ ý định bằng trường `phamVi`.
   *
   * ★ TÁI DÙNG, KHÔNG CHÉP: `validateUpload(buf,"model3d")` (magic bytes glTF
   *   `0x46546C67` + JSON `"asset"`) và `registerModel` (idempotent theo
   *   `modelKey`, tự tăng `version`) là CÙNG hai hàm mà đường cũ dùng. Chép lại
   *   chúng là tạo bản thứ hai để trôi (G12).
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ TRẦN 15 MB Ở ĐÂY CHẶT HƠN TRẦN 100 MB CỦA `validateUpload`
   * ════════════════════════════════════════════════════════════════════════
   * `uploadValidation.ts:18` đặt trần `model3d` = 100 MB — đúng cho một tài sản
   * đơn lẻ xem trong cockpit. §7.4 và §10B.2 đều ghi **15 MB** cho model MÁY, vì
   * máy nhân lên 43 lần và nằm gần camera. Ta kiểm THÊM ở đây thay vì hạ trần
   * chung: hạ trần chung sẽ chặn luôn đường cockpit mà không ai yêu cầu.
   *
   * ★ Client đã chặn cùng ngưỡng ở `kiemTraAsset.chamModel` TRƯỚC khi đọc tệp.
   *   Hai lớp là cố ý (phòng thủ nhiều lớp): lớp client tiết kiệm cho người dùng
   *   một lượt tải 40 MB, lớp server là lớp DUY NHẤT không bỏ qua được.
   */
  taiModelMay: protectedProcedure
    .use(quyenThietKe("canCreate"))
    .input(
      z
        .object({
          /** `may` = gán đúng máy này; `chung_loai` = mọi máy cùng loại. */
          phamVi: z.enum(["may", "chung_loai"]),
          machineId: z.number().int().positive().optional(),
          /** Giá trị `machineTypeEnum`, ví dụ `AOI`. Bắt buộc khi phạm vi là chủng loại. */
          loaiMay: z.string().trim().min(1).max(64).optional(),
          tenTep: z.string().trim().min(1).max(256),
          /** base64 của byte tệp. Trần thật do `NGUONG_BYTE_MODEL` cưỡng chế. */
          noiDungBase64: z.string().min(1).max(30_000_000),
          /** Số tam giác client đo được — GHI LẠI, không dùng để quyết định. */
          soTamGiac: z.number().int().nonnegative().max(100_000_000).optional(),
          /** BBox đo được, ghi vào cột `bounds` (§10B.2 — NULL ở 5/5 hàng). */
          bounds: z.record(z.string(), z.unknown()).optional(),
        })
        // ★ Cưỡng chế bằng LƯỢC ĐỒ, không bằng một `if` trong thân hàm: sai
        //   hình dạng bị chặn ở biên và thông điệp lỗi nói đúng trường nào.
        .refine((v) => (v.phamVi === "may" ? v.machineId != null : v.loaiMay != null), {
          message: "phamVi='may' can machineId; phamVi='chung_loai' can loaiMay",
        }),
    )
    .mutation(async ({ input, ctx }) => {
      /*
       * ★★★ HÀNG RÀO TENANT TRƯỚC MỌI THỨ KHÁC — kể cả trước khi chạm tệp.
       *   Kiểm sau khi đã `storagePut` nghĩa là một người ngoài phạm vi vẫn ghi
       *   được một tệp lên đĩa rồi mới bị từ chối: rác câm, và một kênh ghi.
       *
       * ⚠ `ENTITY_NOT_FOUND` chứ KHÔNG `FORBIDDEN`: "máy này của tenant khác" và
       *   "máy này không tồn tại" phải nói CÙNG MỘT CÂU, nếu không thủ tục trở
       *   thành một oracle dò id máy của tenant khác (quy ước đầu `twinCanh.ts`).
       */
      const phamViGan =
        input.phamVi === "may"
          ? ({ phamVi: "may", machineId: input.machineId! } as const)
          : ({ phamVi: "chung_loai", loaiMay: input.loaiMay! } as const);
      if (!(await duocGanModel(phamViGan, phamViCua(ctx)))) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "machine" },
          input.phamVi === "may"
            ? `May id=${input.machineId} khong ton tai hoac ngoai pham vi`
            : `Khong co may nao loai ${input.loaiMay} trong pham vi`,
        );
      }

      if (process.env.STORAGE_MODE !== "local") {
        throw appError(
          "CONFLICT",
          "FEATURE_DISABLED",
          { feature: "twinLocalStorage" },
          "Bat STORAGE_MODE=local de tai va phuc vu model 3D.",
        );
      }

      const buf = Buffer.from(input.noiDungBase64, "base64");

      // ★ Trần 15 MB của §10B.2 — kiểm TRƯỚC `validateUpload` để thông điệp nói
      //   đúng ngưỡng mà người dùng vừa vượt, không phải ngưỡng 100 MB chung.
      if (buf.length > NGUONG_BYTE_MODEL) {
        throw appError(
          "PAYLOAD_TOO_LARGE",
          "INVALID_VALUE",
          { field: "noiDungBase64" },
          `Model 3D vuot tran ${Math.round(NGUONG_BYTE_MODEL / 1048576)} MB (tep ${(buf.length / 1048576).toFixed(1)} MB)`,
        );
      }

      // ★★★ MAGIC BYTES, KHÔNG PHẢI ĐUÔI TỆP. Đổi tên `x.exe` thành `x.glb` là
      //   việc của một cú rename; `validateUpload` đọc 4 byte đầu (`glTF`) hoặc
      //   khoá `"asset"` của glTF JSON nên nó không bị lừa bằng cách đó.
      const v = validateUpload(buf, "model3d");
      if (!v.ok) {
        throw appError(
          v.status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
          "INVALID_VALUE",
          { field: "noiDungBase64" },
          v.error ?? "Tep khong phai glTF 2.0 hop le.",
        );
      }

      const duoi = v.detectedMime === "model/gltf-binary" ? "glb" : "gltf";
      /*
       * ════════════════════════════════════════════════════════════════════
       * ★★★ LƯU DƯỚI `models/`, KHÔNG PHẢI `twin-assets/` — LỖI ĐÃ ĐO ĐƯỢC
       * ════════════════════════════════════════════════════════════════════
       * §7.4 viết: allowlist "chỉ mở thêm đúng tiền tố `/uploads/twin-assets/`".
       * Bản đầu của thủ tục này làm đúng câu đó và **tệp tải lên không đọc lại
       * được** — nghiệm thu ca dương trên trình duyệt thật (2026-09-07) cho:
       *
       *   GET /uploads/twin-assets/loai-AOI-…glb  →  403
       *   {"code":"image_path_shape_unknown",
       *    "message":"… unknown top-level directory 'twin-assets'"}
       *
       * Vì `server/routes/_uyQuyenAnh.ts:209 THU_MUC_TAC_TAO` là một allowlist
       * ĐÓNG, và docblock của nó nói rõ đó là hành vi CỐ Ý: *"một thư mục mới
       * xuất hiện dưới `uploads/` phải làm cổng ĐỎ, chứ không được thừa hưởng
       * lời phán 'chắc là tác tạo' của những cái đã biết."*
       *
       * ⇒ Hai đường sửa: (a) thêm `twin-assets` vào allowlist ủy quyền ảnh, hay
       *   (b) dùng đúng thư mục đã được cho phép. Chọn (b): `models/` là nơi
       *   `twin.models.uploadAndRegister` đã ghi từ trước (`machine-<id>-<ts>.glb`),
       *   nên cả hai đường nhập model dùng CHUNG một thư mục và một luật uỷ
       *   quyền — thay vì hai. Sửa (a) là nới một cổng an ninh cho một tiện lợi
       *   đặt tên, và nó nằm ngoài phạm vi lô này.
       *
       * ★ Tiền tố `twin-` trong TÊN TỆP vẫn phân biệt được tài sản do màn Thiết
       *   kế sinh ra, mà không cần một thư mục mới.
       *
       * ⚠ LỖI NÀY KHÔNG MỘT TEST ĐƠN VỊ NÀO BẮT ĐƯỢC: đường ghi trả 200, hàng
       *   registry đúng, `bounds` đúng. Chỉ lượt ĐỌC LẠI trên trình duyệt thật
       *   mới lộ ra — và nếu không đo, biểu hiện duy nhất là máy đó lặng lẽ rơi
       *   về khối mặc định, đúng cái hành vi mà `ModelErrorBoundary` được thiết
       *   kế để làm khi model hỏng THẬT.
       */
      const khoaTep = `models/twin-${input.phamVi === "may" ? `may-${input.machineId}` : `loai-${input.loaiMay}`}-${Date.now()}-${nanoid(6)}.${duoi}`;
      let modelUri: string;
      try {
        const daTai = await storagePut(khoaTep, buf, v.detectedMime ?? "model/gltf-binary");
        modelUri = daTai.url;
      } catch {
        throw appError(
          "INTERNAL_SERVER_ERROR",
          "OPERATION_FAILED",
          { operation: "taiModelMay" },
          "Khong luu duoc tep model 3D",
        );
      }

      /*
       * ════════════════════════════════════════════════════════════════════
       * ★★★ `modelKey` QUYẾT ĐỊNH IDEMPOTENCE — VÀ HAI PHẠM VI PHẢI KHÁC KHOÁ
       * ════════════════════════════════════════════════════════════════════
       * `registerModel` cập nhật TẠI CHỖ hàng cùng `modelKey` và tăng `version`.
       * Nếu cấp máy và cấp chủng loại dùng chung khuôn khoá thì tải một model
       * cho `AOI` sẽ GHI ĐÈ model riêng của máy 7 — người dùng mất tài sản đã
       * gán mà không có cảnh báo nào. Hai tiền tố `twin-may-` / `twin-loai-`
       * giữ hai không gian tên rời nhau.
       *
       * ★ Cũng KHÁC khuôn `machine-<id>` của đường cockpit, cố ý: đường này
       *   không được lặng lẽ đè lên model mà cockpit đã đăng ký.
       *
       * ★★★ `machineId: null` cho hàng cấp CHỦNG LOẠI là BẮT BUỘC, không phải
       *   tuỳ ý. `pickBestModel` (server) và `chonModelChoMay` (client) đều chỉ
       *   coi một hàng là cấp chủng loại khi `machineId == null && equipmentId
       *   == null`. Điền machineId vào đây làm hàng đó "vô hình" ở cấp loại.
       */
      const modelKey =
        input.phamVi === "may"
          ? `twin-may-${input.machineId}`
          : `twin-loai-${input.loaiMay}`;

      const ket = await registerModel({
        modelKey,
        modelUri,
        machineId: input.phamVi === "may" ? (input.machineId ?? null) : null,
        equipmentClass: input.phamVi === "chung_loai" ? (input.loaiMay ?? null) : null,
        modelKind: "gltf",
        sourceFormat: "gltf",
        conversionStatus: "ready",
        bounds: input.bounds ?? null,
        notes:
          input.soTamGiac === undefined
            ? null
            : `twin-studio: ${input.soTamGiac} tam giac, ${buf.length} byte, ${input.tenTep}`,
        createdBy: ctx.user?.id ?? null,
      });

      return {
        ok: ket.ok,
        id: ket.id ?? null,
        modelUri,
        modelKey,
        version: ket.version ?? 1,
        soByte: buf.length,
        phamVi: input.phamVi,
      };
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

  /**
   * Đếm vật thể theo tầng — cho UI và cho phép đối soát hai mô hình rời.
   *
   * ★★★ LÔ K/K2 — thủ tục này TỪNG khai `async ({ input })`, tức là **không bóc
   *   `ctx` một lần nào**, trong khi bốn thủ tục đọc quanh nó (`:311`, `:319`,
   *   `:355`, `:377`) đều truyền `phamViCua(ctx)`. Vì `tangIds` do CLIENT TỰ
   *   KHAI, thiếu sót ấy biến cổng quyền `quyenThietKe` thành hàng rào duy
   *   nhất — mà nó chỉ trả lời "vai này xem được thiết kế không", KHÔNG trả lời
   *   "nhà máy này có phải của người ấy không". Xem `db/twinCanh.demVatTheTheoTang`.
   */
  demVatThe: protectedProcedure
    .use(quyenThietKe("canView"))
    .input(z.object({ tangIds: z.array(z.number().int().positive()).max(200) }))
    .query(async ({ input, ctx }) => {
      const hang = await demVatTheTheoTang(input.tangIds, phamViCua(ctx));
      return { tong: hang.length, hang };
    }),

  // ═════════════════════════════════════════════════════════════════════════
  // ĐỢT 4 (§7) — ĐƯỜNG GHI CỦA MÀN THIẾT KẾ
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Cây phân cấp + đặt chỗ + bảng kích thước của một nhà máy — MỘT lượt gọi.
   *
   * ★ Gộp bốn phép đọc vào một procedure thay vì bốn `useQuery`: màn Thiết kế
   *   cần cả bốn để dựng được một khung hình, và bốn query độc lập cho ra bốn
   *   thời điểm chụp khác nhau. Cây trái vẽ 41 máy trong khi cảnh 3D vẽ 40 là
   *   một lớp lỗi có thật của giao diện nhiều-nguồn, và nó không kêu.
   */
  canhThietKe: protectedProcedure
    .use(quyenDocHinhHoc())
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        tangIds: z.array(z.number().int().positive()).max(50).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const scope = phamViCua(ctx);
      const [cay, kichThuoc] = await Promise.all([
        traCayPhanCapNhaMay(input.factoryId, scope),
        traKichThuocTheoLoai(),
      ]);
      const datCho =
        input.tangIds && input.tangIds.length > 0
          ? await traDatChoTheoTang(input.tangIds, scope)
          : [];
      /*
       * ★★★ ĐỢT 8 LÔ C — VÙNG AN TOÀN (§11.1 #5).
       *   Đo được trước đợt này: `twin_vat_the` 4 hàng, TOÀN `loai='tuong'`,
       *   **0 hàng `'vung'`**. Trước dòng này, màn Thiết kế KHÔNG có đường nào
       *   để biết một vùng an toàn tồn tại — nên #5 chưa làm ở cả tầng dữ liệu
       *   LẪN tầng vận chuyển. Đây là nửa "đọc"; nửa "ghi" là ba thủ tục
       *   `vungAnToan*` ở dưới (#42).
       */
      const vung =
        input.tangIds && input.tangIds.length > 0
          ? await traVungAnToan(input.tangIds, scope)
          : [];

      /*
       * ════════════════════════════════════════════════════════════════════
       * ★★★ THƯỜNG-2(b) — "RỖNG VÌ YÊN ỔN" ≠ "RỖNG VÌ CHƯA ĐƯỢC GÁN"
       * ════════════════════════════════════════════════════════════════════
       * Đo được: `user_factory_assignments` chỉ có 2 hàng, CẢ HAI của userId 51.
       * `supervisor1`/`maint1` qua được cổng quyền rồi thấy màn RỖNG — và màn
       * này nói "0 máy" y hệt như khi nhà máy thật sự chưa xếp máy nào. Đó đúng
       * là thứ NT-3 cấm: hai thế giới khác hẳn nhau mà giao diện phát biểu giống
       * nhau, nên người dùng đi tìm lỗi ở chỗ không có lỗi.
       *
       * ★ Dùng ĐÚNG `resolveTenantFactoryScope` — bộ phân giải mà chính đường dữ
       *   liệu đi qua — chứ KHÔNG tự tính lại. Hai bộ suy độc lập canh hai nửa
       *   một câu là lớp lỗi đã cắn dự án này (xem `mqttOeeRouters.getScopeLabels`).
       *
       * ⚠ Trả ĐÚNG BA Ô CHỮ của `scope.labels`. `filter` của drizzle mang tham
       *   chiếu vòng và từng làm `dashboard.getStats` trả 500 cho MỌI người dùng
       *   (2026-08-17); `resolveTenantFactoryScope` đã lọc qua `scopeLabelsOf`
       *   nên nó không có đường ra tới đây.
       */
      const { resolveTenantFactoryScope } = await import("../db/reportAggregators");
      const nhan = await resolveTenantFactoryScope({
        userId: ctx.user?.id,
        userRole: ctx.user?.role,
      });

      return { ...cay, datCho, kichThuoc, vung, ...nhan.labels };
    }),

  /**
   * Ghi hàng loạt đặt chỗ — nút "Lưu" của §7.3, MỘT transaction, lô ≤ 500.
   *
   * ★★★ `nguon` mặc định `'tay'` ở đây và đó là quyết định NT-4 quan trọng nhất
   *   của procedure này: hàng đi qua đường này là hàng NGƯỜI vừa kéo/gõ, nên
   *   lần Sinh tự động sau KHÔNG được đè lên nó. Nếu để mặc định `'sinh'` thì
   *   mọi công chỉnh tay biến mất ở lần bấm "Sinh tự động" kế tiếp — không lỗi,
   *   không cảnh báo, chỉ là máy về chỗ cũ.
   */
  /**
   * ★★★ §6.3 — TRẠNG THÁI HÀNG LOẠT cho vòng render của `/twin`. KHÔNG N+1.
   *
   * Thay cho `machineStatus.listWithStatus` ở vòng render. Số truy vấn CỐ ĐỊNH,
   * không phụ thuộc số máy — đo được N = 1…42 đều cho `trangThaiTapMay` = 3
   * query (N+1 thật sẽ cho 3/6/…/126).
   *
   * ⚠ **ĐÍNH CHÍNH SPEC (§6.3) — tiền đề "N+1" đã KHÔNG còn đúng khi Đợt 6 đo.**
   * §6.3 viết `listWithStatus` "chạy 3 query con mỗi máy". Đo lại 2026-09-07:
   * `db/machine.ts` đã được doc 54 Wave C (`d467c6b5`) viết lại thành tập-hợp
   * (`DISTINCT ON` + `LEAD`) từ trước — đúng kỹ thuật mà §6.3 kê đơn. Việc của
   * Đợt 6 vì thế KHÔNG phải "vá N+1" mà là dựng procedure hình dạng §6.3 **dùng
   * lại** đường tập-hợp đó (`trangThaiTapMay`), thay vì chép nó sang bản thứ hai.
   * Báo lại thay vì tự sửa spec.
   *
   * ★ `bayGio` do SERVER đặt, không nhận từ client: `doTuoiGiay` là số dùng để
   *   quyết định máy có bị xếp `khong_ro` hay không, nên để client tự khai đồng
   *   hồ là mở đường cho một trình duyệt lệch giờ tự tuyên bố dữ liệu của mình
   *   còn tươi.
   */
  trangThaiHangLoat: protectedProcedure
    .use(quyenVanHanh("canView"))
    .input(z.object({ factoryId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const bayGio = Date.now();
      const may = await traTrangThaiHangLoat(input.factoryId, bayGio, phamViCua(ctx));

      /*
       * ★★★ G15 — TRẢ CẢ `bayGio` CỦA SERVER, và đây không phải ô thừa.
       *
       * Client tính "cập nhật N giây trước" bằng đồng hồ CỦA NÓ sẽ sai đúng bằng
       * độ lệch giữa hai đồng hồ. Trên một màn mà >5 phút nghĩa là "Không rõ",
       * một trình duyệt lệch 6 phút sẽ tô xám gạch chéo TOÀN BỘ nhà máy đang
       * chạy tốt — hoặc tệ hơn theo chiều ngược lại. Trả mốc của server cho phép
       * client quy chiếu về cùng một đồng hồ.
       */
      const capNhatMoiNhat = may.reduce<number | null>(
        (max, m) => (m.capNhatLuc == null ? max : max == null || m.capNhatLuc > max ? m.capNhatLuc : max),
        null,
      );

      return {
        may,
        bayGio,
        // `null` (KHÔNG phải 0) khi KHÔNG máy nào từng báo cáo — NT-3.5.
        capNhatMoiNhat,
        // Đếm rỗng khác đếm bằng 0: `tong` luôn là số ĐÃ đo (độ dài mảng).
        tong: may.length,
      };
    }),

  /**
   * ★★★ §11 #26 — AN TOÀN (E-STOP) CỦA ROBOT, NỔI LÊN TỔNG QUAN.
   *
   * ⚠ Thủ tục RIÊNG, không nhét vào `trangThaiHangLoat`: hai câu hỏi khác nhau
   *   trên hai bảng khác nhau, và gộp lại sẽ làm một lỗi đọc telemetry robot
   *   đánh sập cả vòng render trạng thái máy. Tách ra thì mất tín hiệu an toàn
   *   là mất ĐÚNG dải an toàn, và nó nói ra điều đó.
   *
   * ★★★ G21 — QUYỀN CỦA NGƯỜI NHẬN, không phải phép nhóm theo dữ liệu. Cổng là
   *   `quyenVanHanh("canView")` = `analytics_oee` **HOẶC** `machine_status`,
   *   CÙNG cổng mà `/twin` và `trangThaiHangLoat` dùng. Lý do dùng lại thay vì
   *   khai một cổng thứ ba: ai đã được xem màn Vận hành thì phải thấy được tín
   *   hiệu an toàn của chính màn ấy — một dải E-STOP mà người trực ca không có
   *   quyền đọc là dải E-STOP không tồn tại. Ngược lại, ai KHÔNG qua nổi cổng
   *   `/twin` thì cũng không gọi được thủ tục này.
   *
   * ★ Phạm vi nhà máy: `phamViCua(ctx)` → `traCayPhanCapNhaMay` (xem
   *   `traAnToanRobot`). Không có đường vòng nào lấy robot ngoài phạm vi.
   */
  anToanRobot: protectedProcedure
    .use(quyenVanHanh("canView"))
    .input(z.object({ factoryId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const robot = await traAnToanRobot(input.factoryId, phamViCua(ctx));
      /*
       * ★ Trả `bayGio` của SERVER cùng lý lẽ G15 đã ghi ở `trangThaiHangLoat`:
       *   client không được tự khai đồng hồ khi quyết định dữ liệu còn tươi hay
       *   không.
       */
      return { robot, bayGio: Date.now(), tong: robot.length };
    }),

  /**
   * ★★★ ĐỢT 21 LÔ Z — A-4: SỨC KHOẺ MÁY + NGUY CƠ HỎNG (§14.5.1, F-15, mục G-1).
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ G49 — THỦ TỤC THỨ 21 CỦA ROUTER NÀY, VÀ NÓ CÓ `phamViCua(ctx)`
   * ════════════════════════════════════════════════════════════════════════
   * Brief của lô ghi rõ: cả 20 thủ tục hiện có của `twinCanhRouter` đã có
   * `phamViCua`, đừng đẻ cái thứ 21 thiếu. Nó ở đây, và nó là cổng DUY NHẤT —
   * `traSucKhoeMay` áp phạm vi bên trong qua `traCayPhanCapNhaMay`, nên một
   * `factoryId` tự khai ngoài phạm vi trả `[]` chứ không trả sức khoẻ máy của
   * tenant khác.
   *
   * ★ Cổng quyền `quyenVanHanh("canView")` — CÙNG cổng với `anToanRobot` và
   *   `trangThaiHangLoat`, không phải cổng thứ ba. Sức khoẻ máy là **thông tin
   *   vận hành đọc-chỉ** giống hệt trạng thái và E-STOP; dựng một cổng riêng
   *   cho nó nghĩa là một vai có thể thấy máy E-STOP mà không thấy máy sắp
   *   hỏng, và không ai có thể nói vì sao đó lại là ranh giới đúng.
   *
   * ★ `bayGio` do SERVER đặt — cùng lý lẽ G15 đã ghi ở `trangThaiHangLoat` và
   *   `anToanRobot`. `conHanSucKhoe` quyết định một lời khai còn được vẽ hay
   *   không; để client tự khai đồng hồ là mở đường cho một trình duyệt lệch giờ
   *   tự tuyên bố dữ liệu 18 ngày tuổi của mình còn tươi.
   *
   * ★★★ `tongCoKhai` KHÁC `tong` — G9 (ĐƠN VỊ CỦA CON SỐ).
   *   `tong` = số máy TRẢ VỀ (có ít nhất một hàng trong `machine_health_history`)
   *   `tongMayTrongPhamVi` = số máy của nhà máy mà người gọi được thấy
   *   Chênh lệch giữa hai số này chính là "số máy CHƯA từng được đo sức khoẻ" —
   *   một đại lượng thật mà client cần để nói "6/43" chứ không phải "6/?" hay,
   *   tệ hơn, "6/6". Trả cả hai ở đây thay vì để client tự trừ từ một truy vấn
   *   khác: hai nguồn cho hai nửa một câu là lớp lỗi đã cắn dự án này.
   */
  sucKhoeMay: protectedProcedure
    .use(quyenVanHanh("canView"))
    .input(z.object({ factoryId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const scope = phamViCua(ctx);
      const [khai, cay] = await Promise.all([
        traSucKhoeMay(input.factoryId, scope),
        traCayPhanCapNhaMay(input.factoryId, scope),
      ]);
      /*
       * ★ Mốc MỚI NHẤT trong tập — để header khai tuổi của LỚP NÀY, tách khỏi
       *   tuổi của lớp trạng thái. Hai lớp đọc hai bảng có nhịp ghi khác nhau;
       *   một ô tuổi chung sẽ lấy cái tươi hơn và làm lớp cũ trông như còn sống
       *   (đúng chế độ hỏng `max`-của-mọi-nguồn mà `chonNguonMocTuoi` đã vá).
       */
      const mocMoiNhat = khai.reduce<number | null>(
        (max, k) => (k.mocMs == null ? max : max == null || k.mocMs > max ? k.mocMs : max),
        null,
      );
      return {
        khai,
        bayGio: Date.now(),
        mocMoiNhat,
        tong: khai.length,
        tongMayTrongPhamVi: cay.may.length,
      };
    }),

  /**
   * ★★★ §9.8 — ẢNH LỊCH SỬ TẠI MỘT MỐC, nguồn của scrubber tua lại.
   *
   * ★ CÙNG hình dạng trả về với `trangThaiHangLoat`, và đó là điều kiện để
   *   §9.8 ("CÙNG MỘT state store cho live và replay") thực hiện được: client
   *   đổ cả hai vào đúng một `apDung()` mà không cần nhánh riêng.
   *
   * ⚠ `moc` là ms epoch. Trần 24h quá khứ theo §9.8 ("thanh kéo 24 h qua"); mốc
   *   ở TƯƠNG LAI bị từ chối — nhìn trộm tương lai không phải tua lại.
   */
  anhLichSu: protectedProcedure
    .use(quyenVanHanh("canView"))
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        moc: z.number().int().positive(),
      }),
    )
    .query(async ({ input, ctx }) => {
      /*
       * ★ KẸP mốc thay vì ném lỗi: scrubber gửi mốc liên tục khi người dùng kéo,
       *   và một `throw` giữa chừng làm cảnh nhấp nháy lỗi trong lúc kéo. Kẹp về
       *   biên là hành vi đúng của một thanh trượt — và biên vẫn được cưỡng chế,
       *   nên không có đường nhìn trộm tương lai hay đọc quá 24 h.
       */
      const bayGio = Date.now();
      const TRAN_24H = 24 * 60 * 60 * 1000;
      const moc = Math.min(Math.max(input.moc, bayGio - TRAN_24H), bayGio);
      const may = await traAnhLichSu(input.factoryId, moc, phamViCua(ctx));
      const capNhatMoiNhat = may.reduce<number | null>(
        (max, m) => (m.capNhatLuc == null ? max : max == null || m.capNhatLuc > max ? m.capNhatLuc : max),
        null,
      );
      // `bayGio` trả về là MỐC ĐÃ KẸP — client phải xét tuổi theo mốc thật sự
      // được đọc, không theo mốc nó đã xin.
      return { may, bayGio: moc, capNhatMoiNhat, tong: may.length };
    }),

  luuHangLoat: protectedProcedure
    .use(quyenThietKe("canEdit"))
    .input(
      z.object({
        hangs: z
          .array(
            z.object({
              loaiThucThe: z.enum(["workshop", "line", "station", "machine", "workstation"]),
              thucTheId: z.number().int().positive(),
              tangId: z.number().int().positive(),
              viTriXMm: z.number().finite(),
              viTriYMm: z.number().finite(),
              viTriZMm: z.number().finite(),
              rongMm: canhMm.nullable().optional(),
              caoMm: canhMm.nullable().optional(),
              sauMm: canhMm.nullable().optional(),
              kichThuocDaDo: z.boolean().optional(),
              // Quaternion: mỗi thành phần trong [-1,1]. Không kiểm chuẩn hoá ở
              // đây — `chuanHoaQuat` của heToaDo.ts làm việc đó ở client, và một
              // quat hơi lệch chuẩn (sai số float) không phải lý do từ chối ghi.
              quatX: z.number().finite().min(-1).max(1).optional(),
              quatY: z.number().finite().min(-1).max(1).optional(),
              quatZ: z.number().finite().min(-1).max(1).optional(),
              quatW: z.number().finite().min(-1).max(1).optional(),
              daKhoa: z.boolean().optional(),
              hienThi: z.boolean().optional(),
              nguon: z.enum(["sinh", "tay"]).optional(),
            }),
          )
          .min(1)
          .max(TRAN_LO_DAT_CHO),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ket = await ghiDatChoHangLoat(
        input.hangs.map((h) => ({ ...h, nguon: h.nguon ?? "tay" })),
        phamViCua(ctx),
      );
      if (!ket) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinTang" },
          "Có tầng không tồn tại hoặc ngoài phạm vi",
        );
      }
      return ket;
    }),

  /**
   * Gỡ một thực thể khỏi mặt bằng (phím Delete của §7.3).
   * KHÔNG xoá bản ghi `machines` — chỉ xoá hàng `twin_dat_cho`.
   */
  goKhoiMatBang: protectedProcedure
    .use(quyenThietKe("canDelete"))
    .input(
      z.object({
        loaiThucThe: z.enum(["workshop", "line", "station", "machine", "workstation"]),
        thucTheId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const xong = await goKhoiMatBang(input.loaiThucThe, input.thucTheId, phamViCua(ctx));
      if (!xong) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinDatCho" },
          "Vật thể không có trên mặt bằng hoặc ngoài phạm vi",
        );
      }
      return { daGo: true };
    }),

  /* ═══════════════════════════════════════════════════════════════════════
     ĐỢT 8 LÔ C — CRUD VÙNG AN TOÀN (§11.7 #42)
     ═══════════════════════════════════════════════════════════════════════

     ★★★ §11c.3 ghi đích của #42 là `VeVungPolygon.tsx` — tệp đó **KHÔNG TỒN
         TẠI**, và `FactoryFloorEditor.tsx:444` vẫn là **nơi DUY NHẤT** CRUD vùng
         an toàn trong hệ. Đây là đường THAY THẾ đầu tiên. `FactoryFloorEditor`
         KHÔNG bị đụng tới: cổng ra §11 chưa mở (18/62), và xoá nó hôm nay là
         mất tính năng thật (§11c.7).

     ★ Cổng quyền: `canEdit` cho ghi, `canDelete` cho xoá — KHÔNG dùng chung một
       mức. Vẽ lại một vùng và xoá hẳn nó là hai hậu quả khác nhau.
  */

  /**
   * Tạo hoặc sửa MỘT vùng an toàn (polygon mm).
   *
   * ★ Trần 200 đỉnh khớp `SO_DINH_TOI_DA` của `vungAnToan.ts` — hai cổng, cùng
   *   một con số. Lệch nhau thì client cho vẽ cái server từ chối, và người dùng
   *   mất công vẽ rồi nhận lỗi ở bước Lưu.
   *
   * ⚠ `z.tuple` cho từng đỉnh (KHÔNG `z.array(z.number())`): một mảng 3 phần tử
   *   lọt qua `array` và ghi vào jsonb, rồi mọi nơi đọc phải tự đoán phần tử thứ
   *   ba là gì. Hình dạng phải bị cưỡng chế ở cổng vào.
   */
  luuVungAnToan: protectedProcedure
    .use(quyenThietKe("canEdit"))
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        tangId: z.number().int().positive(),
        ten: z.string().trim().min(1).max(255),
        diemDa: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(200),
        viTriXMm: z.number().finite(),
        viTriYMm: z.number().finite(),
        viTriZMm: z.number().finite(),
        caoMm: z.number().finite().positive().max(10_000_000),
        mau: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const kq = await luuVungAnToan(
        { ...input, diemDa: input.diemDa.map(([x, y]) => [x, y] as [number, number]) },
        phamViCua(ctx),
      );
      if (!kq) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinVatThe" },
          "Tầng hoặc vùng không tồn tại, hoặc ngoài phạm vi",
        );
      }
      return kq;
    }),

  /**
   * Xoá MỘT vùng an toàn.
   *
   * ★★★ Tầng DB ràng `loai='vung'` vào cả `SELECT` lẫn `DELETE`. Không có ràng
   *   buộc đó thì thủ tục này xoá được **bất kỳ** hàng `twin_vat_the` nào theo
   *   id — kể cả bốn bức tường bao mà `sinhTuongBao` dựng — và người dùng chỉ
   *   phát hiện khi vỏ nhà biến mất khỏi cảnh.
   */
  xoaVungAnToan: protectedProcedure
    .use(quyenThietKe("canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const xong = await xoaVungAnToan(input.id, phamViCua(ctx));
      if (!xong) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinVatThe" },
          "Vùng không tồn tại hoặc ngoài phạm vi",
        );
      }
      return { daXoa: true };
    }),


  // -------------------------------------------------------------------------
  // Bản ghi bố cục theo tên — `twin_ban_ghi` (§5.3, §11 #55)
  // -------------------------------------------------------------------------

  /**
   * ★ Lược đồ Zod của một ảnh chụp. Chặt ở BIÊN, không ở giữa.
   *   `anhChup` là `jsonb NOT NULL` — DB nhận bất cứ JSON nào, kể cả `{}`. Một
   *   ảnh chụp rỗng lưu được, xuất bản được, và màn Vận hành đọc ra một nhà máy
   *   trống mà không lỗi nào nổ. Lược đồ này là chỗ duy nhất chặn được điều đó.
   */
  danhSachBanGhi: protectedProcedure
    .use(quyenThietKe("canView"))
    .input(z.object({ tangIds: z.array(z.number().int().positive()).min(1).max(50) }))
    .query(async ({ input, ctx }) => {
      return traBanGhi(input.tangIds, phamViCua(ctx));
    }),

  /** Một bản ghi ĐẦY ĐỦ — chỉ gọi khi thật sự khôi phục, `anhChup` có thể vài trăm KB. */
  chiTietBanGhi: protectedProcedure
    .use(quyenThietKe("canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const kq = await traMotBanGhi(input.id, phamViCua(ctx));
      if (!kq) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinBanGhi" },
          `Ban ghi id=${input.id} khong ton tai hoac ngoai pham vi`,
        );
      }
      return kq;
    }),

  /**
   * Lưu bố cục HIỆN TẠI thành một bản ghi có TÊN.
   *
   * ★★★ ẢNH CHỤP ĐẾN TỪ CLIENT, VÀ ĐÓ LÀ QUYẾT ĐỊNH CÓ Ý THỨC.
   *   Cách khác là server tự đọc `twin_dat_cho` rồi tự chụp. Nhưng người dùng
   *   bấm "Lưu bản ghi" khi đang nhìn bố cục ĐANG SỬA (có thể có thay đổi chưa
   *   ghi), và một ảnh chụp đọc từ DB sẽ lưu bố cục ĐÃ LƯU — tức không phải thứ
   *   họ vừa nhìn. Hai bố cục khác nhau mang cùng một cái tên là đúng thứ mà
   *   tính năng này sinh ra để tránh.
   *
   * ⚠ Đánh đổi: client tự khai nội dung ảnh chụp. Nó KHÔNG mở lỗ phân quyền —
   *   `tangId` vẫn qua `locTangTrongPhamVi`, và ảnh chụp không ghi vào bảng
   *   sống nào (khôi phục là một lượt `luuHangLoat` riêng, có cổng riêng). Cái
   *   client tự khai chỉ nằm trong chính bản ghi của họ.
   */
  luuBanGhi: protectedProcedure
    .use(quyenThietKe("canCreate"))
    .input(
      z.object({
        tangId: z.number().int().positive(),
        nhan: z.string().trim().min(1).max(255),
        anhChup: z.object({
          phienBan: z.literal(1),
          ghiLuc: z.string().min(1).max(64),
          // ★ `.min(1)` — một ảnh chụp RỖNG bị chặn ở biên. Xem docblock trên.
          datCho: z
            .array(
              z.object({
                loaiThucThe: z.string().min(1).max(32),
                thucTheId: z.number().int().positive(),
                viTriXMm: z.number().finite(),
                viTriYMm: z.number().finite(),
                viTriZMm: z.number().finite(),
                quatX: z.number().finite(),
                quatY: z.number().finite(),
                quatZ: z.number().finite(),
                quatW: z.number().finite(),
                rongMm: z.number().finite().nullable().optional(),
                caoMm: z.number().finite().nullable().optional(),
                sauMm: z.number().finite().nullable().optional(),
                daKhoa: z.boolean().optional(),
                hienThi: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(TRAN_LO_DAT_CHO),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const kq = await luuBanGhi(
        { ...input, nguoiTao: ctx.user?.id ?? null },
        phamViCua(ctx),
      );
      if (!kq) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinTang" },
          `Tang id=${input.tangId} khong ton tai hoac ngoai pham vi`,
        );
      }
      return kq;
    }),

  /**
   * XUẤT BẢN một bản ghi — đây là lượt ghi DUY NHẤT chạm tới màn Vận hành.
   *
   * ★ `canEdit` chứ không `canCreate`: xuất bản không tạo gì mới, nó đổi thứ
   *   người khác đang xem. Hai hành động khác nhau về hậu quả nên đi qua hai
   *   cổng khác nhau — kể cả khi hôm nay hai cổng cùng cho một tập người.
   */
  xuatBanBanGhi: protectedProcedure
    .use(quyenThietKe("canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const kq = await xuatBanBanGhi(input.id, phamViCua(ctx));
      if (!kq) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinBanGhi" },
          `Ban ghi id=${input.id} khong ton tai hoac ngoai pham vi`,
        );
      }
      return kq;
    }),

  xoaBanGhi: protectedProcedure
    .use(quyenThietKe("canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const kq = await xoaBanGhi(input.id, phamViCua(ctx));
      if (!kq) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "twinBanGhi" },
          `Ban ghi id=${input.id} khong ton tai hoac ngoai pham vi`,
        );
      }
      // ★ Nói ra rằng vừa gỡ bản màn Vận hành đang đọc — người gọi cảnh báo được.
      return kq;
    }),

  /**
   * XEM TRƯỚC sinh tự động — CHẠY THUẬT TOÁN NHƯNG KHÔNG GHI GÌ (§7.3).
   *
   * ★★★ Đây là procedure ĐỌC (`query`), không phải mutation, và đó là cưỡng chế
   *   chứ không phải quy ước: một `mutation` tên "xemTruoc" là chuyện chỉ cần
   *   một lần sửa nhầm là ghi thật. `quyenThietKe("canView")` cũng theo đó — xem
   *   trước không đòi quyền ghi.
   *
   * Trả về ĐÚNG hình dạng mà `sinhTuDong` sẽ ghi, để bảng tổng kết và lớp ghost
   * ở client đọc CÙNG MỘT dữ liệu với hành vi thật. Xem trước tính bằng một
   * đường mã khác với đường ghi là cách chắc chắn để hai bên lệch nhau.
   */
  xemTruocSinh: protectedProcedure
    .use(quyenThietKe("canView"))
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        tangIds: z.array(z.number().int().positive()).max(50),
        cauHinh: cauHinhSinhSchema.optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return chuanBiSinh(input, phamViCua(ctx));
    }),

  /**
   * SINH TỰ ĐỘNG và GHI (§7.3, §8).
   *
   * ★★★ BẤT BIẾN QUAN TRỌNG NHẤT — KHÔNG ĐÈ HÀNG `nguon='tay'` (NT-4).
   *   Luật đó KHÔNG nằm ở đây mà nằm trong `sinhBoCuc()`: hàm nhận `daCoThuCong`
   *   và tự loại các khoá đó khỏi `datCho`, khai chúng trong `boQua`. Ở đây ta
   *   chỉ dựng tập khoá ĐÚNG DẠNG (`khoaThucThe`) và ghi những gì nó trả về.
   *
   *   ⚠ Vì hàng bị bỏ qua KHÔNG có trong `datCho`, chúng không bao giờ vào lô
   *   ghi — tức là bảo vệ đến từ CẤU TRÚC (không có dữ liệu để đè) chứ không từ
   *   một câu `if` nào ở đường ghi. Đó là hình dạng đúng: một `if` bị sửa nhầm
   *   thì mất bảo vệ, còn "không có hàng để ghi" thì không sửa nhầm được.
   *
   * ★ Mọi hàng ghi ra mang `nguon='sinh'` ⇒ badge vàng "chưa đo" hiện đúng.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ QUYỀN — `adminProcedure`, KHÔNG phải `quyenThietKe("canCreate")`
   * ════════════════════════════════════════════════════════════════════════
   * §6.4 dòng 755 xếp "Sinh tự động, xuất bản phiên bản" vào cột `adminRoleProcedure`,
   * TÁCH khỏi ba dòng canView/canEdit/canCreate ở trên. Bản đầu dùng
   * `quyenThietKe("canCreate")` và hậu quả được dựng thành CA DƯƠNG, không phải
   * suy đoán: cấp `user_factory_assignments` cho `supervisor1` (vai supervisor,
   * KHÔNG admin, KHÔNG có `settings_factory`) rồi gọi procedure này → HTTP 200
   * `{"daGhi":81}`. Một tài khoản không-admin ĐÃ ghi đè 81 hàng bố cục.
   *
   * Vì sao mức quyền ở đây phải CHẶT HƠN các mutation khác của chính router này:
   * kéo-thả một máy sửa MỘT hàng và người làm nhìn thấy ngay kết quả, nên
   * `canEdit` là đủ. `sinhTuDong` ghi đè TOÀN BỘ bố cục trong một lượt (đo được:
   * 81 hàng) — đây là thao tác phá huỷ nhất của màn Thiết kế, và thứ duy nhất
   * cứu dữ liệu chỉnh tay là luật NT-4 `nguon='tay'` ở `sinhBoCuc`.
   *
   * ⚠ TÊN TRONG SPEC KHÔNG TỒN TẠI TRONG MÃ. Spec viết `adminRoleProcedure`;
   *   `server/_core/trpc.ts` KHÔNG export định danh nào tên đó (có
   *   `adminProcedure` và factory `roleProcedure(...)`). Chọn `adminProcedure` vì
   *   nó đúng NGHĨA spec mô tả (vai admin) và là khuôn mà ~20 router khác trong
   *   repo đã dùng. Chênh lệch TÊN này đã báo lại ở cổng ra, không tự sửa spec.
   *
   * ⚠ `adminProcedure` KÈM cổng 2FA (`batBuoc2FA()` — `trpc.ts:373`): ở triển
   *   khai internet-facing (`AUTH_2FA_BAT_BUOC` ≠ "0") admin CHƯA bật 2FA sẽ
   *   nhận `TWO_FACTOR_NOT_SET_UP` chứ không phải chạy được. Đó là hành vi ĐÚNG
   *   theo §8.4, nhưng nó là thay đổi hành vi thật nên ghi ra đây thay vì để ai
   *   đó phát hiện lúc nửa đêm.
   */
  sinhTuDong: adminProcedure
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        tangIds: z.array(z.number().int().positive()).max(50),
        cauHinh: cauHinhSinhSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const scope = phamViCua(ctx);
      const xemTruoc = await chuanBiSinh(input, scope);

      let daGhi = 0;
      let daTao = 0;
      let daCapNhat = 0;
      // Chia lô ≤ TRAN_LO_DAT_CHO. 42 máy hiện tại không cần chia, nhưng trần
      // của `ghiDatChoHangLoat` là thật và một nhà máy lớn hơn sẽ chạm nó.
      for (let i = 0; i < xemTruoc.datCho.length; i += TRAN_LO_DAT_CHO) {
        const lo = xemTruoc.datCho.slice(i, i + TRAN_LO_DAT_CHO);
        const ket = await ghiDatChoHangLoat(
          lo.map((h) => ({ ...h, nguon: "sinh" as const })),
          scope,
        );
        if (!ket) {
          throw appError(
            "NOT_FOUND",
            "ENTITY_NOT_FOUND",
            { entity: "twinTang" },
            "Có tầng không tồn tại hoặc ngoài phạm vi",
          );
        }
        daGhi += ket.daGhi;
        daTao += ket.daTao;
        daCapNhat += ket.daCapNhat;
      }

      return {
        daGhi,
        daTao,
        daCapNhat,
        giuNguyen: xemTruoc.boQua.length,
        boQua: xemTruoc.boQua,
        canhBao: xemTruoc.canhBao,
      };
    }),
});

export type TwinCanhRouter = typeof twinCanhRouter;
