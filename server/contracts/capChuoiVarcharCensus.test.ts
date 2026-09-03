// server/contracts/capChuoiVarcharCensus.test.ts
//
// Pha 1D Task 3 (BG-27). Vì sao GẤP: một trường chuỗi KHÔNG `.max()` mà cột đích
// là `varchar(n)` là một quả mìn chặn-đầu-hàng — hợp đồng khai HỢP LỆ, DB ném
// `[22001] value too long for type character varying(n)` SAU cửa, và (trước T1)
// lỗi đó bị `isPermanentSubmitError` xếp TẠM THỜI ⇒ máy nhận ACK giả rồi
// không bao giờ gửi lại (xem docblock đầu `machineDataContractV2.ts`, "Vòng sửa 3").
//
// Lưới này canh BỐN điều:
//   §1 — census chạy trên hợp đồng THẬT phải XANH (0 lỗi), và dân số trường đã
//        xét được GHIM (30) — đổi số này là một lời khai, không phải bảo trì im lặng.
//   §2 — CA CANH BIÊN trên TOÀN BỘ 30 trường (không chỉ hai trường review nêu):
//        đúng-bằng-sức-chứa PHẢI hợp lệ; quá 1 ký tự PHẢI bị từ chối.
//   §3 — CHỐNG HỒI QUY: mẫu máy THẬT (`dashboard-sample.json`) vẫn parse
//        `success: true` sau khi siết.
//   §4 — ĐỘT BIẾN THẬT, chạy CHÍNH `kiemKeCapChuoi` trên một schema đã bị mutate
//        TRONG BỘ NHỚ (không ghi đĩa — không cần dọn `git status`, xem lý lẽ ở
//        `cuaIngestCensus.test.ts` §5): gỡ `.max()` của BẤT KỲ trường nào trong
//        30 trường ⇒ census phải ĐỎ và NÊU ĐÚNG TÊN trường đó, KHÔNG kéo theo
//        trường khác báo lỗi oan (chứng minh census không "xanh vì quét trúng 0
//        thứ" — một bộ suy luôn trả `[]` cũng qua được §1 nhưng hỏng ở §4). Kèm
//        một ca LỆCH SỐ (không phải thiếu hẳn) để phân biệt hai nhánh lỗi của
//        Việc 4 trong brief.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { machineDataContractV2 } from "./machineDataContractV2";
import { mauHopLe } from "./machineDataContractV2.test-helpers";
import { KIEM_KE_CAP_CHUOI, kiemKeCapChuoi, duongDanDuLieu, type MucCapChuoi } from "./capChuoiVarcharScan";

const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\dashboard-sample.json";

// Chụp nội dung file hợp đồng NGAY khi module này nạp — trước khi bất kỳ ca đột
// biến nào ở §4 chạy. Toàn bộ §4 chỉ dựng `z.object()`/`z.array()` MỚI trong bộ
// nhớ (không `writeFileSync`, không đụng `machineDataContractV2` gốc — mọi hàm
// đột biến đều TRẢ VỀ schema mới, không sửa tại chỗ), nên bản chụp này PHẢI
// khớp y nguyên khi đọc lại ở cuối §4.
const DUONG_FILE_HOP_DONG = new URL("./machineDataContractV2.ts", import.meta.url);
const NOI_DUNG_GOC = readFileSync(DUONG_FILE_HOP_DONG, "utf8");

/** Đặt `gia` vào payload mẫu, đi theo đường DỮ LIỆU tương ứng `duongDan` SCHEMA ("[]" → phần tử 0). */
function apDungGiaTri(mau: any, duongDan: MucCapChuoi["duongDan"], gia: string): void {
  const dp = duongDanDuLieu(duongDan);
  let obj = mau;
  for (let i = 0; i < dp.length - 1; i++) obj = obj[dp[i] as keyof typeof obj];
  obj[dp[dp.length - 1] as keyof typeof obj] = gia as never;
}

/**
 * Bóc mọi `.max()` khỏi một `ZodType` lá (giữ nguyên optional/nullable/union
 * bọc ngoài) — dùng CHỈ để dựng biến thể đột biến trong bộ nhớ cho §4, KHÔNG
 * dùng ở đường sản xuất.
 */
function boMax(node: z.ZodTypeAny): z.ZodTypeAny {
  // zod v4: .unwrap() khai kiểu $ZodType (internals) — cast về ZodTypeAny, hành vi không đổi.
  if (node instanceof z.ZodOptional) return z.optional(boMax(node.unwrap() as z.ZodTypeAny));
  if (node instanceof z.ZodNullable) return z.nullable(boMax(node.unwrap() as z.ZodTypeAny));
  if (node instanceof z.ZodUnion) {
    const options = (node.options as z.ZodTypeAny[]).map((o) => (o instanceof z.ZodString ? z.string() : o));
    return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }
  if (node instanceof z.ZodString) return z.string();
  return node;
}

/**
 * Dựng lại schema gốc với ĐÚNG một trường ở `duongDan` bị thay bằng
 * `moiHoa(nguyenBan)` — mọi trường khác giữ NGUYÊN tham chiếu cũ (spread
 * `...node.shape`). Tổng quát hoá cho MỌI hàng trong `KIEM_KE_CAP_CHUOI`, không
 * viết tay riêng từng cấp — đi theo cùng `duongDan` mà `kiemKeCapChuoi` dùng để
 * đọc, nên đột biến luôn đúng ĐÚNG trường nó nói sẽ đột biến.
 */
function taoSchemaDotBien(duongDan: MucCapChuoi["duongDan"], moiHoa: (n: z.ZodTypeAny) => z.ZodTypeAny): z.ZodTypeAny {
  function apDung(node: any, con: readonly string[]): any {
    if (con.length === 0) return moiHoa(node);
    const [buoc, ...conLai] = con;
    if (buoc === "[]") return z.array(apDung(node.element, conLai));
    return z.object({ ...node.shape, [buoc]: apDung(node.shape[buoc], conLai) });
  }
  return apDung(machineDataContractV2, duongDan);
}

describe("§1 — CENSUS trên hợp đồng THẬT phải XANH", () => {
  it("★★★ dân số trường đã xét — GHIM 30 (đổi số này là một lời khai)", () => {
    expect(KIEM_KE_CAP_CHUOI.length).toBe(30);
  });

  it("★★★ 0 lỗi trên machineDataContractV2 thật", () => {
    const r = kiemKeCapChuoi();
    expect(r.loi, "census ĐỎ trên hợp đồng thật — sửa .max() cho khớp bảng KIEM_KE_CAP_CHUOI").toEqual([]);
    expect(r.soTruongDaXet).toBe(30);
  });

  it("mỗi hàng kiểm kê có `ten` DUY NHẤT (chống hai hàng cùng tên che lấp nhau)", () => {
    const ten = KIEM_KE_CAP_CHUOI.map((m) => m.ten);
    expect(new Set(ten).size).toBe(ten.length);
  });
});

describe("§2 — CA CANH BIÊN trên TOÀN BỘ 30 trường", () => {
  for (const muc of KIEM_KE_CAP_CHUOI) {
    it(`${muc.ten} — đúng .max(${muc.max}) ký tự vẫn HỢP LỆ (${muc.nguon === "db" ? muc.ghiChu : "vệ sinh"})`, () => {
      const p = mauHopLe();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max));
      const r = machineDataContractV2.safeParse(p);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it(`${muc.ten} — quá .max(${muc.max}) MỘT ký tự bị TỪ CHỐI`, () => {
      const p = mauHopLe();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max + 1));
      expect(machineDataContractV2.safeParse(p).success).toBe(false);
    });
  }
});

describe("§3 — CHỐNG HỒI QUY: mẫu máy THẬT vẫn parse được sau khi siết", () => {
  it(`${MAU_MAY_THAT} nguyên văn ⇒ success:true`, () => {
    const raw = readFileSync(MAU_MAY_THAT, "utf8");
    const data = JSON.parse(raw);
    const r = machineDataContractV2.safeParse(data);
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});

describe("§4 — ★★★ ĐỘT BIẾN THẬT (trong bộ nhớ, không chạm đĩa) — gỡ MỘT .max() bất kỳ ⇒ ĐỎ đúng tên", () => {
  for (const muc of KIEM_KE_CAP_CHUOI) {
    it(`gỡ .max() của "${muc.ten}" ⇒ census ĐỎ, NÊU ĐÚNG TÊN, không kéo trường khác theo`, () => {
      const schemaDotBien = taoSchemaDotBien(muc.duongDan, boMax);
      const r = kiemKeCapChuoi(schemaDotBien);
      expect(r.loi.some((l) => l.startsWith(`${muc.ten}: THIẾU .max()`)), `output thật:\n${r.loi.join("\n")}`).toBe(true);
      expect(r.loi, "đột biến MỘT trường không được kéo trường khác báo lỗi oan").toHaveLength(1);
    });
  }

  it("★★★ LỆCH SỐ (không phải thiếu hẳn) cũng bị bắt — .max(64)→.max(63) cho positionId (tiền lệ Pha 1B: siết lệch 1 là từ chối dữ liệu hợp lệ)", () => {
    const muc = KIEM_KE_CAP_CHUOI.find((m) => m.ten === "surfaces[].positions[].positionId")!;
    const schemaDotBien = taoSchemaDotBien(muc.duongDan, (n) => {
      // n: ZodString .trim().min(1).max(64) — dựng lại với .max(63).
      return z.string().trim().min(1).max(muc.max - 1);
    });
    const r = kiemKeCapChuoi(schemaDotBien);
    expect(r.loi).toEqual([
      `${muc.ten}: .max(${muc.max - 1}) LỆCH, kỳ vọng .max(${muc.max}) — ${muc.ghiChu}`,
    ]);
  });

  it("CHỐNG 'XANH VÌ QUÉT TRÚNG 0 THỨ': đột biến TẤT CẢ 30 trường CÙNG LÚC ⇒ đúng 30 lỗi, mỗi lỗi một tên riêng (một bộ suy luôn trả `[]` sẽ lộ ngay ở đây dù §1 có thể xanh giả)", () => {
    // Tổng quát hoá `taoSchemaDotBien` cho NHIỀU đường cùng lúc: gom theo bước
    // đầu tiên tại mỗi nút, đệ quy — nút là `ZodArray` thì mọi đường con đều bắt
    // đầu bằng "[]" (đi `.element`); nút là `ZodObject` thì gom theo tên field.
    // "chạm lá" (đường rỗng) tại một nút ⇒ áp `boMax` NGAY tại nút đó.
    function bienDoiNhieuDuong(node: any, cacDuongDan: MucCapChuoi["duongDan"][]): any {
      const laNgay = cacDuongDan.filter((d) => d.length === 0);
      const diTiep = cacDuongDan.filter((d) => d.length > 0);
      let ketQua = node;
      if (diTiep.length > 0) {
        const nhom = new Map<string, MucCapChuoi["duongDan"][]>();
        for (const d of diTiep) {
          const [buoc, ...con] = d;
          const ds = nhom.get(buoc) ?? [];
          ds.push(con);
          nhom.set(buoc, ds);
        }
        if (node instanceof z.ZodArray) {
          const conMang = nhom.get("[]")!;
          ketQua = z.array(bienDoiNhieuDuong(node.element, conMang));
        } else {
          const shapeMoi = { ...node.shape };
          for (const [buoc, dsCon] of nhom) shapeMoi[buoc] = bienDoiNhieuDuong(node.shape[buoc], dsCon);
          ketQua = z.object(shapeMoi);
        }
      }
      if (laNgay.length > 0) ketQua = boMax(ketQua);
      return ketQua;
    }

    const tapDuongDan = KIEM_KE_CAP_CHUOI.map((m) => m.duongDan);
    const goc = bienDoiNhieuDuong(machineDataContractV2, tapDuongDan);

    const r = kiemKeCapChuoi(goc);
    expect(r.loi).toHaveLength(30);
    const tenDaBat = new Set(r.loi.map((l) => l.split(":")[0]));
    expect(tenDaBat.size, "30 lỗi nhưng trùng tên — một trường bị đếm hai lần trong khi trường khác thoát").toBe(30);
    const tenKyVong = new Set(KIEM_KE_CAP_CHUOI.map((m) => m.ten));
    expect(tenDaBat).toEqual(tenKyVong);
  });

  it("file `machineDataContractV2.ts` trên đĩa KHÔNG hề bị đụng bởi toàn bộ §4 (so khớp NGUYÊN VĂN với bản chụp lúc nạp module)", () => {
    const noiDungSau = readFileSync(DUONG_FILE_HOP_DONG, "utf8");
    expect(noiDungSau).toBe(NOI_DUNG_GOC);
  });
});
