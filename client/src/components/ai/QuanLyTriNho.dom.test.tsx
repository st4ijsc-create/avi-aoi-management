// @vitest-environment jsdom
//
// ★★★ Đợt 3b — MÀN QUẢN LÝ TRÍ NHỚ (ruột `NoiDungQuanLyTriNho`, thuần theo props): danh sách đánh số · thêm · sửa tại
// chỗ · xoá · cờ tắt ⇒ băng nói thật · lỗi tải ⇒ băng lỗi (KHÔNG BAO GIỜ "chưa có bài học") · i18n ba locale.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { NoiDungQuanLyTriNho, cauNoteTriNho, type NoiDungQuanLyTriNhoProps } from "./QuanLyTriNho";

afterEach(cleanup);
const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLElement | null;
const ID = "11111111-2222-3333-4444-555555555555";

function dung(p: Partial<NoiDungQuanLyTriNhoProps> = {}) {
  const props: NoiDungQuanLyTriNhoProps = {
    baiHoc: [{ id: ID, noiDung: "Dùng bcryptjs cho mật khẩu", updatedAt: "2026-10-17T00:00:00Z", mucRuiRo: "none" }],
    tran: 200,
    batTrongPrompt: true,
    dangTai: false,
    loiTai: null,
    dangBan: false,
    onThem: vi.fn(async () => true),
    onSua: vi.fn(async () => true),
    onXoa: vi.fn(),
    ...p,
  };
  return { ...render(<NoiDungQuanLyTriNho {...props} />), props };
}

describe("Quản lý trí nhớ", () => {
  it("★★★ thêm ⇒ onThem(chữ) và ô xoá trắng khi thành công", async () => {
    const { container, props } = dung();
    const o = q(container, "[data-o-bai-hoc-moi]") as HTMLTextAreaElement;
    fireEvent.change(o, { target: { value: "Không sửa tệp migration cũ" } });
    fireEvent.click(q(container, "[data-nut-them-bai-hoc]")!);
    await waitFor(() => expect(props.onThem).toHaveBeenCalledWith("Không sửa tệp migration cũ"));
    await waitFor(() => expect(o.value).toBe(""));
  });

  it("★★★ sửa tại chỗ ⇒ onSua(id, bản mới); xoá ⇒ onXoa(id)", async () => {
    const { container, props } = dung();
    fireEvent.click(q(container, `[data-nut-sua-bai-hoc="${ID}"]`)!);
    const o = q(container, "[data-o-sua-bai-hoc]") as HTMLTextAreaElement;
    expect(o.value).toBe("Dùng bcryptjs cho mật khẩu");
    fireEvent.change(o, { target: { value: "Dùng argon2" } });
    fireEvent.click(q(container, "[data-nut-luu-bai-hoc]")!);
    await waitFor(() => expect(props.onSua).toHaveBeenCalledWith(ID, "Dùng argon2"));
    await waitFor(() => expect(q(container, "[data-o-sua-bai-hoc]")).toBeNull());
    fireEvent.click(q(container, `[data-nut-xoa-bai-hoc="${ID}"]`)!);
    expect(props.onXoa).toHaveBeenCalledWith(ID);
  });

  it("★★★ lỗi tải ⇒ băng lỗi, KHÔNG câu 'chưa có bài học'; rỗng thật ⇒ câu rỗng; cờ tắt ⇒ băng", () => {
    const a = dung({ baiHoc: [], loiTai: "FORBIDDEN" });
    expect(q(a.container, "[data-tri-nho-loi]")).not.toBeNull();
    expect(q(a.container, "[data-tri-nho-rong]")).toBeNull();
    cleanup();
    const b = dung({ baiHoc: [] });
    expect(q(b.container, "[data-tri-nho-rong]")).not.toBeNull();
    cleanup();
    const c = dung({ batTrongPrompt: false });
    expect(q(c.container, "[data-tri-nho-tat]")).not.toBeNull();
  });

  it("cauNoteTriNho: mã đã biết ⇒ khoá riêng; mã lạ ⇒ khoá chung", () => {
    const t = (k: string) => k;
    expect(cauNoteTriNho("LESSON_RISKY", t)).toBe("repoWs.triNho.note.LESSON_RISKY");
    expect(cauNoteTriNho("ZZZ", t)).toBe("repoWs.triNho.note.khac");
  });

  it("★★ i18n: mọi khoá repoWs.triNho/tep/anh + sessions mới có ở vi/en/zh, cùng biến {{…}}", () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const LOC = (l: string) => JSON.parse(readFileSync(join(resolve(HERE, "..", ".."), "i18n", "locales", `${l}.json`), "utf8"));
    const [VI, EN, ZH] = ["vi", "en", "zh"].map(LOC);
    const da = (o: any, k: string) => k.split(".").reduce<any>((x, p) => (x == null ? undefined : x[p]), o);
    const phang = (o: any, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : phang(v, `${p}${k}.`)));
    const bien = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
    const khoa = [
      ...phang(da(VI, "repoWs.triNho"), "repoWs.triNho."),
      ...phang(da(VI, "repoWs.tep"), "repoWs.tep."),
      ...phang(da(VI, "repoWs.anh"), "repoWs.anh."),
      ...["rename", "renamePh", "renameSave", "renameFailed", "terminalNote", "terminalRestored"].map((k) => `repoWs.sessions.${k}`),
      "repoWs.pane.gitTab",
    ];
    expect(khoa.length).toBeGreaterThan(60);
    for (const k of khoa) {
      expect(typeof da(VI, k), k).toBe("string");
      for (const L of [EN, ZH]) {
        expect(typeof da(L, k), k).toBe("string");
        expect(bien(da(L, k)), k).toBe(bien(da(VI, k)));
      }
    }
  });
});
