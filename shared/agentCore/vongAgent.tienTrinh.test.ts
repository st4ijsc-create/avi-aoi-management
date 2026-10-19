/**
 * ★★★ (2026-10-19, chẩn đoán 81 lượt agent bộ `scripts/ai-eval/ngau-nhien/`, 36 bài trượt) — BA LỚP HỎNG TIẾN TRÌNH:
 *   (a) 25 bài test HIỂN THỊ xanh nhưng test ẨN trượt (18/25 hụt đúng một biên); 41/70 lượt dừng NGAY sau lần xanh đầu
 *       ⇒ lõi nhắc MỘT lần "đối chiếu đặc tả + tự kiểm biên" khi model định kết thúc sau một lệnh test/build xanh.
 *   (b) lượt bị CẮT ở trần token ra KHÔNG có tool call (nghĩ hết ngân sách, suy luận tràn `content`) ⇒ trước đây
 *       `hoan-thanh` ⇒ nay CHƯA xong: nhắc tối đa 2 lần, lần thứ ba dừng `het-token`.
 *   (d) viết lại tệp liên tục không chạy test ⇒ hai lần ghi liên tiếp (khi lệnh test đã biết) ⇒ quan sát kèm nhắc.
 */
import { describe, expect, it } from "vitest";
import { chayVongAgent, kiemDacTaBat, laKetQuaLenhXanh, laLenhKiem, timLenhTestTrongCauHoi } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import { CAU_NHAC_KIEM_DAC_TA, CAU_NHAC_LUOT_CAT_KHONG_TOOL } from "./loiNhac";
import type { BoThucThi, CheDoAgent, GoiModel, KetQuaTool, LoiGoiTool, ManhModel, SuKienAgent, TinNhan, WireToolCall } from "./kieu";

type Luot = { tool?: Array<{ ten: string; args: Record<string, unknown> | string }>; chu?: string; biCat?: boolean };

function modelGia(kichBan: (i: number) => Luot) {
  const vao: TinNhan[][] = [];
  const goiModel: GoiModel = (v) => {
    const i = vao.length;
    vao.push(structuredClone(v.tinNhan));
    return (async function* (): AsyncGenerator<ManhModel> {
      const l = kichBan(i);
      if (l.chu) yield { loai: "chu", noiDung: l.chu };
      const toolCalls: WireToolCall[] = (l.tool ?? []).map((t, k) => ({
        id: `call_${i}_${k}`,
        type: "function",
        function: { name: t.ten, arguments: typeof t.args === "string" ? t.args : JSON.stringify(t.args) },
      }));
      yield { loai: "xong", toolCalls, ...(l.biCat ? { biCat: true } : {}) };
    })();
  };
  return { goiModel, vao };
}

/** Bộ thực thi giả: lệnh trả theo `lenh` (khuôn của extension: `exit code: N\n…`), ghi tệp luôn ok. */
function boThucThiGia(lenh: (cmd: string, lan: number) => KetQuaTool = () => xanhExt()) {
  const goi: LoiGoiTool[] = [];
  let lanLenh = 0;
  const bo: BoThucThi = {
    congCu: (c) => congCuTheoCheDo(c),
    async chay(g) {
      goi.push(g);
      if (g.ten === "run_command") return lenh(String(g.thamSo.command), lanLenh++);
      return { ok: true, choModel: `ok ${g.ten}` };
    },
  };
  return { bo, goi };
}

/** Khuôn kết quả lệnh của extension (`boThucThiVscode`). */
const xanhExt = (): KetQuaTool => ({ ok: true, choModel: "exit code: 0\nLệnh: node --test …\n# tests 3\n# pass 3\n# fail 0" });
const doExt = (): KetQuaTool => ({ ok: false, ma: "EXIT_KHAC_0", choModel: "exit code: 1\n# tests 3\n# pass 2\n# fail 1" });
/** Khuôn kết quả lệnh của máy chủ (`boThucThiMayChu.ketQuaLenh`): luôn `ok:true`, tiêu đề mang GREEN/RED. */
const xanhMayChu = (): KetQuaTool => ({ ok: true, choModel: "$ npm test\nexit code: 0 · tests: 0 failed, 5 passed → GREEN\n Tests  5 passed (5)" });
const doMayChu = (): KetQuaTool => ({ ok: true, choModel: "$ npm test\nexit code: 1 · tests: 2 failed, 3 passed → RED\n Tests  2 failed | 3 passed (5)" });

function chay(goiModel: GoiModel, bo: BoThucThi, y: { cheDo?: CheDoAgent; cauHoi?: string; kiemDacTa?: boolean } = {}) {
  const suKien: SuKienAgent[] = [];
  const p = chayVongAgent({
    cauHoi: y.cauHoi ?? "Viết src/a.mjs theo đặc tả. Test hiển thị: `node --test test/a.test.mjs`.",
    cheDo: y.cheDo ?? "tu-dong",
    runId: "run-tt",
    nguCanhDuAn: "",
    goiModel,
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
    ...(y.kiemDacTa !== undefined ? { kiemDacTa: y.kiemDacTa } : {}),
  });
  return { p, suKien };
}

const demNhac = (ds: TinNhan[], cau: string) => ds.filter((m) => m.role === "user" && m.content === cau).length;
const GHI = (p: string, c = "export const a = 1;\n") => ({ ten: "write_file", args: { path: p, content: c } });
const TEST = { ten: "run_command", args: { command: "node --test test/a.test.mjs" } };

// ─── 1. Kiểm đặc tả sau lần XANH đầu ────────────────────────────────────────────────────────────

describe("★★★ (1) kiểm đặc tả sau lần test XANH đầu — đúng MỘT lời nhắc mỗi lượt chạy", () => {
  it("ghi → test xanh → model định kết thúc ⇒ có ĐÚNG một lời nhắc; model kiểm thêm rồi kết thúc ⇒ hoan-thanh", async () => {
    const { goiModel, vao } = modelGia((i) =>
      [{ tool: [GHI("src/a.mjs")] }, { tool: [TEST] }, { chu: "Xong, test xanh." }, { tool: [TEST] }, { chu: "Đã đối chiếu đặc tả." }][i],
    );
    const { bo } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(vao).toHaveLength(5);
    expect(demNhac(kq.tinNhan, CAU_NHAC_KIEM_DAC_TA)).toBe(1);
    // lời nhắc đến NGAY sau câu kết thúc đầu tiên, và model lượt 4 thấy nó
    expect(vao[3].at(-1)).toEqual({ role: "user", content: CAU_NHAC_KIEM_DAC_TA });
    expect(CAU_NHAC_KIEM_DAC_TA).toMatch(/spec/i);
    expect(CAU_NHAC_KIEM_DAC_TA).toMatch(/edge|boundar/i);
    expect(CAU_NHAC_KIEM_DAC_TA).toMatch(/do not (modify|edit|change) the existing test/i);
  });

  it("khuôn máy chủ (`→ GREEN`) cũng kích hoạt; lần kết thúc thứ hai KHÔNG nhắc lại", async () => {
    const { goiModel, vao } = modelGia((i) => [{ tool: [TEST] }, { chu: "Xong." }, { chu: "Vẫn xong." }][i]);
    const { bo } = boThucThiGia(xanhMayChu);
    const kq = await chay(goiModel, bo, { cheDo: "sua" }).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(vao).toHaveLength(3);
    expect(demNhac(kq.tinNhan, CAU_NHAC_KIEM_DAC_TA)).toBe(1);
  });

  it("test ĐỎ (cả hai khuôn) rồi kết thúc ⇒ KHÔNG nhắc", async () => {
    for (const lenh of [doExt, doMayChu]) {
      const { goiModel, vao } = modelGia((i) => [{ tool: [TEST] }, { chu: "Không sửa được." }][i]);
      const { bo } = boThucThiGia(lenh);
      const kq = await chay(goiModel, bo).p;
      expect(kq.lyDo).toBe("hoan-thanh");
      expect(vao).toHaveLength(2);
      expect(demNhac(kq.tinNhan, CAU_NHAC_KIEM_DAC_TA)).toBe(0);
    }
  });

  it("lệnh KHÔNG phải test/build (git status, exit 0) ⇒ KHÔNG nhắc", async () => {
    const { goiModel, vao } = modelGia((i) => [{ tool: [{ ten: "run_command", args: { command: "git status" } }] }, { chu: "ok" }][i]);
    const { bo } = boThucThiGia(() => ({ ok: true, choModel: "exit code: 0\nnothing to commit" }));
    const kq = await chay(goiModel, bo).p;
    expect(vao).toHaveLength(2);
    expect(demNhac(kq.tinNhan, CAU_NHAC_KIEM_DAC_TA)).toBe(0);
  });

  it("công tắc tắt (`kiemDacTa:false` ⇐ AI_AGENT_KIEM_DAC_TA=0) ⇒ KHÔNG nhắc", async () => {
    const { goiModel, vao } = modelGia((i) => [{ tool: [TEST] }, { chu: "Xong." }][i]);
    const { bo } = boThucThiGia();
    const kq = await chay(goiModel, bo, { kiemDacTa: false }).p;
    expect(vao).toHaveLength(2);
    expect(demNhac(kq.tinNhan, CAU_NHAC_KIEM_DAC_TA)).toBe(0);
  });

  it("chế độ hoi ⇒ KHÔNG nhắc (không chạy được lệnh)", async () => {
    const { goiModel, vao } = modelGia((i) => [{ tool: [TEST] }, { chu: "Xong." }][i]);
    const { bo } = boThucThiGia();
    const kq = await chay(goiModel, bo, { cheDo: "hoi" }).p;
    expect(vao).toHaveLength(2);
    expect(demNhac(kq.tinNhan, CAU_NHAC_KIEM_DAC_TA)).toBe(0);
  });
});

// ─── 2. Lượt bị CẮT không tool call ⇒ chưa xong ─────────────────────────────────────────────────

describe("★★★ (2) lượt bị cắt ở trần token KHÔNG có tool call ⇒ không hoan-thanh", () => {
  it("cắt một lần ⇒ nhắc 'dừng suy luận dài, gọi tool tiếp theo'; vòng TIẾP TỤC", async () => {
    const { goiModel, vao } = modelGia((i) =>
      [{ chu: "Suy luận rất dài… bị cụt", biCat: true }, { tool: [TEST] }, { chu: "Đã kiểm." }, { chu: "Xong." }][i],
    );
    const { bo, goi } = boThucThiGia(doExt);
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(vao[1].at(-1)).toEqual({ role: "user", content: CAU_NHAC_LUOT_CAT_KHONG_TOOL });
    expect(CAU_NHAC_LUOT_CAT_KHONG_TOOL).toMatch(/cut off|output token limit/i);
    expect(goi.map((g) => g.ten)).toEqual(["run_command"]);
  });

  it("cắt mãi ⇒ tối đa 2 lời nhắc, lần thứ ba dừng het-token (KHÔNG hoan-thanh)", async () => {
    const { goiModel, vao } = modelGia(() => ({ chu: "Câu trả lời dài bị cụt", biCat: true }));
    const { bo, goi } = boThucThiGia();
    const { p, suKien } = chay(goiModel, bo);
    const kq = await p;
    expect(kq.lyDo).toBe("het-token");
    expect(vao).toHaveLength(3);
    expect(demNhac(kq.tinNhan, CAU_NHAC_LUOT_CAT_KHONG_TOOL)).toBe(2);
    expect(goi).toHaveLength(0);
    expect(suKien.at(-1)).toMatchObject({ loai: "xong", lyDo: "het-token" });
  });
});

// ─── 3. Hai lần ghi liên tiếp chưa chạy test ────────────────────────────────────────────────────

describe("★★★ (3) hai lần ghi tệp liên tiếp chưa chạy test (lệnh test đã biết) ⇒ quan sát kèm nhắc", () => {
  const toolCua = (ds: TinNhan[], id: string) => ds.find((m) => m.role === "tool" && m.tool_call_id === id)!.content;

  it("ghi lần 2 ⇒ nhắc (kèm lệnh test); ghi lần 3 cùng chuỗi ⇒ không nhắc lại; sau khi chạy test, chuỗi mới nhắc lại", async () => {
    const { goiModel } = modelGia((i) =>
      [
        { tool: [GHI("src/a.mjs")] },
        { tool: [GHI("src/a.mjs", "v2")] },
        { tool: [GHI("src/a.mjs", "v3")] },
        { tool: [TEST] },
        { tool: [GHI("src/a.mjs", "v4")] },
        { tool: [GHI("src/a.mjs", "v5")] },
        { chu: "Xong." },
      ][i],
    );
    const { bo } = boThucThiGia(doExt);
    const kq = await chay(goiModel, bo).p;
    expect(toolCua(kq.tinNhan, "call_0_0")).toBe("ok write_file");
    const nhac2 = toolCua(kq.tinNhan, "call_1_0");
    expect(nhac2).toMatch(/^ok write_file\n/);
    expect(nhac2).toMatch(/run the tests/i);
    expect(nhac2).toContain("node --test test/a.test.mjs");
    expect(toolCua(kq.tinNhan, "call_2_0")).toBe("ok write_file");
    expect(toolCua(kq.tinNhan, "call_4_0")).toBe("ok write_file");
    expect(toolCua(kq.tinNhan, "call_5_0")).toMatch(/run the tests/i);
  });

  it("không biết lệnh test (câu hỏi không nêu, chưa chạy test nào) ⇒ KHÔNG nhắc", async () => {
    const { goiModel } = modelGia((i) => [{ tool: [GHI("src/a.mjs")] }, { tool: [GHI("src/a.mjs", "v2")] }, { chu: "Xong." }][i]);
    const { bo } = boThucThiGia();
    const kq = await chay(goiModel, bo, { cauHoi: "Viết src/a.mjs." }).p;
    expect(toolCua(kq.tinNhan, "call_1_0")).toBe("ok write_file");
  });

  it("ghi từng phần (write_file rồi edit_file CÙNG tệp — cách lõi khuyên khi tệp lớn) ⇒ KHÔNG nhắc", async () => {
    const { goiModel } = modelGia((i) =>
      [
        { tool: [GHI("src/a.mjs")] },
        { tool: [{ ten: "edit_file", args: { path: "src/a.mjs", edits: [{ old_string: "1;", new_string: "1;\nexport const b = 2;" }] } }] },
        { chu: "Xong." },
      ][i],
    );
    const { bo } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(toolCua(kq.tinNhan, "call_1_0")).toBe("ok edit_file");
  });
});

// ─── bộ phân loại (khuôn lệnh thật của `lenhTest` bộ ngẫu nhiên + lệnh dự án thường gặp) ─────────


describe("bộ phân loại lệnh kiểm / kết quả xanh", () => {
  it.each([
    "python -m pytest test/test_hien_thi.py",
    "node --test test/hien-thi.test.mjs",
    "dotnet test Bai.csproj",
    "dotnet build",
    "javac -d out-kt src test",
    "java -cp out-kt HienThiTest",
    "cmake --build _b",
    "ctest --test-dir _b",
    "go test ./...",
    "cargo test --offline",
    "npm test",
    "npm run check:tests",
    "npx vitest run src/a.test.ts",
    "npx tsc --noEmit",
  ])("lệnh kiểm: %s", (l) => expect(laLenhKiem(l)).toBe(true));

  it.each(["git status", "node src/main.js", "java -cp out-kt Main", "npm install", "git diff test/a.test.mjs", ""])(
    "không phải lệnh kiểm: %s",
    (l) => expect(laLenhKiem(l)).toBe(false),
  );

  it.each([
    ["exit code: 0\n===== 12 passed in 0.31s =====", true],
    ["$ dotnet test\nexit code: 0 · tests: 0 failed, 9 passed → GREEN\nPassed! - Failed: 0, Passed: 9", true],
    ["exit code: 0\n", true],
    ["exit code: 0 (timed out)\n", false],
    ["$ x\nexit code: — (TIMED OUT) · FAILED\n", false],
    ["exit code: 0\nFailed! - Failed: 2, Passed: 4", false],
    ["exit code: 0\n Tests  1 failed | 4 passed (5)", false],
    ["exit code: 0\n# pass 3\n# fail 1", false],
    ["exit code: none\n", false],
    ["ok run_command", false],
  ])("xanh? %#", (choModel, ky) => expect(laKetQuaLenhXanh({ ok: true, choModel: choModel as string })).toBe(ky));

  it("ok:false ⇒ không xanh dù exit 0", () => expect(laKetQuaLenhXanh({ ok: false, choModel: "exit code: 0" })).toBe(false));

  it("lệnh test trong câu hỏi (khuôn taoCauHoiAgent)", () => {
    expect(
      timLenhTestTrongCauHoi("Tệp cần tạo/sửa: `src/a.mjs`.\n\nTest hiển thị (…): `javac -d out-kt src test` → `java -cp out-kt HienThiTest`."),
    ).toBe("javac -d out-kt src test");
    expect(timLenhTestTrongCauHoi("Sửa `src/test.mjs` cho đúng.")).toBeNull();
  });
});

describe("công tắc AI_AGENT_KIEM_DAC_TA (host đọc env, lõi chỉ diễn giải)", () => {
  it.each([[undefined, true], ["", true], ["1", true], ["0", false], ["off", false], [" FALSE ", false], ["no", false]])(
    "%j ⇒ %s",
    (v, ky) => expect(kiemDacTaBat(v as string | undefined)).toBe(ky),
  );
});
