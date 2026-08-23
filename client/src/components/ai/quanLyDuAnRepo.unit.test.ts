/**
 * ★★★ QUẢN LÝ DỰ ÁN (2026-08-23) — LƯỚI cho nút bánh răng + dialog thêm/xoá dự án.
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest gom `client/src/**\/*.unit.test.ts`; đặt `.test.ts` là
 *   vitest lặng lẽ bỏ qua trong khi cổng vẫn khai xanh — lớp "glob rỗng" cũ).
 *
 * Cùng khuôn `boChonPhien.unit.test.ts`: Radix `Dialog` đi qua Portal nên SSR vỏ KHÔNG BAO GIỜ
 * thấy ruột — vỏ (§1) chỉ được hỏi về nút bánh răng + dây nối (quét mã); ruột (§2–§4) render
 * THẲNG `NoiDungQuanLyDuAn`.
 *
 * ★★★ §5 là ô ăn tiền của lưới này: **MỌI mã từ chối mà server phát ra đều có MỘT CÂU hướng dẫn**
 * — danh sách mã được TRÍCH TỪ MÃ NGUỒN SERVER (`repoProjects.ts`, hai khối type + `LUU_THAT_BAI`
 * của router), không chép tay: server mọc mã mới mà client chưa có câu ⇒ ĐỎ ngay tại đây, không
 * phải ba tuần sau khi một admin nhìn câu fallback tiếng-mã-máy.
 *
 * ĐỘT BIẾN PHẢI BẮT: bỏ nút bánh răng ⇒ §1 ĐỎ · mục env mất ổ khoá / mọc nút xoá ⇒ §2 ĐỎ ·
 * hàng mất-gốc không hiện cảnh báo ⇒ §3 ĐỎ · form mất một ô nhập ⇒ §4 ĐỎ · một mã server mất
 * câu (hoặc ba locale lệch tập khoá) ⇒ §5 ĐỎ.
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
      danhSachDayDu: { useQuery: () => ({ data: undefined, isLoading: false }) },
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

const { QuanLyDuAnRepo, NoiDungQuanLyDuAn, cauChoMaLoi } = await import("./QuanLyDuAnRepo");
const NGUON = readFileSync(join(HERE, "QuanLyDuAnRepo.tsx"), "utf8").replace(/\r\n/g, "\n");

const MUC_MAU = [
  { id: "repo", ten: "Repo chính", goc: "D:\\SOURCES\\repo-chinh", nguon: "env" as const, hoatDong: true },
  { id: "demo-db", ten: "Demo từ UI", goc: "D:\\DuAn\\demo", nguon: "db" as const, hoatDong: true },
  { id: "mo-coi", ten: "Mất gốc", goc: "D:\\DuAn\\da-xoa", nguon: "db" as const, hoatDong: false },
];

type NoiDungProps = Parameters<typeof NoiDungQuanLyDuAn>[0];
function veRuot(over: Partial<NoiDungProps> = {}): string {
  return renderToStaticMarkup(
    createElement(NoiDungQuanLyDuAn, {
      muc: MUC_MAU,
      tranDb: 20,
      dangTai: false,
      loiThem: null,
      dangThem: false,
      onThem: () => {},
      onXoa: () => {},
      ...over,
    } as NoiDungProps),
  );
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
  it("★★ ba ô nhập + nút Thêm ra HTML, kèm ghi chú 'server kiểm tra rồi mới nhận'", () => {
    const html = veRuot();
    for (const dau of ["data-o-id", "data-o-ten", "data-o-duong", "data-nut-them", "data-form-them"]) {
      expect(html, dau).toContain(dau);
    }
    expect(html).toContain(esc(VI.repoWs.duan.ghiChu));
  });

  it("★★★ có mã lỗi ⇒ câu hướng dẫn hiện đúng trong `role=alert`", () => {
    const html = veRuot({ loiThem: "NAM_TRONG_GOC_DA_CO" });
    expect(html).toContain("data-loi-them");
    expect(html).toContain(esc(VI.repoWs.duan.err.namTrongGocDaCo));
  });
});

describe("§5 — ★★★ MỌI mã server phát ra đều có MỘT CÂU (trích mã từ NGUỒN SERVER, không chép tay)", () => {
  /** Trích mọi literal trong hai khối type mã từ chối của `repoProjects.ts` + mã riêng của router. */
  function maTuServer(): string[] {
    const src = readFileSync(
      join(REPO, "server", "services", "aiLocalTools", "repoProjects.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const ra = new Set<string>();
    for (const khoi of ["MaTuChoiDangKy", "MaTuChoiXoa"]) {
      const dau = src.indexOf(`export type ${khoi}`);
      expect(dau, `không thấy khối \`${khoi}\` trong repoProjects.ts — lưới mất nguồn`).toBeGreaterThan(-1);
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
    ra.add("LUU_THAT_BAI"); // mã riêng của router (chèn hỏng sau phán quyết xanh)
    return [...ra].sort();
  }

  it("★★★ từng mã một câu tiếng Việt THẬT — không mã nào rơi về câu fallback", () => {
    const ma = maTuServer();
    expect(ma.length, "trích ra 0 mã ⇒ lưới tự thoả").toBeGreaterThanOrEqual(12);
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

  it("★ mã LẠ ⇒ câu fallback MANG MÃ THÔ (người dùng còn báo được lỗi)", () => {
    expect(cauChoMaLoi("MA_LA_2099", tThat)).toContain("MA_LA_2099");
  });
});
