/**
 * ★★★ BỘ SUY **"LỜI GỌI GHI `product_inspections` NÀY CÓ ĐI QUA WAL (`bufferSubmission`)
 * KHÔNG"** — Task 3, kế hoạch `docs/superpowers/plans/2026-08-29-aoi-wal-cho-cay-v2.md`,
 * dùng cho `server/routers/ghiInspectionWalCensus.test.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO QUÉT TRÊN CÂY (AST), KHÔNG TRÊN VĂN BẢN — VÀ VÌ SAO KHÔNG SỬA `cuaIngestScan.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cùng bài học BG-16 mà `cuaIngestScan.ts` (Pha 1C Task 3) đã trả giá: một lưới regex trên văn
 * bản có thể XANH GIẢ vì soi trúng dòng của một nhánh KHÔNG liên quan trong khi lỗ thật nằm ở một
 * nhánh khác regex không biết tới. File này KHÔNG sửa `cuaIngestScan.ts` (đang được
 * `cuaIngestCensus.test.ts` của Pha 1C phụ thuộc — sửa nó tăng rủi ro hồi quy một lưới đã xanh của
 * PHA KHÁC một cách không cần thiết); thay vào đó nó CHÉP LẠI ĐÚNG kỹ thuật của
 * `cuaIngestScan.ts` (`quetMotCay` + bao đóng "tới-được" theo định danh cấp file, xem
 * `coDuongToi` bên dưới) và TỔNG QUÁT HOÁ nó: tên hàm mục tiêu là THAM SỐ, và bộ quét chạy trên
 * NHIỀU file (một request khác với "cửa" của Pha 1C — vốn tất cả nằm trong MỘT object
 * `machineApiRouter`). Đây vẫn là AST, không phải regex — không phải "bộ quét thứ hai" theo nghĩa
 * cách tiếp cận khác, chỉ là cùng kỹ thuật áp cho một câu hỏi khác.
 *
 * ── CÂU HỎI ─────────────────────────────────────────────────────────────────────────────────
 * Mọi thủ tục GHI vào bảng `product_inspections` (bảng WORM — `avi_app` không có DELETE) phải
 * hoặc đi qua WAL (`inspectionStoreForward.bufferSubmission`) khi lỗi TẠM THỜI, hoặc có tên
 * trong sổ miễn trừ kèm lý do — nếu không, một đợt DB chập chờn có thể ghi một hàng MỒ CÔI/SAI
 * VĨNH VIỄN không xoá được (xem task-3-brief.md).
 *
 * ── HAI TẦNG CỦA CÂU HỎI ────────────────────────────────────────────────────────────────────
 * 1) "Hàm này có THẬT SỰ ghi vào `product_inspections` không?" — trả lời bằng một danh sách TÊN
 *    HÀM GHI đã biết (`TEN_CAC_HAM_GHI`): hai hàm cấp DB (`createProductInspection`,
 *    `persistInspectionAtomic`, `server/db/inspection.ts` — hai đường ghi header CÒN SỐNG hôm
 *    nay, chọn bằng cờ `INSPECTION_SINGLE_TX_ENABLED`) và hai hàm ROUTER bọc chúng
 *    (`processInspectionSubmission` — v1.x, `submitInspectionTreeV2` — v2.0,
 *    `server/routers/machineApiRouters.ts`). ĐÂY LÀ VỊ TỪ THEO TÊN (giống BG-34 của
 *    `cuaIngestScan.ts`) — xem "TRẦN" bên dưới.
 * 2) "Ai GỌI các hàm đó, và nơi gọi có bảo vệ WAL không?" — bộ suy tìm mọi CALL SITE của bốn tên
 *    trên trong một tập file cố định (KHÔNG kể chính định nghĩa của chúng — hai hàm router tự gọi
 *    hai hàm DB bên trong thân của mình, đó là CHI TIẾT TRIỂN KHAI, không phải một "đường ghi"
 *    cần WAL riêng: WAL luôn được bọc ở NƠI GỌI `processInspectionSubmission`/
 *    `submitInspectionTreeV2`, không bao giờ ở BÊN TRONG chúng — xác nhận bằng đọc mã, không phải
 *    giả thuyết). Với mỗi call site, tìm `TryStatement` GẦN NHẤT bao nó; nếu có, subtree của
 *    try đó (try + catch + finally) có TỚI ĐƯỢC lời gọi `bufferSubmission` không (bao đóng theo
 *    định danh CÙNG FILE, y hệt kỹ thuật `coDuongToiQuyetDinh` của `cuaIngestScan.ts`). KHÔNG có
 *    try bao quanh ⇒ coi là KHÔNG bảo vệ NGAY (bảo thủ: thà báo đỏ nhầm còn hơn bỏ sót).
 *
 * ── NHÃN MỘT "ĐƯỜNG GHI" ────────────────────────────────────────────────────────────────────
 * `tên-phạm-vi-bao-quanh → tên-hàm-ghi` (vd. `submitInspection→submitInspectionTreeV2`). Phạm vi
 * bao quanh = tên THUỘC TÍNH router gần nhất (`submitInspection`, `commit`) HOẶC tên hàm/biến
 * cấp gần nhất (`runItem`, `submitCanonical`, `ensureInspectionWalWired`,
 * `initInspectionStoreForward`) — nhờ đó HAI nhánh v1.x/v2.0 nằm chung MỘT thuộc tính router
 * (`submitInspection`) vẫn tách được thành HAI đường riêng (khớp nhau ở tên phạm vi, khác nhau ở
 * tên hàm ghi), thay vì gộp lẫn WAL của nhánh này che mất lỗ của nhánh kia.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ TRẦN CỦA CÁCH TIẾP CẬN — ĐỌC TRƯỚC KHI TIN LƯỚI NÀY "KÍN" ⚠⚠⚠
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * (1) VỊ TỪ THEO TÊN, KHÔNG PHẢI BẤT BIẾN KIỂU (BG-34 tái diễn): `TEN_CAC_HAM_GHI` là một danh
 *     sách bốn tên hàm GHI TAY. Một hàm MỚI ghi thẳng vào bảng kiểm tra qua drizzle (bỏ qua bốn
 *     tên này, hoặc đổi tên một trong bốn) sẽ VÔ HÌNH với bộ suy — không đỏ, không mù,
 *     chỉ đơn giản là bộ suy không biết nó tồn tại. `§0` của lưới census kiểm tra
 *     `TEN_CAC_HAM_GHI` còn khớp mã thật (còn định nghĩa, đúng ký hiệu `export … function`) để
 *     giảm rủi ro này, nhưng KHÔNG bắt được một đường ghi hoàn toàn MỚI dùng một cơ chế khác.
 * (2) TẬP FILE QUÉT LÀ CỐ ĐỊNH (`FILES_QUET` bên dưới), KHÔNG tự phát hiện file mới. Một file
 *     thứ sáu gọi `processInspectionSubmission`/`persistInspectionAtomic`/… sẽ bị BỎ SÓT HOÀN
 *     TOÀN cho tới khi ai đó thêm nó vào danh sách — không có tín hiệu nào báo rằng danh sách
 *     thiếu (khác `§0`, không có "cầu chì" cho trường hợp này).
 * (3) "BẢO VỆ WAL" = TỚI ĐƯỢC (reachable) `bufferSubmission` từ subtree `TryStatement` GẦN NHẤT
 *     bao lời gọi ghi — giống `cuaIngestScan.ts`, đây là quan hệ TỚI ĐƯỢC, không phải "chắc chắn
 *     chạy trên MỌI nhánh lỗi". Một `catch` gọi `bufferSubmission` trong một `if` không bao giờ
 *     đúng vẫn được tính là "có bảo vệ". Ngược lại, bộ suy KHÔNG phân biệt try-block/catch-block/
 *     finally-block — một lời gọi `bufferSubmission` nằm ở `finally` (hoặc một nhánh `if` không
 *     liên quan tới lỗi, miễn còn trong subtree của CÙNG `TryStatement`) vẫn được tính là bảo vệ,
 *     dù logic runtime thật có thể sai.
 * (4) KHÔNG BẮT ĐƯỢC BẢO VỆ QUA `.catch()` PROMISE CHAIN hay `try` Ở MỘT PHẠM VI KHÁC (vd. một
 *     helper dùng chung không nằm trong `TryStatement` cú pháp bao trực tiếp lời gọi ghi). Nếu
 *     mã tương lai đổi khuôn bảo vệ sang một dạng khác `try/catch` đồng bộ, bộ suy này sẽ báo ĐỎ
 *     SAI (không nhận diện được bảo vệ THẬT) — cần cập nhật `timTryBaoQuanh`.
 * (5) BAO ĐÓNG THEO ĐỊNH DANH CHỈ TRONG CÙNG FILE (y hệt `cuaIngestScan.ts`): nếu `bufferSubmission`
 *     được gọi gián tiếp qua một helper định nghĩa Ở FILE KHÁC, bộ suy sẽ không theo được (không
 *     xảy ra trong mã hôm nay — xác nhận bằng đọc mã — nhưng là giới hạn CẤU TRÚC, không phải một
 *     điều đã kiểm chứng sẽ luôn đúng).
 * (6) PHẠM VI BAO QUANH LẤY THEO TÊN GẦN NHẤT (`FunctionDeclaration` có tên / biến khởi tạo bằng
 *     hàm / thuộc tính object) — một lời gọi ghi nằm trong một callback ẨN DANH lồng sâu (không
 *     có TÊN nào bao trực tiếp) sẽ rơi vào `mu` (ô mù, lưới phải ĐỎ) thay vì bị gán nhãn sai.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import ts from "typescript";

/**
 * Khoá duy nhất cho một đường ghi trong sổ miễn trừ: `${duong}::${ten}` — CẦN tiền tố `duong`
 * (khác `cuaIngestScan.ts`, nơi mọi cửa nằm trong MỘT file nên `ten` một mình là đủ) vì hai file
 * độc lập (`acquisitionWorker.ts`, `hotFolderService.ts`) đều có một hàm tên `submitCanonical`
 * gọi `processInspectionSubmission` — `ten` một mình sẽ đụng độ.
 */
export function khoaDuongGhi(d: Pick<DuongGhiInspection, "duong" | "ten">): string {
  return `${d.duong}::${d.ten}`;
}

/**
 * Bốn tên hàm GHI đã biết hôm nay. Hai hàm DB (`server/db/inspection.ts`) + hai hàm ROUTER bọc
 * chúng (`server/routers/machineApiRouters.ts`, nhánh v1.x/v2.0 — xem §0 của lưới census để biết
 * cách bốn tên này được xác nhận còn khớp mã thật).
 */
export const TEN_CAC_HAM_GHI = [
  "createProductInspection",
  "persistInspectionAtomic",
  "processInspectionSubmission",
  "submitInspectionTreeV2",
] as const;

/** Tên hàm WAL dùng chung (`server/services/inspection/inspectionStoreForward.ts`). */
export const TEN_HAM_WAL = "bufferSubmission";

/** Một file đưa vào bộ quét — nội dung TRUYỀN VÀO (không tự đọc đĩa), cho phép chạy trên biến thể
 *  đột biến TRONG BỘ NHỚ giống hệt khuôn của `cuaIngestScan.quetCuaIngest`. */
export interface TepQuetGhi {
  readonly duong: string;
  readonly ma: string;
}

/** Một đường ghi tìm thấy: một lời gọi tới một trong `TEN_CAC_HAM_GHI`, ngoài định nghĩa của
 *  chính bốn hàm đó. */
export interface DuongGhiInspection {
  /** Nhãn hiển thị: `tênPhạmViBaoQuanh→tênHàmGhi`. */
  readonly ten: string;
  readonly duong: string;
  readonly dong: number;
  readonly tuNoi: string;
  readonly goi: string;
  /** Có `TryStatement` bao trực tiếp, và subtree của nó tới được `bufferSubmission`. */
  readonly coBaoVeWal: boolean;
}

export interface KetQuaQuetGhiInspection {
  readonly duong: readonly DuongGhiInspection[];
  /** Ô KHÔNG phân giải được (không tìm được phạm vi bao quanh có tên) — lưới phải ĐỎ. */
  readonly mu: readonly string[];
}

/**
 * ★★★ SỔ MIỄN TRỪ — khuôn `MIEN_TRU_QUYET_DINH_PHIEN_BAN` (`machineApiRouters.ts`, Pha 1C) là
 * mẫu, đã theo ĐÚNG tinh thần: mỗi đường KHÔNG bảo vệ WAL phải có tên ở đây KÈM lý do đo được,
 * không phải bảo trì im lặng. Đặt CẠNH bộ suy (không đặt trong `machineApiRouters.ts` như mẫu
 * gốc) vì sáu đường cần miễn trừ nằm ở BỐN file sản xuất khác nhau (`machineApiRouters.ts`,
 * `aoiPackageRouter.ts`, `acquisitionWorker.ts`, `hotFolderService.ts`,
 * `inspectionStoreForward.ts`) — không có một "chủ sở hữu" tự nhiên duy nhất như router gốc của
 * Pha 1C (nơi MỌI cửa nằm trong một object). Khoá bằng `khoaDuongGhi()` (`${duong}::${ten}`).
 *
 * ⚠ HAI mục dưới đây (`initInspectionStoreForward→processInspectionSubmission`,
 * `acquisitionWorker.submitCanonical→processInspectionSubmission`) là LỖ THẬT CHƯA VÁ, không
 * phải khác biệt kiến trúc hợp lệ — đọc kỹ lý do, và xem "mối lo" trong task-3-report.md trước
 * khi coi census xanh là "đã ổn". Ghi vào sổ ở đây là để KHÔNG chặn cổng ra của Task 3 (brief cấm
 * tự vá mã sản xuất mà không báo trước), không phải một tuyên bố rằng lỗ đã đóng.
 */
export const MIEN_TRU_GHI_INSPECTION_WAL: Record<string, string> = {
  // ── ensureInspectionWalWired — CHÍNH LÀ bộ điều phối phát lại (processFn) của WAL ──────────
  "server/routers/machineApiRouters.ts::ensureInspectionWalWired→submitInspectionTreeV2":
    "ensureInspectionWalWired LÀ processFn mà backfillInspections() gọi để PHÁT LẠI một mục ĐÃ " +
    "xếp hàng — bufferSubmission bên trong nó sẽ đệm lại đúng cái đang được rút ra khỏi hàng đợi, " +
    "một vòng lặp vô nghĩa. Bảo vệ THẬT của đường phát lại nằm ở NƠI GỌI backfillInspections " +
    "(catch trong chính hàm đó, server/services/inspection/inspectionStoreForward.ts): lỗi tạm " +
    "thời để entry Ở LẠI hàng đợi (bump attempts, dừng vòng lặp), lỗi vĩnh viễn đưa vào " +
    "dead-letter — đó CHÍNH LÀ 'WAL' của đường phát lại, không phải một lỗ thiếu bảo vệ.",
  "server/routers/machineApiRouters.ts::ensureInspectionWalWired→processInspectionSubmission":
    "Cùng lý do với nhánh submitInspectionTreeV2 ở trên — HAI nhánh (v1.x/v2.0) của CÙNG MỘT " +
    "processFn dispatch-theo-hình-dạng (laHinhDangCayV2). Xem mục ensureInspectionWalWired→" +
    "submitInspectionTreeV2 ngay phía trên cho lý lẽ đầy đủ.",

  // ── commit (aoiPackageRouter.ts) — mutation DO NGƯỜI kích hoạt, không phải ACK máy-quên ──────
  "server/routers/aoiPackageRouter.ts::commit→persistInspectionAtomic":
    "'commit' là mutation NGƯỜI kích hoạt (xác nhận ZIP đã tải lên xong), không phải một máy " +
    "gửi-rồi-quên qua mạng: persistInspectionAtomic tự mở transaction RIÊNG (lỗi ⇒ rollback sạch, " +
    "không có header mồ côi), và khi toàn bộ mutation ném lỗi, gói ZIP vẫn còn nguyên " +
    "(storageKey không đổi, status chuyển 'failed' — xem catch ở dòng ~1138) — người dùng bấm " +
    "'commit' lại được, không có gì để phải xếp hàng WAL thay hộ. Khác hẳn khế ước ACK-rồi-quên " +
    "của máy AOI/AVI mà inspectionStoreForward được dựng ra để bảo vệ (doc 27 W2-C).",

  // ── hotFolderService — có tầng bền vững RIÊNG dựa trên FILE, không dùng WAL này ─────────────
  "server/services/vision/hotFolderService.ts::submitCanonical→processInspectionSubmission":
    "hotFolderService có tầng bền vững RIÊNG dựa trên FILE (không dùng inspectionStoreForward): " +
    "MỌI thất bại — kể cả CSDL tạm thời — trong processHotFolderFile() chuyển file vào errorPath " +
    "kèm sidecar '<tên>.reason.txt', đánh dấu sổ hot_folder_files 'error' (KHÔNG xoá file), và có " +
    "đường xử-lý-lại (một claim 'error' cũ được 'taken over and retried' ở claimLedgerRow, xem " +
    "docblock đầu file). Dữ liệu không mất, chỉ đổi từ 'tự động rút qua WAL' sang 'chờ vận hành " +
    "xử lý lại' — khác WAL nhưng vẫn là một dạng durable, chỉ không đi qua đúng cơ chế này.",

  // ── acquisitionWorker — ★ LỖ THẬT CHƯA VÁ, ghi vào sổ để không chặn cổng ra, KHÔNG phải hợp lệ
  "server/services/vision/acquisition/acquisitionWorker.ts::submitCanonical→processInspectionSubmission":
    "★ LỖ THẬT, CHƯA VÁ — không phải miễn trừ kiến trúc: khi processInspectionSubmission ném lỗi " +
    "(kể cả lỗi TẠM THỜI, DB down), acquisitionWorker CHỈ tăng rt.errors và bỏ khung đó — không " +
    "giữ lại, không hàng đợi, không phát lại (xem catch quanh dòng ~337, acquisitionWorker.ts). " +
    "Giảm nhẹ DUY NHẤT hôm nay: cờ chủ LIVE_ACQUISITION_ENABLED KHÔNG bật trong .env của repo " +
    "này, và mặc định 'submit' của một worker là false (đây còn là công cụ nội bộ thử nghiệm — " +
    "xem docblock đầu file, 'NO UI beyond status/start/stop … dedicated panel is a documented " +
    "follow-up'). Ghi vào sổ để KHÔNG chặn cổng ra Task 3 (brief cấm tự vá mã sản xuất mà không " +
    "báo trước) — cần một quyết định RIÊNG trước khi bật submit:true cho một nguồn ảnh thật.",

  // ── initInspectionStoreForward — ★★★ LỖ THẬT CHƯA VÁ, TÁI DIỄN LỚP LỖI TASK 2 QUA CỬA BOOT ──
  "server/services/inspection/inspectionStoreForward.ts::initInspectionStoreForward→processInspectionSubmission":
    "★★★ LỖ THẬT, CHƯA VÁ — RẤT GIỐNG lớp lỗi Task 2 (§QĐ-WAL-B) đã đóng, chỉ ở một cửa KHÁC: " +
    "initInspectionStoreForward (chạy Ở BOOT — server/_core/index.ts, gọi ngay khi server khởi " +
    "động) wire processFn CỨNG vào processInspectionSubmission (v1.x) RỒI MỚI restoreInspectionWal()" +
    " + startInspectionBackfillWorker() — KHÔNG gọi ensureInspectionWalWired (hàm đó KHÔNG export " +
    "khỏi machineApiRouters.ts, chỉ tự rewire khi có một lượt submitInspection/submitInspectionBatch " +
    "LIVE chạy SAU boot). Nếu đĩa còn mục v2.0 từ TRƯỚC lúc khởi động lại (restoreInspectionWal " +
    "nạp lại đúng các mục đó) và backfillWorker (mặc định 15s, INSPECTION_STORE_FORWARD_INTERVAL_MS)" +
    " chạy TRƯỚC lượt submit LIVE đầu tiên sau boot, mục đó phát lại qua ĐÚNG đường v1.x từng gây " +
    "mất cây ba cấp ÂM THẦM mà Task 2 đã sửa cho nhánh 'gọi trước khi live' — chỉ là tái diễn ở " +
    "nhánh BOOT. `.env` của repo này đặt INSPECTION_STORE_FORWARD_ENABLED=true (không phải một cờ " +
    "tắt trên giấy) nên đây KHÔNG chỉ là rủi ro lý thuyết. Ghi vào sổ để KHÔNG chặn cổng ra Task 3 " +
    "(brief cấm tự vá mã sản xuất) — BÁO cho người trước khi sửa, xem task-3-report.md mục 'mối lo'.",
};

// ── kỹ thuật tái dùng từ cuaIngestScan.ts (quetMotCay / coDuongToi) — xem docblock đầu file ──

/**
 * Một lượt quét MỘT cây con: có lời gọi `tenHam(...)` TRỰC TIẾP (định danh trần, không phải
 * `x.tenHam(...)`) trong subtree này không, và tập ĐỊNH DANH nào xuất hiện (bỏ tên thuộc tính
 * `.x` / khoá object `{x: …}`) — CHÉP NGUYÊN kỷ luật `quetMotCay` của `cuaIngestScan.ts`.
 */
function quetMotCay(n: ts.Node, tenHam: string): { goiTrucTiep: boolean; dinhDanh: ReadonlySet<string> } {
  let goiTrucTiep = false;
  const dinhDanh = new Set<string>();
  const di = (x: ts.Node): void => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === tenHam) {
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
 * Bao đóng CÓ ĐIỀU KIỆN từ `root`: có TỚI ĐƯỢC một lời gọi `tenHam(...)` không, đi qua các khai
 * báo CẤP FILE mà `root` (hoặc bất kỳ khai báo nào mở rộng ra từ nó) tham chiếu tới. CHÉP NGUYÊN
 * `coDuongToiQuyetDinh` của `cuaIngestScan.ts`, tổng quát hoá tên hàm mục tiêu.
 */
function coDuongToi(root: ts.Node, tenHam: string, khaiBao: ReadonlyMap<string, ts.Node>): boolean {
  const daTham = new Set<string>();
  const hangDoi: ts.Node[] = [root];
  let i = 0;
  while (i < hangDoi.length) {
    const node = hangDoi[i++];
    if (node === undefined) continue;
    const { goiTrucTiep, dinhDanh } = quetMotCay(node, tenHam);
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

// ── phần MỚI: tìm call site của TEN_CAC_HAM_GHI + phạm vi bao quanh + try gần nhất ───────────

/** Thân hàm của mọi `FunctionDeclaration` có tên nằm trong `TEN_CAC_HAM_GHI` — loại trừ khỏi tìm
 *  call site (chi tiết triển khai của chính hàm ghi, không phải nơi gọi nó). */
function timVungLoaiTru(sf: ts.SourceFile): ReadonlyArray<readonly [number, number]> {
  const vung: Array<readonly [number, number]> = [];
  const di = (x: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(x) &&
      x.name !== undefined &&
      (TEN_CAC_HAM_GHI as readonly string[]).includes(x.name.text) &&
      x.body !== undefined
    ) {
      vung.push([x.body.getStart(sf), x.body.getEnd()]);
    }
    ts.forEachChild(x, di);
  };
  di(sf);
  return vung;
}

/** Tên hàm ghi (nếu có) của một `CallExpression`: định danh trần HOẶC `x.tenHam(...)`. */
function tenHamGhiCua(call: ts.CallExpression): string | null {
  if (ts.isIdentifier(call.expression) && (TEN_CAC_HAM_GHI as readonly string[]).includes(call.expression.text)) {
    return call.expression.text;
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    (TEN_CAC_HAM_GHI as readonly string[]).includes(call.expression.name.text)
  ) {
    return call.expression.name.text;
  }
  return null;
}

/** Mọi `CallExpression` gọi một hàm trong `TEN_CAC_HAM_GHI`, ngoài `vungLoaiTru`. */
function timCacLoiGoiGhi(
  sf: ts.SourceFile,
  vungLoaiTru: ReadonlyArray<readonly [number, number]>,
): Array<{ node: ts.CallExpression; goi: string }> {
  const ketQua: Array<{ node: ts.CallExpression; goi: string }> = [];
  const di = (x: ts.Node): void => {
    if (ts.isCallExpression(x)) {
      const goi = tenHamGhiCua(x);
      if (goi !== null) {
        const start = x.getStart(sf);
        const trongVungLoaiTru = vungLoaiTru.some(([s, e]) => start >= s && start < e);
        if (!trongVungLoaiTru) ketQua.push({ node: x, goi });
      }
    }
    ts.forEachChild(x, di);
  };
  di(sf);
  return ketQua;
}

/**
 * Tên PHẠM VI BAO QUANH gần nhất có ý nghĩa: `FunctionDeclaration` có tên, biến khởi tạo bằng
 * hàm (arrow/function expression), hoặc thuộc tính object (`submitInspection: … .mutation(fn)`).
 * `null` khi không tìm được (đi hết tới `SourceFile`) — call site đó rơi vào `mu`.
 */
function timTenBaoQuanh(node: ts.Node): string | null {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (ts.isFunctionDeclaration(cur) && cur.name !== undefined) return cur.name.text;
    if (
      ts.isVariableDeclaration(cur) &&
      ts.isIdentifier(cur.name) &&
      cur.initializer !== undefined &&
      (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))
    ) {
      return cur.name.text;
    }
    if (ts.isPropertyAssignment(cur) && (ts.isIdentifier(cur.name) || ts.isStringLiteral(cur.name))) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return null;
}

/** `TryStatement` gần nhất bao `node` — `null` nếu không có (⇒ coi như không bảo vệ, xem TRẦN). */
function timTryBaoQuanh(node: ts.Node): ts.TryStatement | null {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (ts.isTryStatement(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}

/**
 * Quét một tập file (nội dung TRUYỀN VÀO) và trả mọi đường ghi `product_inspections` tìm thấy —
 * xem docblock đầu file cho định nghĩa "đường ghi" + TRẦN của cách tiếp cận.
 */
export function quetDuongGhiInspection(teps: readonly TepQuetGhi[]): KetQuaQuetGhiInspection {
  const duong: DuongGhiInspection[] = [];
  const mu: string[] = [];

  for (const tep of teps) {
    const sf = ts.createSourceFile(tep.duong, tep.ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    /** Mọi khai báo CẤP FILE (const/function) — tên → subtree khởi tạo/thân (cho bao đóng). */
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

    const vungLoaiTru = timVungLoaiTru(sf);
    const loiGoi = timCacLoiGoiGhi(sf, vungLoaiTru);

    for (const { node, goi } of loiGoi) {
      const dong = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const tuNoi = timTenBaoQuanh(node);
      if (tuNoi === null) {
        mu.push(
          `${tep.duong}:${dong} — lời gọi \`${goi}\` không xác định được phạm vi bao quanh có tên ` +
            `(hàm/biến/thuộc tính) — bộ suy mất dấu, không gán nhãn được`,
        );
        continue;
      }
      const tryNode = timTryBaoQuanh(node);
      const coBaoVeWal = tryNode !== null && coDuongToi(tryNode, TEN_HAM_WAL, khaiBao);
      duong.push({ ten: `${tuNoi}→${goi}`, duong: tep.duong, dong, tuNoi, goi, coBaoVeWal });
    }
  }

  return { duong, mu };
}

/**
 * §0 — CẦU CHÌ chống hoá thạch của `TEN_CAC_HAM_GHI`: trả tập tên trong danh sách đó THẬT SỰ còn
 * là một `FunctionDeclaration` (có thân) trong tập file truyền vào. Đổi tên/xoá một trong bốn hàm
 * ghi mà không cập nhật `TEN_CAC_HAM_GHI` sẽ làm tên đó BIẾN MẤT khỏi kết quả này — census dùng
 * điều đó để ĐỎ thay vì lặng lẽ quét trúng 0 lời gọi của một tên đã chết (xem TRẦN mục (1)).
 */
export function hamGhiConThatSu(teps: readonly TepQuetGhi[]): ReadonlySet<string> {
  const conThatSu = new Set<string>();
  for (const tep of teps) {
    const sf = ts.createSourceFile(tep.duong, tep.ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const di = (x: ts.Node): void => {
      if (
        ts.isFunctionDeclaration(x) &&
        x.name !== undefined &&
        x.body !== undefined &&
        (TEN_CAC_HAM_GHI as readonly string[]).includes(x.name.text)
      ) {
        conThatSu.add(x.name.text);
      }
      ts.forEachChild(x, di);
    };
    di(sf);
  }
  return conThatSu;
}
