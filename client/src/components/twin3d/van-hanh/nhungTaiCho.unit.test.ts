/**
 * nhungTaiCho.unit.test.ts — luật XEM CHI TIẾT TẠI CHỖ (Đợt 10 mục 5).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G20 — IMPORT CHÍNH MODULE GIAO HÀNG, KHÔNG MOCK
 * ════════════════════════════════════════════════════════════════════════════
 * Mọi ca dưới đây gọi thẳng `./nhungTaiCho`. Phép thử "xoá sạch mã sản phẩm,
 * test có đỏ không" phải trả lời CÓ — không có mock nào đứng giữa.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G5/G32 — DỮ LIỆU KHÁC RỖNG, VÀ HỎI "ĐẦU RA CÓ KHÁC ĐẦU VÀO KHÔNG"
 * ════════════════════════════════════════════════════════════════════════════
 * Một `docNganNhung` luôn trả `null` sẽ qua được mọi ca "đầu vào rác → null".
 * Nên mỗi nhóm ca âm đi kèm ÍT NHẤT một ca dương **cùng hình dạng** để chứng
 * minh thiết bị đo biết kêu. Và `tronXemVaoQuery` được đo bằng cách so chuỗi
 * VÀO với chuỗi RA — không chỉ "không ném".
 */
import { describe, expect, it } from "vitest";

import {
  KHOA_XEM,
  docNganNhung,
  cauChoLyDoNgan,
  docXemTuQuery,
  lyDoNganNhung,
  ghiNganNhung,
  hrefGocCuaNgan,
  khoaTieuDeNhung,
  nhanDuPhongNhung,
  nhungChoHref,
  nhungDuoc,
  tronXemVaoQuery,
  type LoaiNhung,
  type NganNhungMo,
} from "./nhungTaiCho";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* docNganNhung — URL LÀ ĐẦU VÀO KHÔNG TIN ĐƯỢC                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("docNganNhung", () => {
  it("đọc được cả ba loại nhúng với id dương", () => {
    expect(docNganNhung("machine:42")).toEqual({ loai: "machine", id: 42 });
    expect(docNganNhung("robot:7")).toEqual({ loai: "robot", id: 7 });
    expect(docNganNhung("station:1")).toEqual({ loai: "station", id: 1 });
  });

  it("cắt khoảng trắng hai đầu", () => {
    expect(docNganNhung("  machine:42  ")).toEqual({ loai: "machine", id: 42 });
  });

  it("trả null với tham số vắng hoặc rỗng", () => {
    expect(docNganNhung(null)).toBeNull();
    expect(docNganNhung(undefined)).toBeNull();
    expect(docNganNhung("")).toBeNull();
    expect(docNganNhung("   ")).toBeNull();
  });

  it("★ loại LẠ bị chặn — danh sách ĐÓNG, không đoán", () => {
    // Đây là loại HỢP LỆ ở `duongDanTwin.LoaiVatThe` nhưng KHÔNG nhúng được:
    // nếu chấp nhận, ngăn mở ra rỗng và không lỗi nào nổ.
    expect(docNganNhung("line:3")).toBeNull();
    expect(docNganNhung("workshop:3")).toBeNull();
    expect(docNganNhung("factory:3")).toBeNull();
    // ...và ca dương cùng hình dạng chứng minh phép đo không mù:
    expect(docNganNhung("machine:3")).toEqual({ loai: "machine", id: 3 });
  });

  it("chặn chuỗi tấn công / rác", () => {
    expect(docNganNhung("<script>:1")).toBeNull();
    expect(docNganNhung("machine:1:2")).toBeNull();
    expect(docNganNhung("MACHINE:1")).toBeNull(); // phân biệt hoa/thường
  });

  it("★ thiếu id là HỎNG, không phải 'cái nào cũng được'", () => {
    expect(docNganNhung("machine")).toBeNull();
    expect(docNganNhung("machine:")).toBeNull();
  });

  it("chỉ nhận số nguyên DƯƠNG", () => {
    expect(docNganNhung("machine:0")).toBeNull();
    expect(docNganNhung("machine:-1")).toBeNull();
    expect(docNganNhung("machine:1.5")).toBeNull();
    expect(docNganNhung("machine:1e3")).toBeNull();
    expect(docNganNhung("machine:abc")).toBeNull();
    expect(docNganNhung("machine:NaN")).toBeNull();
    // ca dương cùng khuôn:
    expect(docNganNhung("machine:1000")).toEqual({ loai: "machine", id: 1000 });
  });

  it("khứ hồi ghi → đọc cho lại đúng giá trị (cả ba loại)", () => {
    const ds: NganNhungMo[] = [
      { loai: "machine", id: 42 },
      { loai: "robot", id: 7 },
      { loai: "station", id: 123 },
    ];
    for (const n of ds) {
      expect(docNganNhung(ghiNganNhung(n))).toEqual(n);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* docXemTuQuery                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("docXemTuQuery", () => {
  it("đọc được `xem` khi đứng CẠNH các tham số của tầng cảnh", () => {
    const q = "?pv=line:1&chon=machine:42&cam=1,2,3,4,5&lop=nhiet&xem=machine:42";
    expect(docXemTuQuery(q)).toEqual({ loai: "machine", id: 42 });
  });

  it("chấp nhận query string không có dấu `?` đứng đầu", () => {
    expect(docXemTuQuery("xem=robot:9")).toEqual({ loai: "robot", id: 9 });
  });

  it("trả null khi query không có khoá `xem` — và ca dương chứng minh không mù", () => {
    expect(docXemTuQuery("?pv=line:1&chon=machine:42")).toBeNull();
    expect(docXemTuQuery("?pv=line:1&chon=machine:42&xem=station:5")).toEqual({
      loai: "station",
      id: 5,
    });
  });

  it("`xem` hỏng KHÔNG làm hỏng phép đọc — nó chỉ là null", () => {
    expect(docXemTuQuery("?pv=line:1&xem=rac")).toBeNull();
  });

  it("query rỗng là null", () => {
    expect(docXemTuQuery("")).toBeNull();
    expect(docXemTuQuery("?")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* tronXemVaoQuery — ★★★ ĐIỂM MẤU CHỐT: KHÔNG NUỐT THAM SỐ KHÁC               */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("tronXemVaoQuery", () => {
  it("★★★ GIỮ NGUYÊN phạm vi + camera + lớp khi MỞ ngăn", () => {
    const truoc = "pv=line:1&chon=machine:42&cam=45.2,18,-30.5,0.8,120&lop=nhiet";
    const sau = tronXemVaoQuery(truoc, { loai: "machine", id: 42 });
    const sp = new URLSearchParams(sau);
    // Mọi ô ngữ cảnh 3D còn nguyên — nếu mất, mở ngăn chi tiết chính là thứ
    // làm mất ngữ cảnh mà tính năng này sinh ra để giữ.
    expect(sp.get("pv")).toBe("line:1");
    expect(sp.get("chon")).toBe("machine:42");
    expect(sp.get("cam")).toBe("45.2,18,-30.5,0.8,120");
    expect(sp.get("lop")).toBe("nhiet");
    expect(sp.get(KHOA_XEM)).toBe("machine:42");
    // G32 — ĐẦU RA KHÁC ĐẦU VÀO (nếu hàm là no-op, ca này đỏ):
    expect(sau).not.toBe(truoc);
  });

  it("★★★ GIỮ NGUYÊN tham số LẠ (utm_*) — `/twin` không sở hữu độc quyền query", () => {
    const sau = tronXemVaoQuery("pv=line:1&utm_source=chat", { loai: "robot", id: 7 });
    const sp = new URLSearchParams(sau);
    expect(sp.get("utm_source")).toBe("chat");
    expect(sp.get("pv")).toBe("line:1");
    expect(sp.get(KHOA_XEM)).toBe("robot:7");
  });

  it("`null` ĐÓNG ngăn: xoá hẳn khoá, không để lại `xem=` rỗng", () => {
    const sau = tronXemVaoQuery("pv=line:1&xem=machine:42", null);
    const sp = new URLSearchParams(sau);
    expect(sp.has(KHOA_XEM)).toBe(false);
    expect(sp.get("pv")).toBe("line:1");
    // ĐẦU RA KHÁC ĐẦU VÀO:
    expect(sau).not.toContain("xem");
  });

  it("đóng ngăn khi vốn không có ngăn nào là no-op an toàn", () => {
    const sau = tronXemVaoQuery("pv=line:1", null);
    expect(new URLSearchParams(sau).get("pv")).toBe("line:1");
  });

  it("ghi đè ngăn cũ bằng ngăn mới, không nhân đôi khoá", () => {
    const sau = tronXemVaoQuery("xem=machine:1", { loai: "station", id: 9 });
    expect(sau.match(/xem=/g)).toHaveLength(1);
    expect(new URLSearchParams(sau).get(KHOA_XEM)).toBe("station:9");
  });

  it("chấp nhận query string có `?` đứng đầu", () => {
    const sau = tronXemVaoQuery("?pv=line:1", { loai: "machine", id: 2 });
    expect(new URLSearchParams(sau).get("pv")).toBe("line:1");
    expect(new URLSearchParams(sau).get(KHOA_XEM)).toBe("machine:2");
  });

  it("khứ hồi trộn → đọc lại cho đúng ngăn", () => {
    const n: NganNhungMo = { loai: "station", id: 33 };
    expect(docXemTuQuery(tronXemVaoQuery("pv=line:1", n))).toEqual(n);
  });

  /* ═════════════════════════════════════════════════════════════════════════ */
  /* ★★★ G2 (Đợt 10 mục 2) — CẤP `may` VÀ NGĂN NHÚNG SỐNG CHUNG ĐƯỢC          */
  /* ═════════════════════════════════════════════════════════════════════════ */
  /*
   * §11e.3 đo được: `CapPhamVi` đã có `"may"` và **cả 5 cấp đều có xử lý thật**
   * (`phamViCanh.ts:67` lọc theo `machineId`, `:82` không mờ hàng xóm ở cấp máy,
   * `:204` siết camera lại gần). Nền định tuyến ĐÃ CÓ — việc còn lại là **panel
   * + nội dung** cho cấp đó, và đó chính là ngăn nhúng này.
   *
   * Ca dưới ghim điều kiện tiên quyết: hai trạng thái đó phải cùng tồn tại trong
   * MỘT url. Nếu `xem=` nuốt `pv=machine:42`, "Cell twin" mất khung camera ngay
   * lúc người dùng mở chi tiết — tức mục 2 và mục 5 phá nhau.
   */
  it("★★★ G2: `pv=machine:42` (Cell twin) + `xem=machine:42` cùng tồn tại", () => {
    const sau = tronXemVaoQuery("pv=machine:42&chon=machine:42&cam=1,2,3,4,5", {
      loai: "machine",
      id: 42,
    });
    const sp = new URLSearchParams(sau);
    // Khung cảnh cấp máy CÒN NGUYÊN...
    expect(sp.get("pv")).toBe("machine:42");
    expect(sp.get("cam")).toBe("1,2,3,4,5");
    // ...và ngăn chi tiết CŨNG mở:
    expect(docXemTuQuery(sau)).toEqual({ loai: "machine", id: 42 });
  });

  it("★★★ G2: ĐÓNG ngăn KHÔNG kéo người dùng ra khỏi cấp `may`", () => {
    // Nút "Quay lại 3D" phải trả về đúng cảnh cấp máy đang xem, không phải cảnh
    // mặc định — nếu `pv` mất ở đây, "quay lại" thành "đi chỗ khác".
    const sau = tronXemVaoQuery("pv=machine:42&cam=1,2,3,4,5&xem=machine:42", null);
    const sp = new URLSearchParams(sau);
    expect(sp.get("pv")).toBe("machine:42");
    expect(sp.get("cam")).toBe("1,2,3,4,5");
    expect(sp.has(KHOA_XEM)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* nhungChoHref — SUY TỪ CHÍNH `href`, KHÔNG DỰNG NGUỒN SỰ THẬT THỨ HAI       */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("nhungChoHref", () => {
  it("★ khớp đúng ba đích CÓ thân nhúng", () => {
    expect(nhungChoHref("/machine/42")).toEqual({ loai: "machine", id: 42 });
    expect(nhungChoHref("/robot/7")).toEqual({ loai: "robot", id: 7 });
    expect(nhungChoHref("/station-analysis/5")).toEqual({ loai: "station", id: 5 });
  });

  it("★★★ KHÔNG khớp các đích CHƯA nhúng được — và đó là cố ý", () => {
    // Màn danh sách toàn hệ, không thuộc một máy:
    expect(nhungChoHref("/device-monitor?tab=health")).toBeNull();
    // Màn có bộ lọc/khoảng ngày riêng:
    expect(nhungChoHref("/history?machineId=42")).toBeNull();
    expect(nhungChoHref("/traceability?machineId=42")).toBeNull();
    // ★ Màn RA LỆNH OT — nhúng cạnh cảnh 3D là mời gọi bấm nhầm:
    expect(nhungChoHref("/control-plane?machineId=42")).toBeNull();
    expect(nhungChoHref("/command-console?robotId=7")).toBeNull();
    // Màn cấp line / xưởng / tập đoàn:
    expect(nhungChoHref("/wip-dashboard?lineId=1")).toBeNull();
    expect(nhungChoHref("/oee-dashboard?lineId=1")).toBeNull();
    expect(nhungChoHref("/production-dashboard?workshopId=1")).toBeNull();
    expect(nhungChoHref("/andon")).toBeNull();
    expect(nhungChoHref("/corporate-dashboard?factoryId=1")).toBeNull();
    expect(nhungChoHref("/twin-studio")).toBeNull();
  });

  it("cắt query và fragment trước khi phân tích", () => {
    expect(nhungChoHref("/machine/42?tab=alarms")).toEqual({ loai: "machine", id: 42 });
    expect(nhungChoHref("/robot/7#joints")).toEqual({ loai: "robot", id: 7 });
  });

  it("id không phải nguyên dương ⇒ null (không nhúng một NaN)", () => {
    expect(nhungChoHref("/machine/abc")).toBeNull();
    expect(nhungChoHref("/machine/0")).toBeNull();
    expect(nhungChoHref("/machine/-3")).toBeNull();
    expect(nhungChoHref("/machine/1.5")).toBeNull();
    // ca dương cùng khuôn:
    expect(nhungChoHref("/machine/3")).toEqual({ loai: "machine", id: 3 });
  });

  it("số đoạn khác 2 ⇒ null", () => {
    expect(nhungChoHref("/machine")).toBeNull();
    expect(nhungChoHref("/machine/42/alarms")).toBeNull();
    expect(nhungChoHref("/")).toBeNull();
    expect(nhungChoHref("")).toBeNull();
  });

  it("tiền tố lạ dù đúng hình dạng vẫn null", () => {
    expect(nhungChoHref("/machines/42")).toBeNull();
    expect(nhungChoHref("/robots/7")).toBeNull();
    expect(nhungChoHref("/station/5")).toBeNull();
  });

  it("`nhungDuoc` là đường tắt đọc dễ, KHÔNG phải phép tính thứ hai", () => {
    // Cả hai phải nhất trí trên cùng một tập đầu vào — nếu ai đó cài `nhungDuoc`
    // bằng một danh sách riêng, ca này bắt được ngay khi hai bên lệch.
    const mau = [
      "/machine/42",
      "/robot/7",
      "/station-analysis/5",
      "/control-plane?machineId=42",
      "/andon",
      "/machine/abc",
    ];
    for (const h of mau) {
      expect(nhungDuoc(h)).toBe(nhungChoHref(h) !== null);
    }
    // và tập đó CÓ cả hai kết cục (không phải toàn true hay toàn false):
    expect(mau.filter((h) => nhungDuoc(h))).toHaveLength(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* hrefGocCuaNgan — NGHỊCH ĐẢO THẬT                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("hrefGocCuaNgan", () => {
  it("★★★ khứ hồi: nhungChoHref(hrefGocCuaNgan(n)) === n cho MỌI loại", () => {
    const ds: NganNhungMo[] = [
      { loai: "machine", id: 42 },
      { loai: "robot", id: 7 },
      { loai: "station", id: 5 },
    ];
    for (const n of ds) {
      // Nếu nút "mở màn đầy đủ" trỏ khác nội dung đang hiện, ca này đỏ — và đó
      // là chế độ hỏng CÂM duy nhất mà nút lối-thoát-phụ có thể mắc.
      expect(nhungChoHref(hrefGocCuaNgan(n))).toEqual(n);
    }
  });

  it("sinh đúng ba đường dẫn thật trong App.tsx", () => {
    expect(hrefGocCuaNgan({ loai: "machine", id: 42 })).toBe("/machine/42");
    expect(hrefGocCuaNgan({ loai: "robot", id: 7 })).toBe("/robot/7");
    expect(hrefGocCuaNgan({ loai: "station", id: 5 })).toBe("/station-analysis/5");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Tiêu đề                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("tiêu đề ngăn", () => {
  const LOAI: LoaiNhung[] = ["machine", "robot", "station"];

  it("mỗi loại có khoá i18n RIÊNG (không loại nào dùng chung nhãn)", () => {
    const khoa = LOAI.map(khoaTieuDeNhung);
    expect(new Set(khoa).size).toBe(LOAI.length);
    for (const k of khoa) expect(k).toMatch(/^twin3d\.vanHanh\.nhung\./);
  });

  it("mỗi loại có nhãn dự phòng KHÁC RỖNG và khác nhau", () => {
    const nhan = LOAI.map(nhanDuPhongNhung);
    expect(new Set(nhan).size).toBe(LOAI.length);
    for (const n of nhan) expect(n.trim().length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 24 VIỆC 3 (L-5) — VÌ SAO NGĂN KHÔNG MỞ ĐƯỢC                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("Đợt 24 L-5 — lyDoNganNhung: ba kết cục, ba câu KHÁC NHAU", () => {
  const MAY = { loai: "machine", id: 42 } as const;

  it("không có ngăn ⇒ `null` (không phải một lý do)", () => {
    expect(lyDoNganNhung(null, { idTrongTam: [], phamViRong: false })).toBeNull();
  });

  it("★ CHIỀU (+) — id NẰM TRONG tập đang xem ⇒ `mo`", () => {
    expect(lyDoNganNhung(MAY, { idTrongTam: [1, 42, 7], phamViRong: false })).toBe("mo");
  });

  it("★★★ id VẮNG MẶT, người dùng CÓ phạm vi ⇒ `ngoaiPhamVi`", () => {
    expect(lyDoNganNhung(MAY, { idTrongTam: [1, 7], phamViRong: false })).toBe("ngoaiPhamVi");
  });

  it("★★★ phạm vi RỖNG ⇒ `thieuQuyen`, KHÔNG phải `ngoaiPhamVi`", () => {
    // ⚠ Đây là ô ghim THỨ TỰ XÉT. Với `phamViRong = true` tập đang xem luôn
    //   rỗng, nên một phép xét sai thứ tự vẫn cho `ngoaiPhamVi` — câu ấy bảo
    //   người dùng đi ĐỔI PHẠM VI, việc vô ích khi họ chưa được gán nhà máy.
    expect(lyDoNganNhung(MAY, { idTrongTam: [], phamViRong: true })).toBe("thieuQuyen");
  });

  it("★★★ ĐỐI CHỨNG — `thieuQuyen` không nuốt ca hợp lệ: phạm vi rỗng mà id CÓ mặt vẫn `mo`", () => {
    // Chống "vá quá tay": nếu cài đặt xét `phamViRong` TRƯỚC phép kiểm id, một
    // ngăn hợp lệ sẽ bị chặn. Hình dạng này hiếm nhưng phải giữ đúng chiều.
    expect(lyDoNganNhung(MAY, { idTrongTam: [42], phamViRong: true })).toBe("mo");
  });

  it("★★★ `dangTai` ⇒ `mo` — KHÔNG nháy câu lỗi trong lượt tải đầu", () => {
    // Thiếu ô này thì MỌI ngăn hợp lệ hiện một câu lỗi một nhịp rồi mới mở —
    // biến bản vá thành lỗi mới cho mọi người dùng.
    expect(lyDoNganNhung(MAY, { idTrongTam: [], phamViRong: false, dangTai: true })).toBe("mo");
    expect(lyDoNganNhung(MAY, { idTrongTam: [], phamViRong: true, dangTai: true })).toBe("mo");
  });

  it("★ mỗi lý do có khoá i18n RIÊNG và câu dự phòng KHÁC RỖNG, khác nhau", () => {
    const ds = ["ngoaiPhamVi", "thieuQuyen"] as const;
    const cau = ds.map(cauChoLyDoNgan);
    expect(new Set(cau.map((c) => c.khoa)).size).toBe(ds.length);
    expect(new Set(cau.map((c) => c.duPhong)).size).toBe(ds.length);
    for (const c of cau) {
      expect(c.khoa).toMatch(/^twin3d\.vanHanh\.nhung\./);
      expect(c.duPhong.trim().length).toBeGreaterThan(0);
    }
  });
});
