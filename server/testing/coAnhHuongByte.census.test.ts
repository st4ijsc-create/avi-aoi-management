/**
 * V1.1 + V1.2 — CENSUS cờ ảnh hưởng byte (phát lại fixture H4.2). THUẦN: quét AST mã nguồn (server/ + shared/, không test), không CSDL, không mạng.
 * Bất biến (mỗi bất biến một nhóm ca; đột biến phải ĐỎ):
 *   (1) mọi cờ có trong mã thuộc ĐÚNG MỘT nhóm trong `coAnhHuongByte.ts` — chưa phân loại ⇒ ĐỎ; mục không còn trong mã ⇒ ĐỎ;
 *   (2) cờ `doi-byte`: `vang` PHẢI bằng mặc định THẬT của mã tại chỗ đọc (gọi hàm đọc cờ thật, hoặc đọc AST phép so sánh) — lệch ⇒ ĐỎ: chốt chống "danh sách sai che thay đổi thật";
 *   (3) V1.2: mặc định BẬT chỉ hợp lệ với cờ thuộc danh sách đóng "bật từ đầu", hoặc khi ĐÃ CÓ fixture ghi với cờ bật.
 * ĐỘT BIẾN PHẢI BẮT: đổi mặc định một cờ sang bật (hàm đọc cờ) · đổi mặc định mà sửa cả danh sách nhưng không có fixture / không thuộc danh sách đóng · thêm cờ mới không phân loại ·
 * xoá mục còn dùng · nhóm sai · bỏ nhánh `phuBoi` · `banCoKhiPhatLai` không gỡ cờ ngoài fixture.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { nenMocDich, giuNghiBat, kiemDacTaBat } from "../../shared/agentCore/vongAgent";
import { csvBat } from "../services/aiLocalTools/csvTrongDuAn";
import { congCuBiAn, docTruocKhiGhiBat, goiYLenhBat, hanGioToolBat } from "../services/ai/agent/boThucThiMayChu";
import { dauRaDaiBat } from "../services/ai/agent/khoDauRaDai";
import { tiepTucBat } from "../services/ai/agent/khoLichSuLuot";
import { soLuotToiDaTuEnv } from "../services/ai/agent/gioiHanLuot";
import { apNganSachEp, nganSachEpTuEnv } from "../services/ai/agent/nganSachNguCanh";
import { banGhiNganSachBatDau } from "../services/ai/agent/ghiNganSachBatDau";
import { tacNhanTheoVaiTroBat } from "../services/ai/agent/vaiTroTacNhan";
import { tuTraApiBat } from "../services/ai/apiRef/goiYLoiBienDich";
import { chonTacVuModel } from "../services/ai/chonTacVuModel";
import { HAN_GIO_MUC_LUC_MS, NGUONG_DIEM_NGU_CANH_MA, hanGioMucLucMs, nguCanhMaEnabled, nguongDiemNguCanhMa } from "../services/ai/codingRepoContext";
import { baiHocEnabled } from "../services/ai/codingLessonContext";
import { kepTranVong, kepTranVongTuTri, TRAN_VONG_MAC_DINH } from "../../shared/aiCodingLoop";
import { cheDoCompileStTacNhan } from "../services/ai/st/kiemBienDichSt";
import {
  CO_ANH_HUONG_BYTE,
  CO_MAC_DINH_BAT_TU_DAU,
  CO_QUET_THEM,
  TIEN_TO_CO_QUET,
  banCoKhiPhatLai,
  tenCoDoiByte,
  type CoAnhHuongByte,
  type GiaTriVang,
} from "./coAnhHuongByte";

const GOC = path.resolve(__dirname, "..", "..");
const THU_MUC_FIXTURE = path.join(__dirname, "fixtures", "phat-lai");

interface LanDoc {
  file: string;
  dong: number;
  /** mặc định suy từ phép so sánh quanh chỗ đọc; `null` = không suy được */
  macDinh: GiaTriVang | null;
}
interface ThongTinCo {
  /** mọi chỗ tên cờ xuất hiện (chuỗi chữ hoặc `.TEN`) */
  nhac: Array<{ file: string; dong: number }>;
  /** chỗ ĐỌC biến môi trường (`<x>.env.TEN`, `env.TEN`) */
  doc: LanDoc[];
}

const laTenCo = (t: string) => TIEN_TO_CO_QUET.some((p) => t.startsWith(p)) || CO_QUET_THEM.includes(t);
const RE_TEN = /^[A-Z][A-Z0-9_]+$/;

/** Mặc định suy từ cách mã so sánh giá trị cờ. Bảng: so với "0" ⇒ mặc định BẬT; so với giá trị khác: `===` ⇒ bật khi bằng; `!==` ⇒ bật khi khác. `Number(…)` ⇒ cờ giá trị. */
export function macDinhTuViTriDoc(node: ts.PropertyAccessExpression): GiaTriVang | null {
  let cur: ts.Node = node;
  let vang: string | undefined;
  for (let i = 0; i < 12; i++) {
    const cha = cur.parent;
    if (!cha) return null;
    if (ts.isParenthesizedExpression(cha)) {
      cur = cha;
      continue;
    }
    if (ts.isBinaryExpression(cha) && cha.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && cha.left === cur && ts.isStringLiteral(cha.right)) {
      vang = cha.right.text;
      cur = cha;
      continue;
    }
    if (ts.isPropertyAccessExpression(cha) && cha.expression === cur && ts.isCallExpression(cha.parent) && cha.parent.expression === cha) {
      cur = cha.parent; // .trim() / .toLowerCase()
      continue;
    }
    if (ts.isCallExpression(cha) && cha.arguments[0] === cur) {
      const ten = cha.expression.getText();
      if (ten === "String") {
        cur = cha;
        continue;
      }
      if (/^(Number|parseInt|parseFloat|Number\.parseInt|Number\.parseFloat)$/.test(ten)) return "khong-dat";
      return null;
    }
    if (ts.isVariableDeclaration(cha) && cha.initializer === cur && vang === "") return "khong-dat"; // `const x = (env.X ?? "").trim()` ⇒ cờ giá trị, vắng ⇒ rỗng
    if (ts.isBinaryExpression(cha) && (cha.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || cha.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
      const khac = cha.left === cur ? cha.right : cha.left;
      if (!ts.isStringLiteral(khac)) return null;
      const L = khac.text;
      const bang = cha.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
      // CHỈ ba dạng có HƯỚNG rõ (còn lại AST không biết nhánh nào bật ⇒ null ⇒ bắt buộc PROBE: hàm đọc cờ thật):
      //   `=== "1"`  : bật khi bằng "1"      ⇒ mặc định bật ⇔ giá trị-khi-vắng (fallback) === "1"
      //   `!== "0"`  : bật trừ khi "0"       ⇒ mặc định bật ⇔ fallback !== "0"
      //   `=== "0"`  : TẮT khi "0" (kill-switch) ⇒ mặc định bật ⇔ fallback !== "0"
      // Kill-switch `=== "off"` / `"false"` / `"no"`, `!== "1"`, `=== "code"`… ⇒ không suy.
      if (L === "1" && bang) return vang === "1" ? "bat" : "tat";
      if (L === "0") return vang !== "0" ? "bat" : "tat";
      return null;
    }
    return null;
  }
  return null;
}

function quetMa(): Map<string, ThongTinCo> {
  const ra = new Map<string, ThongTinCo>();
  const lay = (k: string) => {
    let t = ra.get(k);
    if (!t) ra.set(k, (t = { nhac: [], doc: [] }));
    return t;
  };
  const di = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (["node_modules", "__fixtures__", "fixtures", "dist"].includes(e.name)) continue;
        di(p);
      } else if (/\.(ts|tsx|mjs|cjs)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) && e.name !== "coAnhHuongByte.ts") {
        const sf = ts.createSourceFile(p, fs.readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true);
        const rel = path.relative(GOC, p).split(path.sep).join("/");
        const vao = (n: ts.Node) => {
          const dong = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && RE_TEN.test(n.text) && laTenCo(n.text)) lay(n.text).nhac.push({ file: rel, dong });
          if (ts.isPropertyAccessExpression(n) && RE_TEN.test(n.name.text) && laTenCo(n.name.text)) {
            const t = lay(n.name.text);
            t.nhac.push({ file: rel, dong });
            if (/(^|\.)env$/.test(n.expression.getText())) t.doc.push({ file: rel, dong, macDinh: macDinhTuViTriDoc(n) });
          }
          ts.forEachChild(n, vao);
        };
        vao(sf);
      }
    }
  };
  di(path.join(GOC, "server"));
  di(path.join(GOC, "shared"));
  return ra;
}

const b = (x: boolean): GiaTriVang => (x ? "bat" : "tat");
/** Chạy `fn` khi biến môi trường `ten` VẮNG (các hàm đọc env tại chỗ gọi không nhận tham số); trả lại giá trị cũ sau đó. */
function khiEnvVang<T>(ten: string, fn: () => T): T {
  const cu = process.env[ten];
  delete process.env[ten];
  try {
    return fn();
  } finally {
    if (cu !== undefined) process.env[ten] = cu;
  }
}
/** Hàm đọc cờ THẬT của mã, gọi với cờ VẮNG (đối số rỗng / bỏ trống — chú ý tham số mặc định đọc `process.env`, nên truyền chuỗi rỗng khi hàm có tham số mặc định). */
const PROBE: Record<string, () => GiaTriVang> = {
  AI_CODING_AUTOLOOP_MAX: () => (kepTranVong(undefined) === TRAN_VONG_MAC_DINH ? "khong-dat" : "bat"),
  AI_CODING_TU_TRI_GHI_MAX: () => (kepTranVongTuTri(undefined) === TRAN_VONG_MAC_DINH ? "khong-dat" : "bat"),
  AI_CODING_LESSONS: () => khiEnvVang("AI_CODING_LESSONS", () => b(baiHocEnabled())),
  AI_CODING_REPO_CONTEXT: () => khiEnvVang("AI_CODING_REPO_CONTEXT", () => b(nguCanhMaEnabled())),
  AI_CODING_REPO_CONTEXT_MIN_SCORE: () => khiEnvVang("AI_CODING_REPO_CONTEXT_MIN_SCORE", () => (nguongDiemNguCanhMa() === NGUONG_DIEM_NGU_CANH_MA ? "khong-dat" : "bat")),
  AI_CODING_REPO_CONTEXT_TIMEOUT_MS: () => khiEnvVang("AI_CODING_REPO_CONTEXT_TIMEOUT_MS", () => (hanGioMucLucMs() === HAN_GIO_MUC_LUC_MS ? "khong-dat" : "bat")),
  AI_AGENT_AN_CONG_CU: () => (congCuBiAn("").size === 0 ? "khong-dat" : "bat"),
  AI_AGENT_CSV_DOC: () => b(csvBat(undefined)),
  AI_AGENT_CUU_TRAN: () => b(giuNghiBat(undefined)),
  AI_AGENT_DAU_RA_DAI: () => b(dauRaDaiBat(undefined)),
  AI_AGENT_DOC_TRUOC_KHI_GHI: () => b(docTruocKhiGhiBat(undefined)),
  AI_AGENT_GIU_NGHI: () => b(giuNghiBat(undefined)),
  AI_AGENT_GOI_Y_LENH: () => b(goiYLenhBat(undefined)),
  AI_AGENT_KIEM_DAC_TA: () => b(kiemDacTaBat(undefined)),
  AI_AGENT_NEN_MOC: () => (nenMocDich(undefined) === undefined ? "khong-dat" : "bat"),
  AI_AGENT_SO_LUOT_TOI_DA: () => (soLuotToiDaTuEnv({}) === undefined ? "khong-dat" : "bat"),
  // hai chỗ đọc (nganSachNguCanh.ts:61, ghiNganSachBatDau.ts:14): vắng ⇒ không ép (ngân sách thật giữ nguyên) VÀ không ghi bản ghi ngân sách
  AI_AGENT_NGAN_SACH_EP: () =>
    nganSachEpTuEnv(undefined) === undefined && apNganSachEp(65_536, undefined) === 65_536 && banGhiNganSachBatDau({}, undefined) === null ? "khong-dat" : "bat",
  AI_AGENT_THEO_VAI_TRO: () => b(tacNhanTheoVaiTroBat({})),
  AI_AGENT_TIEP_TUC: () => b(tiepTucBat(undefined)),
  AI_AGENT_TOOL_TIMEOUT: () => b(hanGioToolBat(undefined)),
  AI_AGENT_TU_TRA_API: () => b(tuTraApiBat("")),
  AI_CODING_MODEL_TASK: () => (chonTacVuModel(undefined, undefined) === "code" ? "bat" : "tat"),
  AI_KIEM_BIEN_DICH_ST: () => `chuoi:${cheDoCompileStTacNhan({})}`,
};

/** Mặc định THẬT của một cờ: hàm đọc thật nếu có, nếu không thì suy từ mọi chỗ đọc (phải đồng nhất). */
function macDinhThat(ten: string, tt: ThongTinCo | undefined): { gia: GiaTriVang | null; nguon: string } {
  const probe = PROBE[ten];
  if (probe) return { gia: probe(), nguon: "hàm đọc thật" };
  const suy = (tt?.doc ?? []).map((d) => d.macDinh);
  if (suy.length === 0) return { gia: null, nguon: "không có chỗ đọc env nào trong mã" };
  if (suy.some((x) => x === null)) return { gia: null, nguon: `có chỗ đọc không suy được mặc định: ${(tt?.doc ?? []).filter((d) => d.macDinh === null).map((d) => `${d.file}:${d.dong}`).join(", ")}` };
  const khac = new Set(suy);
  if (khac.size > 1) return { gia: null, nguon: `các chỗ đọc mâu thuẫn nhau: ${[...khac].join(" / ")}` };
  return { gia: suy[0] as GiaTriVang, nguon: "AST" };
}

/** V1.2: có ít nhất MỘT fixture trong thư mục ghi với `moiTruong[ten]` BẬT ("1")? Thuần trên thư mục truyền vào. */
export function coFixtureGhiVoiCoBat(ten: string, thuMuc: string = THU_MUC_FIXTURE): boolean {
  if (!fs.existsSync(thuMuc)) return false;
  for (const t of fs.readdirSync(thuMuc)) {
    if (!t.endsWith(".json.gz")) continue;
    try {
      const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(thuMuc, t))).toString("utf8")) as { lenh?: { moiTruong?: Record<string, string> } };
      if (fx.lenh?.moiTruong?.[ten] === "1") return true;
    } catch {
      /* tệp hỏng không làm census đỏ ở đây — phatLaiFixture.test bắt */
    }
  }
  return false;
}

const MA = quetMa();
const TEN_THEO_MA = [...MA.keys()].sort();

describe("(1) phân loại: mọi cờ trong mã thuộc ĐÚNG MỘT nhóm", () => {
  const tenDS = CO_ANH_HUONG_BYTE.map((c) => c.ten);
  it("★★★ mọi cờ có trong mã đều có mục trong coAnhHuongByte.ts (chưa phân loại ⇒ ĐỎ, nêu tên + chỗ gặp đầu tiên)", () => {
    const chua = TEN_THEO_MA.filter((k) => !tenDS.includes(k)).map((k) => `${k} (${MA.get(k)!.nhac[0]!.file}:${MA.get(k)!.nhac[0]!.dong})`);
    expect(chua, "CỜ CHƯA PHÂN LOẠI — thêm vào coAnhHuongByte.ts với nhóm đúng").toEqual([]);
  });
  it("★★★ mọi mục trong danh sách còn được mã nhắc tới (mục thừa/cũ ⇒ ĐỎ)", () => {
    expect(tenDS.filter((k) => !MA.has(k))).toEqual([]);
  });
  it("★★★ không trùng tên; nhóm hợp lệ; `doi-byte` có `vang`; `khong-doi-byte` có `lyDo` không rỗng và KHÔNG có `vang`", () => {
    expect(new Set(tenDS).size).toBe(tenDS.length);
    for (const c of CO_ANH_HUONG_BYTE) {
      expect(["doi-byte", "khong-doi-byte"], c.ten).toContain(c.nhom);
      expect(c.lyDo.trim().length, `${c.ten}: lyDo`).toBeGreaterThan(5);
      if (c.nhom === "doi-byte") expect(c.vang, `${c.ten}: thiếu vang`).toBeDefined();
      else expect(c.vang, `${c.ten}: khong-doi-byte không khai vang`).toBeUndefined();
    }
  });
  it("★★ mọi cờ quét theo tiền tố hoặc trong CO_QUET_THEM; tên trong CO_QUET_THEM đều có mục", () => {
    for (const k of CO_QUET_THEM) expect(tenDS, k).toContain(k);
    for (const c of CO_ANH_HUONG_BYTE) expect(laTenCo(c.ten), c.ten).toBe(true);
  });
});

describe("(2) giá trị-khi-vắng khớp mặc định THẬT của mã (chốt chống danh sách sai)", () => {
  for (const c of CO_ANH_HUONG_BYTE.filter((x) => x.nhom === "doi-byte")) {
    it(`★★★ ${c.ten}: vang=${c.vang}`, () => {
      const { gia, nguon } = macDinhThat(c.ten, MA.get(c.ten));
      expect(gia, `không xác định được mặc định thật (${nguon}) — thêm hàm đọc vào PROBE`).not.toBeNull();
      expect(gia, `danh sách khai vang=${c.vang} nhưng mã thật mặc định ${gia} (${nguon})`).toBe(c.vang);
    });
  }
  it("★★★ cờ dạng KILL-SWITCH off/false/no và mẫu `?? '0'`: AST không suy được hướng ⇒ cờ thật dùng dạng đó PHẢI có PROBE (hàm đọc cờ thật), không dựa AST", () => {
    const CO_KILL = ["AI_AGENT_KIEM_DAC_TA", "AI_AGENT_GIU_NGHI", "AI_AGENT_CUU_TRAN", "AI_AGENT_TU_TRA_API", "AI_AGENT_THEO_VAI_TRO"];
    for (const ten of CO_KILL) expect(PROBE[ten], `${ten} phải có PROBE`).toBeDefined();
    // các cờ này đọc qua hàm chứa ["0","false","off","no"] / regex off|false|no ⇒ AST không suy: đúng chủ ý
    for (const ten of CO_KILL) for (const d of MA.get(ten)?.doc ?? []) expect(d.macDinh, `${ten} ${d.file}:${d.dong} — AST không được tự suy`).toBeNull();
  });
  it("★★★ trình suy AST chỉ suy ba dạng có HƯỚNG rõ, tính cả giá trị-khi-vắng (`?? \"0\"` đảo kết quả); kill-switch `off`/`false`/`no`, `!== \"1\"`, `=== \"code\"` ⇒ null (buộc PROBE)", () => {
    const suy = (ma: string) => {
      const sf = ts.createSourceFile("x.ts", ma, ts.ScriptTarget.Latest, true);
      let ra: GiaTriVang | null | undefined;
      const vao = (n: ts.Node) => {
        if (ts.isPropertyAccessExpression(n) && n.name.text === "AI_X" && ra === undefined) ra = macDinhTuViTriDoc(n);
        ts.forEachChild(n, vao);
      };
      vao(sf);
      return ra;
    };
    // dạng `=== "1"`
    expect(suy('const a = process.env.AI_X === "1";')).toBe("tat");
    expect(suy('const a = (process.env.AI_X ?? "1") === "1";')).toBe("bat");
    // dạng `!== "0"`
    expect(suy('const a = process.env.AI_X !== "0";')).toBe("bat");
    expect(suy('const a = (process.env.AI_X ?? "1").trim() !== "0";')).toBe("bat");
    expect(suy('const a = (process.env.AI_X ?? "0") !== "0";')).toBe("tat"); // fallback "0" ⇒ MẶC ĐỊNH TẮT (mẫu `?? "0"` cũ suy sai thành bật)
    // dạng kill-switch `=== "0"`
    expect(suy('const a = String(process.env.AI_X ?? "").trim() === "0";')).toBe("bat");
    expect(suy('const a = (process.env.AI_X ?? "0") === "0";')).toBe("tat");
    // không suy
    expect(suy('const a = process.env.AI_X === "off";')).toBeNull();
    expect(suy('const a = (process.env.AI_X ?? "").toLowerCase() === "false";')).toBeNull();
    expect(suy('const a = process.env.AI_X === "no";')).toBeNull();
    expect(suy('const a = (process.env.AI_X ?? "on") !== "on";')).toBeNull();
    expect(suy('const a = (process.env.AI_X ?? "").trim() !== "1";')).toBeNull();
    expect(suy('const a = process.env.AI_X === "code";')).toBeNull();
    // cờ giá trị / không suy được
    expect(suy("const a = Number(process.env.AI_X);")).toBe("khong-dat");
    expect(suy('const a = (process.env.AI_X ?? "").trim();')).toBe("khong-dat");
    expect(suy("const a = f(process.env.AI_X);")).toBeNull();
    expect(suy("const a = process.env.AI_X;")).toBeNull();
  });
});

describe("(3) V1.2 — mặc định BẬT cần lý do được kiểm", () => {
  const bat = CO_ANH_HUONG_BYTE.filter((c) => c.vang === "bat");
  it("★★★ mọi cờ vang=bat phải khai phuBoi", () => {
    for (const c of bat) expect(c.phuBoi, `${c.ten}: vang=bat thiếu phuBoi`).toBeDefined();
  });
  it("★★★ KHOÁ DANH SÁCH ĐÓNG = ĐÚNG 16 TÊN (so với danh sách tường minh): thêm hay bớt một tên ⇒ ĐỎ, người rà thấy ngay", () => {
    const TUONG_MINH = [
      "AI_AGENT_CUU_TRAN",
      "AI_AGENT_GIU_NGHI",
      "AI_AGENT_KIEM_DAC_TA",
      "AI_AGENT_NGHI",
      "AI_AGENT_THEO_VAI_TRO",
      "AI_AGENT_TU_TRA_API",
      "AI_CODING_BO_SUNG_USING",
      "AI_CODING_EDIT",
      "AI_CODING_EDIT_HUNKS",
      "AI_CODING_GEN",
      "AI_CODING_LESSONS",
      "AI_CODING_REPO_CONTEXT",
      "AI_CODING_TOOL_LLM",
      "AI_CODING_TOOL_LOOP",
      "AI_CODING_TOOL_VETO",
      "AI_CODING_USING_MO_RONG",
    ];
    expect(TUONG_MINH).toHaveLength(16);
    expect([...CO_MAC_DINH_BAT_TU_DAU].sort()).toEqual([...TUONG_MINH].sort());
    expect(CO_MAC_DINH_BAT_TU_DAU).toHaveLength(16);
    expect(new Set(CO_MAC_DINH_BAT_TU_DAU).size).toBe(16);
  });
  it("★★★ `mac-dinh-tu-dau` CHỈ cho cờ trong danh sách đóng CO_MAC_DINH_BAT_TU_DAU, và mọi cờ trong danh sách đóng đều khai đúng như vậy", () => {
    for (const c of bat.filter((x) => x.phuBoi === "mac-dinh-tu-dau")) expect(CO_MAC_DINH_BAT_TU_DAU, `${c.ten} không thuộc danh sách đóng`).toContain(c.ten);
    for (const ten of CO_MAC_DINH_BAT_TU_DAU) {
      const c = CO_ANH_HUONG_BYTE.find((x) => x.ten === ten);
      expect(c, ten).toBeDefined();
      expect(c?.vang, ten).toBe("bat");
      expect(c?.phuBoi, ten).toBe("mac-dinh-tu-dau");
    }
  });
  it("★★★ cờ vang=bat + phuBoi=fixture-co-bat ⇒ ĐÃ CÓ fixture ghi với cờ bật (chặn đổi mặc định khi không có fixture phủ nhánh bật)", () => {
    for (const c of bat.filter((x) => x.phuBoi === "fixture-co-bat")) expect(coFixtureGhiVoiCoBat(c.ten), `${c.ten}: chưa có fixture nào ghi với cờ =1`).toBe(true);
  });
  it("★★ chỉ cờ `doi-byte` mới có phuBoi", () => {
    for (const c of CO_ANH_HUONG_BYTE.filter((x) => x.phuBoi !== undefined)) expect(c.vang, c.ten).toBe("bat");
  });
});

describe("khong-doi-byte — nhãn bằng chứng + kiểm tĩnh (đếm điểm gọi)", () => {
  const kd = CO_ANH_HUONG_BYTE.filter((c) => c.nhom === "khong-doi-byte");
  it("★★★ mọi mục `khong-doi-byte` khai `bangChung`: `doc` (bằng đọc, CHƯA đo) hoặc `do-tinh`; mục `doi-byte` không có", () => {
    for (const c of kd) expect(["doc", "do-tinh"], c.ten).toContain(c.bangChung);
    for (const c of CO_ANH_HUONG_BYTE.filter((x) => x.nhom === "doi-byte")) expect(c.bangChung, c.ten).toBeUndefined();
    expect(kd.filter((c) => c.bangChung === "do-tinh").map((c) => c.ten).sort()).toEqual(["AI_AGENT_TU_DONG", "AI_AGENT_UOC_LUONG_TOKEN"]);
    expect(kd.filter((c) => c.bangChung === "doc").map((c) => c.ten).sort()).toEqual([
      "AI_AGENT_HOAN_TAC",
      "AI_AGENT_HOUSEKEEPING_ENABLED",
      "AI_AGENT_HOUSEKEEPING_INTERVAL_MS",
      "AI_CODING_AUTOLOOP_VERIFY",
      "AI_CODING_TU_TRI_LUOT",
      "AI_GHI_LUOT_DIR",
    ]);
  });
  const dem = (re: RegExp) => {
    const ra: Array<{ rel: string; n: number }> = [];
    const di = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (["node_modules", "__fixtures__", "fixtures", "dist"].includes(e.name)) continue;
          di(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) && e.name !== "coAnhHuongByte.ts") {
          const t = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
          const n = (t.match(re) ?? []).length;
          if (n > 0) ra.push({ rel: path.relative(GOC, p).split(path.sep).join("/"), n });
        }
      }
    };
    di(path.join(GOC, "server"));
    di(path.join(GOC, "shared"));
    return ra;
  };
  it("★★★ đo tĩnh AI_AGENT_TU_DONG: `LY_DO_AGENT_TU_DONG` chỉ có định nghĩa + MỘT chỗ dùng, và chỗ dùng là `reason` của confirmAction", () => {
    expect(dem(/\bLY_DO_AGENT_TU_DONG\b/g)).toEqual([{ rel: "server/services/ai/agent/boThucThiMayChu.ts", n: 2 }]);
    const t = fs.readFileSync(path.join(GOC, "server/services/ai/agent/boThucThiMayChu.ts"), "utf8");
    expect(t).toMatch(/confirmAction\([^;]*\{\s*reason:\s*LY_DO_AGENT_TU_DONG\s*\}/);
  });
  it("★★★ đo tĩnh AI_AGENT_UOC_LUONG_TOKEN: `uocLuongTokenLuotChay(` chỉ ở vaiTroTacNhan.ts (định nghĩa + MỘT lời gọi), đưa vào khoá `uocLuongToken` của yêu cầu cổng quota; không điểm gọi nào khác (không đi vào dựng tin)", () => {
    expect(dem(/\buocLuongTokenLuotChay\(/g)).toEqual([{ rel: "server/services/ai/agent/vaiTroTacNhan.ts", n: 2 }]);
    const t = fs.readFileSync(path.join(GOC, "server/services/ai/agent/vaiTroTacNhan.ts"), "utf8");
    expect(t).toMatch(/uocLuongToken:\s*uocLuongTokenLuotChay\(env\)/);
  });
});

describe("coFixtureGhiVoiCoBat — dò thư mục fixture", () => {
  let tam = "";
  afterEach(() => tam && fs.rmSync(tam, { recursive: true, force: true }));
  const ghi = (ten: string, moiTruong: Record<string, string> | undefined) => fs.writeFileSync(path.join(tam, ten), zlib.gzipSync(JSON.stringify({ lenh: { moiTruong } })));
  it("★★★ có / không có fixture với cờ =1; giá trị khác `1` không tính; thư mục không có ⇒ false; tệp hỏng bị bỏ qua", () => {
    tam = fs.mkdtempSync(path.join(os.tmpdir(), "co-byte-"));
    ghi("a.json.gz", { AI_AGENT_X: "0", AI_AGENT_Y: "1" });
    ghi("b.json.gz", undefined);
    fs.writeFileSync(path.join(tam, "hong.json.gz"), "khong phai gzip");
    expect(coFixtureGhiVoiCoBat("AI_AGENT_Y", tam)).toBe(true);
    expect(coFixtureGhiVoiCoBat("AI_AGENT_X", tam)).toBe(false);
    expect(coFixtureGhiVoiCoBat("AI_AGENT_Z", tam)).toBe(false);
    expect(coFixtureGhiVoiCoBat("AI_AGENT_Y", path.join(tam, "khong-co"))).toBe(false);
  });
});

describe("banCoKhiPhatLai — ghim cờ khi phát lại (V1.1)", () => {
  it("★★★ cờ doi-byte KHÔNG có trong fixture ⇒ GỠ (kể cả cờ đang bật ở môi trường chạy test); cờ của fixture ⇒ giữ giá trị lúc ghi", () => {
    const ban = banCoKhiPhatLai({ AI_AGENT_NEN_MOC: "0.5", AI_AGENTIC_ENABLED: "1" });
    expect(ban.dat).toEqual({ AI_AGENT_NEN_MOC: "0.5", AI_AGENTIC_ENABLED: "1" });
    expect(ban.xoa).toContain("AI_AGENT_GOI_Y_LENH");
    expect(ban.xoa).toContain("AI_AGENT_CSV_DOC");
    expect(ban.xoa).not.toContain("AI_AGENT_NEN_MOC");
    expect(ban.xoa).not.toContain("AI_AGENTIC_ENABLED");
  });
  it("★★★ cờ khung thử (vd THEO_VAI_TRO=0) được giữ khi fixture không khai; fixture khai thì fixture thắng; không cờ nào vừa đặt vừa gỡ", () => {
    const a = banCoKhiPhatLai(undefined, { AI_AGENT_THEO_VAI_TRO: "0", AI_CODING_TU_TRI_GHI: "1" });
    expect(a.dat).toEqual({ AI_AGENT_THEO_VAI_TRO: "0", AI_CODING_TU_TRI_GHI: "1" });
    expect(a.xoa).not.toContain("AI_AGENT_THEO_VAI_TRO");
    const b2 = banCoKhiPhatLai({ AI_AGENT_THEO_VAI_TRO: "1" }, { AI_AGENT_THEO_VAI_TRO: "0" });
    expect(b2.dat.AI_AGENT_THEO_VAI_TRO).toBe("1");
    for (const x of [a, b2]) for (const k of Object.keys(x.dat)) expect(x.xoa).not.toContain(k);
  });
  it("★★★ chỉ cờ doi-byte bị gỡ; cờ khong-doi-byte (HOUSEKEEPING, GHI_LUOT_DIR…) không bao giờ nằm trong xoa", () => {
    const ban = banCoKhiPhatLai({});
    expect([...ban.xoa].sort()).toEqual(tenCoDoiByte());
    for (const c of CO_ANH_HUONG_BYTE.filter((x) => x.nhom === "khong-doi-byte")) expect(ban.xoa).not.toContain(c.ten);
  });
  it("★★ áp dụng lên một đối tượng env giả: cờ bật sẵn bị gỡ, cờ fixture được đặt; kết quả không phụ thuộc môi trường ban đầu", () => {
    const apDung = (env: Record<string, string | undefined>, ban: ReturnType<typeof banCoKhiPhatLai>) => {
      const ra = { ...env };
      Object.assign(ra, ban.dat);
      for (const k of ban.xoa) delete ra[k];
      return ra;
    };
    const ban = banCoKhiPhatLai({ AI_CODING_MODEL_TASK: "code" }, { AI_AGENT_THEO_VAI_TRO: "0" });
    const sach = apDung({}, ban);
    const bat = apDung({ AI_AGENT_GOI_Y_LENH: "1", AI_AGENT_CSV_DOC: "1", AI_AGENT_NEN_SO_THAT: "1", AI_AGENT_GIU_NGHI: "0" }, ban);
    expect(bat).toEqual(sach);
  });
});
