// @vitest-environment jsdom
//
// Đợt 10.4 (T4) — bộ hiển thị DUY NHẤT kết quả AI ngoài: văn bản thuần (không phần tử nguy hiểm, không yêu cầu mạng), viTri chỉ chữ, Chép + cảnh báo, kiểm lại dữ liệu vào.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({ thanhCong: [] as string[], loi: [] as string[] }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, def?: unknown) => (typeof def === "string" ? def : _k) }),
}));
vi.mock("sonner", () => ({ toast: { success: (m: string) => h.thanhCong.push(m), error: (m: string) => h.loi.push(m) } }));

import { HienThiKetQuaNgoai } from "./HienThiKetQuaNgoai";

const GOC = { ketLuan: "can-sua", diem: 55, banChuanHoa: "echo ok\n", loi: [{ muc: "vua", moTa: "Thiếu kiểm tra", viTri: "src/a.cs:3" }], baiHocDeXuat: [{ noiDung: "Luôn kiểm null", phamVi: "du-an" }] };
const DOC = [
  "<img src=x onerror=alert(1)>",
  "<script>alert(1)</script>",
  "[a](javascript:alert(1))",
  "![x](https://evil.example/?c=ABC)",
  '<a href="javascript:alert(1)">bấm</a>',
  "<svg onload=alert(1)>",
  "<iframe src=//evil.example></iframe>",
  "<style>body{display:none}</style>",
];

let fetchSpy: ReturnType<typeof vi.fn>;
let anhTai: string[];
const GocImage = globalThis.Image;
beforeEach(() => {
  h.thanhCong.length = 0;
  h.loi.length = 0;
  fetchSpy = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchSpy);
  anhTai = [];
  vi.stubGlobal(
    "Image",
    class {
      set src(v: string) {
        anhTai.push(v);
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.Image = GocImage;
});

const nguyHiem = (c: HTMLElement) => c.querySelectorAll("img,script,svg,iframe,object,embed,style,link,form,input,video,audio,a[href]");

describe("HienThiKetQuaNgoai — XSS / prompt-injection ngược", () => {
  it.each(DOC)("payload %s ở MỌI trường chuỗi ⇒ hiển thị NGUYÊN VĂN, không phần tử nguy hiểm, không yêu cầu mạng", (p) => {
    const { container } = render(
      <HienThiKetQuaNgoai ketQua={{ ...GOC, banChuanHoa: p, loi: [{ muc: "nghiem-trong", moTa: p, viTri: p }], baiHocDeXuat: [{ noiDung: p, phamVi: "nguoi", viDu: p }] }} />,
    );
    expect(nguyHiem(container).length, "phần tử nguy hiểm").toBe(0);
    expect(screen.getByTestId("kdn-ban-chuan-hoa").textContent).toBe(p);
    expect(container.textContent).toContain(p.length > 40 ? p.slice(0, 40) : p);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(anhTai).toEqual([]);
  });
  it("viTri đường dẫn giả KHÔNG thành liên kết/nút; ký tự lạ thoát \\uXXXX", () => {
    const { container } = render(
      <HienThiKetQuaNgoai
        ketQua={{ ...GOC, loi: ["../../etc/passwd", "C:\\Windows\\system32", "\\\\server\\share", "file:///etc/passwd", "a\u0430.cs"].map((vt) => ({ muc: "nhe", moTa: "x", viTri: vt })) }}
      />,
    );
    const ds = screen.getAllByTestId("kdn-vi-tri").map((e) => e.textContent);
    expect(ds).toEqual(["../../etc/passwd", "C:\\Windows\\system32", "\\\\server\\share", "file:///etc/passwd", "a\\u0430.cs"]);
    expect(container.querySelectorAll("a, button[data-viTri], [role=link]").length).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("bidi override / zero-width trong chuỗi bị bỏ trước khi hiển thị", () => {
    render(<HienThiKetQuaNgoai ketQua={{ ...GOC, loi: [{ muc: "nhe", moTa: "ab\u202Ecd\u200Bef", viTri: "x\u202E.cs" }] }} />);
    expect(screen.getByTestId("kdn-loi").textContent).toContain("abcdef");
    expect(screen.getByTestId("kdn-loi").textContent).not.toMatch(/[\u202E\u200B]/);
  });
  it("đột biến hình dạng: dùng innerHTML thay text sẽ làm ca payload đỏ — kiểm: <img> trong <pre> là CHỮ", () => {
    const { container } = render(<HienThiKetQuaNgoai ketQua={{ ...GOC, banChuanHoa: "<img src=x onerror=alert(1)>" }} />);
    expect(container.querySelector("pre img")).toBeNull();
    expect(container.querySelector("pre")!.innerHTML).toContain("&lt;img");
  });
});

describe("HienThiKetQuaNgoai — nội dung", () => {
  it("hiện kết luận, điểm, lỗi theo mức, bản chuẩn hoá, bài học (chỉ đề xuất), cảnh báo Chép; KHÔNG có nút Áp dụng", () => {
    render(<HienThiKetQuaNgoai ketQua={GOC} vet={{ nhaCungCap: "anthropic", model: "m", tokenVao: 100, tokenRa: 50, chiPhiUocUsd: 0.0123, soLanGoi: 2 }} />);
    expect(screen.getByTestId("kdn-ket-luan").textContent).toBe("can-sua");
    expect(screen.getByTestId("kdn-diem").textContent).toContain("55/100");
    expect(screen.getByTestId("kdn-loi").textContent).toContain("Thiếu kiểm tra");
    expect(screen.getByTestId("kdn-bai-hoc").textContent).toContain("Luôn kiểm null");
    expect(screen.getByTestId("kdn-canh-bao-chep")).toBeInTheDocument();
    expect(screen.getByTestId("kdn-vet").textContent).toMatch(/anthropic · m · 100 → 50 token · ~\$0\.0123 · đã thử lại 1 lần/);
    expect(screen.queryByRole("button", { name: /áp dụng|apply/i })).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Chép"]);
  });
  it("tuBoNho ⇒ nhãn không tính phí lần nữa", () => {
    render(<HienThiKetQuaNgoai ketQua={GOC} vet={{ nhaCungCap: "a", model: "m", tokenVao: null, tokenRa: null, chiPhiUocUsd: null, tuBoNho: true }} />);
    expect(screen.getByTestId("kdn-vet").textContent).toContain("không tính phí lần nữa");
  });
  it("không có bản chuẩn hoá / lỗi / bài học ⇒ các mục đó không xuất hiện", () => {
    render(<HienThiKetQuaNgoai ketQua={{ ketLuan: "dat", diem: 100, loi: [], baiHocDeXuat: [] }} />);
    for (const id of ["kdn-loi", "kdn-ban-chuan-hoa", "kdn-bai-hoc", "kdn-chep"]) expect(screen.queryByTestId(id)).toBeNull();
  });
});

describe("HienThiKetQuaNgoai — Chép", () => {
  it("chỉ đặt clipboard ĐÚNG bản chuẩn hoá (đã làm sạch); không chèn đi đâu khác; toast", async () => {
    const ghi = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: ghi } });
    render(<HienThiKetQuaNgoai ketQua={{ ...GOC, banChuanHoa: "rm -rf /tmp/x\u202E\n" }} />);
    fireEvent.click(screen.getByTestId("kdn-chep"));
    await waitFor(() => expect(h.thanhCong).toHaveLength(1));
    expect(ghi).toHaveBeenCalledWith("rm -rf /tmp/x\n");
    expect(screen.getByTestId("kdn-chep").textContent).toBe("Đã chép");
  });
  it("clipboard bị từ chối ⇒ toast lỗi, không văng", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("chan"))) } });
    render(<HienThiKetQuaNgoai ketQua={GOC} />);
    fireEvent.click(screen.getByTestId("kdn-chep"));
    await waitFor(() => expect(h.loi).toHaveLength(1));
  });
});

describe("HienThiKetQuaNgoai — kiểm lại dữ liệu vào", () => {
  it.each([null, undefined, 5, "chuỗi", [], { ...GOC, ketLuan: "tot" }, { ...GOC, extra: 1 }, { ketLuan: "dat", diem: 90, loi: [{ muc: "nghiem-trong", moTa: "x" }], baiHocDeXuat: [] }])(
    "dữ liệu sai %#: hiện hộp báo không hợp lệ, KHÔNG render nội dung",
    (v) => {
      const { container } = render(<HienThiKetQuaNgoai ketQua={v} />);
      expect(screen.getByTestId("kdn-khong-hop-le")).toBeInTheDocument();
      expect(container.querySelector("[data-testid=kdn-ket-qua]")).toBeNull();
    },
  );
});
