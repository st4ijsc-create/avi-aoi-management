// @vitest-environment jsdom
//
// R1b-2b-2b B-T4 (mục 39) — ngăn tag M10: trang chỉ đòi machine_monitoring.canView, còn `scadaKenh.danhSach` đòi machine_control.canView.
// Người thiếu quyền kênh KHÔNG được bắn `scadaKenh.danhSach` (khỏi FORBIDDEN đỏ); thấy một dòng giải thích, giá trị tag vẫn hiện.
// Component THẬT + bundle vi.json THẬT; chỉ mock hợp đồng mạng, quyền và Faceplate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const srv = vi.hoisted(() => ({
  canViewKenh: true,
  kenhCalls: [] as Array<{ i: unknown; o?: { enabled?: boolean } }>,
}));

vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: false,
    hasPermission: (m: string, a: string) => (m === "machine_control" ? srv.canViewKenh && a === "canView" : a === "canView"),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: vi.fn(), mapTrpcError: (e: unknown) => String(e) }));
vi.mock("@/components/scada/Faceplate", () => ({ Faceplate: () => <div data-testid="faceplate-stub" /> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    scadaDiag: {
      tagCuaAdapter: {
        useQuery: () => ({
          isLoading: false,
          data: [{ tagKey: "SPD", address: "40001", v: 12, q: "good", stale: false, ageMs: 500, statusCode: null }],
        }),
      },
      mauTho: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    scadaKenh: {
      danhSach: {
        useQuery: (i: unknown, o?: { enabled?: boolean }) => {
          srv.kenhCalls.push({ i, o });
          return {
            data: o?.enabled === false ? undefined : [{ tagKey: "SPD", writable: true, isEnabled: true, loaiKenh: "output" }],
            isLoading: false,
            isError: false,
          };
        },
      },
    },
  },
}));

import { NganTagAdapter } from "./NganTagAdapter";
import type { HangDiag } from "./BangTruyenThong";

const HANG = {
  adapterId: 7,
  code: "PLC-7",
  protocol: "modbus",
  endpoint: "10.0.0.7:502",
  trangThai: "connected",
  soHuu: { loai: "server" },
  stale: false,
  lastOkAt: null,
} as unknown as HangDiag;

const render_ = () => render(<NganTagAdapter hang={HANG} now={Date.now()} canAct={false} onDong={() => undefined} />);
const kenhDuocBat = () => srv.kenhCalls.some((c) => c.o?.enabled !== false);

beforeEach(() => {
  initLayoutKitTestI18n();
  srv.canViewKenh = true;
  srv.kenhCalls = [];
});
afterEach(() => cleanup());

describe("NganTagAdapter — quyền xem kênh (mục 39)", () => {
  it("thiếu machine_control.canView ⇒ 0 lượt scadaKenh.danhSach được bật, có dòng giải thích, giá trị tag vẫn hiện", () => {
    srv.canViewKenh = false;
    render_();
    expect(kenhDuocBat()).toBe(false);
    expect(screen.getByText(vi_.scada.diag.khongQuyenKenh)).toBeInTheDocument();
    expect(screen.getByTestId("gia-tri")).toHaveTextContent("12");
  });

  it("có quyền ⇒ đúng một lượt scadaKenh.danhSach được bật, KHÔNG có dòng giải thích", () => {
    render_();
    expect(srv.kenhCalls.filter((c) => c.o?.enabled !== false).every((c) => (c.i as { adapterId: number }).adapterId === 7)).toBe(true);
    expect(kenhDuocBat()).toBe(true);
    expect(screen.queryByText(vi_.scada.diag.khongQuyenKenh)).not.toBeInTheDocument();
  });
});

describe("NganTagAdapter — chi tiết bị che (C2, kiem-dinh u17/u18)", () => {
  const moVoi = (over: Record<string, unknown>) =>
    render(<NganTagAdapter hang={{ ...HANG, ...over } as unknown as HangDiag} now={Date.now()} canAct={false} onDong={() => undefined} />);

  it("★ endpoint null ⇒ '—' ở đầu ngăn (không 'null'); tamKhoa vẫn hiện huy hiệu", () => {
    moVoi({ endpoint: null, tamKhoa: { ma: "OT_MC_TAM_KHOA", lyDo: "errors.reason.otMcTamKhoa" } });
    expect(screen.getByTestId("endpoint-ngan-tag")).toHaveTextContent(/^—$/);
    expect(screen.getByTestId("tam-khoa-adapter-7")).toHaveTextContent(vi_.scada.diag.tamKhoa);
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it("kỹ sư: endpoint thật hiện nguyên văn; tamKhoa null ⇒ không huy hiệu", () => {
    moVoi({ tamKhoa: null });
    expect(screen.getByTestId("endpoint-ngan-tag")).toHaveTextContent("10.0.0.7:502");
    expect(screen.queryByTestId("tam-khoa-adapter-7")).toBeNull();
  });
});
