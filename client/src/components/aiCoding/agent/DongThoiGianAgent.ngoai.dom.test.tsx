// @vitest-environment jsdom
//
// Đợt 10.4b L4 — lượt agent bằng model NGOÀI trên dòng thời gian: huy hiệu «Model ngoài» + mức; dòng Dừng nói ĐÚNG (không hứa dừng ngay);
// dòng vết `xong.vetNgoai`; hạ tự trị do PHIÊN có lượt ngoài (không phải "nội dung đáng ngờ"); KHÔNG vẽ thẻ agent con khi nguồn ngoài (d1);
// lượt model CỤC BỘ y như cũ.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";

function noiSuy(s: string, o?: Record<string, unknown>): string {
  return o ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k] ?? "")) : s;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, a?: unknown, b?: unknown) => (typeof a === "string" ? noiSuy(a, b as Record<string, unknown>) : k) }),
}));
vi.mock("streamdown", () => ({ Streamdown: (p: { children: string }) => <div data-md="1">{p.children}</div> }));
vi.mock("@/components/diff/HunkDiffView", () => ({ HunkDiffView: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: { aiChonModel: { danhMuc: { useQuery: () => ({ data: undefined }) } } } }));

import { DongThoiGianAgent } from "./DongThoiGianAgent";
import { batDauGui, giamSuKien, type TrangThaiAgent } from "./trangThaiAgent";
import type { HookAgent } from "./useLuotChayAgent";

const chay = (es: SuKienAgent[]) => es.reduce(giamSuKien, batDauGui("hỏi", "hoi"));
const hook = (tt: TrangThaiAgent): HookAgent =>
  ({
    trangThai: tt, matKetNoi: null, loiThaoTac: null, dangGuiDuyet: null, dangHoanTac: false, ketQuaHoanTac: null, luotDangChayCu: null,
    gui: vi.fn(), dung: vi.fn(), noiLai: vi.fn(), duyet: vi.fn(), bac: vi.fn(), hoanTac: vi.fn(), quyetDeXuatNho: vi.fn(),
    quyetKeHoach: vi.fn(), lamMoiKeHoach: vi.fn(), datLai: vi.fn(),
  }) as unknown as HookAgent;
const vẽ = (tt: TrangThaiAgent) => render(<DongThoiGianAgent agent={hook(tt)} onMoTep={() => undefined} />);
afterEach(cleanup);

const BD_NGOAI = { loai: "bat-dau", runId: "r1", cheDo: "hoi", model: { nguon: "ngoai", model: "ngoai:openai:gpt-test", muc: "van-hanh" } } as unknown as SuKienAgent;
const BD_CUC_BO = { loai: "bat-dau", runId: "r1", cheDo: "hoi", model: { vaiTro: "code.software", model: "Qwen", nguon: "gan-profile", bangChung: "x" } } as unknown as SuKienAgent;
const VET = { nhaCungCap: "openai", model: "gpt-test", tokenVao: 1200, tokenRa: 340, chiPhiUocUsd: 0.0123 };
const muc = (m: string): SuKienAgent => ({ ...BD_NGOAI, model: { nguon: "ngoai", model: "ngoai:openai:gpt-test", muc: m } }) as unknown as SuKienAgent;

describe("L4 — huy hiệu nguồn", () => {
  it("model ngoài ⇒ «Model ngoài» + nhà cung cấp · model + mức dữ liệu; KHÔNG dòng 'vai trò'", () => {
    vẽ(chay([BD_NGOAI]));
    const d = screen.getByTestId("agent-model-bat-dau");
    expect(d).toHaveAttribute("data-nguon", "ngoai");
    expect(d).toHaveAttribute("data-muc", "van-hanh");
    expect(screen.getByTestId("agent-model-ngoai-huy-hieu")).toHaveTextContent("Model ngoài");
    expect(screen.getByTestId("agent-model-ngoai-ten")).toHaveTextContent("Đang chạy gpt-test (openai)");
    expect(screen.getByTestId("agent-model-ngoai-muc")).toHaveTextContent("dữ liệu vận hành");
    expect(d.textContent).not.toContain("vai trò");
  });
  it("mức kỹ thuật ⇒ nhãn kỹ thuật; mức LẠ ⇒ KHÔNG nói bớt (hiện vận hành)", () => {
    vẽ(chay([muc("ky-thuat")]));
    expect(screen.getByTestId("agent-model-ngoai-muc")).toHaveTextContent("dữ liệu kỹ thuật");
    cleanup();
    vẽ(chay([muc("la-hoac")]));
    expect(screen.getByTestId("agent-model-ngoai-muc")).toHaveTextContent("dữ liệu vận hành");
    expect(screen.getByTestId("agent-model-bat-dau")).toHaveAttribute("data-muc", "van-hanh");
  });
  it("mã model không đúng hình ⇒ nhãn chung, không dựng từ chuỗi lạ", () => {
    vẽ(chay([{ ...BD_NGOAI, model: { nguon: "ngoai", model: "<img src=x>", muc: "van-hanh" } } as unknown as SuKienAgent]));
    expect(screen.getByTestId("agent-model-ngoai-ten")).toHaveTextContent("Model của nhà cung cấp bên ngoài");
    expect(document.querySelector("img")).toBeNull();
  });
  it("hồi quy: lượt model CỤC BỘ vẫn hiện dòng vai trò, KHÔNG huy hiệu ngoài, KHÔNG dòng Dừng ngoài", () => {
    vẽ(chay([BD_CUC_BO]));
    expect(screen.getByTestId("agent-model-bat-dau")).toHaveAttribute("data-nguon", "gan-profile");
    expect(screen.queryByTestId("agent-model-ngoai-huy-hieu")).toBeNull();
    expect(screen.queryByTestId("agent-ngoai-dung")).toBeNull();
  });
});

describe("L4 — dòng Dừng nói đúng", () => {
  it("đang chạy model ngoài ⇒ nói: Dừng chỉ trước vòng kế, vòng đang bay chạy hết và vẫn tính phí", () => {
    vẽ(chay([BD_NGOAI]));
    const t = screen.getByTestId("agent-ngoai-dung").textContent ?? "";
    expect(t).toContain("trước vòng kế tiếp");
    expect(t).toContain("vẫn chạy cho hết");
    expect(t).toContain("vẫn tính phí");
    expect(t).not.toMatch(/dừng ngay|lập tức/i);
  });
  it("lượt đã xong ⇒ không còn dòng Dừng", () => {
    vẽ(chay([BD_NGOAI, { loai: "xong", lyDo: "hoan-thanh" } as SuKienAgent]));
    expect(screen.queryByTestId("agent-ngoai-dung")).toBeNull();
  });
});

describe("L4 — dòng vết xong.vetNgoai", () => {
  it("có vết ⇒ nhà cung cấp · model · token vào/ra · chi phí ƯỚC", () => {
    vẽ(chay([BD_NGOAI, { loai: "xong", lyDo: "hoan-thanh", vetNgoai: VET } as unknown as SuKienAgent]));
    const t = screen.getByTestId("agent-vet-ngoai").textContent ?? "";
    expect(t).toContain("gpt-test");
    expect(t).toContain("openai");
    expect(t).toContain((1200).toLocaleString());
    expect(t).toContain("340");
    expect(t).toContain("$0.0123");
  });
  it("số thiếu / hỏng ⇒ «—», không NaN; thiếu nhà cung cấp ⇒ không dựng dòng", () => {
    vẽ(chay([BD_NGOAI, { loai: "xong", lyDo: "hoan-thanh", vetNgoai: { ...VET, tokenVao: -5, tokenRa: "x", chiPhiUocUsd: null } } as unknown as SuKienAgent]));
    const t = screen.getByTestId("agent-vet-ngoai").textContent ?? "";
    expect(t).toContain("vào —");
    expect(t).toContain("ra —");
    expect(t).toContain("ước —");
    expect(t).not.toContain("NaN");
    cleanup();
    vẽ(chay([BD_NGOAI, { loai: "xong", lyDo: "hoan-thanh", vetNgoai: { model: "m" } } as unknown as SuKienAgent]));
    expect(screen.queryByTestId("agent-vet-ngoai")).toBeNull();
  });
  it("lượt cục bộ (không vetNgoai) ⇒ không có dòng vết", () => {
    vẽ(chay([BD_CUC_BO, { loai: "xong", lyDo: "hoan-thanh" } as SuKienAgent]));
    expect(screen.queryByTestId("agent-vet-ngoai")).toBeNull();
  });
});

describe("L4 — hạ tự trị do phiên có lượt ngoài", () => {
  it("nói đúng lý do, KHÔNG nói 'nội dung đáng ngờ' và KHÔNG bật nhãn không-tin-cậy của thẻ kế hoạch", () => {
    const VIEC = [{ noiDung: "đọc a.ts", trangThai: "cho" as const }];
    const tt = chay([
      { loai: "bat-dau", runId: "r1", cheDo: "tu-dong" } as SuKienAgent,
      { loai: "ha-tu-tri", lyDo: "phien-co-luot-ngoai", nguon: "phien", mau: [] } as SuKienAgent,
      { loai: "ke-hoach-cho-duyet", viec: VIEC, bam: "d".repeat(64) } as SuKienAgent,
    ]);
    expect(tt.daHaTuTri).toBe(false);
    vẽ(tt);
    const cb = screen.getByTestId("agent-canh-bao");
    expect(cb.textContent).toContain("Phiên này đã có lượt dùng model ngoài");
    expect(cb.textContent).not.toContain("đáng ngờ");
    expect(screen.getByTestId("agent-ke-hoach-duyet").textContent).not.toContain("KHÔNG TIN CẬY");
  });
  it("★ chiều ngược: cảnh báo DỮ LIỆU đáng ngờ (chưa hạ tự trị) VẪN bật nhãn KHÔNG TIN CẬY; cùng cảnh báo do PHIÊN thì tắt", () => {
    const VIEC = [{ noiDung: "đọc a.ts", trangThai: "cho" as const }];
    const KH = { loai: "ke-hoach-cho-duyet", viec: VIEC, bam: "e".repeat(64) } as SuKienAgent;
    const dl = chay([{ loai: "bat-dau", runId: "r1", cheDo: "sua" } as SuKienAgent, { loai: "canh-bao-du-lieu", nguon: "web", mau: ["x"] } as unknown as SuKienAgent, KH]);
    expect(dl.daHaTuTri).toBe(false);
    vẽ(dl);
    expect(screen.getByTestId("agent-ke-hoach-duyet").textContent).toContain("KHÔNG TIN CẬY");
    cleanup();
    const ph = chay([{ loai: "bat-dau", runId: "r1", cheDo: "sua" } as SuKienAgent, { loai: "ha-tu-tri", lyDo: "phien-co-luot-ngoai", nguon: "phien", mau: [] } as SuKienAgent, KH]);
    vẽ(ph);
    expect(screen.getByTestId("agent-ke-hoach-duyet").textContent).not.toContain("KHÔNG TIN CẬY");
  });
  it("hồi quy: ha-tu-tri do nội dung đáng ngờ vẫn bật daHaTuTri + lời cũ", () => {
    const tt = chay([{ loai: "bat-dau", runId: "r1", cheDo: "tu-dong" } as SuKienAgent, { loai: "ha-tu-tri", lyDo: "noi-dung-dang-ngo", nguon: "web", mau: ["x"] } as SuKienAgent]);
    expect(tt.daHaTuTri).toBe(true);
    vẽ(tt);
    expect(screen.getByTestId("agent-canh-bao").textContent).toContain("đáng ngờ");
  });
});

describe("L4 (d1) — không vẽ thẻ agent con khi nguồn ngoài", () => {
  const CON = { loai: "con-bat-dau", runIdCon: "c1", agent: "ten", nguon: "dungSan", sau: 1, cheDo: "hoi", nhiemVu: "NHIEM-VU-LA" } as SuKienAgent;
  it("model ngoài + sự kiện con lạ ⇒ không thẻ con", () => {
    vẽ(chay([BD_NGOAI, CON]));
    expect(document.body.textContent).not.toContain("NHIEM-VU-LA");
  });
  it("hồi quy: model cục bộ + sự kiện con ⇒ vẫn vẽ thẻ con", () => {
    vẽ(chay([BD_CUC_BO, CON]));
    expect(document.body.textContent).toContain("NHIEM-VU-LA");
  });
});
