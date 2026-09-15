/**
 * Lưới cho T-4 (`hopNhatCanh.ts`) — §15.5.2 / Đợt 29.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TỆP NÀY ĐO BẰNG **GIÁ TRỊ TRẢ VỀ**, KHÔNG PHẢI VĂN BẢN — VÀ ĐÓ LÀ MỘT
 *     BƯỚC LÊN, KHÔNG PHẢI MỘT NGOẠI LỆ
 * ════════════════════════════════════════════════════════════════════════════
 * Các hook T-1/T-3 (`usePhanTichLine`, `useMoPhongTwin`, `useAnhLichSu`) phải
 * hạ xuống phép đo VĂN BẢN vì chúng bọc `trpc` — gọi thật cần cả một cây React
 * và một server. `hopNhatCanh.ts` là hàm THUẦN, nên nó gọi được, nên nó phải
 * được đo bằng cái nó TRẢ VỀ. Đừng hạ cấp tệp này xuống grep.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CA TRUNG TÂM: **HOÁN VỊ TRỤC** — VÀ VÌ SAO BA GIÁ TRỊ PHẢI KHÁC NHAU
 * ════════════════════════════════════════════════════════════════════════════
 * Nếu fixture dùng `x=1, y=1, z=1` thì MỌI hoán vị đều cho cùng kết quả và ca
 * này xanh với cả sáu cách viết sai. Nên fixture dùng ba số **khác hẳn nhau**
 * (1000 / 2000 / 3000 mm), và ca ghim TỪNG trục vào ĐÚNG nguồn của nó:
 *
 *     scene.x ← viTriXMm   scene.y ← viTriZMm (ĐỘ CAO)   scene.z ← viTriYMm
 *
 * Đây chính là bẫy mà `TwinVanHanh.tsx` tự khai: *"máy bay lên trời mà không gì
 * nổ"* — một cảnh 3D sai trục vẫn là một cảnh 3D hợp lệ về kiểu dữ liệu.
 */
import { describe, it, expect } from "vitest";
import {
  dungMayVe,
  idMayChuaDat,
  mepMatBang,
  neoTrenNoc,
  dungNhanMay,
  gopNhan,
  dungCanhBao3D,
  gocToaTheoTang,
  CO_DU_PHONG,
  GOC_TOA_KHONG,
  HO_NHAN_MAY,
  HO_CANH_BAO,
  type MayVaoCanh,
  type DatChoVaoCanh,
  type CongCuMau,
  type MayDaDung,
  type GocToaMm,
} from "./hopNhatCanh";

/* ── Giáo cụ TẤT ĐỊNH: không đọc DOM, không đọc theme ─────────────────────── */

const congCu: CongCuMau = {
  mauCss: (token) => `MAU(${token})`,
  phaVeNen: (mau, nen, tiLe) => `PHA(${mau},${nen},${tiLe})`,
  mauChoTrangThai: (tt) => ({
    token: `--tt-${tt ?? "khong_ro"}`,
    doMo: tt === "chay" ? 1 : 0.6,
    khoaNhan: `nhan.${tt ?? "khong_ro"}`,
    laBatThuong: tt === "loi",
  }),
  hinhKhoiCho: (loai) => (loai === "aoi" ? "buong_kiem_quang" : "tram_chung"),
};

const datCho = (o: Partial<DatChoVaoCanh> = {}): DatChoVaoCanh => ({
  hienThi: true,
  tangId: 1,
  // ★ BA SỐ KHÁC NHAU — điều kiện để ca hoán vị trục có sức bác bỏ.
  viTriXMm: 1000,
  viTriYMm: 2000,
  viTriZMm: 3000,
  rongMm: null,
  caoMm: null,
  sauMm: null,
  quatX: 0,
  quatY: 0,
  quatZ: 0,
  quatW: 1,
  ...o,
});

const may = (id: number, o: Partial<MayVaoCanh> = {}): MayVaoCanh => ({
  id,
  stationId: null,
  lineId: null,
  loaiMay: "AOI",
  ...o,
});

const tsCoBan = (
  mays: MayVaoCanh[],
  datChos: Array<[number, DatChoVaoCanh]>,
  trong: (m: MayVaoCanh) => boolean = () => true,
  goc: ReadonlyMap<number, GocToaMm> = new Map(),
) => ({
  may: mays,
  datChoTheoMay: new Map(datChos),
  kichThuocTheoLoai: new Map<string, typeof CO_DU_PHONG>(),
  trangThaiTheoMay: new Map<number, string>(),
  gocToaTheoTang: goc,
  trongPhamVi: trong,
  mauNenCanh: "NEN",
  tiLePhaNgoaiPhamVi: 0.72,
  congCu,
});

/* ═══════════════════════════════════════════════════════════════════════════ */

describe("dungMayVe — hoán vị trục §5.2", () => {
  it("★★★ scene.x←Xmm · scene.y←Zmm (ĐỘ CAO) · scene.z←Ymm — ba trục ba nguồn KHÁC nhau", () => {
    const [m] = dungMayVe(tsCoBan([may(1)], [[1, datCho()]]));
    // 1000mm → 1m, 2000mm → 2m, 3000mm → 3m
    expect(m.viTri.x).toBe(1); // ← viTriXMm
    expect(m.viTri.y).toBe(3); // ← viTriZMm, ĐỘ CAO
    expect(m.viTri.z).toBe(2); // ← viTriYMm, MẶT BẰNG
  });

  it("★ hoán vị SAI bị bác: y KHÔNG được bằng z, và cả hai KHÔNG bằng x", () => {
    const [m] = dungMayVe(tsCoBan([may(1)], [[1, datCho()]]));
    expect(m.viTri.y).not.toBe(m.viTri.z);
    expect(m.viTri.x).not.toBe(m.viTri.y);
    expect(m.viTri.x).not.toBe(m.viTri.z);
  });

  it("bỏ máy KHÔNG có hàng đặt chỗ", () => {
    expect(dungMayVe(tsCoBan([may(1), may(2)], [[1, datCho()]]))).toHaveLength(1);
  });

  it("★★★ bỏ máy có hàng nhưng `hienThi=false` — cùng biểu thức mà khu chờ phủ định", () => {
    const ra = dungMayVe(
      tsCoBan(
        [may(1), may(2)],
        [
          [1, datCho()],
          [2, datCho({ hienThi: false })],
        ],
      ),
    );
    expect(ra.map((m) => m.machineId)).toEqual([1]);
  });

  it("kích thước: hàng đặt chỗ thắng, rồi bảng loại máy, rồi CO_DU_PHONG", () => {
    const ts = tsCoBan(
      [may(1), may(2), may(3, { loaiMay: "LA" })],
      [
        [1, datCho({ rongMm: 500, caoMm: 600, sauMm: 700 })],
        [2, datCho()],
        [3, datCho()],
      ],
    );
    ts.kichThuocTheoLoai = new Map([["AOI", { rongMm: 111, caoMm: 222, sauMm: 333 }]]);
    const ra = dungMayVe(ts);
    expect(ra[0].kichThuocMm).toEqual({ rongMm: 500, caoMm: 600, sauMm: 700 });
    expect(ra[1].kichThuocMm).toEqual({ rongMm: 111, caoMm: 222, sauMm: 333 });
    expect(ra[2].kichThuocMm).toEqual(CO_DU_PHONG);
  });

  it("★★★ NGOÀI phạm vi ⇒ PHA VỀ NỀN và doMo=1 — KHÔNG làm tối", () => {
    const trongPv = dungMayVe(tsCoBan([may(1)], [[1, datCho()]], () => true))[0];
    const ngoaiPv = dungMayVe(tsCoBan([may(1)], [[1, datCho()]], () => false))[0];
    expect(ngoaiPv.mau).toContain("PHA(");
    expect(ngoaiPv.mau).toContain("NEN");
    expect(ngoaiPv.doMo).toBe(1);
    // Trong phạm vi thì màu đi thẳng, KHÔNG qua phaVeNen.
    expect(trongPv.mau).not.toContain("PHA(");
  });

  it("`trongPhamVi` nhận đúng `tangId` của HÀNG ĐẶT CHỖ, không phải của máy", () => {
    const thay: Array<number | null> = [];
    const ts = tsCoBan([may(1)], [[1, datCho({ tangId: 7 })]]);
    ts.trongPhamVi = ((m: MayVaoCanh, tangId: number | null) => {
      thay.push(tangId);
      return true;
    }) as never;
    dungMayVe(ts);
    expect(thay).toEqual([7]);
  });

  it("quaternion identity ⇒ góc 0", () => {
    expect(dungMayVe(tsCoBan([may(1)], [[1, datCho()]]))[0].gocXoayRad).toBe(0);
  });
});

describe("idMayChuaDat — phủ định CHÍNH XÁC của điều kiện vẽ", () => {
  const base = (mays: MayVaoCanh[], dc: Array<[number, DatChoVaoCanh]>, nap: number[]) => ({
    may: mays,
    datChoTheoMay: new Map(dc),
    idDuocNap: new Set(nap),
  });

  it("★★★ máy CÓ hàng nhưng `hienThi=false` VÀO khu chờ — không rơi vào khe giữa", () => {
    expect(idMayChuaDat(base([may(1)], [[1, datCho({ hienThi: false })]], [1]))).toEqual([1]);
  });

  it("máy KHÔNG có hàng vào khu chờ", () => {
    expect(idMayChuaDat(base([may(1)], [], [1]))).toEqual([1]);
  });

  it("máy ĐANG vẽ KHÔNG vào khu chờ — hai tập rời nhau", () => {
    const mays = [may(1), may(2, { isActive: true })];
    const dc: Array<[number, DatChoVaoCanh]> = [
      [1, datCho()],
      [2, datCho({ hienThi: false })],
    ];
    const ve = dungMayVe(tsCoBan(mays, dc)).map((m) => m.machineId);
    const cho = idMayChuaDat(base(mays, dc, [1, 2]));
    expect(ve).toEqual([1]);
    expect(cho).toEqual([2]);
    // ★ Bất biến: HỢP hai tập = mọi máy, GIAO = rỗng.
    expect([...ve, ...cho].sort()).toEqual([1, 2]);
    expect(ve.filter((i) => cho.includes(i))).toEqual([]);
  });

  it("★ F2 — máy NGOÀI lượt nạp bị loại, dù chưa đặt chỗ", () => {
    expect(idMayChuaDat(base([may(1), may(2)], [], [1]))).toEqual([1]);
  });

  it("máy `isActive=false` bị loại", () => {
    expect(idMayChuaDat(base([may(1, { isActive: false })], [], [1]))).toEqual([]);
  });
});

describe("mepMatBang", () => {
  const m = (x: number, z: number): MayDaDung => ({
    machineId: 1,
    khoi: "tram_chung",
    kichThuocMm: CO_DU_PHONG,
    viTri: { x, y: 0, z },
    gocXoayRad: 0,
    mau: "",
    doMo: 1,
  });

  it("lấy MIN theo từng trục, độc lập", () => {
    expect(mepMatBang([m(5, 9), m(2, 11), m(8, 3)])).toEqual({ mepX: 2, mepZ: 3 });
  });

  it("★ mặt bằng RỖNG ⇒ neo gốc, KHÔNG trả Infinity", () => {
    const r = mepMatBang([]);
    expect(r).toEqual({ mepX: 0, mepZ: 0 });
    expect(Number.isFinite(r.mepX)).toBe(true);
    expect(Number.isFinite(r.mepZ)).toBe(true);
  });
});

describe("neoTrenNoc — CHỈ trục ĐỘ CAO được cộng", () => {
  const m: MayDaDung = {
    machineId: 1,
    khoi: "tram_chung",
    kichThuocMm: { rongMm: 1000, caoMm: 2000, sauMm: 1000 },
    viTri: { x: 10, y: 20, z: 30 },
    gocXoayRad: 0,
    mau: "",
    doMo: 1,
  };

  it("★★★ x và z GIỮ NGUYÊN; chỉ y tăng đúng cao(m) + hở", () => {
    const p = neoTrenNoc(m, HO_NHAN_MAY);
    expect(p.x).toBe(10);
    expect(p.z).toBe(30);
    expect(p.y).toBeCloseTo(20 + 2 + HO_NHAN_MAY, 10);
  });

  it("cảnh báo neo CAO HƠN nhãn — không chồng lên nhau", () => {
    expect(neoTrenNoc(m, HO_CANH_BAO).y).toBeGreaterThan(neoTrenNoc(m, HO_NHAN_MAY).y);
  });
});

describe("dungNhanMay / gopNhan", () => {
  const mayVe = dungMayVe(tsCoBan([may(1), may(2)], [[1, datCho()], [2, datCho()]]));

  it("một nhãn cho mỗi máy ĐANG VẼ, mã lấy từ bảng mã", () => {
    const ra = dungNhanMay({
      mayVe,
      trangThaiTheoMay: new Map([[1, "loi"]]),
      maTheoMay: new Map([[1, "M-01"]]),
      mauChoTrangThai: congCu.mauChoTrangThai,
      t: (k) => `T(${k})`,
    });
    expect(ra).toHaveLength(2);
    expect(ra[0].ma).toBe("M-01");
    expect(ra[0].batThuong).toBe(true);
    expect(ra[0].phu).toBe("T(nhan.loi)");
    // Không có mã ⇒ dấu thăng + id, KHÔNG rỗng.
    expect(ra[1].ma).toBe("#2");
    expect(ra[1].batThuong).toBe(false);
  });

  it("★★★ nhãn Line mang machineId ÂM — hai không gian khoá KHÔNG va nhau", () => {
    const nhanMay = dungNhanMay({
      mayVe,
      trangThaiTheoMay: new Map(),
      maTheoMay: new Map(),
      mauChoTrangThai: congCu.mauChoTrangThai,
      t: (k) => k,
    });
    const gop = gopNhan(nhanMay, [
      { lineId: 1, viTri: { x: 0, y: 0, z: 0 }, ma: "L1", ten: "Chuyen 1" },
    ]);
    const idLine = gop.find((n) => n.khoa === "line-1")!.machineId;
    expect(idLine).toBe(-1);
    // Máy id 1 tồn tại — nếu nhãn Line mang +1 thì nó sáng lên khi chọn máy 1.
    expect(nhanMay.some((n) => n.machineId === 1)).toBe(true);
    expect(gop.filter((n) => n.machineId === idLine)).toHaveLength(1);
  });

  it("khoá nhãn máy và nhãn line KHÔNG trùng nhau", () => {
    const gop = gopNhan(
      dungNhanMay({
        mayVe,
        trangThaiTheoMay: new Map(),
        maTheoMay: new Map(),
        mauChoTrangThai: congCu.mauChoTrangThai,
        t: (k) => k,
      }),
      [{ lineId: 1, viTri: { x: 0, y: 0, z: 0 }, ma: "L1", ten: "C1" }],
    );
    expect(new Set(gop.map((n) => n.khoa)).size).toBe(gop.length);
  });
});

describe("dungCanhBao3D", () => {
  const mayVe = dungMayVe(tsCoBan([may(1)], [[1, datCho()]]));
  const ma = new Map([[1, "M-01"]]);

  it("neo lên nóc ĐÚNG máy, cao hơn nhãn", () => {
    const [c] = dungCanhBao3D([{ id: 9, machineId: 1, state: "red", status: "open" }], mayVe, ma);
    expect(c.viTri).toEqual(neoTrenNoc(mayVe[0], HO_CANH_BAO));
    expect(c.nhan).toBe("M-01");
    expect(c.daAck).toBe(false);
  });

  it("★ mức LẠ quy về `call`, không im lặng bỏ cảnh báo", () => {
    const [c] = dungCanhBao3D([{ id: 9, machineId: 1, state: "tim", status: "open" }], mayVe, ma);
    expect(c.muc).toBe("call");
  });

  it("giữ nguyên ba mức hợp lệ", () => {
    const ra = dungCanhBao3D(
      [
        { id: 1, machineId: 1, state: "red", status: "open" },
        { id: 2, machineId: 1, state: "yellow", status: "open" },
        { id: 3, machineId: 1, state: "call", status: "open" },
      ],
      mayVe,
      ma,
    );
    expect(ra.map((c) => c.muc)).toEqual(["red", "yellow", "call"]);
  });

  it("`acknowledged` ⇒ daAck", () => {
    const [c] = dungCanhBao3D(
      [{ id: 9, machineId: 1, state: "red", status: "acknowledged" }],
      mayVe,
      ma,
    );
    expect(c.daAck).toBe(true);
  });

  it("andon KHÔNG có máy, hoặc máy KHÔNG trên cảnh ⇒ bỏ (không có toạ độ để neo)", () => {
    expect(
      dungCanhBao3D(
        [
          { id: 1, machineId: null, state: "red", status: "open" },
          { id: 2, machineId: 999, state: "red", status: "open" },
        ],
        mayVe,
        ma,
      ),
    ).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 35 (Pareto #5) — máy có ANDON mở ⇒ nhãn `batThuong`, dù trạng thái nói gì */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★★★ Đợt 35 — dungNhanMay.andonTheoMay", () => {
  const mayVe = dungMayVe(tsCoBan([may(1), may(2)], [[1, datCho()], [2, datCho()]]));
  const goi = (andon?: ReadonlySet<number>) =>
    dungNhanMay({
      mayVe,
      trangThaiTheoMay: new Map([[1, "khong_ro"], [2, "khong_ro"]]),
      maTheoMay: new Map(),
      mauChoTrangThai: congCu.mauChoTrangThai,
      t: (k) => k,
      andonTheoMay: andon,
    });
  it("★ máy 14-kiểu: trạng thái `khong_ro` (không bất thường) + andon mở ⇒ `batThuong: true`; máy không andon ⇒ false", () => {
    const ra = goi(new Set([1]));
    expect(ra.find((n) => n.machineId === 1)!.batThuong).toBe(true);
    expect(ra.find((n) => n.machineId === 2)!.batThuong).toBe(false);
  });
  it("không truyền / tập rỗng ⇒ như cũ (chỉ theo trạng thái)", () => {
    expect(goi().every((n) => n.batThuong === false)).toBe(true);
    expect(goi(new Set()).every((n) => n.batThuong === false)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ Task 17c LỖI HAI — GỐC CỦA TOÀ NHÀ                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CA TRUNG TÂM: **HAI TOÀ CỦA CÙNG MỘT NHÀ MÁY KHÔNG ĐƯỢC GIAO NHAU**
 * ════════════════════════════════════════════════════════════════════════════
 * Đo được trên CSDL thật (`twin_toa_nha`, 13 hàng, 2026-09-15):
 *
 *     QATD-A toà T1  X=0        Y=0        rộng 110.000  sâu 80.000
 *     QATD-A toà T2  X=130.000  Y=0        rộng 110.000  sâu 80.000
 *     … và `twin_dat_cho` của CẢ HAI toà bắt đầu từ X=0, Y=0.
 *
 * ⇒ Không cộng gốc toà thì hai toà **chồng khít**. Số của lưới lấy ĐÚNG từ bảng
 *   trên, không phải số tròn bịa ra — để ca này nói về dữ liệu có thật.
 *
 * ⚠ Lưới đo bằng **giá trị trả về** (mét, hệ cảnh), KHÔNG bằng
 *   `getBoundingClientRect`: môi trường `node`/jsdom không có bộ dựng bố cục và
 *   mọi hình chữ nhật đều trả 0.
 *
 * ⚠⚠ **KHÔNG CỘNG HAI LẦN.** Ca "đúng bằng hiệu toạ độ hai toà" ghim rằng phép
 *   dời bằng ĐÚNG số hạng của `twin_toa_nha`, không phải số hạng ấy cộng thêm
 *   một bước lưới nào. Bộ sinh dữ liệu đã nướng 1 km mỗi nhà máy vào chính cột
 *   đó, nên một lưới cố định chồng lên sẽ làm ca này đỏ.
 */
describe("Task 17c — cộng gốc toà nhà: hai toà không được chồng lên nhau", () => {
  /** Hai toà của CÙNG nhà máy, đúng số đo được của QATD-A. */
  const TOA = [
    { id: 65, viTriXMm: "0.000", viTriYMm: "0.000", viTriZMm: "0.000" },
    { id: 66, viTriXMm: "130000.000", viTriYMm: "0.000", viTriZMm: "0.000" },
  ];
  const TANG = [
    { id: 165, toaNhaId: 65 },
    { id: 265, toaNhaId: 66 },
  ];
  /** Bề rộng/sâu thật của toà QATD (mm) — dùng để dựng bao hình. */
  const RONG_MM = 110_000;
  const SAU_MM = 80_000;

  /** Máy ở CÙNG toạ độ trong tầng của mình — điều kiện để chồng nhau lộ ra. */
  const cungCho = (tangId: number) =>
    datCho({ tangId, viTriXMm: 1000, viTriYMm: 2000, viTriZMm: 0 });

  it("★★★ ĐỐI CHỨNG DƯƠNG — KHÔNG cộng gốc thì hai máy TRÙNG KHÍT (chính là lỗi)", () => {
    // Ô này mô tả lỗi, và nó giữ cho ca dưới có sức bác bỏ: nếu hai giáo cụ vốn
    // đã khác chỗ sẵn thì ca "không giao nhau" xanh mà chẳng chứng minh gì.
    const ra = dungMayVe(
      tsCoBan([may(1), may(2)], [[1, cungCho(165)], [2, cungCho(265)]], () => true, new Map()),
    );
    expect(ra).toHaveLength(2);
    expect(ra[0].viTri).toEqual(ra[1].viTri);
  });

  it("★★★ CỘNG GỐC ⇒ hai máy cách nhau ĐÚNG 130 m, bằng hiệu toạ độ hai toà", () => {
    const goc = gocToaTheoTang(TANG, TOA, 65);
    const ra = dungMayVe(
      tsCoBan([may(1), may(2)], [[1, cungCho(165)], [2, cungCho(265)]], () => true, goc),
    );
    expect(ra).toHaveLength(2);
    // Toà neo (65) KHÔNG dời — cảnh một toà không đổi một pixel nào.
    expect(ra[0].viTri).toEqual({ x: 1, y: 0, z: 2 });
    // Toà 66 dời ĐÚNG 130.000 mm = 130 m trên trục Đông, KHÔNG hơn không kém.
    expect(ra[1].viTri).toEqual({ x: 131, y: 0, z: 2 });
    expect(ra[1].viTri.x - ra[0].viTri.x).toBe(130);
  });

  it("★★★ BAO HÌNH hai toà KHÔNG GIAO NHAU — dựng từ CHÍNH cảnh mà `dungMayVe` trả", () => {
    /*
     * ⚠⚠ Bao hình dựng từ **vị trí máy trong cảnh**, KHÔNG từ bản đồ `goc`. Bản
     *   đầu của ca này đọc thẳng `goc.get(tangId)` và vì thế **vẫn xanh khi gỡ
     *   phép cộng ra khỏi `dungMayVe`** — nó đo bộ dựng bản đồ, không đo cảnh.
     *   Đo trên đầu ra thật là điều kiện để ca này biết kêu.
     *
     * ⚠ Máy đặt ở góc (1.000, 2.000) trong tầng của nó, nên mép toà = vị trí máy
     *   trừ đúng chỗ đặt trong tầng. Không có hằng số nào bịa thêm.
     */
    const goc = gocToaTheoTang(TANG, TOA, 65);
    const ra = dungMayVe(
      tsCoBan([may(1), may(2)], [[1, cungCho(165)], [2, cungCho(265)]], () => true, goc),
    );
    const bao = (m: (typeof ra)[number]) => {
      const mepX = m.viTri.x - 1000 / 1000; // trừ chỗ đặt TRONG tầng (1.000 mm)
      const mepZ = m.viTri.z - 2000 / 1000; // trừ chỗ đặt TRONG tầng (2.000 mm)
      return { x1: mepX, x2: mepX + RONG_MM / 1000, z1: mepZ, z2: mepZ + SAU_MM / 1000 };
    };
    const giaoNhau = (a: ReturnType<typeof bao>, b: ReturnType<typeof bao>) =>
      a.x1 < b.x2 && b.x1 < a.x2 && a.z1 < b.z2 && b.z1 < a.z2;

    const a = bao(ra[0]);
    const b = bao(ra[1]);
    expect(giaoNhau(a, b)).toBe(false);
    // Khoảng hở đúng bằng 130 − 110 = 20 m, không phải một con số bịa.
    expect(b.x1 - a.x2).toBe(20);
    // Đối chứng: phép đo BIẾT KÊU — một bao hình tự giao với chính nó.
    expect(giaoNhau(a, a)).toBe(true);
  });

  it("★★★ máy TRONG CÙNG một toà KHÔNG bị dời tương đối với nhau", () => {
    // Bản vá không được làm méo bố cục bên trong một tầng: cùng gốc ⇒ hiệu giữ nguyên.
    const goc = gocToaTheoTang(TANG, TOA, 65);
    const ra = dungMayVe(
      tsCoBan(
        [may(1), may(2)],
        [
          [1, datCho({ tangId: 265, viTriXMm: 1000, viTriYMm: 2000, viTriZMm: 0 })],
          [2, datCho({ tangId: 265, viTriXMm: 4000, viTriYMm: 9000, viTriZMm: 0 })],
        ],
        () => true,
        goc,
      ),
    );
    expect(ra[1].viTri.x - ra[0].viTri.x).toBe(3);
    expect(ra[1].viTri.z - ra[0].viTri.z).toBe(7);
  });

  it("★★★ HOÁN VỊ TRỤC giữ nguyên khi cộng gốc — gốc Y của DB vào scene.z, Z vào scene.y", () => {
    // Ba số khác hẳn nhau, nếu không mọi hoán vị đều cho cùng kết quả.
    const goc = new Map<number, GocToaMm>([[1, { xMm: 100_000, yMm: 200_000, zMm: 300_000 }]]);
    const [m] = dungMayVe(tsCoBan([may(1)], [[1, datCho()]], () => true, goc));
    expect(m.viTri).toEqual({ x: 101, y: 303, z: 202 });
  });

  it("★★★ tầng KHÔNG có trong bản đồ ⇒ KHÔNG dời (hành vi cũ), không mượn gốc của tầng khác", () => {
    const goc = new Map<number, GocToaMm>([[999, { xMm: 500_000, yMm: 0, zMm: 0 }]]);
    const [m] = dungMayVe(tsCoBan([may(1)], [[1, datCho({ tangId: 1 })]], () => true, goc));
    expect(m.viTri).toEqual({ x: 1, y: 3, z: 2 });
  });

  it("★★★ `tangId = null` ⇒ không dời, và KHÔNG nổ", () => {
    const goc = gocToaTheoTang(TANG, TOA, 65);
    const [m] = dungMayVe(tsCoBan([may(1)], [[1, datCho({ tangId: null })]], () => true, goc));
    expect(m.viTri).toEqual({ x: 1, y: 3, z: 2 });
  });
});

describe("gocToaTheoTang — bản đồ chỗ dời", () => {
  const TOA = [
    { id: 65, viTriXMm: "0.000", viTriYMm: "0.000", viTriZMm: "0.000" },
    { id: 66, viTriXMm: "130000.000", viTriYMm: "100000.000", viTriZMm: "0.000" },
  ];
  const TANG = [
    { id: 165, toaNhaId: 65 },
    { id: 265, toaNhaId: 66 },
    { id: 365, toaNhaId: 77 }, // toà KHÔNG có trong danh sách
  ];

  it("★★★ numeric về từ drizzle là CHUỖI — phải quy đổi, không được NỐI CHUỖI", () => {
    // `"130000.000" + 1000` = `"130000.0001000"`. Không throw, và nhà máy bay ra
    // ngoài vũ trụ — đúng cảnh báo ở đầu `hopNhatCanh.ts`.
    const g = gocToaTheoTang(TANG, TOA, 65);
    expect(g.get(265)).toEqual({ xMm: 130_000, yMm: 100_000, zMm: 0 });
    expect(typeof g.get(265)!.xMm).toBe("number");
  });

  it("★★★ toà NEO luôn ra {0,0,0} — cảnh một toà KHÔNG đổi một pixel nào", () => {
    // Đây là điều kiện để bản vá không đẻ ra lỗi mới: mặt sàn cảnh vận hành vẽ
    // ở gốc toạ độ và KHÔNG nhận vị trí toà, nên neo lệch = máy rời khỏi sàn.
    expect(gocToaTheoTang(TANG, TOA, 65).get(165)).toEqual(GOC_TOA_KHONG);
    expect(gocToaTheoTang(TANG, TOA, 66).get(265)).toEqual(GOC_TOA_KHONG);
  });

  it("★★★ đổi toà NEO ⇒ mọi chỗ dời tịnh tiến, KHOẢNG CÁCH giữa hai toà không đổi", () => {
    const a = gocToaTheoTang(TANG, TOA, 65);
    const b = gocToaTheoTang(TANG, TOA, 66);
    expect(b.get(165)).toEqual({ xMm: -130_000, yMm: -100_000, zMm: 0 });
    expect(a.get(265)!.xMm - a.get(165)!.xMm).toBe(b.get(265)!.xMm - b.get(165)!.xMm);
  });

  it("★★★ neo = null ⇒ giữ toạ độ TUYỆT ĐỐI (đường cho cảnh nhiều nhà máy sau này)", () => {
    const g = gocToaTheoTang(TANG, TOA, null);
    expect(g.get(165)).toEqual({ xMm: 0, yMm: 0, zMm: 0 });
    expect(g.get(265)).toEqual({ xMm: 130_000, yMm: 100_000, zMm: 0 });
  });

  it("★★★ tầng có toà KHÔNG BIẾT toạ độ ⇒ VẮNG MẶT khỏi bản đồ, không phải 0 bịa ra", () => {
    // "Chưa biết" hoá thành "biết rồi, bằng gốc" là đúng lớp lỗi NT-3.
    const g = gocToaTheoTang(TANG, TOA, 65);
    expect(g.has(365)).toBe(false);
    expect(g.size).toBe(2);
  });

  it("★★★ toà NEO không có trong danh sách ⇒ neo về 0, giữ nguyên hành vi cũ", () => {
    // Ca có thật: `danhSachToaNha` chưa tải xong, hoặc toà ngoài phạm vi tenant.
    const g = gocToaTheoTang(TANG, TOA, 9999);
    expect(g.get(165)).toEqual({ xMm: 0, yMm: 0, zMm: 0 });
    expect(g.get(265)).toEqual({ xMm: 130_000, yMm: 100_000, zMm: 0 });
  });

  it("danh sách rỗng ⇒ bản đồ rỗng, không nổ", () => {
    expect(gocToaTheoTang([], [], null).size).toBe(0);
    expect(gocToaTheoTang(TANG, [], 65).size).toBe(0);
  });
});
