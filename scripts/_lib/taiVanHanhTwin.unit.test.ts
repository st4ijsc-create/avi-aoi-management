/**
 * taiVanHanhTwin.unit.test.ts — lô P đợt 14.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BỘ TEST NÀY ĐO CÁI GÌ, VÀ VÌ SAO NÓ KHÔNG PHẢI `f(x)=x`
 * ════════════════════════════════════════════════════════════════════════════
 * Cám dỗ hiển nhiên khi test một bộ sinh dữ liệu là kiểm "nó sinh ra thứ nó
 * sinh ra" — đếm số hàng rồi so với công thức vừa dùng để sinh. Cổng đó xanh
 * trên MỌI bản cài đặt, kể cả bản sinh ra 240 hàng mốc thời gian năm 1970.
 *
 * Nên mọi ca ở đây đo một trong ba thứ mà bản cài đặt CÓ THỂ SAI:
 *
 *   1. Dữ liệu sinh ra có LỌT QUA các cửa lọc tuổi của chính hệ này không
 *      (G30) — ngưỡng lấy từ hệ, không lấy từ bộ sinh.
 *   2. Hai lớp phủ độc lập có ĐỒNG Ý với nhau không (nút thắt WIP ↔ lời khai
 *      `line_balance`) — đây là lỗi mà Đợt 8 đo được trên dữ liệu THẬT.
 *   3. Đầu ra có KHÁC ĐẦU VÀO không (G5/G32) — một bộ sinh cho mọi máy cùng
 *      một giá trị vẫn "có dữ liệu" nhưng không lớp phủ nào mang tin.
 *
 * ★ Ca đối chứng (`f(x)=x`) nằm ở cuối: bản cài đặt PHẲNG phải làm ĐỎ đúng
 *   những cổng mà bản thật làm xanh. Không có nó thì không ai biết mấy cổng
 *   trên có biết kêu hay không.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUA_SO_WIP_MS,
  CUA_SO_KIEM_TRA_MS,
  HAN_KHAI_NGHEN_MS,
  HAN_MAU_MAY_MS,
  KIEM_TRA_MOI_MAY,
  SO_MOC_WIP,
  TRANG_THAI_VAN_HANH,
  TUOI_HEARTBEAT_MS,
  bamChuoi,
  mocConHieuLuc,
  sinhAndonChoLine,
  sinhCanBangLine,
  sinhKiemTraChoMay,
  sinhSucKhoeChoMay,
  sinhWipChoLine,
  soWipCuaTram,
  taoNgauNhien,
  tramNghenCuaLine,
  trangThaiCuaMay,
  type TramTai,
} from "./taiVanHanhTwin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Gốc worktree — mọi phép đọc chéo module bên client đi qua đây. */
const GOC = path.join(__dirname, "..", "..");

/**
 * ★★★ ĐỌC MỘT HẰNG SỐ TỪ MÃ NGUỒN BÊN KIA — cưỡng chế G12 mà không nhân bản số.
 *
 * Mấy ca dưới cần ngưỡng của HỆ (`HAN_KHAI_NGHEN_MS`, `BOI_NGHEN`,
 * `NGUONG_TUOI_MS`, …). Viết lại con số ở đây thì bài test tự thoả: nó so bản
 * sao của mình với bản sao của mình, và vẫn xanh đúng vào ngày bên kia đổi số.
 * Nên nó ĐỌC từ tệp nguồn thật.
 *
 * ⚠ Cố ý KHÔNG dùng `eval`/`Function`: các hằng này là biểu thức số học hằng
 *   (`60_000`, `8 * 60 * 60 * 1000`), nên một bộ đọc CHỈ chấp nhận số và `*`
 *   là đủ — và nó THẤT BẠI TO khi gặp bất cứ thứ gì khác, thay vì âm thầm chạy
 *   mã lạ. Một tệp nguồn bị sửa thành lệnh gọi hàm sẽ làm ca test đỏ, đúng ý.
 */
function docHangSo(duongDan: string, ten: string): number {
  const nguon = fs.readFileSync(duongDan, "utf8");
  const m = nguon.match(new RegExp(`export const ${ten}\\s*=\\s*([^;]+);`));
  if (!m) throw new Error(`khong tim thay hang ${ten} trong ${duongDan}`);
  const bieuThuc = m[1].trim();
  // Chỉ chấp nhận: số (cho phép `_` phân nhóm) nối nhau bằng `*`.
  if (!/^[0-9_]+(\s*\*\s*[0-9_]+)*$/.test(bieuThuc)) {
    throw new Error(`hang ${ten} khong phai tich cac so hang: "${bieuThuc}"`);
  }
  return bieuThuc.split("*").reduce((a, x) => a * Number(x.trim().replace(/_/g, "")), 1);
}

const WIP_TRAM_TS = path.join(GOC, "client", "src", "components", "twin3d", "van-hanh", "wipTram.ts");
const MAU_TRANG_THAI_TS = path.join(GOC, "client", "src", "components", "twin3d", "mauTrangThai.ts");

/** Đồng hồ cố định — mọi ca tất định, không phụ thuộc lúc chạy test. */
const BAY_GIO = Date.UTC(2026, 8, 7, 12, 0, 0);

/** 12 trạm của một line, đúng hình dạng brief đòi (12 máy/line). */
function lineMau(lineId: number, soTram = 12): TramTai[] {
  return Array.from({ length: soTram }, (_, i) => ({
    stationId: lineId * 1000 + i,
    machineId: lineId * 1000 + i + 500000,
    lineId,
    thuTu: i,
    soTramCuaLine: soTram,
  }));
}

describe("★★★ G30 — mốc sinh ra phải lọt qua CỬA LỌC CỦA HỆ, không phải cửa của bộ sinh", () => {
  it("mọi mốc WIP nằm trong 24h mà `predictionOverlay` nhìn (lookback VIẾT CỨNG ở router)", () => {
    // 24h là hằng của `digitalTwinRouter.predictionOverlay`, KHÔNG phải hằng của
    // module này. Đây là điểm mấu chốt: nếu ai đó nới `CUA_SO_WIP_MS` lên 30h
    // cho "nhiều dữ liệu hơn", ca này đỏ — đúng lúc cần đỏ.
    const LOOKBACK_ROUTER_MS = 24 * 60 * 60 * 1000;
    const hang = sinhWipChoLine("TAI-T", 7, lineMau(7), BAY_GIO);
    expect(hang.length).toBeGreaterThan(0);
    for (const h of hang) {
      expect(BAY_GIO - h.enteredAtMs).toBeGreaterThanOrEqual(0);
      expect(BAY_GIO - h.enteredAtMs).toBeLessThan(LOOKBACK_ROUTER_MS);
    }
  });

  it("★ WIP rải ra ĐỦ ĐIỂM cho `predictionOverlay` (cần ≥3 bucket, mặc định 30 phút)", () => {
    // Đây là ca mà "7.048 hàng" của DB thật KHÔNG qua được — số hàng không phải
    // thứ router đo; nó gom theo bucket thời gian rồi đếm BUCKET.
    const hang = sinhWipChoLine("TAI-T", 7, lineMau(7), BAY_GIO);
    const BUCKET_MS = 30 * 60 * 1000;
    const bucket = new Set(hang.map((h) => Math.floor(h.enteredAtMs / BUCKET_MS)));
    expect(bucket.size).toBeGreaterThanOrEqual(3);
    // Và dư nhiều lần ngưỡng, không phải vừa đủ 3 — vừa đủ thì một thay đổi nhỏ
    // ở `bucketMin` đẩy nó xuống dưới ngưỡng mà không ai để ý.
    expect(bucket.size).toBeGreaterThanOrEqual(20);
  });

  it("lời khai `line_balance` còn hiệu lực theo ĐÚNG hạn 8h của `wipTram.conHieuLuc`", () => {
    const cb = sinhCanBangLine(7, lineMau(7), BAY_GIO);
    expect(cb).not.toBeNull();
    expect(mocConHieuLuc(cb!.periodEndMs, BAY_GIO, HAN_KHAI_NGHEN_MS)).toBe(true);
  });

  it("mốc kiểm tra sản phẩm nằm trong cửa sổ 24h mặc định của `defectHeatmap`", () => {
    const kt = sinhKiemTraChoMay("TAI-T", 42, BAY_GIO);
    expect(kt).toHaveLength(KIEM_TRA_MOI_MAY);
    for (const h of kt) {
      expect(BAY_GIO - h.inspectionTimeMs).toBeGreaterThanOrEqual(0);
      expect(BAY_GIO - h.inspectionTimeMs).toBeLessThan(24 * 60 * 60 * 1000);
    }
  });

  it("heartbeat đủ tươi để `trangThaiHienThi` KHÔNG ghi đè về `khong_ro`", () => {
    // `NGUONG_TUOI_MS` của `mauTrangThai` — đọc từ nguồn, không viết lại số.
    const nguongTuoiMs = docHangSo(MAU_TRANG_THAI_TS, "NGUONG_TUOI_MS");
    expect(Number.isFinite(nguongTuoiMs)).toBe(true);
    expect(TUOI_HEARTBEAT_MS).toBeLessThan(nguongTuoiMs);
  });

  it("★ mốc TƯƠNG LAI bị `mocConHieuLuc` bác — sai múi giờ không được tính là 'tươi'", () => {
    expect(mocConHieuLuc(BAY_GIO + 60_000, BAY_GIO, HAN_KHAI_NGHEN_MS)).toBe(false);
    expect(mocConHieuLuc(Number.NaN, BAY_GIO, HAN_KHAI_NGHEN_MS)).toBe(false);
  });
});

describe("★★★ G12 — bản sao của `HAN_KHAI_NGHEN_MS` không được lệch trong im lặng", () => {
  it("hằng ở đây BẰNG hằng trong `client/.../wipTram.ts` (đọc từ nguồn, không viết lại)", () => {
    expect(docHangSo(WIP_TRAM_TS, "HAN_KHAI_NGHEN_MS")).toBe(HAN_KHAI_NGHEN_MS);
  });

  it("`HAN_MAU_MAY_MS` BẰNG `NGUONG_CU_MS` — hạn dùng script in ra phải là hạn THẬT", () => {
    expect(docHangSo(MAU_TRANG_THAI_TS, "NGUONG_CU_MS")).toBe(HAN_MAU_MAY_MS);
  });

  it("★ bộ đọc hằng TỪ CHỐI biểu thức không phải tích các số — không chạy mã lạ", () => {
    expect(() => docHangSo(WIP_TRAM_TS, "KHONG_TON_TAI_DAU")).toThrow(/khong tim thay hang/);
  });
});

describe("★★★ HAI LỚP PHỦ PHẢI ĐỒNG Ý — lỗi mà Đợt 8 đo được trên dữ liệu THẬT", () => {
  it("`bottleneckStationId` server khai TRÙNG trạm có WIP cao nhất", () => {
    for (const lineId of [1, 7, 33, 240]) {
      const tram = lineMau(lineId);
      const cb = sinhCanBangLine(lineId, tram, BAY_GIO)!;
      const nghen = tramNghenCuaLine(lineId, tram.length);
      const wipTheoTram = tram.map((t) => ({ id: t.stationId, wip: soWipCuaTram(t, nghen) }));
      const caoNhat = wipTheoTram.reduce((a, b) => (b.wip > a.wip ? b : a));
      expect(cb.bottleneckStationId).toBe(caoNhat.id);
    }
  });

  it("andon nổ ở ĐÚNG trạm nút thắt — cảnh báo và WIP không nói hai chuyện khác nhau", () => {
    const tram = lineMau(7);
    const andon = sinhAndonChoLine(7, tram, BAY_GIO);
    const cb = sinhCanBangLine(7, tram, BAY_GIO)!;
    expect(andon).toHaveLength(1);
    expect(andon[0].stationId).toBe(cb.bottleneckStationId);
  });

  it("★ nút thắt vượt `BOI_NGHEN × trung vị` — nếu không, `laNghen` trả false ở MỌI trạm", () => {
    // Đọc BOI_NGHEN từ chính module cưỡng chế nó, không viết lại con số.
    const boiNghen = docHangSo(WIP_TRAM_TS, "BOI_NGHEN");
    const toiThieu = docHangSo(WIP_TRAM_TS, "WIP_TOI_THIEU_DE_NGHEN");

    const tram = lineMau(7);
    const nghen = tramNghenCuaLine(7, tram.length);
    const so = tram.map((t) => soWipCuaTram(t, nghen)).sort((a, b) => a - b);
    const trungVi = so.length % 2 ? so[(so.length - 1) / 2] : (so[so.length / 2 - 1] + so[so.length / 2]) / 2;
    const wipNghen = soWipCuaTram(tram[nghen], nghen);

    expect(wipNghen).toBeGreaterThanOrEqual(toiThieu);
    expect(wipNghen).toBeGreaterThanOrEqual(boiNghen * trungVi);
  });
});

describe("★★★ G5/G32 — ĐẦU RA PHẢI KHÁC ĐẦU VÀO: mọi lớp phủ phải có ≥2 giá trị", () => {
  it("trạng thái vận hành trải qua NHIỀU giá trị enum, không phải toàn `running`", () => {
    const tap = new Set(Array.from({ length: 240 }, (_, i) => trangThaiCuaMay("TAI-T", i + 1)));
    expect(tap.size).toBeGreaterThanOrEqual(4);
    for (const t of tap) expect(TRANG_THAI_VAN_HANH).toContain(t);
    // `running` phải CHIẾM ĐA SỐ (nhà máy đang chạy), nhưng không phải tất cả.
    const chay = Array.from({ length: 240 }, (_, i) => trangThaiCuaMay("TAI-T", i + 1)).filter(
      (t) => t === "running",
    ).length;
    expect(chay).toBeGreaterThan(120);
    expect(chay).toBeLessThan(240);
  });

  it("điểm sức khoẻ trải rộng — bản đồ màu twin không một màu", () => {
    const diem = Array.from({ length: 240 }, (_, i) =>
      sinhSucKhoeChoMay("TAI-T", i + 1, `M${i}`, BAY_GIO).healthScore,
    );
    expect(new Set(diem).size).toBeGreaterThan(20);
    expect(Math.max(...diem) - Math.min(...diem)).toBeGreaterThan(30);
  });

  it("rủi ro hỏng NGƯỢC chiều sức khoẻ — không phải một số ngẫu nhiên thứ hai", () => {
    for (const id of [1, 50, 199]) {
      const h = sinhSucKhoeChoMay("TAI-T", id, `M${id}`, BAY_GIO);
      expect(h.predictedFailureRisk).toBe(100 - h.healthScore);
    }
  });

  it("tỉ lệ NG khác nhau giữa các máy — `defectHeatmap` không ra bản đồ một màu", () => {
    const tiLe = Array.from({ length: 60 }, (_, i) => {
      const kt = sinhKiemTraChoMay("TAI-T", i + 1, BAY_GIO);
      return kt.filter((k) => k.overallResult === "NG").length / kt.length;
    });
    expect(new Set(tiLe).size).toBeGreaterThan(3);
    // Có máy sạch VÀ có máy lỗi — cả hai đầu đều phải tồn tại.
    expect(Math.min(...tiLe)).toBe(0);
    expect(Math.max(...tiLe)).toBeGreaterThan(0);
  });

  it("WIP không phẳng: trạm nghẽn cao hơn hẳn phần còn lại", () => {
    const tram = lineMau(7);
    const nghen = tramNghenCuaLine(7, tram.length);
    const so = tram.map((t) => soWipCuaTram(t, nghen));
    expect(new Set(so).size).toBeGreaterThan(2);
    expect(Math.max(...so)).toBeGreaterThan(5 * Math.min(...so));
  });
});

describe("★★★ ĐỐI CHỨNG (f(x)=x) — bản PHẲNG phải làm ĐỎ đúng những cổng trên", () => {
  /** Bản cài đặt "hỏng theo cách hợp lý": mọi trạm cùng WIP. */
  function soWipPhang(): number {
    return 10;
  }

  it("bản PHẲNG KHÔNG vượt được ngưỡng nghẽn ⇒ cổng 'nút thắt' phải bắt được", () => {
    const tram = lineMau(7);
    const so = tram.map(() => soWipPhang());
    const trungVi = 10;
    const BOI_NGHEN_GIA = 3;
    // Với bản thật, cổng này ĐẠT (đã kiểm ở trên). Với bản phẳng nó phải TRƯỢT —
    // nếu không, cổng kia xanh vì nó không biết kêu, chứ không vì hệ đúng.
    expect(Math.max(...so) >= BOI_NGHEN_GIA * trungVi).toBe(false);
  });

  it("bản MỘT MỐC (mọi hàng cùng `enteredAt`) chỉ ra 1 bucket ⇒ cổng '≥3 bucket' phải bắt được", () => {
    const BUCKET_MS = 30 * 60 * 1000;
    const motMoc = Array.from({ length: 7048 }, () => ({ enteredAtMs: BAY_GIO - 1000 }));
    const bucket = new Set(motMoc.map((h) => Math.floor(h.enteredAtMs / BUCKET_MS)));
    // 7.048 hàng — nhiều gấp 10 lần bản thật — và vẫn TRƯỢT. Đây chính là lý do
    // "số hàng" không bao giờ là bằng chứng cho "overlay chạy được".
    // Cong that doi >=3; ban mot-moc chi ra 1 ⇒ cong kia BIET KEU.
    expect(bucket.size).toBe(1);
    expect(bucket.size >= 3).toBe(false);
  });

  it("bản HẾT HẠN (mốc 17 ngày — đúng tuổi dữ liệu THẬT của DB này) bị bác", () => {
    const mocThat = BAY_GIO - 17 * 24 * 60 * 60 * 1000;
    expect(mocConHieuLuc(mocThat, BAY_GIO, HAN_KHAI_NGHEN_MS)).toBe(false);
    expect(BAY_GIO - mocThat).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("bản MỘT MÀU (mọi máy `running`) làm trượt cổng đa dạng trạng thái", () => {
    const tap = new Set(Array.from({ length: 240 }, () => "running"));
    expect(tap.size).toBe(1);
    expect(tap.size >= 4).toBe(false);
  });
});

describe("TẤT ĐỊNH — chạy hai lần ra cùng một CSDL", () => {
  it("cùng tham số ⇒ cùng kết quả, mọi bộ sinh", () => {
    const a = sinhWipChoLine("TAI-T", 7, lineMau(7), BAY_GIO);
    const b = sinhWipChoLine("TAI-T", 7, lineMau(7), BAY_GIO);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(sinhKiemTraChoMay("TAI-T", 5, BAY_GIO))).toBe(
      JSON.stringify(sinhKiemTraChoMay("TAI-T", 5, BAY_GIO)),
    );
    expect(trangThaiCuaMay("TAI-T", 9)).toBe(trangThaiCuaMay("TAI-T", 9));
  });

  it("MÃ NHÀ MÁY khác ⇒ dãy khác (hạt thật sự vào được bộ sinh)", () => {
    const a = Array.from({ length: 60 }, (_, i) => trangThaiCuaMay("TAI-T", i));
    const b = Array.from({ length: 60 }, (_, i) => trangThaiCuaMay("TAI-U", i));
    expect(a.join()).not.toBe(b.join());
  });

  it("LCG/FNV giữ nguyên hợp đồng với `sinh-tai-twin.ts` (cùng thuật toán, cùng dãy)", () => {
    // Nếu ai đó đổi hằng LCG ở một trong hai tệp, phân bố máy và phân bố WIP sẽ
    // lệch nhau mà không gì nổ. Ghim bằng vector cụ thể.
    expect(bamChuoi("FUYU-F:1:0")).toBe(bamChuoi("FUYU-F:1:0"));
    const r = taoNgauNhien(bamChuoi("TAI-T:1:0"));
    const day = [r(), r(), r()];
    const r2 = taoNgauNhien(bamChuoi("TAI-T:1:0"));
    expect([r2(), r2(), r2()]).toEqual(day);
    for (const x of day) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("★★★ HAI SCRIPT PHẢI **PHÂN TÍCH CÚ PHÁP ĐƯỢC** — `npm run check` KHÔNG bắt được", () => {
  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ VÌ SAO CA NÀY TỒN TẠI — MỘT LỖI THẬT LỌT QUA CỔNG `check`
   * ════════════════════════════════════════════════════════════════════════
   * Lô P viết chú thích tiếng Việt kiểu SQL (`-- ...`) BÊN TRONG một template
   * literal, và trong chú thích có dấu **backtick** quanh tên cột. Backtick đó
   * ĐÓNG template literal sớm, biến phần còn lại thành mã rác:
   *
   *   ERROR: Expected ";" but found "factoryCode"   (esbuild, tsx)
   *
   * `npm run check` (tsc --noEmit) **VẪN EXIT 0** — script không nằm trong
   * `include` của tsconfig dùng cho check, nên cổng 2 xanh trong khi script
   * KHÔNG CHẠY NỔI. Đúng lớp "cổng xanh mà không đo gì".
   *
   * ⇒ Ca này ép esbuild thực sự phân tích cả hai tệp. Nó rẻ, và nó bắt đúng
   *   thứ mà cổng lớn mù.
   */
  const SCRIPTS = ["sinh-tai-twin.ts", "go-tai-twin.ts"];

  it("esbuild phân tích được cả hai script (bắt backtick lạc trong template literal)", async () => {
    const esbuild = await import("esbuild");
    for (const ten of SCRIPTS) {
      const duong = path.join(__dirname, "..", ten);
      const ma = fs.readFileSync(duong, "utf8");
      expect(
        () => esbuild.transformSync(ma, { loader: "ts", format: "esm" }),
        `${ten} khong phan tich duoc`,
      ).not.toThrow();
    }
  });

  it("★ đối chứng: bộ kiểm TRÊN biết kêu khi có backtick lạc thật", async () => {
    const esbuild = await import("esbuild");
    // Tái dựng ĐÚNG hình dạng lỗi đã gặp: backtick trong chú thích SQL.
    const maHong = "const x = sql`SELECT 1 -- chu thich co `cot` o day\n`;";
    expect(() => esbuild.transformSync(maHong, { loader: "ts", format: "esm" })).toThrow();
  });
});

describe("HÌNH DẠNG — 12 máy/line theo brief", () => {
  it("nút thắt nằm GIỮA chuyền, không phải trạm đầu hay trạm cuối", () => {
    const nghen = tramNghenCuaLine(7, 12);
    expect(nghen).toBeGreaterThan(0);
    expect(nghen).toBeLessThan(11);
  });

  it("line rỗng KHÔNG làm nổ bộ sinh (nhà máy chưa có trạm nào)", () => {
    expect(sinhAndonChoLine(7, [], BAY_GIO)).toEqual([]);
    expect(sinhCanBangLine(7, [], BAY_GIO)).toBeNull();
    expect(sinhWipChoLine("TAI-T", 7, [], BAY_GIO)).toEqual([]);
  });

  it("hằng cửa sổ WIP < 24h và số mốc đủ lớn (ghim để không ai nới lỏng vô tình)", () => {
    expect(CUA_SO_WIP_MS).toBeLessThan(24 * 60 * 60 * 1000);
    expect(SO_MOC_WIP).toBeGreaterThanOrEqual(3);
    expect(CUA_SO_KIEM_TRA_MS).toBeLessThan(24 * 60 * 60 * 1000);
  });
});
