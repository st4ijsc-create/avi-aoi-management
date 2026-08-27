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
import { rollupVerdict, verdictLuuTru, type NtfSource, type ResultVerdict } from "@shared/rollupVerdict";
import type { MachineDataContractV2 } from "../contracts/machineDataContractV2";

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
 * `verdictLuuTru` = `verdictLuuTru(cuộn từ các surface)` — verdict SẼ GHI vào cột
 * `product_inspections.overallResult` (ba giá trị OK|NG|NTF), đúng chốt ở
 * `docs/superpowers/plans/2026-08-26-aoi-pha1b-ingest-cay.md` Task 4 Bước 3.
 */
export interface CayDaDich {
  overallResult: "OK" | "NG";
  ntf: boolean;
  rolledResult: ResultVerdict;
  rolledNtf: boolean;
  ntfSource: NtfSource | null;
  verdictLuuTru: ResultVerdict;
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

function dichComponent(c: RawComponent): ComponentDaDich {
  return {
    componentId: c.componentId,
    componentName: c.componentName,
    result: c.result,
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
  };
}

function dichCapture(cap: RawCapture): CaptureDaDich {
  // components: [] rỗng là hình dạng HỢP LỆ (đèn chụp vùng không có linh kiện) —
  // rollupVerdict([]) trả {result:"OK", ntf:false, ntfSource:null}, KHÔNG ném lỗi.
  const components = cap.components.map(dichComponent);
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

function dichPosition(pos: RawPosition): PositionDaDich {
  const captures = pos.captures.map(dichCapture);
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

function dichSurface(surf: RawSurface): SurfaceDaDich {
  const positions = surf.positions.map(dichPosition);
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
 */
export function dichCayKetQua(payload: MachinePayloadV2): CayDaDich {
  const surfaces = payload.surfaces.map(dichSurface);
  // Verdict gốc của cả bo = cuộn từ các surface (đã cuộn), KHÔNG lấy lại
  // overallResult/ntf máy khai ở cấp payload.
  const cuon = rollupVerdict(
    surfaces.map((s) => ({ result: s.rolledResult, ntf: s.rolledNtf, ntfSource: s.ntfSource })),
  );
  return {
    overallResult: payload.overallResult,
    ntf: payload.ntf,
    rolledResult: cuon.result,
    rolledNtf: cuon.ntf,
    ntfSource: cuon.ntfSource,
    verdictLuuTru: verdictLuuTru({ result: cuon.result, ntf: cuon.ntf }),
    surfaces,
  };
}
