/**
 * C1 + C2 — nguồn ghi CUỐI CÙNG phải đi qua cửa chung, và cửa chung phải chở đủ dữ liệu.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ BẬT MỘT LÁ CỜ KHÔNG ĐƯỢC LÀM HỎNG PHÉP ĐO
 * ══════════════════════════════════════════════════════════════════════════════════
 * `aiQualityGate` từng `db.insert(predictiveAlerts)` THẲNG khi `ANOMALY_CREATE_ALERTS=true`.
 * Hậu quả: không gộp trùng · không `expiresAt` (sweeper không bao giờ đóng được) · và
 * **không ghi nhật ký lần-tái-diễn** ⇒ cả nhóm `PATTERN_ANOMALY` VÔ HÌNH với KPI.
 *
 * Không một dấu hiệu nào: bảng vẫn có dòng, giao diện vẫn hiện, chỉ CON SỐ là sai. Và đây
 * là lá cờ mặc định TẮT — nghĩa là lúc có người bật thì đã không còn ai nhớ chỗ này tồn tại.
 *
 * ── VÌ SAO C1 VÀ C2 LÀ MỘT VIỆC, KHÔNG PHẢI HAI ─────────────────────────────────
 * Backlog xếp C2 ("`routeAlert` chưa nhận `predictedValue`/`productModelCode`/`modelUsed`")
 * là mục riêng, mức thấp, ghi chú *"không màn nào đọc"*. Nhưng chuyển C1 sang `routeAlert`
 * KHI CHƯA làm C2 sẽ âm thầm làm mất đúng ba trường mà đường cũ vẫn ghi — một cuộc "dọn
 * dẹp" tệ hơn để nguyên. C2 là ĐIỀU KIỆN CẦN của C1.
 *
 * ── `modelUsed` GÁN CỨNG LÀ MỘT LỜI KHAI SAI CHỦ THỂ ─────────────────────────────
 * Trước bản này `aiAnalysis.modelUsed` luôn là `"smart-alert-router"`. Với nguồn PatchCore,
 * dòng dữ liệu khai rằng chính BỘ ĐỊNH TUYẾN đã phát hiện bất thường — người đi truy nguồn
 * sẽ tìm nhầm chỗ. Không phải "thiếu thông tin" mà là **thông tin sai**.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Bỏ comment (giữ độ dài để số dòng không lệch).
 *
 * ⚠ LẦN THỨ BA TRONG HAI NGÀY một lưới đọc-mã tố đúng lời giải thích của chính nó:
 * bản đầu của ca "không còn INSERT thẳng" ĐỎ vì comment mới có nhắc lại
 * `db.insert(predictiveAlerts)` để nói rằng nó ĐÃ BỊ BỎ. Trước đó là `weakAuthMetricQueue`
 * (bắt câu trích lịch sử) và bộ đếm F1 (đếm cả comment cảnh báo *"KHÔNG toast
 * error.message ở đây"*).
 * ⇒ Luật rút ra cho mọi lưới đọc-mã sau này: **quét trên mã, không quét trên văn bản.**
 */
function boComment(src: string): string {
  let out = "", i = 0, tt = "ma", dau = "";
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (tt === "ma") {
      if (c === "/" && d === "/") { tt = "dong"; out += "  "; i += 2; continue; }
      if (c === "/" && d === "*") { tt = "khoi"; out += "  "; i += 2; continue; }
      if (c === '"' || c === "'") { tt = "chuoi"; dau = c; out += c; i++; continue; }
      if (c === "`") { tt = "mau"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (tt === "chuoi" || tt === "mau") {
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if ((tt === "chuoi" && c === dau) || (tt === "mau" && c === "`")) tt = "ma";
      out += c; i++; continue;
    }
    if (tt === "dong") { if (c === "\n") { tt = "ma"; out += c; i++; continue; } out += " "; i++; continue; }
    if (c === "*" && d === "/") { tt = "ma"; out += "  "; i += 2; continue; }
    out += c === "\n" ? c : " "; i++;
  }
  return out;
}

const GATE = boComment(readFileSync(join(HERE, "aiQualityGate.ts"), "utf8"));
const ROUTER = boComment(readFileSync(join(HERE, "aiSmartAlertRouter.ts"), "utf8"));

describe("C1 — đường ghi cảnh báo bất thường đi qua routeAlert", () => {
  it("cầu chì: đọc được cả hai file và chúng không rỗng", () => {
    expect(GATE.length).toBeGreaterThan(1000);
    expect(ROUTER.length).toBeGreaterThan(1000);
  });

  it("★★★ `aiQualityGate` KHÔNG còn INSERT thẳng vào `predictiveAlerts`", () => {
    // Đây là bất biến, không phải ngân sách: một đường ghi vòng qua cửa chung là một
    // nhóm cảnh báo biến mất khỏi KPI.
    expect(GATE).not.toMatch(/db\s*\.\s*insert\s*\(\s*predictiveAlerts\s*\)/);
  });

  it("★★★ và nó PHẢI gọi `routeAlert` với đúng loại `PATTERN_ANOMALY`", () => {
    // Đối trọng cho ca trên: xoá hẳn khối ghi cũng làm ca trên xanh — và khi ấy bật cờ
    // lên sẽ không sinh cảnh báo nào cả, một hồi quy im lặng hơn nữa.
    expect(GATE).toMatch(/routeAlert\(\{/);
    expect(GATE).toMatch(/type: "PATTERN_ANOMALY"/);
  });

  it("★★★ chuyển đổi KHÔNG được làm mất dữ liệu đường cũ có ghi", () => {
    // Ba trường mà `db.insert` cũ ghi. Thiếu một trường là một "dọn dẹp" âm thầm ăn bớt.
    const khoiRoute = GATE.slice(GATE.indexOf("routeAlert({"));
    for (const truong of ["predictedValue", "threshold", "dataPoints", "modelUsed"]) {
      expect(khoiRoute, `mất trường ${truong}`).toContain(truong);
    }
    expect(khoiRoute).toMatch(/modelUsed: `anomaly:\$\{result\.source\}`/);
  });
});

describe("C2 — routeAlert chở đủ ba trường", () => {
  it("★★★ `predictedValue` được ghi, và KHÔNG dùng khuôn truthy", () => {
    expect(ROUTER).toMatch(/predictedValue: event\.data\.predictedValue != null \? String\(/);
    // `event.data.predictedValue ? … : null` sẽ nuốt số 0 — một điểm đo hợp lệ. Cùng lớp
    // lỗi với `ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES=0` gặp cùng ngày.
    expect(ROUTER).not.toMatch(/predictedValue: event\.data\.predictedValue \?/);
  });

  it("★★★ `productModelCode` chỉ ghi khi người gọi truyền — không ghi đè bằng null", () => {
    expect(ROUTER).toMatch(/\.\.\.\(event\.data\.productModelCode != null/);
  });

  it("★★★ `modelUsed` KHÔNG còn gán cứng — tên nguồn thật phải sống sót", () => {
    expect(ROUTER).toMatch(/const eventModelUsed =/);
    expect(ROUTER).toMatch(/modelUsed: eventModelUsed,/);
    // Chuỗi gán cứng chỉ được phép còn lại ở vai DỰ PHÒNG (khi người gọi không truyền).
    const ganCung = (ROUTER.match(/"smart-alert-router"/g) ?? []).length;
    expect(ganCung, "chỉ còn 1 chỗ, ở nhánh dự phòng").toBe(1);
  });

  it("★★★ nhánh làm giàu bằng LLM NỐI THÊM, không XOÁ tên nguồn", () => {
    // Ghi đè hẳn thành "smart-alert-router+gguf" sẽ xoá chủ thể thật đúng vào lúc dòng
    // dữ liệu trở nên thú vị nhất (đã có LLM phân tích).
    expect(ROUTER).toMatch(/aiAnalysisPayload\.modelUsed = `\$\{eventModelUsed\}\+gguf`/);
    expect(ROUTER).not.toMatch(/= "smart-alert-router\+gguf"/);
  });
});
