/**
 * ★★★ Pha 7 Task 2 — **MỘT BẢN CÀI ĐẶT DUY NHẤT của phép "liệt kê Ô TỪ KIỂU `VramAgentState`".**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI (và vì sao nó KHÔNG phải một module sản xuất)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `vramReadModel.drift.test.ts` (#4 của review Pha 6) đã dựng bộ suy này và trả giá để biết vì sao
 * nó phải suy từ **KIỂU** chứ không từ một **CẢNH**: đột biến **R1** đo được — thêm một ô ĐANG CHẢY
 * vào một **nhánh hợp kiểu mà cảnh dựng không hiện thực hoá** ⇒ **45 file / 790 ca XANH**. Tức câu
 * *"MỌI ô của ảnh chụp"* thật ra chỉ là *"mọi ô của MỘT cảnh"*.
 *
 * Pha 7 Task 2 cần **đúng lượng từ ấy** cho một luật khác (*"mọi ô phải có NGƯỜI ĐỌC"*). Global
 * Constraints của Pha 7 nói thẳng: ***"đừng viết bộ suy thứ N+1"*** — hai bộ suy độc lập cho cùng
 * một tập ô là đúng lớp lỗi *"hai bộ suy ĐỘC LẬP canh HAI NỬA của MỘT câu"* mà Pha 6 vừa trả giá.
 * ⇒ Bộ suy được **rút ra khỏi** file test và đặt ở đây; **cả hai lưới nhập từ đây**.
 *
 * ⚠ File này là **CÔNG CỤ CỦA LƯỚI**, không phải mã sản xuất: nó đọc đĩa (`node:fs`) và nhập
 * `typescript`. **KHÔNG một module sản xuất nào được nhập nó** — có ca canh đúng điều đó ở
 * `server/services/vram/vramReadModel.readers.test.ts`. Nó nằm ở `.ts` (không phải `.test.ts`) vì
 * `tsconfig` **loại trừ** `*.test.ts`, và một bộ suy không được `tsc` soi là một bộ suy có thể mục
 * ruỗng trong im lặng (bài học Pha 3).
 *
 * ⚠ Quy ước đường (PHẢI khớp với người liệt kê lá lúc CHẠY ở `drift.test.ts`):
 *   • mảng của **giá trị nguyên thuỷ** (và tuple hằng, vd `variesWith`) là **MỘT lá** — không `[]`;
 *   • mảng của **đối tượng** đi vào từng phần tử ⇒ `[]` nối **THẲNG** vào tên ô
 *     (`nonFiniteFields[].path`, **không** phải `nonFiniteFields.[].path`);
 *   • **HỢP KIỂU: vét cạn MỌI nhánh** — đây chính là lỗ mà R1 chui qua.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Nguồn kiểu — **đường dẫn tường minh**, không glob (glob rỗng ⇒ lưới im lặng khai XANH). */
export const VRAM_READ_MODEL_SOURCE = join(fileURLToPath(new URL(".", import.meta.url)), "vramReadModel.ts");

function docKhaiBao(nguon: string): Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration> {
  const sf = ts.createSourceFile(nguon, readFileSync(nguon, "utf8"), ts.ScriptTarget.Latest, true);
  const ra = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  sf.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n)) ra.set(n.name.text, n);
    else if (ts.isTypeAliasDeclaration(n)) ra.set(n.name.text, n);
  });
  return ra;
}

/** Đường TƯƠNG ĐỐI dưới một nút kiểu. `""` ⇔ chính nút này là một **LÁ**. */
function duongTuongDoi(
  khaiBao: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  node: ts.TypeNode | undefined,
  dangDi: ReadonlySet<string>,
): Set<string> {
  const ra = new Set<string>();
  if (node === undefined) return ra.add(""), ra;
  if (ts.isParenthesizedTypeNode(node)) return duongTuongDoi(khaiBao, node.type, dangDi);
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return duongTuongDoi(khaiBao, node.type, dangDi);
  }
  // ⚠ HỢP KIỂU: vét cạn **MỌI** nhánh — lỗ mà đột biến R1 chui qua.
  if (ts.isUnionTypeNode(node)) {
    for (const m of node.types) for (const p of duongTuongDoi(khaiBao, m, dangDi)) ra.add(p);
    return ra;
  }
  if (ts.isArrayTypeNode(node)) {
    const con = duongTuongDoi(khaiBao, node.elementType, dangDi);
    // Mảng nguyên thuỷ ⇒ MỘT lá (đúng quy ước của người liệt kê lúc chạy).
    if (con.size === 1 && con.has("")) return ra.add(""), ra;
    for (const p of con) ra.add(p === "" ? "[]" : `[].${p}`);
    return ra;
  }
  // Tuple (vd `variesWith`) — mảng hằng của chuỗi ⇒ một lá.
  if (ts.isTupleTypeNode(node)) return ra.add(""), ra;
  if (ts.isTypeLiteralNode(node)) return thuThapThanhVien(khaiBao, node.members, ra, dangDi), ra;
  if (ts.isTypeReferenceNode(node)) {
    const ten = node.typeName.getText();
    const d = khaiBao.get(ten);
    // Kiểu NHẬP KHẨU (hoặc đệ quy) ⇒ LÁ. Chúng là hợp của chuỗi/số, không mở ra ô con nào.
    if (d === undefined || dangDi.has(ten)) return ra.add(""), ra;
    const di = new Set(dangDi).add(ten);
    if (ts.isInterfaceDeclaration(d)) return thuThapThanhVien(khaiBao, d.members, ra, di), ra;
    return duongTuongDoi(khaiBao, d.type, di);
  }
  return ra.add(""), ra;
}

function thuThapThanhVien(
  khaiBao: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  ms: ts.NodeArray<ts.TypeElement>,
  ra: Set<string>,
  dangDi: ReadonlySet<string>,
): void {
  for (const m of ms) {
    if (!ts.isPropertySignature(m)) continue;
    const ten = m.name.getText().replace(/^["']|["']$/g, "");
    for (const p of duongTuongDoi(khaiBao, m.type, dangDi)) {
      ra.add(p === "" ? ten : p.startsWith("[") ? `${ten}${p}` : `${ten}.${p}`);
    }
  }
}

/**
 * ★★★ **MỌI Ô LÁ của `VramAgentState`, suy từ KIỂU.** Đây là **lượng từ** dùng chung cho hai luật:
 *   • *"mỗi ô phải tự khai ĐỔI/KHÔNG-ĐỔI theo đồng hồ"* (`vramReadModel.drift.test.ts`);
 *   • *"mỗi ô phải có NGƯỜI ĐỌC THẬT"* (`vramReadModel.readers.test.ts`).
 * Một ô mới sinh ra ở **bất kỳ nhánh nào** của **bất kỳ hợp kiểu nào** tự đưa mình vào **cả hai**.
 */
export function vramStateLeafPaths(nguon: string = VRAM_READ_MODEL_SOURCE): Set<string> {
  const khaiBao = docKhaiBao(nguon);
  const goc = khaiBao.get("VramAgentState");
  const ra = new Set<string>();
  if (goc === undefined || !ts.isInterfaceDeclaration(goc)) return ra;
  thuThapThanhVien(khaiBao, goc.members, ra, new Set(["VramAgentState"]));
  return ra;
}
