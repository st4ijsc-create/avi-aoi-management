// @vitest-environment jsdom
//
// Đợt 10.4 (T4b) — nút "Nhờ AI ngoài kiểm định" + hộp xác nhận: chỉ hiện khi nhà máy bật; chỉ gửi ID lượt (không văn bản/mức/nhà máy); hiện mức/ước/trần trước khi gửi; khoá khi không được phép; gửi MỘT lần; kết quả văn bản thuần.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  danhMuc: [] as unknown[],
  xem: { data: undefined as unknown, isError: false, isLoading: false, error: undefined as unknown },
  xemDauVao: [] as unknown[],
  goi: [] as unknown[],
  cheDo: "thanh-cong" as "thanh-cong" | "loi" | "dang-chay",
  tra: undefined as unknown,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: unknown) => (typeof d === "string" ? d : k),
  }),
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ mapTrpcError: (e: unknown) => `LOI:${e instanceof Error ? e.message : "?"}` }));
vi.mock("@/lib/trpc", async () => {
  const React = await import("react");
  return {
    trpc: {
      aiChonModel: { danhMuc: { useQuery: () => ({ data: h.danhMuc }) } },
      aiKiemDinh: {
        xemTruoc: {
          useQuery: (vao: unknown) => {
            h.xemDauVao.push(vao);
            return h.xem;
          },
        },
        chay: {
          useMutation: (o: { onSettled?: () => void }) => {
            const [st, set] = React.useState<Record<string, unknown>>({ isPending: false, isSuccess: false, isError: false, data: undefined, error: undefined });
            return {
              ...st,
              mutate: (v: unknown) => {
                h.goi.push(v);
                if (h.cheDo === "dang-chay") set({ isPending: true, isSuccess: false, isError: false });
                else if (h.cheDo === "loi") {
                  set({ isPending: false, isSuccess: false, isError: true, error: new Error("hết trần") });
                  o.onSettled?.();
                } else {
                  set({ isPending: false, isSuccess: true, isError: false, data: h.tra });
                  o.onSettled?.();
                }
              },
            };
          },
        },
      },
    },
  };
});

import { NutKiemDinhNgoai, type NguonKiemDinh } from "./NutKiemDinhNgoai";

const M = (ma: string, loai: string, extra: Record<string, unknown> = {}) => ({ ma, loai, nhan: ma, moTa: "", trangThai: "san-sang", ...extra });
const NGOAI = M("ngoai:openai_compat:gpt-x", "ngoai", { duocDungO: ["luong", "kiem-dinh"] });
const XEM_OK = {
  duocPhep: true,
  mucDuLieu: "ky-thuat",
  tokenUoc: 1200,
  chiPhiUocUsd: 0.0123,
  nhaCungCap: "openai_compat",
  model: "gpt-x",
  dinhKemBiCam: true,
  kichThuocByte: 4000,
  tranByte: 1048576,
  // non-admin: nhaMay CHỈ có duTranChoLuotNay (không số); admin có thêm token/usd
  conLaiTranNgay: { nguoi: { token: null }, nhaMay: { duTranChoLuotNay: true } } as { nguoi: { token: number | null }; nhaMay: { duTranChoLuotNay: boolean; token?: number | null; usd?: number | null } },
};
const KET_QUA = { ketLuan: "can-sua", diem: 60, banChuanHoa: "<img src=x onerror=alert(1)>", loi: [{ muc: "vua", moTa: "<script>alert(1)</script>", viTri: "../../etc/passwd" }], baiHocDeXuat: [] };
const VET = { nhaCungCap: "openai_compat", model: "gpt-x", tokenVao: 100, tokenRa: 50, chiPhiUocUsd: 0.01, soLanGoi: 1 };
const CHAT: NguonKiemDinh = { loai: "chat", cuocTroChuyenId: 3, tinNhanId: 9 };

beforeEach(() => {
  h.danhMuc = [M("auto", "auto"), NGOAI];
  h.xem = { data: XEM_OK, isError: false, isLoading: false, error: undefined };
  h.xemDauVao.length = 0;
  h.goi.length = 0;
  h.cheDo = "thanh-cong";
  h.tra = { ketQua: KET_QUA, vet: VET, callId: 7 };
});
afterEach(cleanup);

const mo = () => fireEvent.click(screen.getByTestId("nut-kiem-dinh-ngoai"));

describe("NutKiemDinhNgoai — hiện/ẩn", () => {
  it("không có model ngoài nào dùng được cho 'kiem-dinh' ⇒ KHÔNG render gì (nhà máy tắt / máy chủ cũ / chỉ luong)", () => {
    for (const dm of [[M("auto", "auto")], [M("auto", "auto"), M("ngoai:a:b", "ngoai")], [M("auto", "auto"), M("ngoai:a:b", "ngoai", { duocDungO: ["luong"] })], [M("auto", "auto"), M("ngoai:a:b", "ngoai", { duocDungO: ["kiem-dinh"], trangThai: "tat" })]]) {
      h.danhMuc = dm;
      const { container } = render(<NutKiemDinhNgoai nguon={CHAT} />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });
  it("có model ⇒ nút hiện; nguon=null (lượt chưa lưu) ⇒ nút vô hiệu", () => {
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    expect(screen.getByTestId("nut-kiem-dinh-ngoai")).toBeEnabled();
    cleanup();
    render(<NutKiemDinhNgoai nguon={null} />);
    expect(screen.getByTestId("nut-kiem-dinh-ngoai")).toBeDisabled();
  });
});

describe("hộp xác nhận", () => {
  it("xemTruoc nhận ĐÚNG {chonModel, nguon} — không văn bản, không mức, không nhà máy, không tieuChi (strict ở máy chủ)", () => {
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    const vao = h.xemDauVao[h.xemDauVao.length - 1] as Record<string, unknown>;
    expect(Object.keys(vao).sort()).toEqual(["chonModel", "nguon"]);
    expect(vao.chonModel).toBe("ngoai:openai_compat:gpt-x");
    expect(vao.nguon).toEqual(CHAT);
  });
  it("hiện mức dữ liệu, ước token bi quan, chi phí, trần còn lại (null ⇒ chưa đặt trần), kích thước, lời che dữ liệu", () => {
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    expect(screen.getByTestId("kdnh-muc").textContent).toContain("kỹ thuật");
    expect(screen.getByTestId("kdnh-uoc").textContent).toMatch(/bi quan.*2–4×/);
    expect(screen.getByTestId("kdnh-uoc").textContent).toContain("~$0.0123");
    expect(screen.getByTestId("kdnh-tran-nguoi").textContent).toContain("chưa đặt trần"); // người: null
    expect(screen.getByTestId("kdnh-tran-nha-may").textContent).toContain("có");
    expect(screen.getByTestId("hop-kiem-dinh-ngoai").textContent).toContain("che trước khi rời máy");
  });
  it("★ Q2: NON-ADMIN không thấy số token/USD của NHÀ MÁY (khoá vắng ⇒ không hiện số), chỉ 'còn đủ trần cho lượt này: có/không'", () => {
    h.xem = { ...h.xem, data: { ...XEM_OK, conLaiTranNgay: { nguoi: { token: 90000 }, nhaMay: { duTranChoLuotNay: true } } } };
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    expect(screen.queryByTestId("kdnh-tran-nha-may-so")).toBeNull();
    expect(screen.getByTestId("kdnh-tran-nha-may").textContent).toMatch(/có/);
    expect(screen.getByTestId("kdnh-tran-nguoi").textContent).toContain("90.000");
    expect(screen.getByTestId("kdnh-tran").textContent).not.toContain("$");
  });
  it("★ Q2: ADMIN thấy thêm số token/USD của nhà máy", () => {
    h.xem = { ...h.xem, data: { ...XEM_OK, conLaiTranNgay: { nguoi: { token: null }, nhaMay: { duTranChoLuotNay: true, token: 500000, usd: 12.5 } } } };
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    expect(screen.getByTestId("kdnh-tran-nha-may-so").textContent).toContain("500.000");
    expect(screen.getByTestId("kdnh-tran-nha-may-so").textContent).toContain("$12.5");
  });
  it("★ Q2: trần NHÀ MÁY không đủ ⇒ 'không' + khoá + lý do nói rõ trần của NHÀ MÁY", () => {
    h.xem = { ...h.xem, data: { ...XEM_OK, duocPhep: false, lyDo: "NGOAI_VUOT_TRAN", conLaiTranNgay: { nguoi: { token: 99999999 }, nhaMay: { duTranChoLuotNay: false } } } };
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    expect(screen.getByTestId("kdnh-gui")).toBeDisabled();
    expect(screen.getByTestId("kdnh-tran-nha-may").textContent).toMatch(/không/);
    expect(screen.getByTestId("kdnh-khoa-tran-ai").textContent).toContain("NHÀ MÁY");
  });
  it("★ Q2: trần CỦA NGƯỜI không đủ (nguoi.token < tokenUoc) ⇒ nói 'không đủ' + khoá + lý do nói rõ trần CỦA BẠN", () => {
    h.xem = { ...h.xem, data: { ...XEM_OK, duocPhep: false, lyDo: "NGOAI_VUOT_TRAN", tokenUoc: 1200, conLaiTranNgay: { nguoi: { token: 300 }, nhaMay: { duTranChoLuotNay: true } } } };
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    expect(screen.getByTestId("kdnh-tran-nguoi-het")).toBeInTheDocument();
    expect(screen.getByTestId("kdnh-khoa-tran-ai").textContent).toContain("CỦA BẠN");
    expect(screen.getByTestId("kdnh-gui")).toBeDisabled();
  });
  it("chi phí null ⇒ 'chưa có bảng giá'; coding ⇒ ghi rõ 'nội dung lập trình được coi là dữ liệu vận hành'", () => {
    h.xem = { ...h.xem, data: { ...XEM_OK, chiPhiUocUsd: null, mucDuLieu: "van-hanh" } };
    render(<NutKiemDinhNgoai nguon={{ loai: "coding", phienId: "11111111-1111-4111-8111-111111111111", chiSoLuot: 1 }} />);
    mo();
    expect(screen.getByTestId("kdnh-uoc").textContent).toContain("chưa có bảng giá");
    expect(screen.getByTestId("kdnh-ghi-chu-coding").textContent).toContain("dữ liệu vận hành");
    expect(screen.getByTestId("kdnh-muc").textContent).toContain("dữ liệu vận hành");
  });
  it("duocPhep=false ⇒ nút gửi KHOÁ + lý do (mã errors.reason); gọi tay vẫn không gửi", () => {
    h.xem = { ...h.xem, data: { ...XEM_OK, duocPhep: false, lyDo: "NGOAI_DU_LIEU_VAN_HANH", mucDuLieu: "van-hanh" } };
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    expect(screen.getByTestId("kdnh-gui")).toBeDisabled();
    expect(screen.getByTestId("kdnh-khoa").textContent).toContain("NGOAI_DU_LIEU_VAN_HANH");
    fireEvent.click(screen.getByTestId("kdnh-gui"));
    expect(h.goi).toEqual([]);
  });
  it("quá lớn (kichThuocByte > tranByte) ⇒ khoá + báo quá lớn, KHÔNG gửi", () => {
    h.xem = { ...h.xem, data: { ...XEM_OK, kichThuocByte: 2_000_000 } };
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    expect(screen.getByTestId("kdnh-qua-lon")).toBeInTheDocument();
    expect(screen.getByTestId("kdnh-gui")).toBeDisabled();
  });
  it("xemTruoc lỗi (NOT_FOUND: lượt không tồn tại / nhiều nhà máy) ⇒ hiện thông điệp đã dịch, gửi khoá", () => {
    h.xem = { data: undefined, isError: true, isLoading: false, error: new Error("khong-co-nguon") };
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    expect(screen.getByTestId("kdnh-loi-xem").textContent).toContain("LOI:khong-co-nguon");
    expect(screen.getByTestId("kdnh-gui")).toBeDisabled();
  });
});

describe("gửi", () => {
  it("gửi ⇒ chay nhận {chonModel, nguon, tieuChi?} (không thêm khoá); bấm đúp chỉ MỘT lần", () => {
    h.cheDo = "dang-chay";
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    fireEvent.change(screen.getByTestId("kdnh-tieu-chi"), { target: { value: "  an toàn  " } });
    // ba cú bấm TRONG CÙNG một lô (chưa kịp vẽ lại) — đúng tình huống bấm đúp thật; chỉ khoá đồng bộ (ref) chặn được
    const nut = screen.getByTestId("kdnh-gui");
    act(() => {
      nut.click();
      nut.click();
      nut.click();
    });
    expect(h.goi).toEqual([{ chonModel: "ngoai:openai_compat:gpt-x", nguon: CHAT, tieuChi: "an toàn" }]);
    expect(screen.getByTestId("kdnh-gui")).toBeDisabled();
  });
  it("không nhập tiêu chí ⇒ không có khoá tieuChi", () => {
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    fireEvent.click(screen.getByTestId("kdnh-gui"));
    expect(h.goi).toEqual([{ chonModel: "ngoai:openai_compat:gpt-x", nguon: CHAT }]);
  });
  it("thành công ⇒ hiện kết quả qua bộ hiển thị văn bản thuần (payload độc không thành phần tử), nút gửi biến mất", () => {
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    fireEvent.click(screen.getByTestId("kdnh-gui"));
    const kq = screen.getByTestId("kdnh-ket-qua");
    expect(kq.querySelector("img, script, a[href]")).toBeNull();
    expect(screen.getByTestId("kdn-ban-chuan-hoa").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(screen.queryByTestId("kdnh-gui")).toBeNull();
  });
  it("tuBoNho ⇒ nhãn 'không tính phí lần nữa'; soLanGoi=2 ⇒ nhãn thử lại", () => {
    h.tra = { ketQua: KET_QUA, vet: { ...VET, soLanGoi: 2 }, callId: 7, tuBoNho: true };
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    fireEvent.click(screen.getByTestId("kdnh-gui"));
    const vet = screen.getByTestId("kdn-vet").textContent ?? "";
    expect(vet).toContain("không tính phí lần nữa");
    expect(vet).toContain("thử lại");
  });
  it("chay lỗi (vd 409 đang chạy / vượt trần) ⇒ thông điệp đã dịch; có thể thử lại", () => {
    h.cheDo = "loi";
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    fireEvent.click(screen.getByTestId("kdnh-gui"));
    expect(screen.getByTestId("kdnh-loi").textContent).toContain("LOI:hết trần");
    expect(screen.getByTestId("kdnh-gui")).toBeEnabled();
  });
  it("mọi nguồn (chat / agent / coding) đi nguyên hình dạng vào xemTruoc và chay", () => {
    for (const ng of [CHAT, { loai: "agent", runId: "22222222-2222-4222-8222-222222222222" } as NguonKiemDinh, { loai: "coding", phienId: "11111111-1111-4111-8111-111111111111", chiSoLuot: 3 } as NguonKiemDinh]) {
      h.goi.length = 0;
      render(<NutKiemDinhNgoai nguon={ng} />);
      mo();
      fireEvent.click(screen.getByTestId("kdnh-gui"));
      expect((h.goi[0] as { nguon: unknown }).nguon).toEqual(ng);
      cleanup();
    }
  });
});

describe("rà kiem-dinh 10.4 (NÊN #3) — cảnh báo ô tiêu chí", () => {
  it("dưới ô tiêu chí LUÔN có dòng cảnh báo cố định 'không dán dữ liệu vận hành'", () => {
    render(<NutKiemDinhNgoai nguon={CHAT} />);
    mo();
    expect(screen.getByTestId("kdnh-tieu-chi-canh-bao").textContent).toContain("Không dán dữ liệu vận hành");
  });
});
