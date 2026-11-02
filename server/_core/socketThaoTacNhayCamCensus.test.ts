/**
 * ★★★ CENSUS AST (F5-nhanh, 2026-11-02) — MỌI handler `socket.on("<sự kiện>")` của gateway socket.io được PHÂN LOẠI; handler NHẠY CẢM
 * (ghi / điều khiển / duyệt / xác nhận / cấp thông tin xác thực / đổi trạng thái) phải XÁC THỰC LẠI chủ thể bằng
 * `xacThucLaiChoThaoTacSocket(socket)` TRƯỚC khi hành động, và đưa CHỦ THỂ MỚI (không phải `socket.data`) vào cổng quyền.
 *
 * Lỗ gốc: `socket.data.user` là ảnh chụp lúc handshake ⇒ admin bị hạ vai / tài khoản tắt / phiên thu hồi vẫn duyệt máy + nhận khoá.
 * Lớp lỗi "handler thứ N quên": một `socket.on` MỚI chưa phân loại ⇒ ĐỎ; handler xếp CHỈ-ĐỌC / VÒNG-ĐỜI mà thân có lời gọi GHI, hoặc
 * tên mang động từ nhạy cảm ⇒ ĐỎ (phải xếp NHẠY CẢM, tức phải gọi bộ xác thực lại).
 *
 * Phạm vi tệp (theo HÌNH DẠNG, không danh sách tay): tệp `server/**` (không test) có `import … from "socket.io"`, cộng mọi tệp mà
 * `socket.ts` gọi hàm đăng ký của nó với `socket` (`registerXxx(socket …)`) — vd. scadaSocket / unsStreamGateway.
 *
 * Có ĐỘT BIẾN (chạy tay, ghi trong báo cáo F5-nhanh): (a) cổng nhận lại `socket.data` (vai chụp), (b) bỏ lời gọi xác thực lại,
 * (c) thêm `socket.on("admin:xoa_may")` không xác thực lại, (d) dời lời gọi xác thực lại xuống SAU tác dụng phụ — mỗi cái ⇒ ĐỎ.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();
const rel = (p: string) => relative(GOC, p).replace(/\\/g, "/");

type Loai = "NHAY_CAM" | "CHI_DOC" | "MAY" | "VONG_DOI";
interface Muc {
  file: string;
  event: string;
  loai: Loai;
  /** Số handler cùng tên trong tệp (vd. `machine:heartbeat` khai hai lần ở hai nhánh). */
  so?: number;
  lyDo: string;
}

const BANG: Muc[] = [
  // ── NHẠY CẢM — phải xác thực lại (F5-nhanh) ──
  { file: "server/_core/socket.ts", event: "admin:approve_registration", loai: "NHAY_CAM", lyDo: "duyệt đăng ký máy + ĐÚC khoá API máy (issueMachineKey) + ghi machines" },
  { file: "server/_core/socket.ts", event: "admin:reject_registration", loai: "NHAY_CAM", lyDo: "từ chối đăng ký máy (đổi trạng thái sổ chờ, báo máy)" },
  // polish — chỉ-đọc nhưng giao dữ liệu CHỈ người quản trị đăng ký máy được thấy ⇒ cùng luật xác thực lại
  { file: "server/_core/socket.ts", event: "admin:join", loai: "NHAY_CAM", lyDo: "vào phòng admin: danh sách ĐĂNG KÝ CHỜ (mã/serial/IP máy) + mọi yêu cầu đăng ký sau đó" },
  { file: "server/_core/socket.ts", event: "admin:get_online_machines", loai: "NHAY_CAM", lyDo: "danh sách máy online của MỌI nhà máy (không lọc phạm vi) — chỉ người quản trị đăng ký máy" },
  // ── CHỈ ĐỌC — đăng ký nhận / vào phòng có cổng theo phòng (ngoài phạm vi F5-nhanh; F5 đầy đủ xử lý tính cũ của phòng) ──
  { file: "server/_core/socket.ts", event: "subscribe", loai: "CHI_DOC", lyDo: "vào phòng theo phạm vi (duocVaoPhong*) — chỉ nhận" },
  { file: "server/_core/socket.ts", event: "unsubscribe", loai: "CHI_DOC", lyDo: "rời phòng" },
  { file: "server/_core/socket.ts", event: "engineering:subscribe", loai: "CHI_DOC", lyDo: "vào phòng engineering:* (quyền + phạm vi) — chỉ nhận" },
  { file: "server/_core/socket.ts", event: "engineering:unsubscribe", loai: "CHI_DOC", lyDo: "rời phòng" },
  { file: "server/services/notificationService.ts", event: "auth:user", loai: "CHI_DOC", lyDo: "vào phòng user:{id} CỦA CHÍNH MÌNH — chỉ nhận" },
  { file: "server/services/scada/scadaSocket.ts", event: "scada:subscribe", loai: "CHI_DOC", lyDo: "đăng ký nhận tag SCADA (quyền + phạm vi mỗi lượt) — chỉ nhận" },
  { file: "server/services/scada/scadaSocket.ts", event: "scada:unsubscribe", loai: "CHI_DOC", lyDo: "huỷ đăng ký" },
  { file: "server/services/stateStore/unsStreamGateway.ts", event: "uns:subscribe", loai: "CHI_DOC", lyDo: "đăng ký nhận luồng UNS — chỉ nhận" },
  { file: "server/services/stateStore/unsStreamGateway.ts", event: "uns:unsubscribe", loai: "CHI_DOC", lyDo: "huỷ đăng ký" },
  // ── MÁY — xác thực bằng THÔNG TIN XÁC THỰC MÁY (apiKey / mk_), không dùng vai người dùng ──
  { file: "server/_core/socket.ts", event: "machine:register", loai: "MAY", lyDo: "máy vô danh XIN đăng ký (chỉ vào sổ chờ; duyệt là admin:approve_registration)" },
  { file: "server/_core/socket.ts", event: "machine:heartbeat", loai: "MAY", so: 2, lyDo: "nhịp tim máy (xacDinhMaySuKien / máy đã gắn)" },
  { file: "server/_core/socket.ts", event: "machine:confirm_mapping", loai: "MAY", so: 2, lyDo: "máy xác nhận ánh xạ bằng khoá máy" },
  { file: "server/_core/socket.ts", event: "machine:request_config", loai: "MAY", lyDo: "máy xin cấu hình bằng khoá máy" },
  { file: "server/_core/socket.ts", event: "machine:sync_started", loai: "MAY", lyDo: "máy báo bắt đầu đồng bộ bằng khoá máy" },
  // ── VÒNG ĐỜI ──
  { file: "server/_core/socket.ts", event: "disconnect", loai: "VONG_DOI", so: 2, lyDo: "dọn tài nguyên khi rớt" },
  { file: "server/services/notificationService.ts", event: "disconnect", loai: "VONG_DOI", lyDo: "dọn sổ userSockets" },
  { file: "server/services/scada/scadaSocket.ts", event: "disconnect", loai: "VONG_DOI", lyDo: "dọn đăng ký SCADA" },
  { file: "server/services/stateStore/unsStreamGateway.ts", event: "disconnect", loai: "VONG_DOI", lyDo: "dọn đăng ký UNS" },
];

const HAM_XAC_THUC_LAI = "xacThucLaiChoThaoTacSocket";
const CONG_QUYEN = ["duocQuanLyDangKyMay", "duocTuChoiDangKyMay", "laSocketNguoiDung", "checkPermission", "duocVaoPhongNguoiDung"];
/** Lời gọi GHI / tác dụng phụ (theo hình dạng) — không được có trong handler CHỈ_ĐỌC / VÒNG_ĐỜI, và không được đứng TRƯỚC xác thực lại. */
const GHI = /\b(?:issueMachineKey|logCrudOperation|(?:db|tx)\.(?:insert|update|delete)\b|db\.(?:update|create|insert|delete|upsert|set)\w*|pendingRegistrations\.(?:set|delete))\s*\(/;
const TAC_DUNG = /\b(?:issueMachineKey|logCrudOperation|db\.\w+|pendingRegistrations\.\w+|io\??\.to|socket\.emit|socket\.join)\s*\(/;
/** Động từ nhạy cảm trong TÊN sự kiện ⇒ chỉ được xếp NHẠY CẢM (hoặc MÁY nếu là `machine:*`). */
const DONG_TU_NHAY_CAM = /approve|reject|confirm|issue|revoke|grant|write|command|control|delete|remove|update|create|set_|ack|stop|start|reset|force/i;

function liet(dir: string, out: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    if (ten === "node_modules") continue;
    const p = resolve(dir, ten);
    const st = statSync(p);
    if (st.isDirectory()) liet(p, out);
    else if (/\.ts$/.test(ten) && !/\.test\.ts$/.test(ten) && !/\.d\.ts$/.test(ten)) out.push(p);
  }
  return out;
}
const parse = (p: string) => ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true);

function tepGateway(): string[] {
  const tat = liet(resolve(GOC, "server"));
  const chon = new Set<string>();
  for (const p of tat) {
    const sf = parse(p);
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === "socket.io") chon.add(p);
    }
  }
  // Hàm đăng ký mà socket.ts gọi với `socket`: resolve nguồn import của nó.
  const socketTs = resolve(GOC, "server/_core/socket.ts");
  const sf = parse(socketTs);
  const nguon = new Map<string, string>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const e of st.importClause.namedBindings.elements) nguon.set(e.name.text, st.moduleSpecifier.text);
    }
  }
  const tham = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^register\w+/.test(n.expression.text)) {
      const a0 = n.arguments[0];
      const laSocket = a0 && (ts.isIdentifier(a0) ? a0.text === "socket" : ts.isAsExpression(a0) && ts.isIdentifier(a0.expression) && a0.expression.text === "socket");
      const src = nguon.get(n.expression.text);
      if (laSocket && src?.startsWith(".")) chon.add(resolve(dirname(socketTs), src + ".ts"));
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return [...chon];
}

/**
 * `socket` ở đây là một `net.Socket` CỤC BỘ (`const socket = new net.Socket()` — vd. hàm thử kết nối TCP trong socket.ts) chứ không
 * phải socket.io? Leo lên phạm vi: gặp THAM SỐ tên `socket` trước ⇒ socket.io (giữ); gặp khai báo `const socket = new …` ⇒ bỏ.
 */
function laSocketMangCucBo(n: ts.Node): boolean {
  for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
    if (ts.isFunctionLike(a) && a.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === "socket")) return false;
    if (ts.isBlock(a) || ts.isSourceFile(a)) {
      for (const st of a.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === "socket" && d.initializer && ts.isNewExpression(d.initializer)) return true;
        }
      }
    }
  }
  return false;
}

/** Có đọc `socket.data.user` (bản chụp handshake) không — theo AST (bỏ qua chú thích), chịu được `(socket.data as any)?.user`. */
function docUserChup(fn: ts.Node, sf: ts.SourceFile): boolean {
  let co = false;
  const boc = (e: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    return e;
  };
  const di = (x: ts.Node) => {
    if (ts.isPropertyAccessExpression(x) && x.name.text === "user" && boc(x.expression).getText(sf).replace(/\s+/g, "") === "socket.data") co = true;
    ts.forEachChild(x, di);
  };
  di(fn);
  return co;
}

interface Handler {
  file: string;
  event: string;
  fn: ts.Node;
  sf: ts.SourceFile;
}
function thuHandler(): Handler[] {
  const out: Handler[] = [];
  for (const p of tepGateway()) {
    const sf = parse(p);
    const di = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "on" &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "socket" &&
        n.arguments.length >= 2 &&
        ts.isStringLiteralLike(n.arguments[0]) &&
        !laSocketMangCucBo(n)
      ) {
        out.push({ file: rel(p), event: (n.arguments[0] as ts.StringLiteralLike).text, fn: n.arguments[1], sf });
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return out;
}

/** Mọi lời gọi `ten(...)` trong một nút. */
function goi(n: ts.Node, ten: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const di = (x: ts.Node) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === ten) out.push(x);
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === ten) out.push(x);
    ts.forEachChild(x, di);
  };
  di(n);
  return out;
}

const HANDLERS = thuHandler();
const khoa = (f: string, e: string) => `${f} :: ${e}`;

describe("★★★ F5-nhanh — census handler socket nhạy cảm", () => {
  it("thiết bị đo tự canh: thấy ≥ 4 tệp gateway và đúng các handler đã biết (không phải lưới rỗng)", () => {
    const tep = new Set(HANDLERS.map((h) => h.file));
    expect([...tep].sort()).toEqual(
      expect.arrayContaining([
        "server/_core/socket.ts",
        "server/services/notificationService.ts",
        "server/services/scada/scadaSocket.ts",
        "server/services/stateStore/unsStreamGateway.ts",
      ]),
    );
    expect(HANDLERS.some((h) => h.event === "admin:approve_registration")).toBe(true);
    // driver TCP (net.Socket `socket.on("data")`) KHÔNG lọt vào: phạm vi theo import socket.io / hàm đăng ký
    expect(HANDLERS.some((h) => h.event === "data")).toBe(false);
  });

  it("MỌI handler đều được phân loại đúng số lượng; mục mồ côi ⇒ ĐỎ", () => {
    const dem = new Map<string, number>();
    for (const h of HANDLERS) dem.set(khoa(h.file, h.event), (dem.get(khoa(h.file, h.event)) ?? 0) + 1);
    const chuaPhanLoai = [...dem.keys()].filter((k) => !BANG.some((m) => khoa(m.file, m.event) === k));
    expect(chuaPhanLoai, "socket.on MỚI chưa phân loại — xếp vào BANG (NHAY_CAM thì phải gọi xacThucLaiChoThaoTacSocket)").toEqual([]);
    const sai = BANG.filter((m) => (dem.get(khoa(m.file, m.event)) ?? 0) !== (m.so ?? 1)).map(
      (m) => `${khoa(m.file, m.event)}: khai ${m.so ?? 1}, thấy ${dem.get(khoa(m.file, m.event)) ?? 0}`,
    );
    expect(sai).toEqual([]);
  });

  it("handler NHẠY CẢM: gọi xacThucLaiChoThaoTacSocket(socket) TRƯỚC mọi tác dụng phụ; cổng quyền nhận CHỦ THỂ MỚI, không bao giờ socket.data", () => {
    const loi: string[] = [];
    for (const m of BANG.filter((x) => x.loai === "NHAY_CAM")) {
      const hs = HANDLERS.filter((h) => h.file === m.file && h.event === m.event);
      for (const h of hs) {
        const k = khoa(m.file, m.event);
        const xtl = goi(h.fn, HAM_XAC_THUC_LAI);
        if (xtl.length === 0) {
          loi.push(`${k}: KHÔNG gọi ${HAM_XAC_THUC_LAI}`);
          continue;
        }
        const viTriXtl = Math.min(...xtl.map((c) => c.getStart(h.sf)));
        const thanTxt = h.fn.getText(h.sf);
        const goc = h.fn.getStart(h.sf);
        const re = new RegExp(TAC_DUNG.source, "g");
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(thanTxt))) {
          if (goc + mm.index < viTriXtl) loi.push(`${k}: tác dụng phụ '${mm[0]}' đứng TRƯỚC xác thực lại`);
        }
        for (const ten of CONG_QUYEN) {
          for (const c of goi(h.fn, ten)) {
            const a0 = c.arguments[0]?.getText(h.sf).replace(/\s+/g, "") ?? "";
            if (/^socket\.data\b/.test(a0) || /^\(socket\.dataas\w+\)/.test(a0)) loi.push(`${k}: cổng ${ten} nhận vai CHỤP (${a0})`);
            if (c.getStart(h.sf) < viTriXtl) loi.push(`${k}: cổng ${ten} chạy TRƯỚC xác thực lại`);
          }
        }
        if (docUserChup(h.fn, h.sf)) loi.push(`${k}: đọc socket.data.user (bản chụp) trong handler nhạy cảm`);
      }
    }
    expect(loi).toEqual([]);
  });

  it("handler CHỈ_ĐỌC không có lời gọi GHI; VÒNG_ĐỜI chỉ là disconnect; tên mang động từ nhạy cảm chỉ được là NHẠY_CẢM (hoặc MÁY cho machine:*)", () => {
    const loi: string[] = [];
    for (const h of HANDLERS) {
      const m = BANG.find((x) => x.file === h.file && x.event === h.event);
      if (!m) continue; // ca trên đã đỏ
      if (m.loai === "CHI_DOC" && GHI.test(h.fn.getText(h.sf))) {
        loi.push(`${khoa(h.file, h.event)}: xếp ${m.loai} nhưng thân có lời gọi GHI — xếp NHAY_CAM và gọi ${HAM_XAC_THUC_LAI}`);
      }
      if (DONG_TU_NHAY_CAM.test(h.event) && m.loai !== "NHAY_CAM" && !(m.loai === "MAY" && h.event.startsWith("machine:"))) {
        loi.push(`${khoa(h.file, h.event)}: tên mang động từ nhạy cảm nhưng xếp ${m.loai}`);
      }
      // VÒNG_ĐỜI = chỉ `disconnect` (không do payload kích hoạt; dọn sổ chờ / log offline của CHÍNH socket là hợp lệ).
      if (m.loai === "VONG_DOI" && h.event !== "disconnect") loi.push(`${khoa(h.file, h.event)}: loại VÒNG_ĐỜI chỉ dành cho disconnect`);
      if (m.loai === "MAY" && !h.event.startsWith("machine:")) loi.push(`${khoa(h.file, h.event)}: loại MÁY chỉ dành cho machine:*`);
      if (m.loai === "MAY" && CONG_QUYEN.some((c) => goi(h.fn, c).length > 0)) {
        loi.push(`${khoa(h.file, h.event)}: handler MÁY lại dùng cổng vai người dùng — nếu có thao tác người dùng, xếp NHAY_CAM`);
      }
    }
    expect(loi).toEqual([]);
  });
});
