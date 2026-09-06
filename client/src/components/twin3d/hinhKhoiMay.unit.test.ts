/**
 * hinhKhoiMay.unit.test.ts — spec §13.1:
 *   ★ MỌI giá trị `machineTypeEnum` (25+) ánh xạ được, 0 giá trị `undefined`;
 *     khối co giãn đúng theo kích thước.
 *
 * ★★★ BÁNH CÓC. Test này import THẲNG `machineTypeEnum` từ `drizzle/schema/enums.ts`
 * — NGUỒN SỰ THẬT — chứ KHÔNG chép danh sách vào đây. Chép danh sách thì bánh cóc
 * chỉ đo chính bản sao của nó, và thêm loại máy mới vẫn xanh (đây đúng là lớp lỗi
 * BG-127 đã ghi trong bộ nhớ dự án: "độc lập phải ở MÔ HÌNH, không ở người đo").
 *
 * Import này CHỈ ở tệp test — `hinhKhoiMay.ts` KHÔNG import drizzle, vì drizzle kéo
 * pg-core vào bundle trình duyệt. Đo được: vitest chạy tệp này với environment
 * "node" nên import drizzle chạy được, còn mã sản phẩm thì sạch.
 */
import { describe, it, expect } from "vitest";
// eslint-disable-next-line no-restricted-imports -- ★ bánh cóc: PHẢI đọc nguồn sự thật
import { machineTypeEnum } from "../../../../drizzle/schema/enums";
import {
  DANH_SACH_KHOI,
  KHOI_MAC_DINH,
  KICH_THUOC_MAC_DINH,
  KICH_THUOC_TOI_DA_MM,
  LOAI_MAY_VE_TRAM_CHUNG,
  coAnhXaRieng,
  daPhanLoaiCoYThuc,
  hinhHocChoLoaiMay,
  hinhHocKhoi,
  hinhKhoiCho,
  type KhoiKey,
} from "./hinhKhoiMay";

/** Danh sách loại máy ĐỌC TỪ SCHEMA, không phải hằng số viết tay trong test. */
const LOAI_MAY_TU_SCHEMA: readonly string[] = machineTypeEnum.enumValues;

describe("hinhKhoiMay — ★ bánh cóc ánh xạ loại máy", () => {
  it("đọc được danh sách loại máy từ chính schema (không phải bản sao)", () => {
    expect(Array.isArray(LOAI_MAY_TU_SCHEMA)).toBe(true);
    // Spec §10B.1 nói "25+ loại"; đo được 24 trên schema ngày 2026-09-06.
    // Ngưỡng đặt ở 20 để test không đỏ vì số đếm, mà chỉ đỏ vì ÁNH XẠ THIẾU.
    expect(LOAI_MAY_TU_SCHEMA.length).toBeGreaterThanOrEqual(20);
  });

  it("MỌI giá trị machineTypeEnum ánh xạ được — 0 giá trị undefined", () => {
    // ⚠ ĐỌC KỸ: assertion này KHÔNG phải bánh cóc. `hinhKhoiCho` toàn phần theo
    // thiết kế (loại lạ -> tram_chung) nên nó KHÔNG BAO GIỜ đỏ được. Đo được:
    // thêm giá trị giả vào machineTypeEnum thì nó vẫn xanh. Giữ lại vì spec §13.1
    // yêu cầu nguyên văn, nhưng bánh cóc THẬT là test ngay bên dưới.
    const khongAnhXa: string[] = [];
    for (const loai of LOAI_MAY_TU_SCHEMA) {
      const khoi = hinhKhoiCho(loai);
      if (khoi === undefined || khoi === null) khongAnhXa.push(loai);
    }
    expect(khongAnhXa).toEqual([]);
  });

  it("★★★ BÁNH CÓC THẬT: mọi loại máy trong enum đã được PHÂN LOẠI CÓ Ý THỨC", () => {
    // Đây mới là điều kiện đỏ được. Thêm một loại máy vào `machineTypeEnum` mà
    // không thêm vào ANH_XA_LOAI_MAY hoặc LOAI_MAY_VE_TRAM_CHUNG => test ĐỎ và
    // nêu đích danh loại bị bỏ quên.
    //
    // Vì sao không dùng `undefined` làm điều kiện đỏ: `hinhKhoiCho` toàn phần
    // theo thiết kế, rơi-về-mặc-định là hành vi ĐÚNG lúc chạy (không được ném lỗi
    // giữa vòng render vì một loại máy lạ), nhưng lúc PHÁT TRIỂN thì rơi-về-mặc-
    // định câm chính là thứ phải bắt. Hai mục đích khác nhau, hai phép đo khác nhau.
    const chuaPhanLoai = LOAI_MAY_TU_SCHEMA.filter((l) => !daPhanLoaiCoYThuc(l));
    expect(chuaPhanLoai).toEqual([]);
  });

  it("★ bánh cóc trên BIẾT KÊU: một loại máy bịa ra bị bắt là chưa phân loại", () => {
    // Sàng "chỉ báo âm tính phải biết kêu trên ca dương đã biết" (bài học PDCA
    // vòng 2 của repo): chứng minh phép đo ở test trên không phải hằng-true.
    expect(daPhanLoaiCoYThuc("LOAI_MAY_KHONG_TON_TAI_XYZ")).toBe(false);
    expect(daPhanLoaiCoYThuc("AOI")).toBe(true);
    expect(daPhanLoaiCoYThuc("ASSEMBLY")).toBe(true);
  });

  it("★ LOAI_MAY_VE_TRAM_CHUNG không chứa tên đã trôi khỏi schema", () => {
    // Chiều ngược lại: xoá một loại máy khỏi enum mà quên dọn danh sách này thì
    // danh sách trở thành lời khai về thứ không còn tồn tại.
    const coThat = new Set(LOAI_MAY_TU_SCHEMA);
    expect(LOAI_MAY_VE_TRAM_CHUNG.filter((l) => !coThat.has(l))).toEqual([]);
  });

  it("★ hai danh sách phân loại KHÔNG chồng nhau (một loại, một chỗ quyết định)", () => {
    const trung = LOAI_MAY_VE_TRAM_CHUNG.filter((l) => coAnhXaRieng(l));
    expect(trung).toEqual([]);
  });

  it("★★★ mọi giá trị ánh xạ vào ĐÚNG một trong bảy khối đã khai", () => {
    const laKhoi = new Set<string>(DANH_SACH_KHOI);
    const sai: { loai: string; khoi: unknown }[] = [];
    for (const loai of LOAI_MAY_TU_SCHEMA) {
      const khoi = hinhKhoiCho(loai);
      if (!laKhoi.has(khoi)) sai.push({ loai, khoi });
    }
    expect(sai).toEqual([]);
  });

  it("★★★ mọi loại máy sinh được hình học THẬT (hopCon không rỗng)", () => {
    // Không chỉ đủ ánh xạ — mỗi khối phải vẽ ra thứ gì đó. Bắt trường hợp
    // ánh xạ vào một KhoiKey mới mà quên viết hình học cho nó.
    const rong: string[] = [];
    for (const loai of LOAI_MAY_TU_SCHEMA) {
      const mo = hinhHocChoLoaiMay(loai);
      if (mo.hopCon.length === 0) rong.push(loai);
    }
    expect(rong).toEqual([]);
  });

  it("bảy khối được khai đủ, không thừa không thiếu", () => {
    expect(DANH_SACH_KHOI).toHaveLength(7);
    expect(new Set(DANH_SACH_KHOI).size).toBe(7);
    expect(DANH_SACH_KHOI).toContain(KHOI_MAC_DINH);
  });

  it("★ mỗi khối trong bảy khối được ÍT NHẤT một loại máy thật dùng tới", () => {
    // Nếu một khối không loại nào dùng thì hoặc bảng ánh xạ sai, hoặc khối thừa.
    const daDung = new Set<KhoiKey>();
    for (const loai of LOAI_MAY_TU_SCHEMA) daDung.add(hinhKhoiCho(loai));
    const khongAiDung = DANH_SACH_KHOI.filter((k) => !daDung.has(k));
    expect(khongAiDung).toEqual([]);
  });
});

describe("hinhKhoiMay — ánh xạ theo bảng §10B.1", () => {
  const mongDoi: [string, KhoiKey][] = [
    ["AOI", "buong_kiem_quang"],
    ["AVI", "buong_kiem_quang"],
    ["SPI", "buong_kiem_quang"],
    ["AXI", "buong_kiem_quang"],
    ["ICT", "ban_test"],
    ["FCT", "ban_test"],
    ["ICT_FUNC", "ban_test"],
    ["CMM", "ban_test"],
    ["ROBOT_TEST", "ban_test"],
    ["MOUNTER", "may_gap_dat"],
    ["FEEDER", "may_gap_dat"],
    ["REFLOW", "lo_nhiet"],
    ["WAVE_SOLDER", "lo_nhiet"],
    ["STENCIL_PRINTER", "may_in_phun"],
    ["DISPENSING", "may_in_phun"],
    ["SCREWDRIVE", "may_in_phun"],
    ["ROBOT", "canh_tay_robot"],
    ["PALLETIZER", "canh_tay_robot"],
    ["WELDER", "canh_tay_robot"],
    ["ASSEMBLY", "tram_chung"],
    ["PACKAGING", "tram_chung"],
    ["AUTOMATION", "tram_chung"],
  ];

  it.each(mongDoi)("%s -> %s", (loai, khoi) => {
    expect(hinhKhoiCho(loai)).toBe(khoi);
  });

  it("★ mọi cặp mong đợi ở trên đều là loại máy CÓ THẬT trong schema", () => {
    // Chống việc bảng mong đợi trên đây trôi khỏi schema (test đo cái đã bị xoá).
    const coThat = new Set(LOAI_MAY_TU_SCHEMA);
    const khongCon = mongDoi.map(([l]) => l).filter((l) => !coThat.has(l));
    expect(khongCon).toEqual([]);
  });

  it("loại IoT (không có trong bảng 7 hàng) rơi vào tram_chung theo dòng 'còn lại'", () => {
    expect(hinhKhoiCho("IOT_SENSOR")).toBe("tram_chung");
    expect(hinhKhoiCho("IOT_GATEWAY")).toBe("tram_chung");
  });

  it("loại LẠ (chưa có trong enum) vẫn ra tram_chung, không undefined, không ném lỗi", () => {
    expect(hinhKhoiCho("LOAI_CHUA_TON_TAI_XYZ")).toBe("tram_chung");
    expect(hinhKhoiCho("")).toBe("tram_chung");
    expect(hinhKhoiCho(null)).toBe("tram_chung");
    expect(hinhKhoiCho(undefined)).toBe("tram_chung");
  });

  it("so khớp bỏ qua hoa thường và khoảng trắng (dữ liệu di trú từ hai hệ cũ)", () => {
    expect(hinhKhoiCho("aoi")).toBe("buong_kiem_quang");
    expect(hinhKhoiCho("  Reflow  ")).toBe("lo_nhiet");
  });

  it("coAnhXaRieng phân biệt 'ánh xạ có chủ ý' với 'rơi vào mặc định'", () => {
    expect(coAnhXaRieng("AOI")).toBe(true);
    expect(coAnhXaRieng("ASSEMBLY")).toBe(false);
    expect(coAnhXaRieng("LOAI_LA")).toBe(false);
  });
});

describe("hinhKhoiMay — hình học và ngân sách tam giác", () => {
  it.each(DANH_SACH_KHOI.map((k) => [k] as const))(
    "khối %s có 40-60 tam giác và ĐÚNG MỘT vạch chỉ hướng",
    (khoi) => {
      const mo = hinhHocKhoi(khoi, KICH_THUOC_MAC_DINH);
      expect(mo.soTamGiacUocTinh).toBeGreaterThanOrEqual(40);
      expect(mo.soTamGiacUocTinh).toBeLessThanOrEqual(60);
      const vach = mo.hopCon.filter((h) => h.vaiTro === "vach_huong");
      expect(vach).toHaveLength(1);
    },
  );

  it("★ vạch chỉ hướng luôn ở MẶT TRƯỚC (z dương) — không có nó máy xoay 180° trông y hệt", () => {
    for (const khoi of DANH_SACH_KHOI) {
      const vach = hinhHocKhoi(khoi, KICH_THUOC_MAC_DINH).hopCon.find(
        (h) => h.vaiTro === "vach_huong",
      );
      expect(vach).toBeDefined();
      expect(vach!.tam.z).toBeGreaterThan(0);
    }
  });

  it("tên hộp con trong một khối là duy nhất (dùng làm React key)", () => {
    for (const khoi of DANH_SACH_KHOI) {
      const ten = hinhHocKhoi(khoi, KICH_THUOC_MAC_DINH).hopCon.map((h) => h.ten);
      expect(new Set(ten).size).toBe(ten.length);
    }
  });

  it("mọi hộp con nằm trong khoảng tương đối hợp lệ", () => {
    for (const khoi of DANH_SACH_KHOI) {
      for (const h of hinhHocKhoi(khoi, KICH_THUOC_MAC_DINH).hopCon) {
        expect(h.co.x).toBeGreaterThan(0);
        expect(h.co.y).toBeGreaterThan(0);
        expect(h.co.z).toBeGreaterThan(0);
        for (const truc of ["x", "y", "z"] as const) {
          expect(Math.abs(h.tam[truc])).toBeLessThanOrEqual(0.75);
        }
      }
    }
  });

  it("★ khối CO GIÃN theo kích thước thật: AOI 1400mm và AOI 2200mm khác nhau", () => {
    const nho = hinhHocChoLoaiMay("AOI", { rongMm: 1400, caoMm: 1600, sauMm: 1200 });
    const to = hinhHocChoLoaiMay("AOI", { rongMm: 2200, caoMm: 1600, sauMm: 1200 });
    expect(nho.kichThuocMet.rong).toBe(1.4);
    expect(to.kichThuocMet.rong).toBe(2.2);
    expect(nho.kichThuocMet.rong).not.toBe(to.kichThuocMet.rong);
  });

  it("★ HÌNH DẠNG cố định: co giãn không đổi danh sách hộp con hay vị trí tương đối", () => {
    const nho = hinhHocChoLoaiMay("AOI", { rongMm: 1400, caoMm: 1600, sauMm: 1200 });
    const to = hinhHocChoLoaiMay("AOI", { rongMm: 9000, caoMm: 4000, sauMm: 7000 });
    expect(to.hopCon).toEqual(nho.hopCon);
    expect(to.khoi).toBe(nho.khoi);
  });

  it("kích thước mm quy đổi sang mét đúng 1000 lần", () => {
    const mo = hinhHocKhoi("ban_test", { rongMm: 2500, caoMm: 1800, sauMm: 900 });
    expect(mo.kichThuocMet).toEqual({ rong: 2.5, cao: 1.8, sau: 0.9 });
  });

  it("số đo rác (0, âm, NaN) rơi về mặc định thay vì sinh khối suy biến", () => {
    const mo = hinhHocKhoi("tram_chung", { rongMm: 0, caoMm: -5, sauMm: Number.NaN });
    expect(mo.kichThuocMm).toEqual(KICH_THUOC_MAC_DINH);
  });

  it("số đo quá lớn bị kẹp về trần 100 m", () => {
    const mo = hinhHocKhoi("lo_nhiet", { rongMm: 5_000_000, caoMm: 1600, sauMm: 1200 });
    expect(mo.kichThuocMm.rongMm).toBe(KICH_THUOC_TOI_DA_MM);
  });

  it("tất định: gọi hai lần cùng đầu vào cho kết quả deep-equal", () => {
    const a = hinhHocChoLoaiMay("MOUNTER", { rongMm: 3200, caoMm: 1500, sauMm: 1800 });
    const b = hinhHocChoLoaiMay("MOUNTER", { rongMm: 3200, caoMm: 1500, sauMm: 1800 });
    expect(a).toEqual(b);
  });

  it("khối canh_tay_robot có đủ đế trụ + 3 khúc khớp (§10B.1)", () => {
    const ten = hinhHocKhoi("canh_tay_robot", KICH_THUOC_MAC_DINH).hopCon.map((h) => h.ten);
    expect(ten).toContain("de-tru");
    expect(ten).toContain("khuc-1");
    expect(ten).toContain("khuc-2");
    expect(ten).toContain("khuc-3");
  });

  it("buồng kiểm quang có cửa băng tải HAI ĐẦU (§10B.1)", () => {
    const cua = hinhHocKhoi("buong_kiem_quang", KICH_THUOC_MAC_DINH).hopCon.filter(
      (h) => h.vaiTro === "cua",
    );
    expect(cua).toHaveLength(2);
    // Hai cửa ở hai đầu đối diện theo trục rộng.
    expect(Math.sign(cua[0].tam.x)).toBe(-Math.sign(cua[1].tam.x));
  });
});
