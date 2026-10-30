// @vitest-environment jsdom
//
// R1b-2b-2b B-T5 (mục 3) — ca biên của ô chọn adapter trong hộp "Đặt kênh chế độ" (KenhCheDoMay):
//   (a) danh sách adapter tới SAU lần render đầu ⇒ chọn adapter của kênh hiện có (hoặc phần tử đầu), không kẹt null;
//   (b) kênh hiện có thuộc adapter KHÔNG nằm trong danh sách (kenhAn) ⇒ không chọn sẵn, hiện placeholder, Lưu khoá;
//   (c) danh sách rỗng ⇒ câu "không có adapter", Lưu khoá.
// Component THẬT + bundle vi.json THẬT; chỉ mock hợp đồng mạng.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const srv = vi.hoisted(() => ({ kenhInputs: [] as Array<{ adapterId: number }> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: vi.fn(), mapTrpcError: (e: unknown) => String(e) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ scadaKenh: { danhSach: { invalidate: vi.fn() }, cheDo: { danhSach: { invalidate: vi.fn() } } } }),
    scadaKenh: {
      danhSach: {
        useQuery: (i: { adapterId: number }, o?: { enabled?: boolean }) => {
          if (o?.enabled !== false) srv.kenhInputs.push(i);
          return { data: o?.enabled === false ? undefined : [{ tagKey: "MODE", dataType: "bool", isEnabled: true }], isLoading: false };
        },
      },
      cheDo: { dat: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) }, go: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    },
  },
}));

import { KenhCheDoMay, type AdapterChon, type HangCheDo } from "./KenhCheDoMay";

const S = (k: string): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return v;
};

const AD = (adapterId: number, code: string): AdapterChon => ({ adapterId, code, ten: code, machineId: 5, edge: false });

function may(over: Record<string, unknown>): HangCheDo {
  return {
    machineId: 5,
    code: "M-05",
    ten: "Máy 5",
    cheDo: "LOCAL",
    lyDo: "chua_khai",
    kenh: null,
    kenhAn: false,
    canhBaoNguon: null,
    ...over,
  } as unknown as HangCheDo;
}

const KENH_O_ADAPTER_2 = { adapterId: 2, tagKey: "MODE", giaTriRemote: 1 };

function moHop(rows: HangCheDo[], adapters: AdapterChon[]) {
  const r = render(<KenhCheDoMay rows={rows} adapters={adapters} canAct />);
  fireEvent.click(screen.getByRole("button", { name: S("scada.kenh.nut.datKenhCheDo") }));
  return r;
}
const hop = () => screen.getByRole("dialog");
const oChon = () => within(hop()).getByLabelText(S("scada.kenh.dialog.adapter")) as HTMLSelectElement;
const nutLuu = () => within(hop()).getByRole("button", { name: S("scada.kenh.dialog.gui") });

beforeEach(() => {
  initLayoutKitTestI18n();
  srv.kenhInputs = [];
});
afterEach(() => cleanup());

describe("HopDatKenhCheDo — ca biên ô chọn adapter", () => {
  it("(a) danh sách tới SAU lần render đầu ⇒ chọn adapter của kênh hiện có, không kẹt null", () => {
    const rows = [may({ kenh: KENH_O_ADAPTER_2, cheDo: "REMOTE", lyDo: "remote" })];
    const { rerender } = moHop(rows, []);
    rerender(<KenhCheDoMay rows={rows} adapters={[AD(1, "PLC-1"), AD(2, "PLC-2")]} canAct />);
    expect(oChon().value).toBe("2");
    expect(srv.kenhInputs.some((i) => i.adapterId === 2)).toBe(true);
  });

  it("(a') chưa có kênh nào, danh sách tới sau ⇒ chọn phần tử đầu", () => {
    const rows = [may({})];
    const { rerender } = moHop(rows, []);
    rerender(<KenhCheDoMay rows={rows} adapters={[AD(1, "PLC-1"), AD(2, "PLC-2")]} canAct />);
    expect(oChon().value).toBe("1");
    // trạng thái THẬT (không chỉ ô chọn hiển thị phần tử đầu): truy vấn tag đã bắn cho adapter 1
    expect(srv.kenhInputs.some((i) => i.adapterId === 1)).toBe(true);
  });

  it("(b) kenhAn ⇒ không chọn sẵn adapter nào, hiện placeholder, Lưu khoá", () => {
    moHop([may({ kenhAn: true })], [AD(1, "PLC-1")]);
    expect(oChon().value).toBe("");
    expect(within(hop()).getByText(S("scada.kenh.dialog.chonAdapter"))).toBeInTheDocument();
    expect(srv.kenhInputs).toHaveLength(0);
    expect(nutLuu()).toBeDisabled();
  });

  it("(c) danh sách rỗng ⇒ câu 'không có adapter', Lưu khoá", () => {
    moHop([may({})], []);
    expect(within(hop()).getByText(S("scada.kenh.dialog.khongCoAdapterMay"))).toBeInTheDocument();
    expect(nutLuu()).toBeDisabled();
  });
});
