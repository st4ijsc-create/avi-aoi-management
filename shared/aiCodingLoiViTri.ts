/**
 * ★★★ PARSER THUẦN "lỗi → VỊ TRÍ (tệp/dòng/cột)" cho panel **Problems** của `/ai-coding-workspace`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VIỆC NÀY LÀM GÌ — VÀ CỐ Ý KHÔNG LÀM GÌ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `shared/aiCodingLoop.ts` (`docKetQuaTest`/`ketLuanTest`) chỉ **ĐẾM** số ca đỏ/xanh — nó trả lời
 * *"đã xanh chưa"*. Nó KHÔNG biết lỗi nằm ở **tệp nào, dòng nào**. Panel Problems cần đúng thứ đó:
 * biến khối đầu ra THÔ của lệnh kiểm chứng thành danh sách địa điểm bấm-được. File này là bộ đọc ấy,
 * và nó là bộ đọc DUY NHẤT (không chép logic đếm-ca sang đây — hai bộ đọc trôi khỏi nhau là bài học
 * đã trả giá nhiều lần ở repo này).
 *
 * ⚠⚠ VÌ SAO Ở `shared/` CHỨ KHÔNG `server/`: panel Problems sống ở **CLIENT**, và client KHÔNG
 * import được mã `server/`. Bộ đọc phải THUẦN (0 phụ thuộc ngoài kiểu, không `node:*`, không I/O) để
 * chạy cả trong trình duyệt. Đặt ở `shared/` để `AICodingWorkspace.tsx` nhập thẳng, và để lưới đơn
 * vị chạy trên nó (một khuôn regex nới sai ⇒ ĐỎ tại đây, không phải phát hiện bằng mắt ở runtime).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * PHẠM VI — TRUNG THỰC, CHỈ XỬ KHUÔN SUY RA CHẮC CHẮN (v1)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bốn bộ chạy trong danh sách trắng (`aiCodingVerify.NHAN_KIEM_CHUNG`) in vị trí lỗi theo BA nhóm
 * khuôn khác nhau. Chỉ nhóm nào **suy ra đường tệp CHẮC CHẮN** mới thành mục bấm-được:
 *
 *   1. **tsc** (`npm run check` / `check:tests`) — khuôn NGUYÊN VĂN (đã đo, không `pretty` trong
 *      tsconfig ⇒ tsc khi bị pipe in MỘT DÒNG):
 *          `server/services/vram/_muta_luoiGia.test.ts(13,7): error TS2353: …`
 *          `client/src/pages/SessionManagement.tsx(195,64): error TS2339: Property 'userAgent' …`
 *      (trích THẬT từ `docs/superpowers/reports/2026-08-05-*` và `…/2026-08-02-*` — đầu ra
 *      `npm run check:tests` / `tsc --noEmit`). Đường TƯƠNG ĐỐI gốc repo (tsc chạy từ cwd repo),
 *      dấu `/`. ⇒ `{tep, dong, cot}` ĐẦY ĐỦ.
 *      ⚠⚠ CHỈ khớp `error TS`, **KHÔNG** `warning TS`. Nới regex nuốt luôn `warning` là một đột biến
 *         có thật (lưới `§1` canh đúng chỗ này): một cảnh báo KHÔNG phải một mục lỗi để nhảy tới.
 *
 *   2. **vitest** (`npx vitest run …`) — hai tín hiệu, khuôn NGUYÊN VĂN (trích THẬT từ
 *      `docs/superpowers/reports/2026-08-02-dot2-report.md`):
 *          `FAIL  scripts/ai-bench/bench.production-parity.test.ts > bench.mjs — …`  (tổng kết)
 *          `❯ scripts/ai-bench/bench.production-parity.test.ts:11:21`               (khung stack)
 *      • Dòng `FAIL <đường>` ⇒ `{tep, dong:null}` — biết TỆP hỏng, chưa biết dòng.
 *      • Dòng `❯ <đường>:<dòng>:<cột>` ⇒ `{tep, dong, cot}` — có cả dòng.
 *      Đường TƯƠNG ĐỐI. ⚠ `❯` còn được vitest dùng cho dòng TÊN CA (`❯ nhúng bằng modelId …`) — nên
 *      khuôn khung stack ĐÒI đuôi `:<số>:<số>` và một phần mở rộng tệp, nếu không sẽ đẻ mục rác từ
 *      mọi tên ca.
 *
 *   3. **`dotnet test` / `node --test`** — stack in đường **TUYỆT ĐỐI**:
 *          `… in D:\SOURCES\avi-aoi-management\dotnet\AoiTests\HeadroomTests.cs:line 42`   (.NET)
 *          `at … (D:\proj\test\foo.test.js:10:9)`                                          (node)
 *      **v1 KHÔNG suy ngược ra đường tương đối.** Ghép một đường tuyệt đối của MÁY BUILD vào cây tệp
 *      của workspace là rủi ro mở **NHẦM TỆP** (hoặc tệp ngoài repo). Nên: trả `{tep:null, dong:null,
 *      cot:null, thongDiep}` — một **dòng thông tin KHÔNG bấm được**, người đọc vẫn thấy "có lỗi chỗ
 *      kia" nhưng panel không dựng một liên kết dối. Nâng cấp đường-tuyệt-đối→tương-đối để dành v2.
 *
 * Dòng KHÔNG khớp khuôn nào ⇒ **BỎ QUA** (không đẻ mục rác). Đầu vào rỗng / không phải chuỗi ⇒ `[]`.
 *
 * ⚠ CRLF: đầu ra lệnh trên Windows có `\r\n`. Tách bằng `split(/\r?\n/)` — xử cả hai.
 */

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HỢP ĐỒNG (chốt cứng — Wave sau phụ thuộc, đừng đổi tên / hình dạng)
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface DiaDiemLoi {
  /** Đường tệp (tương đối gốc repo). `null` ⇔ đường tuyệt đối chưa suy ngược được ⇒ KHÔNG bấm được. */
  tep: string | null;
  /** Số dòng (1-based). `null` khi biết tệp mà chưa biết dòng (vd dòng `FAIL <đường>` của vitest). */
  dong: number | null;
  /** Số cột (1-based). `null` như `dong`. */
  cot: number | null;
  /** Câu mô tả lỗi (thô, chưa dịch — component tự dịch/hiển thị sau). Luôn có, kể cả khi `tep` null. */
  thongDiep: string;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// KHUÔN — mỗi bộ chạy một regex RỜI, có docblock VÌ SAO. "Một regex thông minh" cho cả bốn là cách
// chắc chắn để một lần nới cho bộ này âm thầm nới cho bộ kia.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * tsc: `<đường>(<dòng>,<cột>): error TS<số>: <thông điệp>`.
 *   • `[^\s(][^(]*?` — đường: bắt đầu bằng ký tự KHÔNG-trắng-KHÔNG-ngoặc, rồi tham (lười) tới trước `(`
 *     đầu tiên; chặn cả việc nuốt khoảng trắng đầu dòng lẫn nuốt qua dấu `(` của bộ định vị.
 *   • `\((\d+),(\d+)\)` — bộ định vị `(dòng,cột)` trong NGOẶC (khác `:dòng:cột` của stack — không đụng).
 *   • ⚠⚠ `error\s+TS\d+\b` — ĐÒI đúng chữ `error`. Đổi thành `(?:error|warning)` / `\w+` là đột biến
 *     mà lưới `§1 warning` phải bắt: một `warning TS…` KHÔNG được sinh mục lỗi.
 */
const RE_TSC = /^(?<tep>[^\s(][^(]*?)\((?<dong>\d+),(?<cot>\d+)\):\s+(?<msg>error\s+TS\d+\b.*)$/;

/**
 * vitest — KHUNG STACK: `❯ <đường>:<dòng>:<cột>` (thường thụt đầu dòng vài dấu cách).
 *   • `[^\s:?*]+\.[A-Za-z0-9]+` — đường KHÔNG chứa khoảng trắng / `:` / ký tự glob, và có phần mở
 *     rộng tệp. Ràng buộc này loại các dòng TÊN CA cũng bắt đầu bằng `❯` (chúng có khoảng trắng và
 *     không kết bằng `:<số>:<số>`).
 *   • `:(\d+):(\d+)\s*$` — đuôi `:dòng:cột` ở CUỐI dòng ⇒ chắc chắn là một vị trí, không phải văn xuôi.
 *   • Đường tuyệt đối Windows (`D:\…`) KHÔNG khớp (lớp `[^\s:]` chặn dấu `:` của ổ đĩa) ⇒ rơi xuống
 *     bộ nhận-đường-tuyệt-đối bên dưới ⇒ `tep:null`, đúng kỷ luật "không mở nhầm tệp".
 */
const RE_VITEST_STACK = /^\s*❯\s+(?<tep>[^\s:?*]+\.[A-Za-z0-9]+):(?<dong>\d+):(?<cot>\d+)\s*$/;

/**
 * vitest — DÒNG TỔNG KẾT: `FAIL  <đường> > <suite> > <ca>`.
 *   • `FAIL\s+` — ĐÒI khoảng trắng sau `FAIL` để KHÔNG khớp `Failed`/`Failed:` (dòng tổng kết
 *     `dotnet` bắt đầu bằng `Failed`, không phải `FAIL `).
 *   • `\S+\.[A-Za-z0-9]+` — token đường có phần mở rộng; `(?=\s|$)` chốt nó kết thúc ở khoảng trắng
 *     (khoảng trắng trước ` > `) hoặc cuối dòng.
 */
const RE_VITEST_FAIL = /^\s*FAIL\s+(?<tep>\S+\.[A-Za-z0-9]+)(?=\s|$)/;

/**
 * .NET stack: `…:line <số>`. Token `:line <số>` CHỈ xuất hiện ở khung stack `dotnet` ⇒ tín hiệu
 * đường-tuyệt-đối rất sạch, không cần biết đường viết kiểu gì.
 */
const RE_DOTNET_LINE = /:line\s+\d+\b/;

/**
 * Đường TUYỆT ĐỐI Windows + bộ định vị dòng: `D:\…\x.test.js:10` (đuôi `:<cột>` có/không đều được).
 *   • `(?<![A-Za-z])[A-Za-z]:[\\/]` — ổ đĩa `X:\` / `X:/` mà TRƯỚC nó KHÔNG phải một chữ cái — để
 *     `http:/` (chữ `p` sau `t`) KHÔNG bị nhận nhầm là ổ đĩa; còn `(D:\`, ` D:\`, `file:///D:/` thì
 *     ký tự trước ổ đĩa là `(` / khoảng trắng / `/` nên vẫn nhận đúng.
 *   • `[^\s:]*\.[A-Za-z0-9]+:\d+` — thân đường (không trắng, không `:`) tới `.<ext>` rồi `:<dòng>`.
 * ⇒ Dùng để nhận biết (KHÔNG để trích đường) — v1 trả `tep:null`.
 */
const RE_WIN_ABS_LOC = /(?<![A-Za-z])[A-Za-z]:[\\/][^\s:]*\.[A-Za-z0-9]+:\d+/;

/** Một dòng có phải tham chiếu vị trí bằng đường TUYỆT ĐỐI (.NET/Node) không. */
function laDinhViTuyetDoi(dong: string): boolean {
  return RE_DOTNET_LINE.test(dong) || RE_WIN_ABS_LOC.test(dong);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BỘ ĐỌC
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Đọc đầu ra THÔ của một lệnh kiểm chứng, trả danh sách địa điểm lỗi theo THỨ TỰ xuất hiện.
 * THUẦN, tất định, 0 phụ thuộc ngoài. KHÔNG khử trùng lặp ở v1 (một block vitest có thể cho cả một
 * mục `FAIL` không-dòng lẫn một mục khung stack có-dòng cho cùng tệp — đó là HAI tín hiệu thật;
 * component hiển thị tự gộp nếu muốn).
 */
export function phanTichLoiViTri(dauRa: string): DiaDiemLoi[] {
  if (typeof dauRa !== "string" || dauRa.length === 0) return [];

  const ket: DiaDiemLoi[] = [];
  for (const raw of dauRa.split(/\r?\n/)) {
    // 1) tsc — vị trí ĐẦY ĐỦ, đường tương đối.
    const t = RE_TSC.exec(raw);
    if (t?.groups) {
      ket.push({
        tep: t.groups.tep.trim(),
        dong: Number(t.groups.dong),
        cot: Number(t.groups.cot),
        thongDiep: t.groups.msg.trim(),
      });
      continue;
    }

    // 2) vitest — khung stack `❯ path:dòng:cột`.
    const vs = RE_VITEST_STACK.exec(raw);
    if (vs?.groups) {
      ket.push({
        tep: vs.groups.tep,
        dong: Number(vs.groups.dong),
        cot: Number(vs.groups.cot),
        thongDiep: raw.trim(),
      });
      continue;
    }

    // 3) vitest — dòng tổng kết `FAIL path` (biết tệp, CHƯA biết dòng).
    const vf = RE_VITEST_FAIL.exec(raw);
    if (vf?.groups) {
      ket.push({ tep: vf.groups.tep, dong: null, cot: null, thongDiep: raw.trim() });
      continue;
    }

    // 4) dotnet / node — đường TUYỆT ĐỐI ⇒ dòng thông tin, KHÔNG bấm được (v1 không mở nhầm tệp).
    if (laDinhViTuyetDoi(raw)) {
      ket.push({ tep: null, dong: null, cot: null, thongDiep: raw.trim() });
      continue;
    }

    // 5) không khớp khuôn nào ⇒ bỏ qua, không đẻ mục rác.
  }

  return ket;
}
