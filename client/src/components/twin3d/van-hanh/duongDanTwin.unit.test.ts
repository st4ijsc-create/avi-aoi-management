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
  PANEL_THU_DUOC,
  docCamera,
  docLop,
  docPhamVi,
  docThoiGian,
  docThu,
  docTrangThaiUrl,
  docVatTheChon,
  ghiCamera,
  ghiLop,
  ghiPhamVi,
  ghiThu,
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
      // ★ `nap` là một OBJECT ba ô null, không phải `null` — ba ô này luôn có
      //   mặt trong hình dạng trả về để tầng gọi không phải kiểm `?.` ở ba chỗ.
      nap: { nm: null, toa: null, tang: null },
      // ★ `thu: []` = mở cả hai panel. Không có ca `null` riêng — xem `docThu`.
      thu: [],
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
      nap: { nm: 18, toa: 4, tang: 9 },
      thu: ["trai"],
    };
    expect(docTrangThaiUrl(ghiTrangThaiUrl(goc))).toEqual(goc);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 10 LÔ F — BA Ô NẠP (`nm` / `toa` / `tang`), mục F1                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ lựa chọn NẠP vào URL — F1: 'chia sẻ / tải lại được'", () => {
  it("đọc đủ ba ô", () => {
    const tt = docTrangThaiUrl("?nm=18&toa=4&tang=9");
    expect(tt.nap).toEqual({ nm: 18, toa: 4, tang: 9 });
  });

  it("★ ba ô ĐỘC LẬP — `toa` rác KHÔNG làm mất `nm` hợp lệ đi cùng", () => {
    const tt = docTrangThaiUrl("?nm=18&toa=abc&tang=9");
    expect(tt.nap).toEqual({ nm: 18, toa: null, tang: 9 });
  });

  it("★ id âm / 0 / thập phân ⇒ null, KHÔNG sửa thành một id có thể tồn tại", () => {
    // Sửa `-1` thành `1` sẽ lặng lẽ trỏ vào một NHÀ MÁY KHÁC HẲN.
    expect(docTrangThaiUrl("?nm=-1&toa=0&tang=1.5").nap).toEqual({
      nm: null,
      toa: null,
      tang: null,
    });
  });

  it("★ `nap` KHÔNG đụng tới `pv` — hai trục độc lập", () => {
    const tt = docTrangThaiUrl("?pv=line:1&nm=18&tang=9");
    expect(tt.phamVi).toEqual({ cap: "line", id: 1 });
    expect(tt.nap.tang).toBe(9);
  });

  it("★★★ ĐỔI NHÀ MÁY XOÁ `toa`+`tang` CỦA NHÀ MÁY CŨ — URL không được tự mâu thuẫn", () => {
    const ra = tronTrangThaiUrl("nm=1&toa=3&tang=7", { nap: { nm: 18 } });
    const sp = new URLSearchParams(ra);
    expect(sp.get("nm")).toBe("18");
    expect(sp.get("toa")).toBeNull();
    expect(sp.get("tang")).toBeNull();
  });

  it("★ đổi TOÀ xoá `tang` nhưng GIỮ `nm`", () => {
    const sp = new URLSearchParams(
      tronTrangThaiUrl("nm=1&toa=3&tang=7", { nap: { toa: 4 } }),
    );
    expect(sp.get("nm")).toBe("1");
    expect(sp.get("toa")).toBe("4");
    expect(sp.get("tang")).toBeNull();
  });

  it("★ đặt CẢ BA cùng lúc (khôi phục từ link) giữ nguyên cả ba", () => {
    const sp = new URLSearchParams(
      tronTrangThaiUrl("", { nap: { nm: 18, toa: 4, tang: 9 } }),
    );
    expect([sp.get("nm"), sp.get("toa"), sp.get("tang")]).toEqual(["18", "4", "9"]);
  });

  it("★ đổi `tang` một mình KHÔNG đụng `nm`/`toa`", () => {
    const sp = new URLSearchParams(
      tronTrangThaiUrl("nm=1&toa=3&tang=7", { nap: { tang: 8 } }),
    );
    expect([sp.get("nm"), sp.get("toa"), sp.get("tang")]).toEqual(["1", "3", "8"]);
  });

  it("★ đổi lượt NẠP ⇒ push (nút Back quay lại tầng vừa xem)", () => {
    expect(kieuGhiLichSu({ nap: { nm: 18, toa: null, tang: null } })).toBe("push");
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 10 LÔ F — `?thu=` THU PANEL BÊN, mục F4                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ docThu / ghiThu — F4: trả diện tích cho 3D", () => {
  it("vắng hoặc rỗng ⇒ [] (mở cả hai panel)", () => {
    expect(docThu(null)).toEqual([]);
    expect(docThu("")).toEqual([]);
    expect(docThu("   ")).toEqual([]);
  });

  it("đọc đúng cả hai tên", () => {
    expect(docThu("trai,phai")).toEqual(["trai", "phai"]);
    expect(docThu("phai")).toEqual(["phai"]);
  });

  it("★ tên lạ bị BỎ nhưng KHÔNG làm hỏng cả ô (cùng luật docLop)", () => {
    expect(docThu("trai,giua,<script>")).toEqual(["trai"]);
  });

  it("khử trùng lặp", () => {
    expect(docThu("trai,trai,trai")).toEqual(["trai"]);
  });

  it("★ ghi TẤT ĐỊNH theo PANEL_THU_DUOC, không theo thứ tự người gọi truyền", () => {
    expect(ghiThu(["phai", "trai"])).toBe("trai,phai");
    expect(ghiThu(["trai", "phai"])).toBe("trai,phai");
  });

  it("mọi tên trong PANEL_THU_DUOC đều khứ hồi được", () => {
    expect(docThu(ghiThu(PANEL_THU_DUOC))).toEqual([...PANEL_THU_DUOC]);
  });

  /* ═════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 11 LÔ J (§11 #16) — BẢNG KPI DÙNG CHUNG KHOÁ `thu=`, G40
   * ═════════════════════════════════════════════════════════════════════════ */

  it("★ `kpi` là panel thu được, và MẶC ĐỊNH LÀ MỞ (vắng mặt ⇒ không nằm trong `thu`)", () => {
    // Yêu cầu #6 đòi số liệu ĐỌC ĐƯỢC trên cảnh 3D ⇒ mặc định phải HIỆN.
    // Nếu ai đó lật ngữ nghĩa thành "có mặt = mở", test này đỏ.
    expect(docThu("")).not.toContain("kpi");
    expect(docThu(null)).not.toContain("kpi");
    expect(docThu("kpi")).toEqual(["kpi"]);
  });

  /* ═════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 19 LÔ X (§11 #30/#35) — NGĂN MÔ PHỎNG CŨNG DÙNG CHUNG `thu=`
   * ═════════════════════════════════════════════════════════════════════════ */

  it("★★★ G40/G67 — `moPhong` PHẢI nằm trong danh sách đóng, nếu không URL bị NUỐT CÂM", () => {
    // Danh sách ĐÓNG ở cả hai chiều: quên thêm tên thì `?thu=moPhong` ghi ra
    // đúng nhưng đọc lại ra RỖNG — ngăn tự mở lại sau F5, không lỗi nào nổ.
    // Đây là tầng ĐẦU TIÊN một tính năng có thể chết ở (G67), nên nó có ô riêng.
    expect(PANEL_THU_DUOC).toContain("moPhong");
    expect(docThu("moPhong")).toEqual(["moPhong"]);
    expect(docThu(ghiThu(["moPhong"]))).toEqual(["moPhong"]);
    // Và nó KHÔNG đá nhau với `kpi` — hai panel nổi cùng sống trên một khoá.
    expect(docThu("kpi,moPhong")).toEqual(["kpi", "moPhong"]);
    expect(ghiThu(["moPhong", "kpi"])).toBe("kpi,moPhong");
  });

  it("★ G40 — thu `kpi` KHÔNG đè `pv`/`chon`/`cam`/`nm` của người ghi khác", () => {
    // Bốn khoá kia có bộ ghi riêng. Một lượt ghi `thu` phải đi qua
    // `tronTrangThaiUrl` và giữ NGUYÊN VĂN mọi khoá nó không sở hữu.
    const goc = "pv=line:1&chon=machine:42&cam=1,2,3,4,5&nm=7&toa=24&tang=28&xem=canhbao";
    const sp = new URLSearchParams(tronTrangThaiUrl(goc, { thu: ["kpi"] }));
    expect(sp.get("thu")).toBe("kpi");
    expect(sp.get("pv")).toBe("line:1");
    expect(sp.get("chon")).toBe("machine:42");
    expect(sp.get("cam")).toBe("1,2,3,4,5");
    expect(sp.get("nm")).toBe("7");
    expect(sp.get("toa")).toBe("24");
    expect(sp.get("tang")).toBe("28");
    // `?xem=` là khoá của lô G (`nhungTaiCho`) — người ghi KHÁC, phải sống sót.
    expect(sp.get("xem")).toBe("canhbao");
  });

  it("★ `kpi` sống chung với `trai`/`phai` trong CÙNG một khoá, thứ tự tất định", () => {
    expect(ghiThu(["kpi", "phai", "trai"])).toBe("trai,phai,kpi");
    // ★ `docThu` giữ THỨ TỰ ĐẦU VÀO (nó duyệt và nối), còn `ghiThu` CHUẨN HOÁ
    //   về thứ tự `PANEL_THU_DUOC`. Hai hàm cố ý bất đối xứng: đọc phải khoan
    //   dung với mọi URL người dùng dán vào, ghi phải tất định để so chuỗi rẻ.
    expect(docThu("kpi,trai")).toEqual(["kpi", "trai"]);
    expect(ghiThu(docThu("kpi,trai"))).toBe("trai,kpi");
    // ...và ba panel độc lập: thu KPI không thu panel bên nào.
    const sp = new URLSearchParams(tronTrangThaiUrl("thu=trai", { thu: ["trai", "kpi"] }));
    expect(docThu(sp.get("thu"))).toEqual(["trai", "kpi"]);
  });

  it("★ `thu: []` KHÔNG ghi ra URL — 'mở cả hai' là mặc định, ghi ra chỉ làm nhiễu", () => {
    expect(ghiTrangThaiUrl({ thu: [] })).toBe("");
    expect(ghiTrangThaiUrl({ thu: ["phai"] })).toBe("thu=phai");
  });

  it("★ trộn: truyền [] để XOÁ khoá, giữ nguyên mọi khoá khác", () => {
    const sp = new URLSearchParams(tronTrangThaiUrl("pv=line:1&thu=trai", { thu: [] }));
    expect(sp.get("thu")).toBeNull();
    expect(sp.get("pv")).toBe("line:1");
  });

  it("★ thu/mở panel ⇒ REPLACE, không push (không phải 'đi tới chỗ khác')", () => {
    expect(kieuGhiLichSu({ thu: ["trai"] })).toBe("replace");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ LÔ F × LÔ G — HAI CHỦ SỞ HỮU CỦA CÙNG MỘT QUERY STRING                  */
/* ═══════════════════════════════════════════════════════════════════════════ */
/*
 * Lô F ghi `nm/toa/tang/thu` qua `tronTrangThaiUrl`; lô G ghi `xem` qua
 * `tronXemVaoQuery` (`nhungTaiCho.ts`). Hai hàm ĐỘC LẬP, cùng ghi lên một chuỗi.
 *
 * ★★★ VÌ SAO TEST NÀY KHÔNG THỪA DÙ ĐÃ CÓ "GIỮ THAM SỐ LẠ" (`utm_source`).
 * `utm_source` là tham số **không ai trong màn này ghi**. `xem=` thì khác hẳn:
 * nó có một hàm ghi RIÊNG, chạy trên cùng màn, cùng lượt tương tác. Test tham số
 * lạ chứng minh "không xoá thứ không ai đụng" — nó KHÔNG chứng minh "hai người
 * cùng viết không giẫm lên nhau". Đó là hai mệnh đề khác nhau, và chỉ mệnh đề
 * thứ hai mới là thứ hỏng khi ai đó đổi `tronTrangThaiUrl` sang `ghiTrangThaiUrl`
 * (dựng lại từ đầu) — một lượt sửa "cho gọn" hoàn toàn có thật.
 *
 * ⚠ Đo được lúc viết: lô G nằm ở commit `a3eb2919`, lô F nằm CÙNG commit đó —
 *   nên không lần chạy CI nào từng thấy hai lô ở trạng thái rời nhau. Cổng xanh
 *   suốt mà chưa bao giờ đo đúng chỗ giao (họ G5).
 */
describe("★★★ lô F (nap/thu) × lô G (xem) — cùng tồn tại trên MỘT url", () => {
  it("★★★ mở panel `?xem=` KHÔNG xoá lựa chọn nạp — chiều lô G ghi", async () => {
    const { tronXemVaoQuery } = await import("./nhungTaiCho");
    const sau = tronXemVaoQuery("nm=18&toa=4&tang=9&thu=trai", { loai: "machine", id: 42 });
    const sp = new URLSearchParams(sau);
    expect(sp.get("xem")).toBe("machine:42");
    // Đây là mệnh đề chính: ba ô nạp SỐNG SÓT qua lượt ghi của lô G.
    expect([sp.get("nm"), sp.get("toa"), sp.get("tang")]).toEqual(["18", "4", "9"]);
    expect(sp.get("thu")).toBe("trai");
  });

  it("★★★ ĐỔI TẦNG không xoá panel `?xem=` — chiều lô F ghi", () => {
    const sp = new URLSearchParams(
      tronTrangThaiUrl("nm=18&toa=4&tang=9&xem=machine:42", { nap: { tang: 10 } }),
    );
    expect(sp.get("tang")).toBe("10");
    // G32 — đầu ra KHÁC đầu vào ở đúng ô ta đổi…
    expect(sp.get("xem")).toBe("machine:42"); // …và KHÔNG đổi ở ô ta không đụng.
  });

  it("★★★ ĐỔI NHÀ MÁY xoá `toa`+`tang` (đúng luật F) nhưng GIỮ `xem`", () => {
    // Ca dễ hỏng nhất: đây là nhánh DUY NHẤT trong `tronTrangThaiUrl` gọi
    // `sp.delete()` một cách chủ động. Một `sp.delete("xem")` thêm vào đây sẽ
    // không làm đỏ bất kỳ test nào khác.
    const sp = new URLSearchParams(
      tronTrangThaiUrl("nm=1&toa=3&tang=7&xem=station:5", { nap: { nm: 18 } }),
    );
    expect([sp.get("nm"), sp.get("toa"), sp.get("tang")]).toEqual(["18", null, null]);
    expect(sp.get("xem")).toBe("station:5");
  });

  it("★ thu/mở panel bên không đụng `xem`", () => {
    const sp = new URLSearchParams(
      tronTrangThaiUrl("xem=robot:9&thu=trai", { thu: ["trai", "phai"] }),
    );
    expect(sp.get("thu")).toBe("trai,phai");
    expect(sp.get("xem")).toBe("robot:9");
  });

  it("★ ĐÓNG ngăn (`xem=null`) không đụng ba ô nạp", async () => {
    const { tronXemVaoQuery } = await import("./nhungTaiCho");
    const sp = new URLSearchParams(tronXemVaoQuery("nm=18&tang=9&xem=machine:42", null));
    expect(sp.get("xem")).toBeNull();
    expect([sp.get("nm"), sp.get("tang")]).toEqual(["18", "9"]);
  });

  it("★★★ ĐỌC: một URL mang CẢ hai lô đọc ra đủ cả hai, không vế nào nuốt vế nào", async () => {
    const { docXemTuQuery } = await import("./nhungTaiCho");
    const q = "?pv=line:1&nm=18&toa=4&tang=9&thu=phai&xem=machine:42&cam=1,2,3,4,5";
    const tt = docTrangThaiUrl(q);
    expect(tt.nap).toEqual({ nm: 18, toa: 4, tang: 9 });
    expect(tt.thu).toEqual(["phai"]);
    expect(tt.phamVi).toEqual({ cap: "line", id: 1 });
    expect(docXemTuQuery(q)).toEqual({ loai: "machine", id: 42 });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 23 M2 — `moPhongMo`: TÊN CHIỀU NGƯỢC CHO PANEL MẶC-ĐỊNH-THU        */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("Đợt 23 M2 — moPhongMo", () => {
  it("★★★ có trong PANEL_THU_DUOC — thiếu thì `docThu` NUỐT im lặng (G67)", () => {
    // Đây KHÔNG phải test tautology: `docThu` lọc theo đúng danh sách này, nên
    // một tên vắng mặt sẽ đọc ra rỗng trong khi URL ghi ra vẫn "đúng".
    expect(PANEL_THU_DUOC).toContain("moPhongMo");
    expect(docThu("moPhongMo")).toEqual(["moPhongMo"]);
  });

  it("★ vòng đọc-ghi TẤT ĐỊNH và không mất tên", () => {
    expect(docThu(ghiThu(["moPhongMo", "kpi"]))).toEqual(
      PANEL_THU_DUOC.filter((p) => ["kpi", "moPhongMo"].includes(p)),
    );
  });

  it("★ `?thu=moPhong` (link CŨ) vẫn đọc được, không làm hỏng cả ô", () => {
    // Bỏ tên cũ khỏi danh sách sẽ khiến link cũ đọc ra rỗng — im lặng.
    expect(docThu("moPhong")).toEqual(["moPhong"]);
    // ⚠ `docThu` giữ thứ tự ĐẦU VÀO; chỉ `ghiThu` mới sắp theo PANEL_THU_DUOC.
    // (Kỳ vọng đầu tiên của tôi ở đây SAI và lưới đã bác — giữ lại ghi chú này
    //  vì chính sự phân vai ấy là thứ dễ nhớ nhầm.)
    expect(docThu("moPhong,kpi")).toEqual(["moPhong", "kpi"]);
    expect(ghiThu(["moPhong", "kpi"])).toBe("kpi,moPhong");
  });

  it("★ hai tên ĐỘC LẬP — bật cái này không kéo theo cái kia", () => {
    expect(docThu("moPhongMo")).not.toContain("moPhong");
    expect(docThu("moPhong")).not.toContain("moPhongMo");
  });
});
