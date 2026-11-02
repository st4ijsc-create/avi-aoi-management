/**
 * ★★★ CENSUS AST (F5 đầy đủ, 2026-11-02) — bốn bất biến của "socket sống mất cái người dùng đã mất".
 *
 *   (1) PHÁT: KHÔNG mã nào phát sự kiện vào phòng điều khiển `kiem:*` (`kiem:user:{id}` / `kiem:phien:{id}` chỉ để NGẮT) — một sự kiện ở đó
 *       tới MỌI tab của một người / một phiên mà không qua cổng phòng nào.
 *   (2) PHÒNG: handler `io.on("connection")` của socket.ts vào CẢ HAI phòng điều khiển cho mọi socket trình duyệt (`laSocketNguoiDung`) —
 *       thiếu một ⇒ thông báo của người / phiên đó không ngắt được gì.
 *   (3) PHÒNG `admin`: không `io.to("admin").emit` / `io.in("admin").emit` ở đâu cả — mọi sự kiện phòng `admin` đi qua
 *       `phatPhongAdminTheoPhamVi` (lọc theo phạm vi TỪNG người nhận).
 *   (4) NGƯỜI GHI: tập bảng có trigger `socket_pham_vi` (đọc từ drizzle/0435_socket_pham_vi.sql) ⊇ tập bảng mà các bộ phân giải quyền /
 *       phạm vi / danh tính ĐỌC — `resolveTenantFactoryScope`, `getUserAssignmentCodes`, `checkPermission`, và lượt xác thực của sdk
 *       (`authenticateRequest` → `xacThucTho` + các cổng `chanNeu*`). Dò theo HÌNH DẠNG (AST: `.from/.insert/.update/.delete/…Join(<bảng schema>)`
 *       + SQL thô, đi theo hàm được gọi trong server/db + accessControl + sdk), KHÔNG theo danh sách tay. Một bảng phạm vi MỚI được đọc mà
 *       không có trigger ⇒ ĐỎ (đổi ở bảng ấy sẽ không ngắt socket nào).
 * Có ĐỘT BIẾN cho cả bốn (khối cuối).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();
const rel = (p: string) => relative(GOC, p).replace(/\\/g, "/");
const doc = (r: string) => readFileSync(resolve(GOC, r), "utf8");
const parse = (file: string, src: string) => ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);

function tepServer(): string[] {
  const out: string[] = [];
  const di = (dir: string) => {
    for (const ten of readdirSync(dir)) {
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = resolve(dir, ten);
      const st = statSync(p);
      if (st.isDirectory()) di(p);
      else if (/\.ts$/.test(ten) && !/\.(test|spec|d)\.ts$/.test(ten)) out.push(p);
    }
  };
  di(resolve(GOC, "server"));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (1) + (3) — điểm phát bị cấm
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export interface ViPhamPhatKiem {
  file: string;
  dong: number;
  dang: string;
}
/** Mọi `.emit(...)` mà chuỗi bộ nhận chứa `.to(X)` / `.in(X)` với X là phòng điều khiển (`kiem:` / `phongKiem*`) hoặc phòng `"admin"`. */
export function quetPhatKiem(src: string, file: string): ViPhamPhatKiem[] {
  const sf = parse(file, src);
  const out: ViPhamPhatKiem[] = [];
  const laPhongKiem = (e: ts.Expression) => /kiem:|phongKiem(Nguoi|Phien)/.test(e.getText(sf));
  const laAdmin = (e: ts.Expression) => ts.isStringLiteralLike(e) && e.text === "admin";
  const duyet = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "emit") {
      let cur: ts.Expression = n.expression.expression;
      while (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur) || ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) {
        if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression) && ["to", "in", "except"].includes(cur.expression.name.text)) {
          for (const a of cur.arguments) {
            const dong = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            if (laPhongKiem(a)) out.push({ file, dong, dang: `phát vào phòng điều khiển ${a.getText(sf)}` });
            if (laAdmin(a) && cur.expression.name.text !== "except") out.push({ file, dong, dang: `phát thẳng vào phòng "admin" (không theo phạm vi người nhận)` });
          }
        }
        cur = ts.isCallExpression(cur) ? cur.expression : ts.isPropertyAccessExpression(cur) ? cur.expression : (cur as ts.NonNullExpression | ts.ParenthesizedExpression).expression;
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (2) — handler connection vào cả hai phòng điều khiển, dưới laSocketNguoiDung
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function phongKiemLucNoi(src: string): { nguoi: boolean; phien: boolean; duoiCong: boolean } {
  const sf = parse("server/_core/socket.ts", src);
  let ketQua = { nguoi: false, phien: false, duoiCong: false };
  const duyet = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "on" &&
      n.expression.expression.getText(sf) === "io" && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text === "connection"
    ) {
      const fn = n.arguments[1];
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.body && ts.isBlock(fn.body)) {
        // chỉ câu lệnh CẤP ĐẦU của handler (không vào handler `socket.on(...)` con)
        for (const st of fn.body.statements) {
          if (!ts.isIfStatement(st) || !/^laSocketNguoiDung\(socket\.data\)$/.test(st.expression.getText(sf))) continue;
          const t = st.thenStatement.getText(sf);
          ketQua = {
            nguoi: /socket\.join\(phongKiemNguoi\(u\.id\)\)/.test(t),
            phien: /socket\.join\(phongKiemPhien\(/.test(t),
            duoiCong: true,
          };
        }
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return ketQua;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (4) — bảng đọc bởi bộ phân giải ⊆ bảng có trigger
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/** Tên export schema → tên bảng (`export const X = pgTable("ten"`). */
function bangSchema(): Map<string, string> {
  const m = new Map<string, string>();
  const dir = resolve(GOC, "drizzle/schema");
  for (const ten of readdirSync(dir)) {
    if (!/\.ts$/.test(ten)) continue;
    for (const x of readFileSync(resolve(dir, ten), "utf8").matchAll(/export const (\w+)\s*=\s*pgTable\(\s*["'`]([a-z0-9_]+)["'`]/g)) m.set(x[1], x[2]);
  }
  return m;
}
/** Bảng có trigger `socket_pham_vi` trong tệp di trú. */
export function bangCoTrigger(sqlText: string): Set<string> {
  const out = new Set<string>();
  for (const x of sqlText.matchAll(/CREATE\s+TRIGGER\s+trg_socket_pham_vi\w*[\s\S]*?\bON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi)) out.add(x[1]);
  return out;
}

/** Tệp được lập chỉ mục hàm: lớp db + accessControl + sdk (nơi các bộ phân giải sống). */
const TEP_CHI_MUC = () => [
  ...readdirSync(resolve(GOC, "server/db")).filter((f) => /\.ts$/.test(f) && !/\.(test|spec|d)\.ts$/.test(f)).map((f) => `server/db/${f}`),
  "server/_core/accessControl.ts",
  "server/_core/sdk.ts",
];
const GOC_PHAN_GIAI: Array<{ file: string; ten: string }> = [
  { file: "server/db/reportAggregators.ts", ten: "resolveTenantFactoryScope" },
  { file: "server/_core/accessControl.ts", ten: "getUserAssignmentCodes" },
  { file: "server/_core/accessControl.ts", ten: "checkPermission" },
  { file: "server/_core/sdk.ts", ten: "authenticateRequest" },
];
/**
 * Bảng KHÔNG cần trigger dù bộ phân giải chạm tới — có LÝ DO, chỉ được THU HẸP. (Rỗng lúc viết: mọi bảng mà bốn gốc chạm tới đều có trigger.)
 */
const MIEN_BANG: Record<string, string> = {};

type ChiMuc = Map<string, Array<{ file: string; node: ts.Node; sf: ts.SourceFile }>>;
function lapChiMuc(nguon: Map<string, string>): ChiMuc {
  const cm: ChiMuc = new Map();
  const them = (ten: string, file: string, node: ts.Node, sf: ts.SourceFile) => {
    const ds = cm.get(ten) ?? [];
    ds.push({ file, node, sf });
    cm.set(ten, ds);
  };
  for (const [file, src] of nguon) {
    const sf = parse(file, src);
    const di = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) them(n.name.text, file, n.body, sf);
      else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)))
        them(n.name.text, file, n.initializer.body, sf);
      else if (ts.isMethodDeclaration(n) && n.body && (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name))) them(n.name.getText(sf), file, n.body, sf);
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return cm;
}

const RAW_SQL = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:public\.)?"?([a-z][a-z0-9_]*)"?/gi;
const LOI_GOI_BANG = new Set(["from", "insert", "update", "delete", "innerJoin", "leftJoin", "rightJoin", "fullJoin"]);

/** Bảng mà các gốc chạm tới (đọc / ghi), đi theo lời gọi hàm trong chỉ mục (theo tên; trùng tên ⇒ đi tất cả). */
export function bangCuaBoPhanGiai(nguon: Map<string, string>, goc = GOC_PHAN_GIAI): { bang: Map<string, string[]>; daDi: string[]; thuocTinh: Set<string> } {
  const schema = bangSchema();
  const cm = lapChiMuc(nguon);
  const bang = new Map<string, string[]>();
  const daDi = new Set<string>();
  const thuocTinh = new Set<string>(); // m4 — mọi tên thuộc tính ĐỌC trong các hàm đã đi (bảo thủ: không phân biệt đối tượng)
  const ghi = (t: string, o: string) => {
    const ds = bang.get(t) ?? [];
    if (!ds.includes(o)) ds.push(o);
    bang.set(t, ds);
  };
  const tham = (ten: string, chiFile?: string) => {
    for (const m of cm.get(ten) ?? []) {
      if (chiFile && m.file !== chiFile) continue;
      const khoa = `${m.file}#${ten}`;
      if (daDi.has(khoa)) continue;
      daDi.add(khoa);
      const goiTiep: string[] = [];
      const di = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const e = n.expression;
          const tenGoi = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
          if (tenGoi && LOI_GOI_BANG.has(tenGoi) && ts.isPropertyAccessExpression(e)) {
            const a = n.arguments[0];
            const t = a && ts.isIdentifier(a) ? schema.get(a.text) : a && ts.isPropertyAccessExpression(a) ? schema.get(a.name.text) : undefined;
            if (t) ghi(t, khoa);
          }
          if (tenGoi && cm.has(tenGoi)) goiTiep.push(tenGoi);
        }
        if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isStringLiteral(n)) {
          for (const x of n.text.matchAll(RAW_SQL)) if ([...schema.values()].includes(x[1])) ghi(x[1], khoa);
          for (const x of n.text.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) thuocTinh.add(x[1]); // cột trích dẫn trong SQL thô
        }
        if (ts.isPropertyAccessExpression(n)) thuocTinh.add(n.name.text);
        ts.forEachChild(n, di);
      };
      di(m.node);
      for (const g of goiTiep) tham(g);
    }
  };
  for (const g of goc) tham(g.ten, g.file);
  return { bang, daDi: [...daDi].sort(), thuocTinh };
}

/** m4 — bảng → (tên thuộc tính TS → tên cột DB), AST trên drizzle/schema (`export const x = pgTable("ten", { prop: kieu("cot"), … })`). */
export function cotSchema(): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const dir = resolve(GOC, "drizzle/schema");
  for (const ten of readdirSync(dir)) {
    if (!/\.ts$/.test(ten)) continue;
    const sf = parse(ten, readFileSync(resolve(dir, ten), "utf8"));
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "pgTable" && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1])) {
        const cot = new Map<string, string>();
        for (const pr of n.arguments[1].properties) {
          if (!ts.isPropertyAssignment(pr)) continue;
          let e: ts.Expression = pr.initializer;
          let dbTen: string | null = null;
          for (let k = 0; k < 30 && !dbTen; k++) {
            if (ts.isCallExpression(e)) {
              if (e.arguments[0] && ts.isStringLiteral(e.arguments[0]) && ts.isIdentifier(e.expression)) dbTen = e.arguments[0].text;
              else e = e.expression;
            } else if (ts.isPropertyAccessExpression(e)) e = e.expression;
            else break;
          }
          cot.set(pr.name.getText(sf), dbTen ?? pr.name.getText(sf));
        }
        out.set(n.arguments[0].text, cot);
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return out;
}
/** m4 — cột trong danh sách `UPDATE OF` của trigger trên bảng (rỗng = trigger không giới hạn cột, hoặc không có UPDATE). */
export function cotUpdateOf(sqlText: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const x of sqlText.matchAll(/CREATE\s+TRIGGER\s+trg_socket_pham_vi\w*\s+AFTER\s+UPDATE\s+OF\s+([\s\S]*?)\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
    const ds = out.get(x[2]) ?? new Set<string>();
    for (const c of x[1].split(",")) ds.add(c.trim().replace(/"/g, ""));
    out.set(x[2], ds);
  }
  return out;
}
/** m4 — bảng có trigger UPDATE giới hạn cột: mọi cột mà bộ phân giải ĐỌC phải nằm trong `UPDATE OF` hoặc được miễn kèm LÝ DO (chỉ thu hẹp). */
const BANG_CO_UPDATE_OF = ["users", "user_sessions", "factories"] as const;
export const MIEN_COT: Record<string, Record<string, string>> = {
  users: {
    id: "khoá chính — không đổi",
    openId: "khoá danh tính của vé (đổi ⇒ vé cũ không còn khớp người nào: sdk từ chối — chiều ĐÓNG)",
    name: "hiển thị, không quyết định quyền",
    email: "hiển thị, không quyết định quyền",
    loginMethod: "hiển thị",
    lastSignedIn: "ghi mỗi request — cố ý KHÔNG bắn",
    passwordChangedAt: "chỉ NỚI cổng buộc đổi mật khẩu (đổi xong mật khẩu); THẮT do passwordInvalidBefore — có trong UPDATE OF",
    twoFactorEnabled: "cổng 2FA chỉ áp cho adminProcedure HTTP; phòng socket không đọc (kiểm kê §1 H)",
    createdAt: "không đổi",
    updatedAt: "dấu thời gian",
    username: "hiển thị / đăng nhập mới",
  },
  user_sessions: {
    id: "khoá chính",
    userId: "chủ phiên — không đổi sau khi tạo",
    sessionToken: "khoá tra vé — không đổi",
    expiresAt: "HẠN THỜI GIAN (không cần lượt ghi): lượt quét định kỳ 5 phút kiểm (xacThucLai PHIEN_HET_HAN)",
    lastActivityAt: "ghi mỗi request — cố ý KHÔNG bắn",
    createdAt: "không đổi",
  },
  factories: {
    id: "khoá chính",
    name: "hiển thị",
    isActive: "KHÔNG phải thay đổi phạm vi (kiểm kê §1 E3: resolveTenantFactoryScope không lọc isActive — khớp tRPC)",
  },
};


function nguonChiMuc(): Map<string, string> {
  return new Map(TEP_CHI_MUC().map((f) => [f, doc(f)]));
}

describe("★★★ F5 đầy đủ — census phòng điều khiển / phòng admin / người ghi", () => {
  it("(1)+(3) TOÀN server/: 0 điểm phát vào `kiem:*` và 0 `io.to(\"admin\").emit` (mọi sự kiện admin qua phatPhongAdminTheoPhamVi)", () => {
    const tep = tepServer();
    expect(tep.length, "glob rỗng ⇒ census mù").toBeGreaterThan(300);
    const vi: ViPhamPhatKiem[] = [];
    for (const p of tep) {
      const src = readFileSync(p, "utf8");
      if (!src.includes(".emit(")) continue;
      vi.push(...quetPhatKiem(src, rel(p)));
    }
    expect(vi, vi.map((v) => `${v.file}:${v.dong} ${v.dang}`).join("\n")).toEqual([]);
    // thiết bị đo tự canh: năm sự kiện phòng admin đều đi qua hàm lọc
    const s = doc("server/_core/socket.ts");
    for (const e of ["machine:connected", "machine:disconnected", "machine:sync_status", "machine:discovered", "machine:registration_request"]) {
      expect(s, e).toMatch(new RegExp(`phatPhongAdminTheoPhamVi\\(\\s*"${e}"`));
    }
  });

  it("(2) connection: dưới `if (laSocketNguoiDung(socket.data))` vào CẢ kiem:user:{id} LẪN kiem:phien:{khoá}", () => {
    expect(phongKiemLucNoi(doc("server/_core/socket.ts"))).toEqual({ nguoi: true, phien: true, duoiCong: true });
  });

  it("(4) bảng có trigger socket_pham_vi ⊇ bảng mà bộ phân giải quyền / phạm vi / danh tính chạm tới (dò theo hình dạng)", () => {
    const coTrigger = bangCoTrigger(doc("drizzle/0435_socket_pham_vi.sql"));
    expect([...coTrigger].sort()).toEqual(["factories", "permissions", "user_corporate_assignments", "user_factory_assignments", "user_sessions", "users"]);
    const { bang, daDi } = bangCuaBoPhanGiai(nguonChiMuc());
    // thiết bị đo tự canh: các gốc + đường đi đã biết phải được THẤY (không thì bộ dò mù và (4) xanh vô nghĩa)
    for (const k of ["server/db/reportAggregators.ts#resolveTenantFactoryScope", "server/_core/accessControl.ts#checkPermission", "server/_core/sdk.ts#xacThucTho", "server/db/auth.ts#getSessionByToken", "server/db/auth.ts#getUserFactoryAssignments"]) {
      expect(daDi, k).toContain(k);
    }
    for (const t of ["users", "user_sessions", "user_factory_assignments", "user_corporate_assignments", "permissions", "factories"]) expect([...bang.keys()], t).toContain(t);
    const thieu = [...bang.entries()].filter(([t]) => !coTrigger.has(t) && !MIEN_BANG[t]).map(([t, o]) => `${t} (chạm bởi ${o.join(", ")})`);
    expect(thieu, "bảng phạm vi/quyền/danh tính KHÔNG có trigger socket_pham_vi").toEqual([]);
    for (const [t, ly] of Object.entries(MIEN_BANG)) {
      expect(ly.length, t).toBeGreaterThan(20);
      expect(bang.has(t), `miễn mồ côi ${t}`).toBe(true);
    }
  });
});

describe("★★★ fix round 1 (m4) — CỘT mà bộ phân giải đọc trên users / user_sessions / factories ⊆ UPDATE OF của trigger (hoặc miễn có lý do)", () => {
  function cotDoc(thuocTinh: Set<string>) {
    const cs = cotSchema();
    const out = new Map<string, string[]>();
    for (const t of BANG_CO_UPDATE_OF) {
      const cot = cs.get(t)!;
      out.set(t, [...cot.entries()].filter(([ts]) => thuocTinh.has(ts) || thuocTinh.has(cot.get(ts)!)).map(([, db]) => db).sort());
    }
    return out;
  }
  function thieu(doc: Map<string, string[]>, uo: Map<string, Set<string>>) {
    const out: string[] = [];
    for (const [t, ds] of doc) for (const c of ds) if (!uo.get(t)?.has(c) && !MIEN_COT[t]?.[c]) out.push(`${t}.${c}`);
    return out;
  }
  it("(m4) mọi cột đọc được nằm trong UPDATE OF hoặc MIEN_COT (có lý do, không mồ côi); thiết bị đo thấy các cột đã biết", () => {
    const uo = cotUpdateOf(doc("drizzle/0435_socket_pham_vi.sql"));
    expect([...uo.get("users")!].sort()).toEqual(["isActive", "passwordInvalidBefore", "role"]);
    expect([...uo.get("user_sessions")!]).toEqual(["isActive"]);
    expect([...uo.get("factories")!].sort()).toEqual(["code", "corporateCode"]);
    const d = cotDoc(bangCuaBoPhanGiai(nguonChiMuc()).thuocTinh);
    for (const c of ["role", "isActive", "openId"]) expect(d.get("users"), `users.${c}`).toContain(c);
    for (const c of ["isActive", "expiresAt", "sessionToken"]) expect(d.get("user_sessions"), `user_sessions.${c}`).toContain(c);
    for (const c of ["code", "corporateCode", "id"]) expect(d.get("factories"), `factories.${c}`).toContain(c);
    expect(thieu(d, uo), "cột phạm vi đọc mà KHÔNG trong UPDATE OF (đổi ở cột ấy không ngắt socket nào)").toEqual([]);
    for (const [t, m] of Object.entries(MIEN_COT)) {
      for (const [c, ly] of Object.entries(m)) {
        expect(ly.length, `${t}.${c}`).toBeGreaterThan(5);
        expect(uo.get(t)?.has(c), `${t}.${c} vừa miễn vừa có trong UPDATE OF`).not.toBe(true);
      }
    }
  });
  it("(m4) ĐỘT BIẾN: bộ phân giải đọc một cột MỚI (users.lockedUntil) ⇒ ĐỎ; bỏ một cột khỏi UPDATE OF ⇒ ĐỎ", () => {
    const nguon = nguonChiMuc();
    const ac = nguon.get("server/_core/accessControl.ts")!;
    const moc = "const resolvedModule = resolvePermissionModule(moduleName);";
    nguon.set("server/_core/accessControl.ts", ac.replace(moc, `${moc}\n  const khoa = (perm as any)?.lockedUntil;`));
    const uo = cotUpdateOf(doc("drizzle/0435_socket_pham_vi.sql"));
    expect(thieu(cotDoc(bangCuaBoPhanGiai(nguon).thuocTinh), uo)).toContain("users.lockedUntil");
    const uo2 = cotUpdateOf(doc("drizzle/0435_socket_pham_vi.sql").replace('AFTER UPDATE OF role, "isActive", "passwordInvalidBefore"', 'AFTER UPDATE OF role, "isActive"'));
    expect(thieu(cotDoc(bangCuaBoPhanGiai(nguonChiMuc()).thuocTinh), uo2)).toContain("users.passwordInvalidBefore");
  });
});

describe("ĐỘT BIẾN — census phải BẮT", () => {
  const f = "server/x.ts";
  it("(1) phát vào phòng điều khiển — mọi dạng", () => {
    for (const s of [
      "io.to(phongKiemNguoi(1)).emit('a', 1);",
      "io.in(`kiem:user:${id}`).emit('a', 1);",
      "io?.to('kiem:phien:3').emit('a', 1);",
      "io.local.in(phongKiemPhien(2)).emit('a');",
      "io.to('factory:1').to(phongKiemNguoi(u)).emit('a');",
    ]) expect(quetPhatKiem(s, f).length, s).toBeGreaterThan(0);
    // THA: ngắt (không phải phát) và phòng khác
    for (const s of ["io.local.in(phongKiemNguoi(1)).disconnectSockets(true);", "io.to('factory:1').emit('a');", "s.emit('machine:connected', p);"]) {
      expect(quetPhatKiem(s, f), s).toEqual([]);
    }
  });
  it("(3) quay lại `io.to(\"admin\").emit` ở một sự kiện ⇒ ĐỎ", () => {
    const s = doc("server/_core/socket.ts");
    const g = 'void phatPhongAdminTheoPhamVi("machine:disconnected", { machineId, machineCode, timestamp: new Date() }, async () => machineId);';
    expect(s).toContain(g);
    const m = s.replace(g, 'io?.to("admin").emit("machine:disconnected", { machineId, machineCode, timestamp: new Date() });');
    expect(quetPhatKiem(m, "server/_core/socket.ts").some((v) => v.dang.includes('"admin"'))).toBe(true);
    expect(quetPhatKiem("io.in('admin').emit('x');", f).length).toBe(1);
  });
  it("(2) bỏ một lượt vào phòng điều khiển ⇒ ĐỎ", () => {
    const s = doc("server/_core/socket.ts");
    const a = s.replace("socket.join(phongKiemNguoi(u.id));", "");
    const b = s.replace(/if \(typeof \(socket\.data as any\)\.khoaPhien === "number"\) socket\.join\(phongKiemPhien\([^;]*;/, "");
    expect(a).not.toBe(s);
    expect(b).not.toBe(s);
    expect(phongKiemLucNoi(a).nguoi).toBe(false);
    expect(phongKiemLucNoi(b).phien).toBe(false);
  });
  it("(4) một bộ phân giải đọc bảng phạm vi MỚI (không trigger) ⇒ ĐỎ; bảng ấy bị đọc QUA một hàm con ⇒ vẫn ĐỎ", () => {
    const nguon = nguonChiMuc();
    const ac = nguon.get("server/_core/accessControl.ts")!;
    const moc = "const resolvedModule = resolvePermissionModule(moduleName);";
    expect(ac).toContain(moc);
    nguon.set("server/_core/accessControl.ts", ac.replace(moc, `${moc}\n  await db.select().from(userRoles).limit(1);`));
    const coTrigger = bangCoTrigger(doc("drizzle/0435_socket_pham_vi.sql"));
    const { bang } = bangCuaBoPhanGiai(nguon);
    expect([...bang.keys()].filter((t) => !coTrigger.has(t))).toContain("user_roles");
    // qua hàm con trong db/auth + SQL thô
    const n2 = nguonChiMuc();
    const au = n2.get("server/db/auth.ts")!;
    n2.set("server/db/auth.ts", au.replace("export async function getSessionByToken(sessionToken: string) {", "export async function getSessionByToken(sessionToken: string) {\n  await docNhomMoi();"));
    n2.set("server/db/zzMoi.ts", "export async function docNhomMoi() { return db.execute(sql`SELECT 1 FROM user_roles`); }");
    expect([...bangCuaBoPhanGiai(n2).bang.keys()]).toContain("user_roles");
    // trigger bị bỏ khỏi 0435 ⇒ ĐỎ
    const thieuTrigger = bangCoTrigger(doc("drizzle/0435_socket_pham_vi.sql").replace(/CREATE TRIGGER trg_socket_pham_vi_uca[\s\S]*?;/, ""));
    expect(thieuTrigger.has("user_corporate_assignments")).toBe(false);
  });
});
