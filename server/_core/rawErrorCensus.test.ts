/**
 * F3 — ĐIỀU TRA DÂN SỐ `throw new Error(...)` NGOÀI `server/routers/**`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO MÓN NỢ NÀY PHÌNH TỚI BỐN CHỮ SỐ MÀ KHÔNG AI THẤY
 * ══════════════════════════════════════════════════════════════════════════════════
 * `appErrorCoverage.test.ts` có hai ngân sách rất tốt — nhưng cả hai chỉ quét
 * `server/routers/**`. Mọi thứ ở `server/db/**`, `server/services/**`,
 * `server/_core/**` nằm NGOÀI tầm nhìn của chúng.
 *
 * Đo ngày 2026-08-21: **1035 chỗ** `throw new Error(` ngoài routers
 * (`server/services` 629 · `server/db` 355 · `server/_core` 31), trong đó **~400 chỗ**
 * là CÙNG MỘT khái niệm "DB không sẵn sàng".
 *
 * ── VÌ SAO CHÚNG TỚI ĐƯỢC NGƯỜI DÙNG ─────────────────────────────────────────────
 * tRPC v11: `message = opts.message ?? cause?.message ?? code`. `errorFormatter` chỉ
 * gắn `appCode` cho lỗi dựng bằng `appError()`. Lỗi thô vì thế rơi tới nhánh CUỐI của
 * `mapTrpcError` phía client — nơi nó **`return message`** nguyên văn. Người dùng
 * vi/en/zh đều đọc đúng chuỗi tiếng Anh đó.
 *
 * ── VÌ SAO MỤC F3 TRONG BACKLOG NÓI SAI CHỖ ──────────────────────────────────────
 * F3 khai *"64 chỗ / 13 file, nặng nhất `machineAuthService` 17 · `_core/trpc` 12"*.
 * Đo lại 2026-08-21: cả hai file đó **0 chỗ ném thô** — chúng đã dùng `appError` (17
 * và 14 lời gọi, khớp đúng con số F3 nói là "chưa di trú"). Nợ THẬT nằm ở
 * `server/db/**` + `server/services/**`, và lớn gấp 16 lần.
 * ⇒ Bài học lặp lại: **con số trong tài liệu là lời khai, không phải phép đo.**
 *
 * ⚠ KHÔNG BAO GIỜ nâng ngân sách để test xanh. Nâng nó nghĩa là vừa thêm một câu
 *   tiếng Anh mà người dùng Việt/Trung sẽ đọc nguyên văn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỌC TRƯỚC KHI ĐỊNH "TRẢ NỐT" 502 CHỖ CÒN LẠI — ĐO NGÀY 2026-08-22
 * ══════════════════════════════════════════════════════════════════════════════════
 * Con số 502 dễ đọc thành "còn 502 việc phải làm". KHÔNG PHẢI. Phép đo:
 *
 *   • **299 CÂU KHÁC NHAU** trên 502 chỗ, và **266 câu (89%) chỉ xuất hiện ĐÚNG MỘT LẦN.**
 *     Họ đồng nhất DUY NHẤT — "driver không kết nối", 45 chỗ — đã đóng ở Pha 1 (`592d26ef`).
 *     Sau nó **không còn họ nào nữa**.
 *   • Trong 339 chỗ có chuỗi hằng đọc được: chỉ **80 chỗ** khớp một mã CHUNG đã có
 *     (`INVALID_VALUE` 39 · `FIELD_REQUIRED` 23 · `ENTITY_NOT_FOUND` 12 · `FEATURE_DISABLED` 6);
 *     **259 chỗ không mã nào hợp.** ~163 chỗ còn lại dùng template/biến.
 *   • 12 chỗ "not found" hoá ra là lỗi **HỆ THỐNG TỆP** (`GGUF model file not found: <path>`,
 *     `Backup file not found: <path>`…) — ánh xạ sang `ENTITY_NOT_FOUND` sẽ NUỐT MẤT đường
 *     dẫn, thứ mang toàn bộ giá trị chẩn đoán. Đúng kết luận lô 4 đã rút trước đây.
 *
 * ⇒ **Đẻ 259 mã dùng-một-lần là tệ hơn để nguyên.** Một registry mã lỗi mà mỗi mã chỉ dùng
 *   một chỗ thì không còn là registry — nó là bản dịch tiếng Việt của chính chuỗi tiếng
 *   Anh, đội thêm chi phí bảo trì ba locale, mà không thêm được một chút khả năng máy-đọc
 *   nào. Mã lỗi có giá trị vì nó GOM các chỗ cùng nghĩa lại; không gom được thì không có giá trị.
 *
 * ── LUẬT CHO MỌI ĐỢT SAU: chỉ di trú khi ĐỦ CẢ HAI ──────────────────────────────
 *   (a) chỗ đó THẬT SỰ tới được người dùng cuối (không phải kỹ sư/máy/LLM — xem kết luận
 *       F14 ở `dataErrorStringCensus.test.ts`: trong 164 chỗ trông y hệt nhau chỉ 13 là nợ);
 *   (b) có một mã CHUNG ĐÃ CÓ diễn đạt đúng nghĩa, và di trú KHÔNG làm mất thông tin
 *       (đường dẫn, mã lỗi socket, số hiệu bước…) mà chuỗi gốc đang mang.
 * Thiếu một trong hai ⇒ giữ nguyên. Ngân sách đứng yên KHÔNG phải là thất bại; nó là
 * kết quả đúng khi phần còn lại không phải nợ.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Ngân sách CHỈ ĐƯỢC GIẢM.
 * 1035 → 711 (lô 1): 324 chỗ họ "DB không sẵn sàng" trong `server/db/**`.
 * 711 →  629 (lô 2): 82 chỗ còn lại ở `server/services/**` + `server/_core/**` + `templateDb`.
 * 629 →  601 (lô 3): 28 chỗ họ "X not found" mà thực thể ĐÃ CÓ trong từ điển
 *   `errors.entity.*` (137 khoá, đủ vi/en/zh) → `appError("NOT_FOUND", "ENTITY_NOT_FOUND",
 *   { entity })`. 64 chỗ "not found" còn lại cần ĐẶT TÊN thực thể mới — làm riêng,
 *   để không vừa di trú vừa bịa từ vựng.
 * 601 →  547 (lô 4): 54 chỗ "not found" còn lại, ánh xạ theo (FILE, CÂU) đích danh +
 *   12 khoá thực thể MỚI (đủ vi/en/zh). 10 chỗ giữ nguyên vì là lỗi HỆ THỐNG TỆP.
 * Cả hai lô đổi sang `DbUnavailableError` — lớp tự mang `appCode: "DB_UNAVAILABLE"`
 * (mã đã có sẵn, đã đủ ba bản dịch), nên client dịch được mà formatter không đổi dòng nào.
 *
 * 498 →  476 (2026-09-21): **KHÔNG ai di trú thêm chỗ nào** — phép đếm được **thu hẹp** cho
 *   đúng tiền đề của chính nó: *lỗi ném thô hiện nguyên văn cho người dùng qua tRPC*, mà
 *   điều đó chỉ đúng với module **mã sản phẩm dẫn tới được**. Xem `chiTestDungToi`.
 *
 *   Trước lúc thu hẹp số thật là **503 > 498** ⇒ cổng ĐỎ. Truy ra: **toàn bộ** phần vượt nằm
 *   trong hai trợ giúp **chỉ-test** của `server/contracts/**` (`capChuoiVarcharScan` 5,
 *   `hinhDangHopDongMetaJson` 2) — bảy chỗ ném ấy là **bất biến nội bộ của bộ duyệt zod**
 *   (*"gặp kiểu CHƯA HỖ TRỢ … BÁO ĐỘNG thay vì im lặng trả []"*), không thể tới tRPC.
 *   Cổng đang kêu về thứ nó sinh ra để **không** canh.
 *
 *   Bộ lọc loại **27** chỗ ở **9** module không tệp sản phẩm nào import:
 *     5 contracts/capChuoiVarcharScan · 2 contracts/hinhDangHopDongMetaJson
 *     7 services/vision/validationHarness · 3 _core/dataApi · 3 _core/imageGeneration
 *     2 _core/map · 2 services/aiAnomalyCalibration · 2 services/energy/energyMeterTemplate
 *     1 services/instruments/zplPrinterAdapter
 *   Hai nhóm: trợ giúp chỉ-test, và module **không ai import** (mã chết). Cả hai đều không
 *   đặt được một câu chữ trước mặt người dùng.
 *
 *   ⚠ Đây là **thu hẹp phép đo rồi SIẾT ngân sách xuống đúng số thật mới (476)** — không phải
 *     nới trần. Ngày nào một tệp sản phẩm import lại một trong chín module ấy, số đếm tăng
 *     lại và cổng ĐỎ — đúng như nó phải thế.
 */
const ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS = 476;

/**
 * Họ "DB không sẵn sàng": `407 → 83 → 1 → **0**` — nay là BẤT BIẾN, không phải ngân sách.
 *
 * Chỗ cuối cùng (`configDriftService.ts:297`,
 * `Adapter ${adapterId} not found (or database unavailable)`) từng được ghi là ngoại lệ
 * cố ý. Lô 3 xử nó theo hướng ĐÚNG HƠN: nó vốn là lỗi *"không tìm thấy adapter"* — chỉ
 * NHẮC khả năng DB sập như lý do phụ — nên nay là
 * `appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" })`.
 * ⇒ Ngoại lệ biến mất vì nguyên nhân được gọi đúng tên, không phải vì ai đó nới trần.
 */
const ALLOWED_DB_UNAVAILABLE_RAW = 0;

const HO_DB = /Database not (available|connected|initialized)|DB not available|database unavailable|DB unavailable|db unavailable/i;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "routers") continue; // đã có cổng riêng ở appErrorCoverage.test.ts
      out.push(...walkTs(full));
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CHỈ ĐẾM THỨ TỚI ĐƯỢC NGƯỜI DÙNG — 2026-09-21
 * ════════════════════════════════════════════════════════════════════════════
 * Tiền đề của cả phép điều tra này (xem docblock đầu tệp) là: lỗi ném thô **rơi tới nhánh
 * cuối của `mapTrpcError` và hiện nguyên văn cho người dùng**. Tiền đề ấy chỉ đúng với mã
 * **tới được từ đường sản phẩm**.
 *
 * Bộ quét đã loại `*.test.ts`, nhưng **chưa loại tệp trợ giúp chỉ-test**. Đo 2026-09-21:
 *   · `server/contracts/capChuoiVarcharScan.ts`      — **5** chỗ ném, import bởi **7 tệp, TOÀN test**
 *   · `server/contracts/hinhDangHopDongMetaJson.ts`  — **2** chỗ ném, import bởi **3 tệp, TOÀN test**
 * Bảy chỗ ném ấy là **bất biến nội bộ của bộ duyệt zod** (*"gặp kiểu CHƯA HỖ TRỢ … BÁO ĐỘNG
 * thay vì im lặng trả []"*). Chúng không thể tới tRPC, nên đếm chúng là đếm sai thứ.
 *
 * ⚠ Và cùng thư mục ấy có **ba** tệp THẬT SỰ của sản phẩm (`machineDataContract`,
 *   `machineDataContractV2`, `machineTemplateContract`) — cả ba **0 chỗ ném**. Nên loại cả
 *   thư mục là quá tay. Dự án đã chốt nguyên tắc: **canh BẤT BIẾN, không canh DANH SÁCH**
 *   (miễn trừ/allowlist là lối thoát quá dễ).
 *
 * ⇒ Bất biến: **một tệp chỉ được đếm nếu có ít nhất một tệp KHÔNG-PHẢI-TEST dẫn tới nó.**
 *   Tệp không ai import = điểm vào (vd `index.ts`) ⇒ vẫn đếm. Tính tới điểm bất động, nên
 *   một trợ giúp chỉ-test import một trợ giúp khác thì cả hai đều bị loại.
 *
 * ⚠ Đây là **thu hẹp phép đo, không phải nới ngân sách**: sau khi thu hẹp, ngân sách được
 *   siết xuống đúng số thật mới (ca "bám SÁT số thật" cưỡng chế điều đó). Ngân sách vẫn
 *   **chỉ đi xuống**.
 */
function chiTestDungToi(): Set<string> {
  /*
   * ⚠⚠ BẢN ĐẦU CỦA HÀM NÀY SAI, VÀ CA KIỂM TRUNG THỰC NGAY DƯỚI ĐÃ BẮT ĐƯỢC.
   *   Nó tự giải `from "./x"` rồi suy "ai import ai". Nhưng dự án dùng **alias**
   *   (`@/…`, `@shared/…`) và import theo thư mục, nên vô số cạnh bị bỏ sót ⇒ **39 tệp**
   *   bị coi là chỉ-test **trong khi mã sản phẩm có import chúng**, và số đếm tụt từ 503
   *   xuống 472 — tức bộ lọc đang **giấu 24 chỗ ném thật**.
   *   ⇒ Giữ lại bài học: **một bộ lọc chưa có ca canh là một lối thoát.**
   *
   * Bản này đi hướng **THẬN TRỌNG**: không cố giải module, chỉ hỏi một câu dễ trả lời đúng —
   * *"có tệp KHÔNG-PHẢI-TEST nào nhắc tên module này trong một câu import không?"*. Sai sót
   * nếu có chỉ đẩy về phía **đếm THỪA** (an toàn), không bao giờ về phía bỏ lọt.
   */
  const laTest = (f: string) => /\.test\.ts$/.test(f);

  /** Mọi tệp `.ts`/`.tsx` KHÔNG-PHẢI-TEST của repo — nguồn duy nhất của "đường sản phẩm". */
  const sanPham: string[] = [];
  for (const goc of [SERVER, resolve(SERVER, "..", "client", "src"), resolve(SERVER, "..", "shared")]) {
    (function di(dir: string) {
      let ds: string[];
      try {
        ds = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of ds) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) di(full);
        else if (/\.tsx?$/.test(name) && !laTest(full)) sanPham.push(full);
      }
    })(goc);
  }

  /** Tên module xuất hiện trong MỘT CÂU IMPORT của bất kỳ tệp sản phẩm nào. */
  const tenDuocImport = new Set<string>();
  for (const f of sanPham) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const ten = m[1].replace(/\\/g, "/").split("/").pop();
      if (ten) tenDuocImport.add(ten.replace(/\.(ts|tsx|js)$/, ""));
    }
  }

  const chiTest = new Set<string>();
  for (const f of walkTs(SERVER)) {
    const ten = f.replace(/\\/g, "/").split("/").pop()!.replace(/\.ts$/, "");
    // Tệp mà KHÔNG tệp sản phẩm nào nhắc tên trong import ⇒ chỉ có test dùng tới.
    // (Tệp tự nhắc tên mình không tính: vòng lặp trên đọc câu import, không đọc tên tệp.)
    if (!tenDuocImport.has(ten)) chiTest.add(f);
  }
  return chiTest;
}

function dem(): { total: number; hoDb: number; byFile: Array<[string, number]> } {
  const boQua = chiTestDungToi();
  const byFile: Array<[string, number]> = [];
  let total = 0;
  let hoDb = 0;
  for (const file of walkTs(SERVER)) {
    if (boQua.has(file)) continue; // chỉ-test ⇒ không tới được người dùng, xem `chiTestDungToi`
    const src = readFileSync(file, "utf8");
    const hits = src.match(/throw new Error\(/g) ?? [];
    if (!hits.length) continue;
    for (const m of src.matchAll(/throw new Error\((["'`])([^"'`]*)\1\)/g)) {
      if (HO_DB.test(m[2])) hoDb++;
    }
    byFile.push([file.replace(SERVER, ""), hits.length]);
    total += hits.length;
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, hoDb, byFile };
}

describe("F3 — `throw new Error(...)` ngoài server/routers (cổng cũ mù với vùng này)", () => {
  it("cầu chì: phép quét phải THẤY file, không thì nó đang canh tập rỗng", () => {
    expect(walkTs(SERVER).length).toBeGreaterThan(100);
  });

  it(`còn tối đa ${ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS} chỗ ném thô`, () => {
    const { total, byFile } = dem();
    if (total > ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS) {
      console.error("[F3] nợ ném-thô phình ở:", byFile.slice(0, 12));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS);
  });

  it("ngân sách phải bám SÁT số thật — số dư che mất nợ mới", () => {
    expect(ALLOWED_RAW_THROWS_OUTSIDE_ROUTERS).toBe(dem().total);
  });

  it("★★★ bộ lọc chỉ-test phải TRUNG THỰC: mọi tệp bị loại đều KHÔNG được mã sản phẩm import", () => {
    /*
     * Một bộ lọc là một lối thoát nếu không ai canh nó — và bản ĐẦU của `chiTestDungToi`
     * đã loại oan **39 tệp**, giấu mất 24 chỗ ném thật. Chính ca này bắt được.
     * Nó tính lại bất biến **trực tiếp từ nguồn**, không đi qua hàm đang được canh.
     */
    const boQua = [...chiTestDungToi()];
    expect(boQua.length, "bộ lọc không loại gì ⇒ nó đang canh tập rỗng").toBeGreaterThan(0);
    const sai: string[] = [];
    for (const f of boQua) {
      const ten = f.replace(/\\/g, "/").split("/").pop()!.replace(/\.ts$/, "");
      for (const g of walkTs(SERVER)) {
        if (g === f || /\.test\.ts$/.test(g)) continue;
        if (new RegExp(`from ["'][^"']*\\b${ten}["']`).test(readFileSync(g, "utf8"))) {
          sai.push(`${f.replace(SERVER, "")} ← ${g.replace(SERVER, "")}`);
        }
      }
    }
    expect(sai).toEqual([]);
  });

  it("★★★ bộ lọc KHÔNG được nuốt mã sản phẩm — ba hợp đồng máy vẫn được đếm", () => {
    // Đối chứng dương: `server/contracts/**` LẪN LỘN test-only và sản phẩm. Nếu bộ lọc loại
    // cả thư mục (quá tay) thì ca này đỏ.
    const boQua = [...chiTestDungToi()].map((f) => f.replace(/\\/g, "/"));
    for (const ten of ["machineDataContract", "machineDataContractV2", "machineTemplateContract"]) {
      expect(boQua.some((f) => f.endsWith(`/contracts/${ten}.ts`)), `${ten} bị loại oan`).toBe(false);
    }
  });

  it(`họ "DB không sẵn sàng" còn tối đa ${ALLOWED_DB_UNAVAILABLE_RAW} chỗ ném THÔ`, () => {
    // Tách riêng để hai con số không bù trừ: ai đó di trú bớt chỗ khác rồi thêm một
    // "Database not available" mới thì tổng vẫn đạt, nhưng ca này ĐỎ.
    const { hoDb } = dem();
    expect(hoDb).toBeLessThanOrEqual(ALLOWED_DB_UNAVAILABLE_RAW);
  });

  it("★★★ `server/db/**` KHÔNG còn chỗ nào ném thô họ 'DB không sẵn sàng'", () => {
    // Vùng đã di trú xong — bất biến, không phải ngân sách. Thêm một chỗ ở đây là
    // quay lại đúng lớp lỗi vừa đóng.
    const con: string[] = [];
    for (const file of walkTs(join(SERVER, "db"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/throw new Error\((["'`])([^"'`]*)\1\)/g)) {
        if (HO_DB.test(m[2])) con.push(`${file.replace(SERVER, "")}: ${m[2]}`);
      }
    }
    expect(con).toEqual([]);
  });

  it("★★★ TOÀN BỘ server ngoài routers: 0 chỗ ném thô họ 'DB không sẵn sàng'", () => {
    // Bất biến, không phải ngân sách. Ca này in ĐÍCH DANH file+câu khi đỏ — một con số
    // trần không nói chỗ nào thì người sửa phải đi mò, và cổng khó chịu là cổng bị tắt.
    const con: string[] = [];
    for (const file of walkTs(SERVER)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/throw new Error\((["'`])([^"'`]*)\1\)/g)) {
        if (HO_DB.test(m[2])) con.push(`${file.replace(SERVER, "").split("\\").join("/")}: ${m[2]}`);
      }
    }
    expect(con).toEqual([]);
  });

  it("★★★ KHÔNG CÒN HỌ ĐỒNG NHẤT nào để di trú — kết luận này TỰ ĐO LẠI mỗi lần chạy", () => {
    // ⚠ Ca này không canh một món nợ. Nó canh một KẾT LUẬN, và canh bằng cách tính lại
    // thay vì tin vào chữ trong docblock — chính thứ đợt 21–22/08 đã bác bỏ 22 lần ở
    // backlog. Nếu một ngày nào đó có họ đồng nhất mới xuất hiện (ai đó chép-dán một câu
    // lỗi ra 20 chỗ), ca này ĐỎ và nói đích danh câu đó — tức nó vừa bảo vệ kết luận
    // "không còn gì để di trú", vừa tự huỷ kết luận ấy đúng lúc nó hết đúng.
    const cau = new Map<string, number>();
    for (const file of walkTs(SERVER)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/throw new Error\((["'`])([^"'`]*)\1\)/g)) {
        // Chuẩn hoá: nội suy `${…}` và số → dấu chỗ, để hai câu cùng KHUÔN gom về một.
        const k = m[2].replace(/\$\{[^}]*\}/g, "<X>").replace(/[0-9]+/g, "N").trim();
        if (k) cau.set(k, (cau.get(k) ?? 0) + 1);
      }
    }
    const ho = [...cau.entries()].filter(([, n]) => n >= 8).sort((a, b) => b[1] - a[1]);
    if (ho.length) {
      console.error("[F3] HỌ ĐỒNG NHẤT MỚI — đáng một đợt di trú, xem lại kết luận:", ho);
    }
    // Ngưỡng 8: dưới mức đó thì gom lại không đủ trả chi phí một mã lỗi mới + 3 bản dịch.
    // Họ "driver không kết nối" (45 chỗ) đã đóng ở Pha 1; nay câu lặp nhiều nhất chỉ 4 lần.
    expect(ho).toEqual([]);

    // Cầu chì: phải THẤY nhiều câu khác nhau, không thì phép quét đang rỗng và khẳng
    // định trên đúng một cách vô nghĩa.
    expect(cau.size).toBeGreaterThan(200);
  });
});
