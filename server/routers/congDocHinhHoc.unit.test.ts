/**
 * congDocHinhHoc.unit.test.ts — ★★★ ĐỢT 10 LÔ H2: GHIM CỔNG ĐỌC HÌNH HỌC CỦA
 * `twinCanhRouter`, VÀ GHIM RẰNG VIỆC MỞ NÓ **KHÔNG** MỞ ĐƯỜNG GHI.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖI ĐƯỢC ĐO, KHÔNG ĐƯỢC SUY — "MỘT LỐI VÀO RỒI TỪ CHỐI" (Khối D)
 * ════════════════════════════════════════════════════════════════════════════
 * Trước lô H, ba thủ tục ĐỌC hình học đứng trên `quyenThietKe`
 * (`settings_factory`/`machine_control`), trong khi ô nav `/twin`
 * (`navigation.tsx:446`) cho vào bằng `analytics_oee`/`machine_status`.
 *
 * Ca dương KHÔNG phải dựng ra — nó có sẵn trong seed và **đo được trên DB thật**:
 *
 *     userId 48 `operator1`, vai `operator`, có ĐÚNG MỘT quyền: `machine_status`
 *     ⇒ nav CHO VÀO `/twin` · `canhThietKe` TRẢ VỀ FORBIDDEN
 *     ⇒ thấy menu, bấm vào, màn trắng.
 *
 * `TwinVanHanh.tsx:388-395` (biến `thieuQuyenBoCuc`) **đã tự khai** lỗi này từ
 * trước, nhưng lời tự khai không phải phép đo: nó bắt FORBIDDEN rồi hiện một
 * lời xin lỗi, chứ không làm màn chạy được.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TỆP NÀY ĐO GÌ, VÀ VÌ SAO NỬA "KHÔNG MỞ GHI" LÀ NỬA QUAN TRỌNG
 * ════════════════════════════════════════════════════════════════════════════
 * Nới một cổng quyền là việc dễ làm SAI THEO CHIỀU IM LẶNG: mở đúng ba thủ tục
 * thì không ai thấy gì khác ngoài "màn chạy được"; mở lố sang thủ tục thứ tư
 * thì cũng **không ai thấy gì** cho tới ngày một `operator` xoá một toà nhà.
 *
 * ⇒ Nên tệp này KHÔNG kiểm "ba thủ tục kia đã mở chưa" (một khẳng định trên tập
 *   ba phần tử, luôn dễ xanh). Nó **liệt kê TOÀN BỘ thủ tục của router** rồi
 *   phân đôi: đúng ba tên trong nhóm ĐỌC-MỞ, **mọi tên còn lại** phải nằm trên
 *   `quyenThietKe`/`adminProcedure`. Thêm một thủ tục mới mà quên cổng, hay nới
 *   nhầm một thủ tục ghi, đều làm tệp này ĐỎ — kể cả thủ tục chưa tồn tại hôm nay.
 *
 * ★ G24 — bốn tên module ở đây (`settings_factory`, `machine_control`,
 *   `analytics_oee`, `machine_status`) đều grep ra được trong mã sản phẩm
 *   (`navigation.tsx`, `twinCanhRouter.ts`), không phải tên bịa trong fixture.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODULE_DOC_HINH_HOC } from "./twinCanhRouter";
import { getNavItemByHref } from "../../client/src/lib/navigation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NGUON = fs.readFileSync(path.join(__dirname, "twinCanhRouter.ts"), "utf8");

/**
 * Ba thủ tục ĐỌC mà `/twin` (Vận hành) BẮT BUỘC gọi được — đọc thẳng từ
 * `TwinVanHanh.tsx`, không chép tay. Nếu màn đổi sang gọi thủ tục thứ tư mà
 * không ai mở cổng cho nó, danh sách này dài ra và ca "mọi thủ tục `/twin` gọi
 * đều mở" ở dưới sẽ đỏ.
 */
const NGUON_MAN_VAN_HANH = fs.readFileSync(
  path.join(__dirname, "../../client/src/pages/TwinVanHanh.tsx"),
  "utf8",
);

/** Tên mọi thủ tục của router + cổng nó đứng trên. Phân tích từ NGUỒN. */
function quetThuTuc(): Array<{ ten: string; cong: string }> {
  const ra: Array<{ ten: string; cong: string }> = [];
  // `  tenThuTuc: protectedProcedure` / `adminProcedure`, rồi dòng `.use(...)` kế tiếp.
  const re = /^ {2}(\w+): (protectedProcedure|adminProcedure)\b/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(NGUON)) !== null) {
    const sau = NGUON.slice(m.index, m.index + 260);
    const u = sau.match(/\.use\((quyen\w+)\(/);
    ra.push({ ten: m[1], cong: u ? u[1] : m[2] });
  }
  return ra;
}

const THU_TUC = quetThuTuc();

/** Ba thủ tục đọc hình học dùng CHUNG giữa `/twin` và `/twin-studio`. */
const DOC_MO = ["danhSachToaNha", "chiTietToaNha", "canhThietKe"];

describe("H2 — thiết bị đo tự canh mình TRƯỚC", () => {
  it("bộ quét tìm được một số lượng thủ tục HỢP LÝ, không phải 0", () => {
    // ⚠ Một regex hỏng trả mảng RỖNG, và MỌI khẳng định "mọi thủ tục ..." bên
    // dưới sẽ xanh trên tập rỗng mà không đo gì (G5). Ô này chặn đúng ca đó.
    expect(THU_TUC.length).toBeGreaterThanOrEqual(20);
    // Và nó phải bắt được cả thủ tục GHI lẫn thủ tục ĐỌC — nếu chỉ bắt một loại
    // thì phép phân đôi bên dưới đang chia một tập đồng nhất.
    expect(THU_TUC.map((x) => x.ten)).toContain("luuToaNha");
    expect(THU_TUC.map((x) => x.ten)).toContain("canhThietKe");
  });

  it("bộ quét ĐỌC ĐƯỢC cổng thật, không trả 'không rõ' hàng loạt", () => {
    const khongRo = THU_TUC.filter((x) => !x.cong.startsWith("quyen"));
    // `sinhTuDong` là `adminProcedure` (không `.use(quyen…)`) — đó là ca duy nhất
    // hợp lệ. Nhiều hơn nghĩa là regex trượt.
    expect(khongRo.map((x) => x.ten)).toEqual(["sinhTuDong"]);
  });
});

describe("H2 — cổng ĐỌC hình học mở đúng bốn module, không hơn", () => {
  it("MODULE_DOC_HINH_HOC là HỢP của cổng Thiết kế và cổng Vận hành", () => {
    expect([...MODULE_DOC_HINH_HOC].sort()).toEqual(
      ["analytics_oee", "machine_control", "machine_status", "settings_factory"].sort(),
    );
  });

  it("★★★ tập này CHỨA trọn cổng nav `/twin` — hết 'một lối vào rồi TỪ CHỐI'", () => {
    // Đây là phát biểu trung tâm của H2: MỌI quyền đủ để THẤY mục menu `/twin`
    // cũng phải đủ để ĐỌC hình học. Ai vào được thì màn chạy được.
    const nav = getNavItemByHref("/twin");
    expect(nav?.requiredPermissionAny).toBeDefined();
    for (const q of nav!.requiredPermissionAny!) {
      expect(MODULE_DOC_HINH_HOC as readonly string[]).toContain(q);
    }
  });

  it("và KHÔNG mở rộng hơn nav `/twin` ∪ nav `/twin-studio` — không phải mở toang", () => {
    // Đối chứng cho ca trên: một cổng "ai cũng vào" cũng làm ca trên xanh mà
    // chẳng chứng minh gì (họ G5). Ô này ghim CẬN TRÊN.
    const hop = new Set([
      ...(getNavItemByHref("/twin")?.requiredPermissionAny ?? []),
      ...(getNavItemByHref("/twin-studio")?.requiredPermissionAny ?? []),
    ]);
    expect([...MODULE_DOC_HINH_HOC].sort()).toEqual([...hop].sort());
  });
});

describe("H2 — nới ĐỌC KHÔNG được nới GHI", () => {
  it("★★★ ĐÚNG ba thủ tục đứng trên `quyenDocHinhHoc`, không phải bốn", () => {
    const mo = THU_TUC.filter((x) => x.cong === "quyenDocHinhHoc").map((x) => x.ten);
    expect(mo.sort()).toEqual([...DOC_MO].sort());
  });

  it("★★★ MỌI thủ tục CÒN LẠI giữ nguyên cổng cũ — kể cả thủ tục thêm sau này", () => {
    // Phép phân đôi TOÀN TẬP: đây là chỗ một thủ tục mới quên cổng sẽ lộ ra.
    const con = THU_TUC.filter((x) => !DOC_MO.includes(x.ten));
    const sai = con.filter(
      (x) => x.cong !== "quyenThietKe" && x.cong !== "quyenVanHanh" && x.cong !== "adminProcedure",
    );
    expect(sai).toEqual([]);
  });

  it("mọi thủ tục có tên nghe như GHI đều đứng trên `quyenThietKe`", () => {
    // Mẫu thứ hai RỜI HẲN với phép phân đôi trên (G9): nếu regex quét cổng sai
    // theo một kiểu, hai phép đo này khó cùng sai theo cùng kiểu đó.
    const ghi = THU_TUC.filter((x) => /^(luu|xoa|dung|sinh|go|tai|ghi)/.test(x.ten));
    expect(ghi.length).toBeGreaterThanOrEqual(8);
    for (const t of ghi) {
      expect([t.ten, t.cong]).toEqual([t.ten, t.ten === "sinhTuDong" ? "adminProcedure" : "quyenThietKe"]);
    }
  });

  it("PHẠM VI TENANT không đi qua cổng quyền — ba thủ tục mở vẫn lọc `phamViCua`", () => {
    // ⚠ Đây là điều kiện mà brief đòi chứng minh trước khi được nới quyền: mở
    //   module quyền KHÔNG cho ai thấy thêm một nhà máy nào, vì trục tenant là
    //   `trongPhamVi(..., phamViCua(ctx))` ở tầng db — hoàn toàn rời với module.
    for (const ten of DOC_MO) {
      const i = NGUON.indexOf(`  ${ten}: protectedProcedure`);
      expect(i).toBeGreaterThan(0);
      const than = NGUON.slice(i, NGUON.indexOf("\n  }),", i));
      expect([ten, than.includes("phamViCua(ctx)")]).toEqual([ten, true]);
    }
  });
});

describe("H2 — màn `/twin` gọi gì thì mở nấy", () => {
  it("mọi `trpc.twinCanh.*` mà TwinVanHanh gọi đều nằm trên cổng ĐỌC hoặc VẬN HÀNH", () => {
    const goi = [...NGUON_MAN_VAN_HANH.matchAll(/trpc\.twinCanh\.(\w+)\.useQuery/g)].map(
      (m) => m[1],
    );
    // Ca dương: màn PHẢI gọi ít nhất ba thủ tục hình học, nếu không phép đo này
    // đang chạy trên tập rỗng.
    expect(goi.length).toBeGreaterThanOrEqual(3);
    for (const ten of goi) {
      const t = THU_TUC.find((x) => x.ten === ten);
      expect([ten, t?.cong]).toEqual([
        ten,
        t?.cong === "quyenVanHanh" ? "quyenVanHanh" : "quyenDocHinhHoc",
      ]);
    }
  });
});
