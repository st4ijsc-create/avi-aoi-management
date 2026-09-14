// @vitest-environment jsdom
//
// CayPhanCap.dom.test.tsx — Đợt 8 Lô B, mục #11 (bàn phím WAI-ARIA).
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ VÌ SAO BỘ TEST NÀY TỒN TẠI RIÊNG — G16/G20
// ════════════════════════════════════════════════════════════════════════════
// `cayPhanCapLogic.unit.test.ts` có 51 test xanh cho `phimCay`. Nhưng nó gọi
// THẲNG hàm, nên nó đo *hàm đúng không* — KHÔNG đo *hàm có được gọi không*.
// Đó chính xác là ca G16 đã bắt được với `locBadge.ts`: 18 test xanh, commit
// sạch, cổng máy đủ, và `LopCanhBao.tsx` không hề gọi nó — lỗi vẫn sống nguyên
// trên `/twin`.
//
// Ở đây phép đo đi qua **component THẬT**: render `CayPhanCap`, gửi
// `keyDown` thật lên phần tử `role="treeitem"` thật, rồi đọc
// `document.activeElement` thật. Câu hỏi kiểm nhanh của G20 — *"nếu tôi xoá sạch
// mã sản phẩm, test này có đỏ không?"* — trả lời được: gỡ `onKeyDown` khỏi
// `CayPhanCap.tsx` là mọi ca điều hướng dưới đây đỏ (đã tiêm và đo, xem báo cáo).
//
// ★ Không mock `cayPhanCapLogic`: mock nó đi thì bộ test này quay về đo chính
//   tệp test của mình. Chỉ mock `react-i18next` (hợp đồng dịch, không phải logic).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CayPhanCap } from "./CayPhanCap";
import {
  dungCayThietKe,
  khoaNode,
  type DatChoDauVao,
  type MayDauVao,
} from "./trangThaiThietKe";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Cây mẫu — DỰNG BẰNG HÀM THẬT, cùng hình dạng với test thuần
//   W1 ─┬─ L1 ─┬─ S1 ─┬─ M1
//       │      │      └─ M2
//       │      └─ S2 ─── M3
//       └─ L2 ─── S3 ─── M4
// ---------------------------------------------------------------------------

function may(id: number, ma: string, stationId: number): MayDauVao {
  return { id, ma, ten: null, loaiMay: "aoi", isActive: true, stationId };
}

function datCho(id: number): DatChoDauVao {
  return {
    id,
    tangId: 1,
    loaiThucThe: "machine",
    thucTheId: id,
    viTriXMm: 0,
    viTriYMm: 0,
    viTriZMm: 0,
    rongMm: null,
    caoMm: null,
    sauMm: null,
    kichThuocDaDo: false,
    quatX: 0,
    quatY: 0,
    quatZ: 0,
    quatW: 1,
    daKhoa: false,
    hienThi: true,
    nguon: "sinh",
  };
}

const cay = dungCayThietKe(
  [{ id: 1, ma: "W1", ten: null, factoryId: 1, tangId: 1 }],
  [
    { id: 1, ma: "L1", ten: null, workshopId: 1 },
    { id: 2, ma: "L2", ten: null, workshopId: 1 },
  ],
  [
    { id: 1, ma: "S1", ten: null, lineId: 1, thuTu: 1 },
    { id: 2, ma: "S2", ten: null, lineId: 1, thuTu: 2 },
    { id: 3, ma: "S3", ten: null, lineId: 2, thuTu: 1 },
  ],
  [may(1, "M1", 1), may(2, "M2", 1), may(3, "M3", 2), may(4, "M4", 3)],
  [1, 2, 3, 4].map(datCho),
);

const W1 = khoaNode("workshop", 1);
const L1 = khoaNode("line", 1);
const L2 = khoaNode("line", 2);
const S1 = khoaNode("station", 1);
const S2 = khoaNode("station", 2);
const M1 = khoaNode("machine", 1);
const M2 = khoaNode("machine", 2);

function hang(khoa: string): HTMLElement {
  return screen.getByTestId(`node-cay-${khoa}`);
}

function ve(sua: Partial<React.ComponentProps<typeof CayPhanCap>> = {}) {
  const onChon = vi.fn();
  const r = render(
    <CayPhanCap cay={cay} chon={[]} onChon={onChon} soChoXepCho={0} {...sua} />,
  );
  return { onChon, ...r };
}

/** Mở một node bằng cách bấm nút mũi tên của nó (đường CHUỘT, độc lập bàn phím). */
function moBangChuot(khoa: string) {
  fireEvent.click(hang(khoa).querySelector("button")!);
}

// ═══════════════════════════════════════════════════════════════════════════
// ARIA — lời khai phải khớp thực tế
// ═══════════════════════════════════════════════════════════════════════════

describe("#11 ARIA — cây tự khai gì thì phải làm được đúng thế", () => {
  it("★★★ CÓ role=tree, role=treeitem, VÀ tabIndex — không còn 'khai mà không làm'", () => {
    ve();
    expect(screen.getByRole("tree")).toBeInTheDocument();
    const w = hang(W1);
    expect(w).toHaveAttribute("role", "treeitem");
    // Đây là thứ TRƯỚC ĐỢT NÀY BẰNG 0 trong toàn `twin3d/**`.
    expect(w).toHaveAttribute("tabindex");
  });

  it("★★★ ROVING TABINDEX — đúng MỘT hàng có tabIndex=0 trong cả cây", () => {
    // Cho mọi hàng `0` biến cây 82 máy thành 82 chặng Tab.
    ve();
    const moi = screen.getAllByRole("treeitem");
    expect(moi.length).toBeGreaterThan(0);
    expect(moi.filter((e) => e.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("★ hàng nhận tab MẶC ĐỊNH là hàng đầu; node ĐANG CHỌN thì giành lấy nó", () => {
    const { unmount } = ve();
    expect(hang(W1)).toHaveAttribute("tabindex", "0");
    unmount();
    // Chọn từ 3D ⇒ cây tự mở nhánh, và Tab vào cây rơi ĐÚNG máy đó.
    ve({ chon: [M2] });
    expect(hang(M2)).toHaveAttribute("tabindex", "0");
    expect(hang(W1)).toHaveAttribute("tabindex", "-1");
  });

  it("aria-expanded: node có con phản ánh trạng thái; LÁ không có thuộc tính này", () => {
    ve();
    expect(hang(W1)).toHaveAttribute("aria-expanded", "false");
    moBangChuot(W1);
    expect(hang(W1)).toHaveAttribute("aria-expanded", "true");
    moBangChuot(L1);
    moBangChuot(S1);
    expect(hang(M1)).not.toHaveAttribute("aria-expanded");
  });

  it("aria-level đếm từ 1 theo WAI-ARIA", () => {
    ve();
    moBangChuot(W1);
    expect(hang(W1)).toHaveAttribute("aria-level", "1");
    expect(hang(L1)).toHaveAttribute("aria-level", "2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BÀN PHÍM — focus phải DI CHUYỂN THẬT
// ═══════════════════════════════════════════════════════════════════════════

describe("#11 bàn phím — đo bằng document.activeElement THẬT", () => {
  it("★★★ ↓ ĐƯA FOCUS SANG HÀNG KẾ TIẾP", () => {
    ve();
    moBangChuot(W1); // [W1, L1, L2]
    hang(W1).focus();
    expect(document.activeElement).toBe(hang(W1));

    fireEvent.keyDown(hang(W1), { key: "ArrowDown" });
    expect(document.activeElement).toBe(hang(L1));
  });

  it("★★★ ↑ ĐƯA FOCUS NGƯỢC LẠI", () => {
    ve();
    moBangChuot(W1);
    hang(L1).focus();
    fireEvent.keyDown(hang(L1), { key: "ArrowUp" });
    expect(document.activeElement).toBe(hang(W1));
  });

  it("★★★ → TRÊN NODE ĐÓNG THÌ MỞ NÓ (DOM thật sự mọc thêm hàng)", () => {
    ve();
    expect(screen.queryByTestId(`node-cay-${L1}`)).toBeNull();
    hang(W1).focus();
    fireEvent.keyDown(hang(W1), { key: "ArrowRight" });
    // Hàng con thật sự xuất hiện — không chỉ đổi một cờ nội bộ.
    expect(screen.getByTestId(`node-cay-${L1}`)).toBeInTheDocument();
    expect(hang(W1)).toHaveAttribute("aria-expanded", "true");
  });

  it("★★★ → TRÊN NODE ĐÃ MỞ THÌ ĐI VÀO CON ĐẦU (không mở lại)", () => {
    // Đây là hành vi APG mà bản `CommandCenter.tsx:335` KHÔNG có (`&& !isOpen`).
    ve();
    moBangChuot(W1);
    hang(W1).focus();
    fireEvent.keyDown(hang(W1), { key: "ArrowRight" });
    expect(document.activeElement).toBe(hang(L1));
  });

  it("★★★ ← TRÊN NODE ĐANG MỞ THÌ ĐÓNG NÓ (hàng con biến khỏi DOM)", () => {
    ve();
    moBangChuot(W1);
    expect(screen.getByTestId(`node-cay-${L1}`)).toBeInTheDocument();
    hang(W1).focus();
    fireEvent.keyDown(hang(W1), { key: "ArrowLeft" });
    expect(screen.queryByTestId(`node-cay-${L1}`)).toBeNull();
  });

  it("★★★ ← TRÊN NODE ĐÓNG / LÁ THÌ LÊN CHA", () => {
    ve();
    moBangChuot(W1);
    hang(L2).focus();
    fireEvent.keyDown(hang(L2), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(hang(W1));
  });

  it("★★★ Home / End nhảy tới hàng ĐẦU và hàng CUỐI ĐANG NHÌN THẤY", () => {
    ve();
    moBangChuot(W1); // [W1, L1, L2]
    hang(L1).focus();

    fireEvent.keyDown(hang(L1), { key: "End" });
    expect(document.activeElement).toBe(hang(L2));

    fireEvent.keyDown(hang(L2), { key: "Home" });
    expect(document.activeElement).toBe(hang(W1));
  });

  it("★★★ ↓ TỪ HÀNG CUỐI NHÁNH MỞ SANG ANH EM, KHÔNG CHUI VÀO NHÁNH ĐÓNG", () => {
    // W1>L1>S1 mở (M1,M2 hiện); S2 ĐÓNG. Từ M2 ↓ phải sang S2, không sang M3.
    ve();
    moBangChuot(W1);
    moBangChuot(L1);
    moBangChuot(S1);
    expect(screen.queryByTestId("node-cay-machine:3")).toBeNull(); // M3 bị gập

    hang(M2).focus();
    fireEvent.keyDown(hang(M2), { key: "ArrowDown" });
    expect(document.activeElement).toBe(hang(S2));
  });

  it("Enter và Space KÍCH HOẠT node (gọi onChon đúng khoá)", () => {
    const { onChon } = ve();
    moBangChuot(W1);
    hang(L1).focus();

    fireEvent.keyDown(hang(L1), { key: "Enter" });
    expect(onChon).toHaveBeenCalledWith(L1, false);

    onChon.mockClear();
    fireEvent.keyDown(hang(L1), { key: " " });
    expect(onChon).toHaveBeenCalledWith(L1, false);
  });

  it("★★★ PHÍM LẠ KHÔNG BỊ NUỐT — Tab ra khỏi cây được", () => {
    // Nuốt hết mọi phím sẽ NHỐT người dùng bàn phím trong cây — lỗi trợ năng
    // nặng hơn hẳn lỗi đang vá.
    ve();
    hang(W1).focus();
    const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    hang(W1).dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("★ ↑ ở hàng đầu KHÔNG cuộn vòng xuống cuối", () => {
    ve();
    moBangChuot(W1);
    hang(W1).focus();
    fireEvent.keyDown(hang(W1), { key: "ArrowUp" });
    expect(document.activeElement).toBe(hang(W1));
  });

  it("★ đi được MỘT MẠCH bằng bàn phím từ gốc xuống lá — không kẹt giữa chừng", () => {
    // Ca tổng hợp: chỉ dùng bàn phím, không chạm chuột lần nào.
    ve();
    hang(W1).focus();
    fireEvent.keyDown(hang(W1), { key: "ArrowRight" }); // mở W1
    fireEvent.keyDown(hang(W1), { key: "ArrowRight" }); // vào L1
    expect(document.activeElement).toBe(hang(L1));
    fireEvent.keyDown(hang(L1), { key: "ArrowRight" }); // mở L1
    fireEvent.keyDown(hang(L1), { key: "ArrowRight" }); // vào S1
    expect(document.activeElement).toBe(hang(S1));
    fireEvent.keyDown(hang(S1), { key: "ArrowRight" }); // mở S1
    fireEvent.keyDown(hang(S1), { key: "ArrowRight" }); // vào M1
    expect(document.activeElement).toBe(hang(M1));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #8 / #9 / #10 nối vào UI
// ═══════════════════════════════════════════════════════════════════════════

describe("#8 roll-up đếm hiện lên hàng", () => {
  it("★★★ CHA HIỆN TỔNG CỦA CÂY CON, KHÔNG HIỆN 0", () => {
    ve({ soCanhBaoTrucTiep: new Map([[M1, 1], [M2, 2]]) });
    moBangChuot(W1);
    // W1 có 0 cảnh báo TRỰC TIẾP nhưng 3 dưới cây con.
    expect(hang(W1)).toHaveAttribute("data-so-canh-bao", "3");
    expect(screen.getByTestId(`canh-bao-${W1}`)).toHaveTextContent("3");
    moBangChuot(L1);
    expect(hang(L2)).toHaveAttribute("data-so-canh-bao", "0");
  });

  it("★ không có badge trên hàng 0 cảnh báo (ISA-101: màu chỉ cho bất thường)", () => {
    ve({ soCanhBaoTrucTiep: new Map([[M1, 1]]) });
    moBangChuot(W1);
    moBangChuot(L1);
    expect(screen.queryByTestId(`canh-bao-${L2}`)).toBeNull();
  });

  it("★★★ KHÔNG cấp dữ liệu alarm ⇒ chip lọc ẨN (không tự khai 'nhà máy sạch')", () => {
    // Một chip luôn cho kết quả rỗng vì không ai cấp dữ liệu là nút tự khai
    // "sạch" mà chưa đo gì (NT-3/G15).
    const { unmount } = ve();
    expect(screen.queryByTestId("chip-chi-canh-bao")).toBeNull();
    unmount();
    ve({ soCanhBaoTrucTiep: new Map([[M1, 1]]) });
    expect(screen.getByTestId("chip-chi-canh-bao")).toBeInTheDocument();
  });
});

describe("#9 highlight <mark> + debounce 200ms", () => {
  it("★★★ GÕ TÌM KIẾM ⇒ ĐOẠN KHỚP ĐƯỢC BỌC <mark> (sau debounce)", () => {
    vi.useFakeTimers();
    try {
      ve();
      fireEvent.change(screen.getByTestId("loc-cay"), { target: { value: "w1" } });
      // TRƯỚC debounce: chưa tô gì — đây là ca chứng minh debounce CÓ THẬT.
      // (Nếu bỏ `setTimeout` đi, dòng này ĐỎ ngay.)
      expect(document.querySelectorAll("mark")).toHaveLength(0);

      // `act` để React flush state của `setTim` do timer bắn ra; thiếu nó thì
      // DOM chưa vẽ lại và phép đo dưới đo NHẦM KHUNG (đọc trạng thái cũ).
      act(() => {
        vi.advanceTimersByTime(200);
      });

      const marks = document.querySelectorAll("mark");
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0].textContent?.toLowerCase()).toBe("w1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("★ ô nhập KHÔNG bị trễ theo debounce (chữ hiện ngay)", () => {
    ve();
    const o = screen.getByTestId("loc-cay") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "abc" } });
    expect(o.value).toBe("abc");
  });
});

describe("#10 lọc 'chỉ node có cảnh báo' + auto-expand", () => {
  it("★★★ BẬT CHIP ⇒ NHÁNH SẠCH BIẾN MẤT, NHÁNH CÓ CẢNH BÁO TỰ BUNG TỚI LÁ", () => {
    // Cảnh báo chỉ ở M3 (dưới S2/L1). Nhánh L2 phải biến mất, và đường
    // W1→L1→S2→M3 phải tự mở — không cần người dùng bấm mũi tên nào.
    ve({ soCanhBaoTrucTiep: new Map([[khoaNode("machine", 3), 1]]) });
    fireEvent.click(screen.getByTestId("chip-chi-canh-bao"));

    expect(screen.getByTestId(`node-cay-${W1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-cay-${L1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-cay-${S2}`)).toBeInTheDocument();
    expect(screen.getByTestId("node-cay-machine:3")).toBeInTheDocument();
    // Nhánh sạch bị cắt cả cụm.
    expect(screen.queryByTestId(`node-cay-${L2}`)).toBeNull();
    expect(screen.queryByTestId(`node-cay-${S1}`)).toBeNull();
  });

  it("★★★ TẮT CHIP ⇒ CÂY TRỞ VỀ ĐÚNG TRẠNG THÁI MỞ CỦA NGƯỜI DÙNG", () => {
    // Auto-expand phải là CỘNG THÊM, không ghi đè: người dùng chưa mở gì thì
    // sau khi tắt lọc cây phải gập lại như cũ, không giữ nguyên bản đã bung.
    ve({ soCanhBaoTrucTiep: new Map([[khoaNode("machine", 3), 1]]) });
    const chip = screen.getByTestId("chip-chi-canh-bao");
    fireEvent.click(chip);
    expect(screen.getByTestId(`node-cay-${L1}`)).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.queryByTestId(`node-cay-${L1}`)).toBeNull();
  });

  it("aria-pressed phản ánh trạng thái chip", () => {
    ve({ soCanhBaoTrucTiep: new Map([[M1, 1]]) });
    const chip = screen.getByTestId("chip-chi-canh-bao");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });
});

describe("#15 báo phạm vi nhánh ra ngoài", () => {
  it("★★★ ĐỔI NODE CHỦ ĐẠO ⇒ GỌI onDoiPhamVi ĐÚNG KHOÁ", () => {
    const onDoiPhamVi = vi.fn();
    const { rerender } = render(
      <CayPhanCap
        cay={cay}
        chon={[]}
        onChon={vi.fn()}
        soChoXepCho={0}
        onDoiPhamVi={onDoiPhamVi}
      />,
    );
    expect(onDoiPhamVi).toHaveBeenCalledWith(null);

    onDoiPhamVi.mockClear();
    rerender(
      <CayPhanCap
        cay={cay}
        chon={[M1]}
        onChon={vi.fn()}
        soChoXepCho={0}
        onDoiPhamVi={onDoiPhamVi}
      />,
    );
    expect(onDoiPhamVi).toHaveBeenCalledWith(M1);
  });

  it("★ tập chọn nhiều ⇒ báo phần tử CUỐI (node chủ đạo)", () => {
    const onDoiPhamVi = vi.fn();
    render(
      <CayPhanCap
        cay={cay}
        chon={[M1, M2]}
        onChon={vi.fn()}
        soChoXepCho={0}
        onDoiPhamVi={onDoiPhamVi}
      />,
    );
    expect(onDoiPhamVi).toHaveBeenCalledWith(M2);
  });
});
