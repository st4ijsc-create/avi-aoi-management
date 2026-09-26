/**
 * ganGizmoTheoTang.unit.test.ts — ★★ GIZMO KHÔNG ĐƯỢC BÁM PROXY CŨ KHI MÁY ĐANG
 * CHỌN KHÔNG NẰM TRÊN TẦNG ĐANG VẼ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HIỆN TRƯỜNG ĐO ĐƯỢC (phân xử PH-41)
 * ════════════════════════════════════════════════════════════════════════════
 * `CanhThietKe.tsx` có HAI quyết định đọc HAI biến khác nhau về cùng một việc:
 *
 *   · đồng bộ vị trí proxy  — `if (!o || !mayChon) return;`
 *     `mayChon = may.find(m => m.machineId === mayDangChon) ?? null`, tức máy đang
 *     chọn **tìm thấy trong mảng đang vẽ**. `XuongThietKe.mayVe` chỉ đưa vào máy có
 *     `datCho.hienThi` ⇒ đổi tầng là máy tầng khác BIẾN MẤT khỏi mảng này.
 *   · gắn gizmo             — `mayDangChon !== null && …`
 *     tức CHỈ hỏi "có id nào đang chọn không", không hỏi "id ấy có trên tầng này không".
 *
 * Hệ quả: chọn máy ở tầng 1 → đổi sang tầng 2 ⇒ `mayChon` là `null` nên vị trí
 * proxy KHÔNG được đồng bộ nữa, nhưng gizmo VẪN ĐƯỢC GẮN — nó đứng nguyên ở toạ
 * độ của máy tầng trước, giữa một tầng không chứa máy đó.
 *
 * ★ KHÔNG HỎNG DỮ LIỆU: `onXong` đã tự chặn bằng `if (!mayChon) return;`, nên kéo
 *   gizmo ma ấy không ghi gì. Đây là lỗi THỊ GIÁC + hiểu nhầm: người dùng thấy
 *   một tay nắm bám vào chỗ sai và tưởng mình đang sửa một máy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO ĐO BẰNG MỘT VỊ TỪ THUẦN + CENSUS NGUỒN
 * ════════════════════════════════════════════════════════════════════════════
 * `CanhThietKe` dựng `<KhungCanh>` → `<Canvas>` → WebGL; jsdom không có WebGL nên
 * không render được nguyên màn, và bản brief cấm bật server/trình duyệt. Nên điều
 * kiện gắn gizmo được TÁCH RA thành `coGanGizmo` — một hàm thuần đo được — và ca
 * G4 ghim rằng JSX thật sự gọi nó với máy **đã lọc theo tầng**. Thiếu ca G4 thì
 * hàm thuần có thể đúng trong khi màn vẫn sai (lớp lỗi "hàm đúng, không ai gọi").
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

import { coGanGizmo } from "./CanhThietKe";

const TEP_CANH = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "client/src/components/twin3d/thiet-ke/CanhThietKe.tsx",
);

/** Máy tìm thấy trên tầng đang vẽ — chỉ cần một tham chiếu khác `null`. */
const MAY_TREN_TANG = { machineId: 42 };

describe("coGanGizmo — gizmo chỉ gắn khi máy đang chọn NẰM TRÊN tầng đang vẽ", () => {
  it("G1 ĐỐI CHỨNG DƯƠNG — máy CÓ trên tầng, không khoá, proxy đã vào scene ⇒ GẮN", () => {
    expect(
      coGanGizmo({ mayTrenTang: MAY_TREN_TANG, daKhoa: false, proxyDaVaoScene: true }),
      "nếu ca này false thì mọi ca 'không gắn' dưới đây là xanh giả",
    ).toBe(true);
  });

  it("★★ G2 — máy đang chọn KHÔNG có trên tầng đang vẽ ⇒ KHÔNG gắn (gizmo ma)", () => {
    expect(coGanGizmo({ mayTrenTang: null, daKhoa: false, proxyDaVaoScene: true })).toBe(false);
  });

  it("G3 KHÔNG PHÁ — hai chặn có sẵn vẫn còn: máy đã KHOÁ ⇒ không gắn; proxy CHƯA vào scene ⇒ không gắn", () => {
    // CHẶN-2 (quyền/khoá): gizmo không có trạng thái "xám", phải gỡ HẲN.
    expect(coGanGizmo({ mayTrenTang: MAY_TREN_TANG, daKhoa: true, proxyDaVaoScene: true })).toBe(false);
    // CHẶN-3 (proxy phải có parent): attach sớm ⇒ `_parentScale` = (0,0,0) ⇒ NaN.
    expect(coGanGizmo({ mayTrenTang: MAY_TREN_TANG, daKhoa: false, proxyDaVaoScene: false })).toBe(false);
    // Cả ba điều kiện cùng sai.
    expect(coGanGizmo({ mayTrenTang: null, daKhoa: true, proxyDaVaoScene: false })).toBe(false);
  });

  it("★★ G4 NGUỒN — JSX gắn gizmo QUA `coGanGizmo` với máy ĐÃ LỌC THEO TẦNG, và không còn hỏi `mayDangChon` ở đó", () => {
    const ma = docMaNguon(TEP_CANH);

    // `mayChon` là máy đang chọn ĐÃ tìm trong mảng đang vẽ — một nguồn sự thật
    // duy nhất cho cả ba việc: đồng bộ vị trí, gắn gizmo, và ghi kết quả kéo.
    expect(ma).toContain("() => may.find((m) => m.machineId === mayDangChon) ?? null,");
    expect(ma).toContain(
      "const ganGizmo = coGanGizmo({\n" +
        "    mayTrenTang: mayChon,\n" +
        "    daKhoa: mayDaKhoa,\n" +
        "    proxyDaVaoScene: daVaoScene,\n" +
        "  });\n",
    );
    expect(ma).toContain("vatThe={ganGizmo ? proxy : null}");
    // Lối cũ phải BIẾN MẤT: hỏi `mayDangChon !== null` ở chỗ gắn gizmo chính là lỗi.
    expect(ma).not.toContain("mayDangChon !== null && !mayDaKhoa && daVaoScene");

    // ★ Vì sao chặn phải nằm ở CHỖ GẮN chứ không ở chỗ đồng bộ: chỗ đồng bộ
    //   BỎ QUA khi không tìm thấy máy, nên proxy giữ nguyên toạ độ CŨ. Dòng này
    //   là lý do tồn tại của G2; nó đổi thì kết luận ở trên phải đo lại.
    expect(ma).toContain("if (!o || !mayChon) return;");
    // ★ Và `onXong` vẫn tự chặn — đó là lý do lỗi này KHÔNG hỏng dữ liệu.
    expect(ma).toContain("if (!mayChon) return;");
  });
});
