/**
 * Test của `locBadge.ts` — Đợt 5 T-1.
 *
 * ★★★ TRỤC CANH NẶNG NHẤT: **hậu điều kiện đo bằng dụng cụ ĐỘC LẬP.**
 *
 * Bộ test này KHÔNG hỏi `locBadge` xem nó đã loại bao nhiêu badge. Nó gọi
 * `demCapChongLapBadge` — một phép quét toàn bộ cặp trong ĐẦU RA — để hỏi câu mà
 * §10.3 luật 3 thật sự hỏi: *"trên màn hình còn badge nào che badge nào không?"*
 *
 * Vì sao phân biệt này là toàn bộ giá trị của bộ test: lời khai sai cũ
 * (`data-so-an = 0` trong khi 4 badge bị che) sinh ra chính xác từ việc bộ đếm
 * đếm ĐẦU VÀO bị loại rồi được đọc như thể nó nói về ĐẦU RA. Một bộ đếm dẫn xuất
 * từ thuật toán không bao giờ bác bỏ được thuật toán ấy.
 */
import { describe, it, expect } from "vitest";
import {
  CAO_BADGE_SUY_DOAN_PX,
  RONG_BADGE_SUY_DOAN_PX,
  demCapChongLapBadge,
  hopBadge,
  locBadge,
  type BadgeUngVien,
} from "./locBadge";
import { haiHopChongNhau } from "../loi/locNhan";

function bd(sua: Partial<BadgeUngVien> & { id: number }): BadgeUngVien {
  return { x: 0, y: 0, diemUuTien: 1000, ...sua };
}

describe("hopBadge — điểm neo là TÂM (khác `hopNhan` neo cạnh dưới)", () => {
  it("★★★ hộp trải ĐỀU hai phía trên CẢ HAI trục", () => {
    // `translate(-50%, -50%)`. Dùng nhầm công thức của `locNhan` (neo cạnh dưới)
    // làm mọi hộp lệch nửa chiều cao — và lệch theo hướng khiến bộ đếm báo
    // THIẾU chồng lấp, tức hỏng một cách CÂM.
    const h = hopBadge({ x: 100, y: 50, rongPx: 80, caoPx: 20 });
    expect(h).toEqual({ trai: 60, phai: 140, tren: 40, duoi: 60 });
  });

  it("thiếu số đo thật ⇒ dùng trị SUY ĐOÁN, không dùng 0", () => {
    // Rộng/cao = 0 sẽ làm mọi hộp thành điểm ⇒ không cặp nào "chồng" ⇒ phép khử
    // chồng lấn im lặng biến thành không-làm-gì. Đó là ca hỏng câm phải chặn.
    const h = hopBadge({ x: 0, y: 0 });
    expect(h.phai - h.trai).toBe(RONG_BADGE_SUY_DOAN_PX);
    expect(h.duoi - h.tren).toBe(CAO_BADGE_SUY_DOAN_PX);
  });

  it("rongPx/caoPx phi lý (0, âm, NaN) rơi về suy đoán", () => {
    for (const xau of [0, -5, Number.NaN]) {
      const h = hopBadge({ x: 0, y: 0, rongPx: xau, caoPx: xau });
      expect(h.phai - h.trai).toBe(RONG_BADGE_SUY_DOAN_PX);
      expect(h.duoi - h.tren).toBe(CAO_BADGE_SUY_DOAN_PX);
    }
  });
});

describe("★★★ locBadge — HẬU ĐIỀU KIỆN: 0 cặp chồng ở ĐẦU RA", () => {
  it("★★★ TÁI DỰNG CA QA: 4 badge cùng một máy chồng nhau ⇒ còn 1, 0 cặp chồng", () => {
    // Ca thật QA đo được: 4 badge của `SIM-L1-AOI` cách nhau vài pixel, cả 4 đều
    // được vẽ, không đọc nổi chữ nào — và `data-so-an` khai 0.
    const truoc = [
      bd({ id: 1, x: 400, y: 300, diemUuTien: 3500 }),
      bd({ id: 2, x: 404, y: 302, diemUuTien: 2500 }),
      bd({ id: 3, x: 408, y: 298, diemUuTien: 2500 }),
      bd({ id: 4, x: 412, y: 305, diemUuTien: 1500 }),
    ];
    // TRƯỚC: dụng cụ đo độc lập xác nhận ca này THẬT SỰ chồng (6 cặp = C(4,2)).
    expect(demCapChongLapBadge(truoc)).toBe(6);

    const sau = locBadge(truoc);
    // SAU: 0 cặp chồng — đo lại bằng ĐÚNG dụng cụ vừa báo 6, không bằng lời khai
    // của `locBadge`.
    expect(demCapChongLapBadge(sau.ve)).toBe(0);
    expect(sau.ve).toHaveLength(1);
    // Và badge còn lại là badge ƯU TIÊN CAO NHẤT, không phải badge đầu mảng.
    expect(sau.ve[0].id).toBe(1);
    // Bộ đếm khai đúng 3 badge bị giấu — KHÔNG khai 0 như bản cũ.
    expect(sau.soAn).toBe(3);
    expect(sau.soBiChongLap).toBe(3);
  });

  it("★★★ badge tách xa nhau ⇒ GIỮ HẾT (phép khử không được tham lam)", () => {
    // Đối chứng bắt buộc: một bản cài đặt "loại tất cả trừ một" cũng cho 0 cặp
    // chồng. Không có ca này thì hậu điều kiện trên là vô nghĩa.
    const xa = [0, 1, 2, 3, 4].map((i) => bd({ id: i, x: i * 200, y: 100 }));
    const kq = locBadge(xa);
    expect(kq.ve).toHaveLength(5);
    expect(kq.soAn).toBe(0);
    expect(demCapChongLapBadge(kq.ve)).toBe(0);
  });

  it("★ chồng DỌC bị bắt — đây là ca mà mô hình ĐƯỜNG TRÒN bỏ sót (G7)", () => {
    // Badge dẹt (84×18): hai badge cách nhau 10px theo TRỤC DỌC chồng nhau, dù
    // khoảng cách tâm 10px < mọi bán kính hợp lý theo chiều rộng.
    const doc = [bd({ id: 1, x: 300, y: 200 }), bd({ id: 2, x: 300, y: 210 })];
    expect(demCapChongLapBadge(doc)).toBe(1);
    expect(locBadge(doc).ve).toHaveLength(1);
  });

  it("★ chồng NGANG ở khoảng cách mà bán kính tròn sẽ bỏ qua", () => {
    // Cách tâm 60px theo trục ngang: ngoài mọi "bán kính" ~42px, nhưng hai hộp
    // rộng 84px vẫn chồng nhau 24px.
    const ngang = [bd({ id: 1, x: 300, y: 200 }), bd({ id: 2, x: 360, y: 200 })];
    expect(demCapChongLapBadge(ngang)).toBe(1);
    expect(locBadge(ngang).ve).toHaveLength(1);
  });

  it("chạm mép KHÔNG tính là chồng — giết một badge đọc được là mất thông tin", () => {
    const kemep = [bd({ id: 1, x: 300, y: 200 }), bd({ id: 2, x: 300 + RONG_BADGE_SUY_DOAN_PX, y: 200 })];
    expect(demCapChongLapBadge(kemep)).toBe(0);
    expect(locBadge(kemep).ve).toHaveLength(2);
  });
});

describe("★★★ locBadge — LUẬT 3: badge NGOÀI KHUNG không bao giờ bị loại", () => {
  it("★★★ chùm badge kẹp rìa chồng nhau vẫn được vẽ HẾT", () => {
    // Badge ngoài khung bị kẹp về cùng một dải rìa hẹp nên chúng chồng nhau là
    // đương nhiên. Loại chúng đi là làm ĐÚNG cái luật 3 cấm: để một alarm biến
    // mất khỏi màn hình vì góc camera.
    const ria = [1, 2, 3, 4].map((i) => bd({ id: i, x: 28, y: 300 + i, ngoaiKhung: true }));
    const kq = locBadge(ria);
    expect(kq.ve).toHaveLength(4);
    expect(kq.soAn).toBe(0);
  });

  it("★★★ badge rìa KHÔNG dựng tường vô hình giết badge trong khung", () => {
    // Nếu badge ngoài khung góp hộp vào tập "đã giữ", một chùm ở rìa sẽ giết mọi
    // badge TRONG khung đi ngang qua đó — mất alarm thật vì một alarm bị kẹp.
    const hon = [
      bd({ id: 1, x: 28, y: 300, ngoaiKhung: true, diemUuTien: 3500 }),
      bd({ id: 2, x: 30, y: 302, diemUuTien: 2500 }),
    ];
    const kq = locBadge(hon);
    expect(kq.ve.map((b) => b.id).sort()).toEqual([1, 2]);
    expect(kq.soAn).toBe(0);
  });

  it("`demCapChongLapBadge` BỎ QUA badge ngoài khung", () => {
    // Nếu tính cả chúng, phép đo sẽ báo "hỏng" trên đúng hành vi spec yêu cầu.
    const ria = [1, 2, 3].map((i) => bd({ id: i, x: 28, y: 300, ngoaiKhung: true }));
    expect(demCapChongLapBadge(ria)).toBe(0);
  });
});

describe("locBadge — ưu tiên, trần, tất định", () => {
  it("★ ưu tiên CAO thắng, kể cả khi nó đứng CUỐI mảng đầu vào", () => {
    const ds = [
      bd({ id: 9, x: 300, y: 200, diemUuTien: 1000 }),
      bd({ id: 1, x: 302, y: 201, diemUuTien: 3500 }),
    ];
    expect(locBadge(ds).ve[0].id).toBe(1);
  });

  it("★★★ khử chồng lấn chạy TRƯỚC cắt trần", () => {
    // Cắt trần trước rồi mới khử chồng có thể để lại 1 badge trong khi 2 suất đã
    // bị các badge chồng nhau ăn mất. Ở đây: 2 badge chồng nhau + 2 badge tách
    // xa, trần 2 ⇒ phải ra 2 badge KHÁC CHỖ, không phải 1.
    const ds = [
      bd({ id: 1, x: 100, y: 100, diemUuTien: 3500 }),
      bd({ id: 2, x: 104, y: 101, diemUuTien: 3400 }),
      bd({ id: 3, x: 500, y: 100, diemUuTien: 3300 }),
      bd({ id: 4, x: 900, y: 100, diemUuTien: 3200 }),
    ];
    const kq = locBadge(ds, { tran: 2 });
    expect(kq.ve.map((b) => b.id)).toEqual([1, 3]);
    expect(kq.soBiChongLap).toBe(1);
    expect(kq.soVuotTran).toBe(1);
    expect(kq.soAn).toBe(2);
  });

  it("★ soAn gộp CẢ chồng lấn LẪN vượt trần — bản cũ chỉ đếm vế thứ hai", () => {
    const ds = [
      bd({ id: 1, x: 100, y: 100, diemUuTien: 3500 }),
      bd({ id: 2, x: 104, y: 100, diemUuTien: 3400 }),
    ];
    // Không chạm trần, nhưng 1 badge bị che ⇒ soAn phải là 1, KHÔNG phải 0.
    expect(locBadge(ds).soAn).toBe(1);
  });

  it("★ TẤT ĐỊNH: đảo thứ tự đầu vào cho cùng đầu ra", () => {
    // Thiếu nhánh so `id` khi hoà điểm, hai alarm cùng mức sẽ đổi chỗ mỗi khung
    // ⇒ badge nhấp nháy.
    const ds = [
      bd({ id: 3, x: 100, y: 100 }),
      bd({ id: 1, x: 102, y: 100 }),
      bd({ id: 2, x: 500, y: 100 }),
    ];
    const xuoi = locBadge(ds).ve.map((b) => b.id);
    const nguoc = locBadge([...ds].reverse()).ve.map((b) => b.id);
    expect(xuoi).toEqual(nguoc);
    expect(xuoi).toEqual([1, 2]);
  });

  it("không làm biến dạng mảng của người gọi", () => {
    const ds = [bd({ id: 3, x: 0, y: 0 }), bd({ id: 1, x: 500, y: 0 })];
    locBadge(ds);
    expect(ds.map((b) => b.id)).toEqual([3, 1]);
  });

  it("mảng rỗng ⇒ kết quả rỗng, không throw", () => {
    // ★ Đợt 47 — thêm hai ô đếm `soBiChe`/`soDoiCho` (N1); hình dạng đầy đủ vẫn ghim ở đây.
    expect(locBadge([])).toEqual({ ve: [], soAn: 0, soBiChongLap: 0, soVuotTran: 0, soBiChe: 0, soDoiCho: 0 });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 47 (QA Đợt 46 N1) — VÙNG CẤM, DỜI CHỖ, ĐỎ ƯU TIÊN TUYỆT ĐỐI              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("locBadge — Đợt 47 N1: badge không nằm dưới lớp phủ; đỏ không bao giờ bị giấu khi còn chỗ", () => {
  const KHUNG = { rong: 1000, cao: 600 };
  // Thẻ "Chỉ số" góc trên-trái (QA Đợt 46: `bang-kpi-noi` 208×220 che badge SPI đỏ 100 %).
  const KPI = { trai: 8, phai: 216, tren: 8, duoi: 228 };
  const bd = (p: Partial<BadgeUngVien> & { id: number; x: number; y: number }): BadgeUngVien => ({
    diemUuTien: 1,
    ...p,
  });

  it("hợp đồng cũ giữ nguyên khi KHÔNG truyền khungCanvas/vungCam/doiCho: chồng ⇒ bỏ, không dời", () => {
    const kq = locBadge([bd({ id: 1, x: 100, y: 100, diemUuTien: 5 }), bd({ id: 2, x: 110, y: 100 })]);
    expect(kq.ve.map((b) => b.id)).toEqual([1]);
    expect(kq.soBiChongLap).toBe(1);
    expect(kq.soDoiCho).toBe(0);
    expect(kq.ve[0].doiCho).toBe(false);
    expect(kq.ve[0].hop).not.toBeNull();
  });

  it("badge thường dưới lớp phủ, không dời ⇒ BỊ CHE (đếm soBiChe, không đếm chồng)", () => {
    const kq = locBadge([bd({ id: 1, x: 100, y: 100 })], { vungCam: [KPI], khungCanvas: KHUNG });
    expect(kq.ve).toEqual([]);
    expect(kq.soBiChe).toBe(1);
    expect(kq.soBiChongLap).toBe(0);
    expect(kq.soAn).toBe(1);
  });

  it("doiCho: badge thường dưới lớp phủ được DỜI ra ngoài vùng cấm, trọn trong canvas, giữ neo gốc + cờ doiCho", () => {
    const kq = locBadge([bd({ id: 1, x: 100, y: 100 })], { vungCam: [KPI], khungCanvas: KHUNG, doiCho: true });
    expect(kq.ve).toHaveLength(1);
    const v = kq.ve[0];
    expect(v.doiCho).toBe(true);
    expect(v.xGoc).toBe(100);
    expect(v.yGoc).toBe(100);
    expect(v.hop).not.toBeNull();
    expect(haiHopChongNhau(v.hop!, KPI)).toBe(false);
    expect(v.hop!.trai).toBeGreaterThanOrEqual(0);
    expect(v.hop!.duoi).toBeLessThanOrEqual(KHUNG.cao);
    expect(kq.soDoiCho).toBe(1);
    expect(kq.soBiChe).toBe(0);
    // toạ độ vẽ là TÂM hộp mới (translate(-50%,-50%) của LopCanhBao)
    expect(v.x).toBeCloseTo((v.hop!.trai + v.hop!.phai) / 2, 6);
    expect(v.y).toBeCloseTo((v.hop!.tren + v.hop!.duoi) / 2, 6);
  });

  it("dời chỗ ưu tiên XUỐNG trước (phía dưới neo là thân máy — mũi tên ngắn nhất)", () => {
    // Lớp phủ chỉ che đúng neo; ô ngay dưới trống.
    const vung = { trai: 90, phai: 300, tren: 80, duoi: 112 };
    const kq = locBadge([bd({ id: 1, x: 200, y: 100 })], { vungCam: [vung], khungCanvas: KHUNG, doiCho: true });
    expect(kq.ve[0].doiCho).toBe(true);
    expect(kq.ve[0].y).toBeGreaterThan(100);
    expect(kq.ve[0].x).toBe(200);
  });

  it("hộp dời cũng phải nằm TRỌN canvas: neo sát mép dưới bị che ⇒ không dời xuống ngoài mép", () => {
    const vung = { trai: 0, phai: 1000, tren: 560, duoi: 600 };
    const kq = locBadge([bd({ id: 1, x: 500, y: 590 })], { vungCam: [vung], khungCanvas: KHUNG, doiCho: true });
    expect(kq.ve).toHaveLength(1);
    expect(kq.ve[0].hop!.duoi).toBeLessThanOrEqual(600);
    expect(haiHopChongNhau(kq.ve[0].hop!, vung)).toBe(false);
  });

  it("hai badge cùng neo, doiCho: cái sau DỜI thay vì bị bỏ; hai hộp không chồng", () => {
    const kq = locBadge(
      [bd({ id: 1, x: 300, y: 300, diemUuTien: 9 }), bd({ id: 2, x: 300, y: 300, diemUuTien: 1 })],
      { khungCanvas: KHUNG, doiCho: true },
    );
    expect(kq.ve.map((b) => b.id)).toEqual([1, 2]);
    expect(kq.ve[0].doiCho).toBe(false);
    expect(kq.ve[1].doiCho).toBe(true);
    expect(haiHopChongNhau(kq.ve[0].hop!, kq.ve[1].hop!)).toBe(false);
    expect(demCapChongLapBadge(kq.ve)).toBe(0);
  });

  it("★★★ ĐỎ (uuTienTuyetDoi) hết chỗ quanh neo vẫn được vẽ ở ô trống GẦN NHẤT; badge thường cùng cảnh bị giấu", () => {
    // Bức tường lớp phủ 3 bước quanh neo theo cả bốn hướng: ứng viên dời ±3 bước đều bị che.
    const tuong = { trai: 0, phai: 1000, tren: 0, duoi: 300 };
    const ung = [
      bd({ id: 7, x: 500, y: 150, diemUuTien: 10_000, uuTienTuyetDoi: true }),
      bd({ id: 8, x: 520, y: 150, diemUuTien: 1 }),
    ];
    const kq = locBadge(ung, { vungCam: [tuong], khungCanvas: KHUNG, doiCho: true });
    expect(kq.ve.map((b) => b.id)).toEqual([7]);
    expect(kq.ve[0].doiCho).toBe(true);
    expect(haiHopChongNhau(kq.ve[0].hop!, tuong)).toBe(false);
    // ô trống gần nhất: ngay dưới bức tường (y ≥ 300), gần cột x=500
    expect(kq.ve[0].hop!.tren).toBeGreaterThanOrEqual(300);
    expect(Math.abs(kq.ve[0].x - 500)).toBeLessThan(100);
    expect(kq.soBiChe).toBe(1); // badge thường #8 không có ô trong 3 bước ⇒ giấu, có đếm
    expect(kq.soDoiCho).toBe(1);
  });

  it("đỏ CHỈ bị giấu khi THẬT SỰ hết chỗ trên cả canvas", () => {
    const phuHet = { trai: 0, phai: 1000, tren: 0, duoi: 600 };
    const kq = locBadge([bd({ id: 1, x: 500, y: 300, uuTienTuyetDoi: true, diemUuTien: 10_000 })], {
      vungCam: [phuHet],
      khungCanvas: KHUNG,
      doiCho: true,
    });
    expect(kq.ve).toEqual([]);
    expect(kq.soBiChe).toBe(1);
  });

  it("badge ngoài khung (kẹp rìa) vẫn MIỄN mọi phép: không dời, không đếm che, hop=null", () => {
    const kq = locBadge([bd({ id: 1, x: 20, y: 20, ngoaiKhung: true })], {
      vungCam: [KPI],
      khungCanvas: KHUNG,
      doiCho: true,
    });
    expect(kq.ve).toHaveLength(1);
    expect(kq.ve[0].doiCho).toBe(false);
    expect(kq.ve[0].hop).toBeNull();
    expect(kq.soBiChe).toBe(0);
  });

  it("tất định: cùng đầu vào ở thứ tự khác ⇒ cùng vị trí dời", () => {
    const a = [bd({ id: 1, x: 100, y: 100, diemUuTien: 5 }), bd({ id: 2, x: 100, y: 100, diemUuTien: 1 })];
    const b = [a[1], a[0]];
    const ka = locBadge(a, { khungCanvas: KHUNG, doiCho: true });
    const kb = locBadge(b, { khungCanvas: KHUNG, doiCho: true });
    expect(ka.ve.map((v) => [v.id, v.x, v.y])).toEqual(kb.ve.map((v) => [v.id, v.x, v.y]));
  });

  it("★ dùng số đo THẬT khi có — badge hẹp hơn suy đoán thì KHÔNG bị giết oan", () => {
    // Hai badge cách nhau 40px: chồng theo trị suy đoán (84px), KHÔNG chồng theo
    // số đo thật (30px). Bỏ qua `rongPx` thật là giết oan một alarm đọc được.
    const that = [
      bd({ id: 1, x: 300, y: 200, rongPx: 30, caoPx: 18 }),
      bd({ id: 2, x: 340, y: 200, rongPx: 30, caoPx: 18 }),
    ];
    expect(demCapChongLapBadge(that)).toBe(0);
    expect(locBadge(that).ve).toHaveLength(2);
  });
});
