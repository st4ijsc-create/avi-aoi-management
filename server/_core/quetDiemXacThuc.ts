/**
 * ★★★★ Pha 8 — **BỘ NHẬN DIỆN "ĐIỂM XÁC THỰC": MỘT CHỦ, NHIỀU LƯỚI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — "N+1 BỘ SUY" LÀ LỚP LỖI ĐÃ ĐẺ BA CRITICAL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bộ nhận diện này sinh ra trong `server/_core/buocDoiMatKhauMoiBeMat.test.ts` (Pha 8 Task 1) để
 * trả lời **một** câu: *"chỗ nào trong `server/**` phân giải danh tính của một yêu cầu?"*.
 * Review TOÀN NHÁNH lượt thứ MƯỜI (C-1) tìm ra rằng **một bất biến THỨ HAI** cần đúng tập ấy —
 * *"phiên đã thu hồi thì không đi tiếp được"* — và nếu tập ấy được suy lại lần thứ hai ở một file
 * khác thì **bản yếu hơn quyết định lưới nào đỏ**, đúng cơ chế đã đẻ ba Critical trong chuỗi pha
 * này (Pha 5 C-1 · Pha 7 C-2 · Pha 8 I-1).
 * ⇒ Thân bộ suy chuyển về đây, **một chủ**; hai lưới gọi cùng một hàm với **hai vị từ khác nhau**.
 *
 * ⚠ Đây là **mã sản xuất** (không phải `*.test.ts`) đúng vì lý do trên: `laFileTest()` loại mọi
 *   `*.test.ts` khỏi phạm vi quét, nên một bộ suy dùng chung **không thể** sống trong một file test
 *   mà không kéo theo một lượt nhập chéo giữa hai file test (vitest sẽ đăng ký trùng suite).
 *
 * ⚠ File này **không** import gì của tầng chạy (`sdk`, `db`, `express`). Nó chỉ đọc AST, nên kéo nó
 *   vào một lưới **không** kéo theo một lượt nối DB.
 */
import ts from "typescript";

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * TÊN — mỗi cái là một sự thật của kho mã, khai ở ĐÚNG MỘT chỗ.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Phép phân giải *"yêu cầu này là ai"* — **ĐIỂM CHUNG**. */
export const TEN_XAC_THUC = "authenticateRequest";
/** Nửa "phân giải danh tính THÔ" của điểm chung — nơi phép tra sổ phiên đứng. */
export const TEN_XAC_THUC_THO = "xacThucTho";
/** Phép phân giải *"cookie/token này là phiên của ai"* — đường **vòng qua** điểm chung. */
export const TEN_PHAN_GIAI_PHIEN = "verifySession";
/** Phép chặn của cổng BUỘC-ĐỔI-MẬT-KHẨU (Pha 8 Task 1). */
export const TEN_PHEP_CHAN = "chanNeuPhaiDoiMatKhau";
/** Phép chặn của cổng THU HỒI PHIÊN (review TOÀN NHÁNH Pha 8 · C-1). */
export const TEN_PHEP_CHAN_PHIEN = "chanNeuPhienDaThuHoi";
/** Ô tắt cổng buộc-đổi-mật-khẩu ở lượt gọi `authenticateRequest`. */
export const O_BO_QUA = "boQuaCongDoiMatKhau";
/** File khai điểm chung. */
export const FILE_DIEM_CHUNG = "server/_core/sdk.ts";

export type DiemXacThuc = {
  duong: string;
  dong: number;
  /** `xt` = qua điểm chung · `phien` = tự phân giải phiên (vòng qua điểm chung). */
  loai: "xt" | "phien";
  /** Lượt gọi có **tắt** cổng buộc-đổi-mật-khẩu bằng ô `boQuaCongDoiMatKhau` không. */
  boQua: boolean;
  /** Thân hàm bao quanh có **tự** gọi phép chặn buộc-đổi-mật-khẩu không. */
  tuCanh: boolean;
  /**
   * Thân hàm bao quanh có **tự** gọi phép chặn THU HỒI PHIÊN không.
   * ⚠ Trục này độc lập với `tuCanh`: một bề mặt có thể kiểm cờ mật khẩu mà **không** tra sổ phiên —
   *   đó đúng là lỗ C-1 (58 tuyến `/api/external/*`), nơi Task 1 vá một nửa và để hở nửa kia.
   */
  tuTraSo: boolean;
};

/** Định danh của một lượt gọi: `a.b.c(x)` → `c`; `c(x)` → `c`. */
function tenGoi(n: ts.CallExpression): string | null {
  if (ts.isPropertyAccessExpression(n.expression)) return n.expression.name.text;
  if (ts.isIdentifier(n.expression)) return n.expression.text;
  return null;
}

/** Bên nhận của một lượt gọi `x.f()` → `x` (hoặc `null`). */
function benNhan(n: ts.CallExpression): ts.Node | null {
  return ts.isPropertyAccessExpression(n.expression) ? n.expression.expression : null;
}

export function quetDiemXacThuc(duong: string, ma: string): DiemXacThuc[] {
  const src = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
  const ra: DiemXacThuc[] = [];
  const dongCua = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;

  /** Thân hàm gần nhất bao quanh `n` có gọi `tenHam` không? */
  const thanCoGoi = (n: ts.Node, tenHam: string): boolean => {
    let than: ts.Node | undefined = n.parent;
    while (than !== undefined && !ts.isFunctionLike(than)) than = than.parent;
    if (than === undefined) return false;
    let thay = false;
    const tim = (x: ts.Node): void => {
      if (thay) return;
      if (ts.isCallExpression(x) && tenGoi(x) === tenHam) {
        thay = true;
        return;
      }
      x.forEachChild(tim);
    };
    than.forEachChild(tim);
    return thay;
  };

  /** Lượt gọi có tắt cổng không: đối số thứ 2 mang ô `boQuaCongDoiMatKhau`. */
  const coTatCong = (n: ts.CallExpression): boolean => {
    const a = n.arguments[1];
    if (a === undefined) return false;
    if (!ts.isObjectLiteralExpression(a)) return true; // không đọc được ⇒ coi như TẮT (bảo thủ)
    for (const p of a.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const ten = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      if (ten !== O_BO_QUA) continue;
      // `false` tường minh KHÔNG phải một lượt tắt; mọi thứ khác (kể cả biến) thì có.
      return p.initializer.kind !== ts.SyntaxKind.FalseKeyword;
    }
    return false;
  };

  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const t = tenGoi(n);
      if (t === TEN_XAC_THUC || t === TEN_PHAN_GIAI_PHIEN) {
        // ⚠ `this.verifySession(...)` bên trong chính lớp khai nó **không** là một bề mặt — đó là
        //    một mắt xích nội bộ của điểm chung. Nhận diện bằng HÌNH DẠNG (`this`), không bằng một
        //    danh sách file được tha.
        const bn = benNhan(n);
        const laTuGoi = bn !== null && bn.kind === ts.SyntaxKind.ThisKeyword;
        if (!laTuGoi) {
          ra.push({
            duong,
            dong: dongCua(n),
            loai: t === TEN_XAC_THUC ? "xt" : "phien",
            boQua: t === TEN_XAC_THUC ? coTatCong(n) : true, // đường `phien` KHÔNG đi qua điểm chung
            tuCanh: thanCoGoi(n, TEN_PHEP_CHAN),
            tuTraSo: thanCoGoi(n, TEN_PHEP_CHAN_PHIEN),
          });
        }
      }
    }
    n.forEachChild(di);
  };
  di(src);
  return ra;
}

/**
 * Thân của phương thức/hàm tên `tenPhuongThuc` (khai trong `ma`) có gọi `tenHam` không.
 *
 * ⚠ Đây là mắt xích khiến **mọi** bề mặt đi qua điểm chung được phủ mà không ai phải sửa N chỗ.
 *   Gỡ dòng ấy ⇒ toàn bộ lượng từ tương ứng đỏ cùng lúc, đúng như nó phải thế.
 */
export function thanPhuongThucGoi(ma: string, tenPhuongThuc: string, tenHam: string): boolean {
  const src = ts.createSourceFile(FILE_DIEM_CHUNG, ma, ts.ScriptTarget.Latest, true);
  let ok = false;
  const tim = (n: ts.Node): void => {
    if (ok) return;
    if (
      (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) &&
      n.name !== undefined &&
      ts.isIdentifier(n.name) &&
      n.name.text === tenPhuongThuc &&
      n.body !== undefined
    ) {
      const tim2 = (x: ts.Node): void => {
        if (ok) return;
        if (ts.isCallExpression(x) && tenGoi(x) === tenHam) {
          ok = true;
          return;
        }
        x.forEachChild(tim2);
      };
      n.body.forEachChild(tim2);
    }
    n.forEachChild(tim);
  };
  tim(src);
  return ok;
}

/** ĐIỂM CHUNG có cưỡng chế cổng **buộc-đổi-mật-khẩu** không. */
export function diemChungCuongChe(ma: string): boolean {
  return thanPhuongThucGoi(ma, TEN_XAC_THUC, TEN_PHEP_CHAN);
}

/**
 * ĐIỂM CHUNG có cưỡng chế cổng **thu hồi phiên** không.
 *
 * ⚠ Phép tra sổ đứng ở `xacThucTho` (nửa *"phân giải danh tính"*), **không** ở `authenticateRequest`
 *   — vì `xacThucTho` là nơi duy nhất cầm `sessionCookie`. Hỏi sai phương thức ⇒ thước khai `false`
 *   trong khi cưỡng chế vẫn đang chạy: đúng lớp *"màu đỏ nói dối"*.
 */
export function diemChungTraSo(ma: string): boolean {
  return thanPhuongThucGoi(ma, TEN_XAC_THUC_THO, TEN_PHEP_CHAN_PHIEN);
}
