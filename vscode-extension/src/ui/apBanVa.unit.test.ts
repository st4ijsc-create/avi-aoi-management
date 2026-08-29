/**
 * ★★★ LƯỚI CHO ĐIỂM GHI ĐĨA DUY NHẤT (`ui/apBanVa.ts`) — THỨ TỰ BẤT BIẾN + BA LỜI KHAI HỢP LỆ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỆP NÀY TỪNG **KHÔNG THỂ TỒN TẠI** (I-3, 2026-08-29)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bất biến quan trọng nhất của Đợt C là THỨ TỰ các bước bên trong điểm ghi (hàng rào → đọc đĩa →
 * băm → mở sổ kiểm toán → ghi → chốt sổ). Trước bản vá I-3, census đếm số lần xuất hiện của tên
 * API chỉnh-sửa trên MỌI tệp `.ts` dưới `src/` **kể cả tệp lưới** — nên bất kỳ lưới nào giả lập
 * API ấy đều đẩy phép đếm lên 2 và làm census đỏ. Kết quả: bất biến ấy chỉ còn được canh bởi một
 * script nằm NGOÀI repo, không ai chạy lại được. Census nay loại tệp lưới khỏi ĐÚNG phép đếm đó
 * (và chỉ phép đếm đó), kèm một ca canh điều kiện làm cho loại trừ ấy an toàn.
 *
 * ⚠ "ĐĨA" ở đây là một chuỗi trong bộ nhớ, KHÔNG phải hệ tệp thật: `CAM_TU` của census cấm mọi tệp
 *   (kể cả lưới) gọi API ghi tệp của `fs`. Bù lại, `save()` giả mô phỏng đúng ngữ nghĩa cần đo:
 *   nó đẩy BỘ ĐỆM xuống ĐĨA, và khi nó thất bại thì bộ đệm GIỮ NGUYÊN nội dung chưa lưu — chính là
 *   trạng thái sinh ra lỗ C-1.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

/** Máy trạng thái dùng chung cho mọi bản giả. `vi.hoisted` để nó có mặt TRƯỚC khi mock chạy. */
const may = vi.hoisted(() => ({
  /** Nhật ký THỨ TỰ thao tác — trục chính của lưới này. */
  nhatKy: [] as string[],
  /** Nội dung "trên đĩa". */
  dia: "",
  /** Nội dung trong bộ đệm editor. */
  boDem: "",
  version: 1,
  ban: false,
  /** Lời gọi ghi trả về gì (VSCode có quyền nói thẳng "tôi không áp"). */
  apTraVe: true,
  /** Kết quả của TỪNG lượt áp theo thứ tự; hết danh sách ⇒ rơi về `apTraVe`. */
  ketQuaAp: [] as boolean[],
  /** Kết quả của từng lượt `save()` theo thứ tự; hết danh sách ⇒ mặc định thành công. */
  ketQuaSave: [] as boolean[],
  /** `save()` BÁO HỎNG nhưng byte vẫn kịp xuống đĩa — ca "lời gọi nói dối, đĩa nói thật". */
  saveBaoHongNhungVanDay: false,
  /**
   * ★★★ F1 — `save()` BÁO THÀNH CÔNG nhưng ngay sau đó một thứ khác đặt lại nội dung này lên đĩa
   * (git checkout, tiến trình build, extension khác). `undefined` ⇒ không có ai đụng vào.
   */
  doiDiaSauKhiLuu: undefined as string | undefined,
  /** Ép lượt đọc đĩa ném lỗi. */
  docDiaNem: false,
  /** Ép lượt đọc đĩa THỨ N (đếm từ 1) ném lỗi — để bắt riêng lượt ĐỌC LẠI của bước 8. */
  docDiaNemOLuot: undefined as number | undefined,
  /** Ép lượt mở sổ kiểm toán ném lỗi. */
  batDauNem: false,
  /** Mô phỏng "có thứ khác đổi tệp TRONG LÚC gọi mạng" — gán nội dung đĩa mới khi mở sổ. */
  doiDiaKhiBatDau: undefined as string | undefined,
  /** Mô phỏng "bộ đệm bị chạm TRONG LÚC gọi mạng". */
  doiVersionKhiBatDau: false,
  batDau: [] as Array<Record<string, unknown>>,
  chot: [] as Array<Record<string, unknown>>,
  /** Đáp ứng của lượt chốt sổ — máy chủ có quyền TỪ CHỐI qua HTTP 200 (`ok:false`), không ném. */
  chotTraVe: { ok: true } as { ok: boolean; message?: string },
}));

vi.mock("vscode", () => {
  class Range {
    constructor(
      public a: number,
      public b: number,
      public c: number,
      public d: number,
    ) {}
  }
  class WorkspaceEdit {
    public datLai: string[] = [];
    replace(_uri: unknown, _pv: unknown, noiDung: string): void {
      this.datLai.push(noiDung);
    }
  }
  const taiLieu = {
    get isDirty(): boolean {
      return may.ban;
    },
    get version(): number {
      return may.version;
    },
    get lineCount(): number {
      return may.boDem.split("\n").length;
    },
    validateRange: (r: unknown) => r,
    save: async (): Promise<boolean> => {
      may.nhatKy.push("save");
      const kq = may.ketQuaSave.length > 0 ? (may.ketQuaSave.shift() as boolean) : true;
      if (kq || may.saveBaoHongNhungVanDay) {
        may.dia = may.boDem;
        may.ban = false;
      }
      // ★★★ F1 — CỬA SỔ SAU LƯỢT LƯU. `save()` trả `true` KHÔNG có nghĩa byte còn nằm đó lúc ta
      // đọc lại: giữa hai mốc ấy vẫn có thời gian cho một `git checkout`/build/extension khác.
      if (kq && may.doiDiaSauKhiLuu !== undefined) may.dia = may.doiDiaSauKhiLuu;
      return kq;
    },
  };
  return {
    Uri: { file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }) },
    Range,
    WorkspaceEdit,
    workspace: {
      fs: {
        readFile: async (): Promise<Buffer> => {
          may.nhatKy.push("docDia");
          const luot = may.nhatKy.filter((x) => x === "docDia").length;
          if (may.docDiaNem || may.docDiaNemOLuot === luot) throw new Error("đĩa giả: không đọc được");
          return Buffer.from(may.dia, "utf8");
        },
      },
      openTextDocument: async () => {
        may.nhatKy.push("moTaiLieu");
        return taiLieu;
      },
      applyEdit: async (e: WorkspaceEdit): Promise<boolean> => {
        may.nhatKy.push("apChinhSua");
        const cho = may.ketQuaAp.length > 0 ? (may.ketQuaAp.shift() as boolean) : may.apTraVe;
        if (!cho) return false;
        may.boDem = e.datLai[e.datLai.length - 1] ?? may.boDem;
        may.version += 1;
        may.ban = may.boDem !== may.dia;
        return true;
      },
    },
  };
});

vi.mock("../mang/duyetGhi", () => ({
  goiBatDauApClient: async (_u: string, _c: string, dv: Record<string, unknown>) => {
    may.nhatKy.push("batDauApClient");
    may.batDau.push(dv);
    // ⚠ Đây là CỬA SỔ TOCTOU thật: một lượt đi-về mạng. Mô phỏng đúng thứ có thể rơi vào đó.
    if (may.doiDiaKhiBatDau !== undefined) may.dia = may.doiDiaKhiBatDau;
    if (may.doiVersionKhiBatDau) may.version += 1;
    if (may.batDauNem) throw new Error("mạng giả: không mở được sổ");
    return { actionId: "ACT-1", token: "TOK-1" };
  },
  goiChotApClient: async (_u: string, _c: string, dv: Record<string, unknown>) => {
    may.nhatKy.push("chotApClient");
    may.chot.push(dv);
    // ⚠ F6 — máy chủ TỪ CHỐI qua HTTP 200 (token lệch, hàng không ở `dang_ap_client`): `ok:false`
    // KHÔNG kèm ném. Bản giả phải nói được điều đó, nếu không lưới sẽ mù đúng ca cần đo.
    return may.chotTraVe;
  },
}));

// `giaiDuongThat` chạm hệ tệp THẬT (`realpath`/`lstat`) — thay bằng bản đồng nhất CÓ GHI NHẬT KÝ,
// để bước 1 vẫn quan sát được trong thứ tự mà không cần dựng cây thư mục thật.
vi.mock("../loi/duongThat", () => ({
  giaiDuongThat: (d: string) => {
    may.nhatKy.push("giaiDuongThat");
    return { ok: true, duong: d };
  },
}));

// Vị từ chặn và hàm băm giữ NGUYÊN cài đặt thật — chỉ bọc thêm một dòng ghi nhật ký. Thay chúng
// bằng bản giả sẽ biến lưới thứ tự này thành lưới đo chính bản giả.
vi.mock("../loi/chanGhi", async (goc) => {
  const that = await goc<typeof import("../loi/chanGhi")>();
  return {
    ...that,
    duocPhepGhi: (d: string, ws: string[]) => {
      may.nhatKy.push("duocPhepGhi");
      return that.duocPhepGhi(d, ws);
    },
  };
});

vi.mock("../loi/bamTep", async (goc) => {
  const that = await goc<typeof import("../loi/bamTep")>();
  return {
    ...that,
    bamNoiDung: (s: string) => {
      may.nhatKy.push("bamNoiDung");
      return that.bamNoiDung(s);
    },
  };
});

import { apBanVa } from "./apBanVa";

const GOC_ND = "dong 1\ndong 2\ndong 3\n";
const MOI_ND = "dong 1\nDONG 2 DA SUA\ndong 3\n";

function bam(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function dauVao(ghiDe: Partial<Parameters<typeof apBanVa>[0]> = {}): Parameters<typeof apBanVa>[0] {
  return {
    deXuat: { loai: "toanVan", path: "a.ts", modified: MOI_ND },
    duongTuyetDoi: "C:\\ws\\a.ts",
    duongTuongDoi: "a.ts",
    bamGoc: bam(GOC_ND),
    thuMucWorkspace: ["C:\\ws"],
    nhanWorkspace: "C:\\ws",
    serverUrl: "http://may-chu-gia",
    cookie: "cookie-gia",
    ...ghiDe,
  };
}

function demTrongNhatKy(t: string): number {
  return may.nhatKy.filter((x) => x === t).length;
}

beforeEach(() => {
  may.nhatKy = [];
  may.dia = GOC_ND;
  may.boDem = GOC_ND;
  may.version = 1;
  may.ban = false;
  may.apTraVe = true;
  may.ketQuaAp = [];
  may.ketQuaSave = [];
  may.saveBaoHongNhungVanDay = false;
  may.doiDiaSauKhiLuu = undefined;
  may.docDiaNem = false;
  may.docDiaNemOLuot = undefined;
  may.batDauNem = false;
  may.doiDiaKhiBatDau = undefined;
  may.doiVersionKhiBatDau = false;
  may.batDau = [];
  may.chot = [];
  may.chotTraVe = { ok: true };
});

describe("apBanVa — THỨ TỰ BẤT BIẾN", () => {
  it("★★★ đường THÀNH CÔNG đi ĐÚNG thứ tự: hàng rào → đọc đĩa → băm → MỞ SỔ → ghi → chốt sổ", async () => {
    /**
     * ★★★ ĐÂY LÀ CA PHẢI ĐỎ NẾU AI ĐẢO THỨ TỰ. Mỗi cặp liền kề trong `MOC` là một bất biến có
     * hậu quả riêng, và hai cặp quan trọng nhất là:
     *   · `bamNoiDung` TRƯỚC `batDauApClient` — băm khai lên sổ phải là băm ĐO ĐƯỢC, không phải
     *     một con số dựng sau khi sổ đã mở;
     *   · `batDauApClient` TRƯỚC `apChinhSua` — sổ ghi TRƯỚC khi byte rơi. Đảo lại là mở đúng lỗ
     *     "sập giữa chừng ⇒ byte đã đổi mà không có vết", tức sổ nói dối theo hướng che giấu.
     */
    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(true);
    expect(may.dia).toBe(MOI_ND);

    const MOC = [
      "giaiDuongThat",
      "duocPhepGhi",
      "docDia",
      "bamNoiDung",
      "batDauApClient",
      "apChinhSua",
      "save",
      "chotApClient",
    ];
    const viTri = (t: string) => may.nhatKy.indexOf(t);
    // Không mốc nào được VẮNG MẶT — thiếu một bước cũng nguy hiểm ngang đảo thứ tự, và `sort` với
    // một chỉ số `-1` sẽ âm thầm xếp nó lên đầu rồi khai XANH nếu không chặn ở đây.
    for (const m of MOC) expect(viTri(m), `mốc "${m}" phải xuất hiện`).toBeGreaterThanOrEqual(0);
    const theoLanDauXuatHien = MOC.slice().sort((a, b) => viTri(a) - viTri(b));
    expect(theoLanDauXuatHien).toEqual(MOC);
  });

  it("★★★ ĐÚNG MỘT lượt ghi cho một lượt áp thành công (không ghi hai lần vì bất kỳ lý do gì)", async () => {
    await apBanVa(dauVao());
    expect(demTrongNhatKy("apChinhSua")).toBe(1);
    expect(demTrongNhatKy("save")).toBe(1);
    expect(demTrongNhatKy("chotApClient")).toBe(1);
  });

  it("★★★ sổ kiểm toán nhận băm TRƯỚC = băm ĐĨA và băm SAU THẬT = băm đo lại sau khi ghi", async () => {
    await apBanVa(dauVao());
    expect(may.batDau[0]).toMatchObject({ path: "a.ts", sha256Truoc: bam(GOC_ND), sha256Sau: bam(MOI_ND) });
    expect(may.chot[0]).toMatchObject({ thanhCong: true, sha256SauThat: bam(MOI_ND) });
  });

  it("★★★ BĂM LỆCH ⇒ KHÔNG mở sổ VÀ KHÔNG ghi — hai thứ cùng vắng, không phải một", async () => {
    // Nếu chỉ vắng lượt ghi mà sổ vẫn mở, máy chủ có một hàng `dang_ap_client` vĩnh viễn cho một
    // lượt chưa bao giờ bắt đầu — sổ tự bẩn. Nếu chỉ vắng sổ mà vẫn ghi, đó là ghi không vết.
    const kq = await apBanVa(dauVao({ bamGoc: bam("mot noi dung KHAC han\n") }));

    expect(kq.ok).toBe(false);
    expect(may.nhatKy).not.toContain("batDauApClient");
    expect(may.nhatKy).not.toContain("apChinhSua");
    expect(may.dia).toBe(GOC_ND);
    expect(kq.thongDiep).toContain("KHÔNG GHI");
  });

  it("★★★ ĐƯỜNG BỊ CHẶN (.git/hooks) ⇒ dừng TRƯỚC cả lượt đọc đĩa — không đọc, không sổ, không ghi", async () => {
    const kq = await apBanVa(dauVao({ duongTuyetDoi: "C:\\ws\\.git\\hooks\\pre-commit", duongTuongDoi: ".git/hooks/pre-commit" }));

    expect(kq.ok).toBe(false);
    expect(may.nhatKy).not.toContain("docDia");
    expect(may.nhatKy).not.toContain("batDauApClient");
    expect(may.nhatKy).not.toContain("apChinhSua");
  });

  it("★★★ MỞ SỔ HỎNG ⇒ tuyệt đối KHÔNG ghi (thà không ghi còn hơn ghi mà không có vết)", async () => {
    may.batDauNem = true;
    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    expect(may.nhatKy).not.toContain("apChinhSua");
    expect(may.dia).toBe(GOC_ND);
  });
});

describe("apBanVa — C-1: `save()` hỏng SAU khi áp chỉnh sửa", () => {
  it("★★★ đĩa được HOÀN NGUYÊN và sổ chỉ khai 'thất bại' SAU KHI hoàn nguyên đo được", async () => {
    /**
     * ★★★ CA GỐC CỦA C-1. Bản cũ: áp xong, `save()` hỏng ⇒ chốt thẳng `thanhCong:false` + báo
     * "GHI THẤT BẠI", trong khi nội dung của AI đang nằm trong bộ đệm ở dạng CHƯA LƯU. Với
     * `files.autoSave` bật (mặc định của rất nhiều người) hoặc chỉ một cú Ctrl+S sau đó, byte ấy
     * rơi xuống đĩa trong khi sổ đã đóng lại là "không có gì xảy ra".
     */
    may.ketQuaSave = [false, true]; // lượt lưu của bản vá HỎNG, lượt lưu của bản hoàn nguyên OK
    may.apTraVe = true;
    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    // (1) ĐĨA nguyên vẹn — và bộ đệm KHÔNG còn giữ nội dung của AI.
    expect(may.dia).toBe(GOC_ND);
    expect(may.boDem).toBe(GOC_ND);
    expect(may.ban).toBe(false);
    // (2) Hoàn nguyên đi qua ĐÚNG điểm ghi ấy (hai lượt áp, không phải một đường ghi thứ hai).
    expect(demTrongNhatKy("apChinhSua")).toBe(2);
    // (3) Chỉ tới lúc này lời khai "không ghi gì" mới ĐÚNG, nên sổ mới được chốt `thanhCong:false`.
    expect(may.chot).toHaveLength(1);
    expect(may.chot[0]).toMatchObject({ thanhCong: false });
    expect(kq.thongDiep).toContain("HOÀN NGUYÊN");
  });

  it("★★★ HOÀN NGUYÊN CŨNG HỎNG ⇒ KHÔNG chốt sổ, và nói thẳng bộ đệm có thể còn nội dung CHƯA LƯU", async () => {
    /**
     * ★★★ ĐÂY LÀ CA MÀ MỘT LỜI KHAI "THẤT BẠI SẠCH SẼ" LÀ NÓI DỐI. Không đo được rằng không có
     * byte nào của AI còn sống ⇒ câu trung thực duy nhất là CHƯA RÕ, và trạng thái trung thực duy
     * nhất của sổ là để hàng đứng ở `dang_ap_client`.
     */
    may.ketQuaSave = [false]; // lượt lưu bản vá HỎNG
    may.ketQuaAp = [true, false]; // và VSCode TỪ CHỐI luôn lượt áp bản hoàn nguyên
    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    // ★★★ SỔ KHÔNG ĐƯỢC CHỐT. `thanhCong:false` ⇒ `ap_client_that_bai` = "đã thử, 0 byte" — sai.
    expect(may.chot).toHaveLength(0);
    // Sự thật đang được khai: đĩa chưa đổi NHƯNG bộ đệm vẫn giữ nội dung của AI, chưa lưu.
    expect(may.dia).toBe(GOC_ND);
    expect(may.boDem).toBe(MOI_ND);
    expect(may.ban).toBe(true);
    expect(kq.thongDiep).toContain("CHƯA RÕ");
    expect(kq.thongDiep).toContain("CHƯA LƯU");
    expect(kq.thongDiep).toContain("autoSave");
    expect(kq.thongDiep).not.toContain("GHI THẤT BẠI");
  });

  it("★★★ VSCode TỪ CHỐI áp (trả false) ⇒ bộ đệm không đổi ⇒ chốt `thanhCong:false`, KHÔNG hoàn nguyên thừa", async () => {
    may.apTraVe = false;
    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    expect(demTrongNhatKy("apChinhSua")).toBe(1); // không có lượt hoàn nguyên: chẳng có gì để hoàn
    expect(may.chot).toHaveLength(1);
    expect(may.chot[0]).toMatchObject({ thanhCong: false });
    expect(may.dia).toBe(GOC_ND);
    expect(may.boDem).toBe(GOC_ND);
  });

  it("★★★ `save()` BÁO HỎNG nhưng đĩa lại mang đúng bản mới ⇒ khai ĐÃ GHI — đọc kết cục, không đọc lời gọi", async () => {
    /**
     * ★★ Mặt ĐỐI XỨNG của C-1, và cùng một nguyên tắc. Ở ca trên, khai "đã ghi" là nói dối; ở ca
     * này, khai "thất bại" mới là nói dối — và vẫn theo hướng CHE GIẤU (sổ nói 0 byte trong khi
     * đĩa đã đổi). Chỉ có một cách phân biệt hai ca: ĐỌC LẠI ĐĨA rồi mới nói.
     */
    may.ketQuaSave = [false];
    may.saveBaoHongNhungVanDay = true;

    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(true);
    expect(may.dia).toBe(MOI_ND);
    expect(demTrongNhatKy("apChinhSua")).toBe(1); // KHÔNG hoàn nguyên một lượt ghi đã thành công
    expect(may.chot).toHaveLength(1);
    expect(may.chot[0]).toMatchObject({ thanhCong: true, sha256SauThat: bam(MOI_ND) });
    expect(kq.thongDiep).toContain("ĐÃ GHI");
  });
});

/**
 * ★★★ F1 (2026-08-30) — ĐƯỜNG THÀNH CÔNG PHẢI **ĐỌC KẾT CỤC** TRƯỚC KHI KHAI KẾT CỤC.
 *
 * Bản trước: `save()` trả `true` ⇒ đọc lại đĩa ⇒ chốt `thanhCong:true` + "Đã ghi" **bất kể băm đọc
 * lại là gì**, kể cả khi lượt đọc lại NÉM. Luật của chính tệp ấy ("ĐÃ GHI — băm khớp bản mới")
 * được cưỡng chế ở nhánh HỎNG và bỏ quên ở nhánh THÀNH CÔNG — bản vá khai một luật mà nó chỉ cài
 * ở MỘT PHÍA. Ba ca dưới đây khoá cả ba kết cục thật, mỗi ca đo CẢ lời khai LẪN trạng thái sổ.
 */
describe("apBanVa — F1: ba kết cục của đường THÀNH CÔNG", () => {
  it("★★★ (1) KHỚP bản mới ⇒ 'Đã ghi' + sổ chốt `thanhCong:true` kèm băm ĐO ĐƯỢC", async () => {
    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(true);
    expect(kq.thongDiep).toContain("Đã ghi vào workspace");
    expect(kq.thongDiep).not.toContain("CHƯA RÕ");
    expect(may.chot).toHaveLength(1);
    expect(may.chot[0]).toMatchObject({ thanhCong: true, sha256SauThat: bam(MOI_ND) });
  });

  it("★★★ (2) ĐĨA VẪN MANG BẢN GỐC sau lượt lưu ⇒ KHÔNG khai 'đã ghi', KHÔNG chốt sổ", async () => {
    /**
     * ★★★ CA GỐC CỦA F1(b). `save()` báo xong rồi một thứ khác trả tệp về bản cũ. Bản trước chốt
     * `thanhCong:true` với `sha256SauThat === sha256Truoc` — HAI Ô MÂU THUẪN trong một hàng
     * (`da_ap_client` mà băm sau = băm trước), giao diện nói "Đã ghi", và cảnh báo lệch băm còn
     * quy sai nguyên nhân cho bộ định dạng của editor.
     * ⚠ Và cũng KHÔNG được chốt `thanhCong:false`: `ap_client_that_bai` đọc là "đã thử và 0 byte
     *   rơi" — ta chỉ đo được trạng thái đĩa LÚC NÀY, không đo được byte đã từng rơi hay chưa.
     */
    may.doiDiaSauKhiLuu = GOC_ND;

    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toContain("CHƯA RÕ");
    expect(kq.thongDiep).toContain("KHÔNG CÓ HIỆU LỰC");
    expect(kq.thongDiep).not.toContain("Đã ghi vào workspace");
    // ★★★ SỔ KHÔNG ĐƯỢC CHỐT — cả hai giá trị chung cuộc đều là khai điều mình không đo được.
    expect(may.chot).toHaveLength(0);
    expect(may.dia).toBe(GOC_ND);
  });

  it("★★★ (3) KHÔNG ĐỌC LẠI ĐƯỢC ĐĨA ⇒ khai CHƯA RÕ, KHÔNG chốt sổ (bản cũ chốt `da_ap_client` với băm rỗng)", async () => {
    // Lượt đọc đĩa thứ BA là lượt đọc lại ở bước 8 (1: bước 3 · 2: bước 6b · 3: bước 8).
    may.docDiaNemOLuot = 3;

    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toContain("CHƯA RÕ");
    expect(kq.thongDiep).not.toContain("Đã ghi vào workspace");
    expect(may.chot).toHaveLength(0);
    // Byte THẬT SỰ đã vào đĩa ở bản giả này — nhưng ta KHÔNG đọc được nên KHÔNG được khai.
    expect(may.dia).toBe(MOI_ND);
  });

  it("★★★ (4) ĐĨA MANG BẢN THỨ BA (editor định dạng lúc lưu) ⇒ VẪN là 'đã ghi', băm khai là băm ĐO ĐƯỢC", async () => {
    // Đây là ca PHẢI KHÔNG bị bản vá F1 nuốt nhầm: đĩa không còn mang bản gốc ⇒ byte ĐÃ đổi.
    const SAU_DINH_DANG = "dong 1\nDONG 2 DA SUA;\ndong 3\n";
    may.doiDiaSauKhiLuu = SAU_DINH_DANG;

    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(true);
    expect(kq.thongDiep).toContain("Đã ghi vào workspace");
    expect(kq.thongDiep).toContain("KHÁC bản đã xem trước");
    expect(may.chot).toHaveLength(1);
    expect(may.chot[0]).toMatchObject({ thanhCong: true, sha256SauThat: bam(SAU_DINH_DANG) });
  });
});

/**
 * ★★★ F6 (2026-08-30) — `chot.ok` PHẢI ĐƯỢC ĐỌC Ở CẢ BỐN LƯỢT CHỐT.
 *
 * Máy chủ từ chối chốt qua **HTTP 200** (`{ok:false}` — token lệch, chủ sở hữu lệch, hàng không ở
 * `dang_ap_client`) và `goiChotApClient` KHÔNG ném cho các ca đó. Bỏ qua trường ấy ⇒ hàng đứng ở
 * `dang_ap_client` vĩnh viễn trong khi giao diện không nói một chữ nào.
 */
describe("apBanVa — F6: máy chủ TỪ CHỐI chốt sổ qua HTTP 200", () => {
  it("★★★ lượt chốt của BƯỚC 6b (dừng trước khi ghi) — phải NÓI RA khi bị từ chối", async () => {
    may.doiDiaKhiBatDau = "NGUOI DUNG VUA SUA TAY\ndong 2\ndong 3\n";
    may.chotTraVe = { ok: false, message: "Token hoặc người dùng không khớp." };

    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toContain("TỪ CHỐI chốt sổ kiểm toán");
    expect(kq.thongDiep).toContain("Token hoặc người dùng không khớp.");
    expect(kq.thongDiep).toContain("CHƯA RÕ");
  });

  it("★★★ lượt chốt của BƯỚC 9 (ghi hỏng, đã hoàn nguyên) — phải NÓI RA khi bị từ chối", async () => {
    may.ketQuaSave = [false, true];
    may.chotTraVe = { ok: false, message: "Trạng thái không hợp lệ: da_ap_client." };

    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toContain("TỪ CHỐI chốt sổ kiểm toán");
    expect(kq.thongDiep).toContain("Trạng thái không hợp lệ: da_ap_client.");
  });

  it("★★ lượt chốt của BƯỚC 8 (đường thành công) — đã đọc `ok` từ trước, giữ nguyên", async () => {
    may.chotTraVe = { ok: false, message: "Action không tồn tại." };

    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(true);
    expect(kq.thongDiep).toContain("Máy chủ từ chối chốt sổ kiểm toán");
  });
});

describe("apBanVa — I-4: cửa sổ TOCTOU do chính lượt gọi kiểm toán mở ra", () => {
  it("★★★ ĐĨA đổi TRONG LÚC mở sổ ⇒ DỪNG trước lượt ghi, KHÔNG ghi đè thay đổi vừa rồi", async () => {
    /**
     * ★★★ CA GỐC CỦA I-4. Băm được đo ở bước 4; lượt ghi xảy ra ở bước 7, **sau một vòng mạng**.
     * Bất cứ thứ gì rơi vào cửa sổ đó (`git checkout`, `formatOnSave`, chính người dùng gõ phím)
     * đều bị lượt ghi xoá sạch, và `sha256Truoc` vừa khai lên sổ trở thành một con số SAI.
     */
    const NGUOI_DUNG_SUA = "NGUOI DUNG VUA SUA TAY\ndong 2\ndong 3\n";
    may.doiDiaKhiBatDau = NGUOI_DUNG_SUA;

    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    expect(may.nhatKy).not.toContain("apChinhSua");
    expect(may.dia).toBe(NGUOI_DUNG_SUA); // thay đổi của người dùng CÒN NGUYÊN
    expect(kq.thongDiep).toContain("KHÔNG GHI");
    // Sổ đã mở nên PHẢI chốt — và ở đây "không byte nào rơi" là điều ĐO ĐƯỢC, nên `false` là đúng.
    expect(may.chot).toHaveLength(1);
    expect(may.chot[0]).toMatchObject({ thanhCong: false });
    expect(String(may.chot[0].loi)).toContain("DỪNG TRƯỚC KHI GHI");
  });

  it("★★★ BỘ ĐỆM bị chạm TRONG LÚC mở sổ (version tăng) ⇒ DỪNG, kể cả khi đĩa chưa đổi", async () => {
    // Băm chỉ nói về ĐĨA. Một lượt gõ phím chưa lưu không đổi băm nào — nhưng lượt ghi sẽ nuốt nó.
    may.doiVersionKhiBatDau = true;

    const kq = await apBanVa(dauVao());

    expect(kq.ok).toBe(false);
    expect(may.nhatKy).not.toContain("apChinhSua");
    expect(may.dia).toBe(GOC_ND);
    expect(may.chot).toHaveLength(1);
    expect(may.chot[0]).toMatchObject({ thanhCong: false });
  });
});
