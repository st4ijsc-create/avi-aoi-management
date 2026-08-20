/**
 * ★★★ 2026-08-18 (nhóm B #2) — **LƯỚI VỊ TỪ CHO CỔNG THỨ TÁM: MỌI MÃ `note` PHẢI ĐƯỢC PHÂN LOẠI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO — VÀ VÌ SAO NÓ KHÔNG PHẢI "MỘT MÃ BỊ QUÊN"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cổng thứ tám (`aiLocalKnowledgeService.toolKhongCoGiDeNoi`) chặn LLM diễn giải một kết quả rỗng.
 * Bản đầu của nó **LIỆT KÊ BỐN MÃ CHẶN** — `NOT_FOUND`, `QUERY_ERROR`, `DB_UNAVAILABLE`,
 * `PERMISSION_DENIED` — với chú thích tự khai là "đếm trong `aiLocalTools/**`". Phép đếm ấy là
 * **đếm TAY**, và đếm tay mù đúng thứ nó không nghĩ tới:
 *
 *   • `analyticsTools.ts:504`  `note: "SCOPE_EMPTY"`             — phạm vi RỖNG, 0 hàng dữ liệu
 *   • `handlers.ts:303`        `note: "NOT_FOUND_WITH_SUGGESTIONS"` — **`data: null`**, câu mở đầu
 *     đúng chữ *"Không tìm thấy lệnh sản xuất …"*. Nó LÀ `NOT_FOUND`, chỉ khác cái tên.
 *   • và 15 mã nữa (xem `CENSUS` bên dưới): `PROG_KB_DISABLED`, `PATH_REJECTED`, `READ_ERROR`, …
 *
 * ⇒ Cả 17 mã đều KHÔNG nằm trong tập bốn ⇒ cổng **không khoá** ⇒ model nhận một kết quả rỗng kèm
 * chỉ dẫn *"ƯU TIÊN dùng dữ liệu thời gian thực"* và diễn giải bừa. Chữa `SCOPE_EMPTY` bằng cách
 * thêm tên thứ năm vào danh sách là chữa **một** trong 17, và mã thứ 18 (ngày mai) lại lọt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ THẾ VỊ TỪ ĐÃ **ĐẢO CHIỀU**, VÀ FILE NÀY LÀ THỨ LÀM CHO PHÉP ĐẢO ẤY KHÔNG TRÔI.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Luật mới, phát biểu trên **NGHĨA của ô `note`** thay vì trên một tập giá trị chép tay:
 *
 *     `ToolResult.note` chỉ được đặt khi kết quả **KHÔNG phát biểu đủ** về nhà xưởng
 *     (rỗng / lỗi / bị từ chối / suy giảm). ⇒ **CÓ `note` ⇒ CHẶN.**
 *     Ngoại lệ phải được KHAI TÊN ở `TOOL_NOTE_VAN_DIEN_GIAI` kèm lý do.
 *
 * Điều đó dời chiều hỏng từ **fail-open** (mã lạ ⇒ LLM bịa, hỏng VÔ HÌNH và không có trần) sang
 * **fail-closed** (mã lạ ⇒ trả nguyên văn `textSummary` của tool, hỏng HỮU HÌNH và có trần: mất
 * phần văn vẻ, KHÔNG mất sự thật). Đây là phép đánh đổi BẤT ĐỐI XỨNG, và repo đã chọn đúng chiều
 * ấy ở chỗ khác rồi: đường `clarifyMessage` (`aiLocalKnowledgeService` ~2311) trả thẳng câu hỏi
 * lại cho người dùng **không qua LLM**.
 *
 * ⚠ Luật trên là một LỜI KHAI về toàn bộ cây `aiLocalTools/**`. File này **ĐO** lời khai đó:
 *   §1 — mọi mã `note` VIẾT THẲNG trong mã nguồn phải có tên trong `CENSUS` (mã MỚI ⇒ **ĐỎ**);
 *   §2 — `CENSUS` không được chứa mã đã biến mất khỏi mã nguồn (chống bảng kê MỤC RỖNG);
 *   §3 — nhánh `dien-giai` của `CENSUS` phải TRÙNG KHÍT `TOOL_NOTE_VAN_DIEN_GIAI` lúc chạy
 *        (đột biến "khai một đằng, cưỡng chế một nẻo" ⇒ ĐỎ);
 *   §4 — vị từ THẬT phải chặn mọi mã `chan` và tha mọi mã `dien-giai` (đo bằng chính hàm đó,
 *        không tin bảng kê);
 *   §5 — `note` KHÔNG PHẢI hằng chữ (`note: msg`, `note: check.detail`, `note: result.reason`)
 *        vẫn phải bị CHẶN — đây là ca mà một lưới quét-mã-nguồn KHÔNG BAO GIỜ liệt kê được, nên
 *        nó phải được bảo đảm bởi CHIỀU MẶC ĐỊNH của vị từ, và §5 đo đúng chiều mặc định ấy.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { toolKhongCoGiDeNoi, TOOL_NOTE_VAN_DIEN_GIAI } from "../aiLocalKnowledgeService";

const GOC = join(__dirname);

/** Mọi `.ts` SẢN PHẨM dưới `aiLocalTools/**` (bỏ `*.test.ts` — lưới không phải nguồn phát `note`). */
function nguonSanPham(dir: string): string[] {
  const ra: string[] = [];
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) {
      ra.push(...nguonSanPham(p));
      continue;
    }
    if (ten.endsWith(".ts") && !ten.endsWith(".test.ts")) ra.push(p);
  }
  return ra;
}

/**
 * Trích mã `note` VIẾT THẲNG. Bắt được cả ba hình dạng có thật trong cây:
 *   `note: "X"` · `note: cond ? "A" : "B"` · `note: … ?? "C"` · `(…, note: "A" | "B")` (kiểu hợp).
 *
 * ⚠ Chỉ nhận hằng **bắt đầu bằng CHỮ HOA** — đó là quy ước của mọi mã `ToolResult.note` trong cây
 * (`SCREAMING_SNAKE`, hoặc một câu như `"Threshold not found"`). Nó loại đúng thứ cần loại:
 * `vramTools.ts:511` có `note: h.ttlExpired ? cum(lang, "ttlExpiredNote", {}) : ""` — nhưng ô
 * `note` ĐÓ là một ô con của bảng câu chữ VRAM, **không phải** `ToolResult.note`. Loại theo hình
 * dạng tên là một luật ĐỌC ĐƯỢC; loại theo tên file là một danh sách miễn trừ sẽ trôi.
 */
function macTrongNguon(): Map<string, string[]> {
  const ra = new Map<string, string[]>();
  for (const f of nguonSanPham(GOC)) {
    const src = readFileSync(f, "utf8");
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      const at = line.indexOf("note:");
      if (at < 0) return;
      const duoi = line.slice(at + "note:".length);
      for (const m of duoi.matchAll(/["']([A-Z][A-Za-z0-9_ ]*)["']/g)) {
        const ma = m[1]!;
        const noi = `${relative(GOC, f).replace(/\\/g, "/")}:${i + 1}`;
        ra.set(ma, [...(ra.get(ma) ?? []), noi]);
      }
    });
  }
  return ra;
}

type XepLoai = "chan" | "dien-giai";

/**
 * ★★★ BẢNG KÊ — MỌI mã `note` có thật trong `aiLocalTools/**`, mỗi mã một PHÁN QUYẾT.
 *
 * `chan`      = kết quả KHÔNG phát biểu đủ về nhà xưởng ⇒ trả nguyên văn `textSummary`, không LLM.
 * `dien-giai` = kết quả VẪN mang thông tin đáng diễn giải ⇒ phải có tên trong
 *               `TOOL_NOTE_VAN_DIEN_GIAI` lúc chạy, và phải ghi LÝ DO ngay tại đây.
 *
 * ⚠⚠ HÔM NAY NHÁNH `dien-giai` **RỖNG**, và đó là một PHÉP ĐO chứ không phải một chỗ chưa làm:
 * 22/22 mã dưới đây đều được đặt trên đường RỖNG / LỖI / TỪ CHỐI / SUY GIẢM — không một mã nào
 * nằm trên đường "có dữ liệu thật". Ca chống-vá-quá-tay của cổng thứ tám vì thế neo vào
 * `note === undefined` (kết quả bình thường), xem `aiLocalKnowledge.emptyToolGate.test.ts` §B.
 *
 * ⚠ `MISSING_ARGS` / `MISSING_REQUIRED_ARG` là ca gần biên nhất — tool CHƯA HỀ truy vấn, nên nghe
 * như "để LLM hỏi lại cho tử tế". Xếp `chan` vì hai lẽ ĐO ĐƯỢC: (1) tool chưa nhìn hiện trường
 * thì lại càng không có gì để nói về hiện trường, mà prompt thì vẫn kèm KB + chỉ dẫn *"ƯU TIÊN
 * dữ liệu thời gian thực"*; (2) repo ĐÃ chọn đúng cách xử này ở `clarifyMessage` — trả thẳng câu
 * hỏi lại, không qua LLM. Đổi ý thì đổi cả hai chỗ, không đổi riêng chỗ này.
 */
const CENSUS: Record<string, XepLoai> = {
  // ── bốn mã của bản đầu ────────────────────────────────────────────────────────────────────
  NOT_FOUND: "chan",
  QUERY_ERROR: "chan",
  DB_UNAVAILABLE: "chan",
  PERMISSION_DENIED: "chan",
  // ── mười bảy mã LỌT KHỎI phép đếm tay ─────────────────────────────────────────────────────
  /** `analyticsTools.ts` — người gọi chưa được gán nhà máy nào; `hotspots: []`, `totalNG: 0`. */
  SCOPE_EMPTY: "chan",
  /** `handlers.ts` — `data: null`, câu bắt đầu bằng "Không tìm thấy lệnh sản xuất". LÀ NOT_FOUND. */
  NOT_FOUND_WITH_SUGGESTIONS: "chan",
  MISSING_ARGS: "chan",
  MISSING_REQUIRED_ARG: "chan",
  /** Cờ `PROG_KB_ENABLED` tắt ⇒ kho tri thức lập trình không trả một dòng nào. */
  PROG_KB_DISABLED: "chan",
  SIMULATE_UNSUPPORTED: "chan",
  GENERATE_UNAVAILABLE: "chan",
  GENERATE_FAILED: "chan",
  GENERATE_ERROR: "chan",
  /** Sinh mã bị logic AN TOÀN từ chối — câu từ chối phải đi ra NGUYÊN VĂN, không qua văn vẻ. */
  REFUSED: "chan",
  INVALID_EXPRESSION: "chan",
  NOT_A_FILE: "chan",
  PATH_REJECTED: "chan",
  READ_ERROR: "chan",
  WRITE_ERROR: "chan",
  /** `qualityAdvisory.ts` — RCA không tạo được bản ghi nào (`rcaId == null`). */
  RCA_DEGRADED: "chan",
  NO_REQUESTS_CREATED: "chan",
  /** `writeHandlers/yield.ts` — hằng chữ THƯỜNG, không phải SCREAMING_SNAKE. Vẫn là 0 dữ liệu. */
  "Threshold not found": "chan",
  // ── doc 78 PHA A (2026-08-18) — HỘP CÁT REPO (`repoReadTools.ts`) ──────────────────────────
  /**
   * ⚠⚠ CẢ TÁM MÃ DƯỚI ĐÂY LÀ `chan`, VÀ ĐÓ LÀ MỘT PHÉP ĐO, KHÔNG PHẢI MỘT PHẢN XẠ.
   *
   * Ba tool đọc repo trả `data` RỖNG ở mọi nhánh mang `note`: không tệp nào được mở, không mục nào
   * được liệt kê, không dòng nào khớp. Để LLM diễn giải một trong tám ca ấy là mời nó **bịa nội
   * dung một file** — lớp lỗi nguy hiểm nhất có thể có ở một tác nhân lập trình, vì bản vá bịa ra
   * TRÔNG GIỐNG HỆT một bản vá thật.
   *
   * ⚠ `NO_MATCH` và `GREP_DEADLINE` là hai ca gần biên nhất — chúng nghe như "đã có câu trả lời:
   * không có gì". Xếp `chan` vì `textSummary` của chúng phát biểu một sự thật mà **văn vẻ hoá sẽ
   * làm hỏng**: *"đã quét N tệp"* và *"đây là BẢN CẮT vì hết giờ, KHÔNG phải kết luận rằng mẫu này
   * không có trong repo"*. Một model diễn giải lại hai câu ấy sẽ rất dễ rút gọn thành *"không có
   * trong repo"* — tức biến một phép đo BỘ PHẬN thành một khẳng định TOÀN THỂ.
   */
  DENIED_SECRET: "chan",
  DENIED_DIR: "chan",
  DENIED_EXT: "chan",
  BUDGET_EXCEEDED: "chan",
  NOT_A_DIRECTORY: "chan",
  NO_MATCH: "chan",
  GREP_DEADLINE: "chan",
  INVALID_PATTERN: "chan",
  // ── doc 78 PHA B (2026-08-18) — CHẠY LỆNH (`writeHandlers/repoCommand.ts`) ──────────────────
  /**
   * ⚠⚠ SÁU MÃ, TẤT CẢ `chan` — VÀ CÁI **KHÔNG** CÓ TRONG DANH SÁCH NÀY MỚI LÀ PHÉP ĐO.
   *
   * Năm mã đầu là những lượt **lệnh CHƯA HỀ CHẠY** (bị chặn ở lớp ký tự · ngoài danh sách trắng ·
   * đường dẫn xấu · không phân giải được tệp chạy · spawn hỏng): `data` rỗng hoàn toàn, không một
   * byte hiện trường nào. `CMD_TIMEOUT` là ca gần biên nhất — nó CÓ đầu ra thật — nhưng đầu ra ấy
   * là **BẢN CẮT của một lệnh chưa xong**, và `textSummary` của nó nói đúng câu *"đây KHÔNG phải
   * kết luận lệnh chạy xong"*. Để LLM văn vẻ hoá câu ấy là mời nó rút thành *"build hỏng"* — biến
   * một phép đo BỘ PHẬN thành khẳng định TOÀN THỂ, đúng lý lẽ đã dùng cho `GREP_DEADLINE`.
   *
   * ★★★ Và điều quan trọng: **một lượt chạy THOÁT ĐƯỢC không đặt `note` nào, kể cả khi mã thoát
   * khác 0.** `npm run check` trả mã 2 kèm 40 dòng lỗi kiểu là một phát biểu ĐẦY ĐỦ về hiện
   * trường. Gắn `note` cho nó sẽ chặn đúng nhịp mà cả pha B tồn tại để nối (*"đọc lỗi THẬT rồi sửa
   * tiếp"*, doc 78 §2) — nên nhánh ấy cố ý KHÔNG có tên ở bảng này.
   */
  CMD_METACHAR: "chan",
  CMD_NOT_ALLOWED: "chan",
  CMD_ARG_PATH_REJECTED: "chan",
  CMD_RESOLVE_ERROR: "chan",
  CMD_SPAWN_ERROR: "chan",
  CMD_TIMEOUT: "chan",
  /**
   * ★ 2026-08-20 — **`EXEC_WRITE_NEEDS_EDIT_BIT`: `chan`, và vì sao nó KHÔNG được `dien-giai`.**
   *
   * Mã này phát ra khi cờ `AI_REPO_EXEC_GHIDIA_DOI_CANEDIT` BẬT và người dùng thiếu bit thứ hai
   * (`ai_repo_read/canEdit`) cho một lệnh **ghi đè tệp mã nguồn** (hôm nay: `dotnet format`). Nó
   * cùng họ với `PERMISSION_DENIED`: một lượt TỪ CHỐI VÌ QUYỀN, `data` rỗng, **lệnh chưa chạy**.
   * Cho LLM văn vẻ hoá nó là mời nó rút gọn thành *"đã định dạng xong"* hoặc *"hệ thống lỗi"* —
   * hai câu đều SAI, và câu thứ hai đẩy người dùng đi tìm lỗi ở chỗ không có lỗi. `textSummary`
   * nêu ĐÍCH DANH `module/action` còn thiếu, đúng luật `readToolRbac.cauTuChoi`.
   */
  EXEC_WRITE_NEEDS_EDIT_BIT: "chan",
  // ── doc 78 PHA C (2026-08-19) — GHI TỆP (`writeHandlers/applyDiff.ts`) ──────────────────────
  /**
   * ⚠⚠ NĂM MÃ MỚI, TẤT CẢ `chan` — mỗi mã là một lượt **TỪ CHỐI GHI** kèm `data` rỗng
   * (`ok:false`, không byte nào rời cửa `writeConfined`). Để LLM văn vẻ hoá một lượt từ chối ghi là
   * mời nó rút *"đã áp xong"* từ một lượt CHƯA áp — nguy hiểm nhất có thể có ở một tác nhân ghi mã.
   *   • `FILE_DIRTY`        — tệp có thay đổi CHƯA COMMIT (hàng rào cốt lõi chống sự cố 2026-08-18).
   *   • `BASE_MISMATCH`     — băm(tệp thật) ≠ băm(original) ⇒ nhìn phiên bản CŨ / tệp đổi dưới chân.
   *   • `GIT_STATUS_FAILED` — không hỏi được git ⇒ không chứng minh được sạch ⇒ fail-closed.
   *   • `NO_CHANGE`         — original === modified ⇒ không có gì để áp.
   *   • `FILE_TOO_LARGE`    — tệp lớn hơn trần so-khớp ⇒ không băm khớp an toàn được.
   * (PATH_REJECTED · DENIED_SECRET · DENIED_DIR · DENIED_EXT · MISSING_REQUIRED_ARG · NOT_A_FILE ·
   *  BUDGET_EXCEEDED · WRITE_ERROR đã có ở trên — apply_diff DÙNG LẠI, không đẻ mã trùng nghĩa.)
   */
  FILE_DIRTY: "chan",
  BASE_MISMATCH: "chan",
  GIT_STATUS_FAILED: "chan",
  NO_CHANGE: "chan",
  FILE_TOO_LARGE: "chan",
};

describe("§1 — mọi mã `note` trong mã nguồn đều đã được PHÁN QUYẾT", () => {
  const thay = macTrongNguon();

  it("★ không có mã nào nằm ngoài bảng kê (mã MỚI chưa phân loại ⇒ ĐỎ)", () => {
    const laMat = [...thay.entries()]
      .filter(([ma]) => !(ma in CENSUS))
      .map(([ma, noi]) => `${ma} (${noi.join(", ")})`);
    expect(
      laMat,
      "Mã `note` MỚI chưa được phân loại. Thêm nó vào `CENSUS` với phán quyết `chan` hoặc " +
        "`dien-giai`; nếu `dien-giai` thì phải khai thêm ở `TOOL_NOTE_VAN_DIEN_GIAI` kèm lý do.",
    ).toEqual([]);
  });

  it("bảng kê CÓ bắt được các mã trọng tâm của lỗ này", () => {
    expect([...thay.keys()]).toEqual(expect.arrayContaining(["SCOPE_EMPTY", "NOT_FOUND_WITH_SUGGESTIONS"]));
  });
});

describe("§2 — bảng kê không chứa MỤC RỖNG (mã đã biến mất khỏi mã nguồn)", () => {
  it("mọi mã trong bảng kê vẫn còn ít nhất một chỗ sinh ra nó", () => {
    const thay = macTrongNguon();
    const chet = Object.keys(CENSUS).filter((ma) => !thay.has(ma));
    expect(chet, "Bảng kê giữ mã không còn ai sinh ra — gỡ nó đi, đừng để bảng kê thành hoá thạch.").toEqual([]);
  });
});

describe("§3 — bảng kê và VẬT CƯỠNG CHẾ lúc chạy phải là MỘT", () => {
  it("★ nhánh `dien-giai` của bảng kê TRÙNG KHÍT `TOOL_NOTE_VAN_DIEN_GIAI`", () => {
    const khaiBao = Object.entries(CENSUS)
      .filter(([, v]) => v === "dien-giai")
      .map(([k]) => k)
      .sort();
    expect(
      [...TOOL_NOTE_VAN_DIEN_GIAI].sort(),
      "Khai một đằng, cưỡng chế một nẻo — đúng lớp lỗi đã đẻ ra chính cái lỗ này.",
    ).toEqual(khaiBao);
  });
});

describe("§4 — VỊ TỪ THẬT, không phải bảng kê, mới là thứ phán quyết", () => {
  for (const [ma, xep] of Object.entries(CENSUS)) {
    it(`${ma} ⇒ ${xep === "chan" ? "CHẶN" : "vẫn diễn giải"}`, () => {
      expect(toolKhongCoGiDeNoi({ note: ma }, 1)).toBe(xep === "chan");
    });
  }
});

describe("§5 — CHIỀU MẶC ĐỊNH: thứ lưới quét-mã-nguồn KHÔNG BAO GIỜ liệt kê được", () => {
  /**
   * Bốn chỗ đặt `note` bằng BIẾN, không phải hằng chữ — `writeHandlers.ts:170` (`note: msg`),
   * `writeHandlers/machineControl.ts:109` & `:366` (`result.reason` / `check.detail`),
   * `writeHandlers/visionControl.ts:153`. Giá trị của chúng chỉ tồn tại lúc chạy. Chúng an toàn
   * KHÔNG PHẢI vì ai đó nhớ khai, mà vì chiều MẶC ĐỊNH của vị từ là CHẶN.
   */
  it("★ một mã CHƯA TỪNG XUẤT HIỆN ở đâu ⇒ vẫn CHẶN (đảo chiều về fail-open ⇒ ĐỎ)", () => {
    expect(toolKhongCoGiDeNoi({ note: "MA_HOAN_TOAN_MOI_2026" }, 1)).toBe(true);
    expect(toolKhongCoGiDeNoi({ note: "Guardrail rejected: value out of range" }, 1)).toBe(true);
  });

  it("★ CHỐNG VÁ QUÁ TAY — kết quả BÌNH THƯỜNG (không `note`) KHÔNG bị chặn", () => {
    expect(toolKhongCoGiDeNoi({}, 1)).toBe(false);
    expect(toolKhongCoGiDeNoi({ note: undefined }, 1)).toBe(false);
    expect(toolKhongCoGiDeNoi({ note: "" }, 1)).toBe(false);
    expect(toolKhongCoGiDeNoi(null, 1)).toBe(false);
    expect(toolKhongCoGiDeNoi(undefined, 1)).toBe(false);
  });

  it("NHIỀU VÒNG vẫn KHÔNG khoá (giá trị nằm ở phép tổng hợp giữa các vòng)", () => {
    expect(toolKhongCoGiDeNoi({ note: "SCOPE_EMPTY" }, 2)).toBe(false);
  });
});
