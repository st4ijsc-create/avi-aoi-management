// @vitest-environment jsdom
//
// Vai thiếu quyền KHÔNG được gọi thủ tục mà server sẽ trả FORBIDDEN trong thân batch (phép đo 8 vai × 18 trang của kiem-dinh, 10/11):
//   andon.active ← ShellAlertChip · commandCenter.hierarchy ← AssetScopeBar · oversight.posture ← RobotModuleProvider · commandCenter.kpiSummary ← Home.
// Mỗi ca: usePermissions().hasPermission = false ⇒ useQuery được gọi với enabled:false (hoặc không gọi); có quyền ⇒ enabled:true (admin không đổi).
// ĐỘT BIẾN PHẢI BẮT: bỏ `enabled` ở bất kỳ nơi nào · đổi tên module quyền · robot: thiếu quyền mà vẫn "bat"/"dang-tai".
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18next from "i18next";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const H = vi.hoisted(() => ({
  quyen: new Set<string>(),
  hoi: [] as Array<{ duongDan: string; opts: Record<string, unknown> | undefined }>,
  user: { id: 1, role: "engineer" } as { id: number; role: string } | null,
  taiXong: true,
  posture: { data: undefined as unknown, isLoading: false, isError: false },
  /** Giả lập dữ liệu CÒN TRONG CACHE từ lúc người dùng còn quyền (query đã tắt nhưng vẫn có data). */
  cayCache: false,
}));

function taoProxy(duongDan: string[]): unknown {
  return new Proxy(function () {}, {
    get(_t, khoa: string) {
      if (khoa === "useQuery") {
        return (_input: unknown, opts?: Record<string, unknown>) => {
          const dd = duongDan.join(".");
          H.hoi.push({ duongDan: dd, opts });
          if (dd === "oversight.posture") return { ...H.posture };
          if (dd === "commandCenter.hierarchy" && H.cayCache) {
            return { data: { sites: [{ id: "f1", refId: 1, name: "Xưởng A", kind: "factory", children: [] }] }, isSuccess: true, isError: false, isLoading: false };
          }
          return { data: undefined, isSuccess: false, isError: false, isLoading: false };
        };
      }
      if (khoa === "useMutation") return () => ({ mutate: vi.fn(), isPending: false });
      if (khoa === "useUtils") return () => taoProxy(["utils"]);
      if (khoa === "invalidate") return () => undefined;
      return taoProxy([...duongDan, khoa]);
    },
  });
}

vi.mock("@/lib/trpc", () => ({ trpc: taoProxy([]) }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: H.user, loading: false, isAuthenticated: !!H.user }),
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: (m: string, a = "canView") => H.taiXong && H.quyen.has(`${m}:${a}`),
    loading: !H.taiXong,
  }),
}));
vi.mock("@/contexts/AssetScopeContext", () => ({
  useAssetScope: () => ({ axis: {}, setAxis: vi.fn(), clearAxis: vi.fn() }),
}));
vi.mock("@/components/TodayBriefing", () => ({ TodayBriefing: () => null }));
vi.mock("@/components/FirstRunTour", () => ({ FirstRunTour: () => null }));
vi.mock("@/lib/roleLandingResolve", () => ({ resolveRoleLanding: async () => "/" }));

import { ShellAlertChip } from "./ShellAlertChip";
import { AssetScopeBar } from "./AssetScopeBar";
import Home from "@/pages/Home";
import { RobotModuleProvider, trangRobotModule, useRobotModuleTrang } from "@/hooks/useRobotModuleTamDung";

const lanGoi = (dd: string) => H.hoi.filter(h => h.duongDan === dd);

beforeAll(async () => {
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  H.quyen = new Set();
  H.hoi = [];
  H.user = { id: 1, role: "engineer" };
  H.taiXong = true;
  H.cayCache = false;
  H.posture = { data: undefined, isLoading: false, isError: false };
});
afterEach(() => cleanup());

describe("thiếu quyền ⇒ enabled:false (không phát thủ tục)", () => {
  it("ShellAlertChip: andon.active chỉ bật khi có andon:canView", () => {
    render(<ShellAlertChip />);
    expect(lanGoi("andon.active").map(h => h.opts?.enabled)).toEqual([false]);
    cleanup();
    H.hoi = [];
    H.quyen.add("andon:canView");
    render(<ShellAlertChip />);
    expect(lanGoi("andon.active").map(h => h.opts?.enabled)).toEqual([true]);
  });

  it("ShellAlertChip: quyền khác (machine_monitoring) không đủ cho andon", () => {
    H.quyen.add("machine_monitoring:canView");
    render(<ShellAlertChip />);
    expect(lanGoi("andon.active")[0].opts?.enabled).toBe(false);
  });

  it("AssetScopeBar: commandCenter.hierarchy chỉ bật khi có machine_monitoring:canView; thiếu quyền ⇒ không render gì (không spinner)", () => {
    const { container } = render(<AssetScopeBar />);
    expect(lanGoi("commandCenter.hierarchy")[0].opts?.enabled).toBe(false);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    H.hoi = [];
    H.quyen.add("machine_monitoring:canView");
    render(<AssetScopeBar />);
    expect(lanGoi("commandCenter.hierarchy")[0].opts?.enabled).toBe(true);
  });

  it("AssetScopeBar: mất quyền mà cache còn cây cũ ⇒ vẫn KHÔNG vẽ thanh phạm vi (có quyền thì vẽ)", () => {
    H.cayCache = true;
    const khong = render(<AssetScopeBar />);
    expect(khong.container).toBeEmptyDOMElement();
    cleanup();
    H.quyen.add("machine_monitoring:canView");
    const co = render(<AssetScopeBar />);
    expect(co.container).not.toBeEmptyDOMElement();
  });

  it("Home (PlantHealthStrip): commandCenter.kpiSummary chỉ bật khi có quyền; thiếu quyền ⇒ thông báo trung tính, không thẻ số", () => {
    render(<Home />);
    expect(lanGoi("commandCenter.kpiSummary").map(h => h.opts?.enabled)).toEqual([false]);
    expect(screen.getByText(i18next.t("home.kpiNoAccess"))).toBeInTheDocument();
    cleanup();
    H.hoi = [];
    H.quyen.add("machine_monitoring:canView");
    render(<Home />);
    expect(lanGoi("commandCenter.kpiSummary").map(h => h.opts?.enabled)).toEqual([true]);
    expect(screen.queryByText(i18next.t("home.kpiNoAccess"))).toBeNull();
  });

  it("RobotModuleProvider: oversight.posture chỉ bật khi đăng nhập + có quyền", () => {
    render(<RobotModuleProvider><span /></RobotModuleProvider>);
    expect(lanGoi("oversight.posture")[0].opts?.enabled).toBe(false);
    cleanup();
    H.hoi = [];
    H.quyen.add("machine_monitoring:canView");
    render(<RobotModuleProvider><span /></RobotModuleProvider>);
    expect(lanGoi("oversight.posture")[0].opts?.enabled).toBe(true);
  });
});

describe("★ bề mặt an toàn L-7: trạng thái mô-đun robot khi thiếu quyền", () => {
  function Doc() {
    return <span data-testid="trang">{useRobotModuleTrang()}</span>;
  }
  const dung = () => render(<RobotModuleProvider><Doc /></RobotModuleProvider>).getByTestId("trang").textContent;

  it("không quyền ⇒ tam-dung (không phải bat, không phải dang-tai)", () => {
    expect(dung()).toBe("tam-dung");
  });

  it("quyền CHƯA TẢI XONG ⇒ tam-dung", () => {
    H.quyen.add("machine_monitoring:canView");
    H.taiXong = false;
    expect(dung()).toBe("tam-dung");
  });

  it("có quyền + posture lỗi ⇒ tam-dung", () => {
    H.quyen.add("machine_monitoring:canView");
    H.posture = { data: undefined, isLoading: false, isError: true };
    expect(dung()).toBe("tam-dung");
  });

  it("có quyền + posture bật ⇒ bat; có quyền + đang tải ⇒ dang-tai (hành vi cũ không đổi)", () => {
    H.quyen.add("machine_monitoring:canView");
    H.posture = { data: { robotControlEnabled: true }, isLoading: false, isError: false };
    expect(dung()).toBe("bat");
    cleanup();
    H.posture = { data: undefined, isLoading: true, isError: false };
    expect(dung()).toBe("dang-tai");
  });

  it("chưa đăng nhập ⇒ bat như cũ (Provider không hỏi máy chủ)", () => {
    H.user = null;
    expect(dung()).toBe("bat");
  });

  it("hàm thuần trangRobotModule: thiếu quyền thắng mọi thứ khác", () => {
    const p = { coDangNhap: true, dangTai: false, loi: false, robotControlEnabled: true };
    expect(trangRobotModule({ ...p, coQuyen: false })).toBe("tam-dung");
    expect(trangRobotModule({ ...p, coQuyen: false, dangTai: true })).toBe("tam-dung");
    expect(trangRobotModule({ ...p, coQuyen: true })).toBe("bat");
    expect(trangRobotModule({ ...p, coQuyen: false, coDangNhap: false })).toBe("bat");
  });
});
