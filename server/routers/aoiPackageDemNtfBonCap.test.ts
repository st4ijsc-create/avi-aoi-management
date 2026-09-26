/**
 * ⛔ N-7 (re-review lượt 8) — 100% gói NTF **TRUNG THỰC** bị gắn cờ lệch.
 *
 * ── Lỗi được đóng ở đây ────────────────────────────────────────────────────
 * Bốn nhóm đếm (`demBonNhomTuCay`) dùng HAI ĐỊNH NGHĨA khác nhau cho cùng chữ
 * "ntf" TRONG CÙNG MỘT phép cuộn:
 *   · `demNhomComponent` (cấp component) đếm **cờ `ntf`** của nút.
 *   · `demNhom` (surfaces/positions/captures) đếm theo `rolledResult`, mà
 *     `rolledResult` trên đường v2 **KHÔNG BAO GIỜ** là `"NTF"`: hợp đồng máy
 *     khai `result: z.enum(["OK","NG"])` ở MỌI cấp và `rollupVerdict` chỉ trả
 *     `"NTF"` khi một CON có `result === "NTF"`. ⇒ nhánh `ntf` của `demNhom` là
 *     **mã CHẾT** ở đó: ba cấp trên KHÔNG THỂ đếm ra `ntf > 0`, dù cây nói gì.
 *
 * Hệ quả ĐO ĐƯỢC: một máy khai `summary` ĐÚNG THEO CHÍNH CÂY NÓ GỬI vẫn bị
 * `coLechSummary` trả `true` ⇒ `package_activity_logs.metadata.
 * summaryDeclaredMismatch = true` cho **100%** gói NTF. Cờ sinh ra để soi đúng
 * loại bo đáng để ý nhất trở thành nhiễu 100% trên chính loại bo đó.
 *
 * ── Vì sao KHÔNG chọn "bỏ `ntf` khỏi phép so cho 3 cấp trên" ──────────────
 * Vì phép đo bác bỏ nó. Lời khai NTF trung thực CHUẨN của dự án — hình dạng
 * `ntfThatTuCoNguoiXacNhanChuaXacNhan` trong `BANG_HINH_DANG` (file này DÙNG
 * THẲNG nó, không chép tay bản thứ hai) — khai `nhom(1, 0, 0, 1)` ở **cả bốn**
 * nhóm: `pass: 0`, `ntf: 1`. Số đếm cũ cho ba cấp trên là `pass: 1`, `ntf: 0`.
 * ⇒ Bỏ riêng `ntf` khỏi phép so vẫn còn **`pass` lệch** (0 vs 1) ⇒ cờ vẫn nổ.
 * Muốn đóng bằng cách đó phải bỏ luôn `pass`, tức moi ruột bộ dò.
 *
 * ⇒ Chọn: **đếm cờ `ntf` ở CẢ BỐN cấp**, bằng ĐÚNG MỘT hàm cho cả bốn — chính
 * là quy tắc `demNhomComponent` vốn đã dùng ở lá, nay áp cho mọi cấp. Đây cũng
 * là điều máy làm: `D:\SOURCES\AOIData\sync-json-samples-reference.md` cho thấy
 * cờ `Ntf` có ở MỌI cấp Hook (`HookPosition.Ntf`, `HookCapture.Ntf`,
 * `HookComponent.Ntf`; `surfaces[].ntf` là worst-case rollup của generator) và
 * `summary` là *"tự tính (generator) — Đếm total/pass/ng/ntf **từng cấp**"*.
 * Máy đếm cờ từng cấp; máy chủ nay đếm cùng thứ đó.
 *
 * ── Cột báo cáo KHÔNG đổi (quyết định được KHAI, không trôi ngầm) ─────────
 * `inspection_packages.okCount` giữ nguyên nghĩa **"số capture ĐẠT"**, trong đó
 * NTF **là** ĐẠT — cùng lời khai `shared/kpiYield.ts` `FINAL_YIELD_PASS_RESULTS
 * = ["OK","NTF"]` đang áp cho final yield. Nên `demTuCayBaoCao.ok` = `pass +
 * ntf` của nhóm captures ⇒ mọi gói (kể cả NTF) giữ nguyên `okCount + ngCount
 * === totalPoints` và giữ nguyên con số đã ghi cho mọi gói đã có. §3 dưới đây
 * GHIM điều đó — nếu ai đó đổi sang cách hiểu kia, ca này phải đỏ trước.
 */
import { describe, it, expect } from "vitest";
import { BANG_HINH_DANG } from "../contracts/hinhDangHopDongMetaJson";
import { machineDataContractV2 } from "../contracts/machineDataContractV2";
import { dichCayKetQua } from "../services/ingestCayKetQua";
import { demBonNhomTuCay, coLechSummary } from "./aoiPackageRouter";

/** Hình dạng NTF-do-CỜ chuẩn của dự án — lấy TỪ bảng, không chép tay. */
const HD_NTF = BANG_HINH_DANG.find((h) => h.ten === "ntfThatTuCoNguoiXacNhanChuaXacNhan");

function cayTuHinhDang(meta: unknown) {
  const payload = machineDataContractV2.parse(meta);
  return { payload, cay: dichCayKetQua(payload) };
}

describe("⛔ N-7 — đếm NTF phải DÙNG MỘT ĐỊNH NGHĨA ở cả bốn cấp", () => {
  it("cầu chì — hình dạng NTF chuẩn phải còn trong BANG_HINH_DANG và khai ntf ở CẢ BỐN nhóm (nếu không, mọi ca dưới đo nhầm thứ)", () => {
    expect(HD_NTF, "hình dạng `ntfThatTuCoNguoiXacNhanChuaXacNhan` phải còn tồn tại").toBeTruthy();
    const s = (HD_NTF!.meta as { summary: Record<string, { total: number; pass: number; ng: number; ntf: number }> }).summary;
    for (const nhom of ["surfaces", "positions", "captures", "components"] as const) {
      expect(s[nhom].ntf, `lời khai chuẩn của dự án đặt ntf=1 ở nhóm ${nhom}`).toBe(1);
      expect(s[nhom].pass, `và pass=0 ở nhóm ${nhom} — nên bỏ RIÊNG \`ntf\` khỏi phép so KHÔNG đóng được cờ`).toBe(0);
    }
  });

  it("★★★ §1 — máy khai `summary` ĐÚNG THEO CÂY NÓ GỬI ⇒ `coLechSummary` phải FALSE (trước bản vá: TRUE cho 100% gói NTF)", () => {
    const { payload, cay } = cayTuHinhDang(HD_NTF!.meta);
    const dem = demBonNhomTuCay(cay);
    expect(
      coLechSummary(payload.summary, dem),
      "một gói NTF TRUNG THỰC bị gắn `summaryDeclaredMismatch=true` = cờ nhiễu 100% trên đúng loại bo mà cờ đó " +
        "sinh ra để soi",
    ).toBe(false);
  });

  it("§2 — cả BỐN nhóm đếm ra ntf=1/pass=0 cho payload NTF-do-cờ (một định nghĩa, không phải hai)", () => {
    const { cay } = cayTuHinhDang(HD_NTF!.meta);
    const dem = demBonNhomTuCay(cay);
    for (const nhom of ["surfaces", "positions", "captures", "components"] as const) {
      expect(dem[nhom].ntf, `nhóm ${nhom} phải đếm được cờ ntf (trước bản vá: nhánh ntf của demNhom là mã CHẾT)`).toBe(1);
      expect(dem[nhom].pass, `và KHÔNG xếp cùng nút đó vào pass — total = pass+ng+ntf`).toBe(0);
      expect(dem[nhom].total).toBe(dem[nhom].pass + dem[nhom].ng + dem[nhom].ntf);
    }
    expect(cay.verdictLuuTru, "verdict lưu trữ KHÔNG bị phép đếm đụng tới — vẫn cuộn từ cây (bất biến 3)").toBe("NTF");
  });

  it("§3 GHIM cột báo cáo — `okCount` giữ nghĩa 'số capture ĐẠT' (NTF LÀ đạt, cùng FINAL_YIELD_PASS_RESULTS)", () => {
    const { cay } = cayTuHinhDang(HD_NTF!.meta);
    const dem = demBonNhomTuCay(cay);
    // ĐÚNG công thức `aoiPackageRouter.commit` dùng cho ba cột báo cáo.
    const okBaoCao = dem.captures.pass + dem.captures.ntf;
    expect(okBaoCao, "gói NTF 1 capture vẫn ghi okCount=1 — KHÔNG đổi con số của bất kỳ gói nào đã có").toBe(1);
    expect(okBaoCao + dem.captures.ng, "okCount + ngCount === totalPoints vẫn ĐÚNG").toBe(dem.captures.total);
    const kyVong = HD_NTF!.kyVong;
    expect(kyVong.loai, "hình dạng NTF phải là ca CHẤP NHẬN (mới có cột báo cáo để so)").toBe("chapNhan");
    expect(
      (kyVong as { ok: number }).ok,
      "và khớp `kyVong.ok` mà cổng tích hợp §A của I-1 đo trên gói THẬT",
    ).toBe(1);
  });

  it("§4 ĐỐI CHỨNG — bộ dò VẪN bắt được lời khai SAI (khai ntf=0 ở captures trong khi cây gắn cờ)", () => {
    const { payload, cay } = cayTuHinhDang(HD_NTF!.meta);
    const dem = demBonNhomTuCay(cay);
    const khaiSai = {
      ...payload.summary,
      captures: { total: 1, pass: 1, ng: 0, ntf: 0 },
    };
    expect(
      coLechSummary(khaiSai, dem),
      "bản vá KHÔNG được làm bộ dò mù: một summary mâu thuẫn với CHÍNH cây máy gửi vẫn phải nổ cờ",
    ).toBe(true);
  });

  it("§5 ĐỐI CHỨNG — gói KHÔNG NTF (toàn OK) khai đúng vẫn FALSE, và một chữ số sai vẫn TRUE", () => {
    const hdOk = BANG_HINH_DANG.find((h) => h.ten === "toiThieuMoiTruongOptionalVangMat");
    expect(hdOk, "hình dạng tối thiểu toàn OK phải còn trong bảng").toBeTruthy();
    const { payload, cay } = cayTuHinhDang(hdOk!.meta);
    const dem = demBonNhomTuCay(cay);
    expect(coLechSummary(payload.summary, dem), "gói OK khai đúng KHÔNG được gắn cờ").toBe(false);
    expect(
      coLechSummary({ ...payload.summary, positions: { ...payload.summary.positions, ng: 99 } }, dem),
      "và một chữ số sai vẫn phải nổ cờ",
    ).toBe(true);
  });
});
