/**
 * ★★★ LƯỚI CHO LỚP CHẠM `vscode`/ĐĨA CỦA BA TOOL ĐỌC — NƠI TẬP QUÉT ĐƯỢC DỰNG RA.
 *
 * Lớp thuần (`loi/docCucBo.unit.test.ts`) đã đo lọc/cắt/che trên đầu vào dựng sẵn. Tệp này đo cái
 * mà lớp thuần KHÔNG thấy được: **tập quét đến từ đâu**, và liệu `findFiles` + đường symlink có mở
 * ra một đường vòng quanh hàng rào hay không.
 *
 * ⚠⚠ VÌ SAO PHẢI DÙNG HỆ TỆP ẢO (`vi.mock("node:fs")`) THAY VÌ THƯ MỤC TẠM THẬT:
 * census (`loi/census.unit.test.ts`, mảng `CAM_TU`) cấm **mọi tệp — kể cả tệp lưới** — gọi API ghi
 * đĩa của `fs`. Một lưới dựng workspace thử trên đĩa thật buộc phải ghi tệp, tức phải nới census.
 * Nới census để viết một lưới là đánh đổi sai chiều: census canh bất biến "Đợt D không mở đường
 * ghi nào", còn lưới này chỉ cần một hệ tệp *hành xử đúng*. Phép đo trên ĐĨA THẬT được làm bằng
 * một script chạy NGOÀI repo (xem báo cáo Task 2) — nơi việc ghi tệp không đụng vào bất biến nào.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { join, sep } from "node:path";

const WS = process.platform === "win32" ? "C:\\ws" : "/ws";
const NGOAI = process.platform === "win32" ? "C:\\ngoai" : "/ngoai";

const MAT_KHAU = "sieu-mat-khau-cua-toi";
const KHOA = "sk-KHONG-PHAI-KHOA-THAT-0000000000";

/** Hệ tệp ảo dùng chung cho mọi bản giả. `vi.hoisted` để nó có mặt TRƯỚC khi mock chạy. */
const may = vi.hoisted(() => ({
  /** đường tuyệt đối → nội dung. */
  tep: new Map<string, string>(),
  /** đường tuyệt đối → đường THẬT (mô phỏng symlink). */
  lienKet: new Map<string, string>(),
  /** Sổ ghi MỌI lượt mở tệp — trục chính: tệp cấm có bị MỞ RA không. */
  daDoc: [] as string[],
}));

vi.mock("node:fs", () => {
  const that = (p: string): string => may.lienKet.get(p) ?? p;
  /** Thư mục = mọi tổ tiên của một tệp. Hệ tệp ảo không lưu thư mục riêng. */
  const laThuMuc = (p: string): boolean => [...may.tep.keys()].some((t) => t.startsWith(p + sep));
  return {
    existsSync: (p: string) => may.tep.has(that(p)) || laThuMuc(that(p)),
    realpathSync: (p: string) => {
      const t = that(p);
      if (may.tep.has(t) || laThuMuc(t)) return t;
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    },
    lstatSync: () => ({ isSymbolicLink: () => false }),
    statSync: (p: string) => {
      const t = that(p);
      const noiDung = may.tep.get(t);
      if (noiDung === undefined) {
        return laThuMuc(t) ? { size: 0, isDirectory: () => true } : undefined;
      }
      return { size: Buffer.byteLength(noiDung, "utf8"), isDirectory: () => false };
    },
    readFileSync: (p: string) => {
      may.daDoc.push(that(p));
      const noiDung = may.tep.get(that(p));
      if (noiDung === undefined) throw new Error("ENOENT");
      return Buffer.from(noiDung, "utf8");
    },
  };
});

vi.mock("vscode", () => {
  class Uri {
    private constructor(public readonly fsPath: string) {}
    static file(p: string): Uri {
      return new Uri(p);
    }
  }
  class RelativePattern {
    constructor(
      public readonly base: { fsPath: string },
      public readonly pattern: string,
    ) {}
  }
  return {
    Uri,
    RelativePattern,
    workspace: {
      findFiles: async (mau: RelativePattern, _loaiTru: string, tran: number) => {
        const goc = mau.base.fsPath;
        return [...may.tep.keys()]
          .filter((p) => p.startsWith(goc + sep))
          .slice(0, tran)
          .map((p) => Uri.file(p));
      },
    },
  };
});

const { chayToolCucBo } = await import("./toolCucBo");

beforeEach(() => {
  may.tep.clear();
  may.lienKet.clear();
  may.daDoc = [];

  may.tep.set(join(WS, "src", "Calculator.cs"), "public class Calculator {\n  // DATABASE_URL tu cau hinh\n}");
  may.tep.set(
    join(WS, "src", "config.ts"),
    `export const khoa = "${KHOA}";\nexport const noi = "postgres://nguoidung:${MAT_KHAU}@10.0.0.7:5432/db";\n// DATABASE_URL`,
  );
  may.tep.set(join(WS, ".env"), `DATABASE_URL=postgres://nguoidung:${MAT_KHAU}@10.0.0.7:5432/db\nGHI_CHU_NOI_BO=DATABASE_URL`);
  may.tep.set(join(WS, "keys", "id_rsa"), "-----BEGIN OPENSSH PRIVATE KEY-----\nDATABASE_URL\n-----END OPENSSH PRIVATE KEY-----");
});

describe("chayToolCucBo — grep KHÔNG mở và KHÔNG trả nội dung tệp cấm", () => {
  it("★★★ KẾT CỤC: chuỗi bí mật trong `.env` không rời máy — và tệp ấy KHÔNG hề được mở ra", async () => {
    const kq = await chayToolCucBo({ loai: "grep", mau: "DATABASE_URL" }, [WS]);

    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.ketQua).not.toContain(MAT_KHAU);
    expect(kq.ketQua).not.toContain("GHI_CHU_NOI_BO");
    expect(kq.ketQua).not.toContain(".env");
    // Tầng (a): không tệp cấm nào lọt vào sổ MỞ TỆP.
    expect(may.daDoc.some((p) => p.endsWith(".env"))).toBe(false);
    expect(may.daDoc.some((p) => p.includes("id_rsa"))).toBe(false);
    // ⚠ CHỐNG TỰ THOẢ: kết quả hợp lệ vẫn có mặt.
    expect(kq.ketQua).toContain("Calculator.cs");
  });

  it("★★★ khoá hardcode trong tệp HỢP LỆ vẫn bị che", async () => {
    const kq = await chayToolCucBo({ loai: "grep", mau: "sk-" }, [WS]);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.ketQua).toContain("config.ts");
    expect(kq.ketQua).not.toContain(KHOA);
    expect(kq.ketQua).toContain("«đã che»");
  });
});

describe("chayToolCucBo — doc_tep / liet_ke", () => {
  it("★★★ `doc_tep` trên `.env` bị TỪ CHỐI, kèm lý do", async () => {
    const kq = await chayToolCucBo({ loai: "doc_tep", path: ".env" }, [WS]);
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.lyDo.length).toBeGreaterThan(10);
    expect(may.daDoc).toEqual([]);
  });

  it("★★★ `doc_tep` trên tệp hợp lệ: đọc được, và khoá bên trong bị che", async () => {
    const kq = await chayToolCucBo({ loai: "doc_tep", path: "src/config.ts" }, [WS]);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.ketQua).toContain("export const khoa");
    expect(kq.ketQua).not.toContain(KHOA);
    expect(kq.ketQua).not.toContain(MAT_KHAU);
  });

  it("★★★ `liet_ke` loại `.env` và khoá riêng khỏi danh sách", async () => {
    const kq = await chayToolCucBo({ loai: "liet_ke", path: WS }, [WS]);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.ketQua).not.toContain(".env");
    expect(kq.ketQua).not.toContain("id_rsa");
    expect(kq.ketQua).toContain("src/Calculator.cs");
    // ★★★ Bỏ tệp mà KHÔNG khai là đưa model một danh sách trông như ĐẦY ĐỦ — nó sẽ kết luận "dự
    //     án không có tệp cấu hình bí mật". Lời khai phải sống sót qua CẢ HAI lớp lọc.
    expect(kq.ketQua).toContain("đã loại 2");
  });
});

describe("chayToolCucBo — hàng rào đường dẫn", () => {
  it("★★★ SYMLINK trong workspace trỏ RA NGOÀI bị chặn (chuỗi thì trong, tệp THẬT thì không)", async () => {
    const lienKet = join(WS, "ghichu.txt");
    const dich = join(NGOAI, "bi-mat.txt");
    may.tep.set(dich, `DATABASE_URL=postgres://nguoidung:${MAT_KHAU}@h/db`);
    may.lienKet.set(lienKet, dich);

    const kq = await chayToolCucBo({ loai: "doc_tep", path: "ghichu.txt" }, [WS]);
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.lyDo).toContain("ngoài");
    expect(may.daDoc).toEqual([]);
  });

  it("★★★ NHÁNH KIA của symlink: `grep` cũng không được đi vòng qua liên kết ra ngoài", async () => {
    const lienKet = join(WS, "src", "ghichu.txt");
    const dich = join(NGOAI, "bi-mat.txt");
    may.tep.set(lienKet, "cho findFiles thay duong nay");
    may.tep.set(dich, `DATABASE_URL=${MAT_KHAU}`);
    may.lienKet.set(lienKet, dich);

    const kq = await chayToolCucBo({ loai: "grep", mau: "DATABASE_URL" }, [WS]);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.ketQua).not.toContain(MAT_KHAU);
    expect(may.daDoc).not.toContain(dich);
    // ⚠ CHỐNG TỰ THOẢ: một lượt grep trả rỗng cũng thoả hai khẳng định trên mà không chứng minh gì.
    expect(kq.ketQua).toContain("Calculator.cs");
  });

  it("★★ đường ra ngoài workspace ⇒ từ chối", async () => {
    may.tep.set(join(NGOAI, "x.ts"), "int a;");
    const kq = await chayToolCucBo({ loai: "doc_tep", path: join(NGOAI, "x.ts") }, [WS]);
    expect(kq.ok).toBe(false);
  });

  it("★★★ `lyDo` dựng ở lớp này cũng RỜI MÁY ⇒ phải qua cửa chót che bí mật", async () => {
    /**
     * Các câu từ chối ở `mang/toolCucBo.ts` nội suy THẲNG đường dẫn đã giải vào một câu tiếng Việt
     * ("… là THƯ MỤC", "… là tệp NHỊ PHÂN", "không đọc được …"). Đường ấy bắt nguồn từ chuỗi MODEL
     * khai nên nó mang được bất cứ thứ gì — kể cả một chuỗi kết nối có mật khẩu.
     */
    const duong = join(WS, "src", `${KHOA}.ts`);
    // NUL trong nội dung ⇒ nhánh "tệp NHỊ PHÂN" — nhánh CÓ nội suy đường dẫn vào lý do.
    may.tep.set(duong, "abc def");

    const kq = await chayToolCucBo({ loai: "doc_tep", path: duong }, [WS]);
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.lyDo).not.toContain(KHOA);
    // ⚠ CHỐNG TỰ THOẢ: chữ trong KHUÔN MẪU phải còn nguyên — một cửa chót che sạch cả câu cũng
    //   thoả khẳng định trên, mà lại xoá mất lời giải thích người dùng cần đọc.
    expect(kq.lyDo).toContain("NHỊ PHÂN");
  });

  it("★★ KHÔNG có workspace nào đang mở ⇒ từ chối, không chạm đĩa", async () => {
    const kq = await chayToolCucBo({ loai: "grep", mau: "DATABASE_URL" }, []);
    expect(kq.ok).toBe(false);
    expect(may.daDoc).toEqual([]);
  });
});
