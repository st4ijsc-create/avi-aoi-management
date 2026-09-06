/**
 * Test của `duongDanTwin.ts` — deep-link §9.4.
 *
 * ★ Trục canh chính KHÔNG phải "ghi rồi đọc lại có bằng nhau không" (điều đó
 *   đúng cả khi cả hai chiều cùng sai một kiểu — bài học BG-127). Trục chính là
 *   **ĐẦU VÀO RÁC**: URL đến từ chat, từ email, từ bản ghi cũ. Mỗi hàm đọc phải
 *   trả một giá trị DÙNG ĐƯỢC với rác, và phải trả `null` chứ không phải một
 *   giá trị trông-hợp-lệ-mà-bịa.
 */
import { describe, it, expect } from "vitest";
import {
  LOP_HOP_LE,
  docCamera,
  docLop,
  docPhamVi,
  docThoiGian,
  docTrangThaiUrl,
  docVatTheChon,
  ghiCamera,
  ghiLop,
  ghiPhamVi,
  ghiTrangThaiUrl,
  ghiVatTheChon,
  kieuGhiLichSu,
  phamViChoVatThe,
  tronTrangThaiUrl,
} from "./duongDanTwin";

describe("docPhamVi", () => {
  it("đọc đúng cả năm cấp", () => {
    expect(docPhamVi("tapdoan")).toEqual({ cap: "tapDoan", id: null });
    expect(docPhamVi("factory:4")).toEqual({ cap: "nhaMay", id: 4 });
    expect(docPhamVi("tang:1")).toEqual({ cap: "tang", id: 1 });
    expect(docPhamVi("line:1")).toEqual({ cap: "line", id: 1 });
    expect(docPhamVi("machine:42")).toEqual({ cap: "may", id: 42 });
  });

  it("★ id KHÔNG hợp lệ ⇒ null, KHÔNG rơi về một id bịa", () => {
    // Đây là điểm quan trọng nhất: `line:abc` phải rỗng, không được thành line 0
    // hay line 1 — im lặng chọn một line bất kỳ là nói dối về thứ người dùng gửi.
    expect(docPhamVi("line:abc")).toBeNull();
    expect(docPhamVi("line:0")).toBeNull();
    expect(docPhamVi("line:-2")).toBeNull();
    expect(docPhamVi("line:1.5")).toBeNull();
    expect(docPhamVi("line:1e3")).toBeNull();
    expect(docPhamVi("line: 1")).toBeNull();
  });

  it("thiếu id (trừ tapdoan) là HỎNG, không phải 'line nào cũng được'", () => {
    expect(docPhamVi("line")).toBeNull();
    expect(docPhamVi("machine")).toBeNull();
    // Ngược lại: tập đoàn KHÔNG được mang id.
    expect(docPhamVi("tapdoan:5")).toBeNull();
  });

  it("tiền tố lạ, chuỗi rỗng, null/undefined ⇒ null", () => {
    expect(docPhamVi("robot:1")).toBeNull();
    expect(docPhamVi("")).toBeNull();
    expect(docPhamVi("   ")).toBeNull();
    expect(docPhamVi(null)).toBeNull();
    expect(docPhamVi(undefined)).toBeNull();
    expect(docPhamVi("line:1:2")).toBeNull();
  });

  it("khứ hồi ghi→đọc cho lại chính nó", () => {
    for (const pv of [
      { cap: "tapDoan", id: null },
      { cap: "nhaMay", id: 4 },
      { cap: "tang", id: 1 },
      { cap: "line", id: 3 },
      { cap: "may", id: 42 },
    ] as const) {
      expect(docPhamVi(ghiPhamVi(pv))).toEqual(pv);
    }
  });
});

describe("docVatTheChon", () => {
  it("đọc đúng mọi loại hợp lệ", () => {
    expect(docVatTheChon("machine:42")).toEqual({ loai: "machine", id: 42 });
    expect(docVatTheChon("station:5")).toEqual({ loai: "station", id: 5 });
    expect(docVatTheChon("line:1")).toEqual({ loai: "line", id: 1 });
    expect(docVatTheChon("workshop:2")).toEqual({ loai: "workshop", id: 2 });
    expect(docVatTheChon("factory:4")).toEqual({ loai: "factory", id: 4 });
  });

  it("loại lạ hoặc id hỏng ⇒ null", () => {
    expect(docVatTheChon("robot:1")).toBeNull();
    expect(docVatTheChon("machine:0")).toBeNull();
    expect(docVatTheChon("machine:abc")).toBeNull();
    expect(docVatTheChon("machine")).toBeNull();
    expect(docVatTheChon(null)).toBeNull();
  });

  it("khứ hồi", () => {
    const v = { loai: "machine", id: 42 } as const;
    expect(docVatTheChon(ghiVatTheChon(v))).toEqual(v);
  });
});

describe("docCamera", () => {
  it("đúng năm số ⇒ đọc được, kể cả số âm và số thập phân", () => {
    expect(docCamera("45.2,18,-30.5,0.8,120")).toEqual({
      x: 45.2,
      y: 18,
      z: -30.5,
      mucX: 0.8,
      mucZ: 120,
    });
  });

  it("★ TẤT CẢ HOẶC KHÔNG — thiếu/thừa thành phần ⇒ null", () => {
    // Lấp chỗ trống bằng 0 đặt camera vào gốc toạ độ (thường là dưới lòng đất).
    expect(docCamera("1,2,3,4")).toBeNull();
    expect(docCamera("1,2,3,4,5,6")).toBeNull();
    expect(docCamera("")).toBeNull();
  });

  it("★★★ NaN / Infinity BỊ CHẶN — chúng cho ma trận NaN và cảnh TRẮNG XOÁ không lỗi", () => {
    expect(docCamera("NaN,2,3,4,5")).toBeNull();
    expect(docCamera("Infinity,2,3,4,5")).toBeNull();
    expect(docCamera("-Infinity,2,3,4,5")).toBeNull();
    expect(docCamera("abc,2,3,4,5")).toBeNull();
    expect(docCamera("1,,3,4,5")).toBeNull();
  });

  it("ghi làm tròn 2 chữ số và khứ hồi được", () => {
    expect(ghiCamera({ x: 1.23456, y: 2, z: -3.5, mucX: 0, mucZ: 0 })).toBe("1.23,2,-3.5,0,0");
    const c = { x: 45.2, y: 18, z: -30.5, mucX: 0.8, mucZ: 120 };
    expect(docCamera(ghiCamera(c))).toEqual(c);
  });
});

describe("docLop — ★ BA ca, không phải hai", () => {
  it("vắng ⇒ null (dùng mặc định)", () => {
    expect(docLop(null)).toBeNull();
    expect(docLop(undefined)).toBeNull();
  });

  it("★ rỗng ⇒ [] (người dùng TẮT HẾT — phải tôn trọng, không rơi về mặc định)", () => {
    // Gộp ca này vào ca "vắng" làm trạng thái "tắt hết mọi lớp" KHÔNG chia sẻ
    // được qua link, vì nó luôn bị hiểu thành "dùng mặc định".
    expect(docLop("")).toEqual([]);
    expect(docLop("   ")).toEqual([]);
  });

  it("giữ phần hợp lệ, bỏ phần rác, khử trùng lặp", () => {
    expect(docLop("wip,rác,nhan")).toEqual(["wip", "nhan"]);
    expect(docLop("wip,wip")).toEqual(["wip"]);
    expect(docLop("<script>")).toEqual([]);
  });

  it("ghi TẤT ĐỊNH theo thứ tự LOP_HOP_LE, không theo thứ tự người gọi truyền", () => {
    expect(ghiLop(["wip", "nhan"])).toBe(ghiLop(["nhan", "wip"]));
    expect(ghiLop(["khong-ton-tai"])).toBe("");
  });

  it("mọi tên trong LOP_HOP_LE đều khứ hồi được", () => {
    expect(docLop(ghiLop(LOP_HOP_LE))).toEqual([...LOP_HOP_LE]);
  });
});

describe("docThoiGian", () => {
  it("đọc ISO-8601", () => {
    expect(docThoiGian("2026-09-06T14:30:00.000Z")).toBe(Date.parse("2026-09-06T14:30:00.000Z"));
  });

  it("rác / rỗng ⇒ null (chế độ LIVE)", () => {
    expect(docThoiGian("hôm qua")).toBeNull();
    expect(docThoiGian("")).toBeNull();
    expect(docThoiGian(null)).toBeNull();
  });
});

describe("docTrangThaiUrl / ghiTrangThaiUrl", () => {
  it("đọc đủ năm ô từ một query string thật", () => {
    const tt = docTrangThaiUrl(
      "?pv=line:1&chon=machine:42&cam=45.2,18,-30.5,0.8,120&lop=wip,nhan&tg=2026-09-06T14:30:00.000Z",
    );
    expect(tt.phamVi).toEqual({ cap: "line", id: 1 });
    expect(tt.chon).toEqual({ loai: "machine", id: 42 });
    expect(tt.cam).toEqual({ x: 45.2, y: 18, z: -30.5, mucX: 0.8, mucZ: 120 });
    // `docLop` giữ THỨ TỰ TRONG URL (nó chỉ lọc); chuẩn hoá thứ tự là việc của
    // `ghiLop`. Hai chiều cố ý bất đối xứng ở điểm này — khứ hồi vẫn đúng vì
    // `ghiLop` là chiều duy nhất sinh chuỗi.
    expect(tt.lop).toEqual(["wip", "nhan"]);
    expect(tt.tg).toBe(Date.parse("2026-09-06T14:30:00.000Z"));
  });

  it("chấp nhận cả dạng có `?` lẫn không", () => {
    expect(docTrangThaiUrl("pv=line:1").phamVi).toEqual({ cap: "line", id: 1 });
    expect(docTrangThaiUrl("?pv=line:1").phamVi).toEqual({ cap: "line", id: 1 });
  });

  it("★★★ Ô HỎNG ĐỘC LẬP NHAU — cam rác KHÔNG làm mất pv hợp lệ đi cùng", () => {
    // Người gửi link vẫn tới đúng phạm vi, chỉ mất góc nhìn.
    const tt = docTrangThaiUrl("?pv=line:1&cam=RÁC&chon=machine:9");
    expect(tt.phamVi).toEqual({ cap: "line", id: 1 });
    expect(tt.chon).toEqual({ loai: "machine", id: 9 });
    expect(tt.cam).toBeNull();
  });

  it("URL rỗng ⇒ mọi ô null, KHÔNG ném", () => {
    expect(docTrangThaiUrl("")).toEqual({
      phamVi: null,
      chon: null,
      cam: null,
      lop: null,
      tg: null,
    });
  });

  it("ô null bị BỎ HẲN khỏi chuỗi ghi (trừ lop rỗng — ba ca của docLop)", () => {
    expect(ghiTrangThaiUrl({ phamVi: { cap: "line", id: 1 } })).toBe("pv=line%3A1");
    expect(ghiTrangThaiUrl({})).toBe("");
    // `lop: []` PHẢI ghi ra để giữ được ca "người dùng tắt hết".
    expect(ghiTrangThaiUrl({ lop: [] })).toBe("lop=");
    expect(docTrangThaiUrl(ghiTrangThaiUrl({ lop: [] })).lop).toEqual([]);
  });

  it("khứ hồi đầy đủ", () => {
    const goc = {
      phamVi: { cap: "line", id: 1 } as const,
      chon: { loai: "machine", id: 42 } as const,
      cam: { x: 45.2, y: 18, z: -30.5, mucX: 0.8, mucZ: 120 },
      lop: ["nhan", "wip"],
      tg: Date.parse("2026-09-06T14:30:00.000Z"),
    };
    expect(docTrangThaiUrl(ghiTrangThaiUrl(goc))).toEqual(goc);
  });
});

describe("tronTrangThaiUrl", () => {
  it("★ GIỮ tham số lạ — /twin không sở hữu độc quyền query string", () => {
    // `useFilterBar()` và các công cụ theo dõi (`utm_*`) cũng ghi vào đó.
    const ra = tronTrangThaiUrl("utm_source=chat&pv=line:1", { chon: { loai: "machine", id: 7 } });
    const sp = new URLSearchParams(ra);
    expect(sp.get("utm_source")).toBe("chat");
    expect(sp.get("pv")).toBe("line:1");
    expect(sp.get("chon")).toBe("machine:7");
  });

  it("truyền null để XOÁ một khoá (bỏ chọn)", () => {
    const ra = tronTrangThaiUrl("pv=line:1&chon=machine:7", { chon: null });
    expect(new URLSearchParams(ra).get("chon")).toBeNull();
    expect(new URLSearchParams(ra).get("pv")).toBe("line:1");
  });

  it("khoá KHÔNG có mặt trong `thayDoi` thì không bị đụng tới", () => {
    const ra = tronTrangThaiUrl("pv=line:1&chon=machine:7", { cam: null });
    expect(new URLSearchParams(ra).get("chon")).toBe("machine:7");
  });
});

describe("kieuGhiLichSu — §9.4", () => {
  it("★ camera/lớp/thời gian ⇒ replace (xoay chuột sinh hàng trăm sự kiện mỗi giây)", () => {
    expect(kieuGhiLichSu({ cam: { x: 0, y: 0, z: 0, mucX: 0, mucZ: 0 } })).toBe("replace");
    expect(kieuGhiLichSu({ lop: ["wip"] })).toBe("replace");
    expect(kieuGhiLichSu({ tg: 1 })).toBe("replace");
    expect(kieuGhiLichSu({})).toBe("replace");
  });

  it("★ đổi phạm vi / đổi vật thể chọn ⇒ push (nút Back quay lại cấp trước)", () => {
    expect(kieuGhiLichSu({ phamVi: { cap: "line", id: 1 } })).toBe("push");
    expect(kieuGhiLichSu({ chon: { loai: "machine", id: 1 } })).toBe("push");
    // Kể cả khi giá trị là null (bỏ chọn) — đó vẫn là một bước điều hướng.
    expect(kieuGhiLichSu({ chon: null })).toBe("push");
  });
});

describe("phamViChoVatThe", () => {
  it("máy / line / nhà máy có cấp phạm vi riêng", () => {
    expect(phamViChoVatThe({ loai: "machine", id: 42 })).toEqual({ cap: "may", id: 42 });
    expect(phamViChoVatThe({ loai: "line", id: 1 })).toEqual({ cap: "line", id: 1 });
    expect(phamViChoVatThe({ loai: "factory", id: 4 })).toEqual({ cap: "nhaMay", id: 4 });
  });

  it("trạm/xưởng KHÔNG có cấp riêng (§10C.2 chỉ có 5 cấp) ⇒ về cấp tầng", () => {
    expect(phamViChoVatThe({ loai: "station", id: 5 })).toEqual({ cap: "tang", id: null });
    expect(phamViChoVatThe({ loai: "workshop", id: 2 })).toEqual({ cap: "tang", id: null });
  });
});
