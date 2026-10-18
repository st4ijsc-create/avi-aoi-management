// @vitest-environment jsdom
//
// ★★★ Đợt 3b — lưới DOM cho BẢNG GIT (`BangGit`, thuần theo props): chọn tệp + thông điệp ⇒ Commit đúng tệp; "Gợi ý
// thông điệp" chỉ ĐIỀN chữ; repo chính / thiếu quyền ⇒ khoá ghi + câu đúng lý do; cây bẩn ⇒ khoá chuyển/tạo nhánh;
// diff vẽ qua HunkDiffView (readOnly); lỗi ⇒ băng lỗi (KHÔNG giả danh "cây sạch").
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOC = (l: string) => JSON.parse(readFileSync(join(resolve(HERE, "..", ".."), "i18n", "locales", `${l}.json`), "utf8"));
const VI = LOC("vi");
const da = (o: any, k: string) => k.split(".").reduce<any>((x, p) => (x == null ? undefined : x[p]), o);
function tThat(k: string, a?: unknown, b?: unknown): string {
  const v = da(VI, k);
  const opts = (typeof a === "object" && a ? a : b) as Record<string, unknown> | undefined;
  const cau = typeof v === "string" ? v : typeof a === "string" ? a : `‹THIẾU:${k}›`;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, x) => (x in opts ? String(opts[x]) : m)) : cau;
}
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: tThat, i18n: { language: "vi" } }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { BangGit, type BangGitProps, type TrangThaiGitUI } from "./BangGit";
import { MA_LOI_GIT } from "./bangGitLogic";

afterEach(cleanup);

const TT: TrangThaiGitUI = {
  nhanh: "main",
  chuaCoCommit: false,
  muc: [
    { path: "src/a.ts", tuDuong: null, xy: " M" },
    { path: "moi.ts", tuDuong: null, xy: "??" },
  ],
  soAn: 1,
  tongThat: 3,
  catBot: false,
  laRepoChinh: false,
  ghiDuoc: true,
};

function dung(p: Partial<BangGitProps> = {}) {
  const props: BangGitProps = {
    tt: TT,
    loi: null,
    dangTai: false,
    coQuyenGhi: true,
    nhanh: ["main", "tinh-nang"],
    nhanhHienTai: "main",
    log: [{ hash: "abc1234567", ngan: "abc1234", tacGia: "Kỹ sư A", luc: 1_700_000_000, tieuDe: "Khởi tạo" }],
    tepXem: null,
    diff: null,
    loiDiff: null,
    dangTaiDiff: false,
    dangBan: false,
    onXemTep: vi.fn(),
    onCommit: vi.fn(async () => true),
    onGoiY: vi.fn(async () => "Thêm moi.ts"),
    onTaoNhanh: vi.fn(),
    onChuyenNhanh: vi.fn(),
    onLamMoi: vi.fn(),
    ...p,
  };
  const r = render(<BangGit {...props} />);
  return { ...r, props };
}
const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLElement | null;

describe("Bảng Git — commit", () => {
  it("★★★ Commit khoá tới khi có tệp + thông điệp; bấm ⇒ onCommit(ĐÚNG tệp đã chọn, thông điệp)", async () => {
    const { container, props } = dung();
    const nut = q(container, "[data-nut-commit]") as HTMLButtonElement;
    expect(nut).toBeDisabled();
    fireEvent.click(q(container, '[data-chon-tep="moi.ts"]')!);
    expect(nut).toBeDisabled(); // còn thiếu thông điệp
    fireEvent.change(q(container, "[data-o-thong-diep]")!, { target: { value: "Thêm moi.ts" } });
    expect(nut).not.toBeDisabled();
    fireEvent.click(nut);
    await waitFor(() => expect(props.onCommit).toHaveBeenCalledWith(["moi.ts"], "Thêm moi.ts"));
  });

  it("★★ 'Gợi ý thông điệp' chỉ ĐIỀN chữ vào ô — KHÔNG gọi onCommit", async () => {
    const { container, props } = dung();
    fireEvent.click(q(container, "[data-chon-tat-ca]")!);
    fireEvent.click(q(container, "[data-nut-goi-y]")!);
    await waitFor(() => expect((q(container, "[data-o-thong-diep]") as HTMLTextAreaElement).value).toBe("Thêm moi.ts"));
    expect(props.onGoiY).toHaveBeenCalledWith(["src/a.ts", "moi.ts"]);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("★★★ repo chính ⇒ băng chỉ đọc + Commit/Chuyển/Tạo khoá; thiếu quyền ⇒ câu thiếu quyền", () => {
    const { container } = dung({ tt: { ...TT, laRepoChinh: true, ghiDuoc: false } });
    expect(q(container, "[data-git-chi-doc]")!.textContent).toContain(tThat("repoWs.git.chiDocRepoChinh"));
    expect(q(container, "[data-o-thong-diep]")).toBeDisabled();
    expect(q(container, "[data-nut-tao-nhanh]")).toBeDisabled();
    cleanup();
    const b = dung({ coQuyenGhi: false });
    expect(q(b.container, "[data-git-chi-doc]")!.textContent).toContain(tThat("repoWs.git.thieuQuyen"));
  });

  it("★★ cây BẨN ⇒ nút Chuyển/Tạo nhánh khoá + câu giải thích; cây sạch ⇒ chuyển được", () => {
    const { container } = dung();
    fireEvent.change(q(container, "[data-chon-nhanh]")!, { target: { value: "tinh-nang" } });
    expect(q(container, "[data-nut-chuyen-nhanh]")).toBeDisabled();
    expect(q(container, "[data-git-cay-ban]")).not.toBeNull();
    cleanup();
    const s = dung({ tt: { ...TT, muc: [], soAn: 0, tongThat: 0 } });
    expect(q(s.container, "[data-git-sach]")).not.toBeNull();
    fireEvent.change(q(s.container, "[data-chon-nhanh]")!, { target: { value: "tinh-nang" } });
    fireEvent.click(q(s.container, "[data-nut-chuyen-nhanh]")!);
    expect(s.props.onChuyenNhanh).toHaveBeenCalledWith("tinh-nang");
    fireEvent.change(q(s.container, "[data-o-nhanh-moi]")!, { target: { value: "--x" } });
    expect(q(s.container, "[data-loi-ten-nhanh]")).not.toBeNull();
    expect(q(s.container, "[data-nut-tao-nhanh]")).toBeDisabled();
    fireEvent.change(q(s.container, "[data-o-nhanh-moi]")!, { target: { value: "sua-loi/1" } });
    fireEvent.click(q(s.container, "[data-nut-tao-nhanh]")!);
    expect(s.props.onTaoNhanh).toHaveBeenCalledWith("sua-loi/1");
  });
});

describe("Bảng Git — xem", () => {
  it("★★ bấm tên tệp ⇒ onXemTep; diff có ⇒ HunkDiffView vẽ dòng thêm; nhị phân ⇒ câu riêng", () => {
    const { container, props } = dung();
    fireEvent.click(q(container, '[data-xem-tep="src/a.ts"]')!);
    expect(props.onXemTep).toHaveBeenCalledWith("src/a.ts");
    cleanup();
    const d = dung({ tepXem: "src/a.ts", diff: { path: "src/a.ts", xy: " M", goc: "a\n", moi: "a\nb_moi\n", nhiPhan: false, catBot: false, daChe: false } });
    expect(q(d.container, "[data-git-diff]")!.textContent).toContain("b_moi");
    cleanup();
    const n = dung({ tepXem: "x.png", diff: { path: "x.png", xy: " M", goc: "", moi: "", nhiPhan: true, catBot: false, daChe: false } });
    expect(q(n.container, "[data-git-nhi-phan]")).not.toBeNull();
  });

  it("★★★ lỗi ⇒ băng lỗi mang MÃ, KHÔNG BAO GIỜ câu 'cây sạch'", () => {
    const { container } = dung({ tt: null, loi: "GIT_KHONG_PHAI_REPO" });
    expect(q(container, "[data-git-loi]")!.textContent).toContain("GIT_KHONG_PHAI_REPO");
    expect(q(container, "[data-git-sach]")).toBeNull();
    expect(screen.queryByText(tThat("repoWs.git.sach"))).toBeNull();
  });

  it("log + số mục bị ẩn hiện ra", () => {
    const { container } = dung();
    expect(q(container, "[data-git-log]")!.textContent).toContain("Khởi tạo");
    expect(container.textContent).toContain(tThat("repoWs.git.soAn", { n: 1 }));
  });
});

describe("i18n ba locale — repoWs.git", () => {
  it("★★★ mọi mã lỗi có câu ở vi/en/zh; mọi khoá repoWs.git.* của vi có ở en/zh cùng biến {{…}}", () => {
    const EN = LOC("en");
    const ZH = LOC("zh");
    for (const m of MA_LOI_GIT) for (const L of [VI, EN, ZH]) expect(typeof da(L, `repoWs.git.loi.${m}`), m).toBe("string");
    const phang = (o: any, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : phang(v, `${p}${k}.`)));
    const bien = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
    for (const k of phang(da(VI, "repoWs.git"), "repoWs.git.")) {
      for (const L of [EN, ZH]) {
        expect(typeof da(L, k), k).toBe("string");
        expect(bien(da(L, k)), k).toBe(bien(da(VI, k)));
      }
    }
  });
});
