/**
 * ★★★ ĐỢT 4B — lưới `BoThucThiVscode` (bộ thực thi của lõi agent dùng chung trên VSCode): đọc qua hàng rào cũ, ghi
 * NHIỀU tệp (sửa/tạo/xoá/đổi tên) qua `apBanVa` sau cửa duyệt TỪNG TỆP, mức quyền chặn TẠI apBanVa, kết quả lệnh
 * (đầu ra + exit code) VỀ MODEL, diagnostics, find_symbol qua LSP, remember chỉ là ĐỀ XUẤT.
 *
 * Gốc workspace là một thư mục tạm THẬT (rỗng — `giaiDuongThat` cần `realpath` thật); nội dung tệp nằm trong Map
 * (census cấm mọi tệp, kể cả lưới, ghi đĩa bằng `fs`).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const may = vi.hoisted(() => ({
  tep: new Map<string, string>(),
  chanDoan: [] as Array<[{ fsPath: string; scheme: string }, Array<Record<string, unknown>>]>,
  kyHieu: [] as unknown[],
  thamChieu: [] as unknown[],
}));

vi.mock("vscode", () => {
  const Uri = { file: (p: string) => ({ fsPath: p, scheme: "file", toString: () => `file://${p}` }) };
  class RelativePattern {
    constructor(
      public base: { fsPath: string },
      public pattern: string,
    ) {}
  }
  const khongCo = () => Object.assign(new Error("EntryNotFound"), { code: "FileNotFound" });
  return {
    Uri,
    RelativePattern,
    FileType: { File: 1, Directory: 2 },
    SymbolKind: Object.assign(["File", "Module", "Namespace", "Package", "Class", "Method", "Property", "Field", "Constructor", "Enum", "Interface", "Function", "Variable", "Constant"], {
      File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, Struct: 22, TypeParameter: 25,
    }),
    workspace: {
      fs: {
        readFile: async (u: { fsPath: string }) => {
          if (!may.tep.has(u.fsPath)) throw khongCo();
          return Buffer.from(may.tep.get(u.fsPath)!, "utf8");
        },
        stat: async (u: { fsPath: string }) => {
          if (may.tep.has(u.fsPath)) return { type: 1 };
          if ([...may.tep.keys()].some((k) => k.startsWith(u.fsPath + "\\") || k.startsWith(u.fsPath + "/"))) return { type: 2 };
          throw khongCo();
        },
        readDirectory: async (u: { fsPath: string }) => {
          const con = new Map<string, number>();
          for (const k of may.tep.keys()) {
            if (!k.startsWith(u.fsPath)) continue;
            const phan = k.slice(u.fsPath.length + 1).split(/[\\/]/);
            con.set(phan[0], phan.length > 1 ? 2 : 1);
          }
          return [...con.entries()];
        },
      },
      findFiles: async (p: { base: { fsPath: string }; pattern: string }) => {
        const duoi = p.pattern.replace(/^\*\*\//, "").replace(/^\*/, "");
        return [...may.tep.keys()].filter((k) => k.startsWith(p.base.fsPath) && (p.pattern === "**/*" || k.endsWith(duoi))).map((k) => Uri.file(k));
      },
    },
    languages: {
      getDiagnostics: (u?: { fsPath: string }) =>
        u ? (may.chanDoan.find(([x]) => x.fsPath === u.fsPath)?.[1] ?? []) : may.chanDoan,
    },
    commands: {
      executeCommand: async (lenh: string) => (lenh === "vscode.executeWorkspaceSymbolProvider" ? may.kyHieu : may.thamChieu),
    },
  };
});

import { BoThucThiVscode, type PhuThuocBoThucThi, type YeuCauDuyet, type QuyetDinhDuyet } from "./boThucThiVscode";
import { SoCheckpoint } from "../loi/checkpoint";
import type { DauVaoApBanVa, KetQuaApBanVa } from "./apBanVa";
import type { NguCanhThucThi, SuKienAgent, CheDoAgent } from "../../../shared/agentCore/index";
import type { MucQuyen } from "../loi/mucQuyen";

const WS = realpathSync(mkdtempSync(join(tmpdir(), "bttv-")));
// Chỉ THƯ MỤC là thật (đường thật của tệp chưa có cần thư mục cha tồn tại); nội dung tệp nằm trong Map.
mkdirSync(join(WS, "src", "sub"), { recursive: true });
afterAll(() => rmSync(WS, { recursive: true, force: true }));
const P = (r: string) => join(WS, ...r.split("/"));
const bam = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

interface Dung {
  bo: BoThucThiVscode;
  suKien: SuKienAgent[];
  duyet: YeuCauDuyet[];
  ap: DauVaoApBanVa[];
  so: SoCheckpoint;
  lenh: string[][];
  ctx: (cheDo?: CheDoAgent) => NguCanhThucThi;
}

function dung(
  o: { mucQuyen?: MucQuyen; quyetDinh?: QuyetDinhDuyet; token?: string | undefined; apThat?: boolean; exit?: number; output?: string; apKq?: KetQuaApBanVa } = {},
): Dung {
  const suKien: SuKienAgent[] = [];
  const duyet: YeuCauDuyet[] = [];
  const ap: DauVaoApBanVa[] = [];
  const lenh: string[][] = [];
  const so = new SoCheckpoint("run-1");
  const pt: PhuThuocBoThucThi = {
    goc: () => [WS],
    mucQuyen: () => o.mucQuyen ?? "hoi_truoc_khi_ghi",
    serverUrl: () => "http://gia",
    layToken: async () => ("token" in o ? o.token : "avgw_tok"),
    nhanWorkspace: () => WS,
    xinDuyet: async (yc) => {
      duyet.push(yc);
      return o.quyetDinh ?? { duyet: true };
    },
    checkpoint: () => so,
    chayLenh: async (dv) => {
      lenh.push(dv.lenh.argv);
      return { ok: (o.exit ?? 0) === 0, output: o.output ?? "FAIL src/a.test.ts > cộng\nexpected 3, got 4", exitCode: o.exit ?? 0, signal: null, timedOut: false, daCatSom: false, durationMs: 5 };
    },
    ...(o.apThat
      ? {}
      : {
          apBanVa: async (dv: DauVaoApBanVa): Promise<KetQuaApBanVa> => {
            ap.push(dv);
            if (o.apKq) return o.apKq;
            const t = dv.thaoTac!;
            if (t.loai === "tao" || t.loai === "thay") {
              may.tep.set(dv.duongTuyetDoi, t.noiDungMoi);
              return { ok: true, thongDiep: "ok", bamSauThat: bam(t.noiDungMoi) };
            }
            if (t.loai === "xoa") {
              may.tep.delete(dv.duongTuyetDoi);
              return { ok: true, thongDiep: "ok", bamSauThat: null };
            }
            const nd = may.tep.get(dv.duongTuyetDoi)!;
            may.tep.set(t.duongDichTuyetDoi, nd);
            may.tep.delete(dv.duongTuyetDoi);
            return { ok: true, thongDiep: "ok", bamSauThat: bam(nd) };
          },
        }),
  };
  const bo = new BoThucThiVscode(pt);
  const ctx = (cheDo: CheDoAgent = "sua"): NguCanhThucThi => ({ cheDo, runId: "run-1", luot: 1, signal: new AbortController().signal, phat: (e) => suKien.push(e) });
  return { bo, suKien, duyet, ap, so, lenh, ctx };
}

const goi = (ten: string, thamSo: Record<string, unknown>, id = `c-${ten}`) => ({ id, ten, thamSo });

beforeEach(() => {
  may.tep.clear();
  may.chanDoan = [];
  may.kyHieu = [];
  may.thamChieu = [];
});

describe("BoThucThiVscode — bộ tool", () => {
  it("★★★ bày get_diagnostics (tool riêng), KHÔNG bày search_code/search_docs; chế độ hoi không có tool ghi", () => {
    const d = dung();
    const ten = (c: CheDoAgent) => d.bo.congCu(c).map((t) => t.function.name);
    expect(ten("sua")).toEqual(expect.arrayContaining(["edit_file", "write_file", "delete_file", "rename_file", "run_command", "get_diagnostics", "find_symbol", "remember"]));
    expect(ten("sua")).not.toContain("search_code");
    expect(ten("sua")).not.toContain("search_docs");
    expect(ten("hoi")).not.toContain("edit_file");
    expect(ten("hoi")).toContain("get_diagnostics");
  });
});

describe("BoThucThiVscode — đọc", () => {
  it("★★★ read_file đánh số dòng, cắt theo khoảng, che bí mật", async () => {
    may.tep.set(P("src/a.ts"), 'const a = 1;\nconst API_KEY = "sk-abcdefghijklmnopqrstuvwxyz123456";\nconst c = 3;\n');
    const d = dung();
    const kq = await d.bo.chay(goi("read_file", { path: "src/a.ts", start_line: 2, end_line: 3 }), d.ctx());
    expect(kq.ok).toBe(true);
    expect(kq.choModel).toMatch(/File: src\/a\.ts \(lines 2-3 of 3\)/);
    expect(kq.choModel).toMatch(/\s+2\t/);
    expect(kq.choModel).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(kq.choModel).not.toMatch(/\s+1\t/);
  });

  it("★★★ read_file .env / ngoài workspace ⇒ từ chối, không đọc", async () => {
    may.tep.set(P(".env"), "DATABASE_URL=postgres://u:p@h/db");
    const d = dung();
    const k1 = await d.bo.chay(goi("read_file", { path: ".env" }), d.ctx());
    expect(k1.ok).toBe(false);
    expect(k1.choModel).not.toContain("postgres://");
    const k2 = await d.bo.chay(goi("read_file", { path: "../../etc/passwd" }), d.ctx());
    expect(k2.ok).toBe(false);
  });

  it("★★ grep regex + include, kết quả rel:dòng", async () => {
    may.tep.set(P("src/a.ts"), "function cong(a, b) {}\nconst x = cong(1, 2);\n");
    may.tep.set(P("src/b.md"), "cong trong tai lieu");
    const d = dung();
    const kq = await d.bo.chay(goi("grep", { pattern: "cong\\(\\d", include: "*.ts" }), d.ctx());
    expect(kq.choModel).toContain("src/a.ts:2:");
    expect(kq.choModel).not.toContain("b.md");
  });

  it("★★ list_dir + find_files", async () => {
    may.tep.set(P("src/a.ts"), "a");
    may.tep.set(P("src/sub/b.test.ts"), "b");
    const d = dung();
    const ld = await d.bo.chay(goi("list_dir", { path: "src" }), d.ctx());
    expect(ld.choModel).toContain("sub/");
    expect(ld.choModel).toContain("a.ts");
    const ff = await d.bo.chay(goi("find_files", { pattern: "**/*.test.ts" }), d.ctx());
    expect(ff.choModel).toContain("src/sub/b.test.ts");
  });

  it("★★★ get_diagnostics: lỗi trước, lọc ngoài workspace", async () => {
    const u = { fsPath: P("src/a.ts"), scheme: "file" };
    may.chanDoan = [
      [u, [{ range: { start: { line: 4, character: 2 } }, severity: 1, message: "unused", source: "ts" }, { range: { start: { line: 9, character: 0 } }, severity: 0, message: "Type 'string' is not assignable", source: "ts", code: 2322 }]],
      [{ fsPath: "C:\\khac\\x.ts", scheme: "file" }, [{ range: { start: { line: 0, character: 0 } }, severity: 0, message: "ngoài" }]],
    ];
    may.tep.set(P("src/a.ts"), "x");
    const d = dung();
    const tatCa = await d.bo.chay(goi("get_diagnostics", {}), d.ctx());
    expect(tatCa.choModel).toMatch(/1 errors, 1 warnings/);
    expect(tatCa.choModel.indexOf("src/a.ts:10:1 error")).toBeLessThan(tatCa.choModel.indexOf("warning: unused"));
    expect(tatCa.choModel).not.toContain("ngoài");
    const motTep = await d.bo.chay(goi("get_diagnostics", { path: "src/a.ts" }), d.ctx());
    expect(motTep.choModel).toContain("[ts 2322]");
  });

  it("★★ find_symbol qua LSP: định nghĩa + tham chiếu", async () => {
    may.tep.set(P("src/a.ts"), "export function chayVong() {}\n");
    may.tep.set(P("src/b.ts"), "import { chayVong } from './a';\nchayVong();\n");
    const loc = (p: string, line: number) => ({ uri: { fsPath: p, scheme: "file" }, range: { start: { line, character: 0 } } });
    may.kyHieu = [{ name: "chayVong", kind: 11, containerName: "", location: loc(P("src/a.ts"), 0) }, { name: "chayVongKhac", kind: 11, location: loc(P("src/a.ts"), 0) }];
    may.thamChieu = [loc(P("src/b.ts"), 1)];
    const d = dung();
    const kq = await d.bo.chay(goi("find_symbol", { name: "chayVong", kind: "function" }), d.ctx());
    expect(kq.choModel).toContain("src/a.ts:1  [Function]  export function chayVong() {}");
    expect(kq.choModel).toContain("src/b.ts:2  chayVong();");
    expect(kq.choModel).not.toContain("chayVongKhac");
  });
});

describe("BoThucThiVscode — ghi NHIỀU tệp qua apBanVa", () => {
  it("★★★ chế độ sua: edit_file ⇒ thẻ duyệt TỪNG TỆP (có gốc + mới cho diff) ⇒ apBanVa(thay) ⇒ checkpoint", async () => {
    may.tep.set(P("src/a.ts"), "const x = 1;\n");
    const d = dung();
    const kq = await d.bo.chay(goi("edit_file", { path: "src/a.ts", edits: [{ old_string: "x = 1", new_string: "x = 2" }] }), d.ctx("sua"));
    expect(kq.ok).toBe(true);
    expect(d.duyet).toHaveLength(1);
    expect(d.duyet[0]).toMatchObject({ loai: "ghi", duongTuongDoi: "src/a.ts", goc: "const x = 1;\n", moi: "const x = 2;\n", thaoTac: "thay" });
    expect(d.ap[0].thaoTac).toEqual({ loai: "thay", noiDungMoi: "const x = 2;\n" });
    expect(d.ap[0].bamGoc).toBe(bam("const x = 1;\n"));
    expect(d.so.danhSach()).toEqual([{ duongTuyetDoi: P("src/a.ts"), duongTuongDoi: "src/a.ts", goc: "const x = 1;\n", bamSau: bam("const x = 2;\n") }]);
    expect(d.suKien.map((e) => e.loai)).toEqual(["can-duyet", "da-duyet", "checkpoint"]);
  });

  it("★★★ nhiều tệp + tạo + xoá + đổi tên trong MỘT lượt chạy ⇒ checkpoint giữ GỐC của lần chạm đầu", async () => {
    may.tep.set(P("a.ts"), "A1");
    may.tep.set(P("b.ts"), "B");
    may.tep.set(P("c.ts"), "C");
    const d = dung();
    const c = d.ctx("sua");
    await d.bo.chay(goi("write_file", { path: "a.ts", content: "A2" }, "1"), c);
    await d.bo.chay(goi("write_file", { path: "a.ts", content: "A3" }, "2"), c);
    await d.bo.chay(goi("write_file", { path: "moi/n.ts", content: "N" }, "3"), c);
    await d.bo.chay(goi("delete_file", { path: "b.ts" }, "4"), c);
    await d.bo.chay(goi("rename_file", { from: "c.ts", to: "d.ts" }, "5"), c);
    expect(d.ap.map((x) => x.thaoTac!.loai)).toEqual(["thay", "thay", "tao", "xoa", "doi-ten"]);
    expect(d.duyet).toHaveLength(5);
    const ds = Object.fromEntries(d.so.danhSach().map((m) => [m.duongTuongDoi, [m.goc, m.bamSau]]));
    expect(ds["a.ts"]).toEqual(["A1", bam("A3")]);
    expect(ds["moi/n.ts"]).toEqual([null, bam("N")]);
    expect(ds["b.ts"]).toEqual(["B", null]);
    expect(ds["c.ts"]).toEqual(["C", null]);
    expect(ds["d.ts"]).toEqual([null, bam("C")]);
  });

  it("★★★ người BÁC (có lý do) ⇒ KHÔNG gọi apBanVa, model nhận lý do", async () => {
    may.tep.set(P("a.ts"), "A");
    const d = dung({ quyetDinh: { duyet: false, lyDo: "đừng đổi API công khai" } });
    const kq = await d.bo.chay(goi("write_file", { path: "a.ts", content: "B" }), d.ctx("sua"));
    expect(kq.ok).toBe(false);
    expect(kq.ma).toBe("BI_BAC");
    expect(kq.choModel).toContain("đừng đổi API công khai");
    expect(d.ap).toHaveLength(0);
    expect(d.suKien.some((e) => e.loai === "bi-bac")).toBe(true);
  });

  it("★★★ tu-dong CHỈ bỏ duyệt khi mức quyền tu_ghi; tu-dong + hoi_truoc_khi_ghi vẫn hỏi", async () => {
    may.tep.set(P("a.ts"), "A");
    const d1 = dung({ mucQuyen: "tu_ghi" });
    await d1.bo.chay(goi("write_file", { path: "a.ts", content: "B" }), d1.ctx("tu-dong"));
    expect(d1.duyet).toHaveLength(0);
    expect(d1.ap).toHaveLength(1);
    may.tep.set(P("a.ts"), "A");
    const d2 = dung({ mucQuyen: "hoi_truoc_khi_ghi" });
    await d2.bo.chay(goi("write_file", { path: "a.ts", content: "B" }), d2.ctx("tu-dong"));
    expect(d2.duyet).toHaveLength(1);
  });

  it("★★★ mức quyền chi_doc ⇒ KHÔNG thẻ duyệt, đi thẳng tới apBanVa THẬT và bị chặn ở bước 0 (tệp không đổi)", async () => {
    may.tep.set(P("a.ts"), "A");
    const d = dung({ mucQuyen: "chi_doc", apThat: true });
    const kq = await d.bo.chay(goi("write_file", { path: "a.ts", content: "B" }), d.ctx("sua"));
    expect(kq.ok).toBe(false);
    expect(kq.choModel).toMatch(/Chỉ đọc/);
    expect(d.duyet).toHaveLength(0);
    expect(may.tep.get(P("a.ts"))).toBe("A");
    expect(d.so.rong).toBe(true);
  });

  it("★★ chưa có token cá nhân (sổ kiểm toán qua Bearer) ⇒ không hỏi, không ghi, nói rõ cần đăng nhập device flow", async () => {
    may.tep.set(P("a.ts"), "A");
    const d = dung({ token: undefined });
    const kq = await d.bo.chay(goi("write_file", { path: "a.ts", content: "B" }), d.ctx("sua"));
    expect(kq.ma).toBe("CHUA_CO_TOKEN_GHI_SO");
    expect(kq.choModel).toMatch(/device flow/);
    expect(d.duyet).toHaveLength(0);
    expect(d.ap).toHaveLength(0);
  });

  it("★★★ 4B-client — lượt ghi đưa TOKEN cá nhân (không cookie) xuống apBanVa để sổ đi REST Bearer", async () => {
    may.tep.set(P("a.ts"), "A");
    const d = dung();
    const kq = await d.bo.chay(goi("write_file", { path: "a.ts", content: "B" }), d.ctx("sua"));
    expect(kq.ok).toBe(true);
    expect(d.ap).toHaveLength(1);
    expect(d.ap[0].tokenGateway).toBe("avgw_tok");
    expect(d.ap[0].cookie).toBeUndefined();
  });

  it("★★★ 4B-client — token cũ thiếu 'apply' ⇒ mã THIEU_PHAM_VI_APPLY về model kèm lệnh ĐỪNG thử ghi lại", async () => {
    may.tep.set(P("a.ts"), "A");
    const d = dung({
      apKq: { ok: false, ma: "THIEU_PHAM_VI_APPLY", thongDiep: "KHÔNG GHI — … đăng nhập lại để cấp quyền ghi sổ …" },
    });
    const kq = await d.bo.chay(goi("write_file", { path: "a.ts", content: "B" }), d.ctx("sua"));
    expect(kq.ok).toBe(false);
    expect(kq.ma).toBe("THIEU_PHAM_VI_APPLY");
    expect(kq.choModel).toMatch(/apply/);
    expect(kq.choModel).toMatch(/[Dd]o not retry/);
    expect(may.tep.get(P("a.ts"))).toBe("A");
  });

  it("★★★ ghi .env / ra ngoài workspace / .git/hooks ⇒ chặn SỚM: không thẻ duyệt, không đọc nội dung, không apBanVa", async () => {
    may.tep.set(P(".env"), "DATABASE_URL=postgres://u:p@h/db");
    const d = dung();
    for (const [ten, thamSo] of [
      ["write_file", { path: ".env", content: "X=1" }],
      ["edit_file", { path: ".env", edits: [{ old_string: "postgres", new_string: "mysql" }] }],
      ["write_file", { path: "../ngoai.ts", content: "x" }],
      ["write_file", { path: ".git/hooks/pre-commit", content: "rm -rf /" }],
      ["rename_file", { from: "src/a.ts", to: "../../ngoai.ts" }],
    ] as const) {
      const kq = await d.bo.chay(goi(ten, thamSo as Record<string, unknown>), d.ctx("sua"));
      expect(kq.ok, `${ten} ${JSON.stringify(thamSo)}`).toBe(false);
      expect(kq.choModel).not.toContain("postgres://");
    }
    expect(d.duyet).toHaveLength(0);
    expect(d.ap).toHaveLength(0);
  });

  it("★★ edit_file old_string không khớp ⇒ lỗi cho model, không hỏi người", async () => {
    may.tep.set(P("a.ts"), "A");
    const d = dung();
    const kq = await d.bo.chay(goi("edit_file", { path: "a.ts", edits: [{ old_string: "ZZZ", new_string: "Y" }] }), d.ctx());
    expect(kq.ma).toBe("KHONG_TIM_THAY");
    expect(d.duyet).toHaveLength(0);
  });
});

describe("BoThucThiVscode — lệnh + nhớ", () => {
  it("★★★ run_command trong allowlist ⇒ hỏi ⇒ chạy ⇒ ĐẦU RA + EXIT CODE về MODEL", async () => {
    const d = dung({ exit: 1 });
    const kq = await d.bo.chay(goi("run_command", { command: "npx vitest run src/a.test.ts" }), d.ctx("sua"));
    expect(d.duyet[0]).toMatchObject({ loai: "lenh", lenh: "npx vitest run src/a.test.ts" });
    expect(d.lenh).toEqual([["npx", "--no-install", "vitest", "run", "src/a.test.ts"]]);
    expect(kq.ok).toBe(false);
    expect(kq.choModel).toMatch(/^exit code: 1/);
    expect(kq.choModel).toContain("expected 3, got 4");
  });

  it("★★★ run_command LUÔN hỏi kể cả tu-dong + tu_ghi; lệnh ngoài allowlist ⇒ không hỏi, không chạy", async () => {
    const d = dung({ mucQuyen: "tu_ghi" });
    await d.bo.chay(goi("run_command", { command: "git status" }), d.ctx("tu-dong"));
    expect(d.duyet).toHaveLength(1);
    const kq = await d.bo.chay(goi("run_command", { command: "rm -rf /" }), d.ctx("tu-dong"));
    expect(kq.ma).toBe("LENH_KHONG_DUOC_PHEP");
    expect(d.lenh).toHaveLength(1);
  });

  it("★★★ RÀ BẢO MẬT — cờ ở vị trí <path> (vitest --update/--inspect-brk, dotnet -bl) ⇒ KHÔNG hỏi, KHÔNG chạy, kể cả tu-dong + tu_ghi", async () => {
    const d = dung({ mucQuyen: "tu_ghi" });
    for (const c of ["npx vitest run --update", "npx vitest run --inspect-brk", "dotnet build -bl", "dotnet test --blame", "git diff --output=x.txt"]) {
      const kq = await d.bo.chay(goi("run_command", { command: c }), d.ctx("tu-dong"));
      expect(kq.ma, c).toBe("LENH_KHONG_DUOC_PHEP");
    }
    expect(d.duyet).toHaveLength(0);
    expect(d.lenh).toHaveLength(0);
  });

  it("★★★ RÀ BẢO MẬT — git diff: khối của tệp cấm (.env đã theo dõi) KHÔNG về model, KHÔNG lên thẻ", async () => {
    const PAT = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const output =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n+const a = 1;\n" +
      `diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n+GITHUB_PAT=${PAT}\n`;
    const d = dung({ output });
    const kq = await d.bo.chay(goi("run_command", { command: "git diff" }), d.ctx("sua"));
    expect(kq.choModel).toContain("+const a = 1;");
    expect(kq.choModel).not.toContain(PAT);
    expect(JSON.stringify(kq.hienThi)).not.toContain(PAT);
    expect(kq.choModel).toMatch(/\.env/);
  });

  it("★★★ RÀ BẢO MẬT — tu-dong + tu_ghi: lượt đã TỰ GHI tệp (không thẻ) ⇒ thẻ duyệt LỆNH phải nói rõ tệp đó (lệnh có thể chạy mã vừa ghi)", async () => {
    const d = dung({ mucQuyen: "tu_ghi" });
    await d.bo.chay(goi("write_file", { path: "package.json", content: '{"scripts":{"check":"node x.js"}}' }), d.ctx("tu-dong"));
    expect(d.duyet).toHaveLength(0);
    await d.bo.chay(goi("run_command", { command: "npm run check" }), d.ctx("tu-dong"));
    expect(d.duyet).toHaveLength(1);
    expect(d.duyet[0].tomTat).toContain("package.json");
  });

  it("★★★ remember ⇒ CHỈ phát đề xuất (đã che bí mật), không ghi gì", async () => {
    const d = dung();
    const kq = await d.bo.chay(goi("remember", { note: "Dự án dùng pnpm. token sk-abcdefghijklmnopqrstuvwxyz0123", scope: "project" }), d.ctx("hoi"));
    expect(kq.ok).toBe(true);
    const e = d.suKien.find((x) => x.loai === "de-xuat-nho") as Extract<SuKienAgent, { loai: "de-xuat-nho" }>;
    expect(e.note).toContain("pnpm");
    expect(e.note).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(d.ap).toHaveLength(0);
  });
});
