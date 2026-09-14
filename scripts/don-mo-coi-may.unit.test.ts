/**
 * don-mo-coi-may.unit.test.ts — G52: `npm run check` KHÔNG bảo vệ `scripts/`
 * ============================================================================
 *
 * `tsconfig.json` của dự án không kéo `scripts/**` vào diện kiểm, nên một tệp
 * script hỏng cú pháp, gọi hàm không tồn tại, hay tuột mất một bảng khỏi danh
 * sách xoá vẫn đi qua cổng `npm run check` MÀ KHÔNG KÊU. Bộ test này là phép
 * đo riêng cho hai script dọn/gỡ.
 *
 * ★★★ NÓ ĐO NGUỒN, KHÔNG ĐO ĐẦU RA
 * Mọi khẳng định ở đây chấm trên VĂN BẢN của script, vì thứ dễ hỏng nhất không
 * phải giá trị hàm trả về mà là **vị từ xoá** và **danh sách bảng**. Một script
 * đổi `NOT EXISTS` thành `LIKE 'TAI-%'` vẫn chạy trơn, vẫn xoá "đúng" trên dữ
 * liệu thử, và sẽ xoá nhầm dữ liệu thật ở lần chạy đầu tiên trên CSDL khác.
 * Không phép đo đầu-ra nào bắt được điều đó; phép đo nguồn thì có.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BANG_DON } from "./don-mo-coi-may.ts";
import { xacMinhCauChi } from "./go-tai-twin.ts";

const thuMuc = path.dirname(fileURLToPath(import.meta.url));
const nguonDon = fs.readFileSync(path.join(thuMuc, "don-mo-coi-may.ts"), "utf8");
const nguonGo = fs.readFileSync(path.join(thuMuc, "go-tai-twin.ts"), "utf8");

/** Bỏ chú thích: docblock ở đây kể lịch sử và có nhắc cả những cách làm ĐÃ BỊ LOẠI. */
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const maDon = boChuThich(nguonDon);
const maGo = boChuThich(nguonGo);

/** Sáu bảng chủ dự án đã duyệt cho lô T. Không hơn, không kém. */
const SAU_BANG = [
  "ot_telemetry",
  "rul_estimates",
  "machine_status_logs",
  "station_dwell_time",
  "measurement_point_defs",
  "predictive_alerts",
] as const;

describe("don-mo-coi-may — phạm vi bảng", () => {
  it("dọn ĐÚNG sáu bảng được duyệt, không thừa không thiếu", () => {
    expect([...BANG_DON.map((b) => b.bang)].sort()).toEqual([...SAU_BANG].sort());
  });

  it("G59: khai `machine_id` cho rul_estimates và `machineId` cho năm bảng còn lại", () => {
    const map = Object.fromEntries(BANG_DON.map((b) => [b.bang, b.cot]));
    // Đây là con số ĐO ĐƯỢC trên information_schema, không phải quy ước. Nếu
    // ai "chuẩn hoá" cột này thành machineId thì 8.197 hàng bị bỏ sót IM LẶNG.
    expect(map.rul_estimates).toBe("machine_id");
    for (const t of SAU_BANG.filter((x) => x !== "rul_estimates")) {
      expect(map[t]).toBe("machineId");
    }
  });

  it("station_dwell_time khoá theo `machineId`, KHÔNG theo `stationId`", () => {
    // Đo được: mồ côi theo machineId = 3.247, theo stationId = 0. Chọn nhầm cột
    // cho một con số ĐẸP (0) cho một câu hỏi SAI.
    const map = Object.fromEntries(BANG_DON.map((b) => [b.bang, b.cot]));
    expect(map.station_dwell_time).toBe("machineId");
  });
});

describe("don-mo-coi-may — vị từ xoá phải là QUAN HỆ", () => {
  /**
   * ★ Vị từ quan hệ ở đây được chia làm HAI THÌ, và test phải chấm đúng chỗ.
   *
   * Bản đầu xoá thẳng bằng `DELETE … WHERE NOT EXISTS (…)`. Nó đổ trên chunk
   * NÉN: "transparent decompression only supports tableoid system column".
   * Bản hiện tại tách ra: (1) CHỌN tập khoá máy mồ côi bằng phép nối quan hệ
   * với `machines`, (2) XOÁ theo đúng tập khoá đó.
   *
   * ⇒ Chuỗi `NOT EXISTS` KHÔNG còn trong đường xoá, nên một test tìm nó sẽ ĐỎ
   *   dù mã vẫn đúng — đúng lớp "chỉ báo đo cái đã dời đi". Cái phải chấm là:
   *   tập khoá được suy từ `machines`, và KHÔNG chỗ nào suy nó từ tên/ngày.
   */
  it("tập khoá xoá được suy từ phép nối với `machines`, không từ tên hay ngày", () => {
    // khoaMoCoiCua(): LEFT JOIN machines … WHERE m.id IS NULL
    expect(maDon).toMatch(/LEFT JOIN machines m ON m\.id = x\./);
    expect(maDon).toMatch(/WHERE x\.[^\n]*IS NOT NULL AND m\.id IS NULL/);
  });

  it("lệnh DELETE chỉ nhận tập khoá đã đo, không nhận vị từ mở", () => {
    // Mọi DELETE trong tệp phải có dạng `= ANY($1::int[])` — tức là chỉ xoá
    // đúng những id đã được chứng minh là mồ côi ở bước đo trước đó.
    const cacDelete = maDon.match(/DELETE FROM[\s\S]{0,160}/g) ?? [];
    expect(cacDelete.length).toBeGreaterThan(0);
    for (const d of cacDelete) expect(d).toMatch(/= ANY\(\$1::int\[\]\)/);
  });

  it("KHÔNG có `drop_chunks` — mọi chunk có rác đều chứa hàng sống", () => {
    expect(maDon).not.toMatch(/drop_chunks/);
  });

  it("KHÔNG lọc theo LIKE tiền tố mã, KHÔNG lọc theo khoảng ngày để xoá", () => {
    expect(maDon).not.toMatch(/DELETE[\s\S]{0,300}?LIKE/i);
    expect(maDon).not.toMatch(/DELETE[\s\S]{0,300}?\bts\s*[<>]/i);
  });

  it("mặc định là CHỈ ĐO — phải truyền --xoa mới xoá thật", () => {
    expect(maDon).toMatch(/const XOA = args\.includes\("--xoa"\)/);
  });

  it("có bất biến chặn: sống GIẢM thì ném lỗi", () => {
    expect(maDon).toMatch(/sau\.song < truoc\.song/);
    expect(maDon).toMatch(/DUNG NGAY/);
  });

  it("dùng vai chủ sở hữu, không dùng vai WORM `avi_app` để xoá", () => {
    expect(maDon).toMatch(/MIGRATION_DB_USER \?\? "aoi"/);
  });
});

describe("import KHÔNG được chạy script", () => {
  /**
   * Đo được lần đầu chạy bộ test này: chỉ `import { BANG_DON }` đã làm
   * `don-mo-coi-may.ts` nối vào CSDL và in "Vai: aoi CSDL: aoi_management_test".
   * Với `go-tai-twin.ts` còn nặng hơn — `main()` của nó KHÔNG có chế độ chỉ-đo
   * mặc định, nên một lượt import sẽ gỡ sạch nhà máy tải 240 máy của lô P.
   *
   * Cả hai tệp giờ chốt bằng `import.meta.url === process.argv[1]`.
   */
  for (const [ten, ma] of [["don-mo-coi-may", maDon], ["go-tai-twin", maGo]] as const) {
    it(`${ten}: main() nằm sau cửa "gọi trực tiếp"`, () => {
      expect(ma).toMatch(/laGoiTrucTiep[\s\S]{0,400}?\bmain\(\)/);
      // và KHÔNG có lời gọi main() trần ở đầu dòng (ngoài cửa)
      expect(ma).not.toMatch(/^main\(\)/m);
    });
  }
});

describe("go-tai-twin — danh sách bảng khớp mã nguồn (cầu chì tự-kiểm)", () => {
  it("mọi DELETE theo khoá máy đều được khai trong BANG_GO_XU_LY, và ngược lại", () => {
    const lech = xacMinhCauChi(nguonGo);
    expect(lech.thieuKhai).toEqual([]);
    expect(lech.thieuXoa).toEqual([]);
  });

  it("cả sáu bảng lô T đều có mặt trong phép gỡ", () => {
    for (const t of SAU_BANG) {
      expect(maGo, `thiếu DELETE cho ${t}`).toMatch(new RegExp(`DELETE FROM ${t}\\b`));
    }
  });

  it("`xacMinhCauChi` KHÔNG vắt qua ranh giới câu lệnh", () => {
    // Ca hồi quy thật: `wip_tracking` xoá theo `currentStationId`, nhưng lệnh
    // NGAY SAU nó lọc bằng `"machineId" = ANY`. Bản regex đầu tiên nuốt cả hai
    // và khai nhầm `wip_tracking` là "xoá theo khoá máy".
    const gia = `
      xoa.wip_tracking = (await tx\`DELETE FROM wip_tracking WHERE "currentStationId" = ANY(\${stIds})\`).count;
      xoa.product_inspections = (await tx\`DELETE FROM product_inspections WHERE "machineId" = ANY(\${mIds})\`).count;
    `;
    const lech = xacMinhCauChi(gia);
    // `product_inspections` CÓ trong danh sách khai; `wip_tracking` thì KHÔNG —
    // nên nếu regex vắt qua ranh giới, `wip_tracking` sẽ lọt vào `thieuKhai`.
    expect(lech.thieuKhai).toEqual([]);
  });

  it("cầu chì phân biệt 'bảng ngoài danh sách' với 'đua ghi ở bảng đã xử'", () => {
    // Hai ca cần hai cách sửa khác hẳn nhau: thêm bảng vs dừng server. Gộp làm
    // một thì người đọc đi sửa nhầm chỗ.
    expect(maGo).toMatch(/BANG NGOAI DANH SACH GO/);
    expect(maGo).toMatch(/DUA GHI/);
  });
});
