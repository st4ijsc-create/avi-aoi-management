/**
 * ReDoS TẤT ĐỊNH cho bộ che AI ngoài (`cheDuLieu.cheChuoi`) — chu-du-an-HST duyệt 14/11 (A1 + A2). KHÔNG dùng đồng hồ, trừ ca
 * ngoại lệ A1 (biên an toàn ≥ 200 lần, xem dưới).
 *
 *   A1 (tĩnh + lúc nạp): mọi regex của bộ che có "độ cao sao" ≤ 1 — không lượng từ KHÔNG CHẶN (*, +, {n,}) lồng trong một nhóm cũng
 *      mang lượng từ không chặn. Đó là hình dạng của lùi THẢM HOẠ hàm mũ ((a+)+, (a*b)*). Phủ:
 *        · regex literal trong `cheDuLieu.ts` và `shared/mauBiMat.ts` (đọc văn bản nguồn);
 *        · regex DỰNG ĐỘNG bằng `new RegExp(...)` trong hai tệp đó (nguồn ghép, KHÔNG phân tích tĩnh được) — bắt lúc nạp mô-đun bằng
 *          Proxy trên `RegExp`, đếm theo tệp, so với danh sách liệt kê;
 *        · mọi regex THỰC SỰ chạy trong `cheChuoi` trên các họ đầu vào xấu (gồm cả regex của `aiSafety` mà cheChuoi gọi).
 *      Ngoại lệ (độ cao 2 nhưng không mơ hồ) có LÝ DO + MỘT ca động. Thêm ngoại lệ ⇒ sửa CẢ danh sách lẫn ca động.
 *   A2 (động, đếm công): bọc RegExp.prototype (exec/test/@@replace/@@match/@@matchAll/@@split/@@search) trong lúc gọi cheChuoi; công =
 *      tổng số ký tự mỗi lần gọi regex được giao (regex g/y gọi exec/test: chỉ đoạn từ lastIndex trước tới sau). Đòi công/ký tự ở 8n
 *      ≤ 1,5 × công/ký tự ở n cho MỌI họ. Bắt bậc hai do GỌI LẶP (regex trên từng vị trí / từng hậu tố).
 *
 * ⚠ A1 + A2 KHÔNG bắt: lùi BẬC HAI (đa thức) BÊN TRONG MỘT lần gọi regex (vd `/[^\0]*\0/.test(s)` — một lần gọi, công vẫn tuyến
 *   tính) và vòng lặp bậc hai KHÔNG dùng regex (vd quét tay `cheChuoiLienDai`). Phần đó do ca THỜI GIAN trong `cheDuLieu.test.ts`
 *   lo — ĐỪNG gỡ ca thời gian vì đã có tệp này (HST 14/11: giữ tới khi phương án đo thay thế đạt tiêu chí).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { docMaNguon } from "@shared/testing/docMaNguon";
import { HO_XAU } from "./hoXau";

// ─── độ cao sao ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Độ cao sao của nguồn regex: số tầng nhóm lồng nhau mang lượng từ KHÔNG CHẶN. Bỏ qua lớp ký tự và ký tự thoát. */
function doCaoSao(nguon: string): number {
  const ngan: number[] = [0];
  let i = 0;
  const luongTu = (j: number): [boolean, number] => {
    const c = nguon[j];
    if (c === "*" || c === "+") return [true, j + 1 + (nguon[j + 1] === "?" ? 1 : 0)];
    if (c === "?") return [false, j + 1];
    if (c === "{") {
      const m = /^\{(\d+)(,(\d*))?\}\??/.exec(nguon.slice(j));
      if (m) return [m[2] !== undefined && m[3] === "", j + m[0].length];
    }
    return [false, j];
  };
  const nguyenTu = (j: number) => {
    const [kc, k] = luongTu(j);
    if (kc) ngan[ngan.length - 1] = Math.max(ngan[ngan.length - 1]!, 1);
    i = k;
  };
  while (i < nguon.length) {
    const c = nguon[i]!;
    if (c === "\\") {
      nguyenTu(i + 2);
    } else if (c === "[") {
      i++;
      if (nguon[i] === "^") i++;
      if (nguon[i] === "]") i++;
      while (i < nguon.length && nguon[i] !== "]") i += nguon[i] === "\\" ? 2 : 1;
      nguyenTu(i + 1);
    } else if (c === "(") {
      ngan.push(0);
      i++;
      if (nguon[i] === "?") {
        i++;
        if (nguon[i] === "<" && nguon[i + 1] !== "=" && nguon[i + 1] !== "!") i = nguon.indexOf(">", i) + 1; // (?<ten>
        else i += nguon[i] === "<" ? 2 : 1; // (?<= (?<! (?: (?= (?!
      }
    } else if (c === ")") {
      const trong = ngan.pop()!;
      const [kc, k] = luongTu(i + 1);
      i = k;
      ngan[ngan.length - 1] = Math.max(ngan[ngan.length - 1]!, kc ? trong + 1 : trong);
    } else {
      nguyenTu(i + 1);
    }
  }
  return ngan[0]!;
}

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
  ])("%s ⇒ %i", (s, ky) => expect(doCaoSao(s)).toBe(ky));
});

// ─── ngoại lệ A1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface NgoaiLe {
  ten: string;
  nguon: string;
  lyDo: string;
  /** Đầu vào đối kháng DÀI (≥ 20 000 vòng) — nếu regex mơ hồ thì lùi hàm mũ, không bao giờ xong. */
  doiKhang: string;
}
const NGOAI_LE: readonly NgoaiLe[] = [
  {
    ten: "RE_CHI_CHO_TRONG (cheDuLieu.ts)",
    nguon: String.raw`^(?:\[REDACTED_[A-Z]+\]\s*)+$`,
    lyDo: "mỗi vòng mở bằng chữ cố định '[REDACTED_' mà \\s* và [A-Z]+ không thể nuốt ⇒ mỗi vị trí chỉ có một cách chia vòng",
    doiKhang: "[REDACTED_SECRET] ".repeat(20_000) + "x",
  },
  {
    ten: "RE_TIEN_TO_MA (cheDuLieu.ts)",
    nguon: "", // điền lúc chạy từ văn bản nguồn (regex dài một dòng), so khớp theo đầu
    lyDo: "vòng (?:\\.[A-Za-z_$][\\w$]*|\\[[^\\]\\s]{1,64}\\])+ mở bằng '.' hoặc '[' mà [\\w$]* không nuốt được ⇒ không mơ hồ",
    doiKhang: "req" + ".a".repeat(20_000) + "!",
  },
];
const DAU_RE_TIEN_TO_MA = "^(?:(?:req|request|res|this|self|";

/** Số Worker của tệp này CÒN SỐNG (tăng khi tạo, giảm ở sự kiện `exit`) — ca dưới đòi về 0 sau mỗi lần chạy. */
let soWorkerSong = 0;
/** `new RegExp(nguon, co).test(vao)` trong một Worker; quá `hanMs` ⇒ "het-gio". Worker LUÔN bị terminate (finally) và chờ thoát. */
async function chayCoHan(nguon: string, co: string, vao: string, hanMs: number): Promise<boolean | "het-gio"> {
  const w = new Worker(
    `const { parentPort, workerData: d } = require("node:worker_threads"); parentPort.postMessage(new RegExp(d.nguon, d.co).test(d.vao));`,
    { eval: true, workerData: { nguon, co, vao } },
  );
  soWorkerSong++;
  const daThoat = new Promise<void>((xong) => w.once("exit", () => (soWorkerSong--, xong())));
  let han: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<boolean | "het-gio">((xong, loi) => {
      han = setTimeout(() => xong("het-gio"), hanMs);
      w.once("message", (m: boolean) => xong(m));
      w.once("error", loi);
    });
  } finally {
    clearTimeout(han);
    await w.terminate();
    await daThoat;
  }
}

// ─── A2: bọc RegExp.prototype ────────────────────────────────────────────────────────────────────────────────────────────────
type HamRegex = (this: RegExp, ...a: unknown[]) => unknown;
const P = RegExp.prototype as unknown as Record<PropertyKey, HamRegex>;
const KHOA: readonly PropertyKey[] = ["exec", "test", Symbol.replace, Symbol.match, Symbol.matchAll, Symbol.split, Symbol.search];
const GOC_PROTO = new Map(KHOA.map((k) => [k, P[k]!] as const));
const GOC_REGEXP = globalThis.RegExp;

interface Ghi {
  cong: number;
  daChay: Map<string, RegExp>;
}
function bocPrototype(ghi: Ghi): void {
  const ngan: string[] = [];
  for (const k of KHOA) {
    const goc = GOC_PROTO.get(k)!;
    P[k] = function (this: RegExp, s: unknown, ...r: unknown[]) {
      ghi.daChay.set(`/${this.source}/${this.flags}`, this);
      const tinh = !ngan.includes(this.source); // gọi lồng do chính regex này (exec trong @@replace, bản sao trong @@split) ⇒ không đếm lại
      const chuoi = String(s);
      const coTrangThai = (k === "exec" || k === "test") && (this.global || this.sticky);
      const truoc = this.lastIndex;
      ngan.push(this.source);
      try {
        return Reflect.apply(goc, this, [s, ...r]);
      } finally {
        ngan.pop();
        if (tinh) ghi.cong += coTrangThai ? (this.lastIndex > 0 ? this.lastIndex : chuoi.length) - Math.min(truoc, chuoi.length) : chuoi.length;
      }
    };
  }
}
function khoiPhuc(): void {
  for (const k of KHOA) P[k] = GOC_PROTO.get(k)!;
  globalThis.RegExp = GOC_REGEXP;
}
afterEach(() => khoiPhuc());

async function napCheChuoi() {
  return (await import("./cheDuLieu")).cheChuoi;
}

describe("A2 — công regex của cheChuoi TUYẾN TÍNH theo độ dài (đếm, không đồng hồ)", () => {
  // ⚠ KHÔNG bắt lùi bậc hai BÊN TRONG một lần gọi regex — xem đầu tệp; ca thời gian của cheDuLieu.test.ts vẫn cần.
  it.each(HO_XAU)("%s: công/ký tự ở 8n ≤ 1,5 × ở n (n = 2 000)", async (_ten, sinh) => {
    const cheChuoi = await napCheChuoi();
    const ghi: Ghi = { cong: 0, daChay: new Map() };
    bocPrototype(ghi);
    try {
      const a = sinh(2_000);
      const b = sinh(16_000);
      ghi.cong = 0;
      cheChuoi(a);
      const k1 = ghi.cong / a.length;
      ghi.cong = 0;
      cheChuoi(b);
      const k8 = ghi.cong / b.length;
      expect(k1).toBeGreaterThan(0); // bộ đếm thật sự thấy regex chạy
      expect(k8, `công/ký tự ${k1.toFixed(2)} → ${k8.toFixed(2)}`).toBeLessThanOrEqual(1.5 * k1);
    } finally {
      khoiPhuc();
    }
  });

  it("bộ đếm BẮT bậc hai do gọi lặp (đối chứng dương: regex trên từng hậu tố của 1/5 đầu chuỗi)", () => {
    const ghi: Ghi = { cong: 0, daChay: new Map() };
    bocPrototype(ghi);
    try {
      const lap = (s: string) => {
        const re = /x$/;
        const m = Math.floor(s.length / 5);
        for (let i = 0; i < m; i++) re.test(s.slice(i, m));
      };
      const a = "Ab.".repeat(2_000);
      const b = "Ab.".repeat(16_000);
      ghi.cong = 0;
      lap(a);
      const k1 = ghi.cong / a.length;
      ghi.cong = 0;
      lap(b);
      expect(ghi.cong / b.length).toBeGreaterThan(1.5 * k1 * 4);
    } finally {
      khoiPhuc();
    }
  });

  it("đã KHÔI PHỤC RegExp.prototype và RegExp sau khi bọc (không rò sang tệp khác)", () => {
    const ghi: Ghi = { cong: 0, daChay: new Map() };
    bocPrototype(ghi);
    expect(P.exec).not.toBe(GOC_PROTO.get("exec"));
    khoiPhuc();
    for (const k of KHOA) expect(P[k]).toBe(GOC_PROTO.get(k));
    expect(globalThis.RegExp).toBe(GOC_REGEXP);
    ghi.cong = 0;
    /a/.test("a");
    expect(ghi.cong).toBe(0);
  });
});

// ─── A1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const GOC_REPO = path.resolve(__dirname, "../../../..");
const TEP_A1 = ["server/services/ai/ngoai/cheDuLieu.ts", "shared/mauBiMat.ts"] as const;
/** Regex literal: sau `=`, `(`, `,`, `:`, `return`, `?`, `&&`, `||`, `!` (vị trí biểu thức), một dòng. */
const RE_LITERAL = /(?<=(?:^|[=(,:?!&|]|\breturn)\s*)\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])*)\/[dgimsuyv]*/gm;
const SO_LITERAL_TOI_THIEU: Record<(typeof TEP_A1)[number], number> = {
  "server/services/ai/ngoai/cheDuLieu.ts": 30,
  "shared/mauBiMat.ts": 0,
};
/** Điểm dựng ĐỘNG — liệt kê, KHÔNG phân tích tĩnh được. Thêm `new RegExp(` vào hai tệp ⇒ sửa danh sách này. */
const DIEM_DUNG_DONG: Record<(typeof TEP_A1)[number], readonly string[]> = {
  "server/services/ai/ngoai/cheDuLieu.ts": ["RE_CO_DONG_CHU", "RE_IPV4_NOI_BO", "RE_KHOA_THEM"],
  "shared/mauBiMat.ts": ["RE_TOKEN_CO_TIEN_TO", "RE_TOKEN_CO_TIEN_TO_DANG_GO"],
};

const ngoaiLe = (nguon: string) => NGOAI_LE.find((n) => (n.nguon ? n.nguon === nguon : nguon.startsWith(DAU_RE_TIEN_TO_MA)));

describe("A1 — độ cao sao ≤ 1 cho mọi regex của bộ che (ngoại lệ có lý do + ca động)", () => {
  it.each(TEP_A1)("%s: mọi regex LITERAL", (tep) => {
    const src = docMaNguon(path.join(GOC_REPO, tep));
    const ra: string[] = [];
    let dem = 0;
    for (const m of src.matchAll(RE_LITERAL)) {
      dem++;
      if (doCaoSao(m[1]!) > 1 && !ngoaiLe(m[1]!)) ra.push(`${tep}:${src.slice(0, m.index).split("\n").length} /${m[1]!.slice(0, 80)}/`);
    }
    expect(dem).toBeGreaterThanOrEqual(SO_LITERAL_TOI_THIEU[tep]); // bộ tìm literal thật sự tìm thấy (mauBiMat: 0 — mẫu là CHUỖI, ca dưới)
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

  it("regex DỰNG ĐỘNG lúc nạp hai tệp: bắt được đủ số điểm đã liệt kê, mỗi cái độ cao sao ≤ 1", async () => {
    const dung: Array<{ tep: string; nguon: string }> = [];
    globalThis.RegExp = new Proxy(GOC_REGEXP, {
      construct(dich, doiSo, moi) {
        const r = Reflect.construct(dich, doiSo, moi) as RegExp;
        // Khung GỌI `new RegExp` = khung đầu tiên (sau khung bẫy này) không phải tệp test, node_modules hay nội bộ node.
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
      khoiPhuc();
    }
    for (const tep of TEP_A1) expect(dung.filter((d) => d.tep === tep).length, tep).toBe(DIEM_DUNG_DONG[tep].length);
    expect(dung.filter((d) => doCaoSao(d.nguon) > 1 && !ngoaiLe(d.nguon)).map((d) => `${d.tep} /${d.nguon.slice(0, 80)}/`)).toEqual([]);
  });

  it("mọi regex THỰC SỰ chạy trong cheChuoi trên các họ xấu (gồm aiSafety): độ cao sao ≤ 1 trừ ngoại lệ", async () => {
    const cheChuoi = await napCheChuoi();
    const ghi: Ghi = { cong: 0, daChay: new Map() };
    bocPrototype(ghi);
    try {
      for (const [, sinh] of HO_XAU) cheChuoi(sinh(500));
    } finally {
      khoiPhuc();
    }
    expect(ghi.daChay.size).toBeGreaterThan(20);
    const vuot = [...ghi.daChay.values()].filter((r) => doCaoSao(r.source) > 1);
    expect(vuot.filter((r) => !ngoaiLe(r.source)).map((r) => `/${r.source.slice(0, 80)}/`)).toEqual([]);
    // Mỗi ngoại lệ đã liệt kê PHẢI thật sự chạy (không giữ ngoại lệ chết).
    expect(NGOAI_LE.map((n) => vuot.some((r) => ngoaiLe(r.source) === n))).toEqual(NGOAI_LE.map(() => true));
  });

  it.each(NGOAI_LE.map((n) => [n.ten, n] as const))("ngoại lệ %s: đầu vào đối kháng dài chạy xong nhanh (biên ≥ 200 lần)", async (_t, n) => {
    const cheChuoi = await napCheChuoi();
    const ghi: Ghi = { cong: 0, daChay: new Map() };
    bocPrototype(ghi);
    try {
      for (const [, sinh] of HO_XAU) cheChuoi(sinh(500));
    } finally {
      khoiPhuc();
    }
    const re = [...ghi.daChay.values()].find((r) => ngoaiLe(r.source) === n);
    expect(re, n.ten).toBeDefined();
    // Chạy trong Worker có HẠN: regex lùi thảm hoạ chạy ĐỒNG BỘ, chặn vòng sự kiện ⇒ hạn giờ của vitest KHÔNG ngắt được (đo 14/11:
    // bản mơ hồ của chính regex này treo cả lượt test). worker.terminate() thì ngắt được giữa lúc regex đang lùi (đo: dừng đúng hạn).
    // Biên rất rộng: bản thật trên ~360 000 ký tự xong trong vài ms (cộng khởi Worker); bản mơ hồ cần ~2^20 000 bước.
    expect(await chayCoHan(re!.source, re!.flags.replace(/[gy]/g, ""), n.doiKhang, 2_000)).toBe(false);
  });

  it("chayCoHan: regex mơ hồ thật (đối chứng dương) ⇒ HẾT GIỜ, không treo", async () => {
    // Đo 14/11: bản mơ hồ này mất 41 ms ở 18 vòng, 511 ms ở 22 vòng — tăng theo hàm mũ.
    expect(await chayCoHan(String.raw`^(?:\[REDACTED_[A-Z]+\]\s*|\s)+$`, "", "[REDACTED_A] ".repeat(40) + "x", 500)).toBe("het-gio");
    expect(soWorkerSong).toBe(0); // worker đang lùi đã bị terminate VÀ đã thoát
  });

  it("chayCoHan: regex nguồn hỏng (Worker ném) ⇒ ném ra ca, worker vẫn thoát", async () => {
    await expect(chayCoHan("(", "", "x", 2_000)).rejects.toThrow();
    expect(soWorkerSong).toBe(0);
  });
});
