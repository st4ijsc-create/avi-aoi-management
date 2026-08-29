/**
 * ★★★ BỘ SUY **"CỬA NÀY CÓ ĐI QUA ĐIỂM QUYẾT ĐỊNH PHIÊN BẢN NGEST KHÔNG"** — Pha 1C Task 3
 * (BG-21 ⛔ + BG-31), dùng cho `server/routers/cuaIngestCensus.test.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO QUÉT TRÊN CÂY (AST), KHÔNG TRÊN VĂN BẢN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bài học BG-16 (spec §13): lưới BG-14 dùng regex trên văn bản nguồn và XANH GIẢ vì nó soi đúng
 * dòng của một nhánh KHÔNG liên quan — trong khi lỗ thật nằm ở nhánh thứ hai mà regex không biết
 * tới. `quyetDinhPhienBanIngest` (`server/routers/machineApiRouters.ts`) không phải lúc nào cũng
 * được gọi TRỰC TIẾP trong thân một thủ tục: `submitInspection` gọi nó bên trong
 * `submitInspectionRouterInputSchema` — một `const` cấp module KHÁC, chỉ được THAM CHIẾU bằng
 * identifier tại `.input(submitInspectionRouterInputSchema)`. Một regex "có xuất hiện chữ
 * `quyetDinhPhienBanIngest` trong đoạn văn bản của thủ tục không" sẽ MÙ với hình dạng này (đúng
 * lớp lỗi BG-16 tái diễn qua một cửa khác) vì chữ đó không nằm trong đoạn văn bản của
 * `submitInspection`, nó nằm ở một `const` khác phía trên.
 *
 * ⇒ Bộ suy này đi trên CÂY: với mỗi cửa, nó duyệt subtree của property-initializer, và khi gặp một
 *   IDENTIFIER trỏ tới một khai báo CẤP FILE khác (`const X = …` / `function X() {…}`), nó MỞ RỘNG
 *   sang subtree của khai báo đó — một phép bao đóng CÓ ĐIỀU KIỆN (không lặp lại một tên hai lần),
 *   dừng khi không còn gì mới. Đây là dạng thu gọn của "bao đóng NGƯỢC" đã dùng ở
 *   `deployProcedureScan.ts#quetLenhPhaHuyVram` — cùng kỷ luật, phạm vi hẹp hơn (một file).
 *
 * ⚠ GIỚI HẠN ĐÃ BIẾT: đây là quan hệ TỚI ĐƯỢC (reachable), không phải "chắc chắn được gọi trên MỌI
 *   đường thực thi". Một cửa tham chiếu `quyetDinhPhienBanIngest` trong một nhánh `if` không bao
 *   giờ chạy vẫn được tính là "đã gác". Đủ cho mục tiêu của lưới này (bắt cửa KHÔNG NHẮC TỚI điểm
 *   quyết định lấy nửa vời nào cả), không đủ để chứng minh gọi VÔ ĐIỀU KIỆN — điều đó cần review
 *   mã bằng mắt cho hai cửa `gac` mà census xác nhận đứng đắn (xem §4 của lưới census).
 *
 * ── NHẬN DIỆN "CỬA INGEST" — VỊ TỪ, KHÔNG PHẢI DANH SÁCH TÊN ──────────────────────────────────
 * Repo này đặt tên nhất quán cho cửa nhận dữ liệu TỪ MÁY: `submit*` (submitInspection,
 * submitInspectionBatch, submitProcessResult, submitProcessResultBatch) và `sync*Result*`
 * (syncEdgeResults) — phân biệt được với các cửa `sync*` KHÁC không nhận kết quả đo
 * (syncMeasurementPoints, syncProductImage, syncPointImage, deltaSyncPoints — đồng bộ CẤU HÌNH/ẢNH
 * MẪU, không phải dữ liệu kiểm tra). Đây là tín hiệu CẤU TRÚC duy nhất còn lại trong mã hôm nay để
 * phân biệt "cửa nhận kết quả kiểm tra" khỏi hàng chục thủ tục `machineApiRouter` khác (heartbeat,
 * key rotation, config pull, deployment confirm…) — tất cả đều gọi `authenticateMachine`, nên
 * "gọi authenticateMachine" KHÔNG phải một vị từ phân biệt được. Vị từ này hỏi trên TÊN THUỘC TÍNH
 * (một node AST, không phải một chuỗi con của toàn văn bản file) — khác về CHẤT với việc chạy regex
 * trên toàn bộ nội dung file như BG-14 đã làm.
 */
import ts from "typescript";

/** Tên hàm quyết định phiên bản ingest DÙNG CHUNG, khai ở `machineApiRouters.ts`. */
export const TEN_HAM_QUYET_DINH = "quyetDinhPhienBanIngest";

/** Tên biến giữ `router({…})` của máy — mục tiêu quét. */
export const TEN_BIEN_ROUTER = "machineApiRouter";

/** Một cửa nhận dữ liệu kiểm tra từ máy, tìm thấy trong `machineApiRouter`. */
export interface CuaIngest {
  readonly ten: string;
  readonly dong: number;
  readonly loai: "query" | "mutation" | "subscription";
  /** Subtree của cửa này có TỚI ĐƯỢC một lời gọi `quyetDinhPhienBanIngest(...)` không. */
  readonly quaDiemQuyetDinh: boolean;
}

export interface KetQuaQuetCuaIngest {
  readonly cua: readonly CuaIngest[];
  /** Ô KHÔNG phân giải được — mỗi mục là một chỗ KHÔNG AI CANH ⇒ lưới phải ĐỎ. */
  readonly mu: readonly string[];
}

/** Cửa nhận dữ liệu kiểm tra từ máy, nhận theo TÊN THUỘC TÍNH — xem khối lý lẽ ở đầu file. */
function laTenCuaIngest(ten: string): boolean {
  return /^submit/i.test(ten) || /^sync.*result/i.test(ten);
}

/** `router({…})` của một biểu thức lời gọi — bỏ qua, không cần theo `.use()` bọc ngoài (không có ở đây). */
function objRouter(n: ts.Node): ts.ObjectLiteralExpression | null {
  if (
    ts.isCallExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === "router" &&
    n.arguments[0] !== undefined &&
    ts.isObjectLiteralExpression(n.arguments[0])
  ) {
    return n.arguments[0];
  }
  return null;
}

/** Loại thủ tục tRPC của một chuỗi (`…query(fn)` / `…mutation(fn)` / `…subscription(fn)`). */
function loaiThuTuc(n: ts.Node): CuaIngest["loai"] | null {
  let loai: CuaIngest["loai"] | null = null;
  const di = (x: ts.Node): void => {
    if (loai === null && ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
      const m = x.expression.name.text;
      if ((m === "query" || m === "mutation" || m === "subscription") && x.arguments[0] !== undefined) loai = m;
    }
    ts.forEachChild(x, di);
  };
  di(n);
  return loai;
}

/**
 * Một lượt quét MỘT cây con: có lời gọi `quyetDinhPhienBanIngest(...)` TRỰC TIẾP trong subtree
 * này không, và tập ĐỊNH DANH nào xuất hiện (bỏ tên thuộc tính `.x` / khoá object `{x: …}` — chúng
 * KHÔNG phải một ràng buộc tên, chép đúng kỷ luật `dinhDanhTrong` của `deployProcedureScan.ts`).
 */
function quetMotCay(n: ts.Node): { goiTrucTiep: boolean; dinhDanh: ReadonlySet<string> } {
  let goiTrucTiep = false;
  const dinhDanh = new Set<string>();
  const di = (x: ts.Node): void => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === TEN_HAM_QUYET_DINH) {
      goiTrucTiep = true;
    }
    if (ts.isPropertyAccessExpression(x)) {
      di(x.expression);
      return;
    }
    if ((ts.isPropertyAssignment(x) || ts.isPropertySignature(x)) && x.name !== undefined) {
      if (ts.isPropertyAssignment(x)) di(x.initializer);
      return;
    }
    if (ts.isIdentifier(x)) dinhDanh.add(x.text);
    ts.forEachChild(x, di);
  };
  di(n);
  return { goiTrucTiep, dinhDanh };
}

/**
 * Bao đóng CÓ ĐIỀU KIỆN từ `root`: có TỚI ĐƯỢC một lời gọi `quyetDinhPhienBanIngest` không, đi
 * qua các khai báo CẤP FILE mà `root` (hoặc bất kỳ khai báo nào mở rộng ra từ nó) tham chiếu tới.
 */
function coDuongToiQuyetDinh(root: ts.Node, khaiBao: ReadonlyMap<string, ts.Node>): boolean {
  const daTham = new Set<string>();
  const hangDoi: ts.Node[] = [root];
  let i = 0;
  while (i < hangDoi.length) {
    const node = hangDoi[i++];
    if (node === undefined) continue;
    const { goiTrucTiep, dinhDanh } = quetMotCay(node);
    if (goiTrucTiep) return true;
    for (const id of dinhDanh) {
      if (daTham.has(id)) continue;
      daTham.add(id);
      const khai = khaiBao.get(id);
      if (khai !== undefined) hangDoi.push(khai);
    }
  }
  return false;
}

/**
 * Quét `ma` (nội dung file `machineApiRouters.ts`, TRUYỀN VÀO chứ không tự đọc đĩa — cho phép lưới
 * census chạy lại bộ suy này trên một biến thể ĐÃ CHÈN đột biến, hoàn toàn TRONG BỘ NHỚ, không ghi
 * đè file thật) và trả mọi cửa `submit*`/`sync*Result*` trong `machineApiRouter`.
 *
 * @param duong đường hiển thị trong lỗi (không cần là đường thật trên đĩa).
 * @param ma nội dung mã nguồn TypeScript.
 */
export function quetCuaIngest(duong: string, ma: string): KetQuaQuetCuaIngest {
  const mu: string[] = [];
  const sf = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** Mọi khai báo CẤP FILE (const/function) — tên → subtree khởi tạo/thân. */
  const khaiBao = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer !== undefined) khaiBao.set(d.name.text, d.initializer);
      }
    } else if (ts.isFunctionDeclaration(st) && st.name !== undefined && st.body !== undefined) {
      khaiBao.set(st.name.text, st.body);
    }
  }

  let routerObj: ts.ObjectLiteralExpression | null = null;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === TEN_BIEN_ROUTER && d.initializer !== undefined) {
        routerObj = objRouter(d.initializer);
      }
    }
  }
  if (routerObj === null) {
    mu.push(`${duong} — không tìm thấy \`const ${TEN_BIEN_ROUTER} = router({…})\` — bộ suy mất mục tiêu`);
    return { cua: [], mu };
  }

  const cua: CuaIngest[] = [];
  for (const p of routerObj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const ten = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    if (ten === null || !laTenCuaIngest(ten)) continue;
    const loai = loaiThuTuc(p.initializer);
    if (loai === null) continue; // khớp tên nhưng không phải một thủ tục tRPC thật
    const dong = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
    cua.push({ ten, dong, loai, quaDiemQuyetDinh: coDuongToiQuyetDinh(p.initializer, khaiBao) });
  }

  return { cua, mu };
}
