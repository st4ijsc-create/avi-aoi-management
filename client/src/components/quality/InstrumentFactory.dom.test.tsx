// @vitest-environment jsdom
//
// ★★★ 2026-10-25 — NHÀ MÁY SỞ HỮU CỦA THIẾT BỊ ĐO (migration 0421): ô chọn (chỉ admin) · cột "Nhà máy" trong danh sách · cảnh báo nhẹ cho thiết bị chưa gán
// ("chỉ quản trị thấy cho tới khi gán nhà máy") · chọn ở chi tiết ⇒ measurementInstrument.update({ id, factoryId }) · i18n ba locale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const H = vi.hoisted(() => ({
  user: { role: "admin" } as { role: string } | null,
  instruments: [] as any[],
  factories: [] as any[],
  update: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: unknown) => (typeof o === "object" && o && "count" in (o as object) ? `${k}:${(o as { count: number }).count}` : k),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ mapTrpcError: () => "loi", toastTrpcError: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: H.user }) }));
vi.mock("@/lib/trpc", () => {
  const q = (get: () => unknown) => ({ useQuery: () => ({ data: get(), isLoading: false, isError: false }) });
  const lenh = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  const inval = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn() }) }) });
  return {
    trpc: {
      useUtils: () => inval,
      measurementInstrument: { list: q(() => H.instruments), update: { useMutation: () => ({ mutate: H.update, isPending: false }) } },
      factory: { list: q(() => H.factories) },
      instrumentCalibration: { health: q(() => ({ status: "ok", calValidUntil: null, msaValidUntil: null })), list: q(() => []), create: lenh },
      instrumentMsaRecord: { list: q(() => []) },
    },
  };
});

import { CanhBaoChuaGanNhaMay, OChonNhaMayThietBi, TheNhaMayThietBi } from "./InstrumentFactory";
import { InstrumentCalibrationPanel } from "./InstrumentCalibrationPanel";

afterEach(cleanup);
beforeEach(() => {
  H.user = { role: "admin" };
  H.factories = [
    { id: 1, code: "NM1", name: "Nhà máy 1" },
    { id: 2, code: "NM2", name: "Nhà máy 2" },
  ];
  H.instruments = [
    { id: 10, code: "TB-A", name: "Thước A", instrumentType: "caliper", factoryId: 1, nextCalibrationAt: null },
    { id: 11, code: "TB-X", name: "Thước chưa gán", instrumentType: "caliper", factoryId: null, nextCalibrationAt: null },
    { id: 12, code: "TB-Y", name: "Thước chưa gán 2", instrumentType: "caliper", factoryId: null, nextCalibrationAt: null },
  ];
  H.update.mockClear();
});
const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLElement | null;

describe("mảnh thuần", () => {
  it("TheNhaMayThietBi — có nhà máy ⇒ tên; chưa gán ⇒ nhãn cảnh báo kèm gợi ý", () => {
    const a = render(<TheNhaMayThietBi factoryId={2} factories={H.factories} />);
    expect(q(a.container, "[data-the-nha-may-thiet-bi]")).toHaveTextContent("Nhà máy 2");
    cleanup();
    const b = render(<TheNhaMayThietBi factoryId={null} factories={H.factories} />);
    const nhan = q(b.container, "[data-chua-gan-nha-may]");
    expect(nhan).toHaveTextContent("instrumentCal.factory.unassigned");
    expect(nhan).toHaveAttribute("title", "instrumentCal.factory.unassignedHint");
  });
  it("OChonNhaMayThietBi — chọn ⇒ onChange(id); chọn 'chưa gán' ⇒ onChange(null)", () => {
    const onChange = vi.fn();
    const { container } = render(<OChonNhaMayThietBi value={null} factories={H.factories} onChange={onChange} />);
    const o = q(container, "[data-o-chon-nha-may-thiet-bi]") as HTMLSelectElement;
    expect(o.options).toHaveLength(3);
    fireEvent.change(o, { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.change(o, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
  it("CanhBaoChuaGanNhaMay — 0 ⇒ không vẽ; >0 ⇒ nêu số lượng", () => {
    const a = render(<CanhBaoChuaGanNhaMay soLuong={0} />);
    expect(q(a.container, "[data-canh-bao-chua-gan-nha-may]")).toBeNull();
    cleanup();
    const b = render(<CanhBaoChuaGanNhaMay soLuong={3} />);
    expect(q(b.container, "[data-canh-bao-chua-gan-nha-may]")).toHaveTextContent("instrumentCal.factory.unassignedBanner:3");
  });
});

describe("màn quản trị thiết bị đo (InstrumentCalibrationPanel)", () => {
  it("★★★ admin: cột 'Nhà máy' trong danh sách + nhãn cảnh báo ở thiết bị chưa gán + băng cảnh báo đếm đúng 2 (3 thiết bị, 1 đã gán)", () => {
    const { container } = render(<InstrumentCalibrationPanel />);
    expect(container.textContent).toContain("instrumentCal.factoryColumn");
    expect(container.textContent).toContain("Nhà máy 1");
    expect(container.querySelectorAll("[data-chua-gan-nha-may]")).toHaveLength(2);
    expect(q(container, "[data-canh-bao-chua-gan-nha-may]")).toHaveTextContent("instrumentCal.factory.unassignedBanner:2");
  });
  it("★★★ admin chọn một dòng ⇒ ô chọn nhà máy hiện, đổi ⇒ measurementInstrument.update({ id, factoryId })", () => {
    const { container } = render(<InstrumentCalibrationPanel />);
    expect(q(container, "[data-o-chon-nha-may-thiet-bi]")).toBeNull();
    fireEvent.click(container.querySelectorAll("tbody tr")[1]); // TB-X (chưa gán)
    const o = q(container, "[data-o-chon-nha-may-thiet-bi]") as HTMLSelectElement;
    expect(o).not.toBeNull();
    expect(o.value).toBe("");
    fireEvent.change(o, { target: { value: "2" } });
    expect(H.update).toHaveBeenCalledWith({ id: 11, factoryId: 2 });
    fireEvent.change(o, { target: { value: "" } });
    expect(H.update).toHaveBeenLastCalledWith({ id: 11, factoryId: null });
  });
  it("★★★ KHÔNG phải admin ⇒ có cột nhà máy nhưng KHÔNG có ô chọn và KHÔNG có băng cảnh báo", () => {
    H.user = { role: "supervisor" };
    const { container } = render(<InstrumentCalibrationPanel />);
    expect(container.textContent).toContain("Nhà máy 1");
    expect(q(container, "[data-canh-bao-chua-gan-nha-may]")).toBeNull();
    fireEvent.click(container.querySelectorAll("tbody tr")[0]);
    expect(q(container, "[data-o-chon-nha-may-thiet-bi]")).toBeNull();
  });
});

describe("i18n — đủ khoá ở ba locale", () => {
  const goc = resolve(dirname(fileURLToPath(import.meta.url)), "../../i18n/locales");
  for (const lg of ["vi", "en", "zh"]) {
    it(`${lg}: instrumentCal.factoryColumn + factory.{label,unassigned,unassignedHint,unassignedBanner}`, () => {
      const j = JSON.parse(readFileSync(join(goc, `${lg}.json`), "utf8"));
      const ic = j.instrumentCal;
      expect(ic.factoryColumn).toBeTruthy();
      for (const k of ["label", "unassigned", "unassignedHint", "unassignedBanner"]) expect(ic.factory[k], `${lg}.${k}`).toBeTruthy();
      expect(ic.factory.unassignedBanner).toContain("{{count}}");
    });
  }
});
