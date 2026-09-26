/**
 * G2-D — GHOST-TEXT vs APPLY-HUNK: hai cơ chế có giẫm chân nhau không?
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI ĐO CHỨ KHÔNG LẬP LUẬN
 * ══════════════════════════════════════════════════════════════════════════════════
 * Áp một khối = ghi một văn bản MỚI vào editor. Nếu lúc đó đang có gợi ý ghost-text treo ở
 * offset cũ, và gợi ý đó SỐNG SÓT qua lượt ghi, thì cú `Tab` tiếp theo sẽ chèn văn bản cũ
 * vào một vị trí đã dịch — tức là làm hỏng mã ngay tại chỗ vừa vá. Đây đúng lớp hậu quả mà
 * cả đợt này đang canh, nên nó phải là một PHÉP ĐO, không phải một câu khẳng định trong
 * comment.
 *
 * `EditorState` của CodeMirror 6 chạy được KHÔNG CẦN DOM (không dựng `EditorView`), nên
 * `StateField` + `StateEffect` — nơi chứa toàn bộ logic vòng đời của ghost — đo được thẳng
 * trong môi trường `node` của vitest repo này.
 *
 * ⚠ Lưới này KHÔNG phủ: debounce 350 ms và seq-guard (đã có lưới riêng ở
 *   ./inlineCopilotController.unit.test.ts). Ở đây chỉ đo ĐÚNG một câu:
 *   "một lượt ghi văn bản xoá sạch gợi ý đang treo".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { ghostField, setGhost, inlineCopilotExtension } from "./inlineCopilotExtension";

const KHONG_GOI = async () => "";

function dungState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [inlineCopilotExtension({ fetchCompletion: KHONG_GOI })],
  });
}

/** Đặt một gợi ý ghost đang treo tại `pos`. */
function voiGhost(doc: string, text: string, pos: number) {
  const st = dungState(doc);
  return st.update({ effects: setGhost.of({ text, pos }) }).state;
}

describe("ghost-text × apply-hunk — không giẫm chân nhau", () => {
  it("gợi ý treo được thì mới đo được phần còn lại (tiền đề)", () => {
    const st = voiGhost("x := 1;\n", " // gợi ý", 7);
    expect(st.field(ghostField)).toEqual({ text: " // gợi ý", pos: 7 });
  });

  it("★ ÁP KHỐI (ghi đè toàn bộ doc) ⇒ gợi ý đang treo bị XOÁ", () => {
    const st = voiGhost("a\nb\nc", "ghost", 1);
    // Đúng hình dạng lượt ghi của HunkDiffView: thay CẢ tài liệu bằng chuỗi đã chiếu.
    const sau = st.update({
      changes: { from: 0, to: st.doc.length, insert: "a\nB\nc" },
    }).state;
    expect(sau.doc.toString()).toBe("a\nB\nc");
    expect(sau.field(ghostField)).toBeNull();
  });

  it("★ ghi ở CUỐI tài liệu (không chạm vị trí ghost) VẪN xoá gợi ý", () => {
    // Ca nguy hiểm nhất: sửa dòng cuối trong khi ghost treo ở dòng đầu. Nếu cơ chế xoá
    // dựa vào "vùng sửa có trùm lên ghost không" thì ca này lọt — và Tab sẽ chèn mù.
    const st = voiGhost("dong1\ndong2\ndong3", "ghost", 2);
    const sau = st.update({ changes: { from: 12, to: 17, insert: "DONG3" } }).state;
    expect(sau.field(ghostField)).toBeNull();
  });

  it("chỉ DI CHUYỂN con trỏ (không sửa doc) cũng xoá gợi ý", () => {
    const st = voiGhost("abcdef", "ghost", 2);
    const sau = st.update({ selection: { anchor: 5 } }).state;
    expect(sau.field(ghostField)).toBeNull();
  });

  it("giao dịch KHÔNG đụng doc lẫn con trỏ thì gợi ý ở nguyên (không tự rụng)", () => {
    const st = voiGhost("abcdef", "ghost", 2);
    const sau = st.update({}).state;
    expect(sau.field(ghostField)).toEqual({ text: "ghost", pos: 2 });
  });

  it("đường NHẬN gợi ý (Tab: vừa sửa doc VỪA mang setGhost(null)) vẫn xoá đúng — hiệu ứng thắng", () => {
    const st = voiGhost("abc", "XYZ", 3);
    const sau = st.update({
      changes: { from: 3, to: 3, insert: "XYZ" },
      selection: { anchor: 6 },
      effects: setGhost.of(null),
    }).state;
    expect(sau.doc.toString()).toBe("abcXYZ");
    expect(sau.field(ghostField)).toBeNull();
  });

  it("một giao dịch vừa sửa doc vừa đặt gợi ý MỚI ⇒ giữ gợi ý mới (không bị nhánh docChanged nuốt)", () => {
    const st = voiGhost("abc", "cu", 1);
    const sau = st.update({
      changes: { from: 3, to: 3, insert: "d" },
      effects: setGhost.of({ text: "moi", pos: 4 }),
    }).state;
    expect(sau.field(ghostField)).toEqual({ text: "moi", pos: 4 });
  });

  it("HunkDiffView không gắn phím tắt toàn cục — Tab/Escape vẫn thuộc về extension", () => {
    // Đo bằng NGUỒN: một `window.addEventListener("keydown"/"keyup")` trong HunkDiffView sẽ
    // cướp Tab/Escape khỏi keymap Prec.highest của CodeMirror và khỏi nút Đóng của Dock.
    // Đây là phép kiểm cấu tạo — rẻ, và bắt đúng cái hồi quy sẽ xảy ra nếu ai đó "thêm
    // phím tắt cho tiện" sau này.
    const src = readSource("../diff/HunkDiffView.tsx");
    expect(src).not.toMatch(/addEventListener\s*\(\s*["'`]key(down|up|press)["'`]/);
    expect(src).not.toMatch(/\bonKeyDown\s*=/);
    expect(src).not.toMatch(/useKeyboardShortcuts/);
  });
});

function readSource(rel: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}
