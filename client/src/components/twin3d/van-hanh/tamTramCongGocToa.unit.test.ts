/**
 * tamTramCongGocToa.unit.test.ts — **TASK 17c: TÂM TRẠM PHẢI CỘNG GỐC TOÀ NHÀ.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MỘT BẢN VÁ KHÔNG ĐỔI MỘT PIXEL NÀO HÔM NAY — VÀ ĐÓ CHÍNH LÀ ĐIỂM
 * ════════════════════════════════════════════════════════════════════════════
 * `hopNhatCanh.dungMayVe` cộng `twin_toa_nha.viTri*Mm` cho MÁY từ lâu; tâm trạm thì vẫn dựng từ
 * `twin_dat_cho` **TRẦN**. Hôm nay không lệch, vì cả ba màn chỉ nạp tầng của MỘT toà và neo cảnh
 * vào chính toà ấy ⇒ mọi chỗ dời bằng 0.
 *
 * ⚠ Đó là một tiền đề **không ai cưỡng chế**. Cảnh mang HAI toà thì máy dời mà trạm không:
 * đường tâm chuyền **đứt khỏi chính máy của nó**, cột WIP đứng lệch, và **không lỗi nào nổ**.
 * Vòng này vừa trả giá đúng lớp ấy: cột WIP sai **16,6 m** qua nhiều đợt mà không lưới nào đỏ,
 * vì hai cái sai (`OngWip` đặt đáy 0 **và** `bboxKemCotWip` ép `minY: 0`) nhất quán với nhau.
 *
 * ⇒ Lưới này vì thế phải đo **ca TƯƠNG LAI** (gốc toà ≠ 0), không chỉ ca hôm nay. Một lưới chỉ
 *   đo ca hôm nay sẽ xanh cả trước lẫn sau bản vá — tức không đo gì cả.
 */
import { describe, expect, it } from "vitest";

import { dungHinhLine } from "./canhLine";

const tram = (id: number, lineId: number, thuTu: number) => ({ id, lineId, thuTu });
const datCho = (
  id: number,
  xMm: number,
  yMm: number,
  zMm: number,
  tangId: number | null = 9,
) => ({ loaiThucThe: "station", thucTheId: id, viTriXMm: xMm, viTriYMm: yMm, viTriZMm: zMm, tangId });

/** Trạm KHÔNG có máy ⇒ tâm lấy trọn từ đặt chỗ, nên đây là ca đo được chỗ dời rõ nhất. */
function tamCua(goc?: ReadonlyMap<number, { xMm: number; yMm: number; zMm: number }>) {
  const kq = dungHinhLine(
    1,
    [tram(7, 1, 1)],
    [],
    [],
    [datCho(7, 1_000, 2_000, 3_000)],
    goc ? { gocToaTheoTang: goc } : {},
  );
  return kq!.tram.find((x) => x.khoa === "station:7")!.tam;
}

describe("Task 17c — chỗ dời của toà cho tâm trạm", () => {
  it("★★★ KHÔNG có bản đồ chỗ dời ⇒ Y NGUYÊN hành vi cũ (bản vá không đổi gì hôm nay)", () => {
    // mm → m, và HOÁN TRỤC: y ← viTriZMm, z ← viTriYMm.
    expect(tamCua()).toEqual({ x: 1, y: 3, z: 2 });
  });

  it("★★★ CHỖ DỜI BẰNG 0 ⇒ cũng y nguyên — đây đúng là mọi cảnh MỘT TOÀ hôm nay", () => {
    expect(tamCua(new Map([[9, { xMm: 0, yMm: 0, zMm: 0 }]]))).toEqual({ x: 1, y: 3, z: 2 });
  });

  it("★★★ CA TƯƠNG LAI — gốc toà ≠ 0 ⇒ tâm trạm dời THEO, đúng như máy đã dời", () => {
    const tam = tamCua(new Map([[9, { xMm: 100_000, yMm: 200_000, zMm: 300_000 }]]));
    expect(tam).toEqual({ x: 101, y: 303, z: 202 });
  });

  it("★★★ HOÁN TRỤC của chỗ dời phải GIỐNG hoán trục của bản ghi", () => {
    /*
     * Dời CHỈ theo trục ngang `Y` của bản ghi (= `z` của cảnh). Nếu ai đó cộng `g.yMm` vào `y`
     * của cảnh thì trạm sẽ BAY LÊN 50 m đúng bằng toạ độ NGANG của toà — một khuyết tật câm,
     * cùng lớp "trạm nằm ngửa" mà `canhLine.ts` đã cảnh báo ở đầu tệp.
     */
    const tam = tamCua(new Map([[9, { xMm: 0, yMm: 50_000, zMm: 0 }]]));
    expect(tam.y).toBe(3); // chiều cao KHÔNG đổi
    expect(tam.z).toBe(52); // chiều sâu dời đúng 50 m
    expect(tam.x).toBe(1);
  });

  it("★★★ tầng KHÔNG có trong bản đồ ⇒ không dời (chưa biết ≠ bằng gốc — NT-3)", () => {
    expect(tamCua(new Map([[999, { xMm: 100_000, yMm: 0, zMm: 0 }]]))).toEqual({ x: 1, y: 3, z: 2 });
  });

  it("★★★ `tangId` THIẾU ⇒ không dời — kể cả khi bản đồ CÓ mục ở khoá `0`", () => {
    /*
     * ⚠⚠ Bản đầu của ca này dùng bản đồ chỉ có khoá `9`, và đột biến `get(d.tangId ?? 0)`
     *    **sống sót**: `get(0)` trả `undefined` nên kết quả trùng nhau. Tức ca đo đúng giá trị
     *    mà **không phân biệt được hai bản cài** — nó chưa chạm vào thứ nó tưởng đang canh.
     *
     * Bản đồ CÓ mục ở `0` mới phân biệt: `?? 0` biến "chưa biết tầng nào" thành "biết rồi, tầng
     * số 0" và dời trạm đi 100 m theo một toà nó không thuộc về — đúng lớp lỗi NT-3.
     */
    const kq = dungHinhLine(
      1,
      [tram(7, 1, 1)],
      [],
      [],
      [datCho(7, 1_000, 2_000, 3_000, null)],
      {
        gocToaTheoTang: new Map([
          [0, { xMm: 100_000, yMm: 0, zMm: 0 }],
          [9, { xMm: 100_000, yMm: 0, zMm: 0 }],
        ]),
      },
    );
    expect(kq!.tram.find((x) => x.khoa === "station:7")!.tam).toEqual({ x: 1, y: 3, z: 2 });
  });

  it("★★★ HAI TOÀ — mỗi trạm dời theo toà CỦA NÓ, không theo một gốc chung", () => {
    // Đây là chính ca mà bản vá sinh ra để chặn; trước nó, cả hai trạm đứng tại chỗ đặt TRẦN.
    const kq = dungHinhLine(
      1,
      [tram(7, 1, 1), tram(8, 1, 2)],
      [],
      [],
      [datCho(7, 1_000, 0, 0, 9), datCho(8, 1_000, 0, 0, 10)],
      {
        gocToaTheoTang: new Map([
          [9, { xMm: 0, yMm: 0, zMm: 0 }],
          [10, { xMm: 500_000, yMm: 0, zMm: 0 }],
        ]),
      },
    );
    const t7 = kq!.tram.find((x) => x.khoa === "station:7")!.tam;
    const t8 = kq!.tram.find((x) => x.khoa === "station:8")!.tam;
    expect(t7.x).toBe(1);
    expect(t8.x).toBe(501);
    expect(t8.x - t7.x).toBe(500); // hai toà cách nhau 500 m, KHÔNG chồng khít
  });

  it("★★★ `boQuaDatCho` (chế độ sơ đồ) vẫn THẮNG — chỗ dời không kéo trạm ra khỏi hệ sơ đồ", () => {
    const kq = dungHinhLine(
      1,
      [tram(7, 1, 1)],
      [{ machineId: 100, viTri: { x: 5, y: 16.6, z: 5 } }],
      [{ id: 100, lineId: 1, stationId: 7 }],
      [datCho(7, 1_000, 2_000, 3_000)],
      { boQuaDatCho: true, gocToaTheoTang: new Map([[9, { xMm: 999_000, yMm: 0, zMm: 0 }]]) },
    );
    expect(kq!.tram.find((x) => x.khoa === "station:7")!.tam).toEqual({ x: 5, y: 16.6, z: 5 });
  });
});
