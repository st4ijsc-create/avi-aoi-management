/**
 * ★★★ Pha 2B Task 4 — TỪ CHỐI TRUNG THỰC (§5.3). **CHƯA cưỡng chế gì cả**: task này chỉ dựng
 * CÂU CHỮ và CẤU TRÚC của lời từ chối để Task 5 có thứ mà ném.
 *
 * Bốn thứ bắt buộc: **xin bao nhiêu · còn bao nhiêu · ai đang giữ gì · ai có thể nhường**.
 *
 * ⚠⚠ RÀNG BUỘC LỚN NHẤT, và là lớp lỗi đã bắt BẢY lần trong chuỗi này (tuyên bố mạnh hơn mã):
 * **câu lỗi KHÔNG ĐƯỢC hứa nhiều hơn dữ liệu.** Sổ mới nối 15/160 dòng liệt kê, và bản liệt kê
 * tự khai chỉ là **CẬN DƯỚI** (lớp alias vẫn mở, đã đo). Một câu nói *"các tiến trình đang giữ:
 * A, B"* trong khi C, D, E vô hình sẽ khiến người trực đi **giết nhầm**. Vì thế mọi câu từ chối
 * đều phải mang **phần KHÔNG quy trách nhiệm được** — và các ca dưới đây khoá đúng điều đó.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildVramRefusal,
  formatVramRefusal,
  vramRefusalAppError,
  VramRefusedError,
  type VramHolderFact,
  type VramRefusalInput,
} from "./vramRefusal";
import {
  reserve as reserveRaw,
  commit,
  markMeasureFailed,
  __resetBrokerForTests,
  ledgerHolders,
  preemptCandidates,
  refusalFactsFor,
} from "./vramBroker";
import { computeHeadroom, headroomInputFromTick, type HeadroomInput } from "./vramHeadroom";
import { WIRED_ALLOCATION_SITE_COUNT, KNOWN_ALLOCATION_SITE_ROW_COUNT } from "./vramAllocationSites";
import { APP_ERROR_CODES } from "../../_core/appErrorCodes";


/**
 * ★★★ Pha 2B Task 5 — `reserve()` NAY ĐÒI NGỮ CẢNH QUYẾT ĐỊNH (ô tick · ống ngoài sổ · đồng hồ).
 *
 * Lớp bọc dưới đây truyền một ngữ cảnh **SẠCH** (có số, nền đã xác minh, vừa chạy, ống ngoài sổ đã
 * hỏi và rỗng) cho các ca CŨ, và đó là một lựa chọn có chủ đích: những ca này sinh ra để kiểm SỔ
 * CÁI và THƯỚC ĐO, không phải để kiểm cưỡng chế. Truyền một ngữ cảnh suy giảm vào đây sẽ làm chúng
 * đỏ vì một lý do chẳng liên quan gì tới thứ chúng đang canh. Cưỡng chế có bộ ca RIÊNG:
 * `enforcement.test.ts`.
 */
function ctxSachChoCaCu(): import("./vramBroker").VramDecisionContext {
  const now = Date.now();
  return {
    tick: { attributableBytes: 0, baselineVerified: true, atMs: now, consecutiveFailures: 0 },
    unledgered: { bytes: 0, unknownCount: 0 },
    nowMs: now,
  };
}
const reserve = (r: import("./types").VramReserveRequest) => reserveRaw(r, ctxSachChoCaCu());

const MIB = 1024 * 1024;

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(HERE, "..", "..", "..", "client", "src", "i18n", "locales");
const LOCALES = ["vi", "en", "zh"] as const;

function localeErrors(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), "utf8")).errors ?? {};
}

function placeholdersOf(template: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) out.push(m[1]);
  return out;
}

function holder(
  owner: string,
  mib: number,
  priority: "production" | "interactive" | "background",
  measured = true,
): VramHolderFact {
  return { owner, kind: "gguf-model", bytes: mib * MIB, priority, measured };
}

/** Fixture cỡ **17.000 MiB** (ràng buộc toàn cục 7) — không dùng cỡ 600 MiB. */
function input(over: Partial<VramRefusalInput> = {}): VramRefusalInput {
  return {
    requestedBytes: 17_000 * MIB,
    owner: "aiGgufEngine:qwen3-30b",
    priority: "interactive",
    headroomBytes: 1_200 * MIB,
    degradedReasons: [],
    blind: false,
    ledgerTotalBytes: 18_000 * MIB,
    usedBytes: 18_000 * MIB,
    holders: [
      holder("gguf-model:qwen3-30b", 17_000, "production"),
      holder("kb-sync:embed", 1_000, "background", false),
    ],
    preemptable: [holder("kb-sync:embed", 1_000, "background", false)],
    unledgered: { bytes: 0, unknownCount: 0 },
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// A. BỐN THÀNH PHẦN
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5.3 — lời từ chối mang ĐỦ BỐN thứ", () => {
  it("facts mang xin bao nhiêu · còn bao nhiêu · ai đang giữ · ai có thể nhường", () => {
    const f = buildVramRefusal(input());
    expect(f.requestedBytes).toBe(17_000 * MIB);
    expect(f.availableBytes).toBe(1_200 * MIB);
    expect(f.holders.map((h) => h.owner)).toEqual(["gguf-model:qwen3-30b", "kb-sync:embed"]);
    expect(f.preemptable.map((h) => h.owner)).toEqual(["kb-sync:embed"]);
  });

  it("câu chữ nêu SỐ xin và SỐ còn, bằng MiB", () => {
    const s = formatVramRefusal(buildVramRefusal(input()));
    expect(s).toContain("17000 MiB");
    expect(s).toContain("1200 MiB");
  });

  it("câu chữ gọi ĐÍCH DANH từng hộ đang giữ, kèm mức ưu tiên", () => {
    const s = formatVramRefusal(buildVramRefusal(input()));
    expect(s).toContain("gguf-model:qwen3-30b");
    expect(s).toContain("production");
    expect(s).toContain("kb-sync:embed");
  });

  /**
   * ★ ĐỘT BIẾN BẮT BUỘC (bước 6 của brief): bỏ trường "ai có thể nhường" ⇒ CA NÀY phải ĐỎ.
   * Ca kiểm CẢ HAI mặt — cấu trúc (`facts.preemptable`) và CÂU CHỮ — vì một lời từ chối im lặng
   * về "ai có thể nhường" đẩy người trực vào đúng thế bí mà §5.3 sinh ra để gỡ.
   */
  it("★ câu chữ có PHẦN 'có thể nhường' và gọi đích danh ứng viên", () => {
    const f = buildVramRefusal(input());
    const s = formatVramRefusal(f);
    expect(s).toContain("Có thể nhường");
    expect(s).toContain("kb-sync:embed");
    expect(f.preemptableBytes).toBe(1_000 * MIB);
    // Tổng byte nhường được phải NÓI RA: "có ai đó nhường được" mà không nói được BAO NHIÊU
    // thì người trực vẫn không biết nhường xong có đủ hay không.
    expect(s).toContain("1000 MiB");
  });

  it("KHÔNG có ai nhường được ⇒ câu nói THẲNG là không có, không im lặng bỏ trống", () => {
    const s = formatVramRefusal(buildVramRefusal(input({ preemptable: [] })));
    expect(s).toContain("Có thể nhường");
    expect(s).toMatch(/không có/i);
    // Không được để lòi ra một danh sách rỗng kiểu "Có thể nhường: ." hay "Có thể nhường: —."
    expect(s).not.toMatch(/Có thể nhường[^:]*:\s*[.—]/);
  });

  it("byte của hộ là ƯỚC LƯỢNG (chưa đo) ⇒ đánh dấu ≈, và câu giải thích dấu đó", () => {
    const s = formatVramRefusal(buildVramRefusal(input()));
    expect(s).toContain("kb-sync:embed≈1000 MiB");
    expect(s).toContain("gguf-model:qwen3-30b=17000 MiB");
    expect(s).toContain('"≈" = ước lượng chưa đo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// B. KHÔNG HỨA NHIỀU HƠN DỮ LIỆU — phần KHÔNG QUY TRÁCH NHIỆM ĐƯỢC
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5.6b — câu từ chối phải nói ra phần KHÔNG quy trách nhiệm được", () => {
  it("MỌI lời từ chối đều có phần 'KHÔNG quy trách nhiệm được' (cả bốn hình dạng)", () => {
    const shapes: Array<[string, VramRefusalInput]> = [
      ["unknownCount>0", input({ unledgered: { bytes: 452 * MIB, unknownCount: 2 } })],
      ["blind", input({ blind: true, degradedReasons: ["probe-blind"] })],
      ["đo được phần ngoài sổ", input({ usedBytes: 21_000 * MIB, ledgerTotalBytes: 18_000 * MIB })],
      ["sổ giải thích hết", input()],
    ];
    for (const [name, inp] of shapes) {
      const s = formatVramRefusal(buildVramRefusal(inp));
      expect(s, name).toContain("KHÔNG quy trách nhiệm được");
      // ⚠ Không bao giờ được ngụ ý danh sách là ĐẦY ĐỦ: mỗi câu phải khai bản liệt kê là CẬN DƯỚI.
      expect(s, name).toContain("CẬN DƯỚI");
      expect(s, name).toContain(`${WIRED_ALLOCATION_SITE_COUNT}/${KNOWN_ALLOCATION_SITE_ROW_COUNT}`);
    }
  });

  /**
   * ★★ CA BẮT BUỘC (brief): `unknownCount > 0` ⇒ câu lỗi PHẢI có phần "không quy trách nhiệm
   * được", và phải khai rằng con số ước lượng KHÔNG ĐÁNG TIN.
   *
   * Bàn giao (2) của Task 3: `unledgeredBytes` là **ƯỚC LƯỢNG**, không phải số đo — và mọi hộ
   * ONNX/sidecar/`gguf-context` đóng góp **0 byte** vào ô đó, chúng chỉ hiện ở `unknownCount`.
   * Đọc `unledgeredBytes` mà BỎ `unknownCount` là đúng cái sai mà bàn giao đó gọi là NGUY HIỂM.
   */
  it("★★ unknownCount > 0 ⇒ câu khai 'không đáng tin' + nêu SỐ LƯỢT, không im lặng làm tròn", () => {
    const f = buildVramRefusal(input({ unledgered: { bytes: 452 * MIB, unknownCount: 2 } }));
    expect(f.caveat).toBe("vramUnattributedUnreliable");
    expect(f.unknownCount).toBe(2);
    const s = formatVramRefusal(f);
    expect(s).toContain("KHÔNG quy trách nhiệm được");
    expect(s).toContain("2 lượt");
    expect(s).toMatch(/không đáng tin|KHÔNG ĐÁNG TIN/);
    expect(s).toContain("452 MiB");
  });

  it("chưa hỏi ống dẫn ngoài sổ (unledgered = null) ⇒ KHÔNG được khai '0 byte ngoài sổ'", () => {
    const f = buildVramRefusal(input({ unledgered: null }));
    expect(f.caveat).toBe("vramUnattributedUnknownExtent");
    expect(f.unledgeredEstimateBytes).toBeNull();
    expect(f.unknownCount).toBeNull();
    const s = formatVramRefusal(f);
    expect(s).toContain("KHÔNG quy trách nhiệm được");
    expect(s).toMatch(/không biết|KHÔNG ĐO ĐƯỢC/);
    expect(s).not.toMatch(/0 MiB ngoài sổ/);
  });

  it("MÙ (blind) ⇒ KHÔNG in con số phần ngoài sổ (chỉ-sổ là CHẶN TRÊN, không phải số đo)", () => {
    const f = buildVramRefusal(input({ blind: true, degradedReasons: ["probe-blind"] }));
    expect(f.unattributedBytes).toBeNull();
    expect(f.caveat).toBe("vramUnattributedUnknownExtent");
  });

  it("đo được phần ngoài sổ ⇒ nêu ĐÚNG con số đó (usedBytes − ledgerTotalBytes)", () => {
    const f = buildVramRefusal(input({ usedBytes: 21_000 * MIB, ledgerTotalBytes: 18_000 * MIB }));
    expect(f.caveat).toBe("vramUnattributedDetected");
    expect(f.unattributedBytes).toBe(3_000 * MIB);
    expect(formatVramRefusal(f)).toContain("3000 MiB");
  });

  /**
   * ★ I-1 (review vòng 1) — hình dạng **THƯỜNG GẶP** của `vramWiring.vramBeginFailureState()`:
   * có byte ngoài sổ, nhưng `unknownCount === 0` và nhịp gần nhất không thấy khoản không quy được.
   * Bản trước cho ra câu *"chưa phát hiện khoản nào"* trong khi 5.242.880.000 byte **nằm ngay
   * trong `facts`** — câu nói SAI ở đúng hình dạng bình thường nhất.
   */
  it("★ I-1: có unledgeredBytes mà unknownCount = 0 ⇒ KHÔNG được nói 'chưa phát hiện khoản nào'", () => {
    const f = buildVramRefusal(input({ unledgered: { bytes: 5_000 * MIB, unknownCount: 0 } }));
    expect(f.caveat).toBe("vramUnattributedDetected");
    expect(f.unledgeredEstimateBytes).toBe(5_000 * MIB);
    const s = formatVramRefusal(f);
    expect(s).not.toMatch(/chưa phát hiện khoản nào/);
    expect(s).toContain("5000 MiB");
  });

  it("★ I-1b: có CẢ HAI (đo được + ước lượng) ⇒ câu nêu CẢ HAI con số, không chọn một", () => {
    const f = buildVramRefusal(
      input({ usedBytes: 21_000 * MIB, unledgered: { bytes: 5_000 * MIB, unknownCount: 0 } }),
    );
    expect(f.caveat).toBe("vramUnattributedDetected");
    const s = formatVramRefusal(f);
    expect(s).toContain("3000 MiB"); // số ĐO
    expect(s).toContain("5000 MiB"); // ƯỚC LƯỢNG
  });

  it("sổ ≥ thiết bị ⇒ phần ngoài sổ = 0, nhưng câu VẪN nói danh sách không chắc đầy đủ", () => {
    const f = buildVramRefusal(input({ usedBytes: 18_000 * MIB, ledgerTotalBytes: 18_000 * MIB }));
    expect(f.caveat).toBe("vramLedgerCoverageOnly");
    expect(f.unattributedBytes).toBe(0);
    expect(formatVramRefusal(f)).toMatch(/KHÔNG chắc đầy đủ/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// C. BÀN GIAO (1) — `-Infinity` LÀ GIÁ TRỊ FAIL-CLOSED HỢP LỆ, ĐỌC `degradedReasons` TRƯỚC KHI IN
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("bàn giao (1) — không một giá trị KHÔNG HỮU HẠN nào được chảy vào câu lỗi hay params", () => {
  it("headroom = -Infinity ⇒ mã lỗi RIÊNG, KHÔNG in con số 'còn bao nhiêu'", () => {
    const f = buildVramRefusal(
      input({ headroomBytes: Number.NEGATIVE_INFINITY, degradedReasons: ["invalid-input"] }),
    );
    expect(f.appCode).toBe("VRAM_HEADROOM_UNKNOWN");
    expect(f.availableBytes).toBeNull();
    const s = formatVramRefusal(f);
    expect(s).not.toContain("Infinity");
    expect(s).not.toContain("NaN");
    expect(s).toContain("invalid-input"); // lý do phải NÓI RA, không nuốt
  });

  it("degradedReasons đi vào thì đi ra được (Task 5 không phải ghép lại từ cờ rời)", () => {
    const f = buildVramRefusal(input({ blind: true, degradedReasons: ["no-tick", "unverified-baseline"] }));
    expect([...f.degradedReasons]).toEqual(["no-tick", "unverified-baseline"]);
    expect(formatVramRefusal(f)).toContain("no-tick");
  });

  /**
   * ★ I-2 (review vòng 1) — `null` BỊ ĐỌC THÀNH `0`. Đầu vào bẩn làm `unattributedBytes` và
   * `unknownCount` cùng thành `null` ("KHÔNG BIẾT"), nhưng bản trước để nó **rơi thẳng** xuống
   * nhánh cuối ⇒ câu ra *"chưa phát hiện khoản nào"*. Ca "đầu vào BẨN" cũ lái đúng vào đây mà
   * **không nhìn `caveat`** — nên lỗ hổng đi lọt ngay dưới một ca đang xanh.
   */
  it("★ I-2: mọi ô 'ngoài sổ' đều KHÔNG BIẾT ⇒ caveat phải là 'không biết', KHÔNG phải 'chưa phát hiện'", () => {
    const f = buildVramRefusal(
      input({
        usedBytes: Number.POSITIVE_INFINITY,
        ledgerTotalBytes: Number.NaN,
        unledgered: { bytes: Number.NaN, unknownCount: Number.NaN },
      }),
    );
    expect(f.unattributedBytes).toBeNull();
    expect(f.unknownCount).toBeNull();
    expect(f.caveat).toBe("vramUnattributedUnknownExtent");
    expect(formatVramRefusal(f)).not.toMatch(/chưa phát hiện khoản nào/);
  });

  it("đầu vào BẨN (NaN/±Infinity ở mọi ô byte) ⇒ params KHÔNG chứa giá trị không hữu hạn", () => {
    const f = buildVramRefusal(
      input({
        requestedBytes: Number.NaN,
        headroomBytes: Number.POSITIVE_INFINITY,
        ledgerTotalBytes: Number.NaN,
        usedBytes: Number.POSITIVE_INFINITY,
        holders: [holder("x", 1, "background"), { ...holder("bẩn", 1, "background"), bytes: Number.NaN }],
        preemptable: [{ ...holder("bẩn", 1, "background"), bytes: Number.POSITIVE_INFINITY }],
        unledgered: { bytes: Number.NaN, unknownCount: Number.NaN },
      }),
    );
    const { params } = vramRefusalAppError(f);
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "number") expect(Number.isFinite(v), `params.${k} = ${v}`).toBe(true);
      else expect(v, `params.${k}`).not.toMatch(/Infinity|NaN/);
    }
    const s = formatVramRefusal(f);
    expect(s).not.toContain("Infinity");
    expect(s).not.toContain("NaN");
  });

  /**
   * ★ M-1/M-2 (review vòng 1) — TỔNG tràn dù MỌI SỐ HẠNG hữu hạn. Reviewer đo: hai hộ `1e308`
   * ⇒ `"… tổng Infinity MiB."`, đúng hình dạng rơi vào bẫy `bigint(mode:"number")` ⇒ mất cả lô
   * sự kiện. Cái `?? 0` cũ là một DÂY: nó biến "không cộng nổi" thành "nhường được 0 MiB" — nói
   * NGƯỢC, và ngược đúng chiều nguy hiểm (người trực bỏ qua ứng viên nhường được).
   */
  it("★ M-1: TỔNG byte nhường được tràn (mọi số hạng hữu hạn) ⇒ '?', KHÔNG phải Infinity, KHÔNG phải 0", () => {
    const huge = { ...holder("a", 1, "background"), bytes: 1e308 };
    const f = buildVramRefusal(
      input({ preemptable: [huge, { ...huge, owner: "b" }] }),
    );
    expect(f.preemptableBytes).toBeNull();
    const s = formatVramRefusal(f);
    expect(s).not.toContain("Infinity");
    expect(s).toContain("tổng ? MiB");
    expect(vramRefusalAppError(f).params.preemptableMb).toBe("?");
  });

  it("hộ có byte KHÔNG hữu hạn ⇒ vẫn được GỌI TÊN nhưng số bị thay bằng '?', không bịa 0", () => {
    const f = buildVramRefusal(
      input({ holders: [{ ...holder("hộ-hỏng", 1, "background"), bytes: Number.NaN }] }),
    );
    const s = formatVramRefusal(f);
    expect(s).toContain("hộ-hỏng");
    expect(s).toContain("? MiB");
    expect(s).not.toContain("NaN");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// D. NỐI VÀO HỆ MÃ LỖI SPRINT 5
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("nối vào hệ mã lỗi Sprint 5 (client/src/lib/errorCodes.ts)", () => {
  it("cả hai mã lỗi đều nằm trong registry APP_ERROR_CODES", () => {
    const codes = new Set<string>(APP_ERROR_CODES);
    expect(codes.has("VRAM_REFUSED")).toBe(true);
    expect(codes.has("VRAM_HEADROOM_UNKNOWN")).toBe(true);
  });

  it("khoá i18n của CẢ HAI mã (+ bản _WITH_REASON) có đủ ở vi/en/zh", () => {
    for (const locale of LOCALES) {
      const dict = localeErrors(locale);
      for (const key of [
        "VRAM_REFUSED",
        "VRAM_REFUSED_WITH_REASON",
        "VRAM_HEADROOM_UNKNOWN",
        "VRAM_HEADROOM_UNKNOWN_WITH_REASON",
      ]) {
        expect(typeof dict[key], `${locale}.errors.${key}`).toBe("string");
      }
    }
  });

  it("MỌI khoá caveat có ở errors.reason.* của cả ba locale, và 'none' có ở errors.list.*", () => {
    const caveats = [
      "vramUnattributedUnreliable",
      "vramUnattributedUnknownExtent",
      "vramUnattributedDetected",
      "vramLedgerCoverageOnly",
    ];
    for (const locale of LOCALES) {
      const dict = localeErrors(locale);
      const reason = dict.reason as Record<string, string>;
      for (const c of caveats) expect(typeof reason[c], `${locale}.errors.reason.${c}`).toBe("string");
      const list = dict.list as Record<string, string>;
      expect(typeof list?.none, `${locale}.errors.list.none`).toBe("string");
      // I-3 — hai khoá hạ giọng; `trusted` CỐ Ý là chuỗi RỖNG (khuôn câu không đổi khi số đáng tin).
      const trust = dict.trust as Record<string, string>;
      expect(trust?.trusted, `${locale}.errors.trust.trusted`).toBe("");
      expect(trust?.degraded, `${locale}.errors.trust.degraded`).toContain("{{degradedReasons}}");
    }
  });

  /**
   * ★ I-3 (review vòng 1) — CỔNG "tham số truyền rồi BỎ". `{{degraded}}` từng được truyền mà
   * KHÔNG khuôn `VRAM_REFUSED*` nào dùng ⇒ người vận hành đọc "còn 1200 MiB" như một số CỨNG
   * đúng lúc hệ tự khai nó kém tin. Ca này bắt CẢ HỌ vấn đề, không chỉ thể hiện đó.
   */
  it("★ I-3: mọi tham số CÓ NGHĨA đều được ÍT NHẤT một khuôn dùng tới (không truyền rồi bỏ)", () => {
    const dict = localeErrors("vi");
    const reasonDict = dict.reason as Record<string, string>;
    const trustDict = dict.trust as Record<string, string>;
    const allTemplates = [
      String(dict.VRAM_REFUSED),
      String(dict.VRAM_REFUSED_WITH_REASON),
      String(dict.VRAM_HEADROOM_UNKNOWN),
      String(dict.VRAM_HEADROOM_UNKNOWN_WITH_REASON),
      ...Object.values(reasonDict).filter((v) => v.startsWith("Phần không quy trách nhiệm được")),
      ...Object.values(trustDict),
    ];
    const used = new Set(allTemplates.flatMap(placeholdersOf));
    const shapes: VramRefusalInput[] = [
      input(),
      input({ blind: true, degradedReasons: ["probe-blind"] }),
      input({ unledgered: { bytes: 452 * MIB, unknownCount: 2 } }),
      input({ headroomBytes: Number.NEGATIVE_INFINITY, degradedReasons: ["invalid-input"] }),
    ];
    const unused = new Set<string>();
    for (const inp of shapes) {
      for (const key of Object.keys(vramRefusalAppError(buildVramRefusal(inp)).params)) {
        if (!used.has(key)) unused.add(key);
      }
    }
    expect([...unused].sort()).toEqual([]);
  });

  /**
   * Cùng cơ học với `appErrorParamsCoverage.test.ts` (cổng "reason→placeholder"), nhưng đóng
   * đúng chỗ cổng ĐÓ KHÔNG với tới: nó chỉ quét `server/routers/**`, còn lời gọi này sinh ra ở
   * `server/services/vram/**`. Thiếu một placeholder ⇒ người vận hành đọc "{{unknownCount}}" thô.
   */
  it("params đủ MỌI placeholder mà khoá appCode + khoá reason đang cần (đọc vi.json THẬT)", () => {
    const dict = localeErrors("vi");
    const reasonDict = dict.reason as Record<string, string>;
    const shapes: VramRefusalInput[] = [
      input(),
      input({ unledgered: { bytes: 452 * MIB, unknownCount: 2 } }),
      input({ blind: true, degradedReasons: ["probe-blind"] }),
      input({ usedBytes: 21_000 * MIB }),
      input({ unledgered: null }),
      input({ headroomBytes: Number.NEGATIVE_INFINITY, degradedReasons: ["invalid-input"] }),
      input({ preemptable: [], holders: [] }),
    ];
    for (const inp of shapes) {
      const f = buildVramRefusal(inp);
      const { appCode, params } = vramRefusalAppError(f);
      const templates = [
        String(dict[appCode]),
        String(dict[`${appCode}_WITH_REASON`]),
        String(reasonDict[f.caveat]),
      ];
      for (const t of templates) {
        for (const p of placeholdersOf(t)) {
          if (p === "reason") continue; // do translateAppError tự nội suy
          expect(Object.prototype.hasOwnProperty.call(params, p), `thiếu params.${p} cho ${appCode}/${f.caveat}`).toBe(true);
        }
      }
    }
  });

  it("danh sách RỖNG ⇒ params dùng khoá từ điển 'none', không phải chuỗi rỗng", () => {
    const { params } = vramRefusalAppError(buildVramRefusal(input({ holders: [], preemptable: [] })));
    expect(params.holders).toBe("none");
    expect(params.preemptable).toBe("none");
  });

  it("fallbackMessage chính là câu máy chủ đầy đủ (client cũ / API /v1 vẫn đọc được)", () => {
    const f = buildVramRefusal(input());
    const { fallbackMessage } = vramRefusalAppError(f);
    expect(fallbackMessage).toBe(formatVramRefusal(f));
    expect(fallbackMessage).toContain("KHÔNG quy trách nhiệm được");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// E. VramRefusedError
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("VramRefusedError — vẫn là Error, nhưng mang được cả bốn thứ", () => {
  it("message = câu đầy đủ, name đúng, facts đọc lại được", () => {
    const f = buildVramRefusal(input());
    const err = new VramRefusedError(f);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("VramRefusedError");
    expect(err.message).toBe(formatVramRefusal(f));
    expect(err.facts.preemptable.map((h) => h.owner)).toEqual(["kb-sync:embed"]);
    expect(err.facts.requestedBytes).toBe(17_000 * MIB);
    expect(err.facts.availableBytes).toBe(1_200 * MIB);
    expect(err.facts.holders.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// F. SỔ → LỜI TỪ CHỐI (vramBroker)
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("vramBroker — nguồn của 'ai đang giữ' và 'ai có thể nhường'", () => {
  beforeEach(() => __resetBrokerForTests());

  function req(owner: string, mib: number, priority: "production" | "interactive" | "background") {
    return { owner, kind: "gguf-model" as const, estimatedBytes: mib * MIB, priority };
  }

  it("ledgerHolders() phản ánh sổ SỐNG và khai ĐÚNG số nào là SỐ ĐO", () => {
    const a = reserve(req("prod:aoi", 17_000, "production"));
    reserve(req("bg:kb-sync", 1_000, "background"));
    commit(a.lease!, 16_900 * MIB, "process-delta");
    const hs = ledgerHolders();
    expect(hs.map((h) => h.owner).sort()).toEqual(["bg:kb-sync", "prod:aoi"]);
    expect(hs.find((h) => h.owner === "prod:aoi")!.measured).toBe(true);
    expect(hs.find((h) => h.owner === "prod:aoi")!.bytes).toBe(16_900 * MIB);
    expect(hs.find((h) => h.owner === "bg:kb-sync")!.measured).toBe(false);
  });

  it("ước lượng DỰ PHÒNG sau khi đo hỏng KHÔNG được khai là số ĐO", () => {
    const a = reserve(req("prod:aoi", 17_000, "production"));
    commit(a.lease!, 16_900 * MIB, "process-delta");
    markMeasureFailed(a.lease!);
    expect(ledgerHolders()[0].measured).toBe(false);
  });

  /**
   * ★ I-4 (review vòng 1) — bản sao THỨ HAI của vị từ `measured` nằm trong `preemptCandidates()`
   * và **KHÔNG ca nào chạm tới** ⇒ một đột biến ở đó SỐNG. Nay hai hàm dùng chung
   * `holderFactFromLease()`, và ca này canh CHÍNH đường `preemptCandidates`.
   */
  it("★ I-4: preemptCandidates() khai ĐÚNG số nào là SỐ ĐO (không chỉ ledgerHolders)", () => {
    const bg = reserve(req("bg:kb-sync", 1_000, "background"));
    reserve(req("bg:trainer", 2_000, "background"));
    commit(bg.lease!, 900 * MIB, "process-delta");
    const cands = preemptCandidates("production", 20_000 * MIB);
    expect(cands.find((h) => h.owner === "bg:kb-sync")!.measured).toBe(true);
    expect(cands.find((h) => h.owner === "bg:kb-sync")!.bytes).toBe(900 * MIB);
    expect(cands.find((h) => h.owner === "bg:trainer")!.measured).toBe(false);
    // Và ước lượng DỰ PHÒNG sau khi đo hỏng cũng KHÔNG được khai là số đo, ở CẢ đường này.
    markMeasureFailed(bg.lease!);
    expect(preemptCandidates("production", 20_000 * MIB).find((h) => h.owner === "bg:kb-sync")!.measured).toBe(false);
  });

  it("★ I-4b: ledgerHolders() và preemptCandidates() khai CÙNG một sự thật cho cùng một giấy phép", () => {
    const a = reserve(req("bg:kb-sync", 1_000, "background"));
    commit(a.lease!, 900 * MIB, "process-delta");
    const fromLedger = ledgerHolders().find((h) => h.owner === "bg:kb-sync")!;
    const fromCandidates = preemptCandidates("production", 20_000 * MIB).find((h) => h.owner === "bg:kb-sync")!;
    expect(fromCandidates).toEqual(fromLedger);
  });

  it("preemptCandidates() KHÔNG BAO GIỜ nêu mức bằng hoặc cao hơn mức đang xin", () => {
    reserve(req("prod:aoi", 17_000, "production"));
    reserve(req("ui:rca", 500, "interactive"));
    reserve(req("bg:kb-sync", 1_000, "background"));
    expect(preemptCandidates("interactive", 100 * MIB).map((h) => h.owner)).toEqual(["bg:kb-sync"]);
    expect(preemptCandidates("background", 100 * MIB)).toEqual([]);
    expect(preemptCandidates("production", 20_000 * MIB).map((h) => h.owner).sort()).toEqual([
      "bg:kb-sync",
      "ui:rca",
    ]);
  });

  it("reserve().wouldPreempt và preemptCandidates() đọc CÙNG MỘT nguồn", () => {
    reserve(req("bg:kb-sync", 20_000, "background"));
    reserve(req("prod:aoi", 10_000, "production"));
    const r = reserve(req("gguf:big", 10_000, "interactive"));
    expect(r.wouldRefuse).toBe(true);
    expect(r.wouldPreempt).toEqual(["bg:kb-sync"]);
  });

  it("thiếu dư địa KHÔNG hữu hạn ⇒ liệt kê TOÀN BỘ mức thấp hơn (không lặng lẽ cắt danh sách)", () => {
    reserve(req("bg:a", 1_000, "background"));
    reserve(req("bg:b", 1_000, "background"));
    expect(preemptCandidates("interactive", Number.POSITIVE_INFINITY).length).toBe(2);
    expect(preemptCandidates("interactive", Number.NaN).length).toBe(2);
  });

  it("refusalFactsFor() ghép sổ SỐNG với kết quả headroom, và BẮT BUỘC khai ống ngoài sổ", () => {
    reserve(req("bg:kb-sync", 1_000, "background"));
    const hi: HeadroomInput = headroomInputFromTick(
      { attributableBytes: 21_000 * MIB, baselineVerified: true },
      { ceilingBytes: 32_607 * MIB, safetyReserveBytes: 1_024 * MIB, ledgerTotalBytes: 1_000 * MIB },
    );
    const h = computeHeadroom(hi);
    const f = refusalFactsFor({
      request: req("gguf:30b", 17_000, "interactive"),
      headroomInput: hi,
      headroom: h,
      unledgered: null,
      // ★ Pha 2B Task 5 — hai trường BẮT BUỘC mới: câu từ chối phải in con số ĐÃ QUYẾT ĐỊNH (dư
      // địa HIỆU LỰC) và danh sách lý do ĐẦY ĐỦ. Ở ca này chính sách suy giảm không được áp
      // (ta gọi thẳng `refusalFactsFor`), nên truyền đúng dư địa thô + lý do của headroom.
      effectiveHeadroomBytes: h.headroomBytes,
      degradedReasons: h.degradedReasons,
    });
    expect(f.requestedBytes).toBe(17_000 * MIB);
    expect(f.availableBytes).toBe(h.headroomBytes);
    expect(f.holders.map((x) => x.owner)).toEqual(["bg:kb-sync"]);
    expect(f.preemptable.map((x) => x.owner)).toEqual(["bg:kb-sync"]);
    // 21.000 (thiết bị) − 1.000 (sổ) = 20.000 MiB KHÔNG quy trách nhiệm được cho ai.
    expect(f.unattributedBytes).toBe(20_000 * MIB);
    // `unledgered: null` (chưa hỏi) THẮNG mọi thứ khác: không được khai một con số mình chưa có.
    expect(f.caveat).toBe("vramUnattributedUnknownExtent");
  });
});
