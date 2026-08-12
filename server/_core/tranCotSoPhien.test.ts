/**
 * ★★★★ Review TOÀN NHÁNH Pha 8 · **C-2** — **KHÔNG HEADER NÀO ĐÚC ĐƯỢC MỘT PHIÊN KHÔNG THU HỒI ĐƯỢC.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ***∀ cột `varchar(n)` của `user_sessions`: giá trị ghi vào bị cắt về đúng `n` — trần SUY TỪ
 * SCHEMA, không từ một danh sách viết tay — nên KHÔNG lượt `INSERT` nào hỏng vì độ dài.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐO ĐƯỢC TRÊN MÁY CHỦ SỐNG (PID 37600, mã trước bản vá) — KHÔNG PHẢI SUY LUẬN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *     login (`User-Agent` **3.770** ký tự)  ⇒ HTTP 200  {"success":true,"user":{"id":51,…}}
 *     select id from user_sessions where id > 290       ⇒ **(0 rows)**   ← KHÔNG CÓ HÀNG SỔ
 *     auth.logout                            ⇒ HTTP 200 {"success":true} ← "ĐĂNG XUẤT THÀNH CÔNG"
 *     auth.me                                ⇒ HTTP 200 {"id":51,…}      ← **VẪN ĐỦ HỒ SƠ**
 * Biến duy nhất đổi so với lượt đối chứng (phiên CÓ hàng sổ ⇒ `auth.me` = `null`) là **độ dài
 * header `User-Agent`** — dữ liệu **KẺ TẤN CÔNG** đặt tuỳ ý.
 *
 * Cơ chế, đo lại độc lập trên PostgreSQL thật (giao dịch tạm, bảng TEMP, đã `ROLLBACK`):
 *     INSERT INTO t_probe(x varchar(255)) VALUES (repeat('x',300))
 *     ⇒ ERROR: value too long for type character varying(255)
 * Và `information_schema` của **cả hai** DB xác nhận `deviceName varchar(255)` · `ipAddress
 * varchar(45)` · `sessionToken text` (mig 0317 đã áp).
 * ⚠ **HÌNH DẠNG ẤY NAY ĐÃ ĐỔI** — mig `0318` (deviceName) và `0319` (ipAddress) đều đã áp trên cả
 *   hai DB, nên **cả ba** cột trên đều là `text`. Phép đo `information_schema` 2026-08-12 (cả hai
 *   DB, giống hệt nhau) nói `user_sessions` còn **ĐÚNG BỐN** cột mang trần: `deviceType` 50 ·
 *   `browser` 100 · `os` 100 · `location` 255. Đoạn đo sống ở trên **giữ nguyên** vì nó là bản ghi
 *   lịch sử của lỗ C-2 lúc còn sống — không phải mô tả lược đồ hôm nay.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BA LỚP CHỐNG "TỰ THOẢ"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **§1 TRẦN SUY TỪ SCHEMA** — nếu bộ suy trần trả rỗng, mọi ô dưới thành chân lý rỗng ⇒ ô cầu
 *     chì đo lại chính nó và neo vào hai cột ĐO ĐƯỢC (`deviceName` 255 · `ipAddress` 45).
 *  2. **§2 HÀNH VI trên DB THẬT** — §1 chỉ nói *"phép cắt có hình dạng đúng"*. §2 gọi `ghiSoPhien`
 *     với **UA dài THẬT (3.770 ký tự)** trên `aoi_management_test` và đọc lại hàng sổ. Một chuỗi
 *     ngắn ở đây làm ca **xanh vô nghĩa** — đó chính là cách ca 300-ký-tự cũ bị dời đi mà không ai
 *     hỏi cột kế bên có trần không.
 *  3. **§4 NGƯỜI GHI DUY NHẤT** — ∀ điểm `.insert(userSessions)` trong `server/**` phải đi qua
 *     `catTheoTranCot`. Một người ghi **THỨ HAI** ở một file chưa tồn tại tự vào lượng từ (M3).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÙNG MÙ ĐƯỢC KHAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. Cắt là **chuẩn hoá**, không phải kiểm tra. Nó đóng lớp lỗi `22001`; nó **không** đóng các
 *     nguyên nhân khác của một lượt ghi sổ hỏng (mất kết nối, quyền bị thu, bảng đổi hình dạng).
 *     Nửa ấy do bộ đếm `soPhien_ghiSoLoi_total` canh — nay có bề mặt Prometheus (§3).
 *  2. ~~`deviceName` vẫn là `varchar(255)`~~ — **mig `0318` ĐÃ ÁP 2026-08-11 trên CẢ HAI DB**
 *     (`deviceName` → `text`, chủ dự án duyệt). Và lượt áp ấy **chứng minh câu vừa nói ở trên**:
 *     phép cắt đọc trần **từ schema**, nên `deviceName` **tự rời** tập bị cắt — **không một dòng mã
 *     sản xuất nào phải sửa**. Thứ duy nhất đổi là các ô của lưới này, vì chúng ghim SỐ (§1a/§2a).
 *     ⇒ Nay một UA dài được lưu **NGUYÊN VĂN**.
 *  3. ~~`ipAddress` vẫn là `varchar(45)`~~ — **mig `0319` ĐÃ ÁP 2026-08-12 trên CẢ HAI DB**
 *     (`ipAddress` → `text`, chủ dự án duyệt). Lần thứ **hai** liên tiếp một lượt DDL đổi tập bị
 *     cắt mà **không dòng mã sản xuất nào phải sửa** — chỉ các ô ghim SỐ của lưới này đổi.
 *     ⇒ Câu `INSERT` của `ghiSoPhien` nay **không còn cột nào mang trần** (`sessionToken` ·
 *       `deviceName` · `ipAddress` đều `text`). §2a vì thế đổi **chiều đo**: nó đo *"cả hai cột vào
 *       DB NGUYÊN VĂN"* thay vì đo một phép cắt không còn tồn tại — và cầu chì §2a chuyển sang neo
 *       vào **sự sống của bộ suy trần** (4 cột khác vẫn có trần), không neo vào một con số.
 *     ⚠ Bản `.DRAFT` của 0319 tự khai *"lúc đó `user_sessions` không còn cột `varchar` nào"*. Phép
 *       đo bác bỏ: còn **4**. Một chú thích về trạng thái mà không ai đo lại là một cái bẫy có hạn dùng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import ts from "typescript";
import { moiFileDuoi, laFileTest } from "../routers/deployProcedureScan";
import { catTheoTranCot, catChuoi, tranVarcharCua } from "../db/catTheoTranCot";
import { ghiSoPhien } from "./authService";
import {
  demLoiGhiSoPhien,
  datLaiDemLoiGhiSoPhien,
  renderSoPhienPrometheus,
} from "./demSoPhien";
import * as db from "../db";
import { userSessions } from "../../drizzle/schema";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/** Dấu riêng của file này — mọi hàng nó tạo mang tiền tố này, và lượt dọn khoá đúng vào đó. */
const DAU = "p8c2-tran-cot";
/** Độ dài header `User-Agent` của lượt đo sống. **Dùng đúng số này**, không dùng một chuỗi ngắn. */
const DAI_THAT = 3770;
const UA_DAI = "Mozilla/5.0 (".concat("A".repeat(DAI_THAT - 13));

const TRAN = tranVarcharCua(userSessions);

describe("★★★★ Review TOÀN NHÁNH Pha 8 C-2 — ∀ cột varchar của `user_sessions`: cắt theo trần SCHEMA", () => {
  /* ── §1 TRẦN SUY TỪ SCHEMA ─────────────────────────────────────────────────────────────────── */
  it("§1a cầu chì — bộ suy trần KHÔNG rỗng và khớp cột ĐO ĐƯỢC trên cả hai DB (SAU mig 0318)", () => {
    /**
     * ★★★ **SỐ NÀY HẠ 5 → 4 VÌ MIG `0319`** (áp 2026-08-12, cả hai DB): `ipAddress` rời tập bị cắt.
     * ⚠ Bản `.DRAFT` của 0319 tự khai *"lúc đó `user_sessions` **không còn cột `varchar` nào**"* —
     *   **câu ấy SAI**, và nó sai theo hướng nguy hiểm (nó đề nghị gỡ luôn cầu chì này). Phép đo
     *   `information_schema` sau lượt áp, **cả hai** DB, trả về **ĐÚNG BỐN** cột còn trần:
     *   `deviceType` 50 · `browser` 100 · `os` 100 · `location` 255. Tập **chưa** rỗng ⇒ cầu chì
     *   vẫn còn việc để làm, và phép cắt vẫn **không** phải no-op cho bảng này.
     */
    expect(
      Object.keys(TRAN).length,
      "0 cột có trần ⇒ phép cắt là no-op và MỌI ô dưới đây là chân lý rỗng",
    ).toBeGreaterThanOrEqual(4);
    /**
     * ★★★★ **Ô NÀY VỪA ĐỔI CHIỀU VÌ MIG `0318` (áp 2026-08-11, cả hai DB).** Trước đó nó ghim
     * `TRAN.deviceName === 255`. Nay cột là `text` ⇒ **không có trần** ⇒ nó phải **RỜI** tập bị cắt.
     * ⚠ Đây đúng là điều `0318` được soạn ra để làm, và cũng là bằng chứng phép cắt suy trần **từ
     *   schema** chứ không từ một danh sách viết tay: DDL đổi, mã sản xuất **không đổi một dòng**.
     * ⚠ Ô này ĐỎ nếu ai đó hoàn nguyên `0318` **hoặc** để khai báo TS lệch khỏi DB — drizzle liệt kê
     *   toàn bộ cột ở mọi câu lệnh, nên một ô lệch kiểu cắn ở chỗ khác chứ không cắn tại đây.
     */
    expect(
      TRAN.deviceName,
      "`deviceName` phải KHÔNG còn trần (mig 0318 đổi sang `text`) — còn trần ⇒ khai báo TS lệch DB",
    ).toBeUndefined();
    expect(
      Object.keys(TRAN),
      "`deviceName` vẫn nằm trong tập bị cắt ⇒ một UA dài vẫn bị cắt dù cột đã là `text`",
    ).not.toContain("deviceName");
    /**
     * ★★★ **Ô NÀY ĐỔI CHIỀU VÌ MIG `0319`** — hệt như ô `deviceName` ngay trên đã đổi vì `0318`.
     * Trước: `TRAN.ipAddress === 45`. Nay cột là `text` ⇒ nó phải **RỜI** tập bị cắt.
     * ⇒ **Câu `INSERT` của `ghiSoPhien` nay KHÔNG còn cột nào mang trần**: cả ba cột nó ghi
     *   (`sessionToken` · `deviceName` · `ipAddress`) đều là `text`. Đó là chủ ý, và §2a bên dưới
     *   được viết lại để **đo chính điều đó** thay vì đo một phép cắt không còn tồn tại.
     */
    expect(
      TRAN.ipAddress,
      "`ipAddress` phải KHÔNG còn trần (mig 0319 đổi sang `text`) — còn trần ⇒ khai báo TS lệch DB",
    ).toBeUndefined();
    expect(
      Object.keys(TRAN),
      "`ipAddress` vẫn nằm trong tập bị cắt ⇒ một IP dài vẫn bị cắt cụt dù cột đã là `text`",
    ).not.toContain("ipAddress");
    /**
     * Neo vào **bốn cột ĐO ĐƯỢC** còn lại (`information_schema`, cả hai DB, 2026-08-12). Nếu bộ suy
     * trần hỏng hoặc khai báo TS lệch khỏi DB, các ô này ĐỎ — đó là việc của cầu chì §1a.
     */
    expect(TRAN.deviceType, "`deviceType` varchar(50) — đo trên cả hai DB").toBe(50);
    expect(TRAN.browser, "`browser` varchar(100) — đo trên cả hai DB").toBe(100);
    expect(TRAN.os, "`os` varchar(100) — đo trên cả hai DB").toBe(100);
    expect(TRAN.location, "`location` varchar(255) — đo trên cả hai DB").toBe(255);
  });

  it("★★★ §1b `sessionToken` KHÔNG BAO GIỜ nằm trong tập bị cắt (cắt KHOÁ PHIÊN = tái tạo C-2)", () => {
    expect(
      Object.keys(TRAN),
      "`sessionToken` bị cắt ⇒ hàng sổ không bao giờ khớp cookie ⇒ đúng lỗ C-2, im lặng hơn",
    ).not.toContain("sessionToken");
    const token = "t".repeat(4000);
    expect(
      (catTheoTranCot(userSessions, { sessionToken: token }) as { sessionToken: string }).sessionToken,
      "khoá phiên bị chạm",
    ).toBe(token);
  });

  it("§1c ĐỘT BIẾN TỔNG HỢP — mọi cột có trần đều bị cắt về ĐÚNG trần, không cột nào sót", () => {
    const vao: Record<string, unknown> = { userId: 1, expiresAt: new Date(), sessionToken: "x" };
    for (const ten of Object.keys(TRAN)) vao[ten] = "z".repeat(5000);
    const ra = catTheoTranCot(userSessions, vao) as Record<string, unknown>;
    const sai = Object.entries(TRAN).filter(([ten, n]) => (ra[ten] as string).length !== n);
    expect(sai.map(([t]) => t), "cột có trần mà KHÔNG bị cắt về đúng trần").toEqual([]);
  });

  it("§1d ĐỐI CHỨNG DƯƠNG — chuỗi ngắn hơn trần đi qua NGUYÊN VẸN (không cắt bừa)", () => {
    /**
     * ⚠ SAU `0318`+`0319` cả `deviceName` lẫn `ipAddress` đều **không còn trần** ⇒ hai ô ấy giờ chỉ
     *   chứng minh *"cột không trần đi qua nguyên vẹn"*, **không** chứng minh *"không cắt bừa"*.
     *   Nên ca này thêm một cột **CÒN trần** (`browser` 100): đó mới là chỗ một phép cắt hỏng có thể
     *   cắt nhầm một giá trị ngắn. Thiếu nó, §1d là một ô **tự thoả**.
     */
    const ra = catTheoTranCot(userSessions, {
      deviceName: "curl/8.7.1",
      ipAddress: "127.0.0.1",
      browser: "Chrome",
    }) as Record<string, unknown>;
    expect(ra.deviceName, "cắt nhầm một UA bình thường ⇒ lưới này sẽ bị người sau tắt đi").toBe("curl/8.7.1");
    expect(ra.ipAddress).toBe("127.0.0.1");
    expect(ra.browser, "cột CÒN trần mà bị cắt dù ngắn hơn trần ⇒ phép cắt hỏng").toBe("Chrome");
  });

  it("§1e cặp thay thế KHÔNG bị chẻ đôi ở đuôi (không đẩy `U+FFFD` xuống DB)", () => {
    // "😀" = một cặp thay thế = 2 đơn vị UTF-16. Cắt ở 5 rơi đúng vào giữa cặp thứ ba.
    const s = "😀😀😀";
    const cat = catChuoi(s, 5);
    expect(cat.length, "cắt ở giữa cặp thay thế phải lùi lại một đơn vị").toBe(4);
    expect(/[\uD800-\uDBFF]$/.test(cat), "còn nửa CAO lẻ ở đuôi").toBe(false);
  });

  /* ── §2 HÀNH VI trên DB THẬT ───────────────────────────────────────────────────────────────── */
  describe("§2 hành vi SỐNG — đường ghi sổ THẬT với UA dài THẬT", () => {
    let uid = 0;

    beforeAll(async () => {
      uid = (
        await db.createLocalUser({
          username: `${DAU}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
          name: "Review Pha 8 C-2 — trần cột sổ phiên",
          role: "user",
        })
      ).id;
    });

    afterAll(async () => {
      const d = await db.getDb();
      if (d && uid) await d.delete(userSessions).where(eq(userSessions.userId, uid));
      if (uid) await db.deleteUser(uid);
    });

    it("★★★★ §2a `ghiSoPhien` với `User-Agent` 3.770 ký tự ⇒ VẪN CÓ hàng `user_sessions`", async () => {
      expect(uid).toBeGreaterThan(0);
      // Cầu chì: chuỗi phải DÀI THẬT — một chuỗi ngắn làm ô này xanh vô nghĩa.
      expect(UA_DAI.length, "UA phải dài đúng bằng lượt đo sống").toBe(DAI_THAT);
      /**
       * ★★★ **CẦU CHÌ PHẢI ĐỔI HÌNH DẠNG VÌ MIG `0319`.** Trước, nó neo vào `TRAN.ipAddress === 45`
       * — cột CÒN trần cuối cùng của câu `INSERT` này. Sau `0319` **cả ba** cột `ghiSoPhien` ghi đều
       * là `text` ⇒ **không còn trần nào trong câu INSERT này để neo vào**.
       * ⚠ Đây đúng là chỗ một lưới dễ trở nên **TỰ THOẢ**: bỏ cầu chì đi thì ô vẫn xanh, nhưng nó
       *   xanh vì *"không có gì bị cắt"* — đúng cái sẽ xảy ra nếu ai đó tắt nhầm phép cắt cho CẢ
       *   bảng. Nên cầu chì đổi **chiều đo**, không biến mất: nó chứng minh bộ suy trần **vẫn sống**
       *   (tập KHÔNG rỗng — 4 cột khác vẫn có trần) VÀ hai cột của câu INSERT này đã **cố ý** rời
       *   tập. Bộ suy trần chết ⇒ vế đầu ĐỎ; ai đó hoàn nguyên 0318/0319 ⇒ vế sau ĐỎ.
       */
      expect(
        Object.keys(TRAN).length,
        "cầu chì: bộ suy trần trả rỗng ⇒ §2a đo một phép cắt không tồn tại",
      ).toBeGreaterThanOrEqual(4);
      expect(
        Object.keys(TRAN),
        "cầu chì: `ipAddress` còn trần ⇒ mig 0319 đã bị hoàn nguyên hoặc khai báo TS lệch DB",
      ).not.toContain("ipAddress");
      expect(
        Object.keys(TRAN),
        "cầu chì: `deviceName` còn trần ⇒ mig 0318 đã bị hoàn nguyên hoặc khai báo TS lệch DB",
      ).not.toContain("deviceName");

      const token = `${DAU}-ua-dai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      datLaiDemLoiGhiSoPhien();
      const id = await ghiSoPhien({
        userId: uid,
        sessionToken: token,
        ipAddress: "9".repeat(200), // cột thứ hai của cùng câu INSERT — sau 0319 phải vào NGUYÊN VĂN
        deviceName: UA_DAI,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      expect(
        id,
        "lượt ghi sổ HỎNG ⇒ phiên này vô hình với `session.list` và NGOÀI TẦM mọi đường thu hồi",
      ).not.toBeNull();
      expect(demLoiGhiSoPhien(), "bộ đếm lỗi ghi sổ nhích ⇒ lượt INSERT vẫn vỡ").toBe(0);

      const d = await db.getDb();
      const [hang] = await d!.select().from(userSessions).where(eq(userSessions.sessionToken, token));
      expect(hang, "không có hàng sổ ⇒ đúng lỗ C-2").toBeTruthy();
      /**
       * ★★★★ **VẾ NÀY ĐỔI CHIỀU VÌ MIG `0318`.** Trước: `deviceName` bị cắt còn **255**. Nay cột là
       * `text` ⇒ UA được lưu **NGUYÊN VĂN 3.770 ký tự**. Đó là chủ ý của `0318`: `deviceName` là dữ
       * liệu **chẩn đoán**, và giữ nguyên nó không tốn ô đĩa nào (Postgres lưu `varchar(n)` và
       * `text` y hệt).
       */
      expect(
        hang!.deviceName!.length,
        "sau mig 0318 `deviceName` là `text` ⇒ UA phải vào DB NGUYÊN VĂN, không bị cắt",
      ).toBe(DAI_THAT);
      expect(hang!.deviceName, "và đúng nguyên văn chuỗi đã gửi").toBe(UA_DAI);
      /**
       * ★★★ **VẾ NÀY ĐỔI CHIỀU VÌ MIG `0319`.** Trước: `ipAddress` bị cắt về **45**. Nay cột là
       * `text` ⇒ 200 ký tự phải vào DB **NGUYÊN VĂN**.
       * ⚠ Đây không phải một ô yếu hơn ô cũ — nó đo **cùng một sự thật theo chiều ngược**: nếu ai đó
       *   hoàn nguyên `0319` trên DB mà quên khai báo TS (hoặc ngược lại), độ dài đọc lại sẽ là 45
       *   chứ không phải 200 và ô này ĐỎ. Và nó đóng đúng lớp lỗi `0319` được soạn ra để đóng: một
       *   IP **bị cắt cụt** trong sổ kiểm toán là **sai mà trông đúng**.
       */
      expect(
        hang!.ipAddress!.length,
        "sau mig 0319 `ipAddress` là `text` ⇒ phải vào DB NGUYÊN VĂN, không bị cắt cụt",
      ).toBe(200);
      expect(hang!.ipAddress, "và đúng nguyên văn chuỗi đã gửi").toBe("9".repeat(200));
      expect(hang!.sessionToken, "KHOÁ PHIÊN phải nguyên vẹn — hàng phải khớp cookie").toBe(token);
    });

    it("★★★ §2b hàng ấy THU HỒI ĐƯỢC (đó mới là thứ lỗ C-2 lấy đi)", async () => {
      const token = `${DAU}-thuhoi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await ghiSoPhien({
        userId: uid,
        sessionToken: token,
        deviceName: UA_DAI,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const truoc = await db.getSessionByToken(token);
      expect(truoc, "cầu chì: phải có hàng để thu hồi").toBeTruthy();

      await db.thuHoiPhienTheoToken(token);

      const { chanNeuPhienDaThuHoi } = await import("./sdk");
      let loi: string | null = null;
      try {
        await chanNeuPhienDaThuHoi(token);
      } catch (err) {
        loi = String((err as Error)?.message ?? err);
      }
      expect(loi, "phiên đúc bằng một UA dài vẫn KHÔNG thu hồi được ⇒ C-2 chưa đóng").not.toBeNull();
    });
  });

  /* ── §3 BỀ MẶT QUAN SÁT ĐƯỢC — "không im lặng trong lưới" ≠ "không im lặng trong sản xuất" ─── */
  it("★★★ §3 hai bộ đếm sổ phiên có mặt trong kết xuất Prometheus (đường vá 3 của C-2)", () => {
    const ra = renderSoPhienPrometheus();
    for (const ten of [
      "soPhien_ghiSoLoi_total",
      "soPhien_chanDaThuHoi_total",
      // ★ 2026-08-11 SIẾT FAIL-OPEN — bộ đếm THỨ BA: số vé bị chặn vì KHÔNG có hàng sổ. Đây là
      //   đồng hồ đo cơn đau của lượt siết; im lặng ở đây = siết mù.
      "soPhien_chanKhongCoHang_total",
    ]) {
      expect(ra, `bộ đếm \`${ten}\` không có mặt ⇒ sản xuất vẫn im lặng`).toContain(`${ten} `);
      expect(ra, `\`${ten}\` thiếu dòng TYPE ⇒ scraper Prometheus bỏ qua`).toContain(`# TYPE ${ten} counter`);
    }
  });

  it("★★★ §3b bề mặt ấy được MỘT TUYẾN THẬT phát ra (bộ đếm đúng mà không ai đọc thì vẫn im lặng)", () => {
    const ma = readFileSync(join(GOC, "server", "routes", "observabilityRoutes.ts"), "utf8");
    expect(
      ma.includes("renderSoPhienPrometheus"),
      "`GET /api/observability/metrics` không còn phát bộ đếm sổ phiên ⇒ đường vá 3 của C-2 đã rụng",
    ).toBe(true);
  });

  /* ── §4 NGƯỜI GHI DUY NHẤT — ∀, suy từ ĐĨA + AST ───────────────────────────────────────────── */
  /**
   * Mọi điểm `.insert(userSessions)` trong một nguồn, kèm câu trả lời *"lượt `.values(...)` của nó
   * có đi qua `catTheoTranCot` không"*.
   */
  function diemGhiSoPhien(duong: string, ma: string): { dong: number; catTran: boolean }[] {
    const sf = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
    const ra: { dong: number; catTran: boolean }[] = [];
    const tenGoi = (n: ts.CallExpression): string =>
      ts.isPropertyAccessExpression(n.expression)
        ? n.expression.name.text
        : ts.isIdentifier(n.expression)
          ? n.expression.text
          : "";
    const di = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        tenGoi(n) === "insert" &&
        n.arguments.length === 1 &&
        ts.isIdentifier(n.arguments[0]!) &&
        (n.arguments[0] as ts.Identifier).text === "userSessions"
      ) {
        // `.values(...)` treo ngay trên lượt `.insert(...)`.
        let catTran = false;
        const p = n.parent;
        if (p !== undefined && ts.isPropertyAccessExpression(p) && p.name.text === "values") {
          const goi = p.parent;
          if (goi !== undefined && ts.isCallExpression(goi)) {
            const tim = (x: ts.Node): void => {
              if (catTran) return;
              if (ts.isCallExpression(x) && tenGoi(x) === "catTheoTranCot") {
                catTran = true;
                return;
              }
              x.forEachChild(tim);
            };
            goi.arguments.forEach(tim);
          }
        }
        ra.push({ dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, catTran });
      }
      n.forEachChild(di);
    };
    di(sf);
    return ra;
  }

  const MOI_FILE_SX = moiFileDuoi(GOC, "server", [".ts"]).filter((f) => !laFileTest(f.duong));
  const MOI_DIEM_GHI = MOI_FILE_SX.flatMap((f) => {
    const ma = readFileSync(f.that, "utf8");
    if (!ma.includes("userSessions")) return [];
    return diemGhiSoPhien(f.duong, ma).map((d) => ({ ...d, duong: f.duong }));
  });

  it("§4a cầu chì — bộ suy THẤY người ghi thật (0 điểm ⇒ ô ∀ dưới là chân lý rỗng)", () => {
    expect(MOI_FILE_SX.length, "phạm vi quét đã hỏng").toBeGreaterThanOrEqual(500);
    expect(
      MOI_DIEM_GHI.length,
      "0 điểm `.insert(userSessions)` trong mã sản xuất — bộ suy đang mù với repo",
    ).toBeGreaterThanOrEqual(1);
  });

  it("★★★★ §4b ∀ điểm ghi `user_sessions` trong `server/**`: PHẢI đi qua `catTheoTranCot`", () => {
    expect(
      MOI_DIEM_GHI.filter((d) => !d.catTran).map((d) => `${d.duong}:${d.dong}`),
      [
        "Một lượt ghi `user_sessions` KHÔNG cắt giá trị theo trần cột.",
        "Một chuỗi dài (header `User-Agent` — dữ liệu KẺ TẤN CÔNG) làm lượt INSERT vỡ với `22001`;",
        "`ghiSoPhien` nuốt lỗi ⇒ phiên ấy KHÔNG có hàng sổ ⇒ vô hình với `session.list` và NGOÀI TẦM",
        "`session.revoke` / `revokeAll` / `auth.logout`, sống tới `exp` (đo được: 2027).",
        "⇒ Bọc giá trị bằng `catTheoTranCot(userSessions, …)` (trần SUY TỪ SCHEMA, không viết tay).",
      ].join("\n"),
    ).toEqual([]);
  });

  it("★★★★ §4c M3 — người ghi THỨ HAI trong FILE CHƯA TỒN TẠI vẫn bị bắt", () => {
    const ma = `
      import { userSessions } from "../../drizzle/schema";
      export async function ghiThem(d: any, data: any) {
        return d.insert(userSessions).values(data).returning({ id: userSessions.id });
      }`;
    const diem = diemGhiSoPhien("server/db/nguoiGhiThuHaiN1.ts", ma);
    expect(diem.length, "người ghi mới rơi khỏi lượng từ ⇒ bộ suy mù với file mới").toBe(1);
    expect(diem[0]!.catTran, "người ghi mới KHÔNG cắt trần mà lưới vẫn xanh ⇒ lưới canh theo FILE").toBe(false);

    // …và ĐỐI CHỨNG DƯƠNG: cùng file mới ấy, có cắt ⇒ được tha.
    const maKin = ma.replace(".values(data)", ".values(catTheoTranCot(userSessions, data))");
    expect(diemGhiSoPhien("server/db/nguoiGhiThuHaiN1.ts", maKin)[0]!.catTran).toBe(true);
  });
});
