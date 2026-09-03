/**
 * ★★★ 2026-08-18 — **CỔNG ĐIỀU TRA DÂN SỐ PHẠM VI ĐỌC.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CỔNG NÀY TỒN TẠI — VÀ VÌ SAO NÓ KHÔNG PHẢI "MỘT LƯỚI NỮA CHO MỘT MÀN HÌNH NỮA"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai ngày 2026-08-17/18 vá phạm vi dữ liệu cho khoảng một tá bề mặt, **MỘT-CÁI-MỘT**. Mỗi lượt vá
 * đóng đúng cái lỗ **có người nhìn thấy**. Không lượt nào trả lời được *"còn bao nhiêu bề mặt như
 * thế mà chưa ai nhìn?"* — và một lưới cho mỗi bề mặt đã vá là đúng khuôn **N+1** mà repo này ghi
 * lại là đã bị cắn 17 lần.
 *
 * ⇒ File này KHÔNG canh một màn hình. Nó canh **LƯỢNG TỪ**:
 *
 *     ∀ thủ tục `.query` dưới `server/**`: nó phải rơi vào **ĐÚNG MỘT** nhóm, và nhóm **A**
 *     (chạm dữ liệu tenant mà danh tính KHÔNG rời tay handler) chỉ được chứa những mục **đã có
 *     tên trong sổ nợ** `phamViDocBaseline.ts`.
 *
 * Sổ nợ ấy **chỉ được co lại** (xem docblock của nó). Vì thế:
 *   • thêm một thủ tục đọc dữ liệu tenant mà quên lọc ⇒ **ĐỎ** (§4) — đó là toàn bộ lý do tồn tại;
 *   • vá một mục mà quên gỡ khỏi sổ ⇒ **ĐỎ** (§5) — chống sổ hoá thạch;
 *   • thêm-một-vá-một trong cùng lượt ⇒ **ĐỎ** ở CẢ HAI ô, vì §4/§5 là hai phép so **có hướng**,
 *     không phải một phép so số lượng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ CỔNG XANH **KHÔNG** CHỨNG MINH KHÔNG CÒN RÒ RỈ. Nó chứng minh **đúng ba** điều:
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   (1) bề mặt đã được **ĐẾM** — 2.209 thủ tục, không còn là một ước lượng;
 *   (2) món nợ **KHÔNG PHÌNH** thêm mà không ai ký tên;
 *   (3) vị từ phân loại **BẮT ĐƯỢC** hình dạng lỗ đã biết — §6 neo vào ba ca chuẩn do chủ dự án
 *       tự xác minh, và §7 là **ĐỘT BIẾN THẬT** (ghi một router rò ra đĩa, quét lại, đòi ĐỎ).
 *
 * Nó **không** chứng minh 552 mục trong sổ là vô hại — chúng là **NỢ**, và §3 in ra con số ấy mỗi
 * lượt chạy để không ai quên.
 */
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { quetPhamViDoc, nhomCua, khoaCua, type NhomPhamVi, type ThuTuc } from "./phamViDocScan";
import { NO_PHAM_VI_DOC } from "./phamViDocBaseline";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const GOC_REPO = join(TEST_DIR, "..", "..");

const QUET = quetPhamViDoc(GOC_REPO);
const NHOM = new Map<NhomPhamVi, ThuTuc[]>();
for (const t of QUET.thuTuc) {
  const n = nhomCua(t);
  NHOM.set(n, [...(NHOM.get(n) ?? []), t]);
}
const cua = (n: NhomPhamVi): ThuTuc[] => NHOM.get(n) ?? [];

/**
 * ★★★ CON SỐ GHIM (đo 2026-08-18, sau khi vá ba ca chuẩn).
 *
 * ⚠ Đổi một số ở đây là một **lời khai**, không phải một lượt bảo trì. Bốn con số bị ràng buộc bởi
 * `A + B + C + D + S === tổng`, nên không sửa lén được một ô.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-18, lượt 2 — **A: 552 → 544 · B: 0 → 8.** Lời khai kèm số liệu:
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tám thủ tục của `server/routers/publicProductApiRouter.ts` đã được thu hẹp về nhà máy của MÁY
 * GỌI (`publicProductScope.ts`) và **đã bị xoá khỏi sổ nợ**. Chúng rơi vào nhóm **B** chứ không
 * phải **S** vì đó là sự thật đo được: chúng là `publicProcedure` phục vụ MÁY, không hề có
 * `ctx.user` để đưa rời tay — xem §8 và khối `TEN_PHAN_GIAI` ở `phamViDocScan.ts`.
 * Đó là toàn bộ delta của lượt này: **A −8, B +8, tổng KHÔNG đổi.**
 *
 * ⚠⚠ CÁI KHÔNG PHẢI CỦA LƯỢT NÀY — đọc trước khi sửa tiếp con số. §3 và §5 đang **ĐỎ**, và ĐỎ vì
 * một lượt trả nợ KHÁC ĐANG DỞ, không vì lượt này. Số đo lúc chốt (worktree, chưa commit):
 * `A = 426 · S = 210`. Chênh lệch được quy TRÁCH NHIỆM ĐẦY ĐỦ, không còn dư một đơn vị nào:
 *
 *       552  (ghim cũ)
 *     −   8  lượt NÀY — `publicProductApiRouter.ts`, đã xoá 8 dòng khỏi sổ, nay ở nhóm B (§8)
 *     − 118  lượt KHÁC — đã vá sang nhóm S nhưng **CÒN NGUYÊN TÊN TRONG SỔ NỢ**
 *     ─────
 *       426  = số đo được
 *
 * 118 mục ấy nằm gọn trong ĐÚNG BẢY file, và cả bảy đều do agent khác giữ nên lượt này **không
 * được đụng vào**: `hierarchyRouters.ts` (25) · `mqttOeeRouters.ts` (22) · `spcAdvancedRouter.ts`
 * (17) · `stationAnalysisRouter.ts` (16) · `productionRouters.ts` (14) ·
 * `mesControlTowerRouter.ts` (12) · `systemRouters.ts` (12). **Không một mục nào thuộc file mà
 * lượt này chạm tới** — đã kiểm bằng phép quy trách nhiệm theo file, chứ không suy từ con số.
 *
 * ⇒ Vì thế `A` ghim ở **544 = 552 − 8**: đó là lời khai về ĐÚNG PHẦN đo được và làm được của lượt
 * này. Người đóng lượt kia xoá 118 dòng ấy rồi hạ tiếp `A: 544 → 426` và `S: 92 → 210`.
 * ⚠ Con số ấy còn TRÔI TIẾP khi lượt kia chạy: trong một buổi làm việc nó đã đi 552 → 489 → 426.
 * Đừng chép một số đo tức thời vào đây — hãy trừ ĐÚNG phần mình đã trả và ghi phần còn lại là của ai.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-18, lượt 3 (ĐỢT 11 FILE ĐẦU BẢNG) — **A: 544 → 359 · S: 92 → 283 · C: 473 → 467.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đây chính là "lượt KHÁC ĐANG DỞ" mà lượt 2 đã dự báo ở trên. Nó đã đóng, và số cuối lớn hơn dự
 * báo 118 vì phạm vi được duyệt là **11 file** chứ không phải 7. Phép quy trách nhiệm ĐẦY ĐỦ,
 * không dư một đơn vị:
 *
 *       552  (ghim gốc)
 *     −   8  lượt 2 — `publicProductApiRouter.ts` → nhóm **B** (đã xoá khỏi sổ, xem §8)
 *     − 185  lượt 3 — 11 file đầu bảng → nhóm **S** (đã xoá 185 dòng khỏi sổ nợ)
 *     ─────
 *       359  = số đo được
 *
 * 185 mục ấy phân bổ theo file: `hierarchyRouters.ts` 25/26 · `mqttOeeRouters.ts` 22/22 ·
 * `masterDataRouter.ts` 21/21 · `productRouters.ts` 20/20 · `spcAdvancedRouter.ts` 17/17 ·
 * `stationAnalysisRouter.ts` 16/16 · `fleetRouter.ts` 14/14 · `productionRouters.ts` 14/14 ·
 * `systemRouters.ts` 12/13 · `mesControlTowerRouter.ts` 12/12 · `statusTemplateRouters.ts` 12/12.
 *
 * ⚠ **HAI MỤC CÒN LẠI TRONG SỔ LÀ CỐ Ý**, và cả hai đều KHÔNG vá được bằng `ctx.user`:
 *   • `hierarchyRouters.ts#machineRouter.config` — `publicProcedure` máy-với-máy (tra theo
 *     `serialNumber`). Không có `ctx.user` nào để đưa xuống; muốn đóng thì phải là phép **xác
 *     thực MÁY**, một lớp việc khác. Giữ trong sổ là lời khai đúng: nợ vẫn còn.
 *   • `systemRouters.ts#corporateFactoryStatsRouter.warmingStats` — `adminProcedure` trả bộ đếm
 *     của dịch vụ hâm nóng cache; **không một ô nào là dữ liệu tenant**. Nó ở nhóm (A) vì BAO
 *     ĐÓNG NGƯỢC của bộ suy (dịch vụ ấy có gọi các hàm thống kê để nạp cache), không vì có lỗ.
 *     Xem tiếp mục ⚠ dưới đây.
 *
 * ⚠⚠ **`C: 473 → 467` KHÔNG phải một lượt rò rỉ mới.** Sáu thủ tục danh mục DÙNG CHUNG của
 * `masterDataRouter` (`materialsRouter.listClasses` · `skillsRouter.list/get` ·
 * `uomRouter.list/get/listConversions`) trước đây là (C) vì hàm dùng chung `listAll`/`getOne`
 * không chạm bảng tenant nào. Lượt này gắn cổng mã tenant vào đúng hai hàm ấy, nên bao đóng của
 * chúng nay chạm `user_factory_assignments` ⇒ vị từ `chamTenant` bật cho MỌI nơi gọi. Sáu ô ấy
 * được truyền `ctx` (cổng KHÔNG phát biểu vì bốn bảng kia đo được là 0/8·0/8·0/8·0/9 cột tenant)
 * nên chúng vào **S**, không vào A. Nếu không truyền, chúng đã là 6 mục (A) MỚI và §4 sẽ ĐỎ —
 * đúng như thiết kế.
 *
 * ⚠ **MỘT LỖ HỔNG CỦA THƯỚC ĐO, đã báo cho chủ dự án, CHƯA sửa (cố ý — ba agent đang dùng chung
 * bộ suy này).** Vị từ §C của `phamViDocScan` chỉ nhìn ĐỐI SỐ của lời gọi và VẾ PHẢI của khai báo
 * biến, nên `f({ actor: { id: ctx.user.id } })` — danh tính LỒNG một tầng — bị khai là "không rời
 * tay". `scheduledReportRouter.previewStatisticsReport` là một ca có thật của lớp lỗi ấy: nó đã
 * đúng từ trước mà vẫn bị xếp (A). Ngoài ra 17 mục (A) trên sàn `adminProcedure` là "không rời
 * tay" mà KHÔNG phải lỗ, vì sàn đã ghim vai `admin` và `resolveTenantFactoryScope` trả
 * `factoryIds: null` cho admin ⇒ truyền `ctx` xuống không đổi một byte.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-18, lượt 4 (TUYẾN EXPRESS) — **A: 359 → 363 · C: 467 → 463.** Lời khai:
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ **KHÔNG MỘT DÒNG MÃ SẢN XUẤT NÀO CỦA BỐN THỦ TỤC ẤY ĐỔI. THƯỚC ĐO ĐỔI.**
 *
 * Lượt 4 mở rộng bộ suy sang tuyến **Express** (§D của `phamViDocScan.ts`), và trong lúc đối chiếu
 * từng tuyến với mã thật đã bắt được một lỗ của **chính bộ suy**, có từ lượt 1: `nhap()` ánh xạ
 * `import { getMachines } from "../db"` thành `server/db/index.ts#getMachines` — một nút **KHÔNG
 * TỒN TẠI**, vì `server/db/index.ts` là barrel thuần (24 dòng `export *`, không một khai báo nào).
 * Nút thật là `server/db/hierarchy.ts#getMachines`. Nhánh `import * as db` thì CÓ đi qua `xuat()`.
 * ⇒ Cùng một lượt đọc, viết bằng hai cú pháp, cho **hai** phán quyết; và cú pháp phổ biến hơn cho
 *   phán quyết **LỎNG HƠN** — im lặng rơi vào (C) *"không thuộc tenant"*.
 *
 * Vá `nhap()` (đi qua barrel, đúng phép phân giải mà nhánh namespace vẫn dùng) làm lộ ra **4** thủ
 * tục `.query` vẫn luôn rò: `aiCalibrationRouter.{getCalibration,getLatestCalibration,listCalibration}`
 * (đọc `getCalibrationReport`/`listCalibrationReports` không phạm vi) và `vda5050Router.status`.
 * Cả bốn đã được thêm vào sổ nợ **kèm khối chú thích khai rõ đây là "thước sắc hơn", không phải
 * "vừa mở lỗ"** — một dòng thêm im lặng vào sổ RATCHET là đúng thứ sổ ấy tồn tại để ngăn.
 *
 * ⚠ Phép quy trách nhiệm ĐẦY ĐỦ, không dư một đơn vị: `A 359 + 4 = 363`, `C 467 − 4 = 463`,
 *   `B/D/S` và `tong` **không đổi một đơn vị nào** ⇒ delta này ĐÚNG là bốn ô chuyển C→A, không
 *   phải một lượt trôi chung chung.
 */
/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-19 (doc 79 · DANH SÁCH PHIÊN) — **tong: 2209 → 2219.** Lời khai kèm số liệu, và
 * phần lớn delta **KHÔNG PHẢI của lượt này**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐO TRƯỚC KHI SỬA (`git stash` toàn bộ lượt này rồi chạy lại cổng): HEAD **ĐÃ ĐỎ SẴN** ở
 *   `A 363 · B 8 · C 465 · D 1093 · S 286 · tong 2215`. Con số ghim 2209 được đặt ở `d3b0ed74`,
 *   TRƯỚC khi `server/routers/repoWorkspaceRouter.ts` tồn tại (`8f5b32c1`, doc 78 pha D). Sáu thủ
 *   tục của file ấy — `listFiles`/`readFile`/`grep` (S) · `listProjects`/`cauHinhVong` (C) ·
 *   `chayKiemChung` (D) — chưa bao giờ được khai vào GHIM. **Đó là một món nợ CÓ SẴN của cùng dòng
 *   việc doc 78/79, không phải thứ lượt này gây ra**; nó được trả ở đây vì để lại thì con số mới
 *   cũng vô nghĩa.
 *
 * Phép quy trách nhiệm ĐẦY ĐỦ, không dư một đơn vị:
 *
 *       2209  (ghim cũ, đặt ở d3b0ed74)
 *     +    6  **NỢ CÓ SẴN** — 6 thủ tục `repoWorkspaceRouter` (C+2 · D+1 · S+3), có từ 8f5b32c1
 *     ─────
 *       2215  = số đo ở HEAD khi `git stash` hết lượt này  ← đã đo, không suy
 *     +    4  **LƯỢT NÀY** — DANH SÁCH PHIÊN, cùng file `repoWorkspaceRouter.ts`:
 *              · `danhSachPhien` (query) → **C**   ┐ `ai_coding_sessions` KHÔNG thuộc tenant
 *              · `moPhien`       (query) → **C**   ┘ (không cột mã tenant; FK chỉ tới `users`)
 *              · `luuPhien`      (mutation) → **D**  (phạm vi ĐỌC không áp dụng cho mutation)
 *              · `xoaPhien`      (mutation) → **D**
 *     ─────
 *       2219
 *
 * ⇒ delta từng nhóm: **C 463 → 467** (+2 nợ cũ, +2 lượt này) · **D 1092 → 1095** (+1 nợ cũ, +2
 *   lượt này) · **S 283 → 286** (+3 nợ cũ, 0 lượt này).
 *
 * ★★★ **NHÓM (A) KHÔNG ĐỔI: 363.** Đây là ô chịu tải của cả cổng này — lượt thêm bốn thủ tục
 * KHÔNG mở thêm một lượt đọc dữ liệu tenant không lọc nào. Hai thủ tục ĐỌC của phiên rơi vào (C)
 * vì bảng `ai_coding_sessions` không phải bảng tenant; và phạm vi của chúng còn CHẶT HƠN tenant —
 * `eq(userId, ctx.user.id)` (CHỦ SỞ HỮU) trong mọi câu truy vấn, đo trên CSDL thật ở
 * `aiCodingSessionScope.test.ts` (kể cả `admin` cũng không đọc được phiên người khác).
 */
/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-23 (QUẢN LÝ DỰ ÁN) — **tong: 2219 → 2222.** Phép quy trách nhiệm ĐẦY ĐỦ, không dư
 * một đơn vị — cả ba thủ tục cùng file `repoWorkspaceRouter.ts`, sàn `adminProcedure` + 2FA +
 * `moduleGate("MOD_AI")`:
 *       · `danhSachDayDu` (query)    → **C 467 → 468** — bảng `ai_repo_du_an` (mig 0337) KHÔNG
 *         thuộc tenant (0 cột mã tenant; dự án hộp cát là CẤU HÌNH hạ tầng, không phải dữ liệu
 *         nhà máy nào) — đúng ô mà `listProjects` (cùng danh sách, cho mọi người dùng) đã nằm.
 *       · `themDuAn` / `xoaDuAn` (mutation) → **D 1095 → 1097** (phạm vi ĐỌC không áp cho mutation).
 * ★ **NHÓM (A) VẪN 363** — lượt này không mở một lượt đọc tenant không lọc nào. Chú ý riêng cho
 *   `themDuAn`: nó là thủ tục DUY NHẤT của bề mặt AI nhận một ĐƯỜNG DẪN — ngoại lệ CÓ CHỦ ĐÍCH
 *   của bất biến trục 2 ("client chỉ gửi ID"), phạm vi ADMIN-cấu-hình chứ không phải đường thực
 *   thi tool; server xác thực fail-closed ở `repoProjects.kiemTraDangKyDuAn` (mỗi lỗi một mã, đo
 *   tại `quanLyDuAnRepo.test.ts` + `repoProjectsDangKy.test.ts`).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
/**
 * ★ 2026-08-23 lượt 2 (BỘ CHỌN THƯ MỤC) — **tong: 2222 → 2223, C: 468 → 469.** Một thủ tục:
 * `repoWorkspace.duyetThuMuc` (query, sàn `adminProcedure`+2FA+`moduleGate("MOD_AI")`) — duyệt
 * TÊN thư mục con MỘT CẤP trên đĩa máy chủ cho form đăng ký dự án (thay lượt admin gõ tay đường
 * dẫn; chủ dự án đã gõ sai thật). Vào **C** vì nó là query KHÔNG chạm một bảng nào (hệ tệp, không
 * CSDL) — cùng ô với `listProjects`/`cauHinhVong`. **A/B/D/S KHÔNG đổi.** Nó nhận một ĐƯỜNG DẪN
 * như `themDuAn` (đã khai ở khối trên) nhưng KHÔNG ghi gì và KHÔNG mở nội dung tệp — chỉ
 * `readdirSync` tên thư mục, fail-closed ở `duyetThuMuc.ts`, đo tại `quanLyDuAnRepo.test.ts` §5.
 */
/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-29 (ĐUÔI SỐNG panel Terminal) — **tong: 2223 → 2222.** Phép quy trách nhiệm ĐẦY ĐỦ,
 * đo bằng CHÍNH BỘ QUÉT trên hai cây (per-key diff `f9be9fd6 → HEAD`, không đếm regex — lượt đếm
 * `.mutation(` bằng regex của chính lượt này đã khai SAI +1 cho `machineApiRouters` và bị bộ quét
 * bác; "phép đếm thô ≠ kiểm kê", đúng bài doc 78):
 *       +1  **LƯỢT NÀY** — `repoWorkspace.dauRaSong` (query) → **C 469 → 470**: đọc SỔ RAM
 *           `lenhSong.ts` (đuôi đầu-ra lệnh đang chạy, đã che per-chunk) — 0 bảng, 0 tệp, 0 tiến
 *           trình; khoá duy nhất là `ctx.user.id` từ phiên (KHÔNG input) nên còn CHẶT hơn tenant:
 *           phạm vi CHỦ SỞ HỮU, đo tại `lenhSong.test.ts §2`.
 *       −2  **NỢ CÓ SẴN** (trôi từ sau mốc ghim `f9be9fd6`, phát hiện ở lượt này): HAI mutation
 *           seed `seedDataRouter.seedInspections` + `seedDataRouter.seedWorkstationAnalytics`
 *           (dashboardStatsRouters.ts) đã bị XOÁ khỏi mã — **D 1097 → 1095** — khớp đợt nối
 *           payload v2.0 vào ingest THẬT (fb0ffe25: đường seed giả nhường chỗ cho ingest thật).
 * ★ **NHÓM (A) VẪN 363, B/S KHÔNG đổi** — lượt này không mở một lượt đọc tenant không lọc nào.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-09-03 — **ĐÍNH CHÍNH: "BỘ QUÉT BẤT ỔN" LÀ MỘT CHẨN ĐOÁN SAI CỦA TÔI.** `{C:470, D:1095,
 * tong:2222}` ở trên là con số **ĐO SAI**, và cách nó sai đáng ghi lại hơn chính con số.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ngày 2026-08-31 tôi đo 2222, ghim, rồi vài chục phút sau cùng một cây đo ra 2224 — stash sạch
 * mọi bản vá vẫn 2224. Tôi kết luận "bộ quét bất ổn, +2 D trùng-khoá (Map khử trùng nên per-key
 * diff mù)" và treo món này lại. **Cả hai vế đều sai**, đo được ngày 2026-09-03:
 *   • ĐẾM KHOÁ TRÙNG: 2.227 thủ tục / **2.227 khoá duy nhất** ⇒ KHÔNG có mục nào đếm hai lần.
 *   • QUÉT CHÍNH CÂY COMMIT `2cb1f771` (git archive — cây SẠCH, không phải worktree): ra
 *     `{C:470, D:1097, tong:2224}` — **ổn định tuyệt đối** qua mọi lượt chạy.
 * ⇒ Bộ quét luôn đúng. Thứ đổi giữa hai lần đo là **ĐĨA**: bộ quét đọc `server/**` trên hệ tệp,
 *   còn worktree này có **tiến trình khác đang sửa dở** (phiên AOI/extension chạy song song). Hai
 *   thủ tục D của họ chưa nằm trên đĩa lúc 21:27 và đã có lúc 21:55. Con số ghim 2222 vì thế là
 *   một phép đo trên **cây đang chuyển động**, không phải một lời khai về commit nào cả.
 *
 * ⇒ **KHUÔN cho người sau: đo census trên cây của MỘT COMMIT (`git archive` ra thư mục tạm), đừng
 *   bao giờ đo trên worktree dùng chung.** Một con số ghim rút từ worktree bẩn sẽ đỏ ngẫu nhiên và
 *   dạy người đọc thói quen tệ nhất: sửa GHIM cho xanh.
 *
 * ★ Phép quy trách nhiệm ĐẦY ĐỦ cho con số mới, bằng per-key diff `2cb1f771` → worktree (ĐÚNG 3
 *   dòng, không dư một đơn vị):
 *       C 470 → **471**: `repoWorkspace.modelDangDung` (query THUẦN — gọi `route()` để nói người
 *         dùng đang nói với model nào; 0 bảng, 0 tiến trình, 0 VRAM).
 *       D 1097 → **1099**: `repoWorkspace.deXuatSuaTay` + `repoWorkspace.deXuatThayTheLo` — hai
 *         mutation CHỈ-ĐỀ-XUẤT của đường sửa-tay/thay-thế-lô (phạm vi ĐỌC không áp cho mutation).
 *       A/B/S **KHÔNG đổi** — lượt này không mở một lượt đọc tenant không lọc nào.
 * ⚠ Con số dưới đây là của cây `2cb1f771` + đúng ba thủ tục ấy. Nhánh này có nhiều dòng việc song
 *   song; khi dòng khác commit thêm thủ tục, ô này sẽ đỏ — hãy quy trách nhiệm bằng per-key diff
 *   trên cây COMMIT như trên, rồi mới ghim.
 */
/**
 * ★ 2026-09-03 · ĐỢT F3 — **C 471 → 472** (`tong` 2227 → 2228). Quy trách nhiệm bằng per-key diff
 * trên cây COMMIT (đúng khuôn đã ghi ở khối trên — `git archive` HEAD ra thư mục tạm, KHÔNG đo trên
 * worktree dùng chung): **ĐÚNG MỘT dòng** `repoWorkspace.tokenLuotCuoi -> C`.
 * Nó là query THUẦN-ĐỌC sổ `ai_gateway_metrics` (bảng vận hành, KHÔNG thuộc tenant) và lọc cứng
 * `userId = ctx.user.id` — phạm vi CHỦ SỞ HỮU, chặt hơn tenant. A/B/D/S không đổi một đơn vị.
 * ⚠ GOTCHA của phép đo này: trong Git Bash `/tmp` **không** là `/tmp` mà Node (Windows) thấy —
 *   phải `cygpath -w` rồi truyền đường Windows, nếu không cây "cũ" rỗng và diff khai MỌI thủ tục là
 *   THÊM (đã dính một lần trong chính lượt này).
 */
// ★ 2026-09-03 — D 1099→1100, tong 2228→2229. LÝ DO ĐO ĐƯỢC, không phải "sửa cho xanh":
// Khối B Task 2 (`ac8d5ab2`) thêm ĐÚNG MỘT thủ tục — cửa ingest cây dạy (máy → hệ) trong
// `machineApiRouters.ts`. Nó rơi vào nhóm D vì có kiểm chứng đầu vào.
// Chứng minh độ lệch đúng bằng một cửa đó: A/B/C/S **không đổi** (363/8/472/286); chỉ D và
// `tong` cùng +1. Nếu bản vá của tôi làm rò một lượt đọc KHÔNG lọc tenant thì nhóm **A** đã
// tăng — nó không tăng.
// ⚠ Cổng `congGiayPhepAiCensus` cũng đang đỏ (tong +6, beMatAi +7) nhưng **KHÔNG phải của tôi**
// — tôi thêm một cửa, không thể làm `beMatAi` +7. Đó là độ trôi của công việc AI-coding chạy
// song song; **để nguyên cho bên đó ký**, đừng gộp vào con số này.
// ★ 2026-09-03 (lần 2) — D 1100→1101, S 286→290, tong 2229→2234. LÝ DO ĐO ĐƯỢC:
// Khối C Task 8 (`fc232773`) thêm ĐÚNG MỘT mutation `measurementPoint.setLimitsBatch` (nhóm D,
// có kiểm chứng đầu vào + gate giới hạn). Khối C Task 9 (`35a63b45`) thêm ĐÚNG BỐN query
// `cayDay.*` (nhóm S, đã lọc tenant theo phiên — review đo tenant A + machineId của B ⇒ rỗng).
// Chứng minh: A/B/C KHÔNG ĐỔI (363/8/472); D +1 và S +4 khớp từng thủ tục; tong +5 = 1+4.
// Task 9 tự đo D=1101 khi Task 8 CHƯA commit ⇒ +1 D không thể là của Task 9 (0 `.mutation(`).
const GHIM = { A: 363, B: 8, C: 472, D: 1101, S: 290, tong: 2234 } as const;

describe("§1 — CẦU CHÌ: bộ suy có thật sự nhìn thấy gì không", () => {
  it("★ không có ô MÙ nào (mỗi ô mù là một chỗ KHÔNG AI CANH)", () => {
    expect(QUET.mu, "Bộ suy tự khai là không còn đủ — đọc từng dòng, đừng nới lượng từ.").toEqual([]);
  });

  it("quét trúng đủ file / đủ bảng / đủ thủ tục (chống 'xanh vì quét trúng 0 thứ')", () => {
    // Ngưỡng đặt THẤP HƠN hẳn số đo (1.017 file · 351 bảng · 2.209 thủ tục) — chúng chỉ bắt cái
    // chết hẳn (đổi cấu trúc thư mục, đổi hình dạng `router({…})`), không bắt độ trôi bình thường.
    expect(QUET.soFileDuyet).toBeGreaterThan(800);
    expect(QUET.bang.tongBang).toBeGreaterThan(250);
    expect(QUET.bang.tenSql.size).toBeGreaterThan(120);
    expect(QUET.soNutDocTenant).toBeGreaterThan(1000);
    expect(QUET.thuTuc.length).toBeGreaterThan(1800);
  });

  it("★ KHOÁ DUY NHẤT — hai thủ tục không được cùng một khoá", () => {
    // `hierarchyRouters.ts` có 5 ô tên `list`. Khoá theo `file#tên` sẽ gộp chúng thành MỘT mục và
    // bốn lượt rò biến mất khỏi phép đếm — nên khoá phải mang cả đường router.
    const khoa = QUET.thuTuc.map(khoaCua);
    const trung = [...new Set(khoa.filter((k, i) => khoa.indexOf(k) !== i))];
    expect(trung, "Khoá trùng ⇒ sổ nợ gộp nhiều thủ tục thành một mục.").toEqual([]);
  });

  it("bảng TENANT được SUY RA, và nó bắt được những bảng load-bearing", () => {
    // Bốn bảng này là trục của mọi lượt vá phạm vi đã làm. Bộ suy mất một trong số chúng ⇒ hàng
    // trăm thủ tục lặng lẽ rơi sang nhóm (C) "không thuộc tenant".
    for (const b of ["product_inspections", "machines", "factories", "daily_statistics"]) {
      expect(QUET.bang.tenSql.has(b), `bảng \`${b}\` phải được suy ra là THUỘC TENANT`).toBe(true);
    }
    // Chiều DƯƠNG chống vá quá tay: có bảng KHÔNG thuộc tenant, không phải "tất cả đều tenant".
    expect(QUET.bang.tenSql.size).toBeLessThan(QUET.bang.tongBang);
  });
});

describe("§2 — MỖI THỦ TỤC VÀO ĐÚNG MỘT NHÓM", () => {
  it("★ tổng năm nhóm = tổng thủ tục (không mục nào rơi ra ngoài, không mục nào đếm hai lần)", () => {
    const tong = (["A", "B", "C", "D", "S"] as const).reduce((s, n) => s + cua(n).length, 0);
    expect(tong).toBe(QUET.thuTuc.length);
  });

  it("`nhomCua` là hàm TOÀN PHẦN — không thủ tục nào cho nhóm ngoài tập", () => {
    const la = QUET.thuTuc.filter((t) => !["A", "B", "C", "D", "S"].includes(nhomCua(t)));
    expect(la.map(khoaCua)).toEqual([]);
  });
});

describe("§3 — CON SỐ GHIM", () => {
  it("★ số từng nhóm ĐÚNG BẰNG số đã ghim", () => {
    const dem = {
      A: cua("A").length,
      B: cua("B").length,
      C: cua("C").length,
      D: cua("D").length,
      S: cua("S").length,
      tong: QUET.thuTuc.length,
    };
    expect(
      dem,
      "Dân số thủ tục đã đổi. Sửa `GHIM` cho khớp SỐ ĐO ĐƯỢC và ghi lý do — đừng sửa cho xanh.",
    ).toEqual(GHIM);
  });
});

describe("§4 — RÒ RỈ MỚI ⇒ ĐỎ (lý do tồn tại của cổng này)", () => {
  it("★★★ mọi mục nhóm (A) phải đã có tên trong SỔ NỢ", () => {
    const so = new Set(NO_PHAM_VI_DOC);
    const moi = cua("A")
      .filter((t) => !so.has(khoaCua(t)))
      .map((t) => `${khoaCua(t)} (dòng ${t.dong}; chạm: ${t.bangChung.join(", ") || "bảng tenant trực tiếp"})`);
    expect(
      moi,
      "MỘT THỦ TỤC ĐỌC DỮ LIỆU TENANT MỚI KHÔNG CÓ BỘ LỌC PHẠM VI.\n" +
        "Hệ này KHÔNG có danh tính ngầm (RLS ở tầng CSDL nằm im — xem `phamViDocScan.ts`), nên\n" +
        "handler không đưa `ctx.user` rời tay thì KHÔNG tầng nào lọc được nó.\n" +
        "Cách đúng: nhận `ctx`, truyền `{ userId: ctx.user?.id, userRole: ctx.user?.role }` xuống\n" +
        "hàm dữ liệu (mẫu: `db.getFactories` / `db.getMachines` / `machineIdsTrongPhamVi`).\n" +
        "CẤM lấy danh tính từ `input` — đó là lời TỰ KHAI của người gọi.",
    ).toEqual([]);
  });
});

describe("§5 — SỔ NỢ KHÔNG ĐƯỢC HOÁ THẠCH", () => {
  it("★ mọi mục trong sổ vẫn còn là một thủ tục CÓ THẬT", () => {
    const co = new Set(QUET.thuTuc.map(khoaCua));
    const chet = NO_PHAM_VI_DOC.filter((k) => !co.has(k));
    expect(chet, "Sổ nợ giữ mục không còn tồn tại — xoá nó đi.").toEqual([]);
  });

  it("★★ mọi mục trong sổ vẫn ĐANG ở nhóm (A) — vá rồi thì phải GỠ DÒNG", () => {
    const nhomTheoKhoa = new Map(QUET.thuTuc.map((t) => [khoaCua(t), nhomCua(t)]));
    const daVa = NO_PHAM_VI_DOC.filter((k) => nhomTheoKhoa.has(k) && nhomTheoKhoa.get(k) !== "A").map(
      (k) => `${k} → nay là nhóm ${nhomTheoKhoa.get(k)}`,
    );
    expect(
      daVa,
      "Mục này đã được vá nhưng còn tên trong sổ nợ. Xoá dòng của nó khỏi `phamViDocBaseline.ts`\n" +
        "và giảm `GHIM.A` cho khớp — trả nợ phải NHÌN THẤY ĐƯỢC trong diff.",
    ).toEqual([]);
  });

  it("sổ nợ GOM THEO FILE, mỗi file một khối liền mạch, trong khối đã sắp xếp, không lặp", () => {
    // ⚠ KHÔNG dùng `[...].sort()` toàn cục: `.` (U+002E) < `/` (U+002F) nên `x.ts#…` xen vào giữa
    // `x/…`, và phép so ấy sẽ đỏ vì một lý do chẳng liên quan gì tới nợ phạm vi. Bất biến THẬT cần
    // giữ là: đọc sổ thấy được nợ của từng file ở MỘT chỗ, và trong đó có thứ tự.
    const fileCua = (k: string): string => k.split("#")[0] ?? "";
    const thuTuFile: string[] = [];
    for (const k of NO_PHAM_VI_DOC) {
      const f = fileCua(k);
      if (thuTuFile[thuTuFile.length - 1] !== f) thuTuFile.push(f);
    }
    expect(
      [...new Set(thuTuFile)].length,
      "một file xuất hiện ở HAI khối rời nhau — gom chúng lại.",
    ).toBe(thuTuFile.length);
    for (const f of thuTuFile) {
      const cua = NO_PHAM_VI_DOC.filter((k) => fileCua(k) === f);
      expect([...cua].sort(), `khối \`${f}\` chưa sắp xếp`).toEqual(cua);
    }
    expect(new Set(NO_PHAM_VI_DOC).size).toBe(NO_PHAM_VI_DOC.length);
  });
});

describe("§6 — BA CA CHUẨN (chủ dự án tự xác minh trên CSDL thật) ĐÃ ĐƯỢC VÁ", () => {
  const CA_CHUAN = [
    "server/routers/hierarchyRouters.ts#factoryRouter.list",
    "server/routers/mqttOeeRouters.ts#mqttClientRouter.getAllMachineHealth",
    "server/routers/mqttOeeRouters.ts#mqttClientRouter.getDowntimeHistory",
  ] as const;

  for (const k of CA_CHUAN) {
    it(`${k} — chạm dữ liệu tenant VÀ đã đưa danh tính rời tay`, () => {
      const t = QUET.thuTuc.find((x) => khoaCua(x) === k);
      expect(t, `không còn thấy thủ tục \`${k}\` — nó bị đổi tên/gỡ bỏ?`).toBeDefined();
      // Hai vế TÁCH RỜI có chủ ý: nếu ai đó "vá" bằng cách làm thủ tục thôi chạm dữ liệu tenant
      // (đổi sang một hàm khác) thì vế đầu ĐỎ, chứ không lặng lẽ xanh nhờ vế sau.
      expect(t?.chamTenant, "ca chuẩn phải VẪN chạm dữ liệu tenant — nếu không, vị từ đã trôi").toBe(true);
      expect(t?.danhTinhRoiTay, "danh tính phải RỜI TAY handler (hoàn nguyên bản vá ⇒ ĐỎ)").toBe(true);
      expect(nhomCua(t as ThuTuc)).toBe("S");
    });
  }
});

describe("§7 — ĐỘT BIẾN THẬT: cổng có ĐỎ khi thêm một lượt đọc tenant KHÔNG LỌC không", () => {
  /**
   * ⚠⚠ Không có ô này thì §4 xanh **không chứng minh gì**: một vị từ luôn trả "không có mục mới"
   * cũng cho đúng màu ấy. Nên ô này **ghi thật một router rò ra đĩa**, chạy lại **đúng** bộ suy
   * đang canh sản phẩm, rồi đòi nó bị bắt.
   *
   * Ba lời khai được đo cùng lúc, và ba lời khai ấy phá được ba kiểu vá-cổng-cho-xanh khác nhau:
   *   (a) thủ tục mới phải rơi vào nhóm **A** — vị từ nhận ra hình dạng rò;
   *   (b) nó **không** có tên trong sổ nợ — tức §4 sẽ ĐỎ;
   *   (c) bản ĐỐI CHỨNG **có** `ctx.user` rơi vào nhóm **S** — chống "vá quá tay": một cổng bắt
   *       TẤT CẢ cũng thoả (a) và (b), nhưng sẽ làm hỏng (c).
   */
  const FILE_DOT_BIEN = join(GOC_REPO, "server", "routers", "__dotBienPhamViDoc.ts");
  const MA = `import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const dotBienRoRiRouter = router({
  // (a)(b) — ĐỌC toàn đội máy, KHÔNG nhận ctx: đúng hình dạng của ba ca chuẩn trước bản vá.
  roRi: protectedProcedure.input(z.object({ q: z.string().optional() })).query(async () => {
    return db.getMachines();
  }),
  // (c) — ĐỐI CHỨNG: cùng lượt đọc, có danh tính rời tay ⇒ phải KHÔNG bị bắt.
  daLoc: protectedProcedure.query(async ({ ctx }) => {
    return db.getMachines({ userId: ctx.user?.id, userRole: ctx.user?.role });
  }),
});
`;

  it("★★★ router rò MỚI ⇒ nhóm A + KHÔNG có trong sổ nợ; bản đã lọc ⇒ nhóm S", () => {
    expect(existsSync(FILE_DOT_BIEN), "file đột biến còn sót từ lượt trước — dọn đi trước khi chạy").toBe(false);
    try {
      writeFileSync(FILE_DOT_BIEN, MA, "utf8");
      const lai = quetPhamViDoc(GOC_REPO);
      const tim = (ten: string): ThuTuc | undefined =>
        lai.thuTuc.find((t) => t.file.endsWith("__dotBienPhamViDoc.ts") && t.ten === ten);

      const roRi = tim("roRi");
      expect(roRi, "bộ suy KHÔNG THẤY thủ tục mới — lượng từ đã thủng, mọi ô khác vô nghĩa").toBeDefined();
      expect(nhomCua(roRi as ThuTuc)).toBe("A");
      expect(NO_PHAM_VI_DOC).not.toContain(khoaCua(roRi as ThuTuc));

      const daLoc = tim("daLoc");
      expect(daLoc).toBeDefined();
      expect(daLoc?.chamTenant, "bản đối chứng phải VẪN chạm dữ liệu tenant").toBe(true);
      expect(nhomCua(daLoc as ThuTuc), "CHỐNG VÁ QUÁ TAY: có danh tính rời tay ⇒ KHÔNG bị bắt").toBe("S");
    } finally {
      rmSync(FILE_DOT_BIEN, { force: true });
    }
    expect(existsSync(FILE_DOT_BIEN), "phép đột biến phải tự dọn — file rò không được ở lại cây").toBe(false);
  }, 120_000);
});

describe("§8 — NHÓM (B): một TIỀN ĐỀ đang được đo, không phải được tin", () => {
  /**
   * ★★★ 2026-08-18, lượt 2 — ô này TỪNG đòi nhóm (B) **RỖNG**, và nó đã ĐỎ đúng như thiết kế.
   *
   * Tiền đề cũ: *"cả hai bộ phân giải phạm vi đều đòi `userId`, nên một handler không đưa danh
   * tính rời tay thì KHÔNG THỂ đã được lọc ở tầng nào"*. Tiền đề ấy nay **SAI MỘT PHẦN**, và cái
   * làm nó sai là một hình dạng danh tính THỨ BA mà bộ suy chưa từng phát biểu: **khoá MÁY trình
   * trong `input`**. Tám thủ tục dưới đây là `publicProcedure` phục vụ máy và ứng dụng bên thứ
   * ba — chúng chưa bao giờ có `ctx.user`, nên vị từ §C không thể xanh cho chúng dù vá đúng tới
   * đâu; giữ chúng ở nhóm A sau khi đã vá thì sổ nợ nói dối theo chiều ngược lại.
   *
   * ⚠⚠ Vì sao ghim TỪNG TÊN chứ không nới thành "B được phép khác rỗng". Nới lượng từ là cách ô
   * này chết: một thủ tục thứ chín tự phân giải phạm vi không qua `ctx` sẽ lặng lẽ trôi vào B mà
   * không ai ký tên. Danh sách đóng ⇒ mục thứ chín làm ĐỎ và buộc người thêm phải khai ra nó.
   */
  const NHOM_B_DA_KY = [
    "server/routers/publicProductApiRouter.ts#publicProductApiRouter.getMeasurementPoints",
    "server/routers/publicProductApiRouter.ts#publicProductApiRouter.getPointImage",
    "server/routers/publicProductApiRouter.ts#publicProductApiRouter.getPointImagesByStation",
    "server/routers/publicProductApiRouter.ts#publicProductApiRouter.getPointStatsByStation",
    "server/routers/publicProductApiRouter.ts#publicProductApiRouter.getProductByCode",
    "server/routers/publicProductApiRouter.ts#publicProductApiRouter.getProductById",
    "server/routers/publicProductApiRouter.ts#publicProductApiRouter.getProductImage",
    "server/routers/publicProductApiRouter.ts#publicProductApiRouter.listProducts",
  ] as const;

  it("★★ nhóm (B) ĐÚNG BẰNG tập đã ký — không mục nào lẻn vào, không mục nào rơi ra", () => {
    // ⇐ ĐỎ theo hai chiều, cả hai đều là tin xấu cần biết:
    //   • THÊM một tên  ⇒ có ai đó dựng thêm một đường phân giải phạm vi KHÔNG cần `ctx`. Đọc
    //     `phamViDocScan.ts` §TEN_PHAN_GIAI (ranh giới "chứng thực ĐƯỢC ĐỐI CHIẾU") TRƯỚC khi ký.
    //   • MẤT một tên   ⇒ một trong tám thủ tục đã tuột phép lọc; nó sẽ rơi về nhóm A và §4 cũng
    //     ĐỎ theo, nhưng ô này nói ra CHÍNH XÁC cái nào.
    expect(cua("B").map(khoaCua).sort()).toEqual([...NHOM_B_DA_KY].sort());
  });

  it("★ tám mục ấy đã RỜI sổ nợ (chống 'vừa ở nhóm B vừa còn ghi là rò rỉ')", () => {
    const conSot = NHOM_B_DA_KY.filter((k) => NO_PHAM_VI_DOC.includes(k));
    expect(conSot, "Đã vá và đã đổi nhóm thì phải xoá dòng khỏi `phamViDocBaseline.ts`.").toEqual([]);
  });
});
