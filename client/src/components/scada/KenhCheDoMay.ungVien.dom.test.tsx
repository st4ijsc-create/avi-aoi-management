// @vitest-environment jsdom
//
// R1b-2b-2b B-T6 (mục 3, phần chờ) — cảnh báo NGUỒN cho tag ỨNG VIÊN ngay khi chọn tag trong hộp "Đặt kênh chế độ", TRƯỚC khi bấm Lưu.
// Máy chủ (C3) trả `canhBaoNguon` cho từng tag của `scadaKenh.danhSach`; client dùng cảnh báo của CHÍNH tag đang chọn. Cảnh báo không khoá nút Lưu.
// Component THẬT + bundle vi.json THẬT; chỉ mock hợp đồng mạng.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const srv = vi.hoisted(() => ({ tags: [] as Array<Record<string, unknown>> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: vi.fn(), mapTrpcError: (e: unknown) => String(e) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ scadaKenh: { danhSach: { invalidate: vi.fn() }, cheDo: { danhSach: { invalidate: vi.fn() } } } }),
    scadaKenh: {
      danhSach: { useQuery: (_i: unknown, o?: { enabled?: boolean }) => ({ data: o?.enabled === false ? undefined : srv.tags, isLoading: false }) },
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
const tag = (tagKey: string, canhBaoNguon: unknown) => ({ tagKey, dataType: "bool", isEnabled: true, canhBaoNguon });
const AD = (edge = false): AdapterChon => ({ adapterId: 1, code: "PLC-1", ten: "PLC-1", machineId: 5, edge });
const may = (over: Record<string, unknown> = {}): HangCheDo =>
  ({ machineId: 5, code: "M-05", ten: "Máy 5", cheDo: "LOCAL", lyDo: "chua_khai", kenh: null, kenhAn: false, canhBaoNguon: null, ...over }) as unknown as HangCheDo;

function moHop(m: HangCheDo, adapters: AdapterChon[] = [AD()]) {
  render(<KenhCheDoMay rows={[m]} adapters={adapters} canAct />);
  fireEvent.click(screen.getByRole("button", { name: S("scada.kenh.nut.datKenhCheDo") }));
}
const hop = () => screen.getByRole("dialog");
const chonTag = (k: string) => fireEvent.change(within(hop()).getByLabelText(S("scada.kenh.dialog.tag")), { target: { value: k } });
const canhBao = () => within(hop()).queryByTestId("canh-bao-nguon");

beforeEach(() => {
  initLayoutKitTestI18n();
  srv.tags = [tag("T_DB", "deadband"), tag("T_OK", null), tag("T_OPC", "bao_khi_doi"), tag("T_POLL", "poll_cham")];
});
afterEach(() => cleanup());

describe("HopDatKenhCheDo — cảnh báo nguồn của tag ỨNG VIÊN", () => {
  it("★ chọn tag canhBaoNguon 'deadband' ⇒ khối cảnh báo deadband hiện TRƯỚC khi bấm Lưu", () => {
    moHop(may());
    expect(canhBao()).toBeNull();
    chonTag("T_DB");
    expect(canhBao()).toBeInTheDocument();
    expect(canhBao()).toHaveTextContent(S("scada.kenh.canhBaoNguonLoai.deadband"));
  });

  it("tag canhBaoNguon null ⇒ không cảnh báo; đổi sang tag khác ⇒ cảnh báo đổi theo loại của tag đó", () => {
    moHop(may());
    chonTag("T_OK");
    expect(canhBao()).toBeNull();
    chonTag("T_OPC");
    expect(canhBao()).toHaveTextContent(S("scada.kenh.canhBaoNguonLoai.bao_khi_doi"));
    chonTag("T_POLL");
    expect(canhBao()).toHaveTextContent(S("scada.kenh.canhBaoNguonLoai.poll_cham"));
    chonTag("T_OK");
    expect(canhBao()).toBeNull();
  });

  it("★ máy có kênh hiện có cảnh báo 'deadband' nhưng ứng viên mới sạch ⇒ KHÔNG dùng lại cảnh báo của máy", () => {
    moHop(may({ kenh: { adapterId: 1, tagKey: "T_DB", giaTriRemote: 1 }, cheDo: "REMOTE", lyDo: "remote", canhBaoNguon: "deadband" }));
    expect(canhBao()).toHaveTextContent(S("scada.kenh.canhBaoNguonLoai.deadband")); // tag hiện có = T_DB, chính nó có cảnh báo
    chonTag("T_OK");
    expect(canhBao()).toBeNull();
  });

  it("adapter do edge sở hữu ⇒ 'edge' (kể cả tag chưa có cảnh báo riêng)", () => {
    srv.tags = [tag("T_OK", null)];
    moHop(may(), [AD(true)]);
    chonTag("T_OK");
    expect(canhBao()).toHaveTextContent(S("scada.kenh.canhBaoNguonLoai.edge"));
  });
});
