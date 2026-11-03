/**
 * SCADA 1b — `useTagSong(adapterId, tagKey)`: MỘT cửa duy nhất để ký hiệu / ô số / faceplate đọc giá trị sống (spec §3.7). Không thành phần nào tự gọi
 * `tagCuaAdapter`. Nguồn:
 *   - "day"  : kênh đẩy `scada:*` đang chạy (kho `KhoScadaLive`);
 *   - "hoi"  : máy chủ tắt kênh (`scada:error DISABLED`) ⇒ hỏi vòng `scadaDiag.tagCuaAdapter` 5 s (cờ SCADA_SOCKET_ENABLED / SCADA_LIVE_CACHE_ENABLED tắt là mặc định);
 *   - "mo_phong": dành cho pha 2B (chưa dùng).
 * Cũ (`cu`) do KHO quyết định (kênh + tick + ngưỡng theo tag) — hook KHÔNG tự suy ra "tươi".
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import { trpc } from "@/lib/trpc";
import { KhoScadaLive, type AdapterSong, type NguonTagSong, type TagSong } from "@/lib/scadaLive";
import { khoaTag } from "@shared/scadaLiveContract";

export interface KetQuaTagSong extends TagSong {
  nguon: NguonTagSong;
}

const CHU_KY_HOI_MS = 5_000;
const KHONG_CO: TagSong = { coMau: false, v: null, q: "bad", tuoiMs: null, cu: true, tuChoi: false, reason: null };

let khoChung: KhoScadaLive | null = null;
/** Kho dùng chung của ứng dụng (một socket dùng chung, một bộ đếm tham chiếu). */
export function layKhoScadaLive(): KhoScadaLive {
  if (!khoChung) {
    khoChung = new KhoScadaLive({
      layKetNoi: () => getSharedSocket(),
      nhaKetNoi: () => releaseSharedSocket(),
    });
  }
  return khoChung;
}

function useDangKy(kho: KhoScadaLive, adapterId: number | null, tagKey: string | null) {
  useEffect(() => {
    if (adapterId === null || tagKey === null) return;
    return kho.dangKy([{ adapterId, tagKey }]);
  }, [kho, adapterId, tagKey]);
}

export function useTagSong(adapterId: number | null, tagKey: string | null, opts?: { kho?: KhoScadaLive }): KetQuaTagSong {
  const kho = opts?.kho ?? layKhoScadaLive();
  const co = adapterId !== null && tagKey !== null;
  useDangKy(kho, adapterId, tagKey);

  const khoa = co ? khoaTag(adapterId, tagKey) : null;
  const nghe = useMemo(() => (fn: () => void) => kho.nghe(khoa, fn), [kho, khoa]);
  const day = useSyncExternalStore(
    nghe,
    () => (co ? kho.doc(adapterId, tagKey) : KHONG_CO),
    () => KHONG_CO,
  );
  const trangThaiKenh = useSyncExternalStore(
    (fn) => kho.nghe(null, fn),
    () => kho.trangThai(),
    () => "chua_noi" as const,
  );

  const hoiVong = co && trangThaiKenh === "khong_co_kenh";
  const hoi = trpc.scadaDiag.tagCuaAdapter.useQuery(
    { adapterId: adapterId ?? 0 },
    { enabled: hoiVong, refetchInterval: CHU_KY_HOI_MS, retry: false },
  );

  if (hoiVong) {
    const dong = hoi.data?.find((t) => t.tagKey === tagKey);
    if (!dong) return { ...KHONG_CO, nguon: "hoi" };
    const coMau = dong.ageMs !== null && dong.ageMs >= 0;
    return {
      coMau,
      v: dong.v as TagSong["v"],
      q: (dong.q ?? "bad") as TagSong["q"],
      tuoiMs: coMau ? Math.floor((dong.ageMs as number) / 1000) * 1000 : null,
      cu: dong.stale || !coMau,
      tuChoi: false,
      reason: dong.reason ?? null,
      nguon: "hoi",
    };
  }
  return { ...day, nguon: "day" };
}

/** Trạng thái phiên kết nối của adapter theo nhịp tim (`scada:tick`). `trangThai: null` = KHÔNG RÕ — không hiện như đã kết nối. */
export function useAdapterSong(adapterId: number | null, opts?: { kho?: KhoScadaLive }): AdapterSong {
  const kho = opts?.kho ?? layKhoScadaLive();
  const nghe = useMemo(() => (fn: () => void) => kho.nghe(null, fn), [kho]);
  return useSyncExternalStore(
    nghe,
    () => (adapterId === null ? KHONG_RO : kho.docAdapter(adapterId)),
    () => KHONG_RO,
  );
}
const KHONG_RO: AdapterSong = { trangThai: null, tuoiMauMoiNhatMs: null, coTick: false };
