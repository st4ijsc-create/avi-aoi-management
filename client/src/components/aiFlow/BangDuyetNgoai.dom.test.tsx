// @vitest-environment jsdom
//
// Đợt 10.4 (T5) — bảng duyệt phiên bản luồng có node AI ngoài: hiện cái đang duyệt TRƯỚC nút Duyệt; chỉ admin có nút; tự duyệt luồng vận hành bị khoá + nói trước; luồng toàn hệ thống; văn bản thuần.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({ goi: [] as unknown[], toasts: [] as string[], loi: [] as unknown[], tra: { ok: true, tuDuyet: false, bam: "x", daDuyetTruoc: false } as Record<string, unknown>, lamLoi: false }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === "string" ? d : k) }) }));
vi.mock("sonner", () => ({ toast: { success: (m: string) => h.toasts.push(m), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: (e: unknown) => h.loi.push(e), mapTrpcError: () => "loi" }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    aiNgoai: {
      duyetNgoai: {
        useMutation: (o: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => ({
          isPending: false,
          mutate: (v: unknown) => {
            h.goi.push(v);
            if (h.lamLoi) o.onError?.(new Error("NGOAI_TU_DUYET_VAN_HANH"));
            else o.onSuccess?.(h.tra);
          },
        }),
      },
    },
  },
}));

import { BangDuyetNgoai, type TomTatNgoai } from "./BangDuyetNgoai";

const NODE = { nodeId: "kd1", nhaCungCap: "openai_compat", model: "gpt-x", mucTinh: "ke-thua" as const, tomTatLenh: "Kiểm tra <img src=x onerror=alert(1)> đoạn mã" };
const NG = (o: Partial<Extract<TomTatNgoai, { coNodeNgoai: true }>> = {}): TomTatNgoai => ({
  coNodeNgoai: true,
  daDuyet: false,
  tuDuyet: false,
  toanHeThong: false,
  taoBoi: 5,
  mucTinhLuong: "ky-thuat",
  nodes: [NODE],
  ...o,
});
const dung = (ngoai: TomTatNgoai | undefined, p: Partial<{ laAdmin: boolean; nguoiDungId: number | null; dirty: boolean; version: number | null }> = {}, onDaDuyet = vi.fn()) =>
  render(<BangDuyetNgoai flowId="f1" version={p.version === undefined ? 3 : p.version} ngoai={ngoai} laAdmin={p.laAdmin ?? true} nguoiDungId={p.nguoiDungId === undefined ? 9 : p.nguoiDungId} dirty={p.dirty} onDaDuyet={onDaDuyet} />);

beforeEach(() => {
  h.goi.length = 0;
  h.toasts.length = 0;
  h.loi.length = 0;
  h.lamLoi = false;
  h.tra = { ok: true, tuDuyet: false, bam: "x", daDuyetTruoc: false };
});
afterEach(cleanup);

describe("BangDuyetNgoai", () => {
  it("không có node ngoài / chưa có dữ liệu ⇒ KHÔNG render", () => {
    expect(dung(undefined).container.innerHTML).toBe("");
    cleanup();
    expect(dung({ coNodeNgoai: false }).container.innerHTML).toBe("");
  });
  it("hiện cái đang duyệt: node · nhà cung cấp · model · mức tĩnh · tóm tắt lệnh (văn bản thuần) · người tạo · mức cả luồng", () => {
    const { container } = dung(NG({ mucTinhLuong: "van-hanh" }));
    expect(screen.getByTestId("bdn-node-kd1").textContent).toContain("openai_compat · gpt-x");
    expect(screen.getByTestId("bdn-node-kd1").textContent).toContain("ke-thua");
    expect(screen.getByTestId("bdn-node-kd1").textContent).toContain("Kiểm tra <img src=x onerror=alert(1)> đoạn mã");
    expect(container.querySelector("img, script, a[href]")).toBeNull();
    expect(screen.getByTestId("bdn-tao-boi").textContent).toContain("#5");
    expect(screen.getByTestId("bdn-muc-luong").textContent).toContain("vận hành");
    expect(screen.getByTestId("bdn-trang-thai").textContent).toContain("Chưa duyệt");
  });
  it("admin: bấm Duyệt ⇒ aiNgoai.duyetNgoai({flowId, version}) đúng MỘT lần + onDaDuyet + toast", () => {
    const onDaDuyet = vi.fn();
    dung(NG(), {}, onDaDuyet);
    fireEvent.click(screen.getByTestId("bdn-nut-duyet"));
    expect(h.goi).toEqual([{ flowId: "f1", version: 3 }]);
    expect(onDaDuyet).toHaveBeenCalledTimes(1);
    expect(h.toasts).toHaveLength(1);
  });
  it("KHÔNG phải admin ⇒ không có nút Duyệt, có hướng dẫn nhờ admin (máy chủ vẫn kiểm)", () => {
    dung(NG(), { laAdmin: false });
    expect(screen.queryByTestId("bdn-nut-duyet")).toBeNull();
    expect(screen.getByTestId("bdn-nho-admin")).toBeInTheDocument();
  });
  it("tự duyệt luồng có dữ liệu VẬN HÀNH ⇒ nút khoá + nói trước; gọi tay vẫn không gửi", () => {
    dung(NG({ taoBoi: 9, mucTinhLuong: "van-hanh" }), { nguoiDungId: 9 });
    expect(screen.getByTestId("bdn-nut-duyet")).toBeDisabled();
    expect(screen.getByTestId("bdn-cam-tu-duyet")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("bdn-nut-duyet"));
    expect(h.goi).toEqual([]);
  });
  it("tự duyệt luồng KỸ THUẬT ⇒ cho phép nhưng cảnh báo sẽ ghi nhận TỰ DUYỆT", () => {
    dung(NG({ taoBoi: 9, mucTinhLuong: "ky-thuat" }), { nguoiDungId: 9 });
    expect(screen.getByTestId("bdn-nut-duyet")).toBeEnabled();
    expect(screen.getByTestId("bdn-canh-bao-tu-duyet")).toBeInTheDocument();
    expect(screen.queryByTestId("bdn-cam-tu-duyet")).toBeNull();
  });
  it("người tạo khác (admin khác) ⇒ không cảnh báo tự duyệt", () => {
    dung(NG({ taoBoi: 5 }), { nguoiDungId: 9 });
    expect(screen.queryByTestId("bdn-canh-bao-tu-duyet")).toBeNull();
    expect(screen.queryByTestId("bdn-cam-tu-duyet")).toBeNull();
  });
  it("đã duyệt ⇒ huy hiệu Đã duyệt + người/lúc duyệt; không còn nút Duyệt; cờ Tự duyệt hiện khi tuDuyet", () => {
    dung(NG({ daDuyet: true, duyetBoi: 7, duyetLuc: "2026-10-27T03:04:05.000Z", tuDuyet: true }));
    expect(screen.getByTestId("bdn-trang-thai").textContent).toContain("Đã duyệt");
    expect(screen.getByTestId("bdn-duyet-boi").textContent).toContain("#7");
    expect(screen.getByTestId("bdn-duyet-boi").textContent).toContain("2026-10-27 03:04");
    expect(screen.getByTestId("bdn-tu-duyet")).toBeInTheDocument();
    expect(screen.queryByTestId("bdn-nut-duyet")).toBeNull();
  });
  it("luồng toàn hệ thống ⇒ báo không dùng được AI ngoài + nút khoá", () => {
    dung(NG({ toanHeThong: true }));
    expect(screen.getByTestId("bdn-toan-he-thong")).toBeInTheDocument();
    expect(screen.getByTestId("bdn-nut-duyet")).toBeDisabled();
  });
  it("có thay đổi CHƯA LƯU ⇒ nút khoá + nhắc lưu trước; chưa có phiên bản ⇒ khoá", () => {
    dung(NG(), { dirty: true });
    expect(screen.getByTestId("bdn-nut-duyet")).toBeDisabled();
    expect(screen.getByTestId("bdn-chua-luu")).toBeInTheDocument();
    cleanup();
    dung(NG(), { version: null });
    expect(screen.getByTestId("bdn-nut-duyet")).toBeDisabled();
  });
  it("máy chủ từ chối (NGOAI_TU_DUYET_VAN_HANH…) ⇒ toastTrpcError, KHÔNG gọi onDaDuyet", () => {
    h.lamLoi = true;
    const onDaDuyet = vi.fn();
    dung(NG(), {}, onDaDuyet);
    fireEvent.click(screen.getByTestId("bdn-nut-duyet"));
    expect(h.loi).toHaveLength(1);
    expect(onDaDuyet).not.toHaveBeenCalled();
  });
  it("daDuyetTruoc ⇒ toast 'đã duyệt từ trước' (không nói duyệt mới)", () => {
    h.tra = { ok: true, tuDuyet: false, bam: "x", daDuyetTruoc: true };
    dung(NG());
    fireEvent.click(screen.getByTestId("bdn-nut-duyet"));
    expect(h.toasts[0]).toContain("từ trước");
  });
});
