/**
 * Lưới cho `khoBoNho.ts` — ĐỢT H / TASK H3 / B1+B3+B5. THUẦN: không cần `vscode`, chỉ cần một
 * `KhoLuuTruTho` giả (bọc quanh `Map`), cùng khuôn `khoHoiThoai.unit.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  laMucBoNhoHopLe,
  laNguonBoNhoHopLe,
  apDungTranBoNho,
  dungMucBoNho,
  docDanhSachBoNho,
  themMucBoNho,
  xoaMucBoNho,
  xoaTatCaBoNho,
  KHOA_BO_NHO,
  TRAN_SO_MUC_BO_NHO,
  TRAN_TONG_KY_TU_BO_NHO,
  type MucBoNho,
} from "./khoBoNho";
// `KhoLuuTruTho` là "khuôn kho" DÙNG CHUNG — `khoBoNho.ts` chỉ NHẬP kiểu này (không tái xuất), lưới
// import thẳng từ nguồn gốc, cùng cách `khoHoiThoai.unit.test.ts` đã làm.
import type { KhoLuuTruTho } from "./khoHoiThoai";

/** Kho giả THUẦN — cùng hình dạng `{doc(k), ghi(k,v)}` mà `bangChat.ts` bơm từ
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

function mucGia(ma: string, noiDung: string, thoiDiem: number, nguon: MucBoNho["nguon"] = "nguoi_dung_bao_nho"): MucBoNho {
  return { ma, noiDung, thoiDiem, nguon };
}

describe("laNguonBoNhoHopLe / laMucBoNhoHopLe — B1: hàng rào hình dạng", () => {
  it("★ hai nguồn hợp lệ", () => {
    expect(laNguonBoNhoHopLe("nguoi_dung_bao_nho")).toBe(true);
    expect(laNguonBoNhoHopLe("ai_de_xuat_duyet")).toBe(true);
  });

  it("★★ KHÔNG có nguồn thứ ba tự động — đúng luật B5", () => {
    expect(laNguonBoNhoHopLe("tu_dong")).toBe(false);
    expect(laNguonBoNhoHopLe("")).toBe(false);
    expect(laNguonBoNhoHopLe(123)).toBe(false);
    expect(laNguonBoNhoHopLe(undefined)).toBe(false);
  });

  it("★★★ một mục hợp lệ đầy đủ trường", () => {
    expect(laMucBoNhoHopLe(mucGia("m1", "nội dung", 100))).toBe(true);
  });

  it("★★ NHÁNH KIA — thiếu trường / sai kiểu / null / không phải object ⇒ KHÔNG hợp lệ", () => {
    expect(laMucBoNhoHopLe(null)).toBe(false);
    expect(laMucBoNhoHopLe("chuoi")).toBe(false);
    expect(laMucBoNhoHopLe({ ma: "m1", noiDung: "x" })).toBe(false); // thiếu thoiDiem/nguon
    expect(laMucBoNhoHopLe({ ma: "m1", noiDung: "x", thoiDiem: NaN, nguon: "nguoi_dung_bao_nho" })).toBe(false);
    expect(laMucBoNhoHopLe({ ma: "m1", noiDung: "x", thoiDiem: 1, nguon: "tu_dong" })).toBe(false);
  });
});

describe("apDungTranBoNho — B1: cắt CŨ NHẤT trước, chặn trên cả SỐ lẫn KÝ TỰ", () => {
  it("★ dưới cả hai trần ⇒ giữ nguyên", () => {
    const ds = [mucGia("a", "1", 1), mucGia("b", "2", 2)];
    expect(apDungTranBoNho(ds, 5, 1000)).toEqual(ds.slice().sort((a, b) => b.thoiDiem - a.thoiDiem));
  });

  it("★★★ RANH GIỚI SỐ: vượt trần SỐ ⇒ giữ N mục MỚI NHẤT, cắt phần CŨ HƠN", () => {
    const ds = [mucGia("a", "x", 1), mucGia("b", "x", 2), mucGia("c", "x", 3)];
    const giu = apDungTranBoNho(ds, 2, 1000);
    expect(giu.map((m) => m.ma)).toEqual(["c", "b"]);
  });

  it("★★★ RANH GIỚI KÝ TỰ: tổng ký tự vượt trần ⇒ cắt mục CŨ NHẤT dù chưa chạm trần SỐ", () => {
    const ds = [mucGia("cu", "12345", 1), mucGia("moi", "12345", 2)];
    // trần ký tự = 5: mục MỚI (moi) chiếm đủ 5, mục CŨ (cu) làm tổng vượt ⇒ bị cắt.
    const giu = apDungTranBoNho(ds, 100, 5);
    expect(giu.map((m) => m.ma)).toEqual(["moi"]);
  });

  it("★ MỤC MỚI NHẤT LUÔN được giữ dù MỘT MÌNH nó đã vượt trần ký tự", () => {
    const ds = [mucGia("dai", "1234567890", 1)];
    const giu = apDungTranBoNho(ds, 100, 3);
    expect(giu.map((m) => m.ma)).toEqual(["dai"]);
  });

  it("★ hằng số trần mặc định dương và hợp lý (dùng làm đối chứng, không đoán con số)", () => {
    expect(TRAN_SO_MUC_BO_NHO).toBeGreaterThan(0);
    expect(TRAN_TONG_KY_TU_BO_NHO).toBeGreaterThan(0);
  });
});

describe("dungMucBoNho — B3: CHE BÍ MẬT TRƯỚC KHI GHI, khối PEM ĐA DÒNG", () => {
  it("★★★ khoá riêng PEM đa dòng ⇒ đọc lại KHÔNG thấy thân base64", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz",
      "ANOTHERLINEOFBASE64DATATHATLOOKSLIKEAKEYBODYHERE12345",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const muc = dungMucBoNho("m1", `Ghi nhớ khoá triển khai:\n${pem}\nHết.`, "nguoi_dung_bao_nho");
    expect(muc.noiDung).not.toContain("MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz");
    expect(muc.noiDung).not.toContain("ANOTHERLINEOFBASE64DATATHATLOOKSLIKEAKEYBODYHERE12345");
    expect(muc.noiDung).toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(muc.noiDung).toContain("-----END RSA PRIVATE KEY-----");
  });

  it("★ nội dung không bí mật ⇒ giữ nguyên", () => {
    const muc = dungMucBoNho("m1", "Dự án dùng workspaceState, không dùng globalState.", "ai_de_xuat_duyet");
    expect(muc.noiDung).toBe("Dự án dùng workspaceState, không dùng globalState.");
  });

  it("★ mã/nguồn/thời điểm được giữ nguyên vẹn", () => {
    const muc = dungMucBoNho("ma-abc", "nội dung", "ai_de_xuat_duyet", 999);
    expect(muc).toEqual({ ma: "ma-abc", noiDung: "nội dung", thoiDiem: 999, nguon: "ai_de_xuat_duyet" });
  });
});

describe("docDanhSachBoNho — đọc, lọc sạch phần tử hỏng, KHÔNG BAO GIỜ ném lỗi", () => {
  it("★ kho rỗng (chưa từng ghi) ⇒ mảng rỗng", () => {
    expect(docDanhSachBoNho(khoGia())).toEqual([]);
  });

  it("★★ dữ liệu KHÔNG PHẢI mảng ⇒ mảng rỗng", () => {
    const kho = khoGia();
    kho.du.set(KHOA_BO_NHO, "chuoi la, khong phai mang");
    expect(docDanhSachBoNho(kho)).toEqual([]);
  });

  it("★★ mảng có phần tử HỎNG lẫn phần tử TỐT ⇒ chỉ giữ phần tử TỐT", () => {
    const kho = khoGia();
    kho.du.set(KHOA_BO_NHO, [mucGia("tot", "ok", 1), { ma: "hong" }, null, "rac"]);
    expect(docDanhSachBoNho(kho).map((m) => m.ma)).toEqual(["tot"]);
  });

  it("★ `kho.doc` NÉM LỖI ⇒ mảng rỗng, không ném lại", () => {
    const kho: KhoLuuTruTho = {
      doc: () => {
        throw new Error("hỏng");
      },
      ghi: () => undefined,
    };
    expect(docDanhSachBoNho(kho)).toEqual([]);
  });
});

describe("themMucBoNho — B5: LỐI VÀO DUY NHẤT để thêm, che bí mật + cắt trần TRƯỚC khi ghi", () => {
  it("★★★ thêm một mục ⇒ đọc lại thấy ĐÚNG mục đó, đã che bí mật", async () => {
    const kho = khoGia();
    await themMucBoNho(kho, "m1", "token=sk-abcdefghijklmnopqrstuvwx", "nguoi_dung_bao_nho", 1);
    const ds = docDanhSachBoNho(kho);
    expect(ds).toHaveLength(1);
    expect(ds[0]!.ma).toBe("m1");
    expect(ds[0]!.nguon).toBe("nguoi_dung_bao_nho");
    expect(ds[0]!.noiDung).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });

  it("★ NHÁNH KIA — nội dung RỖNG (hoặc toàn khoảng trắng) ⇒ KHÔNG GHI GÌ CẢ", async () => {
    const kho = khoGia();
    await themMucBoNho(kho, "m1", "   ", "nguoi_dung_bao_nho");
    expect(kho.du.has(KHOA_BO_NHO)).toBe(false);
    expect(docDanhSachBoNho(kho)).toEqual([]);
  });

  it("★★ UPSERT theo `ma` — gọi lại CÙNG `ma` thay THẾ, không đẻ thêm bản ghi mới", async () => {
    const kho = khoGia();
    await themMucBoNho(kho, "m1", "bản đầu", "nguoi_dung_bao_nho", 1);
    await themMucBoNho(kho, "m1", "bản sau", "nguoi_dung_bao_nho", 2);
    const ds = docDanhSachBoNho(kho);
    expect(ds).toHaveLength(1);
    expect(ds[0]!.noiDung).toBe("bản sau");
  });

  it("★★★ vượt trần SỐ mặc định (TRAN_SO_MUC_BO_NHO) ⇒ mục CŨ NHẤT bị cắt khỏi kho SAU khi ghi", async () => {
    // Nạp thẳng ĐÚNG trần vào kho (bỏ qua `themMucBoNho` cho phần nạp — chỉ lượt GHI cuối mới là
    // điều đang được đo) rồi thêm MỘT mục nữa qua đúng lối vào B5 đang kiểm.
    const kho = khoGia();
    const day: MucBoNho[] = [];
    for (let i = 0; i < TRAN_SO_MUC_BO_NHO; i++) day.push(mucGia(`cu-${i}`, "x", i + 1));
    kho.du.set(KHOA_BO_NHO, day);
    await themMucBoNho(kho, "moi", "mới nhất", "nguoi_dung_bao_nho", TRAN_SO_MUC_BO_NHO + 100);
    const ds = docDanhSachBoNho(kho);
    expect(ds).toHaveLength(TRAN_SO_MUC_BO_NHO);
    expect(ds.some((m) => m.ma === "moi")).toBe(true);
    expect(ds.some((m) => m.ma === "cu-0")).toBe(false); // mục CŨ NHẤT (thoiDiem=1) bị cắt
  });
});

describe("xoaMucBoNho — B2: xoá ĐÚNG MỘT mục", () => {
  it("★★★ xoá một mục ⇒ các mục còn lại nguyên vẹn", async () => {
    const kho = khoGia();
    await themMucBoNho(kho, "a", "A", "nguoi_dung_bao_nho", 1);
    await themMucBoNho(kho, "b", "B", "nguoi_dung_bao_nho", 2);
    await xoaMucBoNho(kho, "a");
    expect(docDanhSachBoNho(kho).map((m) => m.ma)).toEqual(["b"]);
  });

  it("★ NHÁNH KIA — xoá một `ma` KHÔNG TỒN TẠI ⇒ không ghi gì thêm, kho giữ nguyên", async () => {
    const kho = khoGia();
    await themMucBoNho(kho, "a", "A", "nguoi_dung_bao_nho", 1);
    await xoaMucBoNho(kho, "khong-ton-tai");
    expect(docDanhSachBoNho(kho).map((m) => m.ma)).toEqual(["a"]);
  });
});

describe("xoaTatCaBoNho — B2: xoá TẤT CẢ", () => {
  it("★★★ xoá tất cả ⇒ danh sách rỗng", async () => {
    const kho = khoGia();
    await themMucBoNho(kho, "a", "A", "nguoi_dung_bao_nho", 1);
    await themMucBoNho(kho, "b", "B", "nguoi_dung_bao_nho", 2);
    await xoaTatCaBoNho(kho);
    expect(docDanhSachBoNho(kho)).toEqual([]);
  });

  it("★ kho ĐÃ rỗng sẵn ⇒ vẫn an toàn (không ném lỗi)", async () => {
    const kho = khoGia();
    await expect(xoaTatCaBoNho(kho)).resolves.toBeUndefined();
    expect(docDanhSachBoNho(kho)).toEqual([]);
  });
});
