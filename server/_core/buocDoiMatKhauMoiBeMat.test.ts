/**
 * ★★★★ Pha 8 Task 1 — **CƯỠNG CHẾ BUỘC-ĐỔI-MẬT-KHẨU RA KHỎI tRPC.**
 *
 * ***∀ điểm xác thực một yêu cầu HTTP/socket trong `server/**` (mã sản xuất): cờ buộc-đổi-mật-khẩu
 * PHẢI được kiểm trên đường ấy.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI — "LƯỚI CANH HẸP HƠN TÊN GỌI"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 7 đặt phép chặn ở **`thuTucGoc`** của tRPC (`server/_core/trpc.ts`). Lượng từ ấy **ĐÚNG** —
 * mọi builder thủ tục buộc đi qua gốc, nên thủ tục thứ 2.213 tự động bị chặn. Nhưng câu nó chứng
 * minh là *"∀ thủ tục **tRPC**"*, trong khi cái tên người đọc nhớ là *"cưỡng chế đổi mật khẩu"*.
 * Phần bù của hai câu ấy là **12 bề mặt** người bị buộc đổi mật khẩu **vẫn dùng được**.
 *
 * ⚠ Phép đếm của lượt này **KHÁC** brief, theo cả hai chiều — nên nó được dán ở đây, không ở một
 *   báo cáo:
 *   · brief liệt kê `aiStreamingApi`×3 · `aiLocalKnowledgeApi`×4 · `exportRouter` ·
 *     `observabilityRoutes` · `_core/index.ts:1251` = **10 mục**, rồi gọi tập ấy là **11**, rồi
 *     **cộng thêm** `socket.ts:126` — tức `socket.ts` bị **đếm hai lần** trong con số 12.
 *   · và brief **BỎ SÓT** một điểm xác thực có thật: `server/_core/index.ts:1658`
 *     (`validateExternalAuth`, nhánh `Authorization: Bearer`) phân giải danh tính bằng
 *     `sdk.verifySession` + `getUserByOpenId` — **KHÔNG** đi qua `authenticateRequest` chút nào.
 *     Đây đúng lớp *"đường thoát"*: một `git grep authenticateRequest` **theo cấu tạo** mù với nó.
 *   ⇒ Tổng vẫn là **12**, nhưng **thành phần khác**, và cái bị sót là cái nguy hiểm hơn (nó chứng
 *     minh rằng "điểm xác thực" ≠ "lượt gọi `authenticateRequest`").
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ "TỒN TẠI hay VỚI MỌI?" — và "LƯỢNG TỪ CÓ **TỰ THOẢ** KHÔNG?"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lượng từ là **∀**, và đối tượng của nó **suy từ ĐĨA + AST**, không từ một danh sách viết tay:
 * mọi file `server/**` không phải `*.test.ts` được phân giải, và mọi lượt gọi có hình dạng một
 * phép phân giải danh tính từ yêu cầu đều tự đưa mình vào tập. Một bề mặt mới ở một **file chưa
 * tồn tại** cũng vào tập, không ai phải nhớ khai gì.
 *
 * Bốn lớp chống *"tự thoả"* (mỗi lớp hỏng theo một kiểu khác nhau):
 *   1. **§1 ĐỐI CHỨNG TỔNG HỢP** — bộ nhận diện **và VỊ TỪ PHỦ** chạy trên mã dựng sẵn có **đáp số
 *      biết trước** (3 hình dạng hở ⇒ phải **XẾP LÀ VI PHẠM** · 2 hình dạng cưỡi điểm chung ⇒ phủ
 *      khi điểm chung bật, hở khi tắt · 4 hình dạng kín ⇒ phải tha). Thước chết **hoặc vị từ bị
 *      nới** ⇒ §1 đỏ NGAY, kể cả khi kho mã sạch tuyệt đối.
 *      ⚠ Bản đầu của §1a hỏi *"bộ dò có THẤY điểm nào không"* chứ không phải *"bộ dò có XẾP điểm ấy
 *        là HỞ không"*, nên nó **thoả bất kể vị từ phán quyết thế nào** — đo được ở review TOÀN
 *        NHÁNH Pha 8 (I-3): ép `duocPhu ≡ true` ⇒ **14/14 XANH**, cổng chính tắt hoàn toàn.
 *   2. **§2 SÀN SỐ FILE** — glob rỗng làm vitest im lặng khai XANH (**đã sáu lần**).
 *   3. **§3 SÀN SỐ ĐIỂM** — thước còn sống nhưng **mù với kho mã thật** (đường dẫn đổi, `sdk` đổi
 *      tên) sẽ cho 0 điểm trong khi §1 vẫn xanh. Sàn này bắt đúng khe ấy.
 *   4. **§7 HÀNH VI SỐNG trên DB thật** — §4 chỉ trả lời *"mã có HÌNH DẠNG ấy không"*. §7 trả lời
 *      *"một yêu cầu HTTP thật với cookie thật CÓ bị từ chối không"*, và ghim luôn cả hai bất biến
 *      đã nghiệm thu sống ở Pha 7 (miễn trừ `admin` · KHÔNG khoá ai ra ngoài).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÙNG MÙ ĐƯỢC KHAI — ĐỪNG ĐỌC MÀU XANH CỦA FILE NÀY THÀNH "ĐÃ PHỦ HẾT"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. §4 là lưới **HÌNH DẠNG**. Một `try { await chanNeuPhaiDoiMatKhau(u) } catch {}` có đúng hình
 *     dạng và vẫn lọt. §7 bù cho **điểm chung**; các bề mặt còn lại thì không.
 *  2. ✅ **ĐÃ ĐÓNG — review TOÀN NHÁNH Pha 9 · I-5.** Vùng mù cũ ghi ở đây là: *"bộ nhận diện biết
 *     **hai** hình dạng (`authenticateRequest`, `verifySession`); một cơ chế phiên **thứ ba** (đọc
 *     thẳng sổ phiên rồi `getUserById`) nằm ngoài lượng từ — đo được hôm nay là không tồn tại,
 *     nhưng đó là một **quan sát**, không phải bất biến"*. Review Pha 9 dựng đúng hình dạng ấy và
 *     đo `quetDiemXacThuc(…) = []`. Nay bộ nhận diện biết **ba** hình dạng (xem
 *     `TEN_TRA_SO_PHIEN`), `MA_HO`/`MA_KIN` dưới đây hiệu chuẩn cả hai chiều cho nó, và **quan sát
 *     đã thành bất biến**.
 *     ⚠ Vùng mù CÒN LẠI, khai đúng phạm vi: một cơ chế phiên thứ **tư** (ví dụ `db.select()` thô
 *       trên `user_sessions`) vẫn ngoài lượng từ. Đo được trên `9d81e382`: **0** chỗ như thế trong
 *       `server/**` sản xuất.
 *  2b. Một cái **TÊN** không phải một bằng chứng: `quetDiemXacThuc` tin `authenticateRequest`/
 *     `thuXacThucRest` theo tên. Phép neo *"ai gọi tên ấy phải NHẬP nó từ chủ"* là một lưới RIÊNG —
 *     `server/_core/neoTenXacThuc.test.ts` (I-5 nửa 2). Không có nó, một hàm trùng tên tự phân giải
 *     danh tính được **cả ba** lưới xếp là ĐƯỢC PHỦ.
 *  3. Xác thực bằng **khoá máy** (`x-master-key`, API key của máy/ERP) **KHÔNG** thuộc lượng từ:
 *     chủ thể ở đó không phải một hàng `users` nên không có cờ đổi mật khẩu để kiểm. Đây là một
 *     giới hạn **CÓ CHỦ Ý**, và tên ca nói đúng phạm vi ấy.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { moiFileDuoi, laFileTest } from "../routers/deployProcedureScan";
import { VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU } from "@shared/buocDoiMatKhau";
import { THU_TUC_CHO_QUA } from "./trpc";
import * as db from "../db";
/**
 * ⚠⚠ Bộ nhận diện **KHÔNG** sống trong file này nữa (review TOÀN NHÁNH Pha 8 · C-1): nó có người
 * tiêu thụ THỨ HAI (`thuHoiPhienMoiBeMat.test.ts`, bất biến *"phiên đã thu hồi thì không đi tiếp
 * được"*). Hai bản sao của cùng một bộ suy ⇒ **bản yếu hơn quyết định lưới nào đỏ** — đúng cơ chế
 * đã đẻ ba Critical trong chuỗi pha này. Chủ duy nhất: `server/_core/quetDiemXacThuc.ts`.
 */
import {
  type DiemXacThuc,
  quetDiemXacThuc,
  diemChungCuongChe,
  TEN_XAC_THUC,
  TEN_PHAN_GIAI_PHIEN,
  TEN_TRA_SO_PHIEN,
  TEN_PHEP_CHAN,
  O_BO_QUA,
  FILE_DIEM_CHUNG,
  FILE_UY_QUYEN_REST,
  TEN_UY_QUYEN_REST,
  uyQuyenRestDiQuaDiemChung,
} from "./quetDiemXacThuc";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/**
 * **TẬP BỀ MẶT TỰ CANH — GHIM SỐ, NEO HAI CHIỀU.**
 *
 * Mỗi mục là một điểm xác thực được phép **KHÔNG** đi qua điểm chung, kèm lý do MỘT DÒNG **và**
 * tên của cơ chế canh nó thay thế. Thêm một mục là một quyết định an ninh phải viết ra.
 *
 * ⚠ Neo **chiều A** (§5b): mỗi mục phải **TỒN TẠI** như một điểm xác thực trên đĩa. Một lượt đổi
 *   tên/xoá file biến mục này thành mục ma, và mục ma vẫn tiếp tục **tha** cho một điểm mới trùng
 *   đường dẫn — đúng cơ chế đã đẻ ba Critical trong chuỗi pha này.
 */
const BE_MAT_TU_CANH: { duong: string; vi_sao: string; canh_boi: string }[] = [
  {
    duong: "server/_core/context.ts",
    vi_sao:
      "tRPC PHẢI dựng được `ctx.user` cho người ĐANG bị chặn, nếu không `auth.me` trả null ⇒ client " +
      "không có đường nào biết mình phải đổi mật khẩu ⇒ NHÀ TÙ (Pha 7 đã deploy một lần, 4/4 tài khoản).",
    canh_boi: "server/_core/trpc.ts::thuTucGoc (chanKhiPhaiDoiMatKhau) + server/_core/buocDoiMatKhau.test.ts",
  },
];

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * LƯỢT QUÉT ĐĨA — lượng từ suy từ **ĐĨA**, không từ danh sách. Dùng lại bộ duyệt của
 * `deployProcedureScan.ts` đúng §Global Constraints (*"đừng viết bộ suy thứ N+1"*).
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
const MOI_FILE_SX = moiFileDuoi(GOC, "server", [".ts", ".tsx"]).filter((f) => !laFileTest(f.duong));
const MOI_DIEM: DiemXacThuc[] = MOI_FILE_SX.flatMap((f) =>
  quetDiemXacThuc(f.duong, readFileSync(f.that, "utf8")),
);
const DIEM_CHUNG_CUONG_CHE = diemChungCuongChe(readFileSync(join(GOC, FILE_DIEM_CHUNG), "utf8"));

const laTuCanhGhim = (d: DiemXacThuc) => BE_MAT_TU_CANH.some((b) => b.duong === d.duong);

/**
 * ★★★★ **VỊ TỪ PHỦ — MỘT CÔNG THỨC, DÙNG CHUNG cho §1 (hiệu chuẩn) và §4 (lượng từ chính).**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ Review TOÀN NHÁNH Pha 8 · **I-3** — §1a TRƯỚC ĐÂY **KHÔNG** HIỆU CHUẨN THỨ TÊN NÓ NÓI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu lọc bằng `!duocPhu(d) || d.boQua || !d.tuCanh` — ba vế **HỢP**, trong đó `!d.tuCanh` đúng
 * với **mọi** mã tổng hợp không tự canh ⇒ ô thoả **bất kể** `duocPhu` phán quyết thế nào. Nó chứng
 * minh *"bộ dò THẤY một điểm"*, chứ không phải *"bộ dò XẾP điểm ấy là HỞ"*.
 * Đo được (đột biến, đã hoàn nguyên): ép `const duocPhu = () => true` ⇒ **14/14 XANH**, kể cả §1a,
 * §4 và §4b — **toàn bộ lượng từ chính tắt hoàn toàn mà không một ô nào đỏ**.
 *
 * ⇒ Vị từ tách làm hai mảnh, và §1 khẳng định **ĐÚNG MẢNH mà §4 tin**:
 *   · `phuTheoHinhDang(d, diemChungBat)` — công thức thật, `DIEM_CHUNG_CUONG_CHE` là **THAM SỐ** để
 *     §1 hiệu chuẩn được cả hai chiều (bật/tắt);
 *   · `laTuCanhGhim(d)` — tập miễn trừ ghim tay, canh riêng ở §5.
 * ⚠ MA_HO nay tách làm **HAI** bảng theo **đáp số biết trước**, vì hai nhóm hình dạng có hai đáp số
 *   khác nhau: nhóm HỞ phải bị **XẾP LÀ VI PHẠM**; nhóm đi-qua-điểm-chung phải được **PHỦ khi điểm
 *   chung BẬT** và **HỞ khi điểm chung TẮT**. Gộp chúng vào một bảng là cách ô cũ trở nên tự thoả.
 */
const phuTheoHinhDang = (d: DiemXacThuc, diemChungBat: boolean): boolean =>
  (d.loai === "xt" && diemChungBat && !d.boQua) || d.tuCanh;
/** Điểm này CÓ được cưỡng chế không. */
const duocPhu = (d: DiemXacThuc): boolean =>
  phuTheoHinhDang(d, DIEM_CHUNG_CUONG_CHE) || laTuCanhGhim(d);
const nhan = (d: DiemXacThuc) => `${d.duong}:${d.dong} [${d.loai}]`;

describe("★★★★ Pha 8 Task 1 — ∀ điểm xác thực HTTP/socket: cờ buộc-đổi-mật-khẩu phải được kiểm", () => {
  /* ── §1 ĐỐI CHỨNG TỔNG HỢP — hiệu chuẩn thước bằng đáp số biết trước ────────────────────────── */

  /**
   * Hình dạng **HỞ THẬT SỰ**: kể cả khi điểm chung ĐANG cưỡng chế, vị từ phủ vẫn phải xếp chúng là
   * **VI PHẠM**. ⚠ Hai hình dạng *"gọi thẳng/qua import động điểm chung"* **KHÔNG** ở đây — chúng
   * được **PHỦ** khi điểm chung bật, nên bắt chúng ở ô này là một dương tính giả. Chúng có bảng
   * riêng ngay dưới, với một đáp số khác.
   */
  const MA_HO = [
    ["TẮT cổng tường minh", `async function f(req){ return sdk.${TEN_XAC_THUC}(req, { ${O_BO_QUA}: true }); }`],
    ["TẮT cổng bằng biến", `async function f(req){ return sdk.${TEN_XAC_THUC}(req, opts); }`],
    ["vòng qua điểm chung", `async function f(t){ const s = await sdk.${TEN_PHAN_GIAI_PHIEN}(t); return getUserByOpenId(s.openId); }`],
    /**
     * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-5** — **HÌNH DẠNG THỨ BA, vùng mù §"VÙNG MÙ ĐƯỢC KHAI"
     * mục 2 của chính file này.** Câu ấy viết *"đo được hôm nay: không tồn tại — nhưng đó là một
     * **quan sát**, không phải bất biến"*. Đo lại ở review Pha 9: bộ nhận diện trả **`[]`** cho
     * đúng hình dạng ấy ⇒ một bề mặt HTTP không kiểm cờ nào **vô hình với cả ba** lượng từ ∀.
     * Ô này biến quan sát thành bất biến: gỡ nhánh thứ ba khỏi `quetDiemXacThuc` ⇒ **ĐỎ**.
     */
    [
      "HÌNH DẠNG THỨ BA — tra thẳng sổ phiên rồi lấy hàng `users` (I-5)",
      `async function f(t){ const p = await db.${TEN_TRA_SO_PHIEN}(t); const u = await getUserById(p.userId); return u; }`,
    ],
  ] as const;

  /** Hình dạng **CƯỠI ĐIỂM CHUNG**: phủ khi điểm chung BẬT, hở khi điểm chung TẮT. */
  const MA_QUA_DIEM_CHUNG = [
    ["gọi thẳng điểm chung", `async function f(req){ return sdk.${TEN_XAC_THUC}(req); }`],
    ["gọi qua import động", `async function f(req){ const {sdk} = await import("./sdk"); return sdk.${TEN_XAC_THUC}(req); }`],
  ] as const;

  const MA_KIN = [
    ["tự canh sau `authenticateRequest`", `async function f(req){ const u = await sdk.${TEN_XAC_THUC}(req, { ${O_BO_QUA}: true }); await ${TEN_PHEP_CHAN}(u); return u; }`],
    ["tự canh sau `verifySession`", `async function f(t){ const s = await sdk.${TEN_PHAN_GIAI_PHIEN}(t); const u = await getUserByOpenId(s.openId); await ${TEN_PHEP_CHAN}(u); return u; }`],
    ["tắt cổng = `false` tường minh", `async function f(req){ return sdk.${TEN_XAC_THUC}(req, { ${O_BO_QUA}: false }); }`],
    ["mắt xích NỘI BỘ của điểm chung", `class S { async ${TEN_XAC_THUC}(req){ return this.${TEN_PHAN_GIAI_PHIEN}(req); } }`],
    // ★ I-5 — đối chứng DƯƠNG của hình dạng thứ ba: nhánh mới **không** bắt nhầm một bề mặt tự canh.
    [
      "HÌNH DẠNG THỨ BA có tự canh cờ mật khẩu (I-5)",
      `async function f(t){ const p = await db.${TEN_TRA_SO_PHIEN}(t); const u = await getUserById(p.userId); await ${TEN_PHEP_CHAN}(u); return u; }`,
    ],
  ] as const;

  it("§1a ĐỘT BIẾN TỔNG HỢP — hình dạng HỞ bị XẾP LÀ VI PHẠM (không chỉ 'được nhìn thấy')", () => {
    /**
     * ⚠⚠⚠ Ô này khẳng định **ĐÚNG VỊ TỪ §4 dùng** (`duocPhu`), trên đường dẫn tổng hợp không nằm
     * trong `BE_MAT_TU_CANH`. Ép `duocPhu`/`phuTheoHinhDang` thành `true` ⇒ ô này **ĐỎ**.
     * Bản cũ (`!duocPhu(d) || d.boQua || !d.tuCanh`) thoả **bất kể** vị từ phán quyết thế nào —
     * đo được: cổng chính tắt hoàn toàn mà **14/14 vẫn XANH**.
     */
    for (const [ten, ma] of MA_HO) {
      const diem = quetDiemXacThuc("tong-hop.ts", ma);
      expect(diem.length, `bộ nhận diện MÙ với hình dạng "${ten}"`).toBeGreaterThan(0);
      expect(
        diem.filter((d) => !duocPhu(d)).length,
        `hình dạng "${ten}" KHÔNG bị xếp là HỞ — vị từ phủ đã bị nới, mọi màu xanh bên dưới là vô nghĩa`,
      ).toBeGreaterThan(0);
    }
  });

  it("§1a2 ĐIỂM CHUNG TẮT ⇒ hình dạng CƯỠI ĐIỂM CHUNG trở thành HỞ (vị từ THẬT SỰ phụ thuộc nó)", () => {
    /**
     * ⚠ Không có ô này, `phuTheoHinhDang` có thể bỏ qua tham số `diemChungBat` mà §1a/§1b vẫn xanh
     *   — và §4b (*"điểm chung thật sự cưỡng chế"*) sẽ là ô **duy nhất** biết chuyện, tức lại là
     *   một cổng đơn độc.
     */
    for (const [ten, ma] of MA_QUA_DIEM_CHUNG) {
      const diem = quetDiemXacThuc("tong-hop.ts", ma).filter((d) => d.loai === "xt");
      expect(diem.length, `bộ nhận diện MÙ với hình dạng "${ten}"`).toBeGreaterThan(0);
      expect(
        diem.every((d) => phuTheoHinhDang(d, true)),
        `hình dạng "${ten}" KHÔNG được phủ khi điểm chung BẬT ⇒ dương tính giả`,
      ).toBe(true);
      expect(
        diem.some((d) => phuTheoHinhDang(d, false)),
        `hình dạng "${ten}" vẫn khai PHỦ khi điểm chung TẮT ⇒ vị từ giả, §4 không bao giờ đỏ được`,
      ).toBe(false);
    }
  });

  it("§1b ĐỐI CHỨNG DƯƠNG TỔNG HỢP — bốn hình dạng kín đều được THA (không dương tính giả)", () => {
    for (const [ten, ma] of MA_KIN) {
      // Điểm chung được giả định ĐANG cưỡng chế ở phép thử tổng hợp này (biến duy nhất là hình dạng
      // của lượt gọi) ⇒ **CÙNG công thức** `phuTheoHinhDang`, chỉ khác tham số.
      const ho = quetDiemXacThuc("tong-hop.ts", ma).filter((d) => !phuTheoHinhDang(d, true));
      expect(
        ho.map(nhan),
        `DƯƠNG TÍNH GIẢ ở hình dạng "${ten}" — lưới này sẽ dạy người sau né bằng cách sai`,
      ).toEqual([]);
    }
  });

  it("§1c thước phân biệt được ĐIỂM CHUNG có cưỡng chế hay không", () => {
    expect(
      diemChungCuongChe(`class S { async ${TEN_XAC_THUC}(req){ const u = await this.tho(req); await ${TEN_PHEP_CHAN}(u); return u; } }`),
      "bộ nhận diện điểm chung MÙ — nó sẽ khai XANH cả khi phép chặn đã bị gỡ",
    ).toBe(true);
    expect(
      diemChungCuongChe(`class S { async ${TEN_XAC_THUC}(req){ return this.tho(req); } }`),
      "bộ nhận diện điểm chung khai CÓ cưỡng chế trên một thân KHÔNG hề gọi phép chặn",
    ).toBe(false);
    expect(
      diemChungCuongChe(`class S { async khac(req){ await ${TEN_PHEP_CHAN}(req); } }`),
      "phép chặn ở một phương thức KHÁC không được tính là điểm chung đã cưỡng chế",
    ).toBe(false);
  });

  /* ── §2 PHẠM VI — glob rỗng ⇒ vitest im lặng khai XANH (đã SÁU lần) ─────────────────────────── */
  it("§2 lượt quét đĩa KHÔNG rỗng", () => {
    expect(
      MOI_FILE_SX.length,
      "quét `server/**` (không test) ra quá ít file — phạm vi đã hỏng?",
    ).toBeGreaterThanOrEqual(500);
  });

  /* ── §3 LIÊN HỆ VỚI KHO MÃ THẬT — §1 xanh + §3 đỏ = thước sống nhưng mù với repo ────────────── */
  it("§3 bộ nhận diện THẤY kho mã thật (đủ cả ba hình dạng)", () => {
    // Đo được 2026-08-09 trên `18432e91`: **12** điểm `xt` + **1** điểm `phien` = 13.
    // ⚠ Pha 9 A6: bảy điểm gọi của tuyến REST gộp về `thuXacThucRest` ⇒ nếu bộ nhận diện KHÔNG biết
    //   hình dạng thứ ba, con số này rơi **13 → 6** và bảy bề mặt rời khỏi tầm phát biểu của lượng
    //   từ. Tổng vẫn **13** sau khi bộ nhận diện được dạy (xem `quetDiemXacThuc.ts`).
    expect(
      MOI_DIEM.filter((d) => d.loai === "xt").length,
      "0 điểm `authenticateRequest` trong mã sản xuất — bộ nhận diện đang mù với repo",
    ).toBeGreaterThanOrEqual(12);
    expect(
      MOI_DIEM.filter((d) => d.loai === "phien").length,
      "0 điểm `verifySession` ngoài lớp khai nó — nhánh 'vòng qua điểm chung' của thước đã chết",
    ).toBeGreaterThanOrEqual(1);
  });

  it("★★★★ Pha 9 — LƯỢT UỶ QUYỀN REST thật sự đi qua ĐIỂM CHUNG (7 bề mặt được phủ nhờ dòng này)", () => {
    /**
     * ⚠⚠ A6 gộp bảy điểm gọi của tuyến REST về `thuXacThucRest`. Bộ nhận diện coi lượt gọi ấy là
     *    một điểm xác thực **ĐƯỢC PHỦ** — điều đó chỉ ĐÚNG khi chủ ấy thật sự uỷ quyền cho điểm
     *    chung. Nếu ai viết lại nó để **tự** phân giải danh tính (đúng hình dạng lỗ C-1), ô này ĐỎ.
     *    Không có ô này, hình dạng thứ ba là một cái tên được tin **theo lời khai**.
     */
    expect(
      uyQuyenRestDiQuaDiemChung(readFileSync(join(GOC, FILE_UY_QUYEN_REST), "utf8")),
      `${FILE_UY_QUYEN_REST}::${TEN_UY_QUYEN_REST} không còn gọi ${TEN_XAC_THUC} ⇒ bảy bề mặt REST vừa ` +
        "rời khỏi mọi cưỡng chế của điểm chung, mà lượng từ vẫn khai XANH.",
    ).toBe(true);
  });

  /* ── §4 LƯỢNG TỪ CHÍNH ─────────────────────────────────────────────────────────────────────── */
  it("§4 ∀ điểm xác thực trong mã sản xuất `server/**`: cờ buộc-đổi-mật-khẩu ĐƯỢC KIỂM", () => {
    const viPham = MOI_DIEM.filter((d) => !duocPhu(d));
    expect(
      viPham.map(nhan),
      [
        "Một bề mặt xác thực người dùng mà KHÔNG kiểm cờ buộc-đổi-mật-khẩu.",
        "Người bị buộc đổi mật khẩu vẫn dùng được bề mặt này — cưỡng chế HẸP HƠN TÊN GỌI của nó.",
        `⇒ Cách đúng: để lượt gọi đi qua ĐIỂM CHUNG \`sdk.${TEN_XAC_THUC}\` (không truyền \`${O_BO_QUA}\`),`,
        `  hoặc — nếu bề mặt tự phân giải phiên — gọi \`${TEN_PHEP_CHAN}(user)\` ngay sau khi có hàng \`users\`.`,
        "  KHÔNG thêm mục vào `BE_MAT_TU_CANH` trừ khi có một cơ chế canh THAY THẾ, ghi tên vào `canh_boi`.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("§4b ĐIỂM CHUNG thật sự cưỡng chế (11/13 điểm được phủ CHỈ nhờ dòng này)", () => {
    expect(
      DIEM_CHUNG_CUONG_CHE,
      `\`${FILE_DIEM_CHUNG}::${TEN_XAC_THUC}\` không còn gọi \`${TEN_PHEP_CHAN}\` ⇒ MỌI bề mặt ngoài tRPC hở lại cùng lúc`,
    ).toBe(true);
  });

  /* ── §5 TẬP TỰ CANH: ghim SỐ, neo hai chiều, không mục rữa ──────────────────────────────────── */
  it("§5a tập bề mặt tự canh đúng SỐ đã ghim", () => {
    expect(
      BE_MAT_TU_CANH.map((b) => b.duong),
      "tập bề mặt được phép vòng qua điểm chung đã đổi — đây là một quyết định an ninh",
    ).toEqual(["server/_core/context.ts"]);
    expect(BE_MAT_TU_CANH.every((b) => b.canh_boi.length > 0), "mỗi mục phải nêu cơ chế canh THAY THẾ").toBe(true);
  });

  it("§5b neo chiều A — mỗi mục tự canh TỒN TẠI như một điểm xác thực trên đĩa", () => {
    const ma = BE_MAT_TU_CANH.filter((b) => !MOI_DIEM.some((d) => d.duong === b.duong));
    expect(
      ma.map((b) => b.duong),
      "mục ma: đường dẫn không còn là điểm xác thực nào ⇒ nó vẫn tiếp tục THA cho một điểm mới trùng chỗ",
    ).toEqual([]);
  });

  /* ── §6 ĐƯỜNG THOÁT — "KHÔNG ĐƯỢC KHOÁ AI RA NGOÀI" ────────────────────────────────────────── */
  it("§6 tập cho qua của tRPC còn nguyên bốn đường của vòng đời đổi mật khẩu", () => {
    /**
     * ⚠⚠ Pha 7 đã deploy một lần ra **nhà tù thật 4/4 tài khoản**. Ô này ghim rằng lượt mở rộng
     * phạm vi của Task 1 **không** đụng vào lối ra.
     * ⚠ Vì sao KHÔNG có đường thoát nào ở bề mặt NGOÀI tRPC: đo được ở lượt này — toàn bộ vòng đời
     *   đổi mật khẩu (`auth.login` · `auth.me` · `auth.logout` · `user.changePassword`) là **thủ tục
     *   tRPC**, không một tuyến REST/socket nào phục vụ nó. Hai tuyến REST mang chữ `login`
     *   (`/api/auth/login`, `/api/external/auth/login`) **tạo** phiên nên theo cấu tạo không đi qua
     *   điểm xác thực nào ⇒ lượng từ này không chạm tới chúng. ⇒ Tập cho qua ngoài tRPC = **RỖNG**,
     *   và đó là con số ĐÚNG, không phải một chỗ bỏ sót.
     */
    expect(THU_TUC_CHO_QUA).toEqual(["auth.login", "auth.me", "auth.logout", "user.changePassword"]);
  });

  /* ── §7 HÀNH VI SỐNG — không phải hình dạng ─────────────────────────────────────────────────── */
  describe("§7 hành vi SỐNG của điểm chung trên DB thật", () => {
    const HASH = "$2b$10$mYIpBDnkaP3c6VCDuxdEEe88zwP3d.NXN37VdbNmmtMlxBKQvEUUm"; // bcrypt("matkhaucu123", 10)
    let uid = 0;

    beforeAll(async () => {
      uid = (
        await db.createLocalUser({
          username: `__p8t1_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          passwordHash: HASH,
          name: "Pha 8 Task 1 — bề mặt ngoài tRPC",
          role: "user",
        })
      ).id;
    });

    afterAll(async () => {
      if (uid) await db.deleteUser(uid);
    });

    /** Đặt/gỡ cờ bằng chính hai mốc mà `suyRaPhaiDoiMatKhau` đọc. */
    async function datMoc(doiLuc: Date | null, thuHoiLuc: Date | null): Promise<void> {
      const { getDb } = await import("../db/connection");
      const { eq } = await import("drizzle-orm");
      const { users } = await import("../../drizzle/schema");
      const d = await getDb();
      await d!
        .update(users)
        .set({ passwordChangedAt: doiLuc, passwordInvalidBefore: thuHoiLuc })
        .where(eq(users.id, uid));
    }
    const batCo = () => datMoc(new Date(Date.now() - 60_000), new Date());
    const tatCo = () => datMoc(new Date(), null);

    /** Thông điệp lỗi của lượt gọi, hoặc `null` nếu KHÔNG ném. */
    async function loiCua(chay: () => Promise<unknown>): Promise<string | null> {
      try {
        await chay();
        return null;
      } catch (err) {
        return String((err as Error)?.message ?? err);
      }
    }

    it("§7a CẦU CHÌ (đối chứng ÂM) — KHÔNG có cờ ⇒ phép chặn IM LẶNG", async () => {
      // ⚠ Không có ô này, mọi ô "bị chặn" bên dưới có thể đang xanh vì một lý do KHÁC HẲN.
      expect(uid).toBeGreaterThan(0);
      await tatCo();
      expect(await db.phaiDoiMatKhau(uid), "cầu chì: cờ phải TẮT").toBe(false);
      const { chanNeuPhaiDoiMatKhau } = await import("./sdk");
      const u = (await db.getUserById(uid)) as never;
      expect(await loiCua(() => chanNeuPhaiDoiMatKhau(u))).toBe(null);
    });

    it("§7b CÓ cờ + vai KHÔNG miễn trừ ⇒ phép chặn NÉM (bề mặt ngoài tRPC đóng lại)", async () => {
      await batCo();
      expect(await db.phaiDoiMatKhau(uid), "cầu chì: cờ phải BẬT trước khi đo phép chặn").toBe(true);
      const { chanNeuPhaiDoiMatKhau } = await import("./sdk");
      const u = (await db.getUserById(uid)) as never;
      const loi = await loiCua(() => chanNeuPhaiDoiMatKhau(u));
      expect(loi, "cờ bật mà phép chặn im lặng ⇒ 11 bề mặt ngoài tRPC vẫn mở").not.toBeNull();
      expect(loi).toMatch(/MUST_CHANGE_PASSWORD/);
    });

    it("🔴 §7c MIỄN TRỪ CỐ Ý giữ nguyên — `admin` CÓ cờ mà KHÔNG bị chặn (quyết định chủ dự án 2026-08-09)", async () => {
      /**
       * ⚠⚠⚠ CA NÀY GHIM MỘT LỖ, KHÔNG PHẢI MỘT TÍNH NĂNG — chủ của tập miễn trừ và toàn bộ lý do
       * nằm ở `shared/buocDoiMatKhau.ts`. Ở đây nó được ghim lần thứ ba, trên **bề mặt ngoài tRPC**:
       * lượt mở rộng phạm vi của Task 1 KHÔNG được lặng lẽ siết chặt hơn quyết định ấy.
       * ⇒ THÍ NGHIỆM MỘT BIẾN: cùng người, cùng cờ đang bật thật, chỉ `role` đổi.
       */
      expect(VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU, "tập miễn trừ đã đổi — đây là một quyết định an ninh").toEqual([
        "admin",
      ]);
      await batCo();
      expect(await db.phaiDoiMatKhau(uid), "cầu chì: cờ PHẢI đang bật, nếu không ca này rỗng nghĩa").toBe(true);

      const { chanNeuPhaiDoiMatKhau } = await import("./sdk");
      const goc = (await db.getUserById(uid)) as unknown as { role: string };
      expect(goc.role, "cầu chì: vai phải đến từ hàng DB, và hàng ấy là `user`").toBe("user");
      expect(await loiCua(() => chanNeuPhaiDoiMatKhau(goc as never))).not.toBeNull();

      const mienTru = { ...goc, role: "admin" };
      expect(
        await loiCua(() => chanNeuPhaiDoiMatKhau(mienTru as never)),
        "admin ĐANG bị buộc đổi mật khẩu mà bề mặt ngoài tRPC vẫn chặn ⇒ miễn trừ đã mất",
      ).toBe(null);
    });

    it("§7d ĐỌC DB MỚI, không đọc hàng đã che — cờ bật SAU khi hàng được nạp vẫn chặn", async () => {
      /**
       * ⚠⚠ Lớp lỗi đã đo được ở Pha 7: `redactServerOnlyUserFields` làm rỗng hai mốc mật khẩu, nên
       * mọi phép suy từ **hàng trong tay** cho `false` LUÔN LUÔN — một lời nói dối im lặng theo
       * chiều MỞ. Điểm chung còn có **bộ nhớ đệm phiên** (`AUTH_CACHE_TTL_S`), nên hàng nó cầm có
       * thể cũ tới 60 s. Ô này chứng minh phép chặn hỏi **DB**, không hỏi hàng ấy.
       */
      await tatCo();
      const { chanNeuPhaiDoiMatKhau } = await import("./sdk");
      const hangCu = (await db.getUserById(uid)) as never; // chụp lúc cờ đang TẮT
      expect(await loiCua(() => chanNeuPhaiDoiMatKhau(hangCu))).toBe(null);

      await batCo(); // cờ bật SAU khi hàng đã nằm trong tay
      expect(
        await loiCua(() => chanNeuPhaiDoiMatKhau(hangCu)),
        "phép chặn đang suy từ HÀNG TRONG TAY chứ không đọc DB ⇒ nó sẽ nói dối theo chiều MỞ",
      ).not.toBeNull();
    });
  });
});
