/**
 * SCADA R1b-2b-1 final fix (rà soát cuối I-1, 2026-10-27) — NGÂN SÁCH pool DB của đường STOP HMI.
 *
 * Hai trần toàn tiến trình cùng giữ kết nối của MỘT pool (pool chính `getDb()`, cỡ `resolvePoolMax()`) khi DB chậm — truy vấn đã bị bỏ rơi
 * vẫn giữ kết nối tới khi DB trả lời (≤ statement_timeout 30 s):
 *   · khe khảo sát của khối DỪNG khẩn cấp (`DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP`, T1 — `mayDungKhanCap.ts`);
 *   · lượt ghi nền của đường STOP ĐANG BAY (`TRAN_GHI_SO_TREO_STOP_HMI` = `TRAN_GHI_TREO_STOP`, `services/ot/ghiTreoCoTran.ts`). R1b-2b-2a T1 (mục 61):
 *     MỘT trần cho sổ (attempts, chốt dòng chờ) + audit HMI + audit STOP ghim của dispatcher — các lượt bắn-rồi-quên có từ trước nay CÙNG 8 này
 *     (đếm in-flight, KD-A1) ⇒ phép cộng ngân sách KHÔNG đổi (8 + 8 ≤ 25 − 9). Ca "★ mọi lượt ghi nền …" (AST) ghim rằng không lượt ghi nền nào
 *     của đường STOP thoát khỏi trần.
 * Mỗi trần từng được định cỡ RIÊNG (16 và 8 ⇒ 24 / 25) ⇒ lượt đọc trước-gửi của `dungMay` còn 1 kết nối. Test này ghim tổng:
 *   khe khảo sát + sổ treo ≤ pool MẶC ĐỊNH (production, không đặt `DB_POOL_MAX`) − `DU_TRU_POOL_CHO_DUNG_MAY`.
 * Nâng một trần, hạ pool mặc định hoặc hạ phần dự trữ dưới 8 ⇒ ĐỎ.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { resolvePoolMax } from "../../db/connection";
import { DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP } from "./mayDungKhanCap";
import { DU_TRU_POOL_CHO_DUNG_MAY, TRAN_GHI_SO_TREO_STOP_HMI } from "./lenhHmi";

describe("R1b-2b-1 final fix I-1 — ngân sách pool DB của đường STOP HMI", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("khe khảo sát + lượt sổ treo ≤ pool mặc định − dự trữ cho dungMay (dự trữ ≥ 8)", () => {
    // pool MẶC ĐỊNH của production: không đặt DB_POOL_MAX (chuỗi rỗng ⇒ resolvePoolMax lui về mặc định) — không đọc .env của máy chạy test
    vi.stubEnv("DB_POOL_MAX", "");
    const poolMacDinh = resolvePoolMax();
    // không ghim 25: NÂNG pool mặc định vẫn xanh; HẠ nó dưới tổng trần + dự trữ ⇒ bất đẳng thức dưới đỏ
    expect(DU_TRU_POOL_CHO_DUNG_MAY, "dự trữ cho lượt đọc trước-gửi của dungMay").toBeGreaterThanOrEqual(8);
    const tongTran = DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP + TRAN_GHI_SO_TREO_STOP_HMI;
    expect(
      tongTran,
      `khảo sát ${DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP} + sổ treo ${TRAN_GHI_SO_TREO_STOP_HMI} phải ≤ pool ${poolMacDinh} − dự trữ ${DU_TRU_POOL_CHO_DUNG_MAY}`,
    ).toBeLessThanOrEqual(poolMacDinh - DU_TRU_POOL_CHO_DUNG_MAY);
  });

  it("giá trị đã duyệt (điều phối 2026-10-27): khảo sát 8, sổ treo 8, dự trữ 9 ⇒ 8 + 8 = 16 = 25 − 9", () => {
    expect(DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP).toBe(8);
    expect(TRAN_GHI_SO_TREO_STOP_HMI).toBe(8);
    expect(DU_TRU_POOL_CHO_DUNG_MAY).toBe(9);
  });

  it("thiết bị đo: ngân sách đỏ khi pool nhỏ hơn (DB_POOL_MAX=20 ⇒ 20 − 9 = 11 < 16)", () => {
    vi.stubEnv("DB_POOL_MAX", "20");
    expect(DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP + TRAN_GHI_SO_TREO_STOP_HMI).toBeGreaterThan(resolvePoolMax() - DU_TRU_POOL_CHO_DUNG_MAY);
  });
});

// ═════════ R1b-2b-2a T1 (mục 61, kiem-dinh KD-A2) — census: MỌI lượt ghi nền của đường STOP đi qua bộ đếm chung ═════════
/**
 * Hai vị từ (AST, TypeScript compiler API) trên thân `dungMayHmi` / `guiStopMotAdapter` / `ghiThuCoHan` (`lenhHmi.ts`) và
 * `auditPinnedStopOverride` (`commandDispatcher.ts`), kể cả hàm lồng (thunk, callback, helper cục bộ):
 *   (A) vị từ NGƯỢC — mọi câu lệnh-biểu-thức là lời gọi KHÔNG `await` / KHÔNG `return` (câu `void f(...)`, `f(...)` trần, chuỗi `.then/.catch/.finally`,
 *       `void <biến>`) phải là: lời gọi BỌC (`ghiCoTran` / `ghiSoCoHan` / hàm cấp tệp chỉ `return <bọc>(…)` — vd. `ghiThuCoHan`), hoặc `logger.*` /
 *       `console.*`, hoặc hàm ĐỒNG BỘ đã duyệt (`DONG_BO_DUOC_PHEP`, không chạm DB), hoặc helper cục bộ khai kiểu trả `: void` (không async — thân
 *       nó cũng bị quét). Khác ⇒ ĐỎ (một lượt ghi nền mới thoát trần = một kết nối pool không ai đếm).
 *   (B) vị từ THUẬN — mọi lời gọi ghi sổ (`recordAuditEvent` / `ghiThuLenh` / `doiTrangThaiCho`) phải có hàm bao GẦN NHẤT là THUNK = đối số ĐẦU của
 *       một lời gọi bọc (truy vấn chỉ phát SAU khi kiểm trần — `const viec = recordAuditEvent(…)` rồi bọc là ĐỎ).
 * Giới hạn đã biết (ghi báo cáo): phép gán `x = f()` không `await` không bị (A) xét; tên hàm so theo chữ (không theo kiểu); lời gọi ghi sổ qua
 * bí danh (tên khác `HAM_GHI_SO`) không bị (B) thấy — (A) vẫn bắt nếu nó nổi.
 */
export const HAM_BOC_GOC = ["ghiCoTran", "ghiSoCoHan"] as const;
export const HAM_GHI_SO = ["recordAuditEvent", "ghiThuLenh", "doiTrangThaiCho"] as const;
/** đồng bộ, không chạm DB (log / đếm trong bộ nhớ) — thêm tên mới ở đây là quyết định CÓ RÀ SOÁT */
export const DONG_BO_DUOC_PHEP = ["ghiNhanStopQuaHanKhongGhiSo", "ghiLoiChot"] as const;
export const HAM_QUET_LENH_HMI = ["dungMayHmi", "guiStopMotAdapter", "ghiThuCoHan"] as const;
export const HAM_QUET_DISPATCHER = ["auditPinnedStopOverride"] as const;

export interface KetQuaQuetGhiNen {
  /** hàm được yêu cầu mà không thấy trong tệp */
  thieuHam: string[];
  /** vi phạm (A): `<hàm>:<dòng>: <mã>` */
  viPhamNguoc: string[];
  /** vi phạm (B) */
  viPhamThuan: string[];
  /** số câu lệnh nổi ĐÃ bọc (cầu chì) */
  soBoc: number;
  /** số lời gọi ghi sổ nằm trong thunk của lời gọi bọc (cầu chì) */
  soGhiTrongThunk: number;
  /** tên bọc suy ra (gốc + hàm cấp tệp chỉ `return <bọc>(…)`) */
  hamBoc: string[];
}

const boNgoac = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  return x;
};
const tenGoiHam = (c: ts.CallExpression): string | null => {
  const e = boNgoac(c.expression);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
};
const laLog = (c: ts.CallExpression): boolean => {
  const e = boNgoac(c.expression);
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && (e.expression.text === "logger" || e.expression.text === "console");
};
const laHam = (n: ts.Node): boolean =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);

export function quetGhiNen(duong: string, ma: string, tenHam: readonly string[]): KetQuaQuetGhiNen {
  const src = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
  const capTep = new Map<string, ts.FunctionDeclaration>();
  src.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) capTep.set(n.name.text, n);
  });
  // bọc suy ra: hàm cấp tệp mà thân là ĐÚNG MỘT `return <bọc>(…)` (điểm bất động)
  const hamBoc = new Set<string>(HAM_BOC_GOC);
  for (let doi = true; doi; ) {
    doi = false;
    for (const [ten, f] of capTep) {
      if (hamBoc.has(ten)) continue;
      const st = f.body!.statements;
      if (st.length !== 1 || !ts.isReturnStatement(st[0]) || !st[0].expression) continue;
      const e = boNgoac(st[0].expression);
      if (ts.isCallExpression(e) && hamBoc.has(tenGoiHam(e) ?? "")) {
        hamBoc.add(ten);
        doi = true;
      }
    }
  }
  const ra: KetQuaQuetGhiNen = { thieuHam: [], viPhamNguoc: [], viPhamThuan: [], soBoc: 0, soGhiTrongThunk: 0, hamBoc: [...hamBoc].sort() };
  const dongCua = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
  const ma1 = (n: ts.Node) => n.getText(src).replace(/\s+/g, " ").slice(0, 120);
  const dongBo = new Set<string>(DONG_BO_DUOC_PHEP);

  for (const ten of tenHam) {
    const f = capTep.get(ten);
    if (!f) {
      ra.thieuHam.push(ten);
      continue;
    }
    // helper cục bộ khai `: void` (không async) — được gọi trần; thân nó nằm trong thân đang quét nên cũng bị quét
    const helperVoid = new Set<string>();
    const timHelper = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const k = boNgoac(n.initializer);
        if (
          (ts.isArrowFunction(k) || ts.isFunctionExpression(k)) &&
          k.type?.kind === ts.SyntaxKind.VoidKeyword &&
          !k.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
        ) {
          helperVoid.add(n.name.text);
        }
      }
      n.forEachChild(timHelper);
    };
    timHelper(f.body!);

    /** (A) — một biểu thức bị BỎ kết quả (câu lệnh-biểu-thức, hoặc thân gọn của arrow mà kết quả bị bỏ): phải là bọc / log / đồng bộ đã duyệt */
    const xetNoi = (bieuThuc: ts.Expression, nut: ts.Node): void => {
      let e = boNgoac(bieuThuc);
      const coVoid = ts.isVoidExpression(e);
      if (ts.isVoidExpression(e)) e = boNgoac(e.expression);
      if (ts.isCallExpression(e)) {
        // gốc của chuỗi `.then/.catch/.finally` = lời gọi phát ra promise
        let goc: ts.Expression = e;
        for (;;) {
          if (!ts.isCallExpression(goc)) break;
          const ce = boNgoac(goc.expression);
          if (ts.isPropertyAccessExpression(ce) && ["then", "catch", "finally"].includes(ce.name.text)) goc = boNgoac(ce.expression);
          else break;
        }
        let hopLe = false;
        if (ts.isCallExpression(goc)) {
          const tg = tenGoiHam(goc) ?? "";
          const goiTen = ts.isIdentifier(boNgoac(goc.expression));
          if (goiTen && hamBoc.has(tg)) {
            hopLe = true;
            ra.soBoc += 1;
          } else if (laLog(goc)) {
            hopLe = true;
          } else if (!coVoid && goc === e && tg === "forEach" && !goiTen) {
            // `xs.forEach(cb)` — vòng lặp ĐỒNG BỘ (trả void); thân gọn của `cb` được xét riêng (thanGonBiBo), thân khối bị quét như mọi nút
            hopLe = true;
          } else if (goiTen && goc === e && (dongBo.has(tg) || helperVoid.has(tg))) {
            hopLe = true;
          }
        }
        if (!hopLe) ra.viPhamNguoc.push(`${ten}:${dongCua(nut)}: ${ma1(nut)}`);
      } else if (coVoid) {
        // `void <biến promise>` — promise nổi không qua bọc
        ra.viPhamNguoc.push(`${ten}:${dongCua(nut)}: ${ma1(nut)}`);
      }
    };
    /** fix round 1 (review M-3) — thân GỌN của arrow mà kết quả bị bỏ: `(): void => …`, `() => void …`, đối số của `forEach` */
    const thanGonBiBo = (f: ts.ArrowFunction): boolean => {
      if (ts.isBlock(f.body)) return false;
      if (ts.isVoidExpression(boNgoac(f.body))) return true;
      if (f.type?.kind === ts.SyntaxKind.VoidKeyword) return true;
      const cha = f.parent;
      return !!cha && ts.isCallExpression(cha) && tenGoiHam(cha) === "forEach" && cha.arguments.includes(f);
    };

    const di = (n: ts.Node): void => {
      // (A) vị từ NGƯỢC
      if (ts.isExpressionStatement(n)) xetNoi(n.expression, n);
      if (ts.isArrowFunction(n) && thanGonBiBo(n)) xetNoi(n.body as ts.Expression, n);
      // (B') fix round 1 (review M-3) — thunk của lời gọi bọc chỉ TRẢ một promise đã phát TRƯỚC (`const p = db.update(…); ghiCoTran(() => p, …)`):
      // truy vấn chạy ngoài trần ⇒ ĐỎ. Thân gọn là định danh, hoặc thân khối có `return <định danh>`.
      if (ts.isCallExpression(n) && (HAM_BOC_GOC as readonly string[]).includes(tenGoiHam(n) ?? "") && n.arguments[0]) {
        const th = boNgoac(n.arguments[0]);
        // định danh khai TRONG thunk (kết quả `await` cục bộ) không tính — chỉ định danh từ NGOÀI thunk (promise phát trước)
        const traDinhDanh = (f: ts.ArrowFunction | ts.FunctionExpression): boolean => {
          if (!ts.isBlock(f.body)) return ts.isIdentifier(boNgoac(f.body));
          const cucBo = new Set<string>();
          const traVe: string[] = [];
          const tim = (x: ts.Node): void => {
            if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name)) cucBo.add(x.name.text);
            if (ts.isReturnStatement(x) && x.expression && ts.isIdentifier(boNgoac(x.expression))) traVe.push((boNgoac(x.expression) as ts.Identifier).text);
            if (!laHam(x)) x.forEachChild(tim);
          };
          f.body.forEachChild(tim);
          return traVe.some((t) => !cucBo.has(t));
        };
        if (ts.isIdentifier(th) || ((ts.isArrowFunction(th) || ts.isFunctionExpression(th)) && traDinhDanh(th))) {
          ra.viPhamThuan.push(`${ten}:${dongCua(n)}: thunk trả promise đã phát trước — ${ma1(n)}`);
        }
      }
      // (B) vị từ THUẬN
      if (ts.isCallExpression(n) && (HAM_GHI_SO as readonly string[]).includes(tenGoiHam(n) ?? "")) {
        let bao: ts.Node | undefined = n.parent;
        while (bao && !laHam(bao)) bao = bao.parent;
        const cha = bao?.parent;
        const trongThunk = !!bao && !!cha && ts.isCallExpression(cha) && hamBoc.has(tenGoiHam(cha) ?? "") && cha.arguments[0] === bao;
        if (trongThunk) ra.soGhiTrongThunk += 1;
        else ra.viPhamThuan.push(`${ten}:${dongCua(n)}: ${ma1(n)}`);
      }
      n.forEachChild(di);
    };
    di(f.body!);
  }
  return ra;
}

/**
 * Cầu chì (ĐO 2026-10-27 trên e5f6dcdb4 + T1):
 *   · lenhHmi — câu lệnh nổi đã bọc 5: `void ghiSoCoHan` × 3 (audit buộc đổi mật khẩu, audit QUA_HAN, audit `ghiAudit`) + `void ghiThuCoHan` × 2
 *     (attempts STOP_QUA_HAN cả lệnh, vòng STOP_QUA_HAN theo adapter);
 *   · dispatcher — 1: `void ghiCoTran` của `auditPinnedStopOverride`;
 *   · lời gọi ghi sổ trong thunk 8: lenhHmi 3 `recordAuditEvent` + 1 `ghiThuLenh` (ghiThuCoHan) + 3 `doiTrangThaiCho` (dispatch ném × 1, sau
 *     dispatch × 2) + dispatcher 1 `recordAuditEvent`.
 */
const SO_BOC_LENH_HMI = 5;
const SO_BOC_DISPATCHER = 1;
const SO_GHI_TRONG_THUNK = 8;

const GOC_TEP = dirname(fileURLToPath(import.meta.url));
const docTep = (tuongDoi: string) => readFileSync(join(GOC_TEP, tuongDoi), "utf8");

describe("★ R1b-2b-2a T1 (mục 61, KD-A2) — mọi lượt ghi nền của đường STOP đi qua bộ đếm chung", () => {
  it("★ lenhHmi.ts (dungMayHmi, guiStopMotAdapter, ghiThuCoHan) + commandDispatcher.ts (auditPinnedStopOverride): 0 vi phạm (A) ngược / (B) thuận; cầu chì đếm", () => {
    const l = quetGhiNen("server/services/scada/lenhHmi.ts", docTep("lenhHmi.ts"), HAM_QUET_LENH_HMI);
    const d = quetGhiNen("server/services/ot/commandDispatcher.ts", docTep("../ot/commandDispatcher.ts"), HAM_QUET_DISPATCHER);
    expect(l.thieuHam).toEqual([]);
    expect(d.thieuHam).toEqual([]);
    expect(l.viPhamNguoc).toEqual([]);
    expect(l.viPhamThuan).toEqual([]);
    expect(d.viPhamNguoc).toEqual([]);
    expect(d.viPhamThuan).toEqual([]);
    // bọc suy ra đúng (ghiThuCoHan chỉ `return ghiSoCoHan(…)`, ghiSoCoHan chỉ `return ghiCoTran(…)`)
    expect(l.hamBoc).toEqual(expect.arrayContaining(["ghiCoTran", "ghiSoCoHan", "ghiThuCoHan"]));
    // cầu chì (ĐO 2026-10-27, ghi trong commit): xem SO_* dưới. Quét hụt (đổi cấu trúc khiến AST không thấy) ⇒ số tụt ⇒ ĐỎ; thêm chỗ ghi mới ⇒
    // cập nhật số có chủ ý.
    expect(l.soBoc).toBeGreaterThanOrEqual(SO_BOC_LENH_HMI);
    expect(d.soBoc).toBeGreaterThanOrEqual(SO_BOC_DISPATCHER);
    expect(l.soGhiTrongThunk + d.soGhiTrongThunk).toBeGreaterThanOrEqual(SO_GHI_TRONG_THUNK);
  });

  describe("thiết bị đo — nguồn tổng hợp", () => {
    const quet = (ma: string) => quetGhiNen("tong-hop.ts", ma, ["dungMayHmi"]);
    it("`void db.insert(...)` ⇒ BẮT (A)", () => {
      const r = quet(`async function dungMayHmi(db: any) { void db.insert(x).values(y); }`);
      expect(r.viPhamNguoc).toHaveLength(1);
      expect(r.viPhamNguoc[0]).toContain("db.insert");
    });
    it("khuôn CŨ `const viec = recordAuditEvent(…)` + `void voiHanUnref(viec, …).catch(…)` ⇒ BẮT cả (A) lẫn (B)", () => {
      const r = quet(`async function dungMayHmi(d: any) { const viec = recordAuditEvent(d, {}); void voiHanUnref(viec, 1, "x").catch(() => 0); }`);
      expect(r.viPhamNguoc).toHaveLength(1);
      expect(r.viPhamThuan).toHaveLength(1);
    });
    it("khuôn CŨ `void ghiThuLenh(d, …).catch(…)` ⇒ BẮT; `ghiThuLenh(d, …).catch(…)` (không void) ⇒ BẮT", () => {
      expect(quet(`async function dungMayHmi(d: any) { void ghiThuLenh(d, {}).catch(() => 0); }`).viPhamNguoc).toHaveLength(1);
      expect(quet(`async function dungMayHmi(d: any) { ghiThuLenh(d, {}).catch(() => 0); }`).viPhamNguoc).toHaveLength(1);
    });
    it("`void <biến promise>` ⇒ BẮT; thunk có `void db.insert` lồng ⇒ BẮT (A) lồng", () => {
      expect(quet(`async function dungMayHmi(p: any) { void p; }`).viPhamNguoc).toHaveLength(1);
      const r = quet(`async function dungMayHmi(d: any) { void ghiCoTran(async () => { void db.insert(x); await recordAuditEvent(d, {}); }, { nhan: "a", requestId: "-" }); }`);
      expect(r.viPhamNguoc).toHaveLength(1);
      expect(r.viPhamThuan).toEqual([]);
      expect(r.soBoc).toBe(1);
    });
    it("helper cục bộ ASYNC gọi trần ⇒ BẮT (A) + (B); helper `: void` gọi trần ⇒ hợp lệ (thân nó bị quét); `await ghiThuLenh` ngoài thunk ⇒ BẮT (B)", () => {
      const r = quet(`async function dungMayHmi(d: any) { const g = async () => { await ghiThuLenh(d, {}); }; g(); }`);
      expect(r.viPhamNguoc).toHaveLength(1);
      expect(r.viPhamThuan).toHaveLength(1);
      const ok = quet(`async function dungMayHmi(d: any) {
        const f = (): void => { void ghiSoCoHan(() => recordAuditEvent(d, {}), "a", "-"); };
        f(); logger.error({}); console.warn("x"); ghiNhanStopQuaHanKhongGhiSo("db"); await ghiThuLenh(d, {});
      }`);
      expect(ok.viPhamNguoc).toEqual([]);
      expect(ok.viPhamThuan).toHaveLength(1);
      expect(ok.soBoc).toBe(1);
      expect(ok.soGhiTrongThunk).toBe(1);
    });
    it("fix round 1 (review M-3) — thân GỌN bị bỏ kết quả ⇒ BẮT: `(): void => void db.insert(x)`, `xs.forEach((x) => db.insert(x))`, `() => void ghiThuLenh(…)`", () => {
      expect(quet(`async function dungMayHmi(db: any) { const f = (): void => void db.insert(x); f(); }`).viPhamNguoc).toHaveLength(1);
      expect(quet(`async function dungMayHmi(db: any, xs: any[]) { xs.forEach((x) => db.insert(x)); }`).viPhamNguoc).toHaveLength(1);
      expect(quet(`async function dungMayHmi(d: any, xs: any[]) { xs.forEach((x) => void ghiThuLenh(d, x)); }`).viPhamNguoc).toHaveLength(1);
      // đối chứng: thân gọn được TRẢ (người gọi await) hoặc bọc ⇒ hợp lệ
      const ok = quet(`async function dungMayHmi(d: any, xs: any[]) { const g = (x: any) => ghiThuCoHan2(d, x); await g(1); xs.forEach((x) => void ghiCoTran(() => ghiThuLenh(d, x), { nhan: "a", requestId: "-" })); }`);
      expect(ok.viPhamNguoc).toEqual([]);
      expect(ok.soBoc).toBe(1);
    });
    it("fix round 1 (review M-3) — thunk TRẢ promise đã phát trước ⇒ BẮT (B'): `const p = db.update(…); void ghiCoTran(() => p, …)` và dạng khối / truyền thẳng", () => {
      const r1 = quet(`async function dungMayHmi(db: any) { const p = db.update(x); void ghiCoTran(() => p, { nhan: "a", requestId: "-" }); }`);
      expect(r1.viPhamThuan).toHaveLength(1);
      expect(r1.viPhamThuan[0]).toContain("đã phát trước");
      expect(quet(`async function dungMayHmi(db: any) { const p = db.update(x); void ghiCoTran(async () => { return p; }, { nhan: "a", requestId: "-" }); }`).viPhamThuan).toHaveLength(1);
      expect(quet(`async function dungMayHmi(viec: any) { void ghiCoTran(viec, { nhan: "a", requestId: "-" }); }`).viPhamThuan).toHaveLength(1);
      // đối chứng: thunk phát truy vấn BÊN TRONG ⇒ hợp lệ
      expect(quet(`async function dungMayHmi(db: any) { void ghiCoTran(async () => { const r = await db.update(x); return r; }, { nhan: "a", requestId: "-" }); }`).viPhamThuan).toEqual([]);
    });
    it("hàm cấp tệp chỉ `return ghiSoCoHan(…)` ⇒ là bọc (suy ra); hàm bị đổi tên / mất ⇒ thieuHam", () => {
      const r = quetGhiNen(
        "tong-hop.ts",
        `function boc2(d: any) { return ghiSoCoHan(() => ghiThuLenh(d, {}), "a", "-"); }
         async function dungMayHmi(d: any) { void boc2(d); }`,
        ["dungMayHmi", "khongCo"],
      );
      expect(r.hamBoc).toContain("boc2");
      expect(r.viPhamNguoc).toEqual([]);
      expect(r.soBoc).toBe(1);
      expect(r.thieuHam).toEqual(["khongCo"]);
    });
  });
});
