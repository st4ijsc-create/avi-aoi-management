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
  CO_DU_PHONG,
  HO_NHAN_MAY,
  HO_CANH_BAO,
  type MayVaoCanh,
  type DatChoVaoCanh,
  type CongCuMau,
  type MayDaDung,
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
  hinhKhoiCho: (loai) => `khoi:${loai}`,
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
) => ({
  may: mays,
  datChoTheoMay: new Map(datChos),
  kichThuocTheoLoai: new Map<string, typeof CO_DU_PHONG>(),
  trangThaiTheoMay: new Map<number, string>(),
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
    khoi: "k",
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
    khoi: "k",
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
