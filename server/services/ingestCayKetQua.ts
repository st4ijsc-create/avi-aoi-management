// server/services/ingestCayKetQua.ts
//
// Pha 1B Task 4 — Bộ dịch THUẦN: payload máy v2.0 (cây 4 cấp surface → position →
// capture → component) thành cấu trúc phẳng SẴN SÀNG GHI DB, kèm cuộn kết quả
// (rolledResult/rolledNtf) và thẻ lệch chuẩn (declaredMismatch) ở BA cấp
// surface/position/capture. Task 5 dùng `dichCayKetQua()` để ghi vào
// `inspection_surfaces`/`inspection_positions`/`inspection_captures`/`measurement_results`.
//
// KHÔNG chạm DB: 0 import drizzle/db, 0 `Date.now()`, 0 `Math.random()`. Chỉ nhận
// một payload đã qua `machineDataContractV2.parse()` và trả về dữ liệu — không side effect.
//
// ── Luật cuộn (chốt với chủ dự án, KHÔNG viết lại bằng tay) ──────────────────
// "Bất kỳ NG nào → cả cụm NG. Nếu không, có component nào bị đánh NTF → NTF.
// Còn lại OK." Luật này SỐNG ở `rollupVerdict` (shared/rollupVerdict.ts) — file
// này chỉ GỌI nó ở mỗi cấp, cuộn TỪ DƯỚI LÊN: components → capture → position →
// surface → cả bo.
//
// ⚠ Đầu vào của MỖI cấp cuộn là giá trị ĐÃ CUỘN của cấp con ngay dưới (rolledResult/
// rolledNtf), KHÔNG phải giá trị máy KHAI ở cấp con đó. Đây là điểm cố ý: nếu một
// capture tự nó đã lệch chuẩn (máy khai một đằng, con của nó cuộn ra một nẻo), việc
// dùng rolledResult của capture (chứ không phải result khai) để cuộn lên position bảo
// đảm lỗi/lời-khai-sai ở một cấp không bị "chặn" lại — nó tiếp tục cuộn lên đúng theo
// SỰ THẬT đo được ở lá, xuyên suốt cả cây. `declaredMismatch` ở từng cấp vẫn phát hiện
// ĐÚNG chỗ máy khai sai, độc lập với việc rolled đã cuộn đúng lên trên hay chưa.
//
// QĐ-BG6: surface định danh bằng `surfaceName`, trong phạm vi một bo — KHÔNG sinh
// `surfaceExtId` (cột đó chỉ điền từ đồng bộ teach data ở pha sau, xem
// `docs/superpowers/plans/2026-08-26-aoi-pha1b-ingest-cay.md`).
//
// ── Nguồn NTF (`ntfSource`) ───────────────────────────────────────────────────
// Hợp đồng v2.0 KHÔNG có trường `ntfSource` ở bất kỳ cấp nào — chỉ có cờ `ntf`
// bool tại lá (component). Theo bằng chứng đo được (spec §3.7 Đ-4: TOÀN BỘ NTF
// trong hệ thống hôm nay đến từ máy khai, 0 xác nhận người — `ntfConfirmedAt`
// rỗng 100%), lá gắn `ntfSource: "machine"` khi `ntf === true`, và `null` khi
// không NTF. Nguồn "human"/"both" KHÔNG được suy đoán ở đường v2.0 — đường
// v2.0 không mang luồng người xác nhận tại thời điểm ingest.
//
// ── ★★★ Khối B Task 4 (BG-92) — SPEC-GATE CHẠY Ở ĐÂY, TRƯỚC MỌI PHÉP CUỘN ────
// `opts.cong` (tuỳ chọn) là cổng spec (`./specGateCayV2`). Nó chấm TỪNG lá bằng
// giới hạn ĐÃ DẠY và có thể HẠ `OK` của máy xuống `NG` **trước khi** `rollupVerdict`
// chạy ở cấp capture. Thứ tự đó là điều kiện để cổng có tác dụng: cuộn trước rồi
// mới chấm sẽ để cấp trên chốt OK trong khi cấp lá đã bị nâng thành NG (đúng cảnh
// báo trong docblock `shared/rollupVerdict.ts`). Ở đây nó là HỆ QUẢ CẤU TẠO —
// `dichCapture` gọi `cong.cham` rồi mới gọi `rollupVerdict(components)`.
// ⚠ Hàm vẫn KHÔNG chạm DB: cổng được BƠM VÀO (`opts.cong`), phép tra bản dạy nằm ở
// NƠI GỌI. `import type { CongSpecCayV2 }` bị xoá lúc biên dịch nên tính chất "0
// import DB" của file này KHÔNG đổi. Không truyền `opts.cong` ⇒ hành vi y hệt trước.
import { rollupVerdict, verdictLuuTru, verdictXauHon, type NtfSource, type ResultVerdict } from "@shared/rollupVerdict";
import type { MachineDataContractV2 } from "../contracts/machineDataContractV2";
import type { CongSpecCayV2 } from "./specGateCayV2";

/** Tên kiểu theo đúng chữ ký brief yêu cầu — alias của hợp đồng v2.0 đã zod-parse. */
export type MachinePayloadV2 = MachineDataContractV2;

// Kiểu con lấy TRỰC TIẾP từ hợp đồng (indexed access) — KHÔNG chép tay lại hình
// dạng, để không lệch khi Task 3 sửa `machineDataContractV2.ts`.
type RawSurface = MachinePayloadV2["surfaces"][number];
type RawPosition = RawSurface["positions"][number];
type RawCapture = RawPosition["captures"][number];
type RawComponent = RawCapture["components"][number];

/** Cấp lá (component) — field TRỰC TIẾP từ pipeline máy, không có declared/rolled riêng. */
export interface ComponentDaDich {
  componentId: string;
  componentName?: string;
  result: "OK" | "NG";
  ntf: boolean;
  ntfSource: NtfSource | null;
  value: string | number | null;
  lowerLimit: string | number | null;
  upperLimit: string | number | null;
  errorCode: string | null;
  errorDesc: string | null;
  startedAt?: string;
  completedAt?: string;
  /**
   * ★ Khối B Task 4 (BG-92) — dấu vết của spec-gate cho CHÍNH lá này, ghi thẳng vào
   * `measurement_results.remark` (xem `ghiCayKetQua`). Ba giá trị có nghĩa:
   *   · `"Spec gate: …"`  — TRƯỢT (cùng tiền tố đường v1.x ⇒ một câu SELECT bắt cả hai đường)
   *   · `"[SG:DAT]"`      — ĐÃ CHẤM bằng giới hạn đã dạy và ĐẠT
   *   · `"[SG:KHONG_KL]"` — tra ra bản dạy nhưng KHÔNG chấm được gì ⇒ **không kết luận**
   * `null` = cổng tắt, hoặc linh kiện CHƯA DẠY (khi đó Task 3 cũng không ghi hàng nào).
   * Không có nhãn ở hàng thì "đã kiểm và đạt" và "chưa kiểm gì" trông y hệt nhau
   * trên bảng — đúng hình dạng "giấy vô can giả" mà task này tồn tại để không tạo ra.
   */
  ghiChuCong: string | null;
}

/**
 * Cấp capture — `result`/`ntf` là cái MÁY KHAI trực tiếp (HookCapture); `rolledResult`/
 * `rolledNtf` là cái TA CUỘN từ `components`. `declaredMismatch` = hai bên lệch nhau.
 * Đây là cấp mà lệch chuẩn có giá trị chẩn đoán MẠNH NHẤT (result/ntf khai ở đây
 * KHÔNG phải tự OR ngược từ components — nó là field pipeline máy tự tính).
 */
export interface CaptureDaDich {
  captureId: string;
  captureName?: string;
  index?: number;
  startedAt?: string;
  completedAt?: string;
  result: "OK" | "NG";
  ntf: boolean;
  rolledResult: ResultVerdict;
  rolledNtf: boolean;
  ntfSource: NtfSource | null;
  declaredMismatch: boolean;
  components: ComponentDaDich[];
}

/** Cấp position — cùng khuôn declared/rolled/declaredMismatch như capture, cuộn từ `captures`. */
export interface PositionDaDich {
  positionId: string;
  positionNumber?: number;
  startedAt?: string;
  completedAt?: string;
  result: "OK" | "NG";
  ntf: boolean;
  rolledResult: ResultVerdict;
  rolledNtf: boolean;
  ntfSource: NtfSource | null;
  declaredMismatch: boolean;
  captures: CaptureDaDich[];
}

/**
 * Cấp surface — cấp PHÁI SINH: `HookProductContext` không có node Surface, generator
 * tự gộp theo `HookPosition.SurfaceName` và tự tính `result` bằng worst-case rollup từ
 * `positions[]` con. Vì vậy `declaredMismatch` ở cấp này gần như LUÔN false trên dữ
 * liệu thật — đó là HỆ QUẢ CẤU TẠO (surface.result vốn dĩ đã là một phép cuộn phía
 * máy), KHÔNG phải bằng chứng rằng phép cuộn của TA đúng. Định danh bằng
 * `surfaceName` (QĐ-BG6) — không có `surfaceExtId`.
 */
export interface SurfaceDaDich {
  surfaceName: string;
  result: "OK" | "NG";
  ntf: boolean;
  rolledResult: ResultVerdict;
  rolledNtf: boolean;
  ntfSource: NtfSource | null;
  declaredMismatch: boolean;
  positions: PositionDaDich[];
}

/**
 * Cây đã dịch — cả bo. `overallResult`/`ntf` là cái MÁY KHAI (HookProduct); `rolledResult`/
 * `rolledNtf` là cuộn TỪ CÁC SURFACE (không phải lấy lại overallResult/ntf máy khai).
 *
 * `verdictLuuTru` = XẤU HƠN trong hai `verdictLuuTru` — một tính từ LỜI KHAI cấp bo
 * của máy (`overallResult`/`ntf`), một tính từ CUỘN TỪ CÁC SURFACE — chứ KHÔNG phải
 * chỉ đọc cuộn-từ-lá như bản trước Pha 1C (Đ-21/Đ-22, xem `verdictXauHon`). Đây là
 * verdict SẼ GHI vào cột `product_inspections.overallResult` (ba giá trị OK|NG|NTF).
 *
 * `declaredMismatch` (gốc) = lời khai cấp bo và cuộn-từ-surface có KHỚP verdict lưu
 * trữ hay không — độc lập với `declaredMismatch` ở ba cấp con (surface/position/
 * capture), vốn so sánh trực tiếp `result`/`ntf` chứ không qua `verdictLuuTru`.
 *
 * `ntfSource` (Pha 1C Task 5, BG-35): cuộn TỪ CÁC SURFACE (từ lá) khi có; khi lá
 * không cho nguồn nào NHƯNG `payload.ntf` (khai cấp bo) là NTF, xuất xứ là `"machine"`
 * — payload chính LÀ máy khai. Lá THẮNG khi lá đã cho nguồn (không bao giờ bị ghi đè
 * bởi `payload.ntf`). Xem chi tiết ba trường hợp ở thân hàm `dichCayKetQua`.
 */
export interface CayDaDich {
  overallResult: "OK" | "NG";
  ntf: boolean;
  rolledResult: ResultVerdict;
  rolledNtf: boolean;
  ntfSource: NtfSource | null;
  verdictLuuTru: ResultVerdict;
  declaredMismatch: boolean;
  surfaces: SurfaceDaDich[];
}

/**
 * declared lệch rolled ⇒ true. Công thức CHỐT (task-4-brief.md Bước 3), dùng lại
 * NGUYÊN VĂN ở cả ba cấp surface/position/capture — không viết tay lại logic này
 * riêng từng cấp (một chỗ sửa, một chỗ canh bằng đột biến).
 */
function coLech(
  declaredResult: "OK" | "NG",
  declaredNtf: boolean,
  cuon: { result: ResultVerdict; ntf: boolean },
): boolean {
  return declaredResult !== cuon.result || declaredNtf !== cuon.ntf;
}

function dichComponent(
  c: RawComponent,
  captureExtId: string,
  cong?: CongSpecCayV2,
): ComponentDaDich {
  // ★★★ BG-92 — CHẤM TRƯỚC, CUỘN SAU. `cong.cham` chỉ hạ OK→NG (monotonic, thừa kế
  // `evaluatePointResult`), nên `result` vẫn nằm trong `"OK" | "NG"` của hợp đồng v2.0.
  // ⚠ `value` là trị đo THÔ máy gửi; `lowerLimit`/`upperLimit` MÁY KHAI ở lá CỐ Ý
  // KHÔNG được đưa vào cổng — chấm lời khai bằng chính lời khai là một cổng rỗng.
  const cham = cong?.cham(captureExtId, {
    componentId: c.componentId,
    result: c.result,
    value: c.value ?? null,
  });
  return {
    componentId: c.componentId,
    componentName: c.componentName,
    result: cham?.result ?? c.result,
    ntf: c.ntf,
    // Xem chú thích đầu file — v2.0 chỉ có cờ `ntf` tại lá, nguồn luôn là "machine".
    ntfSource: c.ntf ? "machine" : null,
    value: c.value ?? null,
    lowerLimit: c.lowerLimit ?? null,
    upperLimit: c.upperLimit ?? null,
    errorCode: c.errorCode ?? null,
    errorDesc: c.errorDesc ?? null,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    ghiChuCong: cham?.ghiChu ?? null,
  };
}

function dichCapture(cap: RawCapture, cong?: CongSpecCayV2): CaptureDaDich {
  // components: [] rỗng là hình dạng HỢP LỆ (đèn chụp vùng không có linh kiện) —
  // rollupVerdict([]) trả {result:"OK", ntf:false, ntfSource:null}, KHÔNG ném lỗi.
  // ⚠⚠ ĐỘT BIẾN BẮT BUỘC BG-92: đổi `dichComponent(c, cap.captureId, cong)` thành
  // `dichComponent(c, cap.captureId)` (bỏ cổng) ⇒ linh kiện ngoài giới hạn đã dạy mà
  // máy khai OK lại đi lọt — đúng hành vi TRƯỚC bản vá. Lưới phải ĐỎ.
  const components = cap.components.map((c) => dichComponent(c, cap.captureId, cong));
  const cuon = rollupVerdict(components);
  return {
    captureId: cap.captureId,
    captureName: cap.captureName,
    index: cap.index,
    startedAt: cap.startedAt,
    completedAt: cap.completedAt,
    result: cap.result,
    ntf: cap.ntf,
    rolledResult: cuon.result,
    rolledNtf: cuon.ntf,
    ntfSource: cuon.ntfSource,
    declaredMismatch: coLech(cap.result, cap.ntf, cuon),
    components,
  };
}

function dichPosition(pos: RawPosition, cong?: CongSpecCayV2): PositionDaDich {
  const captures = pos.captures.map((c) => dichCapture(c, cong));
  // Cuộn từ CÁI ĐÃ CUỘN của capture (rolledResult/rolledNtf), không phải result/ntf
  // máy khai ở capture — xem giải thích đầu file.
  const cuon = rollupVerdict(
    captures.map((c) => ({ result: c.rolledResult, ntf: c.rolledNtf, ntfSource: c.ntfSource })),
  );
  return {
    positionId: pos.positionId,
    positionNumber: pos.positionNumber,
    startedAt: pos.startedAt,
    completedAt: pos.completedAt,
    result: pos.result,
    ntf: pos.ntf,
    rolledResult: cuon.result,
    rolledNtf: cuon.ntf,
    ntfSource: cuon.ntfSource,
    declaredMismatch: coLech(pos.result, pos.ntf, cuon),
    captures,
  };
}

function dichSurface(surf: RawSurface, cong?: CongSpecCayV2): SurfaceDaDich {
  const positions = surf.positions.map((p) => dichPosition(p, cong));
  const cuon = rollupVerdict(
    positions.map((p) => ({ result: p.rolledResult, ntf: p.rolledNtf, ntfSource: p.ntfSource })),
  );
  return {
    surfaceName: surf.name,
    result: surf.result,
    ntf: surf.ntf,
    rolledResult: cuon.result,
    rolledNtf: cuon.ntf,
    ntfSource: cuon.ntfSource,
    declaredMismatch: coLech(surf.result, surf.ntf, cuon),
    positions,
  };
}

/**
 * Dịch payload máy v2.0 (đã qua `machineDataContractV2.parse()`) thành cây 4 cấp
 * sẵn sàng ghi DB. Hàm THUẦN: không đọc/ghi DB, không đồng hồ, không số ngẫu nhiên
 * — cùng input luôn cho cùng output.
 *
 * ★★★ `opts.cong` (Khối B Task 4, BG-92) — cổng spec (`./specGateCayV2`), BƠM VÀO từ
 * nơi gọi. Vắng ⇒ hành vi ĐÚNG BẰNG bản trước bản vá (không lời gọi nào). Có ⇒ từng
 * lá bị chấm bằng giới hạn ĐÃ DẠY **trước** khi cuộn, nên một `OK` bị hạ xuống `NG`
 * sẽ cuộn lên đủ bốn cấp và vào `product_inspections.overallResult`.
 * ⚠ Tính THUẦN được giữ theo nghĩa "cùng input cho cùng output": cổng có bộ đếm
 * (`cong.thongKe`) nên nó CÓ TRẠNG THÁI — trạng thái đó thuộc về đối tượng cổng do
 * nơi gọi tạo cho ĐÚNG MỘT lượt ingest, không phải trạng thái toàn cục của module.
 * Gọi hàm này hai lần với CÙNG một cổng sẽ cộng dồn bộ đếm — cố ý, và là lý do mỗi
 * cửa dựng cổng MỚI cho mỗi bo.
 */
export function dichCayKetQua(
  payload: MachinePayloadV2,
  opts?: { cong?: CongSpecCayV2 },
): CayDaDich {
  const surfaces = payload.surfaces.map((s) => dichSurface(s, opts?.cong));
  // Cuộn TỪ CÁC SURFACE (đã cuộn), KHÔNG lấy lại overallResult/ntf máy khai ở
  // cấp payload — đây vẫn là "cuộn-từ-lá" như trước Pha 1C.
  const cuon = rollupVerdict(
    surfaces.map((s) => ({ result: s.rolledResult, ntf: s.rolledNtf, ntfSource: s.ntfSource })),
  );

  // ── Pha 1C, đóng Đ-21 + Đ-22 (BG-22 + BG-24) ──────────────────────────────
  // Verdict lưu trữ TRƯỚC bản vá này chỉ đọc `cuon` — bỏ rơi lời khai cấp bo
  // của máy. Hậu quả đo được: máy khai overallResult="NG" nhưng surfaces:[]
  // (cây rỗng) ⇒ cuộn ra "OK" ⇒ ghi "OK" — bo lỗi thành bo đạt. Và máy khai
  // ntf:true cấp bo nhưng không lá nào ntf ⇒ cuộn ra ntf:false ⇒ mất NTF.
  //
  // LỜI KHAI cấp bo của máy, đưa về cùng bảng chữ cái với kết quả cuộn.
  // `payload.ntf` là NGUỒN NTF THỨ HAI — bỏ nó là tái tạo đúng lỗ 6,55% (Đ-22).
  const khai = verdictLuuTru({ result: payload.overallResult, ntf: payload.ntf });
  const cuonRa = verdictLuuTru({ result: cuon.result, ntf: cuon.ntf });
  // KHÔNG bên nào được làm nhẹ bên kia — xem `verdictXauHon` (Đ-21).
  const verdict = verdictXauHon(khai, cuonRa);

  // ── Pha 1C Task 5, đóng BG-35 — NTF khai ở CẤP BO mất xuất xứ ────────────
  // `cuon.ntfSource` chỉ tổng hợp từ LÁ (qua rollupVerdict ở các surface). Khi
  // `payload.ntf === true` mà không lá nào mang cờ ntf, `cuon.ntfSource` = null dù
  // `verdict` ở trên đã đúng là "NTF" (nhờ verdictXauHon đọc payload.ntf) — máy nói
  // "đây là NTF" mà hệ ghi lại "không rõ ai đánh dấu". `payload.ntf` LÀ máy khai, nên
  // khi nó là nguồn NTF DUY NHẤT, xuất xứ phải là "machine".
  //
  // ⚠ KHÔNG ghi đè khi lá đã cho nguồn (`cuon.ntfSource` khác null) — lá là tín hiệu
  // granular hơn (và là nơi DUY NHẤT "human"/"both" có thể xuất hiện — xem đầu file:
  // v2.0 không mang luồng người xác nhận tại ingest, nhưng hàm này không giả định điều
  // đó mãi mãi đúng). Ba trường hợp:
  //   1. NTF chỉ từ khai cấp bo (payload.ntf=true, cuon.ntfSource=null) → "machine".
  //   2. NTF chỉ từ lá (payload.ntf=false, cuon.ntfSource khác null) → giữ nguyên lá.
  //   3. NTF từ CẢ HAI (payload.ntf=true, cuon.ntfSource khác null) → giữ nguyên lá
  //      (lá đã thắng — không ghi đè, đúng luật trên; v2.0 hôm nay lá chỉ cho "machine"
  //      nên kết quả không đổi, nhưng luật không giả định mãi mãi vậy).
  //   4. Không NTF ở đâu cả (payload.ntf=false, cuon.ntfSource=null) → null (không bịa).
  const ntfSource: NtfSource | null = cuon.ntfSource ?? (payload.ntf ? "machine" : null);

  return {
    overallResult: payload.overallResult,
    ntf: payload.ntf,
    rolledResult: cuon.result,
    rolledNtf: cuon.ntf,
    ntfSource,
    verdictLuuTru: verdict,
    declaredMismatch: khai !== cuonRa,
    surfaces,
  };
}
