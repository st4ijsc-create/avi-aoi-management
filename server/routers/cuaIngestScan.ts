/**
 * ★★★ BỘ SUY **"CỬA NÀY CÓ ĐI QUA ĐIỂM QUYẾT ĐỊNH PHIÊN BẢN NGEST KHÔNG"** — Pha 1C Task 3
 * (BG-21 ⛔ + BG-31), dùng cho `server/routers/cuaIngestCensus.test.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO QUÉT TRÊN CÂY (AST), KHÔNG TRÊN VĂN BẢN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bài học BG-16 (spec §13): lưới BG-14 dùng regex trên văn bản nguồn và XANH GIẢ vì nó soi đúng
 * dòng của một nhánh KHÔNG liên quan — trong khi lỗ thật nằm ở nhánh thứ hai mà regex không biết
 * tới. `quyetDinhPhienBanIngest` (`server/routers/machineApiRouters.ts`) không phải lúc nào cũng
 * được gọi TRỰC TIẾP trong thân một thủ tục: `submitInspection` gọi nó bên trong
 * `submitInspectionRouterInputSchema` — một `const` cấp module KHÁC, chỉ được THAM CHIẾU bằng
 * identifier tại `.input(submitInspectionRouterInputSchema)`. Một regex "có xuất hiện chữ
 * `quyetDinhPhienBanIngest` trong đoạn văn bản của thủ tục không" sẽ MÙ với hình dạng này (đúng
 * lớp lỗi BG-16 tái diễn qua một cửa khác) vì chữ đó không nằm trong đoạn văn bản của
 * `submitInspection`, nó nằm ở một `const` khác phía trên.
 *
 * ⇒ Bộ suy này đi trên CÂY: với mỗi cửa, nó duyệt subtree của property-initializer, và khi gặp một
 *   IDENTIFIER trỏ tới một khai báo CẤP FILE khác (`const X = …` / `function X() {…}`), nó MỞ RỘNG
 *   sang subtree của khai báo đó — một phép bao đóng CÓ ĐIỀU KIỆN (không lặp lại một tên hai lần),
 *   dừng khi không còn gì mới. Đây là dạng thu gọn của "bao đóng NGƯỢC" đã dùng ở
 *   `deployProcedureScan.ts#quetLenhPhaHuyVram` — cùng kỷ luật, phạm vi hẹp hơn (một file).
 *
 * ⚠ GIỚI HẠN ĐÃ BIẾT: đây là quan hệ TỚI ĐƯỢC (reachable), không phải "chắc chắn được gọi trên MỌI
 *   đường thực thi". Một cửa tham chiếu `quyetDinhPhienBanIngest` trong một nhánh `if` không bao
 *   giờ chạy vẫn được tính là "đã gác". Đủ cho mục tiêu của lưới này (bắt cửa KHÔNG NHẮC TỚI điểm
 *   quyết định lấy nửa vời nào cả), không đủ để chứng minh gọi VÔ ĐIỀU KIỆN — điều đó cần review
 *   mã bằng mắt cho hai cửa `gac` mà census xác nhận đứng đắn (xem §4 của lưới census).
 *
 * ── NHẬN DIỆN "CỬA INGEST" — VỊ TỪ, KHÔNG PHẢI DANH SÁCH TÊN ──────────────────────────────────
 * Repo này đặt tên nhất quán cho cửa nhận dữ liệu TỪ MÁY: `submit*` (submitInspection,
 * submitInspectionBatch, submitProcessResult, submitProcessResultBatch) và `sync*Result*`
 * (syncEdgeResults) — phân biệt được với các cửa `sync*` KHÁC không nhận kết quả đo
 * (syncMeasurementPoints, syncProductImage, syncPointImage, deltaSyncPoints — đồng bộ CẤU HÌNH/ẢNH
 * MẪU, không phải dữ liệu kiểm tra). Đây là tín hiệu CẤU TRÚC duy nhất còn lại trong mã hôm nay để
 * phân biệt "cửa nhận kết quả kiểm tra" khỏi hàng chục thủ tục `machineApiRouter` khác (heartbeat,
 * key rotation, config pull, deployment confirm…) — tất cả đều gọi `authenticateMachine`, nên
 * "gọi authenticateMachine" KHÔNG phải một vị từ phân biệt được. Vị từ này hỏi trên TÊN THUỘC TÍNH
 * (một node AST, không phải một chuỗi con của toàn văn bản file) — khác về CHẤT với việc chạy regex
 * trên toàn bộ nội dung file như BG-14 đã làm.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-29 (Task 2, BG-39) — CỬA THỨ SÁU: KHÔNG PHẢI RỦI RO TƯƠNG LAI, ĐÃ TỒN TẠI HÔM NAY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `aoiPackageRouter.presign`/`.commit` (`server/routers/aoiPackageRouter.ts`) là một cửa ingest
 * THỨ HAI, sống SONG SONG với năm cửa `machineApiRouter` ở trên — không phải một khả năng cần cân
 * nhắc, mà một đường ĐANG CHẠY THẬT: 10 bộ `idempotencyKey LIKE 'aoi-pkg:%'`, 238 gói
 * `status='committed'` trong `aoi_management_test`. Hai census trước đây (`cuaIngestCensus.test.ts`
 * ở đây, và `ghiInspectionWalCensus.test.ts`) đều "mù" với cửa này — vì HAI lý do KHÁC NHAU: file
 * này chỉ mở MỘT file (`machineApiRouters.ts`) nên chưa từng thấy `aoiPackageRouter.ts`;
 * `ghiInspectionWalScan.ts` THẤY `commit` (đã có trong `DUONG_FILE_QUET` từ trước) nhưng miễn trừ
 * nó với một lý do SAI diễn viên (đã sửa — xem lịch sử `MIEN_TRU_GHI_INSPECTION_WAL.commit`).
 *
 * Lượng từ "∀ cửa ingest…" của file này bây giờ CŨNG phủ `presign`/`commit` — xem
 * `TEN_BIEN_ROUTER_ZIP`, `laTenCuaIngestZip`, `MIEN_TRU_CUA_INGEST_ZIP` bên dưới. `commit` mang
 * MỘT lỗ thật CHƯA VÁ ở câu hỏi phiên bản ingest (`MIEN_TRU_CUA_INGEST_ZIP.commit` giải thích đầy
 * đủ) — không phải một dòng miễn trừ "cho xong việc", mà một khẳng định TƯỜNG MINH rằng câu hỏi đã
 * được hỏi và câu trả lời hôm nay là "chưa gác", chờ chủ dự án quyết định gác hay chấp nhận rủi ro.
 */
import ts from "typescript";

/** Tên hàm quyết định phiên bản ingest DÙNG CHUNG, khai ở `machineApiRouters.ts`. */
export const TEN_HAM_QUYET_DINH = "quyetDinhPhienBanIngest";

/** Tên biến giữ `router({…})` của máy — mục tiêu quét MẶC ĐỊNH (`machineApiRouters.ts`). */
export const TEN_BIEN_ROUTER = "machineApiRouter";

/**
 * ★★★ 2026-08-29 (Task 2, BG-39) — CỬA THỨ SÁU: `aoiPackageRouter.presign`/`.commit`
 * (`server/routers/aoiPackageRouter.ts`) là một đường ingest THỨ HAI, publicProcedure xác thực
 * bằng `authenticateMachine({scope:"ingest:write"})`, mà `commit` ghi thẳng `product_inspections`
 * qua `persistInspectionAtomic` — ĐÃ chạy thật (10 bộ `idempotencyKey LIKE 'aoi-pkg:%'`, 238 gói
 * `status='committed'` trong DB test). Đây KHÔNG phải một rủi ro kiến trúc trên giấy: cửa này
 * SỐNG hôm nay, cùng lúc với năm cửa `machineApiRouter` mà `TEN_BIEN_ROUTER`/`laTenCuaIngest` phía
 * trên đã canh — không đưa nó vào lượng từ "∀ cửa ingest…" là để lượng từ đó khai một điều SAI
 * (rằng nó đã xét MỌI cửa, trong khi thực ra chỉ xét một router).
 *
 * Tên biến router + vị từ tên của cửa này KHÁC HẲN năm cửa kia (xem `TEN_BIEN_ROUTER_ZIP`,
 * `laTenCuaIngestZip` bên dưới) — `quetCuaIngest` vì vậy nhận THÊM một tham số `tuyChon` (mặc định
 * giữ NGUYÊN hành vi cũ cho lời gọi không truyền gì) thay vì viết một bộ quét THỨ HAI: cùng một
 * hàm, cùng một kỹ thuật AST (`quetMotCay`/`coDuongToiQuyetDinh` không đổi một dòng), chỉ đổi
 * ĐIỂM VÀO (tên router) và VỊ TỪ (tên cửa nào được tính).
 */
export const TEN_BIEN_ROUTER_ZIP = "aoiPackageRouter";

/** Một cửa nhận dữ liệu kiểm tra từ máy, tìm thấy trong `machineApiRouter`. */
export interface CuaIngest {
  readonly ten: string;
  readonly dong: number;
  readonly loai: "query" | "mutation" | "subscription";
  /** Subtree của cửa này có TỚI ĐƯỢC một lời gọi `quyetDinhPhienBanIngest(...)` không. */
  readonly quaDiemQuyetDinh: boolean;
  /**
   * ★★★ Pha 1F Task 3 (BG-80) — tập ĐỊNH DANH tới được TỪ CHÍNH tham số truyền
   * cho `.input(...)` của cửa này (đệ quy qua khai báo cấp file, CÙNG bao đóng
   * `coDuongToiQuyetDinh` dùng — xem `taphopDinhDanhTiepCan`), KHÔNG bao gồm
   * thân `.mutation()`/`.query()` phía sau. Dùng để buộc "cửa ↔ schema nó THẬT
   * SỰ đăng ký ở `.input()`" bằng MÃ, không phải lời văn — kiểm tra
   * `dinhDanhOInput.has("tenSchema")` chứng minh AST-level rằng tên schema đó
   * THẬT SỰ được nhắc tới trong hình dạng `.input()` đã đăng ký, không phải
   * một cái tên census GIẢ ĐỊNH mà không ai kiểm.
   *
   * ⚠ GIỚI HẠN ĐÃ BIẾT (như `coDuongToiQuyetDinh`): đây là quan hệ THAM CHIẾU
   * ĐỊNH DANH, KHÔNG phải "cấu trúc hoàn toàn không đổi" — một `.input(X.extend({…}))`
   * viết thẳng tại chỗ VẪN nhắc tới định danh `X` (nên vẫn nằm trong tập này)
   * dù hình dạng THẬT SỰ đăng ký đã bị mở rộng thêm trường. Đóng lỗ "mở rộng
   * TẠI CHỖ vô hình" cần một kỹ thuật khác (so khớp THAM CHIẾU object lúc chạy,
   * xem `capChuoiVarcharDuongIngestMacDinh.test.ts` §0 cho các cửa áp dụng
   * được) — trường này chỉ chứng minh "census không soi một cái tên schema
   * KHÔNG LIÊN QUAN gì tới cửa thật", không chứng minh "schema đăng ký chưa hề
   * bị sửa hình dạng tại chỗ".
   *
   * `null` nếu cửa này KHÔNG gọi `.input(...)` ở đâu trong subtree (không xảy
   * ra với 7 cửa ingest hôm nay — mọi mutation ingest đều có `.input()`).
   */
  readonly dinhDanhOInput: ReadonlySet<string> | null;
  /**
   * ★★★ Pha 1F Task 3 (BG-80) — tập ĐỊNH DANH tới được từ TOÀN BỘ thân thủ
   * tục (input + mutation/query) — RỘNG HƠN và YẾU HƠN `dinhDanhOInput`: một
   * tên xuất hiện Ở ĐÂY có thể chỉ là dùng lại trong LOGIC XỬ LÝ, không chứng
   * minh nó là schema `.input()`. CHỈ dùng cho cửa có payload đo lường KHÔNG
   * nằm trong `.input()` (ví dụ `commit` — `meta.json` được parse TRONG thân
   * `.mutation()`, sau khi tải ZIP về, xem `MIEN_TRU_CUA_INGEST_ZIP.commit`).
   * Mọi cửa khác nên ưu tiên `dinhDanhOInput` (hẹp hơn, ít dương tính giả hơn).
   */
  readonly dinhDanhCaThan: ReadonlySet<string>;
}

export interface KetQuaQuetCuaIngest {
  readonly cua: readonly CuaIngest[];
  /** Ô KHÔNG phân giải được — mỗi mục là một chỗ KHÔNG AI CANH ⇒ lưới phải ĐỎ. */
  readonly mu: readonly string[];
}

/**
 * Cửa nhận dữ liệu kiểm tra từ máy, nhận theo TÊN THUỘC TÍNH — xem khối lý lẽ ở đầu file.
 *
 * ★★★ Pha 1F Task 3 (BG-80) — `export` (KHÔNG đổi hình dạng/hành vi). TRƯỚC bản vá này hàm
 * KHÔNG được export ⇒ `capChuoiVarcharDuongIngestMacDinh.test.ts` (census `.max()` cho các cửa
 * ingest) không thể TÁI DÙNG đúng vị từ mà `cuaIngestCensus.test.ts` đã tin cậy — nó phải viết lại
 * một danh sách TÊN CỬA bằng tay (`DANH_SACH_SCHEMA_INGEST`), tách rời khỏi vị từ THẬT. Export ở
 * đây là điều kiện CẦN (không đủ — còn cần nối bằng mã, xem `taphopDinhDanhTiepCan` bên dưới và
 * §0 của file test kia) để hai census không còn là hai lời khai độc lập không kiểm tra lẫn nhau.
 */
export function laTenCuaIngest(ten: string): boolean {
  return /^submit/i.test(ten) || /^sync.*result/i.test(ten);
}

/**
 * Vị từ tên của cửa ZIP package (`aoiPackageRouter.ts`) — CỬA THỨ SÁU (BG-39). DANH SÁCH TÊN
 * TƯỜNG MINH, KHÔNG PHẢI REGEX như `laTenCuaIngest`: router này đặt tên theo quy ước KHÁC hẳn
 * (`presign`, `commit` — không mang tiền tố `submit`/`sync…Result`) và có nhiều thủ tục ĐỌC không
 * liên quan gì tới ingest (`listPackages`, `getPackage`, `getImage`, `getPackageImages`,
 * `getPackageLogs`, `downloadZip`, `reportQueueMetrics`, `getQueueStatus`, `getUploadStats`) — mở
 * rộng một vị từ kiểu regex sang router này có nguy cơ vô tình khớp một thủ tục đọc trong tương
 * lai. Chỉ HAI thủ tục mang dữ liệu/tham chiếu một gói máy tải lên:
 * - `presign`: KHÔNG mang payload đo lường (chỉ `inspectionId`/`sizeBytes`/`sha256`) — xem
 *   `MIEN_TRU_CUA_INGEST_ZIP.presign` cho lý do miễn trừ CÓ THẬT (không phải lách).
 * - `commit`: parse `meta.json` TỪ TRONG ZIP, có trường `measurements` — đây LÀ cửa mang dữ liệu
 *   kiểm tra thật, và là cửa mà `cuaIngestCensus.test.ts` §3 phải hỏi "có gác không".
 */
export function laTenCuaIngestZip(ten: string): boolean {
  return ten === "presign" || ten === "commit";
}

/**
 * ★★★ SỔ MIỄN TRỪ cho cửa ZIP (BG-39, 2026-08-29) — đặt CẠNH bộ suy, KHÔNG đặt trong
 * `aoiPackageRouter.ts`, theo ĐÚNG tiền lệ `MIEN_TRU_GHI_INSPECTION_WAL`
 * (`ghiInspectionWalScan.ts`): (a) brief Task 2 CẤM tự sửa hành vi `aoiPackageRouter.ts` — đường
 * đó đang chạy thật (238 gói `committed` trong DB test), đổi hành vi của nó cần người duyệt; (b)
 * `MIEN_TRU_QUYET_DINH_PHIEN_BAN` (`machineApiRouters.ts`) được dựng riêng cho cửa của ĐÚNG router
 * đó, không phải chỗ tự nhiên cho một cửa sống ở FILE khác. `cuaIngestCensus.test.ts` hợp cả hai
 * sổ (dict này + của `machineApiRouters.ts`) trước khi áp luật §3 — hai sổ không đụng tên (kiểm
 * bằng test) nên hợp bằng spread object là an toàn.
 *
 * ⚠ CẬP NHẬT (Lô 3 Mục 3, BG-39 gđ2, 2026-09-05) — `commit` KHÔNG còn là "lỗ thật chưa vá": nó
 * nay tự gác hình dạng phẳng NGAY TRONG THÂN thủ tục (`ingestRejectLegacyMachineEnabled() &&
 * !laHinhDangCayV2(metaRaw)` trên JSON thô của `meta.json`, TRƯỚC `metaJsonSchema.parse()`) — CÙNG
 * ba khối dùng chung với đường v1 trực tiếp (`laHinhDangCayV2`, `loiMayChuaNangCap`,
 * `ingestRejectLegacyMachineEnabled`, cả ba export/định nghĩa ở `machineDataContract.ts`/
 * `machineApiRouters.ts`). `commit` VẪN nằm trong sổ miễn trừ này (KHÔNG chuyển sang "đã gác" ở
 * §3/§4 của `cuaIngestCensus.test.ts`) vì lý do KIẾN TRÚC thật, không phải sót: nó không gọi
 * `quyetDinhPhienBanIngest` (hàm đó nhận `raw: unknown` ở TẦNG payload `submitInspection`, không
 * khớp tầng `meta.json` bên trong một ZIP — gọi nó ở đây sẽ phải giả lập một request-shape không
 * tồn tại). Bộ suy AST (`quetCuaIngest`) chỉ biết hỏi "có tới được `quyetDinhPhienBanIngest`
 * không" — nó KHÔNG thấy được cổng dùng vị từ CHUNG nhưng gọi trực tiếp, nên `commit` tiếp tục
 * cần một dòng miễn trừ TƯỜNG MINH khẳng định "đã gác, bằng cách khác, có lý do" thay vì để census
 * đọc nhầm thành "chưa gác".
 */
export const MIEN_TRU_CUA_INGEST_ZIP: Readonly<Record<string, string>> = {
  presign:
    "`presign` không mang bất kỳ trường `measurements`/`surfaces` nào — input schema của nó " +
    "(aoiPackageRouter.ts:412-420) chỉ có `apiKey|machineCode`, `inspectionId`, `sizeBytes`, " +
    "`sha256`: một yêu cầu 'xin phép tải lên', không phải một payload đo lường. Câu hỏi " +
    "`quyetDinhPhienBanIngest` hỏi ('payload này hình dạng phẳng v1.x hay cây v2.0?') VÔ NGHĨA ở " +
    "bước này vì chưa có payload đo lường nào tồn tại để phân loại — nó nằm TRONG ZIP, chỉ xuất " +
    "hiện ở bước `commit`. Cùng LỚP lý do mà `syncEdgeResults` (machineApiRouters.ts) đã được " +
    "chấp nhận: 'không phải một payload đo lường máy theo hợp đồng v1.x/v2.0 nào'.",
  commit:
    "★ ĐÃ GÁC (Lô 3 Mục 3, BG-39 gđ2) — không tới được `quyetDinhPhienBanIngest` (hàm đó nhận " +
    "payload TẦNG `submitInspection`, không khớp `meta.json` TRONG ZIP), nhưng `commit` tự gác " +
    "BẰNG CHÍNH ba khối dùng chung mà `quyetDinhPhienBanIngest` cũng dùng: đọc `meta.json` thành " +
    "JSON thô (`metaRaw`) rồi hỏi `ingestRejectLegacyMachineEnabled() && !laHinhDangCayV2(metaRaw)` " +
    "TRƯỚC khi ép qua `metaJsonSchema.parse()` — khớp `true` ⇒ ném `loiMayChuaNangCap` (CÙNG thông " +
    "điệp v1) + ghi tín hiệu `ingest_shape_legacy_rejected` (BG-57b), commit dừng ở đó. Đo TRƯỚC " +
    "khi vá: `metaJsonSchema` (BG-85) yêu cầu `surfaces` BẮT BUỘC nên một payload PHẲNG THẬT không " +
    "bao giờ tới được `metaData` — nó ném `ZodError` ngay tại `.parse()`; đó là lý do gác PHẢI hỏi " +
    "trên `metaRaw` (thô), không phải trên `metaData` (sau parse, nơi `laHinhDangCayV2` luôn `true` " +
    "vì `surfaces` — dù rỗng — đã LÀ một mảng theo hợp đồng). Cờ TẮT (mặc định) ⇒ nhánh gác không " +
    "chạy, hành vi giữ NGUYÊN mệnh đề 4 của `aoiPackageBienBg85.test.ts` (ZodError, `'failed'`, " +
    "KHÔNG BAO GIỜ `'dead'`). `commit` VẪN nằm trong sổ miễn trừ (không chuyển 'đã gác' ở §3/§4) vì " +
    "bộ suy AST chỉ nhận diện lời gọi TRỰC TIẾP `quyetDinhPhienBanIngest(...)` — dòng miễn trừ này " +
    "là lời khẳng định TƯỜNG MINH rằng cổng đã đóng bằng đường khác, có kiểm chứng bằng test " +
    "(`aoiPackageZipGacMayCu.test.ts`), không phải một lỗ còn sót.",
};

/** `router({…})` của một biểu thức lời gọi — bỏ qua, không cần theo `.use()` bọc ngoài (không có ở đây). */
function objRouter(n: ts.Node): ts.ObjectLiteralExpression | null {
  if (
    ts.isCallExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === "router" &&
    n.arguments[0] !== undefined &&
    ts.isObjectLiteralExpression(n.arguments[0])
  ) {
    return n.arguments[0];
  }
  return null;
}

/** Loại thủ tục tRPC của một chuỗi (`…query(fn)` / `…mutation(fn)` / `…subscription(fn)`). */
function loaiThuTuc(n: ts.Node): CuaIngest["loai"] | null {
  let loai: CuaIngest["loai"] | null = null;
  const di = (x: ts.Node): void => {
    if (loai === null && ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
      const m = x.expression.name.text;
      if ((m === "query" || m === "mutation" || m === "subscription") && x.arguments[0] !== undefined) loai = m;
    }
    ts.forEachChild(x, di);
  };
  di(n);
  return loai;
}

/**
 * Một lượt quét MỘT cây con: có lời gọi `quyetDinhPhienBanIngest(...)` TRỰC TIẾP trong subtree
 * này không, và tập ĐỊNH DANH nào xuất hiện (bỏ tên thuộc tính `.x` / khoá object `{x: …}` — chúng
 * KHÔNG phải một ràng buộc tên, chép đúng kỷ luật `dinhDanhTrong` của `deployProcedureScan.ts`).
 */
function quetMotCay(n: ts.Node): { goiTrucTiep: boolean; dinhDanh: ReadonlySet<string> } {
  let goiTrucTiep = false;
  const dinhDanh = new Set<string>();
  const di = (x: ts.Node): void => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === TEN_HAM_QUYET_DINH) {
      goiTrucTiep = true;
    }
    if (ts.isPropertyAccessExpression(x)) {
      di(x.expression);
      return;
    }
    if ((ts.isPropertyAssignment(x) || ts.isPropertySignature(x)) && x.name !== undefined) {
      if (ts.isPropertyAssignment(x)) di(x.initializer);
      return;
    }
    if (ts.isIdentifier(x)) dinhDanh.add(x.text);
    ts.forEachChild(x, di);
  };
  di(n);
  return { goiTrucTiep, dinhDanh };
}

/**
 * Bao đóng CÓ ĐIỀU KIỆN từ `root`: có TỚI ĐƯỢC một lời gọi `quyetDinhPhienBanIngest` không, đi
 * qua các khai báo CẤP FILE mà `root` (hoặc bất kỳ khai báo nào mở rộng ra từ nó) tham chiếu tới.
 */
function coDuongToiQuyetDinh(root: ts.Node, khaiBao: ReadonlyMap<string, ts.Node>): boolean {
  const daTham = new Set<string>();
  const hangDoi: ts.Node[] = [root];
  let i = 0;
  while (i < hangDoi.length) {
    const node = hangDoi[i++];
    if (node === undefined) continue;
    const { goiTrucTiep, dinhDanh } = quetMotCay(node);
    if (goiTrucTiep) return true;
    for (const id of dinhDanh) {
      if (daTham.has(id)) continue;
      daTham.add(id);
      const khai = khaiBao.get(id);
      if (khai !== undefined) hangDoi.push(khai);
    }
  }
  return false;
}

/**
 * ★★★ Pha 1F Task 3 (BG-80) — trích ARGUMENT ĐẦU TIÊN của lời gọi `.input(...)` trong subtree của
 * MỘT cửa (`p.initializer`, chuỗi `publicProcedure.input(X).mutation(fn)`). `null` nếu không tìm
 * thấy `.input(...)` nào (không xảy ra với 7 cửa ingest hôm nay).
 *
 * Vì sao TÁCH RIÊNG khỏi việc quét cả `p.initializer`: `quetMotCay`/BFS quét TOÀN BỘ subtree (kể cả
 * thân `.mutation()` phía sau `.input()`) — cần cho `coDuongToiQuyetDinh` (BG-21) vì
 * `quyetDinhPhienBanIngest` có thể được gọi ở TRONG thân mutation (không chỉ ở `.input()`, xem
 * HỒI QUY test `cuaIngestCensus.test.ts §4` chèn lời gọi ngay đầu `.mutation()` của `commit`). Nhưng
 * câu hỏi BG-80 ("cửa ↔ SCHEMA nó đăng ký ở `.input()`") hẹp hơn: nếu quét cả thân mutation, một tên
 * schema xuất hiện lại đâu đó trong logic xử lý (vd ép kiểu `as z.infer<typeof X>`) sẽ tạo DƯƠNG
 * TÍNH GIẢ — "census tưởng đã nối, thực ra chỉ tình cờ trùng tên ở một chỗ không liên quan
 * `.input()`". Giới hạn phạm vi về ĐÚNG argument của `.input(...)` loại bỏ lớp dương tính giả đó.
 */
function layThamSoInput(root: ts.Node): ts.Node | null {
  let ra: ts.Node | null = null;
  const di = (x: ts.Node): void => {
    if (ra !== null) return;
    if (
      ts.isCallExpression(x) &&
      ts.isPropertyAccessExpression(x.expression) &&
      x.expression.name.text === "input" &&
      x.arguments[0] !== undefined
    ) {
      ra = x.arguments[0];
      return;
    }
    ts.forEachChild(x, di);
  };
  di(root);
  return ra;
}

/**
 * ★★★ Pha 1F Task 3 (BG-80) — bao đóng CÓ ĐIỀU KIỆN từ `root`, TRẢ VỀ toàn bộ tập ĐỊNH DANH tới
 * được (không chỉ true/false cho MỘT tên như `coDuongToiQuyetDinh`) — CÙNG thuật toán BFS/hàng đợi,
 * tái dùng `quetMotCay` KHÔNG chế lại (đối xứng `coDuongToiQuyetDinh`, chỉ khác điểm dừng: gom UNION
 * thay vì trả sớm khi khớp một tên). Dùng cho `dinhDanhOInput`/`dinhDanhCaThan` của `CuaIngest`.
 */
function taphopDinhDanhTiepCan(root: ts.Node, khaiBao: ReadonlyMap<string, ts.Node>): ReadonlySet<string> {
  const daTham = new Set<string>();
  const tong = new Set<string>();
  const hangDoi: ts.Node[] = [root];
  let i = 0;
  while (i < hangDoi.length) {
    const node = hangDoi[i++];
    if (node === undefined) continue;
    const { dinhDanh } = quetMotCay(node);
    for (const id of dinhDanh) {
      tong.add(id);
      if (daTham.has(id)) continue;
      daTham.add(id);
      const khai = khaiBao.get(id);
      if (khai !== undefined) hangDoi.push(khai);
    }
  }
  return tong;
}

/**
 * Tuỳ chọn override cho `quetCuaIngest` — mặc định KHÔNG truyền gì giữ NGUYÊN VĂN hành vi cũ (một
 * file, router `machineApiRouter`, vị từ `submit…` / `sync…Result…`; đây là điều kiện để §1-§5 của
 * `cuaIngestCensus.test.ts` trên `machineApiRouters.ts` không hồi quy khi thêm cửa thứ sáu). Cửa
 * thứ SÁU (BG-39) sống ở một FILE khác, biến router tên khác, quy ước đặt tên khác — thay vì viết
 * một bộ quét THỨ HAI (cấm theo brief Task 2), hàm nhận một vị từ/tên router THAY THẾ và chạy lại
 * CHÍNH kỹ thuật AST cũ (`quetMotCay`/`coDuongToiQuyetDinh` không đổi một dòng).
 */
export interface TuyChonQuetCuaIngest {
  readonly tenBienRouter?: string;
  readonly laTenCua?: (ten: string) => boolean;
}

/**
 * Quét `ma` (nội dung một file router, TRUYỀN VÀO chứ không tự đọc đĩa — cho phép lưới census
 * chạy lại bộ suy này trên một biến thể ĐÃ CHÈN đột biến, hoàn toàn TRONG BỘ NHỚ, không ghi đè
 * file thật) và trả mọi cửa khớp `tuyChon.laTenCua` (mặc định `submit*`/`sync*Result*`) trong biến
 * `tuyChon.tenBienRouter` (mặc định `machineApiRouter`).
 *
 * @param duong đường hiển thị trong lỗi (không cần là đường thật trên đĩa).
 * @param ma nội dung mã nguồn TypeScript.
 * @param tuyChon override router/vị từ — xem `TuyChonQuetCuaIngest`. Dùng cho cửa thứ sáu
 *   (`aoiPackageRouter.ts`, xem `TEN_BIEN_ROUTER_ZIP`/`laTenCuaIngestZip`).
 */
export function quetCuaIngest(duong: string, ma: string, tuyChon?: TuyChonQuetCuaIngest): KetQuaQuetCuaIngest {
  const tenBienRouter = tuyChon?.tenBienRouter ?? TEN_BIEN_ROUTER;
  const laTenCua = tuyChon?.laTenCua ?? laTenCuaIngest;
  const mu: string[] = [];
  const sf = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** Mọi khai báo CẤP FILE (const/function) — tên → subtree khởi tạo/thân. */
  const khaiBao = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer !== undefined) khaiBao.set(d.name.text, d.initializer);
      }
    } else if (ts.isFunctionDeclaration(st) && st.name !== undefined && st.body !== undefined) {
      khaiBao.set(st.name.text, st.body);
    }
  }

  let routerObj: ts.ObjectLiteralExpression | null = null;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === tenBienRouter && d.initializer !== undefined) {
        routerObj = objRouter(d.initializer);
      }
    }
  }
  if (routerObj === null) {
    mu.push(`${duong} — không tìm thấy \`const ${tenBienRouter} = router({…})\` — bộ suy mất mục tiêu`);
    return { cua: [], mu };
  }

  const cua: CuaIngest[] = [];
  for (const p of routerObj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const ten = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    if (ten === null || !laTenCua(ten)) continue;
    const loai = loaiThuTuc(p.initializer);
    if (loai === null) continue; // khớp tên nhưng không phải một thủ tục tRPC thật
    const dong = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
    // BG-80 — dinhDanhOInput: PHẠM VI HẸP (chỉ argument của .input(...)); dinhDanhCaThan: PHẠM VI
    // RỘNG (cả thủ tục) — xem docblock hai trường này ở `CuaIngest` cho lý do tách riêng.
    const thamSoInput = layThamSoInput(p.initializer);
    const dinhDanhOInput = thamSoInput !== null ? taphopDinhDanhTiepCan(thamSoInput, khaiBao) : null;
    const dinhDanhCaThan = taphopDinhDanhTiepCan(p.initializer, khaiBao);
    cua.push({
      ten,
      dong,
      loai,
      quaDiemQuyetDinh: coDuongToiQuyetDinh(p.initializer, khaiBao),
      dinhDanhOInput,
      dinhDanhCaThan,
    });
  }

  return { cua, mu };
}

/**
 * ★★★ Pha 1F Task 8 (I-3) — bằng chứng CHẶT cho "cửa `tenCua` có gọi
 * `<tenSchema>.parse(...)`/`.safeParse(...)` THẬT", KHÁC HẲN `dinhDanhCaThan`
 * (định danh `tenSchema` xuất hiện Ở ĐÂU ĐÓ trong thân thủ tục).
 *
 * Đo được TRƯỚC hàm này tồn tại: `capChuoiVarcharDuongIngestMacDinh.test.ts`
 * §0d khẳng định `dinhDanhCaThan.has("metaJsonSchema") === true` cho `commit`
 * làm bằng chứng "commit còn dùng metaJsonSchema" — nhưng đột biến SỐNG xoá
 * `metaJsonSchema.parse(...)` (aoiPackageRouter.ts:884) mà GIỮ khai báo kiểu
 * `let metaData: z.infer<typeof metaJsonSchema> | null = null;` (:857) khiến
 * khẳng định đó VẪN đúng — `z.infer<typeof X>` là một TYPE QUERY, một node
 * AST THẬT tham chiếu định danh `X`, không phải một dòng chú giải; `dinhDanhCaThan`
 * (quét MỌI định danh trong subtree, không phân biệt vị trí cú pháp) không
 * phân biệt được nó với một lời gọi `.parse()` thật. Hàm này hẹp hơn CÓ CHỦ
 * ĐÍCH: chỉ nhận một CALL EXPRESSION khớp mẫu `tenSchema.parse(...)` hoặc
 * `tenSchema.safeParse(...)` — một type query hay một biến trùng tên KHÔNG
 * làm nó trả `true`.
 *
 * CÙNG bao đóng "tới được qua khai báo cấp file" (`quetMotCay`/hàng đợi) như
 * `taphopDinhDanhTiepCan`/`coDuongToiQuyetDinh` — nếu `.parse()` được gọi
 * trong một hàm helper cấp file được cửa này tham chiếu, vẫn tính.
 *
 * Ném lỗi (không trả `false` im lặng) nếu không tìm thấy router/cửa — mất
 * mục tiêu phải ồn ào, không được đọc nhầm thành "không có lời gọi .parse()".
 */
export function coLoiGoiParseTrenSchema(
  duong: string,
  ma: string,
  tenCua: string,
  tenSchema: string,
  tuyChon?: TuyChonQuetCuaIngest,
): boolean {
  const tenBienRouter = tuyChon?.tenBienRouter ?? TEN_BIEN_ROUTER;
  const laTenCua = tuyChon?.laTenCua ?? laTenCuaIngest;
  const sf = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const khaiBao = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer !== undefined) khaiBao.set(d.name.text, d.initializer);
      }
    } else if (ts.isFunctionDeclaration(st) && st.name !== undefined && st.body !== undefined) {
      khaiBao.set(st.name.text, st.body);
    }
  }

  let routerObj: ts.ObjectLiteralExpression | null = null;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === tenBienRouter && d.initializer !== undefined) {
        routerObj = objRouter(d.initializer);
      }
    }
  }
  if (routerObj === null) {
    throw new Error(`${duong} — không tìm thấy \`const ${tenBienRouter} = router({…})\` — bộ suy mất mục tiêu`);
  }

  let target: ts.Node | null = null;
  for (const p of routerObj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const ten = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    if (ten !== null && laTenCua(ten) && ten === tenCua) {
      target = p.initializer;
      break;
    }
  }
  if (target === null) {
    throw new Error(`${duong} — không tìm thấy cửa "${tenCua}" trong \`${tenBienRouter}\` — bộ suy mất mục tiêu`);
  }

  const daTham = new Set<string>();
  const hangDoi: ts.Node[] = [target];
  let i = 0;
  while (i < hangDoi.length) {
    const node = hangDoi[i++];
    if (node === undefined) continue;
    let timThayGoiParse = false;
    const dinhDanh = new Set<string>();
    const di = (x: ts.Node): void => {
      if (timThayGoiParse) return;
      if (
        ts.isCallExpression(x) &&
        ts.isPropertyAccessExpression(x.expression) &&
        (x.expression.name.text === "parse" || x.expression.name.text === "safeParse") &&
        ts.isIdentifier(x.expression.expression) &&
        x.expression.expression.text === tenSchema
      ) {
        timThayGoiParse = true;
        return;
      }
      if (ts.isPropertyAccessExpression(x)) {
        di(x.expression);
        return;
      }
      if ((ts.isPropertyAssignment(x) || ts.isPropertySignature(x)) && x.name !== undefined) {
        if (ts.isPropertyAssignment(x)) di(x.initializer);
        return;
      }
      if (ts.isIdentifier(x)) dinhDanh.add(x.text);
      ts.forEachChild(x, di);
    };
    di(node);
    if (timThayGoiParse) return true;
    for (const id of dinhDanh) {
      if (daTham.has(id)) continue;
      daTham.add(id);
      const khai = khaiBao.get(id);
      if (khai !== undefined) hangDoi.push(khai);
    }
  }
  return false;
}
