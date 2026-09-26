/**
 * tamTramMotNoi.unit.test.ts — **MỘT PHÉP GHÉP WIP, MỘT NƠI** (G12).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO GỘP — BẢN SAO VỪA TÍNH TIỀN, KHÔNG PHẢI VÌ "CHO SẠCH"
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinVanHanh.tinhWip` là bản sao inline của `manLine.tinhWipLine`, và cả hai trang còn chép
 * thêm một vòng lặp `khoa → id` giống hệt nhau. Cả HAI bản chép đều bỏ mất `y` (cao độ sàn của
 * trạm) ở đúng vòng lặp ấy, nên cột WIP đứng ở cốt 0 trong khi chuyền nằm trên **tầng 3**:
 * **0/39** cột đứng đúng chỗ, lệch **111 px @1280×720**. Một khuyết tật, **hai** tệp phải vá.
 *
 * ⇒ Gộp về `tinhWipLine` + `tamTramTheoId`. Đây là refactor **giữ nguyên đầu ra** (G5/G32):
 *   cùng luật lọc theo line, cùng `soWip = null` khi chưa đo, cùng thứ tự sắp. Khác duy nhất là
 *   câu dự phòng cho `ma`/`ten`/`thuTu` thiếu — bản inline **ném** ở `a.ma.localeCompare(b.ma)`
 *   trong đúng ca đó, nên bản gộp chặt hơn chứ không lỏng hơn.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { tamTramTheoId, tinhWipLine } from "./manLine";
import { docMaNguon } from "@shared/testing/docMaNguon";

const GOC = resolve(__dirname, "../../../..");
const doc = (t: string) =>
  docMaNguon(resolve(GOC, "src/pages", t))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("tamTramTheoId", () => {
  const diem = (x: number, y: number, z: number) => ({ x, y, z });

  it("★★★ GIỮ `y` — đây chính là con số mà cả hai bản chép đã đánh rơi", () => {
    const m = tamTramTheoId([{ khoa: "station:7", tam: diem(1, 16.6, 3) }]);
    expect(m.get(7)).toEqual({ x: 1, y: 16.6, z: 3 });
  });

  it("★★★ khoá KHÔNG phân giải được ⇒ BỎ QUA, không lấy `NaN` làm khoá", () => {
    // `Map` nhận `NaN` làm khoá và mọi lượt tra sau đó trượt IM LẶNG.
    const m = tamTramTheoId([
      { khoa: "station:abc", tam: diem(1, 2, 3) },
      { khoa: "station:", tam: diem(4, 5, 6) },
      { khoa: "machine:9", tam: diem(7, 8, 9) },
      { khoa: "station:7", tam: diem(1, 1, 1) },
    ]);
    expect(m.size).toBe(1);
    expect(m.has(Number.NaN)).toBe(false);
    expect([...m.keys()]).toEqual([7]);
  });

  it("★ danh sách rỗng ⇒ bản đồ rỗng, không ném", () => {
    expect(tamTramTheoId([]).size).toBe(0);
  });
});

describe("★★★ tinhWipLine — hợp đồng mà CẢ HAI trang dựa vào", () => {
  const tram = [
    { id: 2, lineId: 1, thuTu: 2, ma: "B", ten: "Trạm B" },
    { id: 1, lineId: 1, thuTu: 1, ma: "A", ten: "Trạm A" },
    { id: 9, lineId: 2, thuTu: 1, ma: "X", ten: "Khác line" },
  ];
  const tamTram = new Map([
    [1, { x: 1, y: 16.6, z: 1 }],
    [2, { x: 2, y: 16.6, z: 2 }],
  ]);

  it("★★★ lọc theo line VÀ sắp theo `thuTu` — thứ tự dòng chảy, không theo id", () => {
    const kq = tinhWipLine({ lineId: 1, tram, tamTram, daDo: true, soTheoTram: new Map() });
    expect(kq.map((k) => k.stationId)).toEqual([1, 2]);
  });

  it("★★★ `daDo = false` ⇒ MỌI `soWip` là `null`, KHÔNG phải 0", () => {
    const kq = tinhWipLine({
      lineId: 1,
      tram,
      tamTram,
      daDo: false,
      soTheoTram: new Map([[1, 7]]),
    });
    expect(kq.every((k) => k.soWip === null)).toBe(true);
  });

  it("★★★ `daDo = true` + trạm vắng mặt ⇒ 0 THẬT (khác hẳn `null`)", () => {
    const kq = tinhWipLine({
      lineId: 1,
      tram,
      tamTram,
      daDo: true,
      soTheoTram: new Map([[1, 7]]),
    });
    expect(kq.find((k) => k.stationId === 1)!.soWip).toBe(7);
    expect(kq.find((k) => k.stationId === 2)!.soWip).toBe(0);
  });

  it("★★★ `y` đi HẾT chuỗi; trạm thiếu toạ độ ⇒ gốc, không biến mất", () => {
    const kq = tinhWipLine({
      lineId: 1,
      tram,
      tamTram: new Map([[1, { x: 1, y: 16.6, z: 1 }]]),
      daDo: true,
      soTheoTram: new Map(),
    });
    expect(kq.find((k) => k.stationId === 1)!.y).toBeCloseTo(16.6, 9);
    const thieu = kq.find((k) => k.stationId === 2)!;
    expect(thieu).toBeDefined();
    expect([thieu.x, thieu.y, thieu.z]).toEqual([0, 0, 0]);
  });

  it("★ `ma`/`ten`/`thuTu` THIẾU ⇒ có câu dự phòng, KHÔNG ném khi sắp", () => {
    // Bản inline cũ của màn Vận hành sẽ ném ở `a.ma.localeCompare(b.ma)` trong đúng ca này.
    const kq = tinhWipLine({
      lineId: 1,
      tram: [{ id: 5, lineId: 1 }, { id: 6, lineId: 1 }],
      tamTram: new Map(),
      daDo: true,
      soTheoTram: new Map(),
    });
    expect(kq.map((k) => k.ma)).toEqual(["S5", "S6"]);
  });
});

describe("★★★ G93 — CẢ HAI trang dùng chung phép ghép, không trang nào chép lại", () => {
  for (const tep of ["TwinVanHanh.tsx", "TwinLine.tsx"]) {
    it(`${tep} gọi \`tinhWipLine\` và \`tamTramTheoId\``, () => {
      const ma = doc(tep);
      expect(ma).toContain("tinhWipLine({");
      expect(ma).toContain("tamTramTheoId(");
    });

    it(`★★★ ${tep} KHÔNG còn chép lại vòng lặp \`khoa.slice("station:")\``, () => {
      expect(doc(tep)).not.toContain('slice("station:".length)');
    });
  }

  it("★★★ `daDo` đọc `isSuccess`, KHÔNG `!isLoading` (403 cũng tắt `isLoading`)", () => {
    for (const tep of ["TwinVanHanh.tsx", "TwinLine.tsx"]) {
      const ma = doc(tep);
      expect(ma).toMatch(/daDo:\s*wipQ\.isSuccess/);
    }
  });
});
