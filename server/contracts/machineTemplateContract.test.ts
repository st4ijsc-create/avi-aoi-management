// server/contracts/machineTemplateContract.test.ts
//
// Khối B — Task 1 (B-1): lưới cho HỢP ĐỒNG CÂY DẠY (`machineTemplateContract.ts`).
//
// Ba mệnh đề phải chứng minh (brief Task 1):
//   1. Mẫu máy THẬT parse được, đếm đúng 2 surface / 4 position / 8 capture /
//      16 component.
//   2. Thiếu trường bắt buộc ⇒ TỪ CHỐI (`components` thiếu · `roi` thiếu `width`).
//   3. MỌI trường chuỗi có `.max()` khớp cột thật — chứng minh bằng census
//      (`capChuoiVarcharScan.ts`: bảng `KIEM_KE_CAY_DAY` + walker
//      `kiemTraToanBoTruongChuoi`) VÀ bằng đột biến ĐỎ ĐƯỢC (§5).
//
// ⚠ Hợp đồng này CHƯA có cửa (`.mutation()` là Task 2), nên nó CỐ Ý không nằm
// trong `DANH_SACH_SCHEMA_INGEST` (`capChuoiVarcharDuongIngestMacDinh.test.ts`)
// — danh sách đó được đối chiếu với tập cửa THẬT quét từ AST router. File này
// là hộ tiêu thụ DUY NHẤT của `KIEM_KE_CAY_DAY` hôm nay: không có nó, bảng
// kiểm kê là một lời khai KHÔNG AI ĐỎ ĐƯỢC (đúng lớp lỗi M-2/N-6 đã ghi trong
// `capChuoiVarcharScan.ts`).
//
// Mọi đột biến ở §5 dựng schema MỚI TRONG BỘ NHỚ (`z.object({...shape})`,
// KHÔNG `writeFileSync`) — §6 so khớp NGUYÊN VĂN file trên đĩa để chứng minh.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  machineTemplateContract,
  type MachineTemplate,
} from "./machineTemplateContract";
import {
  KIEM_KE_CAY_DAY,
  kiemKeTheoBang,
  kiemTraToanBoTruongChuoi,
  duyetTimTruongChuoi,
  duongDanDuLieu,
  type MucCapChuoi,
} from "./capChuoiVarcharScan";

/** Mẫu CẤU HÌNH thật do máy xuất ra (khác `dashboard-sample.json` = mẫu KẾT QUẢ). */
const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";

const DUONG_FILE_HOP_DONG = new URL("./machineTemplateContract.ts", import.meta.url);
const NOI_DUNG_GOC = readFileSync(DUONG_FILE_HOP_DONG, "utf8");

/** Đọc mẫu thật MỚI mỗi lần gọi — mọi ca sửa payload đều làm trên bản riêng. */
function mauThat(): any {
  return JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));
}

/** Đặt `gia` vào payload, đi theo đường DỮ LIỆU tương ứng `duongDan` SCHEMA ("[]" → phần tử 0). */
function apDungGiaTri(mau: any, duongDan: MucCapChuoi["duongDan"], gia: string): void {
  const dp = duongDanDuLieu(duongDan);
  let obj = mau;
  for (let i = 0; i < dp.length - 1; i++) obj = obj[dp[i] as keyof typeof obj];
  obj[dp[dp.length - 1] as keyof typeof obj] = gia as never;
}

/**
 * Dựng lại hợp đồng với ĐÚNG một trường ở `duongDan` bị thay bằng
 * `moiHoa(nguyenBan)` — mọi trường khác giữ NGUYÊN tham chiếu cũ. Cùng kỹ
 * thuật `taoSchemaDotBien` của `capChuoiVarcharCensus.test.ts` (không chép lại
 * ý tưởng mới): đi theo CHÍNH `duongDan` mà census dùng để ĐỌC, nên đột biến
 * luôn trúng đúng trường nó nói sẽ đột biến.
 */
function taoSchemaDotBien(duongDan: MucCapChuoi["duongDan"], moiHoa: (n: z.ZodTypeAny) => z.ZodTypeAny): z.ZodTypeAny {
  function apDung(node: any, con: readonly string[]): any {
    if (con.length === 0) return moiHoa(node);
    const [buoc, ...conLai] = con;
    if (buoc === "[]") return z.array(apDung(node.element, conLai));
    return z.object({ ...node.shape, [buoc]: apDung(node.shape[buoc], conLai) });
  }
  return apDung(machineTemplateContract, duongDan);
}

/** Bóc `.max()` khỏi một lá chuỗi, GIỮ optional bọc ngoài — chỉ dùng cho đột biến. */
function boMax(node: z.ZodTypeAny): z.ZodTypeAny {
  if (node instanceof z.ZodOptional) return z.optional(boMax(node.unwrap() as z.ZodTypeAny));
  if (node instanceof z.ZodString) return z.string();
  return node;
}

describe("§1 — ĐO TRƯỚC: mẫu máy THẬT parse được, đếm đúng 2 / 4 / 8 / 16", () => {
  it(`${MAU_MAY_THAT} nguyên văn ⇒ success:true`, () => {
    const r = machineTemplateContract.safeParse(mauThat());
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it("★★★ đếm bốn cấp = 2 surface / 4 position / 8 capture / 16 component", () => {
    const cay = machineTemplateContract.parse(mauThat()) satisfies MachineTemplate;
    const positions = cay.surfaces.flatMap((s) => s.positions);
    const captures = positions.flatMap((p) => p.captures);
    const components = captures.flatMap((c) => c.components);
    expect(cay.surfaces).toHaveLength(2);
    expect(positions).toHaveLength(4);
    expect(captures).toHaveLength(8);
    expect(components).toHaveLength(16);
  });

  it("KHÔNG cắt trường nào của mẫu thật — tập khoá SAU parse == tập khoá TRƯỚC parse ở cả bốn cấp", () => {
    // zod `.object()` (không `.strict()`) CẮT IM LẶNG khoá lạ. Đây là lưới canh
    // đúng chỗ đó: `markerRadius` (2/4 position, shape="Circle") vắng khỏi bảng
    // khai của kế hoạch — nếu ai gỡ nó khỏi hợp đồng, ca này ĐỎ chứ không im.
    const truoc = mauThat();
    const sau: any = machineTemplateContract.parse(truoc);
    const khoa = (o: any) => Object.keys(o).sort();
    const gomKhoa = (cay: any) => {
      const s = new Set<string>();
      for (const sf of cay.surfaces) {
        khoa(sf).forEach((k) => s.add(`surface.${k}`));
        for (const p of sf.positions) {
          khoa(p).forEach((k) => s.add(`position.${k}`));
          for (const c of p.captures) {
            khoa(c).forEach((k) => s.add(`capture.${k}`));
            for (const cp of c.components) {
              khoa(cp).forEach((k) => s.add(`component.${k}`));
              khoa(cp.roi).forEach((k) => s.add(`roi.${k}`));
            }
          }
        }
      }
      return [...s].sort();
    };
    expect(gomKhoa(sau)).toEqual(gomKhoa(truoc));
    expect(gomKhoa(sau)).toContain("position.markerRadius");
  });

  it("khoá nối bốn cấp có mặt và ĐÚNG KIỂU (surface=TÊN · position=MÃ \"P01\" · capture/component=UUID)", () => {
    const cay = machineTemplateContract.parse(mauThat());
    expect(cay.surfaces.map((s) => s.surfaceName)).toEqual(["TOP", "BOTTOM"]);
    expect(cay.surfaces[0].positions.map((p) => p.positionId)).toEqual(["P01", "P02"]);
    // `id` của position TỒN TẠI nhưng KHÔNG dùng để nối kết quả — hai khoá khác nhau.
    expect(cay.surfaces[0].positions[0].id).not.toBe(cay.surfaces[0].positions[0].positionId);
    expect(cay.surfaces[0].positions[0].captures[0].id).toBe("a1b2c3d4-0000-4000-8000-000000001011");
    expect(cay.surfaces[0].positions[0].captures[0].components[0].id).toBe("a1b2c3d4-0000-4000-8000-000000010111");
  });
});

describe("§2 — THIẾU TRƯỜNG BẮT BUỘC ⇒ TỪ CHỐI", () => {
  it("★★★ capture thiếu `components` ⇒ từ chối, nêu đúng đường", () => {
    const p = mauThat();
    delete p.surfaces[0].positions[0].captures[0].components;
    const r = machineTemplateContract.safeParse(p);
    expect(r.success).toBe(false);
    const duong = (r as any).error.issues.map((i: any) => i.path.join("."));
    expect(duong).toContain("surfaces.0.positions.0.captures.0.components");
  });

  it("★★★ `roi` thiếu `width` ⇒ từ chối, nêu đúng đường", () => {
    const p = mauThat();
    delete p.surfaces[0].positions[0].captures[0].components[0].roi.width;
    const r = machineTemplateContract.safeParse(p);
    expect(r.success).toBe(false);
    const duong = (r as any).error.issues.map((i: any) => i.path.join("."));
    expect(duong).toContain("surfaces.0.positions.0.captures.0.components.0.roi.width");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ Khối B Task 2 (Bước 3) — `roi.*` là SỐ NGUYÊN, chặn Ở CỬA HỢP ĐỒNG.
  // ══════════════════════════════════════════════════════════════════════════
  // Cột đích `measurement_point_defs.roiX/roiY/roiWidth/roiHeight` là `integer`.
  // Postgres LÀM TRÒN IM LẶNG số lẻ ⇒ hệ lưu một ROI KHÁC ROI máy khai, không lỗi
  // nào ném. Mẫu máy thật có 64 giá trị `roi`, 0 giá trị lẻ (ca đối chứng cuối) ⇒
  // siết bây giờ KHÔNG từ chối payload thật nào.
  it("★★★ `roi.x = 12.5` ⇒ TỪ CHỐI, nêu đúng đường VÀ nói rõ vì sao (làm tròn im lặng)", () => {
    const p = mauThat();
    p.surfaces[0].positions[0].captures[0].components[0].roi.x = 12.5;
    const r = machineTemplateContract.safeParse(p);
    expect(r.success).toBe(false);
    const issues = (r as any).error.issues;
    expect(issues.map((i: any) => i.path.join("."))).toContain(
      "surfaces.0.positions.0.captures.0.components.0.roi.x",
    );
    const thongDiep = issues.map((i: any) => i.message).join(" | ");
    expect(thongDiep).toContain("SỐ NGUYÊN");
    expect(thongDiep).toContain("LÀM TRÒN IM LẶNG");
  });

  it("cả BỐN cạnh `roi` đều siết số nguyên (không phải chỉ `x`)", () => {
    for (const canh of ["x", "y", "width", "height"] as const) {
      const p = mauThat();
      p.surfaces[0].positions[0].captures[0].components[0].roi[canh] = 1.5;
      const r = machineTemplateContract.safeParse(p);
      expect(r.success, `roi.${canh} = 1.5 phải bị TỪ CHỐI`).toBe(false);
      expect((r as any).error.issues.map((i: any) => i.path.join("."))).toContain(
        `surfaces.0.positions.0.captures.0.components.0.roi.${canh}`,
      );
    }
  });

  it("ĐỐI CHỨNG — mẫu máy THẬT có 64 giá trị `roi`, 0 giá trị lẻ (siết này không từ chối máy nào đang chạy)", () => {
    const p = mauThat();
    const giaTri: number[] = [];
    for (const s of p.surfaces)
      for (const v of s.positions)
        for (const c of v.captures)
          for (const k of c.components) giaTri.push(k.roi.x, k.roi.y, k.roi.width, k.roi.height);
    expect(giaTri.length).toBe(64);
    expect(giaTri.filter((g) => !Number.isInteger(g))).toEqual([]);
    expect(machineTemplateContract.safeParse(p).success).toBe(true);
  });

  it("thiếu `roi` cả cụm ⇒ từ chối", () => {
    const p = mauThat();
    delete p.surfaces[0].positions[0].captures[0].components[0].roi;
    expect(machineTemplateContract.safeParse(p).success).toBe(false);
  });

  it("bốn khoá nối rỗng / toàn khoảng trắng ⇒ từ chối (chuỗi không join được với gì)", () => {
    for (const dat of [
      (p: any) => { p.surfaces[0].surfaceId = "   "; },
      (p: any) => { p.surfaces[0].surfaceName = ""; },
      (p: any) => { p.surfaces[0].positions[0].positionId = "  "; },
      (p: any) => { p.surfaces[0].positions[0].captures[0].id = ""; },
      (p: any) => { p.surfaces[0].positions[0].captures[0].components[0].id = "   "; },
    ]) {
      const p = mauThat();
      dat(p);
      expect(machineTemplateContract.safeParse(p).success).toBe(false);
    }
  });

  it("`surfaces` thiếu hẳn ⇒ từ chối (gốc cây là trường duy nhất, bắt buộc)", () => {
    expect(machineTemplateContract.safeParse({}).success).toBe(false);
  });

  it("ĐỐI CHỨNG — `components: []` RỖNG vẫn HỢP LỆ (capture không dạy linh kiện nào là hình dạng thật)", () => {
    const p = mauThat();
    p.surfaces[0].positions[0].captures[0].components = [];
    expect(machineTemplateContract.safeParse(p).success).toBe(true);
  });
});

describe("§3 — CENSUS `.max()` XANH trên hợp đồng THẬT", () => {
  it("★★★ dân số lá chuỗi — GHIM 15 (đổi số này là một lời khai: thêm/bớt trường chuỗi)", () => {
    expect(KIEM_KE_CAY_DAY.length).toBe(15);
    expect(duyetTimTruongChuoi(machineTemplateContract)).toHaveLength(15);
  });

  it("★★★ walker DUYỆT SCHEMA — 0 lỗi, KHÔNG có miễn trừ nào (mọi lá chuỗi đều có .max())", () => {
    const r = kiemTraToanBoTruongChuoi(machineTemplateContract, "machineTemplateContract", new Set());
    expect(r.loi, r.loi.join("\n")).toEqual([]);
    expect(r.soTruongDaXet).toBe(15);
  });

  it("★★★ bảng KIEM_KE_CAY_DAY khớp CON SỐ thật của hợp đồng (walker chỉ canh SỰ TỒN TẠI, bảng canh GIÁ TRỊ)", () => {
    const r = kiemKeTheoBang(machineTemplateContract, KIEM_KE_CAY_DAY);
    expect(r.loi, "census ĐỎ — sửa .max() cho khớp bảng KIEM_KE_CAY_DAY (hoặc đo lại cột)").toEqual([]);
    expect(r.soTruongDaXet).toBe(15);
  });

  it("bảng phủ ĐÚNG tập lá chuỗi walker tìm được (không thiếu hàng, không hàng ma)", () => {
    const tuWalker = duyetTimTruongChuoi(machineTemplateContract).map((l) => l.duongDan).sort();
    expect(KIEM_KE_CAY_DAY.map((m) => m.ten).sort()).toEqual(tuWalker);
  });

  it("mỗi hàng kiểm kê có `ten` DUY NHẤT (chống hai hàng cùng tên che lấp nhau)", () => {
    const ten = KIEM_KE_CAY_DAY.map((m) => m.ten);
    expect(new Set(ten).size).toBe(ten.length);
  });

  it("9 hàng nhóm (A) đúng là 9 trường CHẠM CỘT THẬT — đổi danh sách này là một lời khai về ánh xạ DB", () => {
    expect(KIEM_KE_CAY_DAY.filter((m) => m.nguon === "db").map((m) => m.ten).sort()).toEqual([
      "surfaces[].positions[].captures[].components[].componentName",
      "surfaces[].positions[].captures[].components[].id",
      "surfaces[].positions[].captures[].id",
      "surfaces[].positions[].captures[].name",
      "surfaces[].positions[].name",
      "surfaces[].positions[].positionId",
      "surfaces[].positions[].shape",
      "surfaces[].surfaceId",
      "surfaces[].surfaceName",
    ]);
  });
});

describe("§4 — CA CANH BIÊN trên TOÀN BỘ 15 trường chuỗi", () => {
  for (const muc of KIEM_KE_CAY_DAY) {
    it(`${muc.ten} — đúng .max(${muc.max}) ký tự vẫn HỢP LỆ (${muc.nguon === "db" ? muc.ghiChu : "vệ sinh"})`, () => {
      const p = mauThat();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max));
      const r = machineTemplateContract.safeParse(p);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it(`${muc.ten} — quá .max(${muc.max}) MỘT ký tự bị TỪ CHỐI`, () => {
      const p = mauThat();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max + 1));
      expect(machineTemplateContract.safeParse(p).success).toBe(false);
    });
  }
});

describe("§5 — ★★★ ĐỘT BIẾN (trong bộ nhớ, KHÔNG chạm đĩa): gỡ .max() ⇒ census ĐỎ đúng tên", () => {
  it("★★★ gỡ .max() của `componentName` ⇒ CẢ HAI census ĐỎ, nêu đúng tên, không kéo trường khác", () => {
    const duong: MucCapChuoi["duongDan"] = ["surfaces", "[]", "positions", "[]", "captures", "[]", "components", "[]", "componentName"];
    const dotBien = taoSchemaDotBien(duong, boMax);

    const theoBang = kiemKeTheoBang(dotBien, KIEM_KE_CAY_DAY);
    expect(theoBang.loi).toEqual([
      "surfaces[].positions[].captures[].components[].componentName: THIẾU .max() (kỳ vọng 255 — measurement_point_defs.name varchar(255) NOT NULL)",
    ]);

    const walker = kiemTraToanBoTruongChuoi(dotBien, "machineTemplateContract", new Set());
    expect(walker.loi).toEqual([
      "[machineTemplateContract] surfaces[].positions[].captures[].components[].componentName: THIẾU .max()",
    ]);
  });

  for (const muc of KIEM_KE_CAY_DAY) {
    it(`gỡ .max() của "${muc.ten}" ⇒ census ĐỎ, NÊU ĐÚNG TÊN`, () => {
      const r = kiemKeTheoBang(taoSchemaDotBien(muc.duongDan, boMax), KIEM_KE_CAY_DAY);
      expect(r.loi.some((l) => l.startsWith(`${muc.ten}: THIẾU .max()`)), `output thật:\n${r.loi.join("\n")}`).toBe(true);
      expect(r.loi).toHaveLength(1);
    });
  }

  it("LỆCH SỐ (không phải thiếu) cũng bị bắt — .max(50) trên `shape` (con số kế hoạch khai) ⇒ ĐỎ vì cột thật là 20", () => {
    const duong: MucCapChuoi["duongDan"] = ["surfaces", "[]", "positions", "[]", "shape"];
    const r = kiemKeTheoBang(taoSchemaDotBien(duong, () => z.string().max(50).optional()), KIEM_KE_CAY_DAY);
    expect(r.loi).toHaveLength(1);
    expect(r.loi[0]).toContain("surfaces[].positions[].shape: .max(50) LỆCH, kỳ vọng .max(20)");
  });

  it("THÊM trường chuỗi MỚI không .max() ⇒ walker ĐỎ TỰ ĐỘNG, KHÔNG cần sửa bảng nào", () => {
    const dotBien = machineTemplateContract.extend({ maMayChuaTungCo: z.string().optional() });
    const r = kiemTraToanBoTruongChuoi(dotBien, "machineTemplateContract", new Set());
    expect(r.loi).toEqual(["[machineTemplateContract] maMayChuaTungCo: THIẾU .max()"]);
  });
});

describe("§6 — file hợp đồng trên đĩa KHÔNG hề bị đụng bởi toàn bộ đột biến ở trên", () => {
  it("machineTemplateContract.ts khớp NGUYÊN VĂN bản chụp lúc nạp module", () => {
    expect(readFileSync(DUONG_FILE_HOP_DONG, "utf8")).toBe(NOI_DUNG_GOC);
  });
});
