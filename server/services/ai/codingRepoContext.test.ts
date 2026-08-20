/**
 * ★★★ doc 79 · TRỤC 1 (D) — CHÍNH SÁCH của ngữ cảnh mã, đo trên HÀM THUẦN + SEAM TIÊM VÀO.
 *
 * ⚠⚠ **KHÔNG `vi.mock` một module nào ở file này**, có chủ ý. Bài học đã trả giá: một lưới dựa vào
 *    mock module xanh khi chạy riêng và ĐỎ trong suite. Cả hai phụ thuộc ngoài của
 *    `thuThapNguCanhMa` đều là THAM SỐ (`timMucLuc`, `docTep`), nên mọi ca dưới đây là phép đo trên
 *    chính hàm sản xuất với đầu vào do ta dựng — không có tầng giả nào chen vào giữa.
 *
 * ⚠⚠ **CA ÂM CHỐNG TỰ THOẢ** là xương sống của file này. Một lưới kiểu *"prompt có ngữ cảnh mã"*
 *    luôn xanh vì prompt luôn chứa cái gì đó. Nên mỗi cổng ở đây được đo **HAI CHIỀU**: đóng thì
 *    khối RỖNG **và** hàm phía sau **KHÔNG HỀ ĐƯỢC GỌI** (đếm lượt gọi, không chỉ đọc kết quả).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import {
  thuThapNguCanhMa,
  chanNguonNguCanhMa,
  chiMucKhopGoc,
  gocChiMucTriThuc,
  nguCanhMaEnabled,
  nguongDiemNguCanhMa,
  hanGioMucLucMs,
  BIEN_CO_NGU_CANH_MA,
  BIEN_GOC_CHI_MUC,
  BIEN_NGUONG_DIEM,
  BIEN_HAN_GIO,
  NGU_CANH_MA_MAC_DINH_BAT,
  NGUONG_DIEM_NGU_CANH_MA,
  HAN_GIO_MUC_LUC_MS,
  HAN_GIO_TOI_THIEU_PHA_B_MS,
  SO_UNG_VIEN_TOI_DA,
  KHOI_HEADER_NGU_CANH_MA,
  KHOI_FOOTER_NGU_CANH_MA,
  SO_TEP_TOI_DA,
  TRAN_BYTE_MOI_TEP_NGU_CANH,
  TRAN_TOKEN_NGU_CANH_MA,
  DAU_CAT,
  type DauVaoNguCanhMa,
  type TepNguCanh,
} from "./codingRepoContext";
import {
  motDuongDanMaTrongVanBan,
  REPO_INDEX_DEFAULT_MIN_SCORE,
  type GatherRepoIndexContextInput,
} from "./repoContextService";
import { uocLuongSoToken } from "../aiLlamaServerClient";

const GOC_THAT = path.resolve(process.cwd());
const GOC_KHAC = path.resolve(process.cwd(), "..", "mot-du-an-khac");

const ENV = [
  BIEN_CO_NGU_CANH_MA,
  BIEN_GOC_CHI_MUC,
  BIEN_NGUONG_DIEM,
  BIEN_HAN_GIO,
  "AI_REPO_SANDBOX_ROOT",
  "AI_COPILOT_REPO_INDEX_MIN_SCORE",
  "AI_COPILOT_REPO_INDEX_TIMEOUT_MS",
] as const;
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterEach(() => { for (const k of ENV) delete process.env[k]; });

type Doan = { sourcePath: string; text: string; score: number; truncated: boolean };
const doan = (sourcePath: string, score: number, text = "tom tat"): Doan => ({ sourcePath, text, score, truncated: false });

/**
 * ★★★ Mục lục GIẢ **HAI PHA** — và đây là chỗ thiết bị đo cũ nói dối.
 *
 * ⚠⚠ Bản trước trả CÙNG một danh sách cho mọi lời gọi, nên nó không phân biệt được pha nào đang
 *    chạy và không ca nào phát biểu được về hình dạng dữ liệu THẬT. Bản này bắt buộc người viết ca
 *    khai RIÊNG hai pha, đúng như `gatherRepoIndexContext` thật cư xử:
 *      • `cheDoVungMa:"corpus"` → truy hồi TRONG kho mã ⇒ chỉ có đường dẫn mã;
 *      • `cheDoVungMa:"tat"`    → toàn kho ⇒ thường là `docs/**`, `knowledge/**`, và giá trị nằm ở
 *        THÂN chunk (đường dẫn mã được nhắc trong đó), không ở `sourcePath`.
 */
function mucLucHaiPha(cau: { khoMa?: Doan[]; toanKho?: Doan[] }) {
  const goi: Array<GatherRepoIndexContextInput> = [];
  const fn = async (i: GatherRepoIndexContextInput) => {
    goi.push(i);
    const sn = i.cheDoVungMa === "tat" ? (cau.toanKho ?? []) : (cau.khoMa ?? []);
    return {
      block: "khong-dung-toi",
      tokens: 0,
      snippets: sn.filter((s) => s.score >= (i.minScore ?? 0)),
      reason: (sn.length ? "ok" : "empty") as "ok" | "empty",
      retrieved: sn.length,
    };
  };
  return Object.assign(fn, { goi, goiPha: (c: string) => goi.filter((g) => (g.cheDoVungMa ?? "sau") === c) });
}

/** Đường tắt cho ca chỉ quan tâm PHA A (kho mã). Pha B trả RỖNG — như câu "RBAC" đo được ở live. */
function mucLuc(duongVaDiem: Array<[string, number]>) {
  return mucLucHaiPha({ khoMa: duongVaDiem.map(([p, s]) => doan(p, s)) });
}

/** Cửa đọc GIẢ — trả về ĐÚNG hình dạng `ToolResult` của `read_file`; đếm lượt gọi + tham số. */
function cuaDoc(bang: Record<string, { content?: string; note?: string; bytes?: number; truncated?: boolean }>) {
  const goi: Array<{ duong: string; tranByte: number }> = [];
  const fn = async (duong: string, tranByte: number) => {
    goi.push({ duong, tranByte });
    const m = bang[duong];
    if (!m) return { note: "NOT_FOUND", data: {} };
    /**
     * ⚠⚠ CÓ `note` **VÀ VẪN CÓ `data.content`** — có chủ ý, và đây là một ĐÍNH CHÍNH THIẾT BỊ ĐO.
     *
     * Bản đầu của cửa giả trả `data: {}` khi có `note` (giống `RONG_DOC` mà `read_file` trả HÔM
     * NAY). Đo bằng đột biến **M3** (bỏ hẳn phép kiểm `kq.note`): **cả §3 lẫn §7.5 vẫn XANH** —
     * chúng xanh vì `content` rỗng, KHÔNG vì cổng `note` làm việc. Tức tôi đã có một hàng rào không
     * ai đo, và một lưới tự nhận là đo nó.
     * ⇒ Cửa giả nay dựng ca ĐỘC NHẤT: một `ToolResult` vừa từ chối vừa mang chữ. Nếu ngày mai
     *   `read_file` đổi sang "đọc được một phần + note cảnh báo", cổng `note` là thứ duy nhất chặn
     *   nội dung ấy vào prompt — và ca này là thứ duy nhất chứng minh nó còn sống.
     */
    if (m.note) return { note: m.note, data: { path: duong, content: m.content ?? "", bytes: (m.content ?? "").length } };
    return {
      data: {
        path: duong,
        content: m.content ?? "",
        bytes: m.bytes ?? (m.content ?? "").length,
        truncated: m.truncated ?? false,
        redacted: false,
      },
    };
  };
  return Object.assign(fn, { goi });
}

function dauVao(p: Partial<DauVaoNguCanhMa> & Pick<DauVaoNguCanhMa, "docTep">): DauVaoNguCanhMa {
  return { cauHoi: "hệ thống này xác thực người dùng thế nào", projectRoot: GOC_THAT, ...p };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — CỜ: riêng của đường lập trình, và khi TẮT thì KHÔNG có gì chạy phía sau", () => {
  it("★★ mặc định BẬT khi env vắng, và mọi cách viết đều đọc được", () => {
    expect(nguCanhMaEnabled()).toBe(NGU_CANH_MA_MAC_DINH_BAT);
    for (const v of ["0", "false", "off", "no", "FALSE"]) {
      process.env[BIEN_CO_NGU_CANH_MA] = v;
      expect(nguCanhMaEnabled(), `"${v}" phải là TẮT`).toBe(false);
    }
    for (const v of ["1", "true", "on", "yes"]) {
      process.env[BIEN_CO_NGU_CANH_MA] = v;
      expect(nguCanhMaEnabled(), `"${v}" phải là BẬT`).toBe(true);
    }
  });

  it("★★★ CA ÂM — cờ TẮT ⇒ khối RỖNG **và** mục lục/cửa đọc KHÔNG HỀ ĐƯỢC GỌI", async () => {
    process.env[BIEN_CO_NGU_CANH_MA] = "0";
    const ml = mucLuc([["server/a.ts", 0.9]]);
    const cd = cuaDoc({ "server/a.ts": { content: "export const A = 1;" } });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: cd }));
    expect(r.khoi).toBe("");
    expect(r.tokens).toBe(0);
    expect(r.tep).toEqual([]);
    expect(r.lyDo).toBe("co-tat");
    expect(ml.goi.length, "cờ tắt mà vẫn đi truy hồi = đốt GPU cho hư không").toBe(0);
    expect(cd.goi.length, "cờ tắt mà vẫn đọc đĩa = cờ không phải một cái công tắc").toBe(0);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — cùng câu hỏi, cờ BẬT ⇒ khối CÓ nội dung tệp", async () => {
    process.env[BIEN_CO_NGU_CANH_MA] = "1";
    const ml = mucLuc([["server/a.ts", 0.9]]);
    const cd = cuaDoc({ "server/a.ts": { content: "export const CHUOI_MOC_XAC_THUC = 1;" } });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: cd }));
    expect(r.lyDo).toBe("ok");
    expect(r.khoi).toContain("CHUOI_MOC_XAC_THUC");
    expect(r.khoi).toContain(KHOI_HEADER_NGU_CANH_MA);
    expect(r.khoi).toContain(KHOI_FOOTER_NGU_CANH_MA);
    // HAI pha mục lục (kho mã + cầu tài liệu), MỘT lượt đọc.
    expect(ml.goi.length).toBe(2);
    expect(cd.goi.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — TRỤC 2: gốc dự án SAI ⇒ fail-closed TRƯỚC cả lượt truy hồi", () => {
  it("★★★ `chiMucKhopGoc` — chỉ gốc mà chỉ mục MÔ TẢ mới khớp", () => {
    expect(chiMucKhopGoc(GOC_THAT)).toBe(true);
    expect(chiMucKhopGoc(GOC_KHAC)).toBe(false);
    // Vắng projectRoot KHÔNG mặc nhiên là khớp: nó rơi về `gocHopCat()`, thứ mà env đổi được.
    expect(chiMucKhopGoc(undefined)).toBe(true);
    process.env.AI_REPO_SANDBOX_ROOT = GOC_KHAC;
    expect(chiMucKhopGoc(undefined), "gốc hộp cát bị trỏ đi nơi khác ⇒ KHÔNG khớp").toBe(false);
  });

  it("★★★ CA ÂM — dự án KHÁC (vd Demo Csharp) ⇒ `khac-goc`, mục lục KHÔNG được gọi lần nào", async () => {
    const ml = mucLuc([["server/routers.ts", 0.95]]);
    const cd = cuaDoc({ "server/routers.ts": { content: "export const appRouter = 1;" } });
    const r = await thuThapNguCanhMa(dauVao({ projectRoot: GOC_KHAC, timMucLuc: ml, docTep: cd }));
    expect(r.lyDo).toBe("khac-goc");
    expect(r.khoi).toBe("");
    expect(ml.goi.length, "sai gốc mà vẫn truy hồi ⇒ đường dẫn của REPO CHÍNH sẽ được đem đi đọc").toBe(0);
    expect(cd.goi.length, "★★★ đây là chỗ rò rỉ xuyên dự án sẽ xảy ra nếu cổng này biến mất").toBe(0);
  });

  it("★★★ đúng gốc ⇒ chạy; chỉ đổi MỖI `projectRoot` ⇒ tắt. A/B trên một biến duy nhất", async () => {
    const bang = { "server/a.ts": { content: "export const X = 1;" } };
    const dung = await thuThapNguCanhMa(dauVao({ projectRoot: GOC_THAT, timMucLuc: mucLuc([["server/a.ts", 0.9]]), docTep: cuaDoc(bang) }));
    const sai = await thuThapNguCanhMa(dauVao({ projectRoot: GOC_KHAC, timMucLuc: mucLuc([["server/a.ts", 0.9]]), docTep: cuaDoc(bang) }));
    expect(dung.lyDo).toBe("ok");
    expect(sai.lyDo).toBe("khac-goc");
    expect(dung.khoi).not.toBe(sai.khoi);
  });

  it("★★ `AI_KNOWLEDGE_INDEX_ROOT` khai đè được gốc chỉ mục (triển khai chạy chỉ mục nơi khác)", () => {
    process.env[BIEN_GOC_CHI_MUC] = GOC_KHAC;
    expect(gocChiMucTriThuc()).toBe(GOC_KHAC);
    expect(chiMucKhopGoc(GOC_KHAC)).toBe(true);
    expect(chiMucKhopGoc(GOC_THAT)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — HỘP CÁT: từ chối của `read_file` được TÔN TRỌNG, không có đường vòng", () => {
  const CAM: Array<[string, string]> = [
    ["tệp bí mật", "DENIED_SECRET"],
    ["thư mục cấm", "DENIED_DIR"],
    ["đuôi không cho phép", "DENIED_EXT"],
    ["đường dẫn bị chặn", "PATH_REJECTED"],
    ["thiếu quyền RBAC", "PERMISSION_DENIED"],
    ["hết ngân sách byte", "BUDGET_EXCEEDED"],
  ];
  for (const [ten, ma] of CAM) {
    it(`★★★ ${ten} (${ma}) ⇒ tệp ấy KHÔNG vào prompt, KỂ CẢ khi kết quả có mang chữ`, async () => {
      const ml = mucLuc([["server/bimat.ts", 0.9]]);
      const cd = cuaDoc({ "server/bimat.ts": { note: ma, content: "BI_MAT_KHONG_DUOC_LO" } });
      const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: cd }));
      expect(r.khoi, "★★★ một lượt TỪ CHỐI mà vẫn có chữ ⇒ chỉ cổng `note` chặn được").toBe("");
      expect(r.khoi).not.toContain("BI_MAT_KHONG_DUOC_LO");
      expect(r.lyDo).toBe("khong-doc-duoc");
    });
  }

  it("★★★ tệp bị từ chối KHÔNG chặn tệp sau nó (một lượt cấm ≠ tắt cả tính năng)", async () => {
    const ml = mucLuc([["server/bimat.ts", 0.95], ["server/ok.ts", 0.8]]);
    const cd = cuaDoc({
      "server/bimat.ts": { note: "DENIED_SECRET", content: "BI_MAT_KHONG_DUOC_LO" },
      "server/ok.ts": { content: "export const DUOC_PHEP = 1;" },
    });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: cd }));
    expect(r.lyDo).toBe("ok");
    expect(r.khoi).toContain("DUOC_PHEP");
    expect(r.tep.map((t) => t.duong)).toEqual(["server/ok.ts"]);
  });

  it("★★★ cửa đọc luôn được xin trần byte ĐÃ KHAI — không xin mặc định 64 KB", async () => {
    const cd = cuaDoc({ "server/a.ts": { content: "x" } });
    await thuThapNguCanhMa(dauVao({ timMucLuc: mucLuc([["server/a.ts", 0.9]]), docTep: cd }));
    expect(cd.goi[0]!.tranByte).toBe(TRAN_BYTE_MOI_TEP_NGU_CANH);
  });

  it("★★★ KHÔNG có cửa đọc ⇒ `khong-cua-doc`, KHÔNG truy hồi (đọc mã không RBAC là một đường thoát)", async () => {
    const ml = mucLuc([["server/a.ts", 0.9]]);
    const r = await thuThapNguCanhMa({ cauHoi: "x", projectRoot: GOC_THAT, timMucLuc: ml, docTep: undefined as never });
    expect(r.lyDo).toBe("khong-cua-doc");
    expect(ml.goi.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — NGÂN SÁCH TOKEN: cắt bằng CÙNG cái thước, và khai ra là đã cắt", () => {
  it("★★★ ngân sách quá nhỏ ⇒ `khong-ngan-sach` và KHÔNG đi embed (cổng RẺ trước cổng TỐN)", async () => {
    const ml = mucLuc([["server/a.ts", 0.9]]);
    const cd = cuaDoc({ "server/a.ts": { content: "x".repeat(1000) } });
    const r = await thuThapNguCanhMa(dauVao({ tranToken: 60, timMucLuc: ml, docTep: cd }));
    expect(r.lyDo).toBe("khong-ngan-sach");
    expect(ml.goi.length).toBe(0);
    expect(cd.goi.length).toBe(0);
  });

  it("★★★ khối KHÔNG BAO GIỜ vượt trần token đã cấp — đo bằng `uocLuongSoToken`, thước THẬT", async () => {
    const to = "// dòng mã rất dài ".repeat(4000); // ~76 KB
    for (const tran of [400, 900, 2_000, TRAN_TOKEN_NGU_CANH_MA]) {
      const r = await thuThapNguCanhMa(
        dauVao({
          tranToken: tran,
          timMucLuc: mucLuc([["server/a.ts", 0.9], ["server/b.ts", 0.8], ["server/c.ts", 0.7]]),
          docTep: cuaDoc({
            "server/a.ts": { content: to },
            "server/b.ts": { content: to },
            "server/c.ts": { content: to },
          }),
        }),
      );
      expect(uocLuongSoToken(r.khoi), `trần ${tran} bị vượt`).toBeLessThanOrEqual(tran);
      expect(r.tokens).toBe(uocLuongSoToken(r.khoi));
    }
  });

  it("★★★ mẩu mã bị cắt PHẢI khai là cắt — ở CẢ dấu trong prompt LẪN cờ `daCat`", async () => {
    const r = await thuThapNguCanhMa(
      dauVao({
        tranToken: 500,
        timMucLuc: mucLuc([["server/a.ts", 0.9]]),
        docTep: cuaDoc({ "server/a.ts": { content: "// mã ".repeat(5000), bytes: 30_000 } }),
      }),
    );
    expect(r.lyDo).toBe("ok");
    expect(r.tep[0]!.daCat, "một mẩu cụt mà không khai là cụt ⇒ model tưởng đó là toàn bộ sự thật").toBe(true);
    expect(r.khoi).toContain(DAU_CAT);
    expect(r.tep[0]!.kyTuVaoPrompt).toBeLessThan(30_000);
  });

  it("★★ `truncated` do CHÍNH `read_file` cắt (trần byte) cũng phải nổi lên `daCat`", async () => {
    const r = await thuThapNguCanhMa(
      dauVao({
        timMucLuc: mucLuc([["server/a.ts", 0.9]]),
        docTep: cuaDoc({ "server/a.ts": { content: "export const A = 1;", bytes: 90_000, truncated: true } }),
      }),
    );
    expect(r.tep[0]!.daCat).toBe(true);
    expect(r.tep[0]!.byteTrenDia).toBe(90_000);
  });

  it("★★ trần SỐ TỆP được tôn trọng, và thứ hạng của mục lục được giữ", async () => {
    const ml = mucLuc([["server/a.ts", 0.9], ["server/b.ts", 0.85], ["server/c.ts", 0.8], ["server/d.ts", 0.75]]);
    const r = await thuThapNguCanhMa(
      dauVao({
        timMucLuc: ml,
        docTep: cuaDoc({
          "server/a.ts": { content: "A" }, "server/b.ts": { content: "B" },
          "server/c.ts": { content: "C" }, "server/d.ts": { content: "D" },
        }),
      }),
    );
    expect(r.tep.length).toBe(SO_TEP_TOI_DA);
    expect(r.tep.map((t) => t.duong)).toEqual(["server/a.ts", "server/b.ts", "server/c.ts"]);
  });

  it("★★ đường dẫn TRÙNG trong mục lục chỉ đọc MỘT lần (nhiều chunk cùng một tệp là chuyện thường)", async () => {
    const cd = cuaDoc({ "server/a.ts": { content: "A" }, "server/b.ts": { content: "B" } });
    const r = await thuThapNguCanhMa(
      dauVao({ timMucLuc: mucLuc([["server/a.ts", 0.9], ["server/a.ts", 0.88], ["server/b.ts", 0.8]]), docTep: cd }),
    );
    expect(cd.goi.map((g) => g.duong)).toEqual(["server/a.ts", "server/b.ts"]);
    expect(r.tep.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — FAIL-SAFE: hỏng ở đâu cũng chỉ mất NGỮ CẢNH, không mất lượt sinh mã", () => {
  it("★★★ mục lục NÉM ⇒ khối rỗng, KHÔNG ném ra ngoài", async () => {
    const r = await thuThapNguCanhMa(
      dauVao({ timMucLuc: async () => { throw new Error("embed no"); }, docTep: cuaDoc({}) }),
    );
    expect(r.lyDo).toBe("muc-luc-rong");
    expect(r.khoi).toBe("");
  });

  it("★★★ cửa đọc NÉM ⇒ bỏ tệp ấy, KHÔNG ném ra ngoài", async () => {
    const r = await thuThapNguCanhMa(
      dauVao({
        timMucLuc: mucLuc([["server/a.ts", 0.9], ["server/b.ts", 0.8]]),
        docTep: async (d: string) => { if (d === "server/a.ts") throw new Error("io"); return { data: { path: d, content: "OK_B", bytes: 4 } }; },
      }),
    );
    expect(r.lyDo).toBe("ok");
    expect(r.khoi).toContain("OK_B");
  });

  it("★★ mục lục RỖNG / câu hỏi rỗng ⇒ lý do NÓI ĐÚNG nguyên nhân, không gộp thành một", async () => {
    expect((await thuThapNguCanhMa(dauVao({ timMucLuc: mucLuc([]), docTep: cuaDoc({}) }))).lyDo).toBe("muc-luc-rong");
    expect((await thuThapNguCanhMa(dauVao({ cauHoi: "   ", timMucLuc: mucLuc([["a", 1]]), docTep: cuaDoc({}) }))).lyDo).toBe("khong-cau-hoi");
  });

  it("★★ nội dung RỖNG (tệp trống) không sinh ra một khối rỗng có khung", async () => {
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: mucLuc([["server/a.ts", 0.9]]), docTep: cuaDoc({ "server/a.ts": { content: "   " } }) }));
    expect(r.lyDo).toBe("khong-doc-duoc");
    expect(r.khoi).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — NGƯỜI DÙNG PHẢI THẤY: chân nguồn nói đúng tệp, đúng phần đã cắt, đủ 3 ngôn ngữ", () => {
  const TEP: TepNguCanh[] = [
    { nguon: "kho-ma", duong: "server/auth.ts", byteTrenDia: 9000, kyTuVaoPrompt: 3000, daCat: true, diem: 0.8 },
    { nguon: "cau-tai-lieu", duong: "server/routers.ts", byteTrenDia: 500, kyTuVaoPrompt: 500, daCat: false, diem: 0.7 },
  ];

  it("★★★ RỖNG khi không có tệp — không được khoe một nguồn không tồn tại", () => {
    expect(chanNguonNguCanhMa([], "vi")).toBe("");
  });

  it("★★★ nêu ĐÍCH DANH từng tệp, và khai phần bị cắt", () => {
    const s = chanNguonNguCanhMa(TEP, "vi");
    expect(s).toContain("server/auth.ts");
    expect(s).toContain("server/routers.ts");
    expect(s).toContain("3000/9000");
    expect(s).toContain("ĐỌC TỪ ĐĨA");
  });

  for (const lang of ["vi", "en", "zh"] as const) {
    it(`★★ locale ${lang} có câu riêng (không rơi về tiếng Việt)`, () => {
      const s = chanNguonNguCanhMa(TEP, lang);
      expect(s).toContain("server/auth.ts");
      if (lang === "en") expect(s).toContain("read from disk this turn");
      if (lang === "zh") expect(s).toContain("本轮从磁盘读取");
      if (lang === "vi") expect(s).toContain("ĐỌC TỪ ĐĨA trong lượt này");
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ★★★ §7 — HÌNH DẠNG THẬT CỦA KHO. Đây là mục mà lưới cũ (101/101 XANH) **không phát biểu nổi**.
//
// ⚠⚠ Mọi ca của lưới cũ nuôi mục lục bằng `[["server/a.ts", 0.9]]` — một chunk **KHÔNG TỒN TẠI**
//    trong `knowledge/chunks.jsonl`. Với hình dạng giả tưởng ấy tính năng luôn chạy, nên 101 ca
//    xanh + 9 đột biến vẫn không nói được rằng ở live nó giao **0 tệp, ba lượt liên tiếp**.
//    Dưới đây là số ĐO THẬT ngày 2026-08-20 (đường sản phẩm đầy đủ, topK=8) đem vào làm dữ liệu ca.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** Top-8 THẬT của câu "hệ thống này xác thực người dùng như thế nào?" — pha TOÀN KHO. */
const THAT_TOAN_KHO_XAC_THUC: Doan[] = [
  doan("knowledge/operational-approved/users.md", 0.531, "Route: /users | Quản lý người dùng…"),
  doan("knowledge/operational/about-system.md", 0.5155, "Route: /about-system | Giới thiệu hệ thống…"),
  doan(
    "knowledge/features/admin/user-management.md",
    0.4975,
    "# Quản lý người dùng\nMàn hình gọi `server/routers/userRouters.ts` để tạo/sửa.",
  ),
  doan("knowledge/operational-approved/users.md", 0.4964, "Quy trình duyệt tài khoản…"),
  doan("docs/USER_GUIDE.md", 0.4861, "# Hướng dẫn sử dụng\nĐăng nhập bằng tên và mật khẩu."),
  doan("knowledge/operational/users.md", 0.4674, "Route: /users | Permission: user_management"),
  doan(
    "apidocs/AUTHENTICATION.md",
    0.4672,
    "Xác thực máy đi qua `server/services/machineAuthService.ts` và `server/routers/userRouters.ts`.",
  ),
  doan("knowledge/operational/system-health.md", 0.4576, "Route: /system-health"),
];

/** Top-8 THẬT của cùng câu ấy — pha KHO MÃ (`cheDoVungMa:"corpus"`). */
const THAT_KHO_MA_XAC_THUC: Doan[] = [
  doan("server/_core/quetDiemXacThuc.ts", 0.4125),
  doan("server/routers/hoXacThucScan.ts", 0.3869),
  doan("server/routes/_xacThucRest.ts", 0.3699),
  doan("shared/module-registry.ts", 0.3601),
  doan("client/src/lib/congDoiMatKhau.ts", 0.3408),
  doan("server/db/auth.ts", 0.3393),
  doan("server/routers/_phamViNguoiXem.ts", 0.337),
  doan("server/routers/hoXacThucScan.ts", 0.3191),
];

/** Top-8 THẬT của câu "phân quyền RBAC…" — pha TOÀN KHO. **Không một đường dẫn mã nào trong thân.** */
const THAT_TOAN_KHO_RBAC: Doan[] = [
  doan("knowledge/features/admin/role-management.md", 0.5897, "# Quản lý vai trò\nMàn hình gán vai trò cho người dùng."),
  doan("knowledge/operational-approved/_PHIEU_DIEN_7_O_TRONG.md", 0.5315, "Phiếu điền…"),
  doan("knowledge/operational-approved/_PHIEU_DIEN_7_O_TRONG.md", 0.5029, "Phiếu điền tiếp…"),
  doan("knowledge/features/admin/permission-mgmt.md", 0.494, "# Phân quyền\nMa trận quyền theo nhóm."),
  // ⚠⚠ CHỮ ĐỘN Ở ĐÂY KHÔNG ĐƯỢC CHỨA CHUỖI "P·h·a <số>" (viết liền, mọi kiểu hoa thường).
  //   `vramPha5Gate.test.ts` quét NỘI DUNG mọi `*.test.ts` bằng `/\bP...a\s+\d+…/i` để tìm lưới TỰ
  //   KHAI thuộc công trình VRAM và đòi chúng nằm TRONG §Cổng kiểm chung. Bản đầu của tôi để một
  //   chuỗi như thế làm chữ độn ⇒ tệp này bị nhận nhầm là lưới VRAM ngoài cổng ⇒ cổng ấy **ĐỎ**
  //   (đo được: xanh ở HEAD, đỏ với bản vá). Một lời tự khai SAI, dù chỉ nằm trong một chuỗi độn,
  //   vẫn là một lời tự khai sai — và chính chú thích này lúc đầu cũng dính bẫy đó.
  doan("docs/superpowers/reports/2026-08-06-vram-cap-quyen.md", 0.4932, "Báo cáo cấp quyền…"),
  doan("docs/ECOSYSTEM/50_RBAC_PROCEDURE_MIGRATION_R4_2026-07-13.md", 0.4857, "Kế hoạch di trú thủ tục RBAC."),
  doan("docs/ECOSYSTEM/38_POST_IMPROVEMENT_REAUDIT_BACKEND_DB.md", 0.4748, "Tái kiểm backend…"),
  doan("knowledge/operational/process-analytics.md", 0.474, "Route: /process-analytics"),
];

/** Top-8 THẬT của câu "phân quyền RBAC…" — pha KHO MÃ. */
const THAT_KHO_MA_RBAC: Doan[] = [
  doan("server/services/aiLocalTools/repoReadTools.ts", 0.4342),
  doan("server/services/aiLocalTools/readToolRbac.ts", 0.4149),
  doan("server/services/aiLocalTools/readToolRbac.ts", 0.4011),
  doan("shared/module-registry.ts", 0.3614),
  doan("server/services/aiLocalTools/repoSandbox.ts", 0.3388),
  doan("server/services/ai/repoContextService.ts", 0.3374),
  doan("server/services/aiLocalTools/repoCommandSandbox.ts", 0.327),
  doan("server/services/aiLocalTools/repoProjects.ts", 0.3228),
];

const MOI_TEP_DEU_DOC_DUOC = async (duong: string) => ({
  data: { path: duong, content: `// nội dung thật của ${duong}\nexport const X = 1;\n`, bytes: 900, truncated: false },
});

describe("§7 — HÌNH DẠNG THẬT: kho đa số là `doc`, và đường đi VẪN phải sinh ra tệp mã", () => {
  it("★★★ CÂU LIVE 1 (xác thực) với chunk THẬT ⇒ ≥1 tệp MÃ vào prompt (lưới cũ mù đúng chỗ này)", async () => {
    const ml = mucLucHaiPha({ khoMa: THAT_KHO_MA_XAC_THUC, toanKho: THAT_TOAN_KHO_XAC_THUC });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(r.lyDo, "đây CHÍNH LÀ triệu chứng live: 0 tệp, không lỗi, không log").toBe("ok");
    expect(r.tep.length).toBeGreaterThanOrEqual(1);
    expect(r.khoi).toContain(KHOI_HEADER_NGU_CANH_MA);
    // Mọi tệp vào prompt PHẢI là tệp mã — không một `docs/**`/`knowledge/**` nào lọt.
    for (const t of r.tep) {
      expect(t.duong, `"${t.duong}" không thuộc vùng mã`).toMatch(/^(server|client|shared|drizzle|scripts)\//);
    }
  });

  it("★★★ CÂU LIVE 2 (RBAC) — pha B mót được **0** đường dẫn, pha A vẫn phải gánh đủ", async () => {
    const ml = mucLucHaiPha({ khoMa: THAT_KHO_MA_RBAC, toanKho: THAT_TOAN_KHO_RBAC });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(r.lyDo).toBe("ok");
    expect(r.tep.length).toBe(SO_TEP_TOI_DA);
    expect(r.tep.every((t) => t.nguon === "kho-ma"), "câu này pha B không mót được gì — đo thật").toBe(true);
  });

  it("★★★ CA ÂM CỦA CHÍNH BẢN VÁ — chỉ có pha TOÀN KHO (như hôm qua) ⇒ **0 tệp**", async () => {
    // Dựng lại ĐÚNG thế giới trước bản vá: mục lục chỉ biết trả chunk toàn kho.
    const ml = mucLucHaiPha({ khoMa: [], toanKho: THAT_TOAN_KHO_RBAC });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(r.lyDo, "★ nếu ca này thành 'ok' thì cầu tài liệu đang nuốt cả chunk doc vào prompt").toBe("muc-luc-rong");
    expect(r.khoi).toBe("");
  });

  it("★★★ ĐIỂM THẬT (0,31–0,55) phải LỌT — ngưỡng 0,60 của đường PLC sẽ giết sạch", () => {
    expect(NGUONG_DIEM_NGU_CANH_MA).toBeLessThan(REPO_INDEX_DEFAULT_MIN_SCORE);
    const diemThapNhat = Math.min(
      ...THAT_KHO_MA_XAC_THUC.map((d) => d.score),
      ...THAT_KHO_MA_RBAC.map((d) => d.score),
    );
    expect(diemThapNhat, "số đo thật thấp nhất").toBeLessThan(REPO_INDEX_DEFAULT_MIN_SCORE);
    expect(NGUONG_DIEM_NGU_CANH_MA, "ngưỡng phải NẰM DƯỚI mọi số đo thật").toBeLessThanOrEqual(diemThapNhat);
  });

  it("★★★ núm của đường PLC KHÔNG được điều khiển đường này (đúng lỗi vừa xảy ra ở live)", async () => {
    process.env.AI_COPILOT_REPO_INDEX_MIN_SCORE = "0.95";
    process.env.AI_COPILOT_REPO_INDEX_TIMEOUT_MS = "1";
    const ml = mucLucHaiPha({ khoMa: THAT_KHO_MA_XAC_THUC, toanKho: THAT_TOAN_KHO_XAC_THUC });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(r.lyDo).toBe("ok");
    for (const g of ml.goi) {
      expect(g.minScore, "minScore phải TRUYỀN TƯỜNG MINH, không rơi về env của đường PLC").toBe(
        NGUONG_DIEM_NGU_CANH_MA,
      );
      expect(g.timeoutMs, "hạn giờ cũng vậy").toBeGreaterThan(1);
    }
  });

  it("★★ núm RIÊNG của đường này thì phải ăn", async () => {
    process.env[BIEN_NGUONG_DIEM] = "0.4";
    process.env[BIEN_HAN_GIO] = "7000";
    expect(nguongDiemNguCanhMa()).toBe(0.4);
    expect(hanGioMucLucMs()).toBe(7000);
    const ml = mucLucHaiPha({ khoMa: THAT_KHO_MA_XAC_THUC, toanKho: [] });
    await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(ml.goi[0]!.minScore).toBe(0.4);
    expect(ml.goi[0]!.timeoutMs).toBe(7000);
  });

  it("★★ mặc định: ngưỡng + hạn giờ là hằng đã khai, không phải số ngẫu hứng", () => {
    expect(nguongDiemNguCanhMa()).toBe(NGUONG_DIEM_NGU_CANH_MA);
    expect(hanGioMucLucMs()).toBe(HAN_GIO_MUC_LUC_MS);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§8 — HAI CÂY CẦU: mỗi cầu hỏng ở một chỗ, nên KHÔNG cầu nào được độc chiếm", () => {
  it("★★★ cầu KHO MÃ chết hẳn ⇒ cầu TÀI LIỆU vẫn giao được tệp", async () => {
    const ml = mucLucHaiPha({
      khoMa: [],
      toanKho: [doan("docs/X.md", 0.5, "Xác thực nằm ở `server/_core/authService.ts` và `server/db/auth.ts`.")],
    });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(r.lyDo).toBe("ok");
    expect(r.tep.map((t) => t.duong)).toEqual(["server/_core/authService.ts", "server/db/auth.ts"]);
    expect(r.tep.every((t) => t.nguon === "cau-tai-lieu")).toBe(true);
  });

  it("★★★ cầu TÀI LIỆU chết hẳn ⇒ cầu KHO MÃ vẫn giao được tệp", async () => {
    const ml = mucLucHaiPha({ khoMa: [doan("server/a.ts", 0.4)], toanKho: [] });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(r.lyDo).toBe("ok");
    expect(r.tep.map((t) => t.nguon)).toEqual(["kho-ma"]);
  });

  it("★★★ XEN KẼ A1,B1,A2 — không phải nối đuôi (nối đuôi ⇒ cầu B không bao giờ tới lượt)", async () => {
    const ml = mucLucHaiPha({
      khoMa: [doan("server/a1.ts", 0.5), doan("server/a2.ts", 0.4), doan("server/a3.ts", 0.3)],
      toanKho: [doan("docs/X.md", 0.6, "xem `server/b1.ts` rồi `server/b2.ts`")],
    });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(r.tep.map((t) => t.duong)).toEqual(["server/a1.ts", "server/b1.ts", "server/a2.ts"]);
    expect(r.tep.map((t) => t.nguon)).toEqual(["kho-ma", "cau-tai-lieu", "kho-ma"]);
  });

  it("★★★ pha A HỎNG (ném) ⇒ pha B vẫn chạy — fail-safe theo TỪNG pha, không phải cả cụm", async () => {
    let lan = 0;
    const tim = async (i: GatherRepoIndexContextInput) => {
      lan++;
      if (i.cheDoVungMa !== "tat") throw new Error("kho mã sập");
      return {
        block: "",
        tokens: 0,
        reason: "ok" as const,
        retrieved: 1,
        snippets: [doan("docs/X.md", 0.5, "đọc `server/con-song.ts` nhé")],
      };
    };
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: tim, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(lan).toBe(2);
    expect(r.lyDo).toBe("ok");
    expect(r.tep.map((t) => t.duong)).toEqual(["server/con-song.ts"]);
  });

  it("★★★ HẠN GIỜ là TỔNG, không phải mỗi pha một hạn — pha A ăn hết ⇒ pha B bị BỎ", async () => {
    process.env[BIEN_HAN_GIO] = "1600";
    const goi: GatherRepoIndexContextInput[] = [];
    const tim = async (i: GatherRepoIndexContextInput) => {
      goi.push(i);
      // Pha A "chạy" 1.500 ms ⇒ còn ~100 ms < HAN_GIO_TOI_THIEU_PHA_B_MS.
      if (i.cheDoVungMa === "corpus") await new Promise((r) => setTimeout(r, 1_500));
      return { block: "", tokens: 0, reason: "ok" as const, retrieved: 1, snippets: [doan("server/a.ts", 0.5)] };
    };
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: tim, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(goi.length, "pha B phải bị BỎ, không phải nhân đôi ngân sách").toBe(1);
    expect(goi[0]!.timeoutMs).toBe(1600);
    expect(r.lyDo).toBe("ok"); // pha A vẫn giao được tệp
    expect(HAN_GIO_TOI_THIEU_PHA_B_MS).toBeGreaterThan(100);
  });

  it("★★★ pha B CHẠY nhưng chỉ với PHẦN CÒN LẠI — không phải một ngân sách mới nguyên", async () => {
    /**
     * ⚠⚠ Ca trên một mình KHÔNG đủ, và đột biến M6 chứng minh điều đó: đổi hạn giờ pha B từ
     *    `conLaiMs` thành `hanGioTong` mà lưới VẪN XANH — vì ca trên chỉ đo *"pha B có bị BỎ không"*,
     *    một mệnh đề mà M6 không hề chạm tới. Mệnh đề còn thiếu: **khi pha B CHẠY, hạn giờ của nó
     *    phải đã bị TRỪ đi thời gian pha A tiêu**. Đó mới là chỗ chữ "TỔNG" có nghĩa.
     */
    process.env[BIEN_HAN_GIO] = "10000";
    const goi: GatherRepoIndexContextInput[] = [];
    const tim = async (i: GatherRepoIndexContextInput) => {
      goi.push(i);
      if (i.cheDoVungMa === "corpus") await new Promise((r) => setTimeout(r, 3_000));
      return { block: "", tokens: 0, reason: "ok" as const, retrieved: 1, snippets: [doan("server/a.ts", 0.5)] };
    };
    await thuThapNguCanhMa(dauVao({ timMucLuc: tim, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(goi.length, "pha B PHẢI chạy — còn 7 s là thừa").toBe(2);
    expect(goi[0]!.timeoutMs).toBe(10_000);
    expect(goi[1]!.timeoutMs, "★★★ hạn giờ pha B phải TRỪ thời gian pha A đã tiêu").toBeLessThanOrEqual(7_100);
    expect(goi[1]!.timeoutMs, "và vẫn phải còn dư địa thật, không phải một con số vụn").toBeGreaterThan(6_000);
  }, 20_000);

  it("★★ trần SỐ ỨNG VIÊN chặn số lượt gọi `read_file` (ứng viên mót có thể là tệp KHÔNG tồn tại)", async () => {
    const nhieu = Array.from({ length: 20 }, (_, i) => doan(`server/k${i}.ts`, 0.5));
    const cd = cuaDoc({}); // MỌI tệp đều NOT_FOUND — đúng cảnh ứng viên mót trỏ vào hư không
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: mucLucHaiPha({ khoMa: nhieu }), docTep: cd }));
    expect(r.lyDo).toBe("khong-doc-duoc");
    expect(cd.goi.length).toBeLessThanOrEqual(SO_UNG_VIEN_TOI_DA);
    expect(r.soDuongDanMucLuc).toBe(SO_UNG_VIEN_TOI_DA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§9 — CẦU TÀI LIỆU→MÃ: hàm mót là hàm THUẦN, và nó không được mở một lối thoát mới", () => {
  it("★★★ mót đúng đường dẫn mã, giữ thứ tự xuất hiện, khử trùng", () => {
    const t = "Xem `server/db/auth.ts`, rồi client/src/lib/x.tsx, rồi lại server/db/auth.ts nữa.";
    expect(motDuongDanMaTrongVanBan(t)).toEqual(["server/db/auth.ts", "client/src/lib/x.tsx"]);
  });

  it("★★★ KHÔNG mót thứ ngoài vùng mã — `docs/**`, `knowledge/**`, đường tuyệt đối", () => {
    const t = "docs/A.md và knowledge/b.md và /etc/passwd";
    expect(motDuongDanMaTrongVanBan(t)).toEqual([]);
  });

  it("★★★ CA ÂM CỦA CỔNG VÙNG — chuỗi TRÔNG y hệt đường dẫn mã nhưng ở thư mục KHÁC ⇒ LOẠI", () => {
    // Đột biến M2 (gỡ phép kiểm vùng) sống sót ở bản đầu vì regex tự nhồi danh sách tiền tố.
    // Ba chuỗi này có đủ hình dạng của một đường dẫn `.ts` và CHỈ cổng vùng mới loại được chúng.
    const t = "docs/x/y.ts · knowledge/z/w.ts · sandbox-projects/demo/a.ts · node_modules/pkg/i.js";
    expect(motDuongDanMaTrongVanBan(t)).toEqual([]);
    // Đối chứng DƯƠNG trên cùng một chuỗi: đổi ĐÚNG thư mục gốc thì nó phải lọt.
    expect(motDuongDanMaTrongVanBan("server/x/y.ts")).toEqual(["server/x/y.ts"]);
  });

  it("★★ bảng tiền tố là THAM SỐ — thu hẹp bảng thì cổng vùng phải hẹp theo", () => {
    const t = "server/a.ts và client/b.ts";
    expect(motDuongDanMaTrongVanBan(t, ["server/"])).toEqual(["server/a.ts"]);
    expect(motDuongDanMaTrongVanBan(t, ["client/"])).toEqual(["client/b.ts"]);
  });

  it("★★★ CA ÂM AN TOÀN — đoạn có `..` bị LOẠI ở đây, không đẩy sang hộp cát rồi mới bị chặn", () => {
    expect(motDuongDanMaTrongVanBan("server/../../etc/passwd.ts")).toEqual([]);
    expect(motDuongDanMaTrongVanBan("server/a/../b.ts")).toEqual([]);
  });

  it("★★ không nhận đuôi lạ (ảnh/nhị phân) dù nằm dưới `server/`", () => {
    expect(motDuongDanMaTrongVanBan("server/x.png server/y.exe server/z.ts")).toEqual(["server/z.ts"]);
  });

  it("★★ chuỗi rỗng / rác ⇒ mảng rỗng, KHÔNG ném", () => {
    expect(motDuongDanMaTrongVanBan("")).toEqual([]);
    expect(motDuongDanMaTrongVanBan(undefined as never)).toEqual([]);
    expect(motDuongDanMaTrongVanBan("serverabc.ts")).toEqual([]);
  });

  it("★★★ văn bản của pha B **KHÔNG** vào prompt — chỉ đường dẫn mót được mới vào", async () => {
    const BIMAT = "CHUOI_TRONG_TAI_LIEU_KHONG_DUOC_VAO_PROMPT";
    const ml = mucLucHaiPha({
      khoMa: [],
      toanKho: [doan("docs/X.md", 0.5, `${BIMAT} — xem \`server/a.ts\``)],
    });
    const r = await thuThapNguCanhMa(dauVao({ timMucLuc: ml, docTep: MOI_TEP_DEU_DOC_DUOC }));
    expect(r.lyDo).toBe("ok");
    expect(r.khoi).not.toContain(BIMAT);
    expect(r.khoi).toContain("server/a.ts");
  });
});
