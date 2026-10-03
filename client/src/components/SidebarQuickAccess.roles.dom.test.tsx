// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 15 (§1.4) — lối tắt "Ghim / Gần đây" trên thanh bên cũng là ĐIỀU HƯỚNG: một công cụ soạn thảo
// (IR / POU — `authoringPermission`) đã ghim hoặc đã mở trước đây KHÔNG được hiện cho người không soạn được
// (operator/viewer), dù route của nó vẫn mở chế độ chỉ-xem như cũ. Màn giám sát vẫn hiện.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { resolvePermissionModule } from "@shared/permissions";

const P: { modules: string[] } = { modules: [] };
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: false,
    hasPermission: (m: string, a: string) => a === "canView" && P.modules.includes(resolvePermissionModule(m)),
  }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { SidebarQuickAccess } from "./SidebarQuickAccess";

function renderQa() {
  const loc = memoryLocation({ path: "/somewhere" });
  return render(
    <Router hook={loc.hook} searchHook={loc.searchHook}>
      <SidebarQuickAccess onNavigate={() => {}} />
    </Router>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("nav-favorites", JSON.stringify(["/ir-editor", "/safety-workforce"]));
  localStorage.setItem("nav-recent", JSON.stringify(["/pou-studio", "/fleet-orchestration"]));
});
afterEach(() => cleanup());

describe("SidebarQuickAccess — cổng điều hướng của công cụ soạn thảo", () => {
  it("operator (chỉ machine_status): Ghim/Gần đây KHÔNG có IR / POU; vẫn có Safety / Fleet", () => {
    P.modules = ["machine_status"];
    renderQa();
    expect(screen.getByText("nav.safetyWorkforce")).toBeInTheDocument();
    expect(screen.getByText("nav.fleetOrchestration")).toBeInTheDocument();
    expect(screen.queryByText("nav.irEditor")).toBeNull();
    expect(screen.queryByText("nav.pouStudio")).toBeNull();
  });

  it("engineer (có machine_control): vẫn thấy IR / POU như trước", () => {
    P.modules = ["machine_status", "machine_control"];
    renderQa();
    expect(screen.getByText("nav.irEditor")).toBeInTheDocument();
    expect(screen.getByText("nav.pouStudio")).toBeInTheDocument();
  });
});
