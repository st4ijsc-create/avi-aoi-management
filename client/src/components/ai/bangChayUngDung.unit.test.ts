/**
 * ★★★ Đợt 3c — BẢNG "CHẠY & XEM TRƯỚC": dựng CÂY THẬT (`renderToStaticMarkup`) và hỏi đúng câu:
 *   khung xem trước có SANDBOX đúng chuỗi · src là tuyến CẤP VÉ của ứng dụng (không phải origin proxy) · không
 *   `allow-top-navigation` · nút Cài chỉ hiện lệnh máy chủ gợi ý · Chạy/Dừng đúng trạng thái · xem trước TẮT nói rõ ·
 *   mọi khoá i18n tồn tại ở CẢ BA locale.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "..", "..");
const LOC = (l: string) => JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", `${l}.json`), "utf8"));
const VI = LOC("vi");
const da = (o: any, key: string) => key.split(".").reduce<any>((x, k) => (x == null ? undefined : x[k]), o);

/** `t` NGHIÊM: khoá vắng trong vi.json ⇒ `‹THIẾU:…›` (bảng này không truyền câu mặc định). */
function tThat(key: string, opts?: Record<string, unknown>): string {
  const v = da(VI, key);
  const cau = typeof v === "string" ? v : `‹THIẾU:${key}›`;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: tThat, i18n: { language: "vi" } }) }));

import { BangChayUngDung, SANDBOX_XEM_TRUOC, type DuLieuBangChay } from "./BangChayUngDung";

const html = (p: Partial<Parameters<typeof BangChayUngDung>[0]> & { duLieu: DuLieuBangChay | null }) =>
  renderToStaticMarkup(
    createElement(BangChayUngDung, {
      projectId: "demo",
      nhatKy: null,
      dangBan: false,
      onCai: () => {},
      onChay: () => {},
      onDung: () => {},
      ...p,
    }),
  );

const CO_BAN: DuLieuBangChay = {
  ungDung: null,
  lenhChay: { ok: true, moTa: "npm run dev", nguon: "package.json" },
  goiYCai: ["npm ci"],
  xemTruoc: { bat: true, lyDoTat: null },
};
const DANG_CHAY: DuLieuBangChay = {
  ...CO_BAN,
  ungDung: { laChu: true, cong: 5100, trangThai: "dang-chay", lenh: "npm run dev", maThoat: null, lyDoDung: null, chuaXacNhanChet: false, chuaNgheCong: false },
};

describe("§1 — khung xem trước", () => {
  it("★★★ đang chạy ⇒ iframe với SANDBOX đúng chuỗi, src = tuyến cấp vé của ứng dụng, KHÔNG allow-top-navigation", () => {
    const h = html({ duLieu: DANG_CHAY });
    const m = /<iframe[^>]*>/.exec(h);
    expect(m, "phải có khung xem trước").not.toBeNull();
    const the = m![0];
    expect(the).toContain(`sandbox="${SANDBOX_XEM_TRUOC}"`);
    expect(the).toContain(`src="/api/ai/preview/demo/"`);
    expect(the).not.toMatch(/allow-top-navigation/);
    expect(the.toLowerCase()).toContain('referrerpolicy="no-referrer"');
    expect(h).toContain('href="/api/ai/preview/demo/"');
    expect(h).toContain('rel="noopener noreferrer"');
  });

  it("★★ chưa chạy / đang khởi động ⇒ KHÔNG khung (không iframe trỏ vào ứng dụng chưa nghe)", () => {
    expect(html({ duLieu: CO_BAN })).not.toContain("<iframe");
    const kd: DuLieuBangChay = { ...DANG_CHAY, ungDung: { ...(DANG_CHAY.ungDung as any), trangThai: "dang-khoi-dong" } };
    expect(html({ duLieu: kd })).not.toContain("<iframe");
  });

  it("★★ proxy TẮT ⇒ nói rõ cách bật (AI_PREVIEW_PROXY_PORT), không khung", () => {
    const h = html({ duLieu: { ...DANG_CHAY, xemTruoc: { bat: false, lyDoTat: "CHUA_CAU_HINH" } } });
    expect(h).not.toContain("<iframe");
    expect(h).toContain("AI_PREVIEW_PROXY_PORT");
    expect(h).toContain("CHUA_CAU_HINH");
  });
});

describe("§2 — nút", () => {
  it("★★★ nút Cài chỉ là lệnh máy chủ gợi ý (data-lenh), bấm ⇒ onCai(lệnh) — bảng không có ô nhập lệnh cài", () => {
    const h = html({ duLieu: { ...CO_BAN, goiYCai: ["npm ci", "dotnet restore"] } });
    expect(h.match(/data-nut="cai"/g)?.length).toBe(2);
    expect(h).toContain('data-lenh="npm ci"');
    expect(h).toContain('data-lenh="dotnet restore"');
    expect(h).not.toContain("<input");
  });

  it("★★ chưa chạy ⇒ nút Chạy bật; đang chạy ⇒ nút Dừng; người KHÁC đang chạy ⇒ Chạy khoá + câu giải thích", () => {
    expect(html({ duLieu: CO_BAN })).toMatch(/<button[^>]*data-nut="chay"(?![^>]*disabled)/);
    const dc = html({ duLieu: DANG_CHAY });
    expect(dc).toContain('data-nut="dung"');
    expect(dc).not.toContain('data-nut="chay"');
    const khac = html({ duLieu: { ...CO_BAN, ungDung: { laChu: false, dangBan: true } } });
    expect(khac).toMatch(/<button[^>]*data-nut="chay"[^>]*disabled/);
    expect(khac).toContain(tThat("repoWs.chayUD.nguoiKhacDangChay"));
  });

  it("★★ repo chính ⇒ câu riêng, Chạy khoá", () => {
    const h = html({ duLieu: { ...CO_BAN, lenhChay: { ok: false, ma: "REPO_CHINH_KHONG_CHAY", chiTiet: "x" } } });
    expect(h).toContain('data-loi-chay="REPO_CHINH_KHONG_CHAY"');
    expect(h).toMatch(/<button[^>]*data-nut="chay"[^>]*disabled/);
  });
});

describe("§3 — trạng thái + nhật ký + cảnh báo", () => {
  it("★★ lỗi thoát ⇒ nhãn mang mã; chưa nghe cổng ⇒ cảnh báo PORT; chưa xác nhận chết ⇒ cảnh báo", () => {
    const loi: DuLieuBangChay = { ...CO_BAN, ungDung: { ...(DANG_CHAY.ungDung as any), trangThai: "loi", maThoat: 1, cong: null } };
    expect(html({ duLieu: loi })).toContain(tThat("repoWs.chayUD.trangThai.loi", { ma: 1 }));
    const nghe: DuLieuBangChay = { ...CO_BAN, ungDung: { ...(DANG_CHAY.ungDung as any), trangThai: "dang-khoi-dong", chuaNgheCong: true } };
    expect(html({ duLieu: nghe })).toContain('data-canh-bao="chua-nghe-cong"');
    const chet: DuLieuBangChay = { ...CO_BAN, ungDung: { ...(DANG_CHAY.ungDung as any), trangThai: "da-dung", chuaXacNhanChet: true } };
    expect(html({ duLieu: chet })).toContain('data-canh-bao="chua-xac-nhan-chet"');
  });

  it("★★ nhật ký cắt đầu ⇒ khai; rỗng ⇒ câu rỗng", () => {
    expect(html({ duLieu: DANG_CHAY, nhatKy: { dong: ["a", "b"], catDau: true } })).toContain(tThat("repoWs.chayUD.nhatKyCat"));
    expect(html({ duLieu: DANG_CHAY, nhatKy: null })).toContain(tThat("repoWs.chayUD.nhatKyRong"));
  });

  it("★★★ không một khoá THIẾU trong mọi hình dạng đã dựng", () => {
    const tat = [CO_BAN, DANG_CHAY].map((d) => html({ duLieu: d, nhatKy: { dong: ["x"], catDau: true } })).join("");
    expect(tat).not.toContain("‹THIẾU:");
  });
});

describe("§4 — i18n ba locale", () => {
  it("★★★ mọi khoá repoWs.chayUD.* của vi có ở en và zh (và ngược lại), cùng biến {{…}}", () => {
    const phang = (o: any, tien = ""): Record<string, string> =>
      Object.entries(o).reduce<Record<string, string>>((a, [k, v]) => {
        if (typeof v === "string") a[tien + k] = v;
        else Object.assign(a, phang(v, `${tien}${k}.`));
        return a;
      }, {});
    const [v, e, z] = ["vi", "en", "zh"].map((l) => phang(da(LOC(l), "repoWs.chayUD")));
    expect(Object.keys(v!).length).toBeGreaterThan(20);
    expect(Object.keys(e!).sort()).toEqual(Object.keys(v!).sort());
    expect(Object.keys(z!).sort()).toEqual(Object.keys(v!).sort());
    const bien = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(v!)) {
      expect(bien(e![k]!), `en ${k}`).toBe(bien(v![k]!));
      expect(bien(z![k]!), `zh ${k}`).toBe(bien(v![k]!));
    }
    for (const l of ["vi", "en", "zh"]) expect(typeof da(LOC(l), "repoWs.pane.runTab"), l).toBe("string");
  });
});
