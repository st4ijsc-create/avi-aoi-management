/**
 * Lưới cho T-2 lát Line (`dungHinhLine`) — §15.5.2.
 *
 * ★★★ Đây là lưới của một phép TÁCH, nên câu hỏi đúng là **G5/G32**: *đầu ra có
 * KHÁC đầu vào không?* — chứ không phải "hàm mới có chạy không". Mỗi ca dưới
 * đây ghim một LUẬT mà bản trong `TwinVanHanh.tsx` đã có, để một bản viết lại
 * cẩu thả sẽ ĐỎ chứ không lặng lẽ đổi hình.
 */

import { describe, expect, it } from "vitest";

import { dungHinhLine, type DatChoTho, type TramTho } from "./canhLine";

const datCho = (id: number, x: number, y: number, z: number): DatChoTho => ({
  loaiThucThe: "station",
  thucTheId: id,
  viTriXMm: x,
  viTriYMm: y,
  viTriZMm: z,
});

const tram = (id: number, lineId: number | null, thuTu?: number): TramTho => ({
  id,
  lineId,
  thuTu,
});

describe("dungHinhLine — cổng vào", () => {
  it("★ lineId null ⇒ null (không ở cấp Line, không dựng gì)", () => {
    expect(dungHinhLine(null, [tram(1, 1)], [], [], [])).toBeNull();
  });

  it("★★★ line KHÔNG có trạm và KHÔNG có máy ⇒ null, KHÔNG phải hình rỗng", () => {
    // Trả một `HinhHocLine` cho tập rỗng là vẽ ra một chuyền không tồn tại.
    expect(dungHinhLine(9, [tram(1, 1)], [], [], [])).toBeNull();
  });

  it("★ chỉ lấy trạm CỦA line được hỏi — trạm line khác không lọt vào", () => {
    const kq = dungHinhLine(
      1,
      [tram(1, 1, 1), tram(2, 2, 1), tram(3, 1, 2)],
      [],
      [],
      [datCho(1, 0, 0, 0), datCho(2, 5000, 0, 0), datCho(3, 2500, 0, 0)],
    );
    expect(kq).not.toBeNull();
    expect(kq!.tram.map((t) => t.khoa).sort()).toEqual(["station:1", "station:3"]);
  });
});

describe("★★★ luật TRẠM CHƯA CÓ ĐẶT CHỖ — suy tâm từ MÁY của trạm", () => {
  /*
   * Đây là luật dễ mất nhất khi viết lại: bỏ trạm chưa đặt chỗ đi thì đường tâm
   * ĐỨT QUÃNG mà không có lỗi nào — người xem tưởng chuyền thiếu trạm.
   */
  it("trạm không có đặt chỗ NHƯNG có máy ⇒ vẫn có mặt, tâm = trung bình máy", () => {
    const kq = dungHinhLine(
      1,
      [tram(7, 1, 1)],
      [
        { machineId: 100, viTri: { x: 2, y: 0, z: 4 } },
        { machineId: 101, viTri: { x: 4, y: 0, z: 8 } },
      ],
      [
        { id: 100, lineId: 1, stationId: 7 },
        { id: 101, lineId: 1, stationId: 7 },
      ],
      [], // ← KHÔNG có đặt chỗ nào
    );
    expect(kq).not.toBeNull();
    const t = kq!.tram.find((x) => x.khoa === "station:7");
    expect(t).toBeDefined();
    expect(t!.tam.x).toBe(3); // (2+4)/2
    expect(t!.tam.z).toBe(6); // (4+8)/2
    expect(t!.tam.y).toBe(0);
  });

  it("★ ĐẶT CHỖ THẮNG tâm-suy-từ-máy khi cả hai cùng có", () => {
    const kq = dungHinhLine(
      1,
      [tram(7, 1, 1)],
      [{ machineId: 100, viTri: { x: 99, y: 0, z: 99 } }],
      [{ id: 100, lineId: 1, stationId: 7 }],
      [datCho(7, 1000, 2000, 3000)],
    );
    const t = kq!.tram.find((x) => x.khoa === "station:7")!;
    // mm → m, và HOÁN TRỤC: y ← viTriZMm, z ← viTriYMm.
    expect(t.tam.x).toBeCloseTo(1);
    expect(t.tam.y).toBeCloseTo(3);
    expect(t.tam.z).toBeCloseTo(2);
  });

  it("★ trạm không đặt chỗ và KHÔNG máy ⇒ vẫn có mặt tại gốc, không bị loại", () => {
    const kq = dungHinhLine(1, [tram(7, 1, 1)], [{ machineId: 1, viTri: { x: 1, y: 0, z: 1 } }], [{ id: 1, lineId: 1 }], []);
    const t = kq!.tram.find((x) => x.khoa === "station:7")!;
    expect(t.tam).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("★ HOÁN TRỤC mm→m — sai trục thì trạm nằm ngửa mà không lỗi nào nổ", () => {
  it("y lấy từ viTriZMm và z lấy từ viTriYMm (không phải cùng tên)", () => {
    const kq = dungHinhLine(1, [tram(1, 1)], [], [], [datCho(1, 0, 7000, 0)]);
    const t = kq!.tram[0];
    // viTriYMm = 7000 phải rơi vào **z**, không phải y.
    expect(t.tam.z).toBeCloseTo(7);
    expect(t.tam.y).toBeCloseTo(0);
  });
});

describe("★ chỉ đọc đặt chỗ loại 'station'", () => {
  it("bản ghi loaiThucThe khác bị bỏ qua — không lẫn máy vào bảng trạm", () => {
    const kq = dungHinhLine(
      1,
      [tram(1, 1)],
      [{ machineId: 5, viTri: { x: 1, y: 0, z: 1 } }],
      [{ id: 5, lineId: 1 }],
      [{ ...datCho(1, 9000, 9000, 9000), loaiThucThe: "machine" }],
    );
    // Đặt chỗ kiểu `machine` KHÔNG được dùng cho trạm ⇒ trạm rơi về gốc.
    expect(kq!.tram[0].tam).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("★ máy của line — lọc theo lineId của MÁY", () => {
  it("máy line khác không kéo hình học lệch đi", () => {
    const chung = {
      tram: [tram(1, 1)] as TramTho[],
      datCho: [datCho(1, 0, 0, 0)],
    };
    const chiLine1 = dungHinhLine(
      1,
      chung.tram,
      [{ machineId: 10, viTri: { x: 1, y: 0, z: 0 } }],
      [{ id: 10, lineId: 1 }],
      chung.datCho,
    );
    const themLine2 = dungHinhLine(
      1,
      chung.tram,
      [
        { machineId: 10, viTri: { x: 1, y: 0, z: 0 } },
        { machineId: 11, viTri: { x: 500, y: 0, z: 500 } }, // line 2 — phải bị loại
      ],
      [
        { id: 10, lineId: 1 },
        { id: 11, lineId: 2 },
      ],
      chung.datCho,
    );
    expect(themLine2).toEqual(chiLine1);
  });
});
