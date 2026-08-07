/**
 * ★★★ Pha 7 §4.1 + §4.2 — **HÀNG RÀO CANH CÁI HÀNG RÀO.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI — TRỚ TRÊU ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 6 dựng `scripts/i18n-check.mjs` (PASS B) để cân **mặt NGƯỜI** với **mặt Agent**: mặt Agent
 * bị cưỡng chế **ba bản thật** (`vramPhrases.exhaustive.test.ts`), mặt người trước đó có **0** phép
 * canh. Bản vá ấy đúng — nhưng **chính bộ cưỡng chế mới lại KHÔNG AI CANH**:
 *
 * | | mặt **Agent** | mặt **NGƯỜI** (trước lưới này) |
 * |---|---|---|
 * | là **vitest**? | ✅ | ❌ — một script `.mjs` gọi tay |
 * | trong **16 đường** §Cổng kiểm chung? | ✅ | ❌ |
 * | trong **CI**? | ✅ | ❌ — `grep -rn "i18n" .github/workflows/` = **0/7 workflow** |
 * | có test canh **chính nó**? | ✅ | ❌ — **0** file test nào THỰC THI `i18n-check.mjs` |
 *
 * **ĐO ĐƯỢC (Pha 7 Bước 1):** hoàn nguyên PASS B về đúng bản trước `1ada0526`, **cộng** đột biến
 * xoá `vramBroker.preempt` khỏi **cả ba** locale ⇒ `i18n:check` **exit 0** và §Cổng kiểm chung
 * **1902/1902 XANH (111 file)**. Đó là định nghĩa của **lưới giả, ở tầng CÔNG CỤ**.
 *
 * ⇒ Lưới này **THỰC THI script thật** trên **bộ đầu vào dựng sẵn**, không đọc mã nó, không chép
 *   lại luật của nó. *"Đo bằng CÙNG MỘT TẬP ĐẦU VÀO qua các phiên bản"* (Global Constraints) —
 *   chứ không đo bằng số đếm hay bằng hình dạng mã, vì hình dạng thì viết khác đi được.
 *
 * ⚠ **TÊN FILE là một quyết định, không phải thói quen:** `vitest.config.ts` gom mã client bằng
 *   `client/src/**\/*.unit.test.ts` — **không** phải `*.test.ts`. Đặt tên `.test.ts` ở đây thì
 *   **vitest lặng lẽ không chạy file này** trong khi §Cổng kiểm chung vẫn khai XANH (glob rỗng ⇒
 *   im lặng — lớp lỗi đã tái diễn **bốn** lần, một lần che **18 ca đỏ**). Đuôi `.unit.test.ts`
 *   thoả **cả hai**: vitest chạy nó, **và** `vramPha5Gate.test.ts` (quét `*.test.ts`) đếm nó.
 * ⚠ **VỊ TRÍ cũng là một quyết định:** `client/src/lib/` đã là **một đường của §Cổng kiểm chung**,
 *   nên file này vào tập bị canh qua **bộ nhận diện thứ ba** (`DAU_KHAI_PHA` ∧ `duocPhu`) mà
 *   `CONG.length` giữ nguyên **16**; chỉ `FILE_CANH` đổi 73 → 74. Đặt ở `scripts/` thì vitest chạy
 *   được nhưng `vramPha5Gate.test.ts` **không quét tới** (nó chỉ đi `server`/`client/src`/`shared`)
 *   ⇒ xoá file đi mà **không ca nào đỏ** — đúng cái lỗ đang đóng.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const THU_MUC = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
const GOC = join(THU_MUC, "..", "..", ".."); // gốc repo
const SCRIPT = join(GOC, "scripts", "i18n-check.mjs");
const NEN_THAT = join(GOC, "scripts", "i18n-missing-baseline.json");
const TRAN_THAT = join(GOC, "scripts", "i18n-baseline-tran.json");
const CI = join(GOC, ".github", "workflows", "ci.yml");
const KE_HOACH_PHA5 = join(GOC, "docs", "superpowers", "plans", "2026-08-06-vram-pha5-tra-no.md");

const LOCALES = ["en", "vi", "zh"] as const;
type Locale = (typeof LOCALES)[number];

interface Nen {
  _ghim?: { missingInAllLocales: number; missingInSomeLocales: number };
  missingInAllLocales: string[];
  missingInSomeLocales: string[];
}
interface Tran {
  missingInAllLocales: number;
  missingInSomeLocales: number;
}
interface CaiDat {
  /** Khoá mà **MÃ** tham chiếu (sinh ra lời gọi `t("…")` trong một file `.tsx` giả). */
  ma: string[];
  /**
   * ★ I-3 — hình dạng **THỨ HAI** mà công cụ nhận: `key: "a.b"` trong một **bảng hằng**
   * (ví dụ thật: `VRAM_READ_SURFACE_NOTICE` giữ khoá ở đó chứ không ở lời gọi `t(`).
   */
  keyBang?: string[];
  /** Bảng dịch **phẳng** cho từng locale. Vắng mặt ở đây = khoá thiếu ở locale đó. */
  ban: Partial<Record<Locale, Record<string, string>>>;
  /** ★ I-2 — văn bản JSON **THÔ** cho một locale (để dựng được ca **KHOÁ TRÙNG**, thứ `JSON.stringify` không tạo ra được). */
  tho?: Partial<Record<Locale, string>>;
  nen?: Nen | null;
  tran?: Tran | null;
}

const daTao: string[] = [];
afterAll(() => {
  for (const d of daTao) rmSync(d, { recursive: true, force: true });
});

/** Bảng phẳng `{"a.b": "x"}` → cây lồng `{a:{b:"x"}}` (đúng hình dạng file locale thật). */
function longVao(phang: Record<string, string>): Record<string, unknown> {
  const cay: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(phang)) {
    const doan = k.split(".");
    let nut = cay;
    for (let i = 0; i < doan.length - 1; i++) {
      const d = doan[i] as string;
      if (typeof nut[d] !== "object" || nut[d] === null) nut[d] = {};
      nut = nut[d] as Record<string, unknown>;
    }
    nut[doan[doan.length - 1] as string] = v;
  }
  return cay;
}

/** Dựng một **gốc repo giả** đủ để `i18n-check.mjs` chạy trên đó (nó nhận `repoRoot` qua argv). */
function dungGoc(cd: CaiDat): string {
  const goc = mkdtempSync(join(tmpdir(), "i18nq-"));
  daTao.push(goc);
  mkdirSync(join(goc, "client", "src", "i18n", "locales"), { recursive: true });
  mkdirSync(join(goc, "client", "src", "pages"), { recursive: true });
  mkdirSync(join(goc, "scripts"), { recursive: true });
  for (const l of LOCALES) {
    writeFileSync(
      join(goc, "client", "src", "i18n", "locales", `${l}.json`),
      cd.tho?.[l] ?? `${JSON.stringify(longVao(cd.ban[l] ?? {}), null, 2)}\n`,
      "utf8",
    );
  }
  const than = cd.ma.map((k) => `  const _${k.replace(/[^\w]/g, "_")} = t(${JSON.stringify(k)});`).join("\n");
  const bang = (cd.keyBang ?? []).map((k) => `  { key: ${JSON.stringify(k)} },`).join("\n");
  writeFileSync(
    join(goc, "client", "src", "pages", "Fixture.tsx"),
    `export const BANG = [\n${bang}\n];\n` +
      `export function Fixture(t: (k: string) => string) {\n${than}\n  return null;\n}\n`,
    "utf8",
  );
  if (cd.nen !== null) {
    writeFileSync(join(goc, "scripts", "i18n-missing-baseline.json"), `${JSON.stringify(cd.nen ?? khongNo(), null, 2)}\n`, "utf8");
  }
  if (cd.tran !== null) {
    writeFileSync(
      join(goc, "scripts", "i18n-baseline-tran.json"),
      `${JSON.stringify(cd.tran ?? { missingInAllLocales: 0, missingInSomeLocales: 0 }, null, 2)}\n`,
      "utf8",
    );
  }
  return goc;
}

function khongNo(): Nen {
  return { _ghim: { missingInAllLocales: 0, missingInSomeLocales: 0 }, missingInAllLocales: [], missingInSomeLocales: [] };
}

function chay(goc: string, them: string[] = []): { ma: number; ra: string } {
  const r = spawnSync(process.execPath, [SCRIPT, goc, ...them], { encoding: "utf8" });
  return { ma: r.status ?? -1, ra: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Bộ đầu vào **XANH** dùng làm đối chứng: mọi khoá đủ ba bản, kèm một khoá **CỐ Ý RỖNG**. */
function nenXanh(): CaiDat {
  const ban = Object.fromEntries(
    LOCALES.map((l) => [l, { "fixt.dayDu": `du-${l}`, "fixt.coDauRong": "" }]),
  ) as Partial<Record<Locale, Record<string, string>>>;
  return { ma: ["fixt.dayDu", "fixt.coDauRong"], ban, nen: khongNo(), tran: { missingInAllLocales: 0, missingInSomeLocales: 0 } };
}

describe("★★★ Pha 7 §4.1 — bộ cưỡng chế mặt NGƯỜI phải được canh NGANG mặt Agent", () => {
  it("★★★ cầu chì — script tồn tại, và bộ đầu vào ĐỐI CHỨNG phải XANH (0 file ⇒ mọi ca dưới là chân lý rỗng)", () => {
    expect(existsSync(SCRIPT), `không thấy ${SCRIPT}`).toBe(true);
    const r = chay(dungGoc(nenXanh()));
    expect(r.ma, `bộ đối chứng phải XANH, nhưng:\n${r.ra}`).toBe(0);
  });

  /**
   * ⚠⚠ BA LỖ, BA CA RIÊNG — **cố ý không gộp**. Gộp lại thì một ca đỏ không cho biết **lỗ nào**
   * đang hở, và lượt hoàn nguyên **từng phần** (thứ hay xảy ra thật) sẽ trượt qua.
   */
  it("★★★ LỖ 1 — lượng từ chạy trên khoá **MÃ THAM CHIẾU**, không trên khoá trong FILE DỊCH", () => {
    /**
     * Khoá `fixt.chiTrongMa` được mã gọi nhưng **vắng ở cả ba** locale. Bản công cụ TRƯỚC
     * `1ada0526` duyệt khoá **có trong file dịch** ⇒ khoá này **vô hình tuyệt đối** (đúng luật
     * *"vắng ở cả ba ⇒ không lệch"*). Đây chính là hình dạng của 30/33 nhãn `vramBroker.*`.
     */
    const cd = nenXanh();
    cd.ma.push("fixt.chiTrongMa");
    const r = chay(dungGoc(cd));
    expect(r.ma, `phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("MISSING IN ALL 3");
    expect(r.ra).toContain("fixt.chiTrongMa");
    // …và phải chỉ ĐÍCH DANH file dùng nó — một câu đỏ không có con trỏ thì không ai sửa được.
    expect(r.ra).toContain("client/src/pages/Fixture.tsx");
  });

  it("★★★ LỖ 2 — khoá có ở **ĐÚNG MỘT** locale KHÔNG được nuốt im lặng (`present.length < 2 ⇒ continue`)", () => {
    /**
     * Bản cũ có `if (present.length < 2) continue` ⇒ dịch cho **đúng một** ngôn ngữ vẫn XANH.
     * Nay phải nói bằng câu đúng: thiếu ở **hai** locale còn lại, gọi tên cả hai.
     *
     * ⚠⚠ **VÌ SAO GIÁ TRỊ NÀY CÓ `{{x}}`** — đây là một lựa chọn để **CHẨN ĐOÁN ĐƯỢC**, không phải
     * trang trí. Đo bằng đột biến: nếu giá trị **không** có placeholder thì ca này cũng đỏ khi
     * hoàn nguyên **LỖ 3** (chỉ so placeholder) ⇒ ba lỗ cho ba chữ ký **lồng nhau** `{1}⊂{1,2}⊂{1,2,3}`
     * và ca "LỖ 2" không còn nói riêng về lỗ 2 nữa. Có placeholder ⇒ nó **sống sót** qua LỖ 3, và
     * chữ ký thành **PHÂN BIỆT ĐƯỢC**: LỖ1→`{1}` · LỖ2→`{1,2}` · LỖ3→`{1,3}`.
     */
    const cd = nenXanh();
    cd.ma.push("fixt.chiCoEn");
    (cd.ban.en as Record<string, string>)["fixt.chiCoEn"] = "only-en {{x}}";
    const r = chay(dungGoc(cd));
    expect(r.ma, `phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("MISSING IN vi/zh");
    expect(r.ra).toContain("fixt.chiCoEn");
  });

  it("★★★ LỖ 3 — so **SỰ CÓ MẶT**, không chỉ so PLACEHOLDER", () => {
    /**
     * ⚠ Ca này **cố ý** dùng khoá **KHÔNG có placeholder nào** và thiếu ở **đúng một** locale.
     * Bản cũ chỉ so placeholder và bỏ qua khi `union.length === 0` ⇒ một khoá không placeholder
     * là **bất khả kiến** dù thiếu ở đâu. Đó là lý do ca này không dùng `{{…}}`: nếu có
     * placeholder thì PASS A cũ cũng bắt được, và ca sẽ **xanh vì lý do sai**.
     */
    const cd = nenXanh();
    cd.ma.push("fixt.khongPlaceholder");
    (cd.ban.en as Record<string, string>)["fixt.khongPlaceholder"] = "khong co bien";
    (cd.ban.vi as Record<string, string>)["fixt.khongPlaceholder"] = "không có biến";
    const r = chay(dungGoc(cd));
    expect(r.ma, `phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("MISSING IN zh");
    expect(r.ra).toContain("fixt.khongPlaceholder");
  });

  it("★★ KHÔNG BẮT NHẦM — khoá **CỐ Ý RỖNG** ở cả ba vẫn HỢP LỆ (vị từ là `!== undefined`, không phải truthiness)", () => {
    /**
     * `errors.trust.trusted` của Pha 5 là chuỗi **RỖNG** ở cả ba locale — cố ý, để câu ra không
     * hạ giọng khi số liệu đáng tin. Nếu phép canh dùng truthiness thì nó sẽ báo đỏ một thiết kế
     * đúng, và người ta sẽ tắt cổng đi.
     */
    const cd = nenXanh();
    cd.ma.push("fixt.rongCaBa");
    for (const l of LOCALES) (cd.ban[l] as Record<string, string>)["fixt.rongCaBa"] = "";
    const r = chay(dungGoc(cd));
    expect(r.ma, `chuỗi rỗng phải HỢP LỆ, nhưng:\n${r.ra}`).toBe(0);
  });

  it("★★★ I-3 — hình dạng **THỨ HAI** `key: \"a.b\"` (bảng hằng) cũng nằm trong lượng từ, và KHÔNG bắt nhầm", () => {
    /**
     * ⚠⚠ Trước lượt vá này, **không ca nào** canh hình dạng `key: "a.b"` — bộ suy có hai nhánh mà
     * lưới chỉ canh **một**. Trên repo thật nó chỉ đỏ **gián tiếp** (qua `BASELINE STALE`), tức là
     * đỏ vì **nền lệch**, không phải vì **khoá thiếu** — một chẩn đoán sai địa chỉ.
     *
     * Hai chiều trong **một** bộ đầu vào:
     *  • `fixt.tuBang` — `fixt` là không-gian cấp một **CÓ THẬT** ⇒ **phải** vào lượng từ ⇒ ĐỎ;
     *  • `khongPhaiNs.abc` — không-gian **KHÔNG có thật** ⇒ đây là `key:` của mã **không-dịch**
     *    (id, tên cột…) ⇒ **KHÔNG được** bắt nhầm.
     */
    const cd = nenXanh();
    cd.keyBang = ["fixt.tuBang", "khongPhaiNs.abc"];
    const r = chay(dungGoc(cd));
    expect(r.ma, `phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("MISSING IN ALL 3");
    expect(r.ra).toContain("fixt.tuBang");
    expect(r.ra, "KHÔNG được bắt nhầm `key:` của mã không-dịch (không-gian không có thật)").not.toContain(
      "khongPhaiNs.abc",
    );
  });

  it("★★★ I-2 — PASS A (**chức năng GỐC**: lệch placeholder) vẫn được canh", () => {
    /**
     * ⚠⚠⚠ Lớp lỗi *"lưới khoá đúng CÁI VỪA SỬA, không canh BẤT BIẾN"*: lưới bản đầu chỉ canh PASS B
     * (thứ Pha 6 vừa thêm) ⇒ **vô hiệu hoá PASS A vẫn 12/12 XANH và `i18n:check` exit 0**. Công cụ
     * tên là `i18n:check`, không phải `i18n:presence-check` — cái nó **vốn phải làm** cũng phải bị canh.
     */
    const cd = nenXanh();
    cd.ma.push("fixt.bienLech");
    (cd.ban.en as Record<string, string>)["fixt.bienLech"] = "Hello {{name}}";
    (cd.ban.vi as Record<string, string>)["fixt.bienLech"] = "Xin chào"; // ← thiếu {{name}}
    (cd.ban.zh as Record<string, string>)["fixt.bienLech"] = "你好 {{name}}";
    const r = chay(dungGoc(cd));
    expect(r.ma, `phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("fixt.bienLech");
    expect(r.ra).toContain("expected vars");
  });

  it("★★★ I-2 — CẦU CHÌ KHOÁ TRÙNG (doc 46 FE-W4) vẫn được canh", () => {
    /**
     * `JSON.parse` giữ **cái SAU** của hai khoá cùng tên trong một object ⇒ phép quét trên object
     * đã parse **không thể** thấy (đó là cách lớp bug `signOff`/`signoff` ẩn mình). Cầu chì quét
     * **văn bản thô**. Vô hiệu nó ⇒ trước lượt vá này **không ca nào đỏ**.
     * ⚠ Vì `JSON.stringify` **không tạo được** khoá trùng, ca này phải ghi **văn bản THÔ**.
     */
    const cd = nenXanh();
    cd.tho = {
      en: '{\n  "fixt": {\n    "dayDu": "du-en",\n    "dayDu": "du-en-lan-hai",\n    "coDauRong": ""\n  }\n}\n',
    };
    const r = chay(dungGoc(cd));
    expect(r.ma, `phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("DUPLICATE KEYS");
    expect(r.ra).toContain("dayDu");
  });

  it("★★★ §4.1 — CI phải THẬT SỰ chạy bộ cưỡng chế mặt người (nếu không, nó lại thành hàng rào không ai canh)", () => {
    /**
     * ⚠⚠ Đây là ca canh **sự nối dây**, không canh mã: `i18n:check` từng đúng 100% mà **không
     * workflow nào gọi** (0/7). Một phép canh không ai chạy thì bằng không.
     */
    expect(existsSync(CI), `không thấy ${CI}`).toBe(true);
    expect(readFileSync(CI, "utf8"), "`.github/workflows/ci.yml` KHÔNG chạy `i18n:check`").toContain("i18n:check");
    // …và §Cổng kiểm chung (lượt chạy CỤC BỘ, trước khi đẩy) cũng phải giữ nó.
    expect(existsSync(KE_HOACH_PHA5), `không thấy ${KE_HOACH_PHA5}`).toBe(true);
    expect(readFileSync(KE_HOACH_PHA5, "utf8"), "§Cổng kiểm chung KHÔNG còn `npm run i18n:check`").toContain(
      "npm run i18n:check",
    );
  });
});

describe("★★★ Pha 7 §4.2 — *“nền chỉ được THU HẸP”* thôi là lời hứa, thành LƯỢNG TỪ MÁY", () => {
  it("★★★ G1 — thêm một tên vào nền **BẰNG TAY** (không dịch gì) ⇒ ĐỎ [probe M6]", () => {
    /**
     * ⚠⚠⚠ Đây là probe **M6** nguyên văn: trước Pha 7, thêm tay một tên vào `missingInAllLocales`
     * ⇒ `exit 0`, **XANH**. Luật nói *"∀ lượt thay đổi, |nền| không tăng"*; máy chỉ kiểm
     * *"∃ mục trong nền ⇒ tha"*.
     * ⚠ Trần để **rộng** (5) để **chỉ** phép canh G1 nổ — nếu không, ca này sẽ xanh/đỏ vì G2 và ta
     *   không biết G1 còn sống hay không.
     */
    const cd = nenXanh();
    cd.ma.push("fixt.noMoi");
    cd.nen = { _ghim: { missingInAllLocales: 0, missingInSomeLocales: 0 }, missingInAllLocales: ["fixt.noMoi"], missingInSomeLocales: [] };
    cd.tran = { missingInAllLocales: 5, missingInSomeLocales: 5 };
    const r = chay(dungGoc(cd));
    expect(r.ma, `phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("NỀN BỊ SỬA TAY");
    expect(r.ra).not.toContain("NỀN PHÌNH");
  });

  it("★★★ G2 — nền phình qua cửa `--update-baseline` (con số ghim KHỚP) vẫn ⇒ ĐỎ vì vượt TRẦN", () => {
    /**
     * ⚠⚠ Cửa thoát **hay bị đi nhất trong thực tế**: thêm màn chưa dịch ⇒ cổng đỏ ⇒ lượt sửa RẺ
     * NHẤT là sinh lại nền. `_ghim` **không** chặn được (chính lượt sinh lại viết ra nó), nên phải
     * có trần ở một file mà công cụ **không bao giờ ghi**.
     * ⚠ `_ghim` để **khớp** (1/0) để **chỉ** G2 nổ ⇒ hai phép canh được chứng minh là ĐỘC LẬP.
     */
    const cd = nenXanh();
    cd.ma.push("fixt.noMoi");
    cd.nen = { _ghim: { missingInAllLocales: 1, missingInSomeLocales: 0 }, missingInAllLocales: ["fixt.noMoi"], missingInSomeLocales: [] };
    cd.tran = { missingInAllLocales: 0, missingInSomeLocales: 0 };
    const r = chay(dungGoc(cd));
    expect(r.ma, `phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("NỀN PHÌNH");
    expect(r.ra).not.toContain("NỀN BỊ SỬA TAY");
  });

  it("★★★ CẦU CHÌ — thiếu file TRẦN ⇒ ĐỎ (một phép canh vắng mặt KHÔNG được im lặng)", () => {
    const cd = nenXanh();
    cd.tran = null; // không ghi file trần
    const r = chay(dungGoc(cd));
    expect(r.ma, `thiếu trần phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("THIẾU TRẦN NỀN");
  });

  it("★★★ BẬC THANG CHIỀU HAI còn sống — dịch xong một khoá ĐÃ GHIM mà không hạ nền ⇒ ĐỎ", () => {
    /**
     * Chiều này do Pha 6 dựng (`BASELINE STALE`); ca ở đây **kiểm nó còn sống** sau khi Pha 7 thêm
     * G1/G2 — *"lưới khoá đúng cái vừa sửa, không canh bất biến"* là lớp lỗi đã ship 2 hồi quy.
     */
    const cd = nenXanh();
    cd.ma.push("fixt.daDich");
    for (const l of LOCALES) (cd.ban[l] as Record<string, string>)["fixt.daDich"] = `dich-${l}`;
    cd.nen = { _ghim: { missingInAllLocales: 1, missingInSomeLocales: 0 }, missingInAllLocales: ["fixt.daDich"], missingInSomeLocales: [] };
    cd.tran = { missingInAllLocales: 5, missingInSomeLocales: 5 };
    const r = chay(dungGoc(cd));
    expect(r.ma, `phải ĐỎ, nhưng:\n${r.ra}`).toBe(1);
    expect(r.ra).toContain("BASELINE STALE");
    expect(r.ra).toContain("fixt.daDich");
  });

  it("★★★ KHÔNG BẮT NHẦM — một lượt **HẠ NỀN HỢP LỆ** (dịch xong → `--update-baseline`) phải XANH", () => {
    /**
     * ⚠⚠⚠ Ca quan trọng nhất của §4.2. Trần cố ý là **`≤`**, KHÔNG phải `===`: nếu bắt trần khít
     * nền thì **mọi lượt TRẢ NỢ hợp lệ đều ĐỎ** — tức là phạt đúng hành vi mình muốn khuyến khích,
     * và cổng sẽ bị tắt trong hai tuần. Ca này đi **trọn hành trình thật**, ba chặng:
     */
    const cd = nenXanh();
    cd.ma.push("fixt.noA", "fixt.noB");
    cd.nen = {
      _ghim: { missingInAllLocales: 2, missingInSomeLocales: 0 },
      missingInAllLocales: ["fixt.noA", "fixt.noB"],
      missingInSomeLocales: [],
    };
    cd.tran = { missingInAllLocales: 2, missingInSomeLocales: 0 };
    const goc = dungGoc(cd);

    // Chặng 1 — nợ đúng như đã ghim ⇒ XANH.
    const r1 = chay(goc);
    expect(r1.ma, `chặng 1 phải XANH:\n${r1.ra}`).toBe(0);

    // Chặng 2 — DỊCH XONG `fixt.noA` nhưng chưa hạ nền ⇒ ĐỎ (bậc thang chiều hai).
    for (const l of LOCALES) {
      const p = join(goc, "client", "src", "i18n", "locales", `${l}.json`);
      const cay = JSON.parse(readFileSync(p, "utf8")) as Record<string, Record<string, string>>;
      (cay.fixt as Record<string, string>).noA = `dich-${l}`;
      writeFileSync(p, `${JSON.stringify(cay, null, 2)}\n`, "utf8");
    }
    const r2 = chay(goc);
    expect(r2.ma, `chặng 2 phải ĐỎ:\n${r2.ra}`).toBe(1);
    expect(r2.ra).toContain("BASELINE STALE");

    // Chặng 3 — HẠ NỀN HỢP LỆ bằng `--update-baseline` ⇒ XANH, và nền THU HẸP thật.
    const r3 = chay(goc, ["--update-baseline"]);
    expect(r3.ma, `sinh lại nền phải thành công:\n${r3.ra}`).toBe(0);
    const nenMoi = JSON.parse(readFileSync(join(goc, "scripts", "i18n-missing-baseline.json"), "utf8")) as Nen;
    expect(nenMoi.missingInAllLocales, "nền phải THU HẸP còn đúng khoá chưa dịch").toEqual(["fixt.noB"]);
    expect(nenMoi._ghim?.missingInAllLocales, "`--update-baseline` phải viết lại con số ghim").toBe(1);
    const r4 = chay(goc);
    expect(r4.ma, `chặng 3 — hạ nền hợp lệ phải XANH, nhưng:\n${r4.ra}`).toBe(0);
  });

  it("★★★ NỀN THẬT của repo phải nhất quán (bắt lượt sửa tay dù ai đó gỡ bước `i18n:check` khỏi CI)", () => {
    /**
     * ⚠ Phòng thủ theo chiều sâu: `pnpm test` (vitest) chạy trong CI **theo mặc định**, còn bước
     * `i18n:check` là một dòng có thể bị gỡ. Ca này đọc **nền thật** nên một lượt sửa tay vẫn ĐỎ
     * qua đường vitest.
     */
    expect(existsSync(NEN_THAT), `không thấy ${NEN_THAT}`).toBe(true);
    expect(existsSync(TRAN_THAT), `không thấy ${TRAN_THAT}`).toBe(true);
    const nen = JSON.parse(readFileSync(NEN_THAT, "utf8")) as Nen;
    const tran = JSON.parse(readFileSync(TRAN_THAT, "utf8")) as Tran;
    expect(nen._ghim?.missingInAllLocales, "nền thật bị SỬA TAY (missing-in-all)").toBe(nen.missingInAllLocales.length);
    expect(nen._ghim?.missingInSomeLocales, "nền thật bị SỬA TAY (missing-in-some)").toBe(nen.missingInSomeLocales.length);
    expect(nen.missingInAllLocales.length, "nền thật VƯỢT TRẦN (missing-in-all)").toBeLessThanOrEqual(
      tran.missingInAllLocales,
    );
    expect(nen.missingInSomeLocales.length, "nền thật VƯỢT TRẦN (missing-in-some)").toBeLessThanOrEqual(
      tran.missingInSomeLocales,
    );
  });

  it("★★★ I-4 — **TRẦN tự nó bị GHIM**: bánh cóc KHÔNG reset được bằng một diff MỘT DÒNG", () => {
    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ⚠⚠⚠ ĐO ĐƯỢC (review Task 1): chuỗi ba bước dưới đây **reset sạch bánh cóc** và cổng vẫn XANH
     * ══════════════════════════════════════════════════════════════════════════════════════════
     *   thêm màn thật chưa dịch ⇒ ĐỎ ✅ → `--update-baseline` ⇒ `NỀN PHÌNH` ✅ →
     *   **nâng trần tay 817 → 818** ⇒ `exit 0`, **22/22 XANH**.
     *
     * ⇒ Trần canh nền, nhưng **không ai canh TRẦN**. Đúng lớp *"hàng rào không ai canh"* — lần này
     *   ở tầng thứ **BA**, và nó cho thấy lượng từ "∀ lượt chạy: |nền| ≤ trần" **chưa đủ**: nó nói
     *   về **nền**, không nói gì về **trần**.
     * ⚠⚠ Tôi **đã khai** giới hạn này bằng lời trong `i18n-baseline-tran.json` (*"hai con số này chỉ
     *   được HẠ"*) — nhưng **KHAI một lỗ KHÔNG PHẢI LÀ CANH nó**. Đây là phép canh.
     * ⚠ Ghim là `≤` chứ không `===`: **HẠ** trần (trả nợ thật) phải XANH; chỉ **NÂNG** mới ĐỎ.
     */
    const tran = JSON.parse(readFileSync(TRAN_THAT, "utf8")) as Tran;
    expect(tran.missingInAllLocales, "TRẦN bị NÂNG — bánh cóc chỉ được siết, không được nới").toBeLessThanOrEqual(817);
    expect(tran.missingInSomeLocales, "TRẦN bị NÂNG — bánh cóc chỉ được siết, không được nới").toBeLessThanOrEqual(20);
  });
});
