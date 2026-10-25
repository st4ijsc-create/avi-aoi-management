// @vitest-environment jsdom
//
// Xu hướng Cpk: Cpk KHÔNG xác định (NULL — dữ liệu hằng) KHÔNG được vẽ thành thanh 0 (đọc nhầm "không đạt"): dữ liệu đưa vào biểu đồ giữ `null`
// (Recharts bỏ thanh) và có chú giải; dữ liệu đủ ⇒ không chú giải.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/components/patterns", () => ({ chartAxisTick: {}, chartColor: () => "#000", chartGridProps: {}, chartTooltipStyle: {} }));
vi.mock("recharts", () => {
  const Rong = () => null;
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    BarChart: ({ data, children }: { data: unknown; children: ReactNode }) => <div data-testid="bieu-do" data-du-lieu={JSON.stringify(data)}>{children}</div>,
    Bar: Rong, CartesianGrid: Rong, Legend: Rong, ReferenceLine: Rong, Tooltip: Rong, XAxis: Rong, YAxis: Rong,
  };
});

import { CpkTrendChart } from "./CpkTrendChart";
import { duLieuXuHuongCpk } from "@/lib/spcCpkTrend";

afterEach(cleanup);

describe("CpkTrendChart", () => {
  it("★ Cpk NULL ⇒ dữ liệu biểu đồ giữ null (KHÔNG 0) + chú giải 'không xác định'; đảo thứ tự cũ → mới", () => {
    const { getByTestId } = render(<CpkTrendChart rows={[{ cpk: null, ppk: 1.1 }, { cpk: 1.5, ppk: 1.4 }]} />);
    const du = JSON.parse(getByTestId("bieu-do").getAttribute("data-du-lieu")!) as { i: number; cpk: number | null; ppk: number | null }[];
    expect(du).toEqual([{ i: 1, cpk: 1.5, ppk: 1.4 }, { i: 2, cpk: null, ppk: 1.1 }]);
    expect(du.some((d) => d.cpk === 0)).toBe(false);
    expect(getByTestId("cpk-khong-xac-dinh")).toHaveTextContent("spc.cpkKhongXacDinh");
  });

  it("dữ liệu đủ ⇒ không có chú giải; Cpk 0 THẬT (số) vẫn là 0, không bị nuốt thành null", () => {
    const { queryByTestId, getByTestId } = render(<CpkTrendChart rows={[{ cpk: 0, ppk: 0.2 }, { cpk: 1.4, ppk: 1.3 }]} />);
    expect(queryByTestId("cpk-khong-xac-dinh")).toBeNull();
    const du = JSON.parse(getByTestId("bieu-do").getAttribute("data-du-lieu")!) as { cpk: number | null }[];
    expect(du[1].cpk).toBe(0);
  });

  it("duLieuXuHuongCpk: NaN / undefined / chuỗi ⇒ null", () => {
    expect(duLieuXuHuongCpk([{ cpk: Number.NaN, ppk: undefined }]).diem).toEqual([{ i: 1, cpk: null, ppk: null }]);
  });
});
