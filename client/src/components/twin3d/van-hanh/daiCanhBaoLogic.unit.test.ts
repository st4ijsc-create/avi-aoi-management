/**
 * Test của `daiCanhBaoLogic.ts` — Đợt 8 Lô B, mục #12/#13/#14/#15.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G5 — MỌI CA ĐỀU CÓ DỮ LIỆU KHÁC RỖNG, VÀ DEDUPE ĐO BẰNG CA DƯƠNG
 * ════════════════════════════════════════════════════════════════════════════
 * Một dải rỗng đi qua `gopCanhBao` cho ra `[]`, và `[]` **không có dòng nào lặp**
 * — nên `demKhoaLap([]) === 0` và bộ test trông như đã chứng minh dedupe hoạt
 * động. Nó chứng minh số 0. Kết quả ấy trùng khít với kết quả của một hàm
 * `gopCanhBao` bị xoá sạch ruột.
 *
 * ⇒ Mọi ca dedupe dưới đây **bắn trùng thật rồi đếm**: cùng một hàng
 *   `andon_events` đi vào hai lần với hai id phong bì khác nhau (mô phỏng seed
 *   đổi id mỗi refetch), và cùng một raise tới ba lần (mô phỏng `emitAndonEvent`
 *   phát vào `global` + `line:` + `machine:`). Số đếm TRƯỚC và SAU đều được ghim.
 *
 * ★ Bộ đếm dùng để nghiệm thu là `demKhoaLap` — dụng cụ ĐỘC LẬP quét ĐẦU RA, nên
 *   nó có quyền bác bỏ `gopCanhBao`. Không hỏi `gopCanhBao` xem nó đã khử mấy
 *   dòng (đó là đếm ĐẦU VÀO — đúng gốc của lời khai sai `data-so-an = 0` cũ).
 *
 * ★ Số neo từ DB dev 2026-09-07 (hai mô hình rời): 7 hàng mở, 6 tồn đọng >24h,
 *   `status` = `acknowledged` ở 7/7, `stationId` NULL ở 7/7.
 */
import { describe, it, expect } from "vitest";
import {
  MUC_THEO_UU_TIEN,
  NGUONG_TON_DONG_MS,
  TRAN_DAI,
  chuanHoaHang,
  chuanHoaMuc,
  demKhoaLap,
  demTheoMuc,
  docMoc,
  gopCanhBao,
  khoaCanhBao,
  locTheoMuc,
  locTheoPhamVi,
  soNgayTonDong,
  tachNhom,
  type CanhBaoDai,
  type TapPhamVi,
} from "./daiCanhBaoLogic";

/** Mốc cố định — mọi test dùng số tuyệt đối, không đọc đồng hồ. */
const BAY_GIO = 1_757_000_000_000;
const GIO = 3_600_000;

function cb(sua: Partial<CanhBaoDai> & { idNguon: number }): CanhBaoDai {
  return {
    nguon: "andon",
    muc: "red",
    pha: "raised",
    tieuDe: "Kẹt băng tải",
    luc: BAY_GIO - GIO,
    capNhatLuc: BAY_GIO - GIO,
    machineId: null,
    lineId: null,
    stationId: null,
    workshopId: null,
    ...sua,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// #12 — dedupe
// ═══════════════════════════════════════════════════════════════════════════

describe("#12 dedupe — CA DƯƠNG: bắn trùng thật rồi đếm (G5/G22)", () => {
  it("★★★ SEED ĐỔI ID MỖI REFETCH — cùng một hàng andon vào 2 lần vẫn ra 1 dòng", () => {
    // Đây là ca mà bản gốc `CommandCenter.tsx:1058` KHÔNG khử được: nó khoá theo
    // id phong bì, mà id seed nhúng một `seq` đơn điệu nên hai lượt poll của CÙNG
    // một hàng cho hai id khác nhau. Ở đây khoá là `andon:<idNguon>` nên hai lượt
    // vẫn là một thực thể.
    const luotDau = cb({ idNguon: 41, capNhatLuc: BAY_GIO - GIO });
    const luotSau = cb({ idNguon: 41, capNhatLuc: BAY_GIO - 60_000 });

    // ĐO TRƯỚC: đầu vào thật sự CÓ trùng — nếu không thì phép đo sau vô nghĩa.
    expect(demKhoaLap([luotDau, luotSau])).toBe(1);

    const ra = gopCanhBao([luotDau, luotSau], []);
    // ĐO SAU bằng dụng cụ độc lập.
    expect(demKhoaLap(ra)).toBe(0);
    expect(ra).toHaveLength(1);
  });

  it("★★★ SOCKET PHÁT 3 PHÒNG — cùng một raise tới 3 lần vẫn ra 1 dòng", () => {
    // `server/_core/socket.ts:1392-1394` — emitAndonEvent phát vào `global`, rồi
    // `line:{lineId}`, rồi `machine:{machineId}`. Client join nhiều phòng nhận
    // cùng gói nhiều lần.
    const goi = cb({ idNguon: 77, machineId: 12, lineId: 3 });
    const ba = [goi, { ...goi }, { ...goi }];

    expect(ba).toHaveLength(3);
    expect(demKhoaLap(ba)).toBe(1);

    const ra = gopCanhBao([], ba);
    expect(demKhoaLap(ra)).toBe(0);
    expect(ra).toHaveLength(1);
  });

  it("★★★ HAI NGUỒN CÙNG SỐ ID KHÔNG ĐƯỢC NUỐT NHAU", () => {
    // Khoá chỉ bằng số sẽ giữ 1 dòng — và dòng biến mất là cảnh báo AN TOÀN.
    const a = cb({ idNguon: 5, nguon: "andon" });
    const s = cb({ idNguon: 5, nguon: "safety" });
    expect(khoaCanhBao(a)).not.toBe(khoaCanhBao(s));

    const ra = gopCanhBao([a, s], []);
    expect(ra).toHaveLength(2);
    expect(demKhoaLap(ra)).toBe(0);
  });

  it("★★★ BẢN MỚI HƠN THẮNG THEO DỮ LIỆU, KHÔNG THEO THỨ TỰ ĐẾN", () => {
    // Gói `raised` đến TRỄ không được lật ngược một hàng đã `acknowledged`:
    // người vận hành sẽ thấy cảnh báo họ vừa xác nhận sống dậy.
    const daAck = cb({ idNguon: 9, pha: "acknowledged", capNhatLuc: BAY_GIO });
    const raiseDenTre = cb({ idNguon: 9, pha: "raised", capNhatLuc: BAY_GIO - GIO });

    // Thứ tự đến: ack TRƯỚC, raise-cũ SAU. `Map.set` ghi-sau-đè-trước sẽ ra "raised".
    const ra = gopCanhBao([daAck], [raiseDenTre]);
    expect(ra).toHaveLength(1);
    expect(ra[0].pha).toBe("acknowledged");
  });

  it("gói socket MỚI HƠN thắng seed cũ (chiều ngược lại cũng đúng)", () => {
    const seedCu = cb({ idNguon: 9, pha: "raised", capNhatLuc: BAY_GIO - GIO });
    const songMoi = cb({ idNguon: 9, pha: "acknowledged", capNhatLuc: BAY_GIO });
    const ra = gopCanhBao([seedCu], [songMoi]);
    expect(ra).toHaveLength(1);
    expect(ra[0].pha).toBe("acknowledged");
  });
});

describe("#12 cap — dedupe TRƯỚC cắt trần", () => {
  it("★★★ 150 GÓI = 60 CẢNH BÁO NHÂN ĐÔI + 30 ĐƠN ⇒ giữ đủ 90, KHÔNG mất vì bản sao", () => {
    // Nếu cắt trần TRƯỚC dedupe thì 100 gói đầu chỉ chứa ~50 thực thể, và 40
    // cảnh báo thật bị đẩy khỏi trần bởi chính bản sao của nhau. Trần khi đó đo
    // "số GÓI TIN" chứ không đo "số CẢNH BÁO" (G7).
    const goi: CanhBaoDai[] = [];
    for (let i = 0; i < 60; i++) {
      const c = cb({ idNguon: i, luc: BAY_GIO - i * 1000 });
      goi.push(c, { ...c });
    }
    for (let i = 60; i < 90; i++) goi.push(cb({ idNguon: i, luc: BAY_GIO - i * 1000 }));

    expect(goi).toHaveLength(150);
    expect(demKhoaLap(goi)).toBe(60);

    const ra = gopCanhBao(goi, []);
    expect(ra).toHaveLength(90);
    expect(demKhoaLap(ra)).toBe(0);
  });

  it("★★★ cắt trần giữ MỚI NHẤT, không giữ thứ đến trước", () => {
    // 120 thực thể khác nhau, cũ dần. Trần 100 phải bỏ đúng 20 cái CŨ NHẤT.
    const ds: CanhBaoDai[] = [];
    for (let i = 0; i < 120; i++) ds.push(cb({ idNguon: i, luc: BAY_GIO - i * 1000 }));
    const ra = gopCanhBao(ds, []);
    expect(ra).toHaveLength(TRAN_DAI);
    expect(ra[0].idNguon).toBe(0); // mới nhất
    expect(ra[ra.length - 1].idNguon).toBe(99);
    expect(ra.some((c) => c.idNguon >= 100)).toBe(false);
  });

  it("trần tuỳ chỉnh được; trần vô lý rơi về mặc định", () => {
    const ds = Array.from({ length: 10 }, (_, i) => cb({ idNguon: i, luc: BAY_GIO - i }));
    expect(gopCanhBao(ds, [], 3)).toHaveLength(3);
    expect(gopCanhBao(ds, [], 0)).toHaveLength(10);
    expect(gopCanhBao(ds, [], Number.NaN)).toHaveLength(10);
  });

  it("G8 — đầu vào rỗng ra mảng rỗng, không throw", () => {
    expect(gopCanhBao([], [])).toEqual([]);
  });
});

describe("#12 sắp xếp TẤT ĐỊNH", () => {
  it("mới nhất trước; hoà `luc` thì mức nghiêm trọng hơn lên trên", () => {
    const v = cb({ idNguon: 1, muc: "yellow", luc: BAY_GIO });
    const d = cb({ idNguon: 2, muc: "red", luc: BAY_GIO });
    const cu = cb({ idNguon: 3, muc: "red", luc: BAY_GIO - GIO });
    const ra = gopCanhBao([v, d, cu], []);
    expect(ra.map((c) => c.idNguon)).toEqual([2, 1, 3]);
  });

  it("★ cùng đầu vào, khác thứ tự ⇒ CÙNG đầu ra (tất định, ảnh chụp so được)", () => {
    const ds = [
      cb({ idNguon: 1, muc: "red", luc: BAY_GIO }),
      cb({ idNguon: 2, muc: "red", luc: BAY_GIO }),
      cb({ idNguon: 3, muc: "red", luc: BAY_GIO }),
    ];
    const xuoi = gopCanhBao(ds, []).map((c) => c.idNguon);
    const nguoc = gopCanhBao([...ds].reverse(), []).map((c) => c.idNguon);
    expect(nguoc).toEqual(xuoi);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #13 — nhóm tồn đọng
// ═══════════════════════════════════════════════════════════════════════════

describe("#13 tồn đọng >24h", () => {
  it("★★★ BIÊN: 24h−1ms và ĐÚNG 24h là 'hôm nay'; 24h+1ms mới là tồn đọng", () => {
    const truoc = cb({ idNguon: 1, luc: BAY_GIO - NGUONG_TON_DONG_MS + 1 });
    const dung = cb({ idNguon: 2, luc: BAY_GIO - NGUONG_TON_DONG_MS });
    const sau = cb({ idNguon: 3, luc: BAY_GIO - NGUONG_TON_DONG_MS - 1 });
    const n = tachNhom([truoc, dung, sau], BAY_GIO);
    expect(n.homNay.map((c) => c.idNguon)).toEqual([1, 2]);
    expect(n.tonDong.map((c) => c.idNguon)).toEqual([3]);
  });

  it("★★★ ACK KHÔNG LÀM CẢNH BÁO CŨ 'TRẺ LẠI'", () => {
    // Nổ 3 ngày trước, vừa được ack 1 phút trước. Tuổi phải tính từ `luc`
    // (raisedAt); tính từ `capNhatLuc` sẽ ném nó sang "Hôm nay" và nhóm tồn đọng
    // tự dọn sạch mỗi lần có người bấm ack.
    const cu = cb({
      idNguon: 1,
      luc: BAY_GIO - 3 * 24 * GIO,
      capNhatLuc: BAY_GIO - 60_000,
      pha: "acknowledged",
    });
    const n = tachNhom([cu], BAY_GIO);
    expect(n.tonDong).toHaveLength(1);
    expect(n.homNay).toHaveLength(0);
  });

  it("★ mốc TƯƠNG LAI (lệch đồng hồ) rơi vào 'hôm nay', không vào tồn đọng", () => {
    const tuongLai = cb({ idNguon: 1, luc: BAY_GIO + 10 * GIO });
    const n = tachNhom([tuongLai], BAY_GIO);
    expect(n.homNay).toHaveLength(1);
    expect(n.tonDong).toHaveLength(0);
  });

  it("★ số ngày tồn đọng KẸP SÀN 1 — không có badge 'tồn đọng 0d'", () => {
    const vuaQua = cb({ idNguon: 1, luc: BAY_GIO - NGUONG_TON_DONG_MS - 1 });
    expect(soNgayTonDong(vuaQua, BAY_GIO)).toBe(1);
    const ba = cb({ idNguon: 2, luc: BAY_GIO - 3 * NGUONG_TON_DONG_MS - 5 });
    expect(soNgayTonDong(ba, BAY_GIO)).toBe(3);
  });

  it("★★★ SỐ ĐO THẬT DB dev: 7 mở / 6 tồn đọng — tái dựng ca dương", () => {
    // Neo bộ test vào phân bố đo được (2026-09-07): 6 hàng cũ hơn 24h, 1 hàng mới.
    const ds: CanhBaoDai[] = [];
    for (let i = 0; i < 6; i++) ds.push(cb({ idNguon: i, luc: BAY_GIO - (25 + i) * GIO }));
    ds.push(cb({ idNguon: 6, luc: BAY_GIO - 2 * GIO }));
    const n = tachNhom(gopCanhBao(ds, []), BAY_GIO);
    expect(n.homNay).toHaveLength(1);
    expect(n.tonDong).toHaveLength(6);
    expect(n.homNay.length + n.tonDong.length).toBe(7);
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

  it("★★★ KHỚP CHÍNH XÁC MỘT MỨC, không phải 'từ mức này trở lên'", () => {
    // Nếu `yellow` nghĩa là "yellow trở lên" thì lọc "chỉ vàng" sẽ hiện cả đỏ,
    // và người dùng tưởng bộ lọc hỏng.
    expect(locTheoMuc(ds, "yellow").map((c) => c.idNguon)).toEqual([3]);
    expect(locTheoMuc(ds, "red").map((c) => c.idNguon)).toEqual([1, 2]);
  });

  it("'tat_ca' giữ NGUYÊN VẸN", () => {
    expect(locTheoMuc(ds, "tat_ca")).toHaveLength(4);
  });

  it("★★★ mức KHÔNG có dòng nào ⇒ [] , KHÔNG rơi về toàn bộ dải", () => {
    // Rơi về toàn bộ là cách bộ lọc tự khai "không có kết quả" bằng cách hiện
    // TẤT CẢ — không phân biệt được với "bộ lọc không chạy".
    expect(locTheoMuc(ds, "green")).toEqual([]);
  });

  it("đếm theo mức khớp tổng", () => {
    const d = demTheoMuc(ds);
    expect(d).toEqual({ tat_ca: 4, red: 2, call: 1, yellow: 1, green: 0 });
    expect(d.red + d.call + d.yellow + d.green).toBe(d.tat_ca);
  });

  it("MUC_THEO_UU_TIEN phủ đúng 4 giá trị của andonStateEnum", () => {
    expect([...MUC_THEO_UU_TIEN].sort()).toEqual(["call", "green", "red", "yellow"]);
  });
});

describe("chuanHoaMuc — G19: giá trị lạ đẩy LÊN, không giấu xuống", () => {
  it("nhận đủ 4 giá trị enum thật", () => {
    expect(chuanHoaMuc("red")).toBe("red");
    expect(chuanHoaMuc("YELLOW")).toBe("yellow");
    expect(chuanHoaMuc(" call ")).toBe("call");
    expect(chuanHoaMuc("green")).toBe("green");
  });

  it("★★★ giá trị CHƯA BIẾT ⇒ 'red' (hiện lên), KHÔNG ⇒ 'green' (giấu đi)", () => {
    // G19: cột hẹp/rộng hơn mã ⇒ mọi thứ rơi về nhánh mặc định, im lặng. Mặc
    // định phải là nhánh NGƯỜI TA NHÌN THẤY.
    expect(chuanHoaMuc("magenta")).toBe("red");
    expect(chuanHoaMuc(null)).toBe("red");
    expect(chuanHoaMuc(undefined)).toBe("red");
    expect(chuanHoaMuc("")).toBe("red");
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

describe("#15 lọc theo phạm vi nhánh", () => {
  const ds = [
    cb({ idNguon: 1, machineId: 10, lineId: 3 }),
    cb({ idNguon: 2, machineId: 11, lineId: 3 }),
    cb({ idNguon: 3, machineId: 99, lineId: 7 }),
  ];

  it("null ⇒ KHÔNG lọc (khác hẳn phạm vi rỗng)", () => {
    expect(locTheoPhamVi(ds, null)).toHaveLength(3);
  });

  it("phạm vi RỖNG THẬT ⇒ [] — nhánh trống thật sự không có máy nào", () => {
    expect(locTheoPhamVi(ds, pv({}))).toEqual([]);
  });

  it("khớp theo machineId", () => {
    expect(locTheoPhamVi(ds, pv({ machineIds: [10, 11] })).map((c) => c.idNguon)).toEqual([1, 2]);
  });

  it("★★★ khớp theo lineId KHI stationId NULL — đo được 7/7 hàng dev là vậy", () => {
    // Đòi khớp `stationId` sẽ loại sạch mọi cảnh báo thật trên DB này (G19).
    const chiLine = [cb({ idNguon: 1, machineId: null, stationId: null, lineId: 3 })];
    expect(locTheoPhamVi(chiLine, pv({ lineIds: [3] }))).toHaveLength(1);
  });

  it("★★★ cảnh báo KHÔNG có trục nào được GIỮ, không bị giấu (NT-3)", () => {
    const treo = [cb({ idNguon: 1 })]; // mọi trục null
    expect(locTheoPhamVi(treo, pv({ machineIds: [10] }))).toHaveLength(1);
  });

  it("khớp theo workshopId (trục cây tra được, andon_events không có cột)", () => {
    const w = [cb({ idNguon: 1, workshopId: 2 })];
    expect(locTheoPhamVi(w, pv({ workshopIds: [2] }))).toHaveLength(1);
    expect(locTheoPhamVi(w, pv({ workshopIds: [5] }))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chuẩn hoá đầu vào
// ═══════════════════════════════════════════════════════════════════════════

describe("docMoc — hai nguồn, hai kiểu thời gian", () => {
  it("★★★ Date (tRPC) và chuỗi ISO (socket) cho CÙNG một số", () => {
    // `AndonRealtimeEvent.raisedAt: Date | string` (socket.ts:1379). Trộn hai
    // kiểu vào một phép trừ cho NaN, và `NaN > NGUONG` là false ⇒ mọi cảnh báo
    // rơi hết vào "Hôm nay" mà không lỗi nào nổ.
    const d = new Date(BAY_GIO);
    expect(docMoc(d)).toBe(BAY_GIO);
    expect(docMoc(d.toISOString())).toBe(BAY_GIO);
    expect(docMoc(BAY_GIO)).toBe(BAY_GIO);
  });

  it("★★★ giá trị HỎNG ⇒ null, KHÔNG ⇒ 0", () => {
    // 0 = 1970 ⇒ tuổi ~56 năm ⇒ badge "tồn đọng 20000d". Một lỗi phân tích ngày
    // trở thành con số trông như dữ liệu thật.
    expect(docMoc("khong-phai-ngay")).toBeNull();
    expect(docMoc(null)).toBeNull();
    expect(docMoc(undefined)).toBeNull();
    expect(docMoc(Number.NaN)).toBeNull();
  });
});

describe("chuanHoaHang", () => {
  it("hàng andon thật (state=yellow, status=acknowledged) — phân bố đo được ở dev", () => {
    const c = chuanHoaHang(
      {
        id: 41,
        state: "yellow",
        status: "acknowledged",
        title: "Thiếu vật tư",
        raisedAt: new Date(BAY_GIO - 30 * GIO),
        acknowledgedAt: new Date(BAY_GIO - 29 * GIO),
        machineId: 12,
        lineId: 3,
        stationId: null,
      },
      BAY_GIO,
      2,
    );
    expect(c).toMatchObject({
      idNguon: 41,
      nguon: "andon",
      muc: "yellow",
      pha: "acknowledged",
      tieuDe: "Thiếu vật tư",
      luc: BAY_GIO - 30 * GIO,
      capNhatLuc: BAY_GIO - 29 * GIO,
      machineId: 12,
      lineId: 3,
      stationId: null,
      workshopId: 2,
    });
    // Và nó vẫn phải là TỒN ĐỌNG dù đã ack.
    expect(tachNhom([c], BAY_GIO).tonDong).toHaveLength(1);
  });

  it("thiếu raisedAt ⇒ dùng mốc dự phòng của người gọi, không dùng 0", () => {
    const c = chuanHoaHang({ id: 1, raisedAt: null }, BAY_GIO);
    expect(c.luc).toBe(BAY_GIO);
  });

  it("status lạ ⇒ 'raised' (chưa xử lý) chứ không 'resolved'", () => {
    // Rơi về 'resolved' sẽ làm một cảnh báo chưa ai xử lý tự khai là đã xong.
    expect(chuanHoaHang({ id: 1, status: "wat" }, BAY_GIO).pha).toBe("raised");
    expect(chuanHoaHang({ id: 1, status: null }, BAY_GIO).pha).toBe("raised");
  });

  it("★ đường end-to-end: 2 gói thô TRÙNG (seed + socket) ⇒ 1 dòng", () => {
    const tho = {
      id: 77,
      state: "red",
      status: "raised",
      title: "E-STOP",
      raisedAt: new Date(BAY_GIO - GIO),
      machineId: 5,
      lineId: 1,
    };
    const tuSeed = chuanHoaHang(tho, BAY_GIO);
    // Socket gửi CÙNG hàng nhưng raisedAt là CHUỖI ISO, không phải Date.
    const tuSocket = chuanHoaHang({ ...tho, raisedAt: new Date(BAY_GIO - GIO).toISOString() }, BAY_GIO);
    expect(tuSeed.luc).toBe(tuSocket.luc);
    expect(demKhoaLap([tuSeed, tuSocket])).toBe(1);
    expect(gopCanhBao([tuSeed], [tuSocket])).toHaveLength(1);
  });
});
