/**
 * ★★★ Pha 6 Task 3 (F2) — **HAI RANH GIỚI AN NINH PHẢI CHẠY THẬT TRÊN ĐƯỜNG AGENT NGÔN NGỮ TỰ NHIÊN.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI, VÀ VÌ SAO NÓ **KHÔNG** ĐƯỢC GIẢ BỘ PHÂN LOẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `readProjectFile.hardlink.test.ts` (Pha 5 Task 1) chứng minh cửa `confineTarget()` chặn hard
 * link — nhưng nó **thay bộ phân loại bằng một seam** (`vi.mock("./intentClassifier")`) và tự đưa
 * `args` vào. Nghĩa là nó chứng minh **cửa**, **không** chứng minh **con đường tới cửa**.
 *
 * Con đường ấy đã **ĐỨT** suốt từ Pha 4: `extractArgsForTool` có **41 nhãn `case`** và **0** cho
 * nhóm `readToolsProgramming` ⇒ mọi câu hỏi ngôn ngữ tự nhiên chọn trúng một trong 8 tool ấy đều
 * rơi vào nhánh `default` ⇒ `{}` ⇒ `safeParse` hỏng ⇒ `reason = "INVALID_ARGS"` ⇒ `tool: null`.
 * ⇒ **Hai ranh giới an ninh — chặn đường dẫn và hộp cát số học — CHƯA TỪNG CHẠY trên đường đó.**
 *
 * Đo được trước bản vá (probe chạy thật, `classifyToolIntent` hàng thật):
 *   "đọc file innocent.st"        → tool=null  reason=INVALID_ARGS (thiếu `path`)
 *   "tính 2+3*4 bằng bao nhiêu"   → tool=null  reason=INVALID_ARGS (thiếu `expression`)
 *
 * ⚠⚠ Ở ĐÂY **KHÔNG CÓ SEAM NÀO**. `classifyToolIntent` là hàng thật; mọi ca dưới đây bắt đầu bằng
 * **một câu tiếng Việt** và đi qua đúng chuỗi mà người dùng đi:
 *   câu hỏi → `findToolByTriggers` → `extractArgsForTool` → `safeParse` → `argsWithAuthCtx` →
 *   handler THẬT → `confineTarget`/`evaluateArithmetic`.
 * Mỗi ca còn khẳng định `decision.reason === "HEURISTIC_MATCH"` — bằng chứng nó tới nơi bằng
 * **bộ phân loại heuristic**, không phải nhờ một đường tắt hay bộ phân loại LLM.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐỐI CHỨNG DƯƠNG LÀ **BẮT BUỘC** — KHÔNG CÓ NÓ THÌ "CHẶN HẾT" CŨNG XANH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lớp lỗi này đã để `215/215` xanh suốt thời gian một tool CHẾT. Nên mỗi ranh giới có một ca khoá
 * **một giá trị cụ thể**: file thường đọc ra **đúng chuỗi + đúng số byte**; `calc 2+3*4` ra **đúng
 * 14**. Một bản vá "từ chối mọi thứ" làm hai ca ấy ĐỎ ngay.
 *
 * ⚠⚠⚠ **BỘ TRÍCH THAM SỐ TUYỆT ĐỐI KHÔNG ĐƯỢC LÀM SẠCH ĐẦU VÀO.** Nếu nó tự lọc `..` hay tự loại
 * biểu thức lạ thì ranh giới an ninh **vẫn chưa chạy** — chỉ đổi chỗ cái mù. Ca
 * `★★★ BỘ TRÍCH KHÔNG LÀM SẠCH` khẳng định `decision.args` mang **nguyên văn** chuỗi thù địch, và
 * mọi ca chặn đều khẳng định `decision.tool` đúng tên tool — tức **handler ĐÃ chạy** và **nó** mới
 * là cái từ chối.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// RBAC: cho qua — thứ đang được kiểm là RANH GIỚI FILE / HỘP CÁT, không phải cổng quyền.
const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import { tryExecuteTool } from "./index";

/** Danh tính PHIÊN THẬT (máy chủ tự đọc) — nguồn hợp lệ duy nhất. */
const PHIEN = { user: { id: 7, role: "supervisor", name: "Tester" }, lang: "vi" as const };

/** Bí mật NGOÀI workspace — đúng 57 byte, khớp con số đã đo ở nghiệm thu sống Pha 4. */
const BI_MAT = "DATABASE_URL=postgres://aoi:SUPERSECRET@127.0.0.1:5434/x\n";
/** Đối chứng DƯƠNG: một file nguồn BÌNH THƯỜNG trong workspace. */
const NGUON_BINH_THUONG = "PROGRAM main\n  run := TRUE;\nEND_PROGRAM\n";

let ws = "";
let ngoai = "";
let hardlinkOk = false;
let hardlinkLoi: string | null = null;
let nlinkDo = 0;
let llmCu: string | undefined;

beforeAll(() => {
  // ⚠ Cùng ổ đĩa: hard link NTFS không vượt volume được.
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "f2-ws-"));
  ngoai = fs.mkdtempSync(path.join(os.tmpdir(), "f2-ngoai-"));
  process.env.PROG_WORKSPACE_DIR = ws;
  // ⚠ Ghim TẮT bộ phân loại LLM: mọi ca dưới đây phải tới nơi bằng đường HEURISTIC.
  llmCu = process.env.AI_TOOL_LLM_FALLBACK;
  process.env.AI_TOOL_LLM_FALLBACK = "0";

  fs.writeFileSync(path.join(ngoai, "secret.env"), BI_MAT);
  fs.writeFileSync(path.join(ws, "main.st"), NGUON_BINH_THUONG);
  try {
    fs.linkSync(path.join(ngoai, "secret.env"), path.join(ws, "innocent.st"));
    hardlinkOk = true;
    nlinkDo = fs.statSync(path.join(ws, "innocent.st")).nlink;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    hardlinkLoi = `${err.code}: ${err.message}`;
  }
});

afterAll(() => {
  for (const d of [ws, ngoai]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  delete process.env.PROG_WORKSPACE_DIR;
  if (llmCu === undefined) delete process.env.AI_TOOL_LLM_FALLBACK;
  else process.env.AI_TOOL_LLM_FALLBACK = llmCu;
});

beforeEach(() => {
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
});

/** Gọi TỪ ĐẦU ĐƯỜNG: một câu tiếng Việt, không seam, không args tiêm tay. */
async function hoi(cauHoi: string) {
  const r = await tryExecuteTool(cauHoi, undefined, PHIEN);
  return r;
}

describe("★★★ F2 — ranh giới CHẶN ĐƯỜNG DẪN chạy thật trên đường Agent NL (`read_project_file`)", () => {
  it("★ MÔI TRƯỜNG — hard link dựng được, và nó làm `nlink > 1` (nếu không, ca chính vô nghĩa)", () => {
    expect(
      hardlinkOk,
      `KHÔNG dựng được hard link ⇒ ca chặn dưới đây KHÔNG chứng minh gì. Lý do: ${hardlinkLoi}. ` +
        "Không được bỏ qua im lặng — sửa môi trường (cùng ổ đĩa, NTFS) rồi chạy lại.",
    ).toBe(true);
    expect(nlinkDo, "hard link phải làm nlink > 1").toBeGreaterThan(1);
  });

  it("★★★ câu hỏi NL chọn ĐÚNG tool VÀ nhận ĐỦ tham số (đây là chỗ đường đã ĐỨT)", async () => {
    const r = await hoi("đọc file main.st");
    expect(r.decision.tool, "câu hỏi NL phải chọn `read_project_file`").toBe("read_project_file");
    expect(r.decision.reason, "phải tới nơi bằng bộ phân loại HEURISTIC, không phải LLM").toBe("HEURISTIC_MATCH");
    expect(r.decision.args, "tham số bắt buộc `path` phải có").toMatchObject({ path: "main.st" });
  });

  it("★★★ HARD LINK — câu hỏi NL ⇒ handler CHẠY ⇒ TỪ CHỐI, 0 byte bí mật về tới Agent", async () => {
    const r = await hoi("đọc file innocent.st");

    // Bằng chứng handler ĐÃ chạy (không phải bộ trích chặn hộ):
    expect(r.decision.tool).toBe("read_project_file");
    expect(r.decision.args).toMatchObject({ path: "innocent.st" });
    expect(r.result, "tool phải chạy tới nơi").not.toBeNull();

    expect(r.result!.note, "cùng mã từ chối đã có — không đẻ mã mới").toBe("PATH_REJECTED");
    const d = r.result!.data as { path: string | null; bytes: number | null; content: string | null };
    expect(d.content, "0 byte nội dung").toBeNull();
    expect(d.bytes).toBeNull();
    expect(d.path).toBeNull();
    expect(r.result!.textSummary, "câu từ chối phải nói VÌ SAO").toMatch(/liên kết cứng|hard link/i);
    // Bằng chứng MẠNH nhất: bí mật không rò ra ở BẤT KỲ ô nào của kết quả.
    expect(JSON.stringify(r)).not.toContain("SUPERSECRET");
    expect(JSON.stringify(r)).not.toContain("DATABASE_URL");
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — file thường trong workspace VẪN đọc được, ĐÚNG giá trị + ĐÚNG số byte", async () => {
    expect(fs.statSync(path.join(ws, "main.st")).nlink, "đối chứng dương phải là file nlink = 1").toBe(1);

    const r = await hoi("đọc file main.st");
    expect(r.result, "tool phải chạy tới nơi").not.toBeNull();
    expect(r.result!.note, "file thường KHÔNG được bị chặn").toBeUndefined();
    const d = r.result!.data as { path: string | null; bytes: number | null; content: string | null; truncated: boolean };
    expect(d.content).toBe(NGUON_BINH_THUONG);
    expect(d.bytes).toBe(Buffer.byteLength(NGUON_BINH_THUONG));
    expect(d.path).toBe("main.st");
    expect(d.truncated).toBe(false);
    expect(r.result!.textSummary).toContain("run := TRUE;");
  });

  it("★★★ BỘ TRÍCH KHÔNG LÀM SẠCH — đường dẫn thù địch đi qua NGUYÊN VĂN, CỬA mới là cái từ chối", async () => {
    /**
     * ⚠⚠⚠ Nếu bộ trích tự lọc `..`/đường tuyệt đối thì ranh giới an ninh **vẫn chưa chạy** — chỉ
     * đổi chỗ cái mù, và một lượt nới cửa sau này sẽ không ai thấy. Ca này khoá đúng điều đó:
     * `decision.args.path` phải **bằng nguyên văn** chuỗi người dùng gõ.
     */
    for (const p of ["../secret.env", "sub/../../secret.env", "/etc/passwd", "..\\..\\x"]) {
      const r = await hoi(`đọc file ${p}`);
      expect(r.decision.tool, `phải tới được tool cho: ${p}`).toBe("read_project_file");
      expect((r.decision.args as { path?: unknown }).path, `bộ trích phải chuyển NGUYÊN VĂN: ${p}`).toBe(p);
      expect(r.result, `tool phải chạy tới nơi cho: ${p}`).not.toBeNull();
      expect(r.result!.note, `CỬA phải từ chối: ${p}`).toBe("PATH_REJECTED");
      expect((r.result!.data as { content: string | null }).content).toBeNull();
    }
  });

  it("★★ mã NOT_FOUND không bị nuốt — một đường dẫn hợp lệ nhưng không tồn tại vẫn là NOT_FOUND", async () => {
    const r = await hoi("đọc file khong-ton-tai.st");
    expect(r.decision.tool).toBe("read_project_file");
    expect(r.result!.note).toBe("NOT_FOUND");
  });
});

describe("★★★ F2 — ranh giới HỘP CÁT SỐ HỌC chạy thật trên đường Agent NL (`calc`)", () => {
  it("★★★ ĐỐI CHỨNG DƯƠNG — `tính 2+3*4` ⇒ ĐÚNG 14 (ưu tiên toán tử, không phải 20)", async () => {
    const r = await hoi("tính 2+3*4 bằng bao nhiêu");
    expect(r.decision.tool).toBe("calc");
    expect(r.decision.reason).toBe("HEURISTIC_MATCH");
    expect(r.decision.args).toMatchObject({ expression: "2+3*4" });
    expect(r.result, "tool phải chạy tới nơi").not.toBeNull();
    expect(r.result!.note, "biểu thức hợp lệ KHÔNG được bị chặn").toBeUndefined();
    const d = r.result!.data as { expression: string; value: number | null; error: string | null };
    expect(d.value).toBe(14);
    expect(d.error).toBeNull();
    expect(r.result!.textSummary).toBe("2+3*4 = 14");
  });

  it("★★ ĐỐI CHỨNG DƯƠNG (hàm được whitelist) — `sqrt(16)` ⇒ 4", async () => {
    const r = await hoi("tính giúp tôi sqrt(16)");
    expect(r.decision.tool).toBe("calc");
    expect(r.decision.args).toMatchObject({ expression: "sqrt(16)" });
    expect((r.result!.data as { value: number | null }).value).toBe(4);
  });

  it("★★★ THOÁT HỘP CÁT — tên kế thừa qua chuỗi prototype bị TỪ CHỐI, và HỘP CÁT là cái từ chối", async () => {
    /**
     * ⚠⚠ `constructor` / `toString` **không** nằm trong `MATH_FUNCS` nhưng **có** trên chuỗi
     * prototype của một object thường. Chốt chặn là `Object.prototype.hasOwnProperty.call(...)`
     * trong `evaluateArithmetic`. Trước bản vá F2 dòng ấy **chưa từng chạy trên đường Agent**.
     * ⚠ Mỗi ca khẳng định `decision.tool === "calc"` **và** `decision.args.expression` mang nguyên
     *   văn biểu thức thù địch ⇒ chứng minh bộ trích **không** chặn hộ.
     */
    // ⚠ Hộp cát **hạ chữ thường** mọi định danh (`calcTokenize`), nên câu từ chối nêu tên đã hạ
    //   chữ — dùng cờ `i` thay vì khoá theo chính tả người dùng gõ.
    const doc: [string, string, RegExp][] = [
      ["tính 2 * constructor(3)", "2 * constructor(3)", /unknown function 'constructor'/i],
      ["tính 1 + toString(2)", "1 + toString(2)", /unknown function 'tostring'/i],
      ["tính 2 + hasOwnProperty(1)", "2 + hasOwnProperty(1)", /unknown function 'hasownproperty'/i],
      ["tính 0 + __proto__(1)", "0 + __proto__(1)", /unknown function '__proto__'/i],
    ];
    for (const [cauHoi, bieuThuc, thongDiep] of doc) {
      const r = await hoi(cauHoi);
      expect(r.decision.tool, `phải tới được hộp cát: ${cauHoi}`).toBe("calc");
      expect((r.decision.args as { expression?: unknown }).expression, "bộ trích phải chuyển NGUYÊN VĂN").toBe(bieuThuc);
      expect(r.result, `tool phải chạy tới nơi: ${cauHoi}`).not.toBeNull();
      expect(r.result!.note, `hộp cát phải TỪ CHỐI: ${cauHoi}`).toBe("INVALID_EXPRESSION");
      const d = r.result!.data as { value: number | null; error: string | null };
      expect(d.value, "0 giá trị trả về").toBeNull();
      expect(d.error ?? "", `câu từ chối phải nói VÌ SAO: ${cauHoi}`).toMatch(thongDiep);
    }
  });

  it("★★ THOÁT HỘP CÁT — ký tự ngoài văn phạm (nháy kép, dấu chấm) bị TỪ CHỐI ngay ở bộ tách từ", async () => {
    const r = await hoi('tính 2 * constructor("return 1")()');
    expect(r.decision.tool).toBe("calc");
    expect(r.result!.note).toBe("INVALID_EXPRESSION");
    expect((r.result!.data as { error: string | null }).error ?? "").toMatch(/illegal character/);
  });

  it("★★ kết quả KHÔNG HỮU HẠN bị từ chối (không trả `Infinity` ra cho Agent)", async () => {
    const r = await hoi("tính 9^9^9");
    expect(r.decision.tool).toBe("calc");
    expect(r.result!.note).toBe("INVALID_EXPRESSION");
    expect((r.result!.data as { error: string | null }).error ?? "").toMatch(/finite/);
  });

  it("★★ KHÔNG BẮT NHẦM — câu hỏi nghiệp vụ có chữ 'tính' KHÔNG bị `calc` cướp", async () => {
    /**
     * ⚠ Bộ trích chỉ nhận một biểu thức khi phần đuôi có **chữ số** VÀ một **toán tử/ngoặc**.
     * Không có tiền điều kiện ấy thì `calc` sẽ nuốt mọi câu bắt đầu bằng "tính".
     */
    for (const q of ["tính tỉ lệ NG hôm nay", "tính OEE máy AOI-01 7 ngày", "tính sản lượng hôm nay"]) {
      const r = await hoi(q);
      expect(r.decision.tool, `"${q}" KHÔNG được rơi vào calc`).not.toBe("calc");
    }
  });
});
