/**
 * ★★★ doc 78 · PHA A — **LƯỚI ĐIỀU TRA DÂN SỐ CHO HỘP CÁT REPO.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN ĐƯỢC PHÁT BIỂU Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *     **KHÔNG một byte nào nằm ngoài gốc hộp cát — hoặc nằm trong danh sách cấm — rời khỏi BẤT KỲ
 *     tool nào đứng sau bit `ai_repo_read`, qua BẤT KỲ bề mặt nào của nó.**
 *
 * ⚠⚠ Tập tool được suy từ **`listTools()` SỐNG**, lọc theo `requiredPermission.module` — một
 * NGUỒN ĐỘC LẬP với file này. Bài học N14 (`workspaceConfinement.canary.test.ts`): chép tay danh
 * sách tool thì một tool MỚI đọc đĩa sẽ **vô hình** với lưới. Ở đây, một tool mới gắn bit
 * `ai_repo_read` **tự động rơi vào lưới**, kể cả khi người viết nó chưa từng đọc file này.
 *
 * ⚠ Lưới phủ **mọi bề mặt** của tool (`handler`/`preview`/`summarize`), không riêng `handler` —
 * cùng lý do đã ghi ở lưới canary của workspace lập trình (C-1 rò qua `preview()`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ HAI GỐC, HAI MỤC ĐÍCH — VÀ ĐÂY LÀ CHỖ DỄ TỰ LỪA NHẤT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §A–§C chạy trên một gốc **TẠM** (`AI_REPO_SANDBOX_ROOT`) dựng cạnh repo trên **CÙNG Ổ ĐĨA** —
 * bắt buộc, vì `fs.linkSync` (hard link) không bắc qua hai volume, và không có hard link thì §C
 * **không chứng minh gì**. Gốc tạm cũng là chỗ duy nhất được phép dựng symlink/hard link mà không
 * làm bẩn cây làm việc thật.
 *
 * §D chạy trên **GỐC THẬT** (thư mục repo) và là thứ duy nhất nói được về hệ đang chạy:
 *   • chiều ÂM — `.env` THẬT bị từ chối, **và ca tự chứng minh rằng `.env` ấy CÓ TỒN TẠI** (nếu
 *     không, ca xanh vì "không có gì để đọc" — đúng lớp *lượng từ TỰ THOẢ* đã bị đo hôm nay);
 *   • chiều DƯƠNG — một file `.ts` bình thường VẪN đọc được và `grep_repo` VẪN tìm ra. Không có
 *     chiều dương thì một bản vá "chặn hết mọi thứ" cũng xanh trọn vẹn.
 *
 * ⚠ Mọi tệp canary đều mang đuôi **`.ts`** — nằm TRONG danh sách trắng. Nếu dùng `.secret` thì
 * mọi ca sẽ xanh vì **lý do sai** (bị chặn bởi lớp ĐUÔI, không phải bởi hộp cát), và đột biến gỡ
 * phép kiểm tiền tố sẽ **sống sót**.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import "./index"; // đăng ký TOÀN BỘ tool (side-effect) — nguồn của `listTools()`
import { listTools, type Tool } from "./toolRegistry";
import {
  DUOI_CHO_PHEP,
  KHUON_TEP_CAM,
  TRAN_BYTE_MOI_TEP,
  gocHopCat,
  moTepTrongHopCat,
  xoaSoNganSach,
} from "./repoSandbox";

/** Chuỗi không thể xuất hiện tình cờ. */
const CANARY = "PHA-A-CANARY-7d41e0b9";
const BI_MAT = `export const MASTER_API_KEY = "${CANARY}";\nexport const ANH_KY_SECRET = "${CANARY}";\n`;
const AUTH = { userId: 7, role: "engineer" };
const CTX = { user: { id: 7, role: "engineer", name: "T" }, lang: "vi" as const };

const GOC_REPO = path.resolve(process.cwd());

let HOP = "";
let NGOAI = "";
let tenNgoai = "";
/**
 * ⚠⚠ ĐO ĐƯỢC (2026-08-18, Windows 11, tiến trình KHÔNG nâng quyền): `fs.symlinkSync(..., "file")`
 * ném **EPERM** — symlink TỆP trên Windows đòi quyền `SeCreateSymbolicLinkPrivilege` (hoặc
 * Developer Mode). **JUNCTION thư mục thì KHÔNG.** Bản đầu của lưới này đòi symlink tệp và ca môi
 * trường ĐỎ ngay — nếu tôi đã "chữa" bằng cách bỏ ca môi trường đi thì ba ca dưới sẽ xanh trên một
 * symlink KHÔNG TỒN TẠI (`NOT_FOUND`), tức xanh vì lý do sai.
 * ⇒ Vector BẮT BUỘC là **junction** (dựng được ở mọi máy Windows); symlink TỆP là vector PHỤ, chỉ
 *   thêm vào bộ ca khi môi trường dựng được, và trạng thái ấy được KHAI ra ở §0.
 */
let junctionOk = false;
let junctionErr: string | null = null;
let symlinkTepOk = false;
let symlinkTepErr: string | null = null;
let hardlinkOk = false;
let hardlinkErr: string | null = null;

beforeAll(() => {
  // ⚠ CÙNG Ổ ĐĨA với repo — `fs.linkSync` không bắc qua volume (xem khối đầu file).
  const cha = path.dirname(GOC_REPO);
  HOP = fs.mkdtempSync(path.join(cha, "pha-a-hop-"));
  NGOAI = fs.mkdtempSync(path.join(cha, "pha-a-ngoai-"));
  tenNgoai = path.basename(NGOAI);

  /**
   * ⚠⚠⚠ **HAI TỆP BÍ MẬT, KHÔNG PHẢI MỘT — VÀ ĐÂY LÀ MỘT LỖI CỦA LƯỚI DO ĐỘT BIẾN BẮT ĐƯỢC.**
   *
   * Bản đầu dùng CHUNG `prod-secret.ts` cho cả junction lẫn hard link. Hậu quả: tệp ấy có
   * `nlink === 2`, nên ca *"JUNCTION trỏ RA NGOÀI"* bị chặn bởi phép kiểm **HARD_LINK**, không phải
   * bởi phép kiểm **realpath**. Đột biến M3 (gỡ hẳn `realpathContained` của target) **SỐNG SÓT với
   * 27/27 XANH** — lưới xanh vì một lý do KHÁC với lý do nó tự khai.
   * ⇒ Mỗi vector một inode RIÊNG: junction trỏ tới tệp `nlink === 1`, để nó chỉ có thể bị chặn bởi
   *   đúng cái hàng rào nó sinh ra để canh.
   */
  fs.writeFileSync(path.join(NGOAI, "prod-secret.ts"), BI_MAT); // ← đích của JUNCTION, nlink phải = 1
  fs.writeFileSync(path.join(NGOAI, "prod-hardlink.ts"), BI_MAT); // ← đích của HARD LINK
  fs.writeFileSync(path.join(HOP, "ok.ts"), "export const DAU_HIEU_HOP_LE = 42;\n");
  fs.writeFileSync(path.join(HOP, ".env"), `MASTER_API_KEY=${CANARY}\n`);
  fs.writeFileSync(path.join(HOP, ".env.bak-cu"), `ANH_KY_SECRET=${CANARY}\n`);
  fs.mkdirSync(path.join(HOP, "node_modules", "goi-la"), { recursive: true });
  fs.writeFileSync(path.join(HOP, "node_modules", "goi-la", "index.ts"), `// ${CANARY}\n`);
  fs.mkdirSync(path.join(HOP, "sub"), { recursive: true });
  fs.writeFileSync(path.join(HOP, "sub", "trong.ts"), "export const TRONG = 1;\n");

  try {
    fs.symlinkSync(NGOAI, path.join(HOP, "alias-ngoai"), "junction");
    junctionOk = true;
  } catch (e) {
    junctionErr = `${(e as NodeJS.ErrnoException).code}: ${(e as Error).message}`;
  }
  try {
    fs.symlinkSync(path.join(NGOAI, "prod-secret.ts"), path.join(HOP, "lien-ket-mem.ts"), "file");
    symlinkTepOk = true;
  } catch (e) {
    symlinkTepErr = `${(e as NodeJS.ErrnoException).code}: ${(e as Error).message}`;
  }
  try {
    fs.linkSync(path.join(NGOAI, "prod-hardlink.ts"), path.join(HOP, "lien-ket-cung.ts"));
    hardlinkOk = true;
  } catch (e) {
    hardlinkErr = `${(e as NodeJS.ErrnoException).code}: ${(e as Error).message}`;
  }
});

afterAll(() => {
  delete process.env.AI_REPO_SANDBOX_ROOT;
  for (const d of [HOP, NGOAI]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

beforeEach(() => {
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  xoaSoNganSach();
  process.env.AI_REPO_SANDBOX_ROOT = HOP;
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Tập tool — suy từ SỔ ĐĂNG KÝ SỐNG, không chép tay
// ════════════════════════════════════════════════════════════════════════════════════════════════
const BIT = "ai_repo_read";
/**
 * ★ 2026-08-19 (doc 78 PHA C) — LỌC THÊM `action === "canView"`.
 *
 * Pha C (`apply_diff`) đứng sau **cùng module** `ai_repo_read` nhưng action `canEdit` (đọc/ghi cùng
 * một đối tượng — tệp repo — nên cùng module, khác action). Lưới NÀY canh ba tool ĐỌC; một write
 * tool lọt vào đây sẽ ĐỎ ngay ca "mọi tool trong tập đều có `handler`" (apply_diff không có
 * `handler`). Nên tập ĐỌC được ghim theo đúng action đọc; canary/hàng-rào của apply_diff nằm ở
 * `applyDiff.census.test.ts`.
 */
function toolHopCat(): Tool<any, any>[] {
  return listTools().filter((t) => t.requiredPermission?.module === BIT && t.requiredPermission?.action === "canView");
}

/**
 * ★ Mẫu tìm dùng cho `grep_repo` trong lưới rò rỉ.
 *
 * ⚠⚠ Nó **KHÔNG được LÀ** `CANARY`, và đây là một bài học đo được ngay trong lượt chạy đầu: bản
 * trước truyền `pattern: CANARY`, và `grep_repo` **vọng lại** tham số ấy trong `data.pattern` ⇒ bộ
 * dò rò rỉ báo ĐỎ trên **đầu vào của chính nó**, không phải trên một byte nào của đĩa. Một lưới
 * kêu oan là một lưới sẽ bị người sau tắt đi.
 * ⇒ Mẫu là một **TIỀN TỐ** của canary: nó KHỚP nội dung bí mật (nên một lượt rò thật vẫn lộ toàn
 *   bộ canary trong dòng khớp) nhưng bản thân nó không chứa canary.
 */
const MAU_TIM = "PHA-A";

/** Gọi MỌI bề mặt của một tool với một đường dẫn, gom mọi thứ nó trả ra thành một chuỗi. */
async function moiDauRa(t: Tool<any, any>, p: string): Promise<string> {
  const args = { path: p, pattern: MAU_TIM, __authCtx: AUTH };
  const ra: unknown[] = [];
  for (const [ten, f] of [
    ["handler", t.handler],
    ["preview", t.preview],
    ["summarize", t.summarize],
  ] as const) {
    if (typeof f !== "function") continue;
    try {
      ra.push({ [ten]: await (f as (a: unknown, c: unknown) => unknown)(args, CTX) });
    } catch (e) {
      ra.push({ [ten]: `THREW ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return JSON.stringify(ra);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — CẦU CHÌ: lưới đang quét vật thật, không quét hư không", () => {
  it("★ sổ đăng ký SỐNG có đúng ba tool đứng sau `ai_repo_read` (một tool MỚI phải được thấy một lần)", () => {
    const ten = toolHopCat().map((t) => t.name).sort();
    expect(
      ten,
      "một tool MỚI gắn bit `ai_repo_read` là một CỬA MỚI vào mã nguồn. Đọc lưới này, chứng minh " +
        "nó đi qua `repoSandbox`, rồi mới thêm tên vào đây.",
    ).toEqual(["grep_repo", "list_files", "read_file"]);
  });

  it("★ mọi tool trong tập đều là read tool, có `handler`, và khai `__authCtx` trong schema", () => {
    for (const t of toolHopCat()) {
      expect(t.kind ?? "read", t.name).toBe("read");
      expect(typeof t.handler, t.name).toBe("function");
      const shape = (t.parameters as unknown as { shape?: Record<string, unknown> })?.shape;
      expect(Object.hasOwn(shape ?? {}, "__authCtx"), `${t.name}: thiếu ô __authCtx`).toBe(true);
    }
  });

  it("★ MÔI TRƯỜNG — không dựng được junction/hard link thì §B KHÔNG chứng minh gì", () => {
    expect(junctionOk, `không dựng được junction ⇒ ca 'symlink trỏ ra ngoài' vô nghĩa. Lý do: ${junctionErr}`).toBe(true);
    expect(hardlinkOk, `không dựng được hard link ⇒ ca hard link vô nghĩa. Lý do: ${hardlinkErr}`).toBe(true);
    expect(fs.statSync(path.join(HOP, "lien-ket-cung.ts")).nlink).toBeGreaterThan(1);
    /**
     * ⚠⚠ VẾ CHỐNG "XANH VÌ LÝ DO KHÁC": đích của JUNCTION phải có `nlink === 1`. Nếu nó dùng chung
     * inode với hard link thì ca junction bị chặn bởi phép kiểm HARD_LINK và phép kiểm **realpath**
     * không bao giờ được canh (đo được: đột biến M3 sống sót 27/27).
     */
    expect(
      fs.statSync(path.join(NGOAI, "prod-secret.ts")).nlink,
      "đích của junction có nhiều liên kết cứng ⇒ ca junction sẽ xanh vì HARD_LINK, không vì realpath",
    ).toBe(1);
    /**
     * ⚠⚠ VẾ SỐNG CÒN: cả hai vector PHẢI đọc được **khi không có hàng rào**. Không có vế này thì
     * mọi ca âm ở §B xanh vì `NOT_FOUND` — đúng lớp "lượng từ TỰ THOẢ".
     */
    expect(fs.readFileSync(path.join(HOP, "alias-ngoai", "prod-secret.ts"), "utf8")).toContain(CANARY);
    expect(fs.readFileSync(path.join(HOP, "lien-ket-cung.ts"), "utf8")).toContain(CANARY);
    // Symlink TỆP là vector PHỤ — trạng thái được KHAI, không được im lặng bỏ qua.
    if (!symlinkTepOk) {
      // eslint-disable-next-line no-console
      console.warn(`[repoSandbox.census] symlink TỆP không dựng được (${symlinkTepErr}) — vector phụ bị BỎ QUA; junction vẫn phủ lớp lỗi này.`);
    }
  });

  it("★ gốc hộp cát đọc từ env, LUÔN tuyệt đối, và mặc định là thư mục repo", () => {
    expect(gocHopCat()).toBe(path.resolve(HOP));
    delete process.env.AI_REPO_SANDBOX_ROOT;
    expect(gocHopCat()).toBe(GOC_REPO);
    expect(path.isAbsolute(gocHopCat())).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§A — CHIỀU DƯƠNG trước: hộp cát KHÔNG được chặn thứ nó phải cho qua", () => {
  it("★★★ đọc một file mã bình thường VẪN CHẠY, và trả đúng nội dung", async () => {
    const t = toolHopCat().find((x) => x.name === "read_file")!;
    const r = await t.handler!({ path: "ok.ts", __authCtx: AUTH } as never);
    expect(r.note, `bị chặn oan: ${r.textSummary}`).toBeUndefined();
    expect((r.data as { content: string | null }).content).toContain("DAU_HIEU_HOP_LE = 42");
  });

  it("★★★ `grep_repo` VẪN tìm được (không có ca này thì 'chặn tất cả' cũng xanh)", async () => {
    const t = toolHopCat().find((x) => x.name === "grep_repo")!;
    const r = await t.handler!({ pattern: "DAU_HIEU_HOP_LE", __authCtx: AUTH } as never);
    expect(r.note, `grep bị chặn oan: ${r.textSummary}`).toBeUndefined();
    const d = r.data as { count: number; matches: Array<{ path: string; line: number }> };
    expect(d.count).toBeGreaterThan(0);
    expect(d.matches[0]!.path).toBe("ok.ts");
    expect(d.matches[0]!.line).toBe(1);
  });

  it("★★ `list_files` liệt kê được gốc, và thư mục con đi được", async () => {
    const t = toolHopCat().find((x) => x.name === "list_files")!;
    const r = await t.handler!({ __authCtx: AUTH } as never);
    expect(r.note).toBeUndefined();
    const ten = (r.data as { entries: Array<{ path: string }> }).entries.map((e) => e.path);
    expect(ten).toContain("ok.ts");
    expect(ten).toContain("sub");

    const r2 = await t.handler!({ path: "sub", __authCtx: AUTH } as never);
    expect(r2.note).toBeUndefined();
    expect((r2.data as { entries: Array<{ path: string }> }).entries.map((e) => e.path)).toEqual(["sub/trong.ts"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§B — KHÔNG đường nào ra khỏi hộp cát (∀ tool × ∀ hình dạng thoát)", () => {
  /**
   * Mỗi phần tử là một CÁCH THOÁT ĐÃ BIẾT. Ba cái cuối là ba lớp lỗi có tiền lệ ĐO ĐƯỢC trong
   * repo này, không phải lo xa:
   *   • `sub/C:/…`      — `_uyQuyenAnh.ts:180`, bản đầu chỉ soi ĐẦU chuỗi ⇒ `C:` ở GIỮA lọt qua;
   *   • symlink         — `repoContextService` chốt chặn 2 (M-1): `statSync`/`readFileSync` ĐI THEO
   *                       symlink, nên phép so tiền tố chuỗi thuần **mù hoàn toàn**;
   *   • hard link       — N13/C-2: realpath của hard link nằm GỌN trong gốc, **không phép kiểm
   *                       đường dẫn nào** thấy được nó; chỉ `nlink` trên fd mới thấy.
   */
  function hinhDangThoat(): Array<{ ten: string; duongDan: string }> {
    const ra = [
      { ten: "`..` một nấc", duongDan: `../${tenNgoai}/prod-secret.ts` },
      { ten: "`..` dấu chéo ngược", duongDan: `..\\${tenNgoai}\\prod-secret.ts` },
      { ten: "`..` nằm giữa", duongDan: `sub/../../${tenNgoai}/prod-secret.ts` },
      { ten: "đường TUYỆT ĐỐI", duongDan: path.join(NGOAI, "prod-secret.ts") },
      { ten: "ổ đĩa ở ĐẦU", duongDan: "C:/Windows/win.ini" },
      { ten: "ổ đĩa ở GIỮA (tiền lệ _uyQuyenAnh)", duongDan: "sub/C:/Windows/win.ini" },
      { ten: "UNC", duongDan: "//may-khac/share/x.ts" },
      { ten: "byte NUL", duongDan: "ok.ts\u0000.png" },
      { ten: "JUNCTION trỏ RA NGOÀI", duongDan: "alias-ngoai/prod-secret.ts" },
      { ten: "hard link trỏ RA NGOÀI", duongDan: "lien-ket-cung.ts" },
      { ten: "tệp bí mật `.env`", duongDan: ".env" },
      { ten: "tệp bí mật `.env.bak-*`", duongDan: ".env.bak-cu" },
      { ten: "thư mục bị loại trừ", duongDan: "node_modules/goi-la/index.ts" },
    ];
    if (symlinkTepOk) ra.push({ ten: "symlink TỆP trỏ RA NGOÀI", duongDan: "lien-ket-mem.ts" });
    return ra;
  }

  it("★★★ ∀ tool × ∀ hình dạng: KHÔNG canary nào lọt, và mọi lượt đều có MÃ đọc được", async () => {
    const ro: string[] = [];
    const imLang: string[] = [];
    for (const t of toolHopCat()) {
      for (const { ten, duongDan } of hinhDangThoat()) {
        const out = await moiDauRa(t, duongDan);
        if (out.includes(CANARY) || out.includes("MASTER_API_KEY") || out.includes("ANH_KY_SECRET")) {
          ro.push(`${t.name} ← ${ten} (${duongDan}) → ${out.slice(0, 300)}`);
        }
        // "0 dòng im lặng là nói dối": một lượt bị chặn phải nói ra MÃ, không được trả rỗng lặng lẽ.
        if (!/"note":"[A-Z_]+"/.test(out)) imLang.push(`${t.name} ← ${ten} (${duongDan}) → ${out.slice(0, 240)}`);
      }
    }
    expect(
      ro,
      "một tool đã chở byte của một tệp NGOÀI hộp cát (hoặc trong danh sách cấm) ra ngoài. Sửa " +
        "`repoSandbox`, KHÔNG nới lưới:\n" + ro.join("\n"),
    ).toEqual([]);
    expect(
      imLang,
      "một lượt TỪ CHỐI không kèm mã máy-đọc-được — người vận hành không phân biệt được 'bị cấm' " +
        "với 'không có':\n" + imLang.join("\n"),
    ).toEqual([]);
  }, 60_000);

  it("★★★ `grep_repo` quét CẢ gốc mà vẫn KHÔNG thấy canary (đường vòng qua duyệt cây)", async () => {
    /**
     * ⚠ Ca này KHÁC ca trên: ở đây không ai nêu tên tệp xấu. `grep_repo` **tự** duyệt cây và tự gặp
     * `.env`, `node_modules/`, symlink và hard link. Nếu phép lọc của `duyetTepDocDuoc` hỏng thì
     * canary đi ra mà **không một tham số nào của người dùng có lỗi** — đúng hình dạng của một lỗ
     * không ai nghĩ tới.
     */
    const t = toolHopCat().find((x) => x.name === "grep_repo")!;
    const r = await t.handler!({ pattern: MAU_TIM, __authCtx: AUTH } as never);
    expect(JSON.stringify(r.data), "canary lọt vào `data` của grep").not.toContain(CANARY);
    expect((r.data as { count: number }).count, `grep đã đọc được canary: ${r.textSummary}`).toBe(0);
    expect(r.note).toBe("NO_MATCH");
    // …và nó PHẢI đã quét được ít nhất một tệp, nếu không "0 kết quả" là vì không quét gì cả.
    expect((r.data as { scanned: number }).scanned, "0 tệp quét ⇒ ca này tự thoả").toBeGreaterThan(0);
  }, 30_000);

  it("★★ `list_files` KHÔNG hiện tên tệp bí mật (biết nó tồn tại cũng đã là rò)", async () => {
    const t = toolHopCat().find((x) => x.name === "list_files")!;
    const r = await t.handler!({ __authCtx: AUTH } as never);
    const ten = (r.data as { entries: Array<{ path: string }> }).entries.map((e) => e.path);
    expect(ten).not.toContain(".env");
    expect(ten).not.toContain(".env.bak-cu");
    expect(ten).not.toContain("node_modules");
    // …nhưng junction/symlink thì VẪN hiện, KHAI ĐÚNG BẢN CHẤT — người kỹ sư cần biết nó ở đó, và
    // lượt ĐỌC qua nó vẫn bị cửa realpath phán quyết (xem ca "JUNCTION trỏ RA NGOÀI" ở trên).
    expect(ten).toContain("alias-ngoai");
    const lienKet = (r.data as { entries: Array<{ path: string; kind: string }> }).entries.find(
      (e) => e.path === "alias-ngoai",
    );
    expect(lienKet!.kind, "một junction phải được khai là `symlink`, KHÔNG phải `dir`").toBe("symlink");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§C — TRẦN: byte mỗi tệp · byte mỗi phiên", () => {
  it("★★★ trần BYTE MỖI TỆP cắt thật, và lượt cắt được KHAI ra", async () => {
    const to = path.join(HOP, "to.ts");
    fs.writeFileSync(to, `// ${"x".repeat(TRAN_BYTE_MOI_TEP * 2)}\n`);
    const t = toolHopCat().find((x) => x.name === "read_file")!;
    const r = await t.handler!({ path: "to.ts", __authCtx: AUTH } as never);
    const d = r.data as { content: string | null; truncated: boolean; bytes: number | null };
    expect(d.content!.length).toBeLessThanOrEqual(TRAN_BYTE_MOI_TEP);
    expect(d.truncated, "cắt mà không khai là nói dối về nội dung file").toBe(true);
    expect(d.bytes, "`bytes` phải là kích thước THẬT trên đĩa, không phải độ dài đã cắt").toBeGreaterThan(
      TRAN_BYTE_MOI_TEP,
    );
    expect(r.textSummary).toMatch(/ĐÃ CẮT/);
    fs.rmSync(to, { force: true });
  });

  it("★★★ trần BYTE MỖI PHIÊN chặn được lượt đọc thứ N, và nói rõ đó là TRẦN chứ không phải sự cố", async () => {
    const to = path.join(HOP, "lap.ts");
    fs.writeFileSync(to, `// ${"y".repeat(TRAN_BYTE_MOI_TEP)}\n`);
    const t = toolHopCat().find((x) => x.name === "read_file")!;
    let chan: { note?: string; textSummary: string } | null = null;
    for (let i = 0; i < 40; i++) {
      const r = await t.handler!({ path: "lap.ts", __authCtx: AUTH } as never);
      if (r.note === "BUDGET_EXCEEDED") {
        chan = r;
        break;
      }
    }
    expect(chan, "đọc 40 lượt × 64 KiB mà ngân sách 1 MiB không chặn ⇒ trần là TRANG TRÍ").not.toBeNull();
    expect(chan!.textSummary).toMatch(/TRẦN|ngân sách/i);
    fs.rmSync(to, { force: true });
  }, 30_000);

  it("★★ ngân sách theo DANH TÍNH PHIÊN: người khác KHÔNG bị người trước tiêu hộ", async () => {
    const to = path.join(HOP, "lap2.ts");
    fs.writeFileSync(to, `// ${"z".repeat(TRAN_BYTE_MOI_TEP)}\n`);
    const t = toolHopCat().find((x) => x.name === "read_file")!;
    for (let i = 0; i < 40; i++) {
      const r = await t.handler!({ path: "lap2.ts", __authCtx: AUTH } as never);
      if (r.note === "BUDGET_EXCEEDED") break;
    }
    const nguoiKhac = await t.handler!({ path: "lap2.ts", __authCtx: { userId: 8, role: "engineer" } } as never);
    expect(nguoiKhac.note, "trần phải theo PHIÊN, không phải một biến toàn cục").toBeUndefined();
    fs.rmSync(to, { force: true });
  }, 30_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§D — GỐC THẬT (thư mục repo): thứ duy nhất nói được về hệ đang chạy", () => {
  beforeEach(() => {
    delete process.env.AI_REPO_SANDBOX_ROOT;
  });

  it("★★★ `.env` THẬT bị từ chối — và ca TỰ CHỨNG MINH rằng nó CÓ TỒN TẠI", async () => {
    /**
     * ⚠⚠ Không có vế thứ hai thì ca này là **lượng từ TỰ THOẢ**: một `.env` không tồn tại cũng cho
     * "không đọc được", và lưới sẽ xanh trên một hệ không có bí mật nào để rò. Lớp lỗi ấy đã bị đo
     * đúng hôm nay ("ca âm trên bảng KHÔNG có dữ liệu nên trả [] bất kể cổng").
     */
    expect(
      fs.existsSync(path.join(GOC_REPO, ".env")),
      "repo này KHÔNG có `.env` ⇒ ca dưới không chứng minh được điều gì",
    ).toBe(true);
    const t = toolHopCat().find((x) => x.name === "read_file")!;
    const r = await t.handler!({ path: ".env", __authCtx: AUTH } as never);
    expect(r.note).toBe("DENIED_SECRET");
    expect((r.data as { content: string | null }).content).toBeNull();
  });

  it("★★ mọi tệp `.env*` THẬT ở gốc repo đều bị CẢ HAI lớp chặn (tên VÀ đuôi)", () => {
    const envs = fs.readdirSync(GOC_REPO).filter((n) => /^\.env/i.test(n));
    expect(envs.length, "không có tệp .env* nào ⇒ phép đo này rỗng").toBeGreaterThan(0);
    for (const n of envs) {
      expect(KHUON_TEP_CAM.some((k) => k.test(n)), `lớp TÊN không bắt được ${n}`).toBe(true);
      expect(DUOI_CHO_PHEP.has(path.extname(n).toLowerCase()), `lớp ĐUÔI không bắt được ${n}`).toBe(false);
    }
  });

  it("★★★ CHIỀU DƯƠNG trên gốc thật: một file `.ts` của chính repo VẪN đọc được", async () => {
    const t = toolHopCat().find((x) => x.name === "read_file")!;
    const r = await t.handler!({
      path: "server/services/aiLocalTools/toolRegistry.ts",
      __authCtx: AUTH,
    } as never);
    expect(r.note, `bị chặn oan trên gốc thật: ${r.textSummary}`).toBeUndefined();
    expect((r.data as { content: string | null }).content).toContain("export function registerTool");
  });

  it("★★★ CHIỀU DƯƠNG trên gốc thật: `grep_repo` tìm được trong cây mã thật", async () => {
    const t = toolHopCat().find((x) => x.name === "grep_repo")!;
    const r = await t.handler!({
      pattern: "export function argsWithAuthCtx",
      path: "server/services/aiLocalTools",
      __authCtx: AUTH,
    } as never);
    expect(r.note, `grep không tìm ra thứ chắc chắn có: ${r.textSummary}`).toBeUndefined();
    const d = r.data as { matches: Array<{ path: string }> };
    expect(d.matches.map((m) => m.path)).toContain("server/services/aiLocalTools/toolRegistry.ts");
  }, 30_000);

  it("★★ `node_modules`/`.git`/`dist` bị loại trừ ngay cả khi nằm SÂU trong cây", () => {
    for (const p of [
      "node_modules/zod/package.json",
      "server/node_modules/x/index.ts",
      "client/dist/bundle.js",
      ".git/config",
      "uploads/inspections/1/a.json",
    ]) {
      const kq = moTepTrongHopCat(p);
      expect(kq.ok, `lọt: ${p}`).toBe(false);
      if (!kq.ok) expect(["DENIED_DIR", "DENIED_EXT"]).toContain(kq.ma);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§G — TỪNG TẦNG MỘT: hai lớp che nhau, nên mỗi lớp phải quan sát được RIÊNG", () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ VÌ SAO §B CHƯA ĐỦ — VÀ ĐÂY LÀ MỘT PHÉP ĐO, KHÔNG PHẢI MỘT LO XA.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Một đường dẫn `..` bị chặn **HAI lần**: (1) `repoSandbox.phanQuyetDuongDan` — thuần, trước mọi
   * I/O; (2) `readToolsProgramming.resolveInternal` — cửa đĩa dùng chung. §B đi qua **tool**, nên
   * nó chỉ thấy HỢP của hai lớp: gỡ **một** lớp ⇒ lớp kia đỡ ⇒ **§B VẪN XANH**.
   *
   * Đó chính là hình dạng *"đột biến không ăn mà lưới vẫn xanh"* đã xảy ra bảy lần trong repo này.
   * ⇒ §G lái **THẲNG cửa đĩa**, bỏ qua lớp chính sách. Nay: gỡ phép kiểm tiền tố ⇒ §G ĐỎ; gỡ
   *   phép kiểm chính sách ⇒ ca cuối của §G (lái thẳng `phanQuyetDuongDan`) ĐỎ. Hai lớp, hai lưới.
   */
  it("★★★ CỬA ĐĨA (bỏ qua lớp chính sách): mọi hình dạng thoát đều bị TỪ CHỐI", async () => {
    const { confineTargetUnder, readConfined } = await import("./readToolsProgramming");
    const thoat: Array<[string, string]> = [
      ["`..`", `../${tenNgoai}/prod-secret.ts`],
      ["`..` chéo ngược", `..\\${tenNgoai}\\prod-secret.ts`],
      ["`..` nằm giữa", `sub/../../${tenNgoai}/prod-secret.ts`],
      ["tuyệt đối", path.join(NGOAI, "prod-secret.ts")],
      ["ổ đĩa ở ĐẦU", "C:/Windows/win.ini"],
      ["ổ đĩa ở GIỮA", "sub/C:/Windows/win.ini"],
      ["JUNCTION ra ngoài", "alias-ngoai/prod-secret.ts"],
      ["hard link ra ngoài", "lien-ket-cung.ts"],
      ["NUL", "ok.ts\u0000.png"],
    ];
    for (const [ten, p] of thoat) {
      const c = confineTargetUnder(HOP, p);
      expect(c.ok, `cửa đĩa CHO QUA ${ten} (${p})`).toBe(false);
      if (c.ok) {
        // Nếu cửa cho qua, đo tiếp xem có byte nào ra không — bằng chứng mạnh hơn một cờ boolean.
        const rd = readConfined(c.target, 65_536);
        expect(JSON.stringify(rd), `${ten}: byte ĐÃ RỜI hộp cát`).not.toContain(CANARY);
      }
    }
  });

  it("★★★ CỬA ĐĨA — chiều DƯƠNG: file thường trong gốc VẪN qua được và đọc ra đúng byte", async () => {
    const { confineTargetUnder, readConfined } = await import("./readToolsProgramming");
    const c = confineTargetUnder(HOP, "ok.ts");
    expect(c.ok, "cửa đĩa chặn oan một file thường").toBe(true);
    if (!c.ok) return;
    const rd = readConfined(c.target, 65_536);
    expect(rd.ok).toBe(true);
    expect(rd.ok ? rd.content : "").toContain("DAU_HIEU_HOP_LE = 42");
  });

  it("★★★ LỚP CHÍNH SÁCH (thuần, không chạm đĩa): tự nó đã đủ phán quyết mọi hình dạng", async () => {
    const { phanQuyetDuongDan } = await import("./repoSandbox");
    for (const [p, ma] of [
      [`../${tenNgoai}/prod-secret.ts`, "PATH_REJECTED"],
      [`..\\${tenNgoai}\\x.ts`, "PATH_REJECTED"],
      ["C:/Windows/win.ini", "PATH_REJECTED"],
      ["sub/C:/Windows/win.ini", "PATH_REJECTED"],
      ["ok.ts\u0000.png", "PATH_REJECTED"],
      [".env", "DENIED_SECRET"],
      [".env.bak-cu", "DENIED_SECRET"],
      ["server/khoa.pem", "DENIED_SECRET"],
      ["node_modules/x/index.ts", "DENIED_DIR"],
      ["client/dist/a.js", "DENIED_DIR"],
    ] as const) {
      expect(phanQuyetDuongDan(p), `lớp chính sách phán sai cho ${p}`).toBe(ma);
    }
    // …và chiều DƯƠNG: một đường dẫn mã nguồn bình thường phải được cho qua.
    expect(phanQuyetDuongDan("server/services/aiLocalTools/toolRegistry.ts")).toBeNull();
    expect(phanQuyetDuongDan("ok.ts")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§F — RANH GIỚI với `read_project_file`: quyết bởi TRIGGER, không bởi thứ tự `import`", () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ CA NÀY SINH RA TỪ MỘT LƯỚI **XANH VÌ LÝ DO SAI**, ĐO ĐƯỢC TRONG CHÍNH LƯỢT NÀY.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Bản đầu của `read_file` khai trùng nguyên văn 6 trigger với `read_project_file`. `diemTrigger`
   * cộng theo ĐỘ DÀI và `findToolByTriggers` chọn bằng `score > best.score` (NGẶT) ⇒ **hoà điểm**
   * ⇒ thắng thua do **thứ tự đăng ký**, tức do thứ tự dòng `import` trong `index.ts`. Ca cũ của
   * `toolArgCoverage` (*"đọc file main.st"* ⇒ `read_project_file`) **vẫn XANH** suốt thời gian ấy.
   * ⇒ Ca này khoá **cả hai chiều**, để một lượt đổi trigger (hoặc đổi thứ tự import) không lặng lẽ
   *   chuyển câu hỏi của người dùng sang một HỘP CÁT KHÁC.
   */
  it("★★★ câu 'workspace lập trình' vào `read_project_file`; câu 'mã nguồn repo' vào `read_file`", async () => {
    const { classifyToolIntent } = await import("./intentClassifier");
    for (const q of ["đọc file main.st", "mở file program.st", "xem file recipe.json"]) {
      expect(classifyToolIntent(q).tool, `"${q}" phải về workspace lập trình`).toBe("read_project_file");
    }
    for (const q of [
      "xem mã nguồn server/services/aiLocalTools/toolRegistry.ts",
      "đọc mã nguồn của repo file server/index.ts",
      "cho tôi xem code server/db/connection.ts",
    ]) {
      expect(classifyToolIntent(q).tool, `"${q}" phải về hộp cát repo`).toBe("read_file");
    }
  });

  it("★★★ KHÔNG trigger nào bị khai TRÙNG NGUYÊN VĂN giữa hai tool đọc tệp", async () => {
    const { getTool } = await import("./toolRegistry");
    const a = new Set(getTool("read_file")!.triggers.map((t) => t.toLowerCase().trim()));
    const b = getTool("read_project_file")!.triggers.map((t) => t.toLowerCase().trim());
    const trung = b.filter((t) => a.has(t));
    expect(
      trung,
      "trigger trùng ⇒ hai tool HOÀ điểm ⇒ người thắng là người ĐĂNG KÝ TRƯỚC. Hành vi sản phẩm " +
        "không được quyết bởi thứ tự dòng `import`.",
    ).toEqual([]);
  });

  it("★★ `grep_repo` lấy được mẫu từ ba hình dạng câu hỏi thật, và mẫu TRUY được về câu hỏi", async () => {
    const { extractArgsForTool } = await import("./intentClassifier");
    for (const [q, mong] of [
      ["tìm trong mã nguồn chuỗi argsWithAuthCtx", "argsWithAuthCtx"],
      ['tìm trong repo "confineTargetUnder"', "confineTargetUnder"],
      ["hàm redactSecretsOnly được gọi ở đâu", "redactSecretsOnly"],
    ] as const) {
      const args = extractArgsForTool("grep_repo", q);
      expect(args.pattern, `"${q}"`).toBe(mong);
      // RR-2: giá trị phải TRUY được về câu hỏi — một hằng bịa không có mặt trong câu.
      expect(q.includes(String(args.pattern))).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§E — CỔNG QUYỀN: hộp cát không phải cổng duy nhất", () => {
  it("★★★ cổng RBAC trả FALSE ⇒ mọi tool TỪ CHỐI, và không byte nào rời hộp cát", async () => {
    checkPermissionMock.mockResolvedValue(false);
    for (const t of toolHopCat()) {
      const r = await t.handler!({ path: "ok.ts", pattern: "DAU_HIEU", __authCtx: AUTH } as never);
      expect(r.note, t.name).toBe("PERMISSION_DENIED");
      expect(JSON.stringify(r.data), t.name).not.toContain("DAU_HIEU_HOP_LE");
    }
  });

  it("★★★ THIẾU `__authCtx` ⇒ TỪ CHỐI, và cổng KHÔNG được hỏi bằng một danh tính bịa", async () => {
    checkPermissionMock.mockResolvedValue(true);
    for (const t of toolHopCat()) {
      checkPermissionMock.mockClear();
      const r = await t.handler!({ path: "ok.ts", pattern: "DAU_HIEU" } as never);
      expect(r.note, t.name).toBe("PERMISSION_DENIED");
      expect(checkPermissionMock, `${t.name}: đã hỏi cổng bằng danh tính không tồn tại`).not.toHaveBeenCalled();
    }
  });

  it("★★ cặp tới `checkPermission` ĐÚNG BẰNG cặp đã khai (`ai_repo_read/canView`)", async () => {
    checkPermissionMock.mockResolvedValue(true);
    for (const t of toolHopCat()) {
      checkPermissionMock.mockClear();
      await t.handler!({ path: "ok.ts", pattern: "DAU_HIEU", __authCtx: AUTH } as never);
      const goi = checkPermissionMock.mock.calls.at(0)!;
      expect([goi[2], goi[3]], t.name).toEqual(["ai_repo_read", "canView"]);
      expect([goi[0], goi[1]], t.name).toEqual([7, "engineer"]);
    }
  });
});
