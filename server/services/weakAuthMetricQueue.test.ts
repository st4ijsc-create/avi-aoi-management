/**
 * G (doc 52 §6.1) — lượt weak-auth ĐẦU TIÊN sau mỗi restart không được biến mất khỏi
 * metric.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO LỖI NÀY QUAN TRỌNG HƠN VẺ NGOÀI CỦA NÓ
 * ══════════════════════════════════════════════════════════════════════════════════
 * Cầu nối Prometheus nạp LƯỜI (`import("../_core/metrics")` động, để prom-client không
 * nằm trong đồ thị module của tầng xác thực). Bản trước ghi thẳng trong comment:
 * *"the first weak hit may miss the metric; the in-memory registry is exact regardless,
 * so nothing is lost."*
 *
 * Đo live 2026-08-21: gửi **2** lượt bị từ chối, counter chỉ lên **1**.
 * "Nothing is lost" đúng với sổ `Map`, nhưng SAI với thứ người ta thật sự dùng để
 * quyết: checklist GO-LIVE ký bằng **`machine_weak_auth_denied`** — một METRIC. Và cái
 * `Map` thì xoá sạch mỗi lần restart, nên đúng lúc cần đối chiếu nhất thì nó không còn.
 *
 * Hệ quả: mỗi lần restart nuốt MỘT lượt weak-auth. Ai đang chờ counter về 0 để flip cờ
 * sẽ thấy 0 **sớm hơn sự thật** — số liệu nói dối theo đúng hướng NGUY HIỂM.
 *
 * Sau bản vá, đo lại trên máy chủ vừa restart: 2 lượt ⇒ counter = **2**.
 *
 * ── VÌ SAO LƯỚI NÀY ĐỌC MÃ NGUỒN ─────────────────────────────────────────────────
 * Thứ cần canh là một CƠ CHẾ PHÒNG VỆ (hàng đợi + xả) chứ không phải một giá trị đầu
 * ra: thời điểm `import()` động hoàn tất không quan sát được tất định trong unit test.
 * Bằng chứng hành vi nằm ở phép đo live ghi trong commit; lưới này giữ cho cơ chế
 * không bị ai gỡ đi trong một lượt dọn dẹp.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "machineAuthService.ts");
const src = () => readFileSync(FILE, "utf8");

describe("G — hàng đợi metric weak-auth (không nuốt lượt đầu sau restart)", () => {
  it("★★★ có HÀNG ĐỢI cho lượt xảy ra trước khi cầu nối nạp xong", () => {
    expect(src()).toMatch(/const metricChoNap: Array<\{ method: string; outcome: string \}> = \[\]/);
    // Đẩy vào hàng đợi phải nằm TRƯỚC cổng `metricsBridgeRequested` — đặt sau thì chỉ
    // lượt đầu tiên được đệm, các lượt kế tiếp trong cửa sổ chờ vẫn mất.
    const m = src().match(/if \(metricChoNap\.length < METRIC_CHO_TRAN\)[\s\S]{0,120}?if \(metricsBridgeRequested\) return;/);
    expect(m, "đẩy-vào-hàng-đợi phải đứng trước `if (metricsBridgeRequested) return;`").not.toBeNull();
  });

  it("★★★ hàng đợi được XẢ khi cầu nối nạp xong", () => {
    // Có hàng đợi mà không xả thì còn tệ hơn không có: nó im lặng nuốt MỌI lượt.
    expect(src()).toMatch(/metricChoNap\.splice\(0, metricChoNap\.length\)/);
    expect(src()).toMatch(/incSecurityEventFn\(`machine_weak_auth_\$\{e\.outcome\}`, e\.method\)/);
  });

  it("hàng đợi có TRẦN — cầu nối hỏng vĩnh viễn không được phình bộ nhớ", () => {
    expect(src()).toMatch(/const METRIC_CHO_TRAN = \d+/);
  });

  it("cầu nối hỏng ⇒ XẢ hàng đợi, không giữ rác", () => {
    expect(src()).toMatch(/metricChoNap\.length = 0/);
  });

  it("⚠ lời khai CŨ 'nothing is lost' chỉ được tồn tại như TRÍCH DẪN LỊCH SỬ", () => {
    // Một comment sai còn nguy hơn không có comment: nó khiến người đọc sau tin rằng
    // chuyện đã được cân nhắc và bỏ qua CÓ LÝ DO.
    //
    // Nhưng xoá sạch nó cũng mất mát: biết CHÍNH XÁC điều gì từng được tin — và sai ở
    // đâu — mới là thứ ngăn người sau tin lại. Nên luật ở đây không phải "cụm từ phải
    // biến mất", mà "cụm từ chỉ được xuất hiện ở nơi ĐÃ ĐÁNH DẤU là lời khai cũ".
    //
    // ⚠ HAI bản trước của chính ca này đều sai, theo hai hướng NGƯỢC nhau:
    //   • bản 1 đòi "cụm từ phải biến mất" ⇒ ĐỎ ở trạng thái sạch, vì nó bắt đúng câu
    //     trích trong comment mới — thước thô tố cả cái nó đang bảo vệ;
    //   • bản 2 nới thành "trong ±3 dòng có chữ bác bỏ" ⇒ đột biến M4 (gỡ dấu trích,
    //     để lời khai đứng TRẦN) SỐNG SÓT, vì câu "Đo live…" ở dòng kế bên vẫn che cho nó.
    // Luật đúng nằm ở dấu trích, không ở khoảng cách: cụm từ chỉ được nằm TRONG một
    // span `*"…"*`. Gỡ dấu trích ⇒ đỏ. Xoá hẳn trích dẫn ⇒ xanh (không còn lời khai sai).
    const conLai = src().replace(/\*"[\s\S]*?"\*/g, "");
    expect(conLai, "lời khai cũ đang đứng TRẦN — phải nằm trong dấu trích `*\"…\"*`")
      .not.toMatch(/the first weak hit may miss the metric|so nothing is lost/);
  });
});
