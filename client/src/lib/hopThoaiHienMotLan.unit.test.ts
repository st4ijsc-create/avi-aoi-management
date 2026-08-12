/**
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-4 — HỘP THOẠI "HIỆN ĐÚNG MỘT LẦN" PHẢI CHẶN CẢ BA LỐI ĐÓNG.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ***∀ `<DialogContent>` bao quanh một bộ MÃ DỰ PHÒNG: nó phải chặn **cả ba** lối đóng —
 * nút X (`showCloseButton={false}`) · phím Esc (`onEscapeKeyDown`) · bấm ra ngoài
 * (`onInteractOutside`).***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO — MỘT LỜI KHAI ĐÚNG MỘT PHẦN BA, ĐỨNG NGAY TRÊN DÒNG NÓ MÔ TẢ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bình luận trong chính bản vá A4 khai: *"Cố ý **không** đóng được bằng nút X / bấm ra ngoài…"*.
 * Thứ **thật sự được viết** là `onInteractOutside={(e) => e.preventDefault()}` — **một** trong ba.
 *
 * **Đo được** (đọc chính component dùng chung `client/src/components/ui/dialog.tsx`):
 *   · `showCloseButton = true` là **MẶC ĐỊNH** ⇒ không truyền `false` thì nút **X** CÓ render;
 *   · `handleEscapeKeyDown` chỉ `preventDefault()` khi **IME đang gõ**, ngoài ra để Radix đóng;
 *   · `onOpenChange` của hộp thoại gọi `setShowBackupCodes(false)` ⇒ **cả hai** đường đóng thật.
 *
 * **Hậu quả** đúng cái A4 tự khai là *tệ hơn không cấp mã*: máy chủ đã **xoá bộ mã cũ và cấp 10 mã
 * mới**, hộp thoại hiện ra, người dùng bấm X theo phản xạ ⇒ 10 chuỗi **không ai từng đọc**, máy chủ
 * chỉ giữ bản băm. Và màn hình hiển thị *"số mã còn lại = 10"*, tức nó **khẳng định với họ rằng họ
 * có lưới an toàn**. Đường cấp lại nằm ở một màn hình KHÁC (nợ N-1: hai họ 2FA song song).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO LƯỚI **HÌNH DẠNG** CHỨ KHÔNG PHẢI LƯỚI DỰNG (render)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `vitest.config.ts` gom `client/src/**` bằng `*.unit.test.ts` và chạy chúng ở **môi trường node**
 * — không có DOM, nên một lượt dựng React ở đây là một lượt đỏ vì hạ tầng. Lưới này vì thế đọc
 * **cây cú pháp** của `Profile.tsx`. Vùng mù được khai thẳng: nó **không** chứng minh hành vi khi
 * chạy; nó chứng minh **ba thuộc tính có mặt**. §3 hiệu chuẩn bằng ba nguồn dựng sẵn có đáp số biết
 * trước, và §2 ghim rằng mặc định của `dialog.tsx` **vẫn** là thứ làm lượt bỏ sót trở nên nguy hiểm
 * — nếu ai đổi mặc định ấy thành `false`, ô §2 đỏ và lưới này phải được đọc lại.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/client/src/lib
const GOC = join(TEST_DIR, "..", "..", ".."); // …/<repo>

const FILE_HO_SO = "client/src/pages/Profile.tsx";
const FILE_DIALOG = "client/src/components/ui/dialog.tsx";

/** Ba thuộc tính chặn — mỗi cái đóng **một** lối, và cả ba đều cần. */
const BA_LOI_DONG = ["showCloseButton", "onEscapeKeyDown", "onInteractOutside"] as const;

function cayCuPhap(duong: string, ma: string): ts.SourceFile {
  return ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * Mọi `<DialogContent …>` **bao quanh** một biểu thức nhắc tới `backupCodes` — tức chính hộp thoại
 * hiển-thị-một-lần, nhận diện bằng **NỘI DUNG NÓ BỌC**, không bằng thứ tự xuất hiện trong file.
 *
 * ⚠ Nhận diện theo **cấu trúc** (nút cha–con của cây JSX) là thứ phân biệt lưới này với một phép
 *   tìm chuỗi: đổi chỗ hai hộp thoại trong file, hoặc chèn hộp thoại thứ ba, đều không lừa được nó.
 */
function hopThoaiMaDuPhong(sf: ts.SourceFile): ts.JsxOpeningElement[] {
  const ra: ts.JsxOpeningElement[] = [];
  const tenThe = (n: ts.JsxOpeningElement): string =>
    ts.isIdentifier(n.tagName) ? n.tagName.text : n.tagName.getText(sf);
  const nhacMaDuPhong = (n: ts.Node): boolean => {
    let thay = false;
    const di = (x: ts.Node): void => {
      if (thay) return;
      if (ts.isIdentifier(x) && x.text === "backupCodes") thay = true;
      else ts.forEachChild(x, di);
    };
    ts.forEachChild(n, di);
    return thay;
  };
  const di = (n: ts.Node): void => {
    if (ts.isJsxElement(n)) {
      const mo = n.openingElement;
      if (tenThe(mo) === "DialogContent" && nhacMaDuPhong(n)) ra.push(mo);
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

/** Tên các thuộc tính được truyền cho một thẻ JSX. */
function thuocTinh(mo: ts.JsxOpeningElement): Set<string> {
  const ra = new Set<string>();
  for (const p of mo.attributes.properties) {
    if (ts.isJsxAttribute(p) && ts.isIdentifier(p.name)) ra.add(p.name.text);
  }
  return ra;
}

/** `showCloseButton` có được truyền giá trị `false` **tường minh** không. */
function tatNutX(mo: ts.JsxOpeningElement): boolean {
  for (const p of mo.attributes.properties) {
    if (!ts.isJsxAttribute(p) || !ts.isIdentifier(p.name) || p.name.text !== "showCloseButton") continue;
    const kt = p.initializer;
    if (kt !== undefined && ts.isJsxExpression(kt) && kt.expression !== undefined) {
      return kt.expression.kind === ts.SyntaxKind.FalseKeyword;
    }
    return false; // `showCloseButton` trần ⇒ `true` ⇒ nút X vẫn hiện
  }
  return false;
}

const MA_HO_SO = readFileSync(join(GOC, FILE_HO_SO), "utf8");
const MA_DIALOG = readFileSync(join(GOC, FILE_DIALOG), "utf8");

describe("★★★ Pha 9 I-4 §1 — CẦU CHÌ: lưới thấy đúng hộp thoại nó nói tới", () => {
  it("★★★ tìm được ĐÚNG MỘT `<DialogContent>` bọc bộ mã dự phòng", () => {
    /**
     * ⚠⚠ 0 ⇒ lượng từ chạy trên tập rỗng và mọi ô dưới **xanh vô nghĩa** (glob rỗng ⇒ vitest im
     *    lặng khai XANH — đã sáu lần). ≥2 ⇒ có một hộp thoại mã dự phòng thứ hai, và nợ N-1 vừa lớn
     *    thêm một bậc: phải đọc lại chứ không phải nới con số.
     */
    const hop = hopThoaiMaDuPhong(cayCuPhap(FILE_HO_SO, MA_HO_SO));
    expect(hop.length, `không thấy hộp thoại mã dự phòng nào trong ${FILE_HO_SO} — hình dạng đã đổi`).toBe(1);
  });
});

describe("★★★★ Pha 9 I-4 §2 — TIỀN ĐỀ: mặc định của `dialog.tsx` là thứ làm lượt bỏ sót NGUY HIỂM", () => {
  it("★★★ `showCloseButton` mặc định `true`, và Esc chỉ bị chặn khi IME đang gõ", () => {
    /**
     * ⚠⚠ Không có ô này, §3 chỉ là *"ba thuộc tính phải có mặt"* — một luật không ai biết vì sao.
     *    Ô này ghim **lý do**: cả hai lối kia **mở theo mặc định**. Nếu một lượt sau đổi mặc định
     *    thành `showCloseButton = false`, ô này ĐỎ — và đó đúng là lúc phải đọc lại lưới này thay
     *    vì cập nhật một con số.
     */
    expect(
      /showCloseButton\s*=\s*true/.test(MA_DIALOG),
      `${FILE_DIALOG} không còn mặc định \`showCloseButton = true\` — tiền đề của I-4 đã đổi, đọc lại lưới`,
    ).toBe(true);
    expect(
      /isCurrentlyComposing/.test(MA_DIALOG) && /onEscapeKeyDown\?\.\(/.test(MA_DIALOG),
      `${FILE_DIALOG}: nhánh Esc đã đổi hình dạng — đọc lại lý lẽ trước khi sửa lưới này`,
    ).toBe(true);
  });
});

describe("★★★★ Pha 9 I-4 §3 — LƯỢNG TỪ: cả BA lối đóng đều bị chặn", () => {
  it("★★★★ hộp thoại mã dự phòng chặn nút X, phím Esc, và bấm ra ngoài", () => {
    const [mo] = hopThoaiMaDuPhong(cayCuPhap(FILE_HO_SO, MA_HO_SO));
    expect(mo, "cầu chì §1 phải chạy trước ô này").toBeTruthy();
    const co = thuocTinh(mo!);
    const thieu = BA_LOI_DONG.filter((t) => !co.has(t));
    expect(
      thieu,
      [
        "HỘP THOẠI 'HIỆN ĐÚNG MỘT LẦN' CÒN MỘT LỐI ĐÓNG KHÔNG BỊ CHẶN.",
        "⚠ Máy chủ ĐÃ xoá bộ mã cũ và cấp 10 mã mới trước khi hộp thoại này hiện ra. Đóng nhầm",
        "  ⇒ 10 chuỗi KHÔNG AI TỪNG ĐỌC, máy chủ chỉ giữ bản băm, và màn hình vẫn khẳng định",
        "  'số mã còn lại = 10'. Đường cấp lại nằm ở một màn hình KHÁC (nợ N-1).",
        "⇒ Truyền đủ ba: `showCloseButton={false}` · `onEscapeKeyDown={(e)=>e.preventDefault()}`",
        "  · `onInteractOutside={(e)=>e.preventDefault()}`. Lối ra duy nhất là nút 'Xong'.",
      ].join("\n"),
    ).toEqual([]);
    expect(
      tatNutX(mo!),
      "`showCloseButton` được truyền nhưng KHÔNG phải `false` tường minh ⇒ nút X vẫn render",
    ).toBe(true);
  });

  it("★★★★ §3b HIỆU CHUẨN — thước phân biệt ba nguồn dựng sẵn có ĐÁP SỐ BIẾT TRƯỚC", () => {
    /**
     * ⚠⚠⚠ Không có ô này, §3 có thể đang xanh vì bộ suy trả rỗng cho mọi thứ. Ba nguồn dưới đây
     *    gồm **đúng hình dạng đã ship** (chỉ `onInteractOutside`) — ca đã lừa được lượt review A4.
     */
    const bocMa = (thuoc: string) =>
      `export function X(){ return (<Dialog><DialogContent ${thuoc}><code>{backupCodes.map(c => c)}</code></DialogContent></Dialog>); }`;

    const daShip = hopThoaiMaDuPhong(cayCuPhap("gia.tsx", bocMa('onInteractOutside={(e) => e.preventDefault()}')));
    expect(daShip.length, "thước MÙ với chính hình dạng đã ship").toBe(1);
    expect(
      BA_LOI_DONG.filter((t) => !thuocTinh(daShip[0]!).has(t)),
      "★ CA ĐÃ LỪA ĐƯỢC LƯỢT REVIEW A4: chỉ chặn 'bấm ra ngoài' mà thước khai ĐỦ ⇒ nó không đo gì",
    ).toEqual(["showCloseButton", "onEscapeKeyDown"]);

    const du = hopThoaiMaDuPhong(
      cayCuPhap("gia.tsx", bocMa('showCloseButton={false} onEscapeKeyDown={(e)=>e.preventDefault()} onInteractOutside={(e)=>e.preventDefault()}')),
    );
    expect(BA_LOI_DONG.filter((t) => !thuocTinh(du[0]!).has(t)), "DƯƠNG TÍNH GIẢ trên hình dạng ĐÚNG").toEqual([]);
    expect(tatNutX(du[0]!), "thước không đọc được `showCloseButton={false}`").toBe(true);

    const tran = hopThoaiMaDuPhong(cayCuPhap("gia.tsx", bocMa("showCloseButton")));
    expect(
      tatNutX(tran[0]!),
      "`showCloseButton` TRẦN nghĩa là `true` (JSX) — thước khai đã tắt nút X ⇒ nó đọc TÊN, không đọc GIÁ TRỊ",
    ).toBe(false);

    const khongPhaiMaDuPhong = hopThoaiMaDuPhong(
      cayCuPhap("gia.tsx", `export function Y(){ return (<Dialog><DialogContent><p>{tenNguoiDung}</p></DialogContent></Dialog>); }`),
    );
    expect(
      khongPhaiMaDuPhong.length,
      "một hộp thoại KHÔNG chứa mã dự phòng bị kéo vào lượng từ ⇒ lưới sẽ đòi khoá mọi hộp thoại",
    ).toBe(0);
  });
});
