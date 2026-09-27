// @vitest-environment jsdom
//
// doc 81 Đợt 1C Task 4 fix round 1 (#7) — nút "Thiết bị được phép" trên dòng IOT_GATEWAY của tab Máy
// chỉ HIỆN cho người sửa được (admin/engineer có settings_factory canEdit — `DataSettings` tính cờ
// `canEditGatewayAllowlist`; máy chủ vẫn tự kiểm). Render `MachinesTab` THẬT; chỉ mock mạng (`@/lib/trpc`)
// và hook loại máy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useMachineTypes", () => ({ useMachineTypes: () => ({ types: [], byClass: {} }) }));
const { hook } = vi.hoisted(() => ({ hook: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    machine: {
      regenerateApiKey: { useMutation: hook },
      gatewayAllowlist: {
        get: { useQuery: () => ({ isLoading: true, isError: false, isFetchedAfterMount: false }) },
        set: { useMutation: hook },
      },
    },
  },
}));

import { MachinesTab } from "./MachinesTab";

const GW = { id: 10, stationId: 1, code: "GW-1", name: "Gateway 1", machineType: "IOT_GATEWAY" };
const SENSOR = { id: 11, stationId: 1, code: "DEV-A", name: "Device A", machineType: "IOT_SENSOR" };
const noop = () => {};
const m = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false } as never;

function ve(canEditGatewayAllowlist?: boolean) {
  return render(
    <MachinesTab
      filteredMachines={[GW, SENSOR]}
      machines={[GW, SENSOR]}
      machinesLoading={false}
      deletedMachines={[]}
      factories={[]}
      workshops={[]}
      lines={[]}
      stations={[{ id: 1, lineId: 1, code: "S1", name: "S1", orderIndex: 0 } as never]}
      machineTypes={["IOT_GATEWAY", "IOT_SENSOR"]}
      isAdmin={true}
      showDeleted={false}
      machineFilterStation="all"
      setMachineFilterStation={noop}
      machineFilterType="all"
      setMachineFilterType={noop}
      machineDialogOpen={false}
      setMachineDialogOpen={noop}
      machineForm={{ factoryId: "", workshopId: "", lineId: "", stationId: "", code: "", name: "", machineType: "AOI" as never, model: "", manufacturer: "", description: "" }}
      setMachineForm={noop}
      createMachineMutation={m}
      importMachinesMutation={m}
      exportMachinesMutation={m}
      refetchMachines={noop}
      copyToClipboard={noop}
      handleEditMachine={noop}
      setMachineToDelete={noop}
      setDeleteMachineDialogOpen={noop}
      restoreMachineMutation={m}
      {...(canEditGatewayAllowlist === undefined ? {} : { canEditGatewayAllowlist })}
    />,
  );
}

// MachinesTab kéo theo một i18next instance (tiếng Anh) qua cây import ⇒ nhận CẢ bản dịch lẫn khoá thô.
const NUT = /^(Allowed devices|machinesTab\.gatewayAllowlist)$/;

afterEach(() => cleanup());

describe("MachinesTab — nút allowlist gateway (fix #7)", () => {
  it("★ người KHÔNG sửa được (cờ false / vắng) ⇒ KHÔNG có nút trên dòng gateway", () => {
    ve(false);
    expect(screen.getByText("GW-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: NUT })).not.toBeInTheDocument();
    cleanup();
    ve(undefined);
    expect(screen.queryByRole("button", { name: NUT })).not.toBeInTheDocument();
  });

  it("admin/engineer (cờ true) ⇒ đúng MỘT nút, chỉ trên dòng IOT_GATEWAY", () => {
    ve(true);
    expect(screen.getAllByRole("button", { name: NUT }).length).toBe(1);
  });
});
