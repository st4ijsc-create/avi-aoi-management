// @vitest-environment jsdom
//
// Đợt 10.2 bước 6 — AI Settings: khoá API THEO NHÀ MÁY. Ô nhà máy theo phạm vi người dùng; khoá thiếu nhà máy bị báo RÕ (không chết âm thầm); toast cảnh báo khi máy chủ trả kichHoat:false.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  keys: [] as unknown[],
  nhaMays: [] as unknown[],
  tao: [] as unknown[],
  traTao: { id: 1, kichHoat: true } as Record<string, unknown>,
  canhBao: [] as string[],
  thanhCong: [] as string[],
  bat: [] as unknown[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, def?: unknown) => (typeof def === "string" ? def : k),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: (m: string) => h.thanhCong.push(m), warning: (m: string) => h.canhBao.push(m), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: vi.fn(), mapTrpcError: () => "loi" }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/patterns", () => ({ PageHeader: () => null }));
vi.mock("@/lib/trpc", () => {
  const mut = (onSuccessRef?: (o: { onSuccess?: (r: unknown) => void }) => void) => (o: { onSuccess?: (r: unknown) => void }) => {
    onSuccessRef?.(o);
    return { mutate: vi.fn(), isPending: false };
  };
  return {
    trpc: {
      aiSettings: {
        listApiKeys: { useQuery: () => ({ data: h.keys, isLoading: false, refetch: vi.fn() }) },
        createApiKey: {
          useMutation: (o: { onSuccess?: (r: unknown) => void }) => ({
            mutate: (v: unknown) => {
              h.tao.push(v);
              o.onSuccess?.(h.traTao);
            },
            isPending: false,
          }),
        },
        deleteApiKey: { useMutation: mut() },
        testApiKey: { useMutation: mut() },
        toggleApiKey: { useMutation: (_o: unknown) => ({ mutate: (v: unknown) => h.bat.push(v), isPending: false }) },
        getConfig: { useQuery: () => ({ data: undefined, isLoading: true }) },
        updateConfig: { useMutation: mut() },
      },
      factory: { list: { useQuery: () => ({ data: h.nhaMays, isSuccess: true }) } },
      aiModel: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
    },
  };
});

import { AddApiKeyForm, ApiKeysSection } from "./AISettingsPage";
import { Dialog } from "@/components/ui/dialog";

const NM = [
  { id: 1, name: "Nhà máy A", code: "A" },
  { id: 2, name: "Nhà máy B", code: "B" },
];
const khoa = (o: Record<string, unknown>) => ({ id: 1, name: "k", provider: "openai", status: "active", factoryId: 1, maskedKey: "1234", endpoint: null, ...o });

beforeEach(() => {
  h.keys = [];
  h.nhaMays = NM;
  h.tao.length = 0;
  h.canhBao.length = 0;
  h.thanhCong.length = 0;
  h.bat.length = 0;
  h.traTao = { id: 1, kichHoat: true };
});
afterEach(cleanup);

function form(nhaMays: typeof NM, onSubmit = vi.fn()) {
  render(
    <Dialog open>
      <AddApiKeyForm onSubmit={onSubmit} isLoading={false} nhaMays={nhaMays} />
    </Dialog>,
  );
  fireEvent.change(screen.getByPlaceholderText("e.g. Production OpenAI Key"), { target: { value: "khoá" } });
  fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-abc" } });
  return onSubmit;
}

describe("AddApiKeyForm — nhà máy", () => {
  it("nhiều nhà máy: chưa chọn ⇒ cảnh báo khoá sẽ không hoạt động, KHÔNG gửi factoryId; chọn ⇒ gửi factoryId số", () => {
    const onSubmit = form(NM);
    expect(screen.getByTestId("khoa-canh-bao-nha-may")).toBeInTheDocument();
    fireEvent.submit(screen.getByTestId("khoa-nha-may").closest("form")!);
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty("factoryId");
    fireEvent.change(screen.getByTestId("khoa-nha-may"), { target: { value: "2" } });
    expect(screen.queryByTestId("khoa-canh-bao-nha-may")).toBeNull();
    fireEvent.submit(screen.getByTestId("khoa-nha-may").closest("form")!);
    expect(onSubmit.mock.calls[1]![0]).toMatchObject({ factoryId: 2, name: "khoá" });
  });
  it("đúng MỘT nhà máy trong phạm vi ⇒ chọn sẵn và gửi factoryId", () => {
    const onSubmit = form([NM[0]!]);
    expect((screen.getByTestId("khoa-nha-may") as HTMLSelectElement).value).toBe("1");
    fireEvent.submit(screen.getByTestId("khoa-nha-may").closest("form")!);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ factoryId: 1 });
  });
  it("người dùng không có nhà máy nào ⇒ không có ô (không chặn tạo)", () => {
    form([]);
    expect(screen.queryByTestId("khoa-nha-may")).toBeNull();
  });
});

describe("ApiKeysSection — hiển thị khoá theo nhà máy", () => {
  it("khoá có nhà máy ⇒ nhãn tên nhà máy; khoá inactive KHÔNG nhà máy ⇒ nhãn 'cần nhà máy' + công tắc vô hiệu", () => {
    h.keys = [khoa({ id: 1, factoryId: 2 }), khoa({ id: 2, status: "inactive", factoryId: null })];
    render(<ApiKeysSection />);
    expect(screen.getByTestId("khoa-nha-may-1")).toHaveTextContent("Nhà máy B");
    expect(screen.queryByTestId("khoa-can-nha-may-1")).toBeNull();
    expect(screen.getByTestId("khoa-can-nha-may-2")).toBeInTheDocument();
    expect(screen.getByTestId("khoa-bat-tat-2")).toBeDisabled();
    expect(screen.getByTestId("khoa-bat-tat-1")).not.toBeDisabled();
  });
  it("khoá active không nhà máy (dữ liệu cũ) vẫn tắt được", () => {
    h.keys = [khoa({ id: 3, status: "active", factoryId: null })];
    render(<ApiKeysSection />);
    expect(screen.getByTestId("khoa-bat-tat-3")).not.toBeDisabled();
    expect(screen.queryByTestId("khoa-can-nha-may-3")).toBeNull();
  });
});

describe("ApiKeysSection — tạo khoá: toast theo kichHoat của máy chủ", () => {
  async function taoQuaDialog() {
    render(<ApiKeysSection />);
    fireEvent.click(screen.getAllByText("Add API Key")[0]!);
    fireEvent.change(await screen.findByPlaceholderText("e.g. Production OpenAI Key"), { target: { value: "khoá" } });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-abc" } });
    fireEvent.submit(screen.getByTestId("khoa-nha-may").closest("form")!);
  }
  it("máy chủ trả kichHoat:false (thiếu nhà máy) ⇒ toast CẢNH BÁO, không toast thành công", async () => {
    h.traTao = { id: 9, kichHoat: false, lyDo: "can-nha-may" };
    await taoQuaDialog();
    expect(h.tao).toHaveLength(1);
    expect(h.canhBao).toHaveLength(1);
    expect(h.thanhCong).toHaveLength(0);
  });
  it("kichHoat:true ⇒ toast thành công, không cảnh báo", async () => {
    h.traTao = { id: 9, kichHoat: true };
    await taoQuaDialog();
    expect(h.thanhCong).toHaveLength(1);
    expect(h.canhBao).toHaveLength(0);
  });
});
