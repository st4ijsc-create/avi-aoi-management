/**
 * Lưới cho `khoHoiThoai.ts` — ĐỢT F / TASK 2. THUẦN: không cần `vscode`, chỉ cần một `KhoLuuTruTho`
 * giả (bọc quanh `Map`) để mô phỏng đúng hình dạng `context.workspaceState`.
 */
import { describe, it, expect } from "vitest";
import {
  sinhTieuDe,
  laHoiThoaiHopLe,
  apDungTranDungLuong,
  dungHoiThoai,
  docDanhSachHoiThoai,
  docHoiThoaiGanNhat,
  luuHoiThoai,
  KHOA_HOI_THOAI,
  type HoiThoai,
  type KhoLuuTruTho,
} from "./khoHoiThoai";
import type { LuotChat } from "./yeuCau";

/** Kho giả THUẦN cho lưới — cùng hình dạng `{doc(k), ghi(k,v)}` mà `bangChat.ts` bơm từ
 *  `context.workspaceState` vào, nhưng không cần `vscode` để tồn tại. */
function khoGia(): KhoLuuTruTho & { du: Map<string, unknown> } {
  const du = new Map<string, unknown>();
  return {
    du,
    doc: <T>(k: string) => du.get(k) as T | undefined,
    ghi: (k: string, v: unknown) => {
      du.set(k, v);
    },
  };
}

function luot(cauHoi: string, traLoi = "trả lời"): LuotChat[] {
  return [
    { role: "user", content: cauHoi },
    { role: "assistant", content: traLoi },
  ];
}

describe("sinhTieuDe — B1: tiêu đề gọn, KHÔNG cắt giữa ký tự tổ hợp", () => {
  it("★ gọn khoảng trắng thừa, cắt hai đầu", () => {
    expect(sinhTieuDe("   Hỏi   thử   một câu   ")).toBe("Hỏi thử một câu");
  });

  it("★ câu hỏi rỗng ⇒ tiêu đề mặc định, không phải chuỗi rỗng", () => {
    expect(sinhTieuDe("   ")).toBe("Hội thoại mới");
  });

  it("★★★ RANH GIỚI CẮT: đúng bằng trần ⇒ GIỮ nguyên (không thêm dấu …)", () => {
    // "abcde" = 5 cụm ký tự, trần = 5 ⇒ không cắt.
    expect(sinhTieuDe("abcde", 5)).toBe("abcde");
  });

  it("★★★ RANH GIỚI CẮT: vượt trần đúng MỘT cụm ⇒ cắt còn đúng trần cụm + dấu …", () => {
    // "abcdef" = 6 cụm, trần = 5 ⇒ giữ 5 cụm đầu, thêm "…".
    expect(sinhTieuDe("abcdef", 5)).toBe("abcde…");
  });

  it("★★★ KHÔNG cắt giữa ký tự tổ hợp — chuỗi dạng NFD (dấu rời) đúng TẠI ranh giới cắt", () => {
    /**
     * ⚠⚠⚠ BÀI HỌC PHẢI TRÁNH: "ệ" ở dạng NFC là MỘT mã điểm (U+1EC7) — cắt theo mã điểm ở đó vẫn
     * đúng, nên một lưới chỉ thử dạng NFC sẽ KHÔNG bắt được lỗi cắt-theo-mã-điểm. Dạng NFD của
     * "ệ" là "e" (U+0065) + dấu mũ kết hợp (U+0302) + dấu nặng kết hợp (U+0323) — BA mã điểm
     * riêng biệt cho MỘT chữ. Đặt cụm này làm CỤM THỨ BA (đúng ranh giới cắt khi trần = 3):
     *   - cắt theo MÃ ĐIỂM (`Array.from`/spread, đếm "e" là 1 điểm) sẽ dừng ngay SAU "e", bỏ lại
     *     hai dấu kết hợp phía sau (kết quả "ab" + "e" = "abe…", MẤT dấu) — SAI.
     *   - cắt theo CỤM KÝ TỰ (`Intl.Segmenter`, `sinhTieuDe` dùng) gộp "e"+hai dấu thành MỘT cụm,
     *     nên ranh giới trần=3 rơi ĐÚNG SAU cụm đó, giữ nguyên vẹn cả ba mã điểm — ĐÚNG.
     */
    const eToHopNfd = "e\u0302\u0323"; // "ệ" dạng NFD — MỘT cụm, BA mã điểm
    const vao = `ab${eToHopNfd}cd`; // 5 cụm: 'a','b',cụm-tổ-hợp,'c','d'
    const ra = sinhTieuDe(vao, 3);
    expect(ra).toBe(`ab${eToHopNfd}…`);
    // Đối chứng: cắt SAI (theo mã điểm) sẽ cho "abe…" — khẳng định kết quả THẬT không phải chuỗi đó.
    expect(ra).not.toBe("abe…");
    // Cả hai dấu kết hợp phải còn NGUYÊN trong kết quả — không dấu nào bị bỏ lại một mình.
    expect(ra).toContain("\u0302");
    expect(ra).toContain("\u0323");
  });

  it("★ chữ Việt dạng NFC (thường gặp khi gõ bằng bộ gõ) vẫn đúng số cụm", () => {
    // "Việt" (đã ghép sẵn dấu, NFC) — 4 chữ cái là 4 cụm, không bị đếm nhầm thành nhiều mã điểm.
    expect(sinhTieuDe("Việt", 4)).toBe("Việt");
    expect(sinhTieuDe("Việt Nam", 4)).toBe("Việt…");
  });
});

describe("laHoiThoaiHopLe — B5: hàng rào hình dạng", () => {
  it("★ hội thoại đúng hình dạng ⇒ hợp lệ", () => {
    expect(laHoiThoaiHopLe({ ma: "1", tieuDe: "t", thoiDiem: 1, luot: [] })).toBe(true);
    expect(
      laHoiThoaiHopLe({ ma: "1", tieuDe: "t", thoiDiem: 1, luot: [{ role: "user", content: "x" }] }),
    ).toBe(true);
  });

  it("★★★ NHÁNH KIA — mọi hình dạng lạ đều KHÔNG hợp lệ, không ném lỗi khi kiểm tra", () => {
    const laLoat = [
      null,
      undefined,
      42,
      "chuỗi trần",
      [],
      {},
      { ma: "1" }, // thiếu trường
      { ma: 1, tieuDe: "t", thoiDiem: 1, luot: [] }, // ma sai kiểu
      { ma: "1", tieuDe: "t", thoiDiem: "hôm nay", luot: [] }, // thoiDiem sai kiểu
      { ma: "1", tieuDe: "t", thoiDiem: 1, luot: "không phải mảng" },
      { ma: "1", tieuDe: "t", thoiDiem: 1, luot: [{ role: "sai", content: "x" }] },
      { ma: "1", tieuDe: "t", thoiDiem: 1, luot: [{ role: "user", content: 123 }] },
      { ma: "1", tieuDe: "t", thoiDiem: Number.NaN, luot: [] },
    ];
    for (const x of laLoat) expect(laHoiThoaiHopLe(x)).toBe(false);
  });
});

describe("apDungTranDungLuong — B3: giới hạn dung lượng, cắt CŨ NHẤT trước", () => {
  function dsHoiThoaiDon(soLuong: number): HoiThoai[] {
    // Mỗi hội thoại một lượt "x" (1 ký tự) — thoiDiem TĂNG DẦN theo chỉ số (index lớn = MỚI hơn).
    return Array.from({ length: soLuong }, (_, i) => ({
      ma: `m${i}`,
      tieuDe: `t${i}`,
      thoiDiem: i,
      luot: [{ role: "user" as const, content: "x" }],
    }));
  }

  it("★★★ RANH GIỚI SỐ: đúng bằng trần ⇒ GIỮ hết, không cắt gì", () => {
    const ds = dsHoiThoaiDon(3);
    const ra = apDungTranDungLuong(ds, 3, 999);
    expect(ra).toHaveLength(3);
  });

  it("★★★ RANH GIỚI SỐ: vượt trần đúng MỘT hội thoại ⇒ cắt ĐÚNG hội thoại CŨ NHẤT (m0)", () => {
    const ds = dsHoiThoaiDon(4); // m0 cũ nhất (thoiDiem=0), m3 mới nhất (thoiDiem=3)
    const ra = apDungTranDungLuong(ds, 3, 999);
    expect(ra.map((h) => h.ma).sort()).toEqual(["m1", "m2", "m3"]);
    expect(ra.some((h) => h.ma === "m0")).toBe(false);
  });

  it("★★★ RANH GIỚI KÝ TỰ: tổng đúng bằng trần ⇒ GIỮ hết", () => {
    // 3 hội thoại × 1 ký tự "user" = 3 ký tự mỗi hội thoại (content="x" dài 1, nhưng demKyTu cộng
    // MỌI lượt — ở đây mỗi hội thoại có đúng 1 lượt, 1 ký tự ⇒ tổng 3 hội thoại = 3 ký tự).
    const ds = dsHoiThoaiDon(3);
    const ra = apDungTranDungLuong(ds, 999, 3);
    expect(ra).toHaveLength(3);
  });

  it("★★★ RANH GIỚI KÝ TỰ: vượt trần đúng MỘT ký tự ⇒ cắt hội thoại CŨ NHẤT", () => {
    const ds = dsHoiThoaiDon(4); // tổng 4 ký tự nếu giữ hết
    const ra = apDungTranDungLuong(ds, 999, 3); // trần 3 ⇒ chỉ giữ 3 hội thoại MỚI nhất
    expect(ra.map((h) => h.ma).sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("★ hội thoại MỚI NHẤT một mình đã vượt trần ký tự vẫn được GIỮ (không tự xoá sạch kho)", () => {
    const ds: HoiThoai[] = [
      { ma: "cu", tieuDe: "cu", thoiDiem: 1, luot: [{ role: "user", content: "x" }] },
      { ma: "moi", tieuDe: "moi", thoiDiem: 2, luot: [{ role: "user", content: "quá dài so với trần" }] },
    ];
    const ra = apDungTranDungLuong(ds, 999, 5); // trần 5 ký tự, "moi" một mình đã dài hơn 5
    expect(ra.map((h) => h.ma)).toEqual(["moi"]); // giữ "moi", cắt "cu" (cũ hơn)
  });

  it("★ kết quả sắp MỚI → CŨ", () => {
    const ds = dsHoiThoaiDon(3);
    const ra = apDungTranDungLuong(ds, 999, 999);
    expect(ra.map((h) => h.ma)).toEqual(["m2", "m1", "m0"]);
  });
});

describe("dungHoiThoai — B1 + B4: che bí mật TRƯỚC khi sinh tiêu đề", () => {
  it("★ tiêu đề lấy từ lượt user ĐẦU TIÊN", () => {
    const h = dungHoiThoai("m1", [
      { role: "assistant", content: "chào" },
      { role: "user", content: "Câu hỏi thật của tôi" },
    ]);
    expect(h.tieuDe).toBe("Câu hỏi thật của tôi");
  });

  it("★★★ khoá PEM ĐA DÒNG dán làm câu hỏi ĐẦU ⇒ tiêu đề KHÔNG mang theo thân base64", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\n" +
      "MIIBOwIBAAJBAKj34GkxFhD90vcNLYLInFEr47Zn1AWXusrsRxmsUNFrQtHXsQTF\n" +
      "-----END RSA PRIVATE KEY-----";
    const h = dungHoiThoai("m1", luot(pem));
    expect(h.tieuDe).not.toContain("MIIBOwIBAAJB");
    expect(h.luot[0]!.content).not.toContain("MIIBOwIBAAJB");
  });

  it("★★★ che ĐÚNG cheBiMat đa dòng — thân PEM vắng mặt trong CẢ HAI lượt, dòng BEGIN/END còn nguyên", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\n" +
      "MIIBOwIBAAJBAKj34GkxFhD90vcNLYLInFEr47Zn1AWXusrsRxmsUNFrQtHXsQTF\n" +
      "9SVW+DzZ2Yg1kMzOEzTOZ+3ZzY1DAvIVbThvJvJvJvJvJvJvJvJvJvJvJvJvJvJv\n" +
      "-----END RSA PRIVATE KEY-----";
    const h = dungHoiThoai("m1", [
      { role: "user", content: `Đây là khoá của tôi:\n${pem}\nGiúp tôi kiểm tra định dạng.` },
      { role: "assistant", content: "Đã nhận." },
    ]);
    expect(h.luot[0]!.content).not.toContain("9SVW+DzZ2Yg1");
    expect(h.luot[0]!.content).not.toContain("MIIBOwIBAAJB");
    expect(h.luot[0]!.content).toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(h.luot[0]!.content).toContain("-----END RSA PRIVATE KEY-----");
  });
});

describe("docDanhSachHoiThoai / docHoiThoaiGanNhat — B5: nhánh kia (rỗng/hỏng) không ném lỗi", () => {
  it("★★★ kho CHƯA TỪNG GHI (undefined) ⇒ danh sách rỗng, ganNhat undefined, KHÔNG ném lỗi", () => {
    const kho = khoGia();
    expect(docDanhSachHoiThoai(kho)).toEqual([]);
    expect(docHoiThoaiGanNhat(kho)).toBeUndefined();
  });

  it("★★★ giá trị lưu SAI KIỂU HOÀN TOÀN (không phải mảng) ⇒ rỗng, không ném lỗi", () => {
    const kho = khoGia();
    kho.du.set(KHOA_HOI_THOAI, { khong: "phai mang" });
    expect(docDanhSachHoiThoai(kho)).toEqual([]);
    kho.du.set(KHOA_HOI_THOAI, "một chuỗi trần — dữ liệu của phiên bản trước, hình dạng khác hẳn");
    expect(docDanhSachHoiThoai(kho)).toEqual([]);
  });

  it("★★★ MẢNG có phần tử HỎNG lẫn phần tử HỢP LỆ ⇒ chỉ lọc bỏ phần tử hỏng, giữ phần hợp lệ", () => {
    const kho = khoGia();
    const hopLe: HoiThoai = { ma: "ok", tieuDe: "ổn", thoiDiem: 5, luot: [] };
    kho.du.set(KHOA_HOI_THOAI, [hopLe, { thieu: "truong" }, null, "rác", 42]);
    expect(docDanhSachHoiThoai(kho)).toEqual([hopLe]);
    expect(docHoiThoaiGanNhat(kho)).toEqual(hopLe);
  });

  it("★★★ `doc` NÉM LỖI (triển khai lưu trữ hỏng) ⇒ vẫn trả rỗng, không văng ra ngoài", () => {
    const kho: KhoLuuTruTho = {
      doc: () => {
        throw new Error("đĩa hỏng");
      },
      ghi: () => {},
    };
    expect(() => docDanhSachHoiThoai(kho)).not.toThrow();
    expect(docDanhSachHoiThoai(kho)).toEqual([]);
    expect(docHoiThoaiGanNhat(kho)).toBeUndefined();
  });

  it("★ ganNhat chọn ĐÚNG `thoiDiem` LỚN NHẤT, bất kể thứ tự trong mảng lưu", () => {
    const kho = khoGia();
    const a: HoiThoai = { ma: "a", tieuDe: "a", thoiDiem: 100, luot: [] };
    const b: HoiThoai = { ma: "b", tieuDe: "b", thoiDiem: 300, luot: [] }; // gần nhất
    const c: HoiThoai = { ma: "c", tieuDe: "c", thoiDiem: 200, luot: [] };
    kho.du.set(KHOA_HOI_THOAI, [a, b, c]);
    expect(docHoiThoaiGanNhat(kho)!.ma).toBe("b");
  });
});

describe("luuHoiThoai — lối vào duy nhất: upsert theo ma + che bí mật + cắt trần, TRƯỚC khi ghi", () => {
  it("★ NHÁNH KIA — luotTho RỖNG ⇒ KHÔNG ghi gì (không tạo mục rỗng trong lịch sử)", async () => {
    const kho = khoGia();
    await luuHoiThoai(kho, "m1", []);
    expect(kho.du.has(KHOA_HOI_THOAI)).toBe(false);
  });

  it("★★★ hai lần lưu CÙNG `ma` ⇒ UPSERT (cập nhật đúng bản ghi cũ, không đẻ thêm bản ghi mới)", async () => {
    const kho = khoGia();
    await luuHoiThoai(kho, "phien-1", luot("câu đầu"));
    await luuHoiThoai(kho, "phien-1", [...luot("câu đầu"), { role: "user", content: "câu thứ hai" }]);
    const ds = docDanhSachHoiThoai(kho);
    expect(ds).toHaveLength(1);
    expect(ds[0]!.luot).toHaveLength(3);
  });

  it("★★★ khoá PEM dán vào MỘT lượt ⇒ đọc lại từ KHO (đường ghi/đọc THẬT, không chỉ hàm thuần lẻ) KHÔNG thấy thân base64", async () => {
    const kho = khoGia();
    const pem =
      "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtz\n" +
      "c2gtZWQyNTUxOQAAACBBrandomKeyBodyThatMustNeverAppearAnywhereXYZ\n" +
      "-----END OPENSSH PRIVATE KEY-----";
    await luuHoiThoai(kho, "m1", [
      { role: "user", content: `dán nhầm khoá:\n${pem}` },
      { role: "assistant", content: "đã nhận" },
    ]);
    const dsSauKhiDoc = docDanhSachHoiThoai(kho);
    const toanBoVanBan = JSON.stringify(dsSauKhiDoc);
    expect(toanBoVanBan).not.toContain("b3BlbnNzaC1rZXktdjEA");
    expect(toanBoVanBan).not.toContain("randomKeyBodyThatMustNeverAppear");
  });

  it("★ áp trần dung lượng NGAY KHI GHI — hội thoại cũ nhất bị cắt khi vượt trần SỐ", async () => {
    const kho = khoGia();
    for (let i = 0; i < 3; i++) {
      await luuHoiThoai(kho, `m${i}`, luot(`câu hỏi ${i}`));
    }
    const ds = docDanhSachHoiThoai(kho);
    expect(ds).toHaveLength(3); // dưới trần mặc định (50) ⇒ chưa cắt gì, chỉ xác nhận đường ghi chạy qua apDungTranDungLuong không làm mất dữ liệu hợp lệ
    expect(ds.map((h) => h.ma).sort()).toEqual(["m0", "m1", "m2"]);
  });
});
