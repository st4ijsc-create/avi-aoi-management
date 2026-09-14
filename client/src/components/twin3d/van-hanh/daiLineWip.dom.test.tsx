// @vitest-environment jsdom
//
/**
 * daiLineWip.dom.test.tsx — ★★★ §11.5 ĐO TRÊN **DOM THẬT**, DỮ LIỆU **KHÁC RỖNG**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TỆP NÀY TỒN TẠI VÌ G5 VÀ G20, KHÔNG PHẢI VÌ ĐỦ SỐ TEST
 * ════════════════════════════════════════════════════════════════════════════
 * G5 — *"cổng xanh trên tập rỗng trùng khít cổng xanh của hệ đúng"*. Đợt 7 đo
 * được: **không test nào trong 994 test truyền một `wip` KHÁC RỖNG**. Nên mọi ca
 * ở đây bơm một chuyền 5 trạm CÓ SỐ và đọc lại chữ THẬT trong DOM.
 *
 * G20 — *"test phải import CHÍNH MODULE GIAO HÀNG"*. Tệp này `import { DaiLine }
 * from "./DaiLine"` — đúng component mà `TwinVanHanh.tsx` render. Xoá cột WIP
 * khỏi `DaiLine.tsx` thì tệp này ĐỎ; đó là phép thử tự đặt cho chính nó.
 *
 * ★ `react-i18next` được mock ở mức mỏng nhất có thể: `t(khoa, mặc định, tuỳ
 *   biến)` trả đúng chuỗi mặc định đã nội suy. KHÔNG mock `DaiLine`, KHÔNG mock
 *   `wipTram` — nếu mock chúng thì cái được đo sẽ là dàn mock (G20).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, macDinh?: string, bien?: Record<string, unknown>) => {
      let s = macDinh ?? _k;
      if (bien) for (const [k, v] of Object.entries(bien)) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));

import { DaiLine, nhanNhip, type TramTrenDai } from "./DaiLine";
import { cotWip, xepHangWip, type TinhWip } from "./wipTram";

afterEach(() => cleanup());

/** Cùng chuyền 5 trạm của `wipTram.unit.test.ts` — trạm 3 nghẽn (12 vs trung vị 4). */
const NGUON: TinhWip[] = [
  { stationId: 1, ma: "ST-01", ten: "Nạp liệu", thuTu: 1, soWip: 4, x: 0, z: 0 },
  { stationId: 2, ma: "ST-02", ten: "Dán keo", thuTu: 2, soWip: 3, x: 5, z: 0 },
  { stationId: 3, ma: "ST-03", ten: "AOI", thuTu: 3, soWip: 12, x: 10, z: 0 },
  { stationId: 4, ma: "ST-04", ten: "Hàn", thuTu: 4, soWip: 5, x: 15, z: 0 },
  { stationId: 5, ma: "ST-05", ten: "Đóng gói", thuTu: 5, soWip: 4, x: 20, z: 0 },
];

/** Mốc "vừa mới đo" — lời khai server còn hạn (xem `HAN_KHAI_NGHEN_MS`). */
const BAY_GIO = 1_800_000_000_000;
const MOC_TUOI = BAY_GIO - 60_000;

/** Dựng props ĐÚNG cách `TwinVanHanh.tsx` dựng chúng — không có đường tắt. */
function dungTram(nguon: TinhWip[], nghenServer: number | null = null): TramTrenDai[] {
  const khai = { nghenTheoServer: nghenServer, mocKhai: MOC_TUOI, bayGio: BAY_GIO };
  const bang = xepHangWip(nguon, khai);
  return nguon.map((t) => {
    const w = bang.find((d) => d.stationId === t.stationId)!;
    return {
      id: t.stationId,
      ma: t.ma,
      ten: t.ten,
      thuTu: t.thuTu,
      soMay: 2,
      trangThai: "chay",
      soWip: w.soWip,
      nghen: w.nghen,
      hang: w.hang,
    };
  });
}

describe("★★★ §11.5 — DẢI 2D vẽ SỐ WIP THẬT trong DOM", () => {
  it("★★★ năm trạm ⇒ năm ô WIP có mặt, KHÔNG phải zero ô", () => {
    render(<DaiLine tram={dungTram(NGUON)} onChonTram={() => {}} nhipChuyenMs={12_400} />);
    for (const t of NGUON) {
      expect(screen.getByTestId(`o-tram-wip-${t.stationId}`)).toBeInTheDocument();
    }
  });

  it("★★★ CON SỐ hiện ra đúng — đây là thứ màu 3D không nói được", () => {
    render(<DaiLine tram={dungTram(NGUON)} onChonTram={() => {}} />);
    expect(screen.getByTestId("o-tram-wip-3")).toHaveTextContent("12");
    expect(screen.getByTestId("o-tram-wip-2")).toHaveTextContent("3");
    expect(screen.getByTestId("o-tram-wip-1")).toHaveTextContent("4");
  });

  it("★★★ HẠNG hiện ra — trạm 3 là #1, trạm 4 là #2", () => {
    render(<DaiLine tram={dungTram(NGUON)} onChonTram={() => {}} />);
    expect(screen.getByTestId("o-tram-wip-3")).toHaveTextContent("#1");
    expect(screen.getByTestId("o-tram-wip-4")).toHaveTextContent("#2");
  });

  it("★★★ tổng WIP = 28, in ra chứ không phải suy trong đầu người đọc", () => {
    render(<DaiLine tram={dungTram(NGUON)} onChonTram={() => {}} />);
    expect(screen.getByTestId("dai-line-tong-wip")).toHaveTextContent("28");
  });

  it("★★★ NHỊP CHUYỀN in bằng SỐ cạnh mũi tên động của 3D (#36)", () => {
    render(<DaiLine tram={dungTram(NGUON)} onChonTram={() => {}} nhipChuyenMs={12_400} />);
    expect(screen.getByTestId("dai-line-nhip")).toHaveTextContent("12.4s");
  });

  it("★★★ nhịp CHƯA ĐO ĐƯỢC ⇒ `—`, KHÔNG phải `0.0s`", () => {
    render(<DaiLine tram={dungTram(NGUON)} onChonTram={() => {}} nhipChuyenMs={null} />);
    expect(screen.getByTestId("dai-line-nhip")).toHaveTextContent("—");
    expect(screen.getByTestId("dai-line-nhip")).not.toHaveTextContent("0.0s");
  });
});

describe("★★★ §11.5 — CỜ NGHẼN của 2D KHỚP TUYỆT ĐỐI với cột 3D (G12)", () => {
  it("★★★ đúng MỘT ô mang `data-nghen=1`, và là trạm 3 — y hệt `cotWip`", () => {
    render(<DaiLine tram={dungTram(NGUON)} onChonTram={() => {}} />);
    const co = NGUON.filter(
      (t) => screen.getByTestId(`o-tram-wip-${t.stationId}`).getAttribute("data-nghen") === "1",
    ).map((t) => t.stationId);
    expect(co).toEqual([3]);

    // Đối chiếu SANG BỀ MẶT KIA — không phải so 2D với chính nó.
    const cot = cotWip(NGUON);
    const nghen3D = NGUON.filter((_, i) => cot[i]?.nghen).map((t) => t.stationId);
    expect(nghen3D).toEqual(co);
  });

  it("★★★ server khai trạm 5 ⇒ CẢ HAI bề mặt đổi sang trạm 5, cùng lúc", () => {
    render(<DaiLine tram={dungTram(NGUON, 5)} onChonTram={() => {}} />);
    expect(screen.getByTestId("o-tram-wip-5").getAttribute("data-nghen")).toBe("1");
    // trạm 3 có 12 WIP nhưng server không khai nó ⇒ KHÔNG đỏ
    expect(screen.getByTestId("o-tram-wip-3").getAttribute("data-nghen")).toBe("0");

    const cot = cotWip(NGUON, { nghenTheoServer: 5, mocKhai: MOC_TUOI, bayGio: BAY_GIO });
    expect(cot.filter((c) => c.nghen)).toHaveLength(1);
    expect(cot[4].nghen).toBe(true);
  });
});

describe("★★★ NT-3 — 'chưa đo được' hiện `—`, KHÔNG hiện `0`", () => {
  it("★★★ truy vấn WIP chưa trả lời ⇒ MỌI ô hiện `—` và cột vẫn CÒN", () => {
    // Ẩn cột đi là khai rằng WIP không phải thứ màn này theo dõi, trong khi sự
    // thật là ta chưa/không được phép thấy nó.
    const chuaDo = dungTram(NGUON).map((t) => ({ ...t, soWip: null, nghen: false, hang: null }));
    render(<DaiLine tram={chuaDo} onChonTram={() => {}} />);
    for (const t of NGUON) {
      const o = screen.getByTestId(`o-tram-wip-${t.stationId}`);
      expect(o).toBeInTheDocument();
      expect(o).toHaveTextContent("—");
      expect(o.textContent).not.toMatch(/\b0\b/);
    }
    expect(screen.getByTestId("dai-line-tong-wip")).toHaveTextContent("—");
  });

  it("★★★ trạm ĐO ĐƯỢC và bằng 0 hiện `0` — KHÁC với `—`", () => {
    // Hai câu khác nhau phải trông khác nhau; đây là phép đối chứng của ca trên.
    const trong = dungTram(NGUON.map((t) => (t.stationId === 2 ? { ...t, soWip: 0 } : t)));
    render(<DaiLine tram={trong} onChonTram={() => {}} />);
    expect(screen.getByTestId("o-tram-wip-2")).toHaveTextContent("0");
    expect(screen.getByTestId("o-tram-wip-2")).not.toHaveTextContent("—");
  });

  it("★★★ ĐỐI CHỨNG — phạm vi KHÔNG phải Line (`soWip` vắng) ⇒ 0 ô WIP", () => {
    // Chứng minh rằng cái xanh ở trên KHÔNG phải cái xanh mà tập rỗng cũng cho:
    // bỏ khoá `soWip` đi thì cột biến mất hoàn toàn.
    const khongWip: TramTrenDai[] = NGUON.map((t) => ({
      id: t.stationId,
      ma: t.ma,
      ten: t.ten,
      thuTu: t.thuTu,
      soMay: 2,
      trangThai: "chay",
    }));
    render(<DaiLine tram={khongWip} onChonTram={() => {}} />);
    expect(screen.queryByTestId("o-tram-wip-3")).toBeNull();
    expect(screen.queryByTestId("dai-line-tong-wip")).toBeNull();
    // nhưng dải vẫn còn — trạm và số máy vẫn đọc được
    expect(screen.getByTestId("dai-line")).toBeInTheDocument();
    expect(screen.getByTestId("o-tram-3")).toBeInTheDocument();
  });
});

describe("nhanNhip — quy ms sang chữ", () => {
  it("12.400 ms ⇒ `12.4s`", () => expect(nhanNhip(12_400)).toBe("12.4s"));
  it("★ mọi ca 'không biết' đều ra `—`", () => {
    for (const x of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nhanNhip(x as number | null)).toBe("—");
    }
  });
});
