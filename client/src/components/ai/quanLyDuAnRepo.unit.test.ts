/**
 * ★★★ QUẢN LÝ DỰ ÁN (2026-08-23) — LƯỚI cho nút bánh răng + dialog thêm/xoá dự án.
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest gom `client/src/**\/*.unit.test.ts`; đặt `.test.ts` là
 *   vitest lặng lẽ bỏ qua trong khi cổng vẫn khai xanh — lớp "glob rỗng" cũ).
 *
 * Cùng khuôn `boChonPhien.unit.test.ts`: Radix `Dialog` đi qua Portal nên SSR vỏ KHÔNG BAO GIỜ
 * thấy ruột — vỏ (§1) chỉ được hỏi về nút bánh răng + dây nối (quét mã); ruột (§2–§4, §6–§9)
 * render THẲNG `NoiDungQuanLyDuAn`.
 *
 * ★★★ §5 là ô ăn tiền của lưới này: **MỌI mã từ chối mà server phát ra đều có MỘT CÂU hướng dẫn**
 * — danh sách mã được TRÍCH TỪ MÃ NGUỒN SERVER (`repoProjects.ts` + `duyetThuMuc.ts`, các khối
 * type + `LUU_THAT_BAI` của router), không chép tay: server mọc mã mới mà client chưa có câu ⇒ ĐỎ
 * ngay tại đây, không phải ba tuần sau khi một admin nhìn câu fallback tiếng-mã-máy.
 *
 * ★★★ §6–§8 (SỬA 2026-08-23 — màn này từng NÓI DỐI người dùng thật):
 *   §6 hàm thuần `slugTuTenThuMuc`/`tenThuMucCuoi`/`docLoiTrpc` — oracle cứng;
 *   §7 query hỏng ⇒ BĂNG LỖI mang câu server, KHÔNG BAO GIỜ "Chưa có dự án nào."
 *      (đột biến: đổi băng thành nhánh rỗng ⇒ ĐỎ vì câu rỗng-danh-sách xuất hiện);
 *   §8 lỗi thêm hiện SỰ THẬT: câu server nguyên văn (2FA) / chi tiết e.message — và ID sai khuôn
 *      khi gõ ⇒ câu đỏ + nút Thêm khoá (đột biến: bỏ kiểm ⇒ ĐỎ vì nút hết disabled).
 * §9 bộ chọn thư mục: ổ đĩa/con/lên-cấp/bị-cắt render đủ; "Chọn thư mục này" khoá khi chưa có
 *    thư mục thật.
 *
 * ĐỘT BIẾN PHẢI BẮT: bỏ nút bánh răng ⇒ §1 ĐỎ · mục env mất ổ khoá / mọc nút xoá ⇒ §2 ĐỎ ·
 * hàng mất-gốc không hiện cảnh báo ⇒ §3 ĐỎ · form mất một ô nhập ⇒ §4 ĐỎ · một mã server mất
 * câu (hoặc ba locale lệch tập khoá) ⇒ §5 ĐỎ · bỏ bỏ-dấu trong slug ⇒ §6 ĐỎ · nuốt lỗi như cũ
 * ⇒ §7/§8 ĐỎ.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "..", "..");
const REPO = resolve(CLIENT_SRC, "..", "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));
const EN = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "en.json"), "utf8"));
const ZH = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "zh.json"), "utf8"));

/** `t` giả TRA THẬT `vi.json` — gõ sai khoá ⇒ `‹THIẾU:…›` ⇒ đỏ (khuôn boChonPhien). */
function tThat(key: string, a?: unknown, b?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : b) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));
// Vỏ nhập trpc + sonner ở tầng module — mock TRƠ để render tĩnh không dựng client thật.
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      repoWorkspace: {
        listProjects: { invalidate: () => {} },
        danhSachDayDu: { invalidate: () => {} },
      },
    }),
    repoWorkspace: {
      danhSachDayDu: { useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null }) },
      duyetThuMuc: { useQuery: () => ({ data: undefined, isFetching: false, isError: false, error: null }) },
      themDuAn: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      xoaDuAn: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

/** React SSR thoát `&<>"` — mọi phép so chuỗi với HTML phải đi qua đây. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const {
  QuanLyDuAnRepo,
  NoiDungQuanLyDuAn,
  cauChoMaLoi,
  slugTuTenThuMuc,
  tenThuMucCuoi,
  docLoiTrpc,
  CHON_DANG_DONG,
} = await import("./QuanLyDuAnRepo");
const NGUON = readFileSync(join(HERE, "QuanLyDuAnRepo.tsx"), "utf8").replace(/\r\n/g, "\n");

const MUC_MAU = [
  { id: "repo", ten: "Repo chính", goc: "D:\\SOURCES\\repo-chinh", nguon: "env" as const, hoatDong: true },
  { id: "demo-db", ten: "Demo từ UI", goc: "D:\\DuAn\\demo", nguon: "db" as const, hoatDong: true },
  { id: "mo-coi", ten: "Mất gốc", goc: "D:\\DuAn\\da-xoa", nguon: "db" as const, hoatDong: false },
];

/** Câu 2FA THẬT của `adminProcedure` (server/_core/trpc.ts) — dùng làm mẫu cho §7/§8. */
const CAU_2FA = "Tài khoản admin phải bật xác thực 2 bước (2FA). Vào Cài đặt > Bảo mật để thiết lập.";

type NoiDungProps = Parameters<typeof NoiDungQuanLyDuAn>[0];
function veRuot(over: Partial<NoiDungProps> = {}): string {
  return renderToStaticMarkup(
    createElement(NoiDungQuanLyDuAn, {
      muc: MUC_MAU,
      tranDb: 20,
      dangTai: false,
      loiTai: null,
      loiThem: null,
      dangThem: false,
      chon: CHON_DANG_DONG,
      onThem: () => {},
      onXoa: () => {},
      onMoChon: () => {},
      onDuyet: () => {},
      onDongChon: () => {},
      ...over,
    } as NoiDungProps),
  );
}

/** Thẻ `<button …>` mang một data-attr — để soi `disabled` không phụ thuộc thứ tự thuộc tính. */
function theNut(html: string, dau: string): string {
  const m = html.match(new RegExp(`<button[^>]*${dau}[^>]*>`));
  expect(m, `không thấy thẻ nút ${dau}`).not.toBeNull();
  return m![0];
}

/**
 * ⚠ Nút KHOÁ phải soi THUỘC TÍNH `disabled=""` (cách React SSR ghi thuộc tính boolean) — KHÔNG
 * soi chuỗi "disabled" trần: className của shadcn Button luôn chứa "disabled:opacity-50" (biến
 * thể Tailwind) nên phép chứa trần XANH với MỌI nút — thước tự thoả, đã bắt được ngay ở lượt
 * chạy đầu của chính lưới này.
 */
function nutBiKhoa(html: string, dau: string): boolean {
  return theNut(html, dau).includes('disabled=""');
}

describe("§1 VỎ — nút bánh răng có THẬT, dialog nối đúng ruột", () => {
  it("★★★ nút bánh răng ra HTML kèm nhãn truy cập (admin-only là việc của TRANG — vỏ không tự quyết)", () => {
    const html = renderToStaticMarkup(createElement(QuanLyDuAnRepo, {}));
    expect(html).toContain("data-nut-quan-ly-du-an");
    expect(html).toContain(esc(VI.repoWs.duan.moTitle));
    expect(html).not.toContain("‹THIẾU:");
  });

  it("★ DÂY NỐI (quét mã — Portal không SSR được): `DialogContent` bọc đúng `NoiDungQuanLyDuAn`, trigger là nút bánh răng", () => {
    const moContent = NGUON.indexOf("<DialogContent");
    const ruot = NGUON.indexOf("<NoiDungQuanLyDuAn");
    const dongContent = NGUON.indexOf("</DialogContent>");
    expect(moContent).toBeGreaterThan(-1);
    expect(ruot, "dialog không còn chứa ruột — bánh răng mở ra một hộp rỗng").toBeGreaterThan(moContent);
    expect(dongContent).toBeGreaterThan(ruot);
    const trigger = NGUON.indexOf("<DialogTrigger");
    expect(trigger).toBeGreaterThan(-1);
    expect(NGUON.indexOf("data-nut-quan-ly-du-an")).toBeGreaterThan(trigger);
    expect(NGUON.indexOf("data-nut-quan-ly-du-an")).toBeLessThan(moContent);
  });

  it("★ TRANG gắn vỏ CHỈ cho admin (phép lịch sự — hàng rào thật là adminProcedure, đo ở lưới router)", () => {
    const trang = readFileSync(join(CLIENT_SRC, "pages", "AICodingWorkspace.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(trang).toMatch(/user\?\.role === "admin" && <QuanLyDuAnRepo/);
  });
});

describe("§2 RUỘT — nhãn nguồn: env = Ổ KHOÁ (không xoá), db = nút xoá", () => {
  it("★★★ mục env KHÔNG có nút xoá — và có đúng chú thích 'sửa bằng tay trong .env'", () => {
    const html = veRuot({ muc: [MUC_MAU[0]!] });
    expect(html).not.toContain("data-nut-xoa-du-an");
    expect(html).toContain(esc(VI.repoWs.duan.khoaEnv));
    expect(html).toContain(esc(VI.repoWs.duan.nguonEnv));
  });

  it("★★★ mục db CÓ nút xoá kèm nhãn truy cập", () => {
    const html = veRuot({ muc: [MUC_MAU[1]!] });
    expect(html).toContain("data-nut-xoa-du-an");
    expect(html).toContain(esc(VI.repoWs.duan.xoa));
    expect(html).toContain(esc(VI.repoWs.duan.nguonDb));
  });

  it("★ đường dẫn gốc hiện trong dialog (admin-only) — người quản không thấy gốc thì không quản được", () => {
    const html = veRuot({ muc: [MUC_MAU[1]!] });
    expect(html).toContain(esc("D:\\DuAn\\demo"));
  });
});

describe("§3 RUỘT — hàng MẤT GỐC phải nhìn thấy được (nếu lọc đi thì nó mồ côi vĩnh viễn)", () => {
  it("★★ hàng hoatDong:false hiện cảnh báo + VẪN có nút xoá", () => {
    const html = veRuot({ muc: [MUC_MAU[2]!] });
    expect(html).toContain(esc(VI.repoWs.duan.hong));
    expect(html).toContain("data-nut-xoa-du-an");
  });
});

describe("§4 RUỘT — form thêm: đủ BA ô nhập {id, tên, đường dẫn} + câu lỗi theo mã", () => {
  it("★★ ba ô nhập + nút Thêm + nút Chọn-thư-mục ra HTML, kèm ghi chú 'server kiểm tra rồi mới nhận'", () => {
    const html = veRuot();
    for (const dau of ["data-o-id", "data-o-ten", "data-o-duong", "data-nut-them", "data-form-them", "data-nut-chon-thu-muc"]) {
      expect(html, dau).toContain(dau);
    }
    expect(html).toContain(esc(VI.repoWs.duan.ghiChu));
    expect(html).toContain(esc(VI.repoWs.duan.chonNut));
  });

  it("★★★ có mã lỗi ⇒ câu hướng dẫn hiện đúng trong `role=alert`", () => {
    const html = veRuot({ loiThem: { loai: "ma", ma: "NAM_TRONG_GOC_DA_CO" } });
    expect(html).toContain("data-loi-them");
    expect(html).toContain(esc(VI.repoWs.duan.err.namTrongGocDaCo));
  });
});

describe("§5 — ★★★ MỌI mã server phát ra đều có MỘT CÂU (trích mã từ NGUỒN SERVER, không chép tay)", () => {
  /**
   * Trích mọi literal trong các khối type mã từ chối của server + mã riêng của router.
   * 2026-08-23: thêm nguồn `duyetThuMuc.ts` (`MaTuChoiDuyet` của bộ chọn thư mục) — cùng bánh
   * cóc: server mọc mã duyệt mới mà client chưa có câu ⇒ ĐỎ ở đây.
   */
  function maTuServer(): string[] {
    const nguon: Array<[string, string[]]> = [
      [join(REPO, "server", "services", "aiLocalTools", "repoProjects.ts"), ["MaTuChoiDangKy", "MaTuChoiXoa"]],
      [join(REPO, "server", "services", "aiLocalTools", "duyetThuMuc.ts"), ["MaTuChoiDuyet"]],
    ];
    const ra = new Set<string>();
    for (const [file, khoiDs] of nguon) {
      const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      for (const khoi of khoiDs) {
        const dau = src.indexOf(`export type ${khoi}`);
        expect(dau, `không thấy khối \`${khoi}\` trong ${file} — lưới mất nguồn`).toBeGreaterThan(-1);
        // ⚠ KHÔNG cắt ở dấu `;` đầu tiên: chú thích của chính khối có `#;=|` (bài học dotenv) — dấu
        //   `;` TRONG chú thích làm lưới chỉ trích ra nửa khối rồi tự khai đủ. Cắt ở `export` kế
        //   tiếp, BỎ chú thích dòng trước khi bắt literal.
        const cuoi = src.indexOf("export ", dau + 12);
        const than = src
          .slice(dau, cuoi > dau ? cuoi : undefined)
          .split("\n")
          .map((l) => l.replace(/\/\/.*$/, ""))
          .join("\n");
        for (const m of than.matchAll(/"([A-Z_]+)"/g)) ra.add(m[1]!);
      }
    }
    ra.add("LUU_THAT_BAI"); // mã riêng của router (chèn hỏng sau phán quyết xanh)
    return [...ra].sort();
  }

  it("★★★ từng mã một câu tiếng Việt THẬT — không mã nào rơi về câu fallback", () => {
    const ma = maTuServer();
    expect(ma.length, "trích thiếu mã ⇒ lưới tự thoả (13 = 10 đăng ký + 2 xoá + 1 duyệt, + LUU_THAT_BAI)").toBeGreaterThanOrEqual(14);
    const fallback = cauChoMaLoi("MA_CHAC_CHAN_KHONG_TON_TAI", tThat);
    for (const m of ma) {
      const cau = cauChoMaLoi(m, tThat);
      expect(cau, m).not.toContain("‹THIẾU:");
      expect(cau.replace(m, ""), `mã \`${m}\` rơi về câu fallback — server mọc mã mà client chưa có câu`).not.toBe(
        fallback.replace("MA_CHAC_CHAN_KHONG_TON_TAI", ""),
      );
    }
  });

  it("★★ ba locale CÙNG tập khoá `repoWs.duan.err` — en/zh không được thiếu câu nào vi có", () => {
    const khoa = (o: any): string[] => Object.keys(o.repoWs.duan.err).sort();
    expect(khoa(EN), "en lệch vi").toEqual(khoa(VI));
    expect(khoa(ZH), "zh lệch vi").toEqual(khoa(VI));
  });

  it("★★ ba locale CÙNG tập khoá `repoWs.duan` (cả nhánh bộ chọn mới) — không màn nào nửa dịch", () => {
    const khoa = (o: any): string[] => Object.keys(o.repoWs.duan).sort();
    expect(khoa(EN), "en lệch vi").toEqual(khoa(VI));
    expect(khoa(ZH), "zh lệch vi").toEqual(khoa(VI));
  });

  it("★ mã LẠ ⇒ câu fallback MANG MÃ THÔ (người dùng còn báo được lỗi)", () => {
    expect(cauChoMaLoi("MA_LA_2099", tThat)).toContain("MA_LA_2099");
  });
});

describe("§6 — HÀM THUẦN: slug/tên-cuối/đọc-lỗi (oracle cứng, không render)", () => {
  it("★★★ slugTuTenThuMuc: bỏ dấu + thường hoá + khoảng trắng→'-' (đột biến bỏ bỏ-dấu ⇒ ĐỎ)", () => {
    expect(slugTuTenThuMuc("Dự án demo")).toBe("du-an-demo");
    expect(slugTuTenThuMuc("Đường Ống 2026!")).toBe("duong-ong-2026");
    expect(slugTuTenThuMuc("avi-aoi-management")).toBe("avi-aoi-management");
    // toàn ký tự lạ ⇒ "" — người gọi phải tự xử lý chuỗi rỗng, slug không bịa ra một id.
    expect(slugTuTenThuMuc("!!! @@@ ###")).toBe("");
    // dài quá 64 ⇒ cắt còn ≤64 và vẫn hợp khuôn (không kết thúc bằng '-')
    const dai = slugTuTenThuMuc(`${"a".repeat(63)} ${"b".repeat(20)}`);
    expect(dai.length).toBeLessThanOrEqual(64);
    expect(/^[a-z0-9_-]+$/.test(dai)).toBe(true);
    expect(dai.endsWith("-")).toBe(false);
  });

  it("★★ tenThuMucCuoi: Windows lẫn POSIX, kể cả gốc ổ đĩa", () => {
    expect(tenThuMucCuoi("D:\\DuAn\\Dự án demo")).toBe("Dự án demo");
    expect(tenThuMucCuoi("D:\\DuAn\\demo\\")).toBe("demo");
    expect(tenThuMucCuoi("/srv/du-an")).toBe("du-an");
    expect(tenThuMucCuoi("C:\\")).toBe("C:");
  });

  it("★★★ docLoiTrpc: đọc đúng {code, cau, la2fa} từ hình dạng TRPCClientError thật (data.code + message + data.appCode)", () => {
    const l1 = docLoiTrpc({ message: CAU_2FA, data: { code: "FORBIDDEN" } });
    expect(l1).toEqual({ code: "FORBIDDEN", cau: CAU_2FA, la2fa: true });
    // appCode máy-đọc-được thắng cả khi câu không nhắc 2FA (cờ APP_ERROR_CODES_ENABLED mặc định bật)
    const l2 = docLoiTrpc({ message: "Bị chặn.", data: { code: "FORBIDDEN", appCode: "TWO_FACTOR_NOT_SET_UP" } });
    expect(l2.la2fa).toBe(true);
    const l3 = docLoiTrpc({ message: "fetch failed", data: undefined });
    expect(l3).toEqual({ code: null, cau: "fetch failed", la2fa: false });
    expect(docLoiTrpc(null)).toEqual({ code: null, cau: "", la2fa: false });
  });
});

describe("§7 — ★★★ QUERY HỎNG ⇒ BĂNG LỖI, KHÔNG BAO GIỜ 'Chưa có dự án nào.'", () => {
  it("★★★ loiTai có mặt ⇒ băng lỗi mang ĐÚNG câu server; câu rỗng-danh-sách KHÔNG được xuất hiện", () => {
    const html = veRuot({ muc: [], loiTai: { cau: CAU_2FA, la2fa: true } });
    expect(html).toContain("data-loi-tai");
    expect(html).toContain(esc(VI.repoWs.duan.loiTai));
    expect(html).toContain(esc(CAU_2FA));
    // Đột biến "đổi băng thành nhánh rỗng" phải ĐỎ ở dòng này: query hỏng mà khai "chưa có dự án"
    // là nói dối — chính là ảnh chụp màn hình của chủ dự án.
    expect(html).not.toContain(esc(VI.repoWs.duan.empty));
  });

  it("★★ câu 2FA được tô NỔI BẬT (amber) — khác lỗi thường", () => {
    const co2fa = veRuot({ muc: [], loiTai: { cau: CAU_2FA, la2fa: true } });
    const khong2fa = veRuot({ muc: [], loiTai: { cau: "Lỗi khác", la2fa: false } });
    expect(co2fa).toContain("text-amber-600");
    expect(khong2fa).not.toContain("text-amber-600");
  });

  it("★ loiTai null + danh sách rỗng ⇒ vẫn là câu rỗng-danh-sách bình thường (không mất nhánh cũ)", () => {
    const html = veRuot({ muc: [] });
    expect(html).toContain(esc(VI.repoWs.duan.empty));
    expect(html).not.toContain("data-loi-tai");
  });
});

describe("§8 — ★★★ LỖI THÊM NÓI SỰ THẬT + KIỂM ID KHI GÕ", () => {
  it("★★★ loiThem loai:'server' ⇒ hiện NGUYÊN VĂN câu server (đột biến nuốt lỗi như cũ ⇒ ĐỎ)", () => {
    const html = veRuot({ loiThem: { loai: "server", cau: CAU_2FA, la2fa: true } });
    expect(html).toContain("data-loi-them");
    expect(html).toContain(esc(CAU_2FA));
    // Không được thay câu server bằng câu bịa "CSDL từ chối" của LUU_THAT_BAI như trước.
    expect(html).not.toContain(esc(VI.repoWs.duan.err.luuThatBai));
  });

  it("★★★ loiThem loai:'gui' ⇒ câu chung KÈM chi tiết thật (e.message không bị vứt)", () => {
    const html = veRuot({ loiThem: { loai: "gui", chiTiet: "ECONNREFUSED 127.0.0.1:3000" } });
    expect(html).toContain("data-loi-them");
    expect(html).toContain(esc("ECONNREFUSED 127.0.0.1:3000"));
  });

  it("★★★ ID sai khuôn ('Dự án demo' — dấu cách + dấu tiếng Việt) ⇒ câu đỏ NGAY dưới ô + nút Thêm KHOÁ", () => {
    const html = veRuot({
      giaTriDau: { id: "Dự án demo", ten: "Dự án demo", duongDan: "D:\\DuAn\\demo" },
    });
    expect(html).toContain("data-loi-id");
    expect(html).toContain(esc(VI.repoWs.duan.err.idKhongHopLe));
    expect(nutBiKhoa(html, "data-nut-them"), "nút Thêm phải KHOÁ khi id sai khuôn").toBe(true);
  });

  it("★★ id hợp khuôn + đủ ba ô ⇒ KHÔNG câu đỏ, nút Thêm MỞ (chiều dương — thiếu nó, bản vá 'khoá tất' cũng xanh)", () => {
    const html = veRuot({
      giaTriDau: { id: "du-an-demo", ten: "Dự án demo", duongDan: "D:\\DuAn\\demo" },
    });
    expect(html).not.toContain("data-loi-id");
    expect(nutBiKhoa(html, "data-nut-them")).toBe(false);
  });

  it("★ id đang RỖNG ⇒ chưa mắng vội (câu đỏ chỉ dành cho khuôn SAI, không phải ô chưa gõ)", () => {
    const html = veRuot();
    expect(html).not.toContain("data-loi-id");
    expect(nutBiKhoa(html, "data-nut-them"), "rỗng thì nút vẫn khoá — nhưng bằng đường 'chưa đủ ô'").toBe(true);
  });

  it("★★ DÂY NỐI onError của VỎ (quét mã — SSR không bắn được mutation): đọc lỗi THẬT qua docLoiTrpc, CẤM quay về hằng LUU_THAT_BAI", () => {
    // Nửa RUỘT của luật "không nuốt lỗi" đã đo bằng render ở trên; nửa VỎ (onError → setLoiThem)
    // không chạy được trong static render nên soi mã — cùng khuôn ca "DÂY NỐI" của §1.
    const than = NGUON.slice(NGUON.indexOf("const themM"), NGUON.indexOf("const xoaM"));
    expect(than).toContain("onError: (e) => {");
    expect(than).toContain("docLoiTrpc(e)");
    expect(than, "onError cũ vứt `e` rồi khai LUU_THAT_BAI — chính là thông điệp BỊA đã chặn chủ dự án").not.toContain(
      'setLoiThem("LUU_THAT_BAI")',
    );
  });
});

describe("§9 — BỘ CHỌN THƯ MỤC: ổ đĩa → con → lên cấp, trần bị cắt, lỗi duyệt", () => {
  const CHON_O_DIA = {
    ...CHON_DANG_DONG,
    mo: true,
    muc: [
      { ten: "C:\\", duong: "C:\\" },
      { ten: "D:\\", duong: "D:\\" },
    ],
  };

  it("★★ danh sách Ổ ĐĨA: mục bấm được + nhãn 'Ổ đĩa trên máy chủ' + nút 'Chọn thư mục này' KHOÁ (chưa ở thư mục nào)", () => {
    const html = veRuot({ chon: CHON_O_DIA });
    expect(html).toContain("data-bo-chon-thu-muc");
    expect(html).toContain(esc(VI.repoWs.duan.chonODia));
    expect(html).toContain(esc("C:\\"));
    expect(html).toContain(esc("D:\\"));
    expect(nutBiKhoa(html, "data-nut-chon-day")).toBe(true);
    expect(nutBiKhoa(html, "data-nut-len-cap"), "ở danh sách ổ đĩa thì không còn cấp trên").toBe(true);
  });

  it("★★ đang ở một thư mục THẬT: breadcrumb + con bấm được + 'Chọn thư mục này' MỞ + lên-cấp MỞ", () => {
    const html = veRuot({
      chon: {
        ...CHON_DANG_DONG,
        mo: true,
        duongHienTai: "D:\\DuAn",
        duongCha: "D:\\",
        muc: [{ ten: "demo", duong: "D:\\DuAn\\demo" }],
        chonDuoc: true,
      },
    });
    expect(html).toContain("data-duong-hien-tai");
    expect(html).toContain(esc("D:\\DuAn"));
    expect(html).toContain("data-muc-thu-muc");
    expect(html).toContain(">demo</span>");
    expect(nutBiKhoa(html, "data-nut-chon-day")).toBe(false);
    expect(nutBiKhoa(html, "data-nut-len-cap")).toBe(false);
  });

  it("★★ biCat ⇒ câu 'chỉ hiện N mục đầu' mang ĐÚNG con số server khai", () => {
    const html = veRuot({
      chon: { ...CHON_DANG_DONG, mo: true, duongHienTai: "D:\\To", duongCha: "D:\\", muc: [{ ten: "a", duong: "D:\\To\\a" }], biCat: true, tran: 500, chonDuoc: true },
    });
    expect(html).toContain("data-bi-cat");
    expect(html).toContain("500");
  });

  it("★★ lỗi duyệt ⇒ câu lỗi trong role=alert, không danh sách ma", () => {
    const html = veRuot({
      chon: { ...CHON_DANG_DONG, mo: true, duongHienTai: "Q:\\khong-co", loi: cauChoMaLoi("DUONG_KHONG_HOP_LE", tThat) },
    });
    expect(html).toContain("data-loi-duyet");
    expect(html).toContain(esc(VI.repoWs.duan.err.duongKhongHopLe));
    expect(html).not.toContain("data-muc-thu-muc");
  });

  it("★ chon.mo=false ⇒ KHÔNG render panel (dialog gọn khi chưa bấm)", () => {
    const html = veRuot();
    expect(html).not.toContain("data-bo-chon-thu-muc");
  });
});
