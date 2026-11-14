/**
 * Phần A2 của `cheDuLieu.redos.test.ts`, chạy TRONG Worker có hạn (rà kiem-dinh C1): nếu một regex của bộ che lùi thảm hoạ thì
 * cheChuoi chặn ĐỒNG BỘ luồng đang chạy — chạy ở luồng chính thì cả tệp test treo tới hạn của vitest (thực tế: treo cổng); chạy ở
 * đây thì Worker bị terminate đúng hạn, ca đỏ lịch sự. KHÔNG dùng trong mã sản xuất.
 */
import { cheChuoi } from "./cheDuLieu";
import { HO_XAU } from "./hoXau";
import { bocPrototype, type GhiCong } from "./redosDo";

export interface KetQuaA2 {
  ho: Array<{ ten: string; k1: number; k8: number }>;
  /** Mọi regex đã chạy trong cheChuoi trên các họ (n nhỏ + 2 cỡ đo). */
  daChay: Array<{ source: string; flags: string }>;
}

export function chayA2(n: number): KetQuaA2 {
  const ghi: GhiCong = { cong: 0, daChay: new Map() };
  const khoiPhuc = bocPrototype(ghi);
  try {
    const ho = HO_XAU.map(([ten, sinh]) => {
      cheChuoi(sinh(500));
      const a = sinh(n);
      const b = sinh(8 * n);
      ghi.cong = 0;
      cheChuoi(a);
      const k1 = ghi.cong / a.length;
      ghi.cong = 0;
      cheChuoi(b);
      return { ten, k1, k8: ghi.cong / b.length };
    });
    return { ho, daChay: [...ghi.daChay.values()].map((r) => ({ source: r.source, flags: r.flags })) };
  } finally {
    khoiPhuc();
  }
}
