/**
 * ReDoS TẤT ĐỊNH cho bộ che AI ngoài (`cheDuLieu.cheChuoi`) — chu-du-an-HST duyệt 14/11 (A1 + A2); sửa theo rà kiem-dinh (C1–C5).
 *
 *   A1 (tĩnh + lúc nạp): mọi regex của bộ che có "độ cao sao" ≤ 1 (`redosDo.doCaoSao`) — không lượng từ KHÔNG CHẶN lồng trong nhóm
 *      cũng mang lượng từ không chặn ((a+)+, (a*b)*). Phủ: literal trong `cheDuLieu.ts`, `shared/mauBiMat.ts`, `aiSafety.ts`; nguồn
 *      CHUỖI của mauBiMat; regex DỰNG ĐỘNG `new RegExp(` (liệt kê theo tên, bắt lúc nạp bằng Proxy); mọi regex THỰC SỰ chạy trong
 *      cheChuoi trên các họ xấu. Ngoại lệ (cao 2 nhưng không mơ hồ) có LÝ DO + MỘT ca động (Worker có hạn).
 *      GIỚI HẠN (C3): độ cao 1 KHÔNG đủ — nhánh chồng nhau dưới lượng từ không chặn ((?:a|a)+) vẫn lùi hàm mũ ⇒ A2 bắt (Worker có hạn).
 *   A2 (đếm công, trong Worker có hạn): công = số ký tự giao cho mỗi lần gọi regex; công/ký tự ở 8n ≤ 1,5 × ở n cho MỌI họ. Bắt bậc
 *      hai do GỌI LẶP. Chạy TRONG WORKER (C1): regex lùi thảm hoạ chặn đồng bộ luồng chạy nó — ở luồng chính thì cả tệp TREO.
 *
 * THỨ TỰ (C1): mọi ca TĨNH chạy TRƯỚC, không gọi cheChuoi; mọi lần gọi cheChuoi nằm trong Worker có hạn.
 *
 * ⚠ A1 + A2 KHÔNG bắt: lùi BẬC HAI (đa thức) BÊN TRONG MỘT lần gọi regex (vd `/[^\0]*\0/.test(s)`) và vòng lặp bậc hai KHÔNG dùng regex
 *   (vd quét tay `cheChuoiLienDai`). Phần đó do ca THỜI GIAN trong `cheDuLieu.thoiGian.test.ts` lo — ĐỪNG gỡ ca thời gian vì đã có tệp này.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { docMaNguon } from "@shared/testing/docMaNguon";
import { bocPrototype, doCaoSao, type GhiCong } from "./redosDo";
import type { KetQuaA2 } from "./redosDo.worker";

const GOC_REPO = path.resolve(__dirname, "../../../..");
const GOC_REGEXP = globalThis.RegExp;
const P = RegExp.prototype as unknown as Record<PropertyKey, unknown>;
const KHOA: readonly PropertyKey[] = ["exec", "test", Symbol.replace, Symbol.match, Symbol.matchAll, Symbol.split, Symbol.search];
const GOC_PROTO = new Map(KHOA.map((k) => [k, P[k]] as const));
afterEach(() => {
  for (const k of KHOA) P[k] = GOC_PROTO.get(k);
  globalThis.RegExp = GOC_REGEXP;
});

// ─── Worker có hạn ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Số Worker của tệp này CÒN SỐNG (tăng khi tạo, giảm ở sự kiện `exit`). */
let soWorkerSong = 0;
/** Chạy `code` (CommonJS, eval) trong Worker; quá `hanMs` ⇒ "het-gio". Worker LUÔN bị terminate (finally) và chờ thoát. */
async function chayWorker<T>(code: string, workerData: unknown, hanMs: number): Promise<T | "het-gio"> {
  const w = new Worker(code, { eval: true, workerData });
  soWorkerSong++;
  const daThoat = new Promise<void>((xong) => w.once("exit", () => (soWorkerSong--, xong())));
  let han: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T | "het-gio">((xong, loi) => {
      han = setTimeout(() => xong("het-gio"), hanMs);
      w.once("message", (m: T) => xong(m));
      w.once("error", loi);
    });
  } finally {
    clearTimeout(han);
    await w.terminate();
    await daThoat;
  }
}
const chayCoHan = (nguon: string, co: string, vao: string, hanMs: number) =>
  chayWorker<boolean>(
    `const { parentPort, workerData: d } = require("node:worker_threads"); parentPort.postMessage(new RegExp(d.nguon, d.co).test(d.vao));`,
    { nguon, co, vao },
    hanMs,
  );
/** Hạn cho cả lượt A2 (khởi tsx + nạp cheDuLieu + 25 họ). Đo 14/11: 0,36 s một mình ⇒ hạn 8 s (~22 lần): hồi quy thảm hoạ ĐỎ trong vài giây. */
const HAN_A2_MS = 8_000;
const chayA2TrongWorker = (n: number) =>
  chayWorker<KetQuaA2 | { loi: string }>(
    `const { parentPort, workerData: d } = require("node:worker_threads");
     (async () => { (await import("tsx/esm/api")).register(); parentPort.postMessage((await import(d.url)).chayA2(d.n)); })()
       .catch((e) => parentPort.postMessage({ loi: String((e && e.stack) || e) }));`,
    { url: pathToFileURL(path.join(__dirname, "redosDo.worker.ts")).href, n },
    HAN_A2_MS,
  );

// ─── ngoại lệ A1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface NgoaiLe {
  ten: string;
  khop: (nguon: string) => boolean;
  lyDo: string;
  /** Đầu vào đối kháng DÀI (≥ 20 000 vòng) — nếu regex mơ hồ thì lùi hàm mũ, không bao giờ xong. */
  doiKhang: string;
}
const NGOAI_LE: readonly NgoaiLe[] = [
  {
    ten: "RE_CHI_CHO_TRONG (cheDuLieu.ts)",
    khop: (s) => s === String.raw`^(?:\[REDACTED_[A-Z]+\]\s*)+$`,
    lyDo: "mỗi vòng mở bằng chữ cố định '[REDACTED_' mà \\s* và [A-Z]+ không thể nuốt ⇒ mỗi vị trí chỉ có một cách chia vòng",
    doiKhang: "[REDACTED_SECRET] ".repeat(20_000) + "x",
  },
  {
    ten: "RE_TIEN_TO_MA (cheDuLieu.ts)",
    khop: (s) => s.startsWith("^(?:(?:req|request|res|this|self|"),
    lyDo: "vòng (?:\\.[A-Za-z_$][\\w$]*|\\[[^\\]\\s]{1,64}\\])+ mở bằng '.' hoặc '[' mà [\\w$]* không nuốt được ⇒ không mơ hồ",
    doiKhang: "req" + ".a".repeat(20_000) + "!",
  },
];
const ngoaiLe = (nguon: string) => NGOAI_LE.find((n) => n.khop(nguon));

// ─── A1 tĩnh (KHÔNG gọi cheChuoi) ────────────────────────────────────────────────────────────────────────────────────────────
const TEP_A1 = ["server/services/ai/ngoai/cheDuLieu.ts", "shared/mauBiMat.ts", "server/services/ai/aiSafety.ts"] as const;
type TepA1 = (typeof TEP_A1)[number];
/** Regex literal: sau `=`, `(`, `,`, `:`, `?`, `!`, `&`, `|`, `return` (vị trí biểu thức), một dòng. */
const RE_LITERAL = /(?<=(?:^|[=(,:?!&|]|\breturn)\s*)\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])*)\/[dgimsuyv]*/gm;
const SO_LITERAL_TOI_THIEU: Record<TepA1, number> = {
  "server/services/ai/ngoai/cheDuLieu.ts": 30,
  "shared/mauBiMat.ts": 0,
  "server/services/ai/aiSafety.ts": 20,
};
/** Điểm dựng ĐỘNG — liệt kê, KHÔNG phân tích tĩnh được. Thêm `new RegExp(` vào các tệp ⇒ sửa danh sách này. */
const DIEM_DUNG_DONG: Record<TepA1, readonly string[]> = {
  "server/services/ai/ngoai/cheDuLieu.ts": ["RE_CO_DONG_CHU", "RE_IPV4_NOI_BO", "RE_KHOA_THEM"],
  "shared/mauBiMat.ts": ["RE_TOKEN_CO_TIEN_TO", "RE_TOKEN_CO_TIEN_TO_DANG_GO"],
  "server/services/ai/aiSafety.ts": ["PHONE_CONTEXT_RE", "LOT_LABEL_RE"],
};

describe("A1 — đo độ cao sao (tự kiểm bộ đo)", () => {
  it.each([
    ["(a+)+$", 2],
    ["(a*b)*c", 2],
    ["((ab)+c)+", 2],
    ["(?:x|y)*", 1],
    ["[a+]+", 1],
    ["[(]+", 1],
    ["\\(a+\\)+", 1],
    ["a{2,}(b{1,3})+", 1],
    ["(a{2,5})+", 1],
    ["(a{2,})+", 2],
    ["(?<![A-Za-z0-9])sk-", 0],
    ["(?<ten>a+)b", 1],
    ["(?<=x)(?:y+)*", 2],
    ["(?:a|a)+$", 1], // GIỚI HẠN đã biết (C3): nhánh chồng ở độ cao 1 — do A2 bắt
  ])("%s ⇒ %i", (s, ky) => expect(doCaoSao(s)).toBe(ky));

  it("bộ tìm literal (tự kiểm, C5): đúng số literal trên văn bản mẫu, bỏ qua chú thích // và phép chia", () => {
    const mau = [
      "const a = /x+/g;",
      'f(/[/]+/, "/khong/")',
      "const b = c / 2 / d;",
      "// const e = /(a+)+/;  ← vẫn đếm (chú thích có `=` trước literal: dò thừa là hướng an toàn)",
      "return /^y$/.test(s);",
      "x = ok ? /z/ : /w/;",
    ].join("\n");
    expect([...mau.matchAll(RE_LITERAL)].map((m) => m[1])).toEqual(["x+", "[/]+", "(a+)+", "^y$", "z", "w"]);
  });
});

describe("A1 — tĩnh: độ cao sao ≤ 1 cho regex của bộ che (ngoại lệ có lý do)", () => {
  it.each(TEP_A1)("%s: mọi regex LITERAL", (tep) => {
    const src = docMaNguon(path.join(GOC_REPO, tep));
    const ra: string[] = [];
    let dem = 0;
    for (const m of src.matchAll(RE_LITERAL)) {
      dem++;
      if (doCaoSao(m[1]!) > 1 && !ngoaiLe(m[1]!)) ra.push(`${tep}:${src.slice(0, m.index).split("\n").length} /${m[1]!.slice(0, 80)}/`);
    }
    expect(dem).toBeGreaterThanOrEqual(SO_LITERAL_TOI_THIEU[tep]); // bộ tìm thật sự thấy literal (mauBiMat: 0 — mẫu là CHUỖI, ca dưới)
    expect(ra).toEqual([]);
  });

  it("shared/mauBiMat: nguồn CHUỖI của mọi mẫu (nguon, tienTo, nguonCoBien) và hai regex gộp — độ cao sao ≤ 1", async () => {
    const m = await import("../../../../shared/mauBiMat");
    const nguon = [
      ...m.MAU_TOKEN_CO_TIEN_TO.flatMap((x) => [x.nguon, x.tienTo, m.nguonCoBien(x)]),
      m.RE_TOKEN_CO_TIEN_TO.source,
      m.RE_TOKEN_CO_TIEN_TO_DANG_GO.source,
    ];
    expect(nguon.length).toBe(m.MAU_TOKEN_CO_TIEN_TO.length * 3 + 2);
    expect(nguon.filter((s) => doCaoSao(s) > 1)).toEqual([]);
  });

  it.each(TEP_A1)("%s: điểm `new RegExp(` đúng bằng danh sách 'không phân tích tĩnh được'", (tep) => {
    const src = docMaNguon(path.join(GOC_REPO, tep));
    const ten = [...src.matchAll(/^(?:export\s+)?const\s+(\w+)\s*=\s*new RegExp\(/gm)].map((m) => m[1]);
    expect(ten).toEqual(DIEM_DUNG_DONG[tep]);
    expect(src.split("new RegExp(").length - 1).toBe(DIEM_DUNG_DONG[tep].length); // không có `new RegExp(` nào khác (nội tuyến / trong hàm)
  });

  it("regex DỰNG ĐỘNG lúc nạp: bắt được đủ số điểm đã liệt kê ở từng tệp, mỗi cái độ cao sao ≤ 1 (chỉ NẠP, không gọi cheChuoi)", async () => {
    const dung: Array<{ tep: string; nguon: string }> = [];
    globalThis.RegExp = new Proxy(GOC_REGEXP, {
      construct(dich, doiSo, moi) {
        const r = Reflect.construct(dich, doiSo, moi) as RegExp;
        // Khung GỌI `new RegExp` = khung đầu tiên (sau khung bẫy) không phải tệp test, node_modules hay nội bộ node.
        // (Không lấy "tệp đầu tiên khớp" trong cả ngăn xếp: khung async của mô-đun nhập nó cũng nằm trong ngăn xếp.)
        const goi = (new Error().stack ?? "")
          .replace(/\\/g, "/")
          .split("\n")
          .slice(1)
          .find((l) => /\.(?:ts|mts|js|mjs)/.test(l) && !l.includes("cheDuLieu.redos.test") && !l.includes("node_modules") && !l.includes("node:"));
        const tep = TEP_A1.find((t) => goi?.includes(t));
        if (tep) dung.push({ tep, nguon: r.source });
        return r;
      },
    });
    try {
      vi.resetModules();
      await import("./cheDuLieu");
    } finally {
      globalThis.RegExp = GOC_REGEXP;
    }
    for (const tep of TEP_A1) expect(dung.filter((d) => d.tep === tep).length, tep).toBe(DIEM_DUNG_DONG[tep].length);
    expect(dung.filter((d) => doCaoSao(d.nguon) > 1 && !ngoaiLe(d.nguon)).map((d) => `${d.tep} /${d.nguon.slice(0, 80)}/`)).toEqual([]);
  });
});

// ─── bộ đếm công (luồng chính, CHỈ regex tầm thường của chính ca) ────────────────────────────────────────────────────────────
describe("A2 — bộ đếm công (tự kiểm, regex tầm thường trên luồng chính)", () => {
  const ty = (lam: (s: string) => void, a: string, b: string) => {
    const ghi: GhiCong = { cong: 0, daChay: new Map() };
    const khoiPhuc = bocPrototype(ghi);
    try {
      lam(a);
      const k1 = ghi.cong / a.length;
      ghi.cong = 0;
      lam(b);
      return ghi.cong / b.length / k1;
    } finally {
      khoiPhuc();
    }
  };
  const A = "Ab.".repeat(2_000);
  const B = "Ab.".repeat(16_000);

  it("đối chứng ÂM: replace /g + split + matchAll + exec-loop tuyến tính ⇒ tỉ lệ ≤ 1,5 (C5)", () => {
    const tuyenTinh = (s: string) => {
      s.replace(/b/g, "c");
      s.split(/\./);
      [...s.matchAll(/A/g)];
      const re = /\./g;
      while (re.exec(s));
    };
    expect(ty(tuyenTinh, A, B)).toBeLessThanOrEqual(1.5);
  });

  it("đối chứng DƯƠNG: regex trên từng hậu tố của 1/5 đầu chuỗi (gọi lặp bậc hai) ⇒ tỉ lệ > 6", () => {
    const lap = (s: string) => {
      const re = /x$/;
      const m = Math.floor(s.length / 5);
      for (let i = 0; i < m; i++) re.test(s.slice(i, m));
    };
    expect(ty(lap, A, B)).toBeGreaterThan(6);
  });

  it("C4: callback replace gọi regex CÙNG NGUỒN (đối tượng khác) trên cả chuỗi ⇒ ĐẾM, tỉ lệ > 6", () => {
    const cungNguon = (s: string) => {
      const ngoai = /b/g;
      const trong = /b/; // cùng nguồn "b", KHÁC đối tượng
      s.replace(ngoai, () => (trong.test(s), "b"));
    };
    expect(ty(cungNguon, A, B)).toBeGreaterThan(6);
  });

  it("đã KHÔI PHỤC RegExp.prototype sau khi bọc (không rò sang tệp khác)", () => {
    const ghi: GhiCong = { cong: 0, daChay: new Map() };
    const khoiPhuc = bocPrototype(ghi);
    expect(P.exec).not.toBe(GOC_PROTO.get("exec"));
    khoiPhuc();
    for (const k of KHOA) expect(P[k]).toBe(GOC_PROTO.get(k));
    /a/.test("a");
    expect(ghi.cong).toBe(0);
  });
});

// ─── A2 + regex đã chạy: cheChuoi CHỈ chạy trong Worker có hạn ──────────────────────────────────────────────────────────────
describe("A2 — công regex của cheChuoi TUYẾN TÍNH (Worker có hạn) + mọi regex đã chạy", () => {
  // ⚠ KHÔNG bắt lùi bậc hai BÊN TRONG một lần gọi regex — xem đầu tệp; ca thời gian của cheDuLieu.thoiGian.test.ts vẫn cần.
  let kq: KetQuaA2 | { loi: string } | "het-gio" | undefined;
  const layKq = async (): Promise<KetQuaA2> => {
    kq ??= await chayA2TrongWorker(2_000);
    expect(kq, "Worker A2 HẾT GIỜ — nghi một regex của bộ che lùi thảm hoạ").not.toBe("het-gio");
    if (typeof kq === "object" && "loi" in kq) throw new Error(`Worker A2 lỗi: ${kq.loi}`);
    return kq as KetQuaA2;
  };

  it("Worker chạy đủ 25 họ và đã thoát", async () => {
    const r = await layKq();
    expect(r.ho.length).toBe(25);
    expect(soWorkerSong).toBe(0);
  }, HAN_A2_MS + 5_000);

  it("mọi họ: công/ký tự ở 8n ≤ 1,5 × ở n (n = 2 000), và bộ đếm thật sự thấy regex chạy", async () => {
    const r = await layKq();
    const lech = r.ho.filter((h) => !(h.k1 > 0) || h.k8 > 1.5 * h.k1).map((h) => `${h.ten}: ${h.k1.toFixed(2)} → ${h.k8.toFixed(2)}`);
    expect(lech).toEqual([]);
  }, HAN_A2_MS + 5_000);

  it("mọi regex THỰC SỰ chạy (gồm aiSafety): độ cao sao ≤ 1 trừ ngoại lệ; mỗi ngoại lệ thật sự chạy", async () => {
    const r = await layKq();
    expect(r.daChay.length).toBeGreaterThan(20);
    const vuot = r.daChay.filter((x) => doCaoSao(x.source) > 1);
    expect(vuot.filter((x) => !ngoaiLe(x.source)).map((x) => `/${x.source.slice(0, 80)}/`)).toEqual([]);
    expect(NGOAI_LE.map((n) => vuot.some((x) => ngoaiLe(x.source) === n))).toEqual(NGOAI_LE.map(() => true));
  }, HAN_A2_MS + 5_000);

  it.each(NGOAI_LE.map((n) => [n.ten, n] as const))("ngoại lệ %s: CHÍNH regex đó trên đầu vào đối kháng dài xong trong hạn (Worker)", async (_t, n) => {
    const r = await layKq();
    const re = r.daChay.find((x) => ngoaiLe(x.source) === n);
    expect(re, n.ten).toBeDefined();
    // Biên rất rộng: bản thật trên ~360 000 ký tự xong trong vài ms (cộng khởi Worker); bản mơ hồ cần ~2^20 000 bước.
    expect(await chayCoHan(re!.source, re!.flags.replace(/[gy]/g, ""), n.doiKhang, 2_000)).toBe(false);
  }, HAN_A2_MS + 5_000);

  it("chayCoHan: regex mơ hồ thật (đối chứng dương) ⇒ HẾT GIỜ, không treo; worker đã thoát", async () => {
    // Đo 14/11: bản mơ hồ này mất 41 ms ở 18 vòng, 511 ms ở 22 vòng — tăng theo hàm mũ.
    expect(await chayCoHan(String.raw`^(?:\[REDACTED_[A-Z]+\]\s*|\s)+$`, "", "[REDACTED_A] ".repeat(40) + "x", 500)).toBe("het-gio");
    expect(soWorkerSong).toBe(0);
  });

  it("chayCoHan: regex nguồn hỏng (Worker ném) ⇒ ném ra ca, worker vẫn thoát", async () => {
    await expect(chayCoHan("(", "", "x", 2_000)).rejects.toThrow();
    expect(soWorkerSong).toBe(0);
  });
});
