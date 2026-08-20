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
  BIEN_CO_NGU_CANH_MA,
  BIEN_GOC_CHI_MUC,
  NGU_CANH_MA_MAC_DINH_BAT,
  KHOI_HEADER_NGU_CANH_MA,
  KHOI_FOOTER_NGU_CANH_MA,
  SO_TEP_TOI_DA,
  TRAN_BYTE_MOI_TEP_NGU_CANH,
  TRAN_TOKEN_NGU_CANH_MA,
  DAU_CAT,
  type DauVaoNguCanhMa,
} from "./codingRepoContext";
import { uocLuongSoToken } from "../aiLlamaServerClient";

const GOC_THAT = path.resolve(process.cwd());
const GOC_KHAC = path.resolve(process.cwd(), "..", "mot-du-an-khac");

const ENV = [BIEN_CO_NGU_CANH_MA, BIEN_GOC_CHI_MUC, "AI_REPO_SANDBOX_ROOT"] as const;
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterEach(() => { for (const k of ENV) delete process.env[k]; });

/** Mục lục GIẢ — ghi lại số lượt gọi để ca âm chứng minh được "KHÔNG hề đi truy hồi". */
function mucLuc(duongVaDiem: Array<[string, number]>) {
  const goi: unknown[] = [];
  const fn = async (i: unknown) => {
    goi.push(i);
    return {
      block: "khong-dung-toi",
      tokens: 0,
      snippets: duongVaDiem.map(([sourcePath, score]) => ({ sourcePath, text: "tom tat", score, truncated: false })),
      reason: "ok" as const,
      retrieved: duongVaDiem.length,
    };
  };
  return Object.assign(fn, { goi });
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
    expect(ml.goi.length).toBe(1);
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
  const TEP = [
    { duong: "server/auth.ts", byteTrenDia: 9000, kyTuVaoPrompt: 3000, daCat: true, diem: 0.8 },
    { duong: "server/routers.ts", byteTrenDia: 500, kyTuVaoPrompt: 500, daCat: false, diem: 0.7 },
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
