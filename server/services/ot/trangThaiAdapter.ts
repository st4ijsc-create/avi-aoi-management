/**
 * SCADA R0 (C1 ở supervisor, C3, N11) — trạng thái KẾT NỐI của từng adapter chạy ở TRUNG TÂM, ghi ngược vào DB
 * (`device_adapters.status/lastConnectedAt/lastErrorAt/lastError`) và phát mẫu `bad` cho MỌI tag khi adapter chuyển sang "mất".
 *
 * Nguồn gọi: otManager (nhánh legacy: attemptLegacyStart/legacyTick; nhánh HA: `onStateChange` của ConnectionSupervisor).
 * Adapter do edge sở hữu KHÔNG bao giờ chạy ở trung tâm ⇒ không bao giờ tới đây (loadEnabledAdapters bỏ qua chúng) ⇒
 * `layTrangThaiAdapter` trả null và KHÔNG có lần ghi "lost" nào cho chúng.
 *
 * Quy tắc:
 *   - Chỉ HÀNH ĐỘNG khi trạng thái ĐỔI (báo lại cùng trạng thái = no-op).
 *   - Mẫu xấu: MỘT lần cho mỗi ĐỢT mất (đợt mất kết thúc khi `connected`); lost → connecting → lost (nối lại thất bại) không
 *     phát lại (chập chờn không kẹt/không spam mỗi tick). Chỉ khi OT_CHAT_LUONG_V2_ENABLED=true.
 *   - Ghi DB (chỉ khi OT_GHI_TRANG_THAI_ADAPTER_ENABLED=true) có ĐIỀU TIẾT 5 s mỗi adapter: lần đổi đầu ghi NGAY nếu lần ghi
 *     trước đã ≥ 5 s; nếu chưa, hẹn MỘT lần ghi cuối (trailing) đúng lúc tròn 5 s mang trạng thái MỚI NHẤT. Lỗi ghi chỉ log.
 */
import type { RuntimeAdapter } from "./deviceAdapter";
import { chatLuongV2Bat, mauXauChoMoiTag } from "./chatLuong";

export type TrangThaiKetNoi = "connecting" | "connected" | "lost" | "disabled";

/** Khoảng điều tiết ghi DB cho mỗi adapter (ms). */
export const KHOANG_GHI_TRANG_THAI_MS = 5_000;

/** Hàm ghi DB (test seam). `at` = thời điểm trạng thái ĐỔI (không phải lúc ghi). */
export type GhiDb = (adapterId: number, tt: TrangThaiKetNoi, loi: string | null, at: Date) => Promise<void>;

interface CanBao {
  tt: TrangThaiKetNoi;
  loi: string | null;
  at: Date;
}

interface BanGhi {
  tt: TrangThaiKetNoi;
  tu: Date;
  loi: string | null;
  soLanMat: number;
  /** Đợt mất hiện tại đã phát mẫu xấu chưa (xoá khi `connected`). */
  daPhatXau: boolean;
  /** Date.now() của lần ghi DB gần nhất (0 = chưa ghi). */
  ghiLuc: number;
  hen: ReturnType<typeof setTimeout> | null;
  choGhi: CanBao | null;
}

const trangThai = new Map<number, BanGhi>();
let ghiDbThay: GhiDb | null = null;

function ghiDbBat(): boolean {
  return process.env.OT_GHI_TRANG_THAI_ADAPTER_ENABLED === "true";
}

/** Ghi mặc định: `device_adapters` theo ánh xạ connecting→connecting, connected→connected(+lastConnectedAt), lost→error(+lastError/lastErrorAt), disabled→disabled. */
const ghiDbMacDinh: GhiDb = async (adapterId, tt, loi, at) => {
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return;
  const { deviceAdapters } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const set: Partial<typeof deviceAdapters.$inferInsert> =
    tt === "connected"
      ? { status: "connected", lastConnectedAt: at }
      : tt === "lost"
        ? { status: "error", lastError: loi ?? "comm_lost", lastErrorAt: at }
        : { status: tt };
  await db.update(deviceAdapters).set(set).where(eq(deviceAdapters.id, adapterId));
};

function ghiNgay(adapterId: number, b: BanGhi, c: CanBao): void {
  b.ghiLuc = Date.now();
  const ghi = ghiDbThay ?? ghiDbMacDinh;
  void Promise.resolve()
    .then(() => ghi(adapterId, c.tt, c.loi, c.at))
    .catch((err) => console.warn(`[OT] ghi trạng thái adapter ${adapterId} (${c.tt}) lỗi: ${(err as Error)?.message ?? err}`));
}

function lenLichGhi(adapterId: number, b: BanGhi, c: CanBao): void {
  const troi = Date.now() - b.ghiLuc;
  if (b.ghiLuc === 0 || troi >= KHOANG_GHI_TRANG_THAI_MS) {
    ghiNgay(adapterId, b, c);
    return;
  }
  // Chưa đủ 5 s: chỉ GIỮ trạng thái mới nhất; đúng MỘT hẹn giờ cho mỗi adapter.
  b.choGhi = c;
  if (b.hen) return;
  const timer = setTimeout(() => {
    b.hen = null;
    const ct = b.choGhi;
    b.choGhi = null;
    if (ct && ghiDbBat()) ghiNgay(adapterId, b, ct);
  }, KHOANG_GHI_TRANG_THAI_MS - troi);
  if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
  b.hen = timer;
}

/** MỘT promise import chung (như otManager.loadIngest): import động chồng nhau của cùng module có thể nhận bản khác nhau dưới vite-node. */
let ingestModule: Promise<typeof import("./ingest")> | null = null;
function loadIngest(): Promise<typeof import("./ingest")> {
  if (!ingestModule) {
    ingestModule = import("./ingest");
    ingestModule.catch(() => {
      ingestModule = null;
    });
  }
  return ingestModule;
}

function phatMauXau(a: Pick<RuntimeAdapter, "adapterId" | "code" | "machineId" | "protocol" | "tags">, at: Date): void {
  if (a.tags.length === 0) return;
  void loadIngest()
    .then((m) => m.ingestSamples(a as RuntimeAdapter, mauXauChoMoiTag(a.tags, "comm_lost", "comm_lost", at)))
    .catch((err) => console.warn(`[OT] phát mẫu xấu khi mất kết nối "${a.code}" lỗi: ${(err as Error)?.message ?? err}`));
}

/**
 * Báo trạng thái kết nối MỚI của một adapter chạy ở trung tâm. Đồng bộ, không bao giờ ném.
 * `loi` chỉ có nghĩa với `lost` (ghi vào `lastError`).
 */
export function baoTrangThaiAdapter(
  a: Pick<RuntimeAdapter, "adapterId" | "code" | "machineId" | "protocol" | "tags">,
  tt: TrangThaiKetNoi,
  loi: string | null,
  now: Date = new Date(),
): void {
  try {
    let b = trangThai.get(a.adapterId);
    if (b && b.tt === tt) return;
    if (!b) {
      b = { tt, tu: now, loi: null, soLanMat: 0, daPhatXau: false, ghiLuc: 0, hen: null, choGhi: null };
      trangThai.set(a.adapterId, b);
    }
    b.tt = tt;
    b.tu = now;
    b.loi = tt === "lost" ? loi : null;
    if (tt === "lost") b.soLanMat += 1;
    if (tt === "connected") b.daPhatXau = false;

    if (tt === "lost" && !b.daPhatXau && chatLuongV2Bat()) {
      b.daPhatXau = true;
      phatMauXau(a, now);
    }
    if (ghiDbBat()) lenLichGhi(a.adapterId, b, { tt, loi: b.loi, at: now });
  } catch (err) {
    console.warn(`[OT] baoTrangThaiAdapter ${a.adapterId} lỗi: ${(err as Error)?.message ?? err}`);
  }
}

/** Trạng thái kết nối hiện tại của adapter (null = chưa từng báo — gồm mọi adapter do edge sở hữu). */
export function layTrangThaiAdapter(
  adapterId: number,
): { tt: TrangThaiKetNoi; tu: Date; loi: string | null; soLanMat: number } | null {
  const b = trangThai.get(adapterId);
  return b ? { tt: b.tt, tu: b.tu, loi: b.loi, soLanMat: b.soLanMat } : null;
}

/** Chỉ cho test: xoá mọi trạng thái và huỷ mọi hẹn ghi (hàm ghi thay thế do `__datGhiDb` quản). */
export function __datLaiTrangThaiAdapter(): void {
  for (const b of trangThai.values()) {
    if (b.hen) clearTimeout(b.hen);
  }
  trangThai.clear();
}

/** Chỉ cho test: thay hàm ghi DB (null = dùng ghi thật). */
export function __datGhiDb(fn: GhiDb | null): void {
  ghiDbThay = fn;
}
