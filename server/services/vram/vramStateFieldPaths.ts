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

/** Đường tương đối → tập **HẰNG CHUỖI** mà kiểu cho phép ở lá ấy (rỗng ⇔ không phải hợp hằng). */
type BanDo = Map<string, Set<string>>;

function gop(vao: BanDo, tu: BanDo): void {
  for (const [k, v] of tu) {
    const co = vao.get(k);
    if (co === undefined) vao.set(k, new Set(v));
    else for (const x of v) co.add(x);
  }
}
function motLa(hang: Iterable<string> = []): BanDo {
  return new Map([["", new Set(hang)]]);
}

/** Đường TƯƠNG ĐỐI dưới một nút kiểu. `""` ⇔ chính nút này là một **LÁ**. */
function duongTuongDoi(
  khaiBao: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  node: ts.TypeNode | undefined,
  dangDi: ReadonlySet<string>,
): BanDo {
  if (node === undefined) return motLa();
  if (ts.isParenthesizedTypeNode(node)) return duongTuongDoi(khaiBao, node.type, dangDi);
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return duongTuongDoi(khaiBao, node.type, dangDi);
  }
  /**
   * ★ **HẰNG CHUỖI CỦA MỘT HỢP KIỂU** — thu ở đây, và đây là một **ràng buộc chứ không phải tiện
   * tay**: `vramReadModel.readers.test.ts` đo *"đổi ô này thì `textSummary` có đổi không"*, và với
   * một ô kiểu `"a" | "b"` mà người đọc dùng làm **VỊ TỪ** (`x === "a" ? … : …`), một probe bịa
   * (`"a~M~"`) rơi vào **cùng nhánh** ⇒ phép đo khai oan *"không ai đọc"*. Giá trị lật nhánh phải
   * đến từ **CHÍNH KIỂU**, không từ một danh sách chép tay ở lưới.
   */
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return motLa([node.literal.text]);
  // ⚠ HỢP KIỂU: vét cạn **MỌI** nhánh — lỗ mà đột biến R1 chui qua.
  if (ts.isUnionTypeNode(node)) {
    const ra: BanDo = new Map();
    for (const m of node.types) gop(ra, duongTuongDoi(khaiBao, m, dangDi));
    return ra;
  }
  if (ts.isArrayTypeNode(node)) {
    const con = duongTuongDoi(khaiBao, node.elementType, dangDi);
    // Mảng nguyên thuỷ ⇒ MỘT lá (đúng quy ước của người liệt kê lúc chạy).
    if (con.size === 1 && con.has("")) return motLa();
    const ra: BanDo = new Map();
    for (const [p, h] of con) ra.set(p === "" ? "[]" : `[].${p}`, h);
    return ra;
  }
  // Tuple (vd `variesWith`) — mảng hằng của chuỗi ⇒ một lá.
  if (ts.isTupleTypeNode(node)) return motLa();
  if (ts.isTypeLiteralNode(node)) return thuThapThanhVien(khaiBao, node.members, dangDi);
  if (ts.isTypeReferenceNode(node)) {
    const ten = node.typeName.getText();
    const d = khaiBao.get(ten);
    // Kiểu NHẬP KHẨU (hoặc đệ quy) ⇒ LÁ. Chúng là hợp của chuỗi/số, không mở ra ô con nào.
    if (d === undefined || dangDi.has(ten)) return motLa();
    const di = new Set(dangDi).add(ten);
    if (ts.isInterfaceDeclaration(d)) return thuThapThanhVien(khaiBao, d.members, di);
    return duongTuongDoi(khaiBao, d.type, di);
  }
  return motLa();
}

function thuThapThanhVien(
  khaiBao: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  ms: ts.NodeArray<ts.TypeElement>,
  dangDi: ReadonlySet<string>,
): BanDo {
  const ra: BanDo = new Map();
  for (const m of ms) {
    if (!ts.isPropertySignature(m)) continue;
    const ten = m.name.getText().replace(/^["']|["']$/g, "");
    for (const [p, h] of duongTuongDoi(khaiBao, m.type, dangDi)) {
      const duong = p === "" ? ten : p.startsWith("[") ? `${ten}${p}` : `${ten}.${p}`;
      gop(ra, new Map([[duong, h]]));
    }
  }
  return ra;
}

/**
 * ★★★ **MỌI Ô LÁ của `VramAgentState`, suy từ KIỂU — kèm HẰNG CHUỖI mà kiểu cho phép.**
 * Đây là **lượng từ** dùng chung cho hai luật:
 *   • *"mỗi ô phải tự khai ĐỔI/KHÔNG-ĐỔI theo đồng hồ"* (`vramReadModel.drift.test.ts`);
 *   • *"mỗi ô phải có NGƯỜI ĐỌC THẬT"* (`vramReadModel.readers.test.ts`).
 * Một ô mới sinh ra ở **bất kỳ nhánh nào** của **bất kỳ hợp kiểu nào** tự đưa mình vào **cả hai**.
 */
export function vramStateLeafInfo(nguon: string = VRAM_READ_MODEL_SOURCE): ReadonlyMap<string, ReadonlySet<string>> {
  const khaiBao = docKhaiBao(nguon);
  const goc = khaiBao.get("VramAgentState");
  if (goc === undefined || !ts.isInterfaceDeclaration(goc)) return new Map();
  return thuThapThanhVien(khaiBao, goc.members, new Set(["VramAgentState"]));
}

/** Đường lá — **cùng một nguồn** với `vramStateLeafInfo()`, chỉ bỏ phần hằng. */
export function vramStateLeafPaths(nguon: string = VRAM_READ_MODEL_SOURCE): Set<string> {
  return new Set(vramStateLeafInfo(nguon).keys());
}
