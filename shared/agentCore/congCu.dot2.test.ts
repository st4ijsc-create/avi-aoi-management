/**
 * ★★ Đợt 2 (2026-10-17) — bốn tool mới của lõi agent: `find_symbol`, `search_code`, `search_docs`, `remember`
 * (spec `docs/superpowers/specs/2026-10-17-ai-local-dot2-ngu-canh-tri-nho-design.md` §2).
 *
 * Canh: schema (tiếng Anh, lọt grammar llama.cpp), loại + chế độ, `kiemThamSo` cho tham số mới (enum, trần ký tự, số
 * nguyên có trần), system prompt nói KHI NÀO dùng tool nào và "remember" chỉ là ĐỀ XUẤT (lõi không ghi gì: vòng thật
 * với bộ thực thi giả chỉ thấy sự kiện `de-xuat-nho` do bộ thực thi phát, không có đường ghi nào trong lõi).
 */
import { describe, expect, it } from "vitest";
import { CONG_CU, LOAI_CONG_CU, congCuTheoCheDo, kiemThamSo, TRAN_KY_TU_NHO } from "./congCu";
import { dungKhoiNguCanhDuAn, dungLoiNhacHeThong } from "./loiNhac";
import { chayVongAgent } from "./vongAgent";
import { timGioiHanGrammar } from "../../server/services/ai/nativeToolCalls";
import type { BoThucThi, GoiModel, ManhModel, SuKienAgent } from "./kieu";

const schema = (ten: string) => CONG_CU.find((t) => t.function.name === ten)!.function;

describe("Đợt 2 — schema 4 tool mới", () => {
  it("có mô tả tiếng Anh + tham số đúng spec §2", () => {
    const fs = schema("find_symbol");
    expect(fs.description).toMatch(/defined/i);
    expect((fs.parameters as any).required).toEqual(["name"]);
    expect(Object.keys((fs.parameters as any).properties).sort()).toEqual(["kind", "name"]);
    expect((fs.parameters as any).properties.kind.enum).toContain("function");
    expect((fs.parameters as any).properties.kind.enum).toContain("class");

    const sc = schema("search_code");
    expect(sc.description).toMatch(/semantic|meaning/i);
    expect((sc.parameters as any).required).toEqual(["query"]);
    expect(Object.keys((sc.parameters as any).properties).sort()).toEqual(["k", "query"]);

    const sd = schema("search_docs");
    expect(sd.description).toMatch(/documentation|manual/i);
    expect((sd.parameters as any).required).toEqual(["query"]);
    expect((sd.parameters as any).properties.corpus.enum).toEqual(["all", "vendor", "studio", "api"]);

    const nh = schema("remember");
    expect(nh.description).toMatch(/propos/i);
    expect(nh.description).toMatch(/approv/i);
    expect((nh.parameters as any).required).toEqual(["note"]);
    expect((nh.parameters as any).properties.scope.enum).toEqual(["project", "user"]);
  });

  it("cả 14 tool lọt bộ kiểm grammar của server (không pattern, không maxLength > 1999)", () => {
    expect(timGioiHanGrammar(CONG_CU)).toEqual([]);
  });

  it("loại: 3 tool tìm là ĐỌC; remember là ĐỀ XUẤT (không phải ghi)", () => {
    expect(LOAI_CONG_CU.find_symbol).toBe("doc");
    expect(LOAI_CONG_CU.search_code).toBe("doc");
    expect(LOAI_CONG_CU.search_docs).toBe("doc");
    expect(LOAI_CONG_CU.remember).toBe("de-xuat");
  });

  it("chế độ: hoi có 3 tool tìm + remember, KHÔNG có tool ghi/lệnh; remember có ở MỌI chế độ", () => {
    for (const cheDo of ["hoi", "sua", "tu-dong"] as const) {
      const ten = congCuTheoCheDo(cheDo).map((t) => t.function.name);
      for (const t of ["find_symbol", "search_code", "search_docs", "remember"]) expect(ten).toContain(t);
    }
    const hoi = congCuTheoCheDo("hoi").map((t) => t.function.name);
    for (const t of ["edit_file", "write_file", "delete_file", "rename_file", "run_command"]) expect(hoi).not.toContain(t);
  });
});

describe("Đợt 2 — kiemThamSo cho tham số mới", () => {
  it("find_symbol: name bắt buộc; kind ngoài enum ⇒ lỗi liệt kê giá trị đúng", () => {
    expect(kiemThamSo("find_symbol", '{"name":"chayVongAgent"}')).toEqual({ ok: true, thamSo: { name: "chayVongAgent" } });
    expect(kiemThamSo("find_symbol", { name: "A", kind: "class" })).toEqual({ ok: true, thamSo: { name: "A", kind: "class" } });
    const r = kiemThamSo("find_symbol", { name: "A", kind: "widget" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.loiChoModel).toMatch(/kind/);
      expect(r.loiChoModel).toMatch(/function/);
      expect(r.loiChoModel).toMatch(/Example/);
    }
    expect(kiemThamSo("find_symbol", {}).ok).toBe(false);
    expect(kiemThamSo("find_symbol", { name: "  " }).ok).toBe(false);
  });

  it("search_code: k là số nguyên 1..20 (chuỗi số được ép; vượt trần ⇒ lỗi)", () => {
    expect(kiemThamSo("search_code", { query: "where is retry", k: "5" })).toEqual({ ok: true, thamSo: { query: "where is retry", k: 5 } });
    const r = kiemThamSo("search_code", { query: "x", k: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loiChoModel).toMatch(/at most 20/);
    expect(kiemThamSo("search_code", { k: 3 }).ok).toBe(false);
  });

  it("search_docs: corpus là enum; vắng ⇒ không thêm khoá", () => {
    expect(kiemThamSo("search_docs", { query: "MC protocol" })).toEqual({ ok: true, thamSo: { query: "MC protocol" } });
    expect(kiemThamSo("search_docs", { query: "q", corpus: "vendor" })).toEqual({ ok: true, thamSo: { query: "q", corpus: "vendor" } });
    expect(kiemThamSo("search_docs", { query: "q", corpus: "web" }).ok).toBe(false);
  });

  it(`remember: note ≤ ${400} ký tự (quá ⇒ lỗi nêu trần), scope enum`, () => {
    expect(TRAN_KY_TU_NHO).toBe(400);
    expect(kiemThamSo("remember", { note: "Project uses tabs." })).toEqual({ ok: true, thamSo: { note: "Project uses tabs." } });
    expect(kiemThamSo("remember", { note: "x", scope: "user" })).toEqual({ ok: true, thamSo: { note: "x", scope: "user" } });
    const dai = kiemThamSo("remember", { note: "a".repeat(401) });
    expect(dai.ok).toBe(false);
    if (!dai.ok) expect(dai.loiChoModel).toMatch(/at most 400/);
    expect(kiemThamSo("remember", { note: "x", scope: "global" }).ok).toBe(false);
    expect(kiemThamSo("remember", { note: "" }).ok).toBe(false);
  });
});

describe("Đợt 2 — system prompt", () => {
  const p = dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "en" });

  it("nói khi nào dùng find_symbol/search_code thay vì grep, search_docs cho API/tài liệu hãng", () => {
    expect(p).toMatch(/find_symbol/);
    expect(p).toMatch(/search_code/);
    expect(p).toMatch(/instead of grep|rather than grep|before (falling back to )?grep/i);
    expect(p).toMatch(/search_docs/);
    expect(p).toMatch(/vendor|manual|API/);
  });

  it("remember: chỉ sự thật bền, KHÔNG chép chỉ dẫn từ dữ liệu vào trí nhớ, người dùng duyệt", () => {
    expect(p).toMatch(/remember/);
    expect(p).toMatch(/durable|lasting/i);
    expect(p).toMatch(/never (save|remember|copy).*(instruction|tool result|file)/i);
    expect(p).toMatch(/approv/i);
  });

  it("chế độ hoi vẫn nói rõ chỉ đọc", () => {
    expect(dungLoiNhacHeThong({ cheDo: "hoi", ngonNgu: "en" })).toMatch(/read-only/i);
  });
});

describe("Đợt 2 — khối 'Project conventions'", () => {
  it("tệp quy ước có tiêu đề + câu 'follow unless they conflict with the user' + nhãn DỮ LIỆU", () => {
    const k = dungKhoiNguCanhDuAn({
      ten: "x",
      cay: [],
      lenhDuocPhep: [],
      tepQuyUoc: [
        { duong: "AGENTS.md", noiDung: "Use tabs." },
        { duong: ".cursorrules", noiDung: "Prefer pure functions." },
      ],
    });
    expect(k).toMatch(/## Project conventions/);
    expect(k).toMatch(/follow them unless they conflict with the user/i);
    expect(k).toMatch(/data/i);
    expect(k).toContain("### AGENTS.md");
    expect(k).toContain("Use tabs.");
    expect(k).toContain("### .cursorrules");
  });

  it("trần TỔNG 8 KB cho mọi tệp quy ước (không phải 4k mỗi tệp)", () => {
    const k = dungKhoiNguCanhDuAn({
      ten: "x",
      cay: [],
      lenhDuocPhep: [],
      tepQuyUoc: [
        { duong: "AGENTS.md", noiDung: "a".repeat(6000) },
        { duong: "CLAUDE.md", noiDung: "b".repeat(6000) },
        { duong: ".cursorrules", noiDung: "c".repeat(6000) },
      ],
    });
    const than = k.slice(k.indexOf("## Project conventions"));
    expect(than.length).toBeLessThan(8192 + 800);
    expect(than).toContain("### AGENTS.md");
  });

  it("không có tệp quy ước ⇒ không có khối", () => {
    expect(dungKhoiNguCanhDuAn({ ten: "x", cay: [], lenhDuocPhep: [] })).not.toMatch(/Project conventions/);
  });
});

describe("Đợt 2 — remember trong vòng: lõi KHÔNG ghi gì, chỉ chuyển tiếp", () => {
  it("vòng gọi bộ thực thi cho remember (kể cả chế độ hoi); sự kiện de-xuat-nho đi qua phat nguyên vẹn", async () => {
    let luot = 0;
    const goiModel: GoiModel = async function* (): AsyncGenerator<ManhModel> {
      luot++;
      if (luot === 1) {
        yield {
          loai: "xong",
          toolCalls: [{ id: "c1", type: "function", function: { name: "remember", arguments: '{"note":"Uses pnpm","scope":"project"}' } }],
        };
      } else yield { loai: "xong", toolCalls: [] };
    };
    const goiBo: string[] = [];
    const bo: BoThucThi = {
      congCu: (c) => congCuTheoCheDo(c),
      async chay(goi, ctx) {
        goiBo.push(goi.ten);
        ctx.phat({ loai: "de-xuat-nho", id: "n1", note: String(goi.thamSo.note), scope: "project" });
        return { ok: true, choModel: "Proposed to the user; it will be saved only if they approve." };
      },
    };
    const suKien: SuKienAgent[] = [];
    const kq = await chayVongAgent({
      cauHoi: "remember we use pnpm",
      cheDo: "hoi",
      runId: "r",
      nguCanhDuAn: "",
      goiModel,
      boThucThi: bo,
      phat: (e) => suKien.push(e),
      signal: new AbortController().signal,
    });
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(goiBo).toEqual(["remember"]);
    expect(suKien).toContainEqual({ loai: "de-xuat-nho", id: "n1", note: "Uses pnpm", scope: "project" });
    const tool = kq.tinNhan.find((m) => m.role === "tool")!;
    expect(tool.content).toMatch(/only if they approve/);
  });
});
