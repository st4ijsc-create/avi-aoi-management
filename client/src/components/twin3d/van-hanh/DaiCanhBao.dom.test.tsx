// @vitest-environment jsdom
//
// DaiCanhBao.dom.test.tsx — Đợt 8 Lô B, mục #12/#13/#14/#15.
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ G16 — `daiCanhBaoLogic.unit.test.ts` KHÔNG chứng minh component gọi nó
// ════════════════════════════════════════════════════════════════════════════
// Bộ test thuần (35 test) gọi thẳng `gopCanhBao`/`tachNhom`/`locTheoMuc`, nên nó
// đo *luật đúng không*. Bộ này đo *luật có được gọi không*: render component
// THẬT, đẩy hai nguồn dữ liệu THẬT vào, rồi ĐẾM DÒNG TRONG DOM.
//
// ★★★ VÀ MỌI CA DEDUPE Ở ĐÂY LÀ CA DƯƠNG (G5/G22): dải rỗng thì "không có dòng
//   lặp" là hiển nhiên và chứng minh SỐ 0. Nên mỗi ca bắn TRÙNG THẬT — mô phỏng
//   đúng hai đường trùng đo được: seed đổi id mỗi refetch, và
//   `socket.ts:1392-1394` phát một raise vào ba phòng — rồi đếm DOM.
//
// ★ Không mock `daiCanhBaoLogic`: mock nó là quay về đo tệp test của chính mình
//   (G20). Chỉ mock `react-i18next`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DaiCanhBao } from "./DaiCanhBao";
import { chuanHoaHang, type CanhBaoDai, type TapPhamVi } from "./daiCanhBaoLogic";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Trả kèm tham số để ghim được nội suy `{{n}}` (badge "tồn đọng Nd").
    t: (k: string, o?: Record<string, unknown>) =>
      o && "n" in o ? `${k}:${String(o.n)}` : k,
  }),
}));

afterEach(() => cleanup());

const BAY_GIO = 1_757_000_000_000;
const GIO = 3_600_000;

function cb(sua: Partial<CanhBaoDai> & { idNguon: number }): CanhBaoDai {
  return {
    nguon: "andon",
    muc: "red",
    pha: "raised",
    tieuDe: `Su co ${sua.idNguon}`,
    luc: BAY_GIO - GIO,
    capNhatLuc: BAY_GIO - GIO,
    machineId: null,
    lineId: null,
    stationId: null,
    workshopId: null,
    ...sua,
  };
}

/** Mọi dòng cảnh báo đang hiện trong DOM. */
function dong(): HTMLElement[] {
  return screen.queryAllByTestId(/^canh-bao-/);
}

function ve(sua: Partial<React.ComponentProps<typeof DaiCanhBao>> = {}) {
  return render(<DaiCanhBao seed={[]} bayGio={BAY_GIO} {...sua} />);
}

// ═══════════════════════════════════════════════════════════════════════════
// #12 — dedupe + cap, ĐẾM TRÊN DOM
// ═══════════════════════════════════════════════════════════════════════════

describe("#12 dedupe — CA DƯƠNG đo bằng SỐ DÒNG TRONG DOM", () => {
  it("★★★ SEED ĐỔI ID MỖI REFETCH: cùng hàng andon 2 lượt ⇒ DOM có 1 DÒNG", () => {
    // Hai lượt poll của CÙNG một hàng `andon_events`. Bản gốc khoá theo id phong
    // bì (nhúng `seq` đơn điệu) sẽ hiện 2 dòng.
    ve({
      seed: [
        cb({ idNguon: 41, capNhatLuc: BAY_GIO - GIO }),
        cb({ idNguon: 41, capNhatLuc: BAY_GIO - 60_000 }),
      ],
    });
    expect(dong()).toHaveLength(1);
    expect(screen.getByTestId("canh-bao-andon-41")).toBeInTheDocument();
  });

  it("★★★ SOCKET 3 PHÒNG: một raise tới 3 lần ⇒ DOM có 1 DÒNG", () => {
    // `socket.ts:1392-1394` — global + line:{id} + machine:{id}.
    const g = cb({ idNguon: 77, machineId: 12, lineId: 3 });
    ve({ seed: [], song: [g, { ...g }, { ...g }] });
    expect(dong()).toHaveLength(1);
  });

  it("★★★ SEED + SOCKET cùng một hàng ⇒ 1 DÒNG, không phải 2", () => {
    ve({ seed: [cb({ idNguon: 5 })], song: [cb({ idNguon: 5 })] });
    expect(dong()).toHaveLength(1);
  });

  it("★ hai NGUỒN khác nhau cùng số id ⇒ 2 dòng (không nuốt cảnh báo an toàn)", () => {
    ve({ seed: [cb({ idNguon: 5, nguon: "andon" }), cb({ idNguon: 5, nguon: "safety" })] });
    expect(dong()).toHaveLength(2);
  });

  it("★★★ BẢN MỚI HƠN THẮNG: gói 'raised' đến TRỄ không lật ngược hàng đã ack", () => {
    ve({
      seed: [cb({ idNguon: 9, pha: "acknowledged", capNhatLuc: BAY_GIO })],
      song: [cb({ idNguon: 9, pha: "raised", capNhatLuc: BAY_GIO - GIO })],
    });
    expect(screen.getByTestId("canh-bao-andon-9")).toHaveAttribute("data-pha", "acknowledged");
  });

  it("★★★ CAP 100: 150 gói (60 nhân đôi + 30 đơn) ⇒ 90 dòng, không mất vì bản sao", () => {
    const goi: CanhBaoDai[] = [];
    for (let i = 0; i < 60; i++) {
      const c = cb({ idNguon: i, luc: BAY_GIO - i * 1000 });
      goi.push(c, { ...c });
    }
    for (let i = 60; i < 90; i++) goi.push(cb({ idNguon: i, luc: BAY_GIO - i * 1000 }));
    ve({ seed: goi });
    expect(dong()).toHaveLength(90);
  });

  it("★ 120 cảnh báo KHÁC NHAU ⇒ DOM cắt còn đúng trần 100", () => {
    const ds = Array.from({ length: 120 }, (_, i) =>
      cb({ idNguon: i, luc: BAY_GIO - i * 1000 }),
    );
    ve({ seed: ds });
    expect(dong()).toHaveLength(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #13 — nhóm tồn đọng
// ═══════════════════════════════════════════════════════════════════════════

describe("#13 nhóm 'Tồn đọng >24h'", () => {
  it("★★★ HAI TIÊU ĐỀ NHÓM VỚI ĐÚNG SỐ ĐẾM", () => {
    ve({
      seed: [
        cb({ idNguon: 1, luc: BAY_GIO - 2 * GIO }),
        cb({ idNguon: 2, luc: BAY_GIO - 30 * GIO }),
        cb({ idNguon: 3, luc: BAY_GIO - 50 * GIO }),
      ],
    });
    expect(screen.getByTestId("nhom-hom-nay")).toHaveTextContent("(1)");
    expect(screen.getByTestId("nhom-ton-dong")).toHaveTextContent("(2)");
  });

  it("★★★ SỐ ĐO THẬT DB dev — 7 mở / 6 tồn đọng, tái dựng trên DOM", () => {
    const ds: CanhBaoDai[] = [];
    for (let i = 0; i < 6; i++) ds.push(cb({ idNguon: i, luc: BAY_GIO - (25 + i) * GIO }));
    ds.push(cb({ idNguon: 6, luc: BAY_GIO - 2 * GIO }));
    ve({ seed: ds });
    expect(dong()).toHaveLength(7);
    expect(screen.getByTestId("nhom-hom-nay")).toHaveTextContent("(1)");
    expect(screen.getByTestId("nhom-ton-dong")).toHaveTextContent("(6)");
  });

  it("★★★ BADGE 'tồn đọng Nd' CHỈ trên dòng tồn đọng, và N đúng", () => {
    ve({
      seed: [
        cb({ idNguon: 1, luc: BAY_GIO - 2 * GIO }),
        cb({ idNguon: 2, luc: BAY_GIO - 73 * GIO }), // 3 ngày +1h
      ],
    });
    expect(screen.getByTestId("canh-bao-andon-1")).toHaveAttribute("data-ton-dong", "0");
    const cu = screen.getByTestId("canh-bao-andon-2");
    expect(cu).toHaveAttribute("data-ton-dong", "1");
    expect(cu).toHaveTextContent("twin3d.daiCanhBao.tonDongNgay:3");
  });

  it("★ chỉ có cảnh báo mới ⇒ KHÔNG hiện tiêu đề nhóm tồn đọng rỗng", () => {
    ve({ seed: [cb({ idNguon: 1, luc: BAY_GIO - GIO })] });
    expect(screen.getByTestId("nhom-hom-nay")).toBeInTheDocument();
    expect(screen.queryByTestId("nhom-ton-dong")).toBeNull();
  });

  it("★ chỉ có cảnh báo cũ ⇒ KHÔNG hiện tiêu đề nhóm hôm nay rỗng", () => {
    ve({ seed: [cb({ idNguon: 1, luc: BAY_GIO - 40 * GIO })] });
    expect(screen.queryByTestId("nhom-hom-nay")).toBeNull();
    expect(screen.getByTestId("nhom-ton-dong")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #14 — chip lọc mức độ
// ═══════════════════════════════════════════════════════════════════════════

describe("#14 chip lọc mức độ", () => {
  const ds = [
    cb({ idNguon: 1, muc: "red" }),
    cb({ idNguon: 2, muc: "red" }),
    cb({ idNguon: 3, muc: "yellow" }),
    cb({ idNguon: 4, muc: "call" }),
  ];

  it("★★★ CHỌN 'yellow' ⇒ DOM còn ĐÚNG 1 DÒNG, và là dòng vàng", () => {
    ve({ seed: ds, chonMuc: "yellow" });
    expect(dong()).toHaveLength(1);
    expect(screen.getByTestId("canh-bao-andon-3")).toHaveAttribute("data-muc", "yellow");
  });

  it("★★★ KHỚP CHÍNH XÁC — chọn 'yellow' KHÔNG kéo theo 'red'", () => {
    ve({ seed: ds, chonMuc: "yellow" });
    expect(screen.queryByTestId("canh-bao-andon-1")).toBeNull();
  });

  it("chip hiện SỐ ĐẾM theo mức", () => {
    ve({ seed: ds });
    expect(screen.getByTestId("chip-muc-tat_ca")).toHaveTextContent("4");
    expect(screen.getByTestId("chip-muc-red")).toHaveTextContent("2");
    expect(screen.getByTestId("chip-muc-green")).toHaveTextContent("0");
  });

  it("bấm chip gọi onChonMuc đúng giá trị; aria-pressed phản ánh lựa chọn", () => {
    const onChonMuc = vi.fn();
    ve({ seed: ds, chonMuc: "red", onChonMuc });
    expect(screen.getByTestId("chip-muc-red")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("chip-muc-tat_ca")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("chip-muc-yellow"));
    expect(onChonMuc).toHaveBeenCalledWith("yellow");
  });

  it("★★★ LỌC RA RỖNG ⇒ CHIP VẪN HIỆN (bộ lọc không tự nhốt chính nó)", () => {
    // Ẩn chip khi rỗng thì người dùng không còn nút nào để quay lại.
    ve({ seed: ds, chonMuc: "green" });
    expect(dong()).toHaveLength(0);
    expect(screen.getByTestId("chip-muc-tat_ca")).toBeInTheDocument();
  });

  it("★★★ 'lọc ra rỗng' và 'thật sự không có cảnh báo' là HAI CÂU KHÁC NHAU", () => {
    // Gộp làm một sẽ nói "không có cảnh báo" trong khi nhà máy đang đỏ.
    const { unmount } = ve({ seed: ds, chonMuc: "green" });
    expect(screen.getByTestId("dai-trong-muc")).toBeInTheDocument();
    expect(screen.queryByTestId("dai-trong")).toBeNull();
    unmount();
    ve({ seed: [] });
    expect(screen.getByTestId("dai-trong")).toBeInTheDocument();
    expect(screen.queryByTestId("dai-trong-muc")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #15 — lọc theo phạm vi nhánh
// ═══════════════════════════════════════════════════════════════════════════

function pv(sua: Partial<Record<keyof TapPhamVi, number[]>>): TapPhamVi {
  return {
    workshopIds: new Set(sua.workshopIds ?? []),
    lineIds: new Set(sua.lineIds ?? []),
    stationIds: new Set(sua.stationIds ?? []),
    machineIds: new Set(sua.machineIds ?? []),
  };
}

describe("#15 lọc theo nhánh đang chọn", () => {
  const ds = [
    cb({ idNguon: 1, machineId: 10, lineId: 3 }),
    cb({ idNguon: 2, machineId: 99, lineId: 7 }),
  ];

  it("★★★ CHỌN NHÁNH ⇒ DOM chỉ còn cảnh báo trong nhánh", () => {
    ve({ seed: ds, phamVi: pv({ machineIds: [10] }) });
    expect(dong()).toHaveLength(1);
    expect(screen.getByTestId("canh-bao-andon-1")).toBeInTheDocument();
  });

  it("★★★ null (chưa chọn) và phạm vi RỖNG THẬT cho hai kết quả KHÁC NHAU", () => {
    const { unmount } = ve({ seed: ds, phamVi: null });
    expect(dong()).toHaveLength(2);
    unmount();
    ve({ seed: ds, phamVi: pv({}) });
    expect(dong()).toHaveLength(0);
  });

  it("★ khớp theo lineId khi stationId NULL (7/7 hàng dev là vậy)", () => {
    ve({
      seed: [cb({ idNguon: 1, machineId: null, stationId: null, lineId: 3 })],
      phamVi: pv({ lineIds: [3] }),
    });
    expect(dong()).toHaveLength(1);
  });

  it("chỉ báo 'theo nhánh' hiện khi đang lọc, ẩn khi không", () => {
    const { unmount } = ve({ seed: ds, phamVi: pv({ machineIds: [10] }) });
    expect(screen.getByTestId("dai-theo-nhanh")).toBeInTheDocument();
    unmount();
    ve({ seed: ds, phamVi: null });
    expect(screen.queryByTestId("dai-theo-nhanh")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NT-3 / G15 — ba trạng thái của một chỉ số
// ═══════════════════════════════════════════════════════════════════════════

describe("NT-3/G15 — 'chưa đo' KHÔNG được vẽ như 'đã đo, bằng 0'", () => {
  it("★★★ ĐANG TẢI ⇒ '—', KHÔNG phải '0 cảnh báo'", () => {
    ve({ seed: [], dangTai: true });
    expect(screen.getByTestId("dai-chua-do")).toHaveTextContent("—");
    expect(screen.queryByTestId("dai-trong")).toBeNull();
  });

  it("★★★ KHÔNG ĐO ĐƯỢC (403 / query chưa từng chạy) ⇒ '—'", () => {
    // G15: `factory.list` trả [] kèm HTTP 200 ⇒ query `enabled:false` ⇒ cả
    // isLoading lẫn isError đều false — trạng thái THỨ BA mà hai cờ không mô tả.
    ve({ seed: [], khongDoDuoc: true });
    expect(screen.getByTestId("dai-chua-do")).toBeInTheDocument();
  });

  it("★★★ ĐÃ ĐO VÀ THẬT SỰ BẰNG 0 ⇒ câu 'không có cảnh báo', không phải '—'", () => {
    ve({ seed: [] });
    expect(screen.getByTestId("dai-trong")).toBeInTheDocument();
    expect(screen.queryByTestId("dai-chua-do")).toBeNull();
  });

  it("★ tiêu đề hiện '—' khi chưa đo, hiện SỐ khi đã đo", () => {
    const { unmount } = ve({ seed: [cb({ idNguon: 1 })], dangTai: true });
    expect(screen.getByTestId("dai-canh-bao")).toHaveTextContent("(—)");
    unmount();
    ve({ seed: [cb({ idNguon: 1 })] });
    expect(screen.getByTestId("dai-canh-bao")).toHaveTextContent("(1)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Đường end-to-end từ hàng THÔ
// ═══════════════════════════════════════════════════════════════════════════

describe("end-to-end — hàng thô (Date của tRPC + chuỗi ISO của socket)", () => {
  it("★★★ HAI KIỂU THỜI GIAN CỦA CÙNG MỘT HÀNG ⇒ VẪN 1 DÒNG", () => {
    // `AndonRealtimeEvent.raisedAt: Date | string` (socket.ts:1379). Nếu chuẩn
    // hoá sai, hai bản có `luc` khác nhau và dedupe vẫn ra 1 dòng nhưng NHÓM
    // 24h sai — nên ca này ghim cả hai.
    const tho = {
      id: 77,
      state: "red",
      status: "raised",
      title: "E-STOP",
      raisedAt: new Date(BAY_GIO - 30 * GIO),
      machineId: 5,
      lineId: 1,
    };
    ve({
      seed: [chuanHoaHang(tho, BAY_GIO)],
      song: [chuanHoaHang({ ...tho, raisedAt: new Date(BAY_GIO - 30 * GIO).toISOString() }, BAY_GIO)],
    });
    expect(dong()).toHaveLength(1);
    expect(screen.getByTestId("nhom-ton-dong")).toHaveTextContent("(1)");
  });

  it("★ tiêu đề từ DB hiện NGUYÊN VĂN — component không gọi t() lên dữ liệu", () => {
    ve({ seed: [chuanHoaHang({ id: 1, title: "Kẹt băng tải", raisedAt: BAY_GIO }, BAY_GIO)] });
    expect(screen.getByTestId("canh-bao-andon-1")).toHaveTextContent("Kẹt băng tải");
  });

  it("bấm một dòng gọi onChonCanhBao với đúng cảnh báo", () => {
    const onChonCanhBao = vi.fn();
    ve({ seed: [cb({ idNguon: 42, machineId: 7 })], onChonCanhBao });
    fireEvent.click(screen.getByTestId("canh-bao-andon-42"));
    expect(onChonCanhBao).toHaveBeenCalledWith(
      expect.objectContaining({ idNguon: 42, machineId: 7 }),
    );
  });
});
