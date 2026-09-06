/**
 * CanhVanHanh2D.tsx — bản 2D của cảnh vận hành (§9.9).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHÔNG DÙNG THẲNG `factory-scene/FactoryScene2D.tsx`
 * ════════════════════════════════════════════════════════════════════════════
 * `FactoryScene2D` (361 dòng, đã có sẵn) nhận `MachineNode` với tập trạng thái
 * **`running | idle | down | offline | maintenance`** — hợp đồng của
 * `factoryCommand.overview`. Màn Vận hành chạy trên tập trạng thái KHÁC: 8 giá
 * trị `operationStatusEnum` của DB **cộng hai trạng thái riêng của cảnh**
 * (`khong_ro`, `ngung_khai_thac`).
 *
 * Nối thẳng vào nó sẽ ép 8+2 giá trị xuống 5 ô, và `starved`/`blocked`/
 * `warming_up`/`changeover` KHÔNG có ô nào — chúng sẽ rơi vào một ô mặc định.
 * Đúng cảnh báo mà `CanhNhaMay.tsx` (Đợt 1) đã ghi sẵn cho đợt này:
 *
 *   > "Hợp nhất hai hệ trạng thái là việc của màn `/twin` mới (Đợt 5), nơi dữ
 *   > liệu đến từ `trangThaiHangLoat` với đúng enum của DB."
 *
 * ⇒ Bản 2D ở đây vẽ từ **cùng một `MayTrongLo`** mà bản 3D dùng, qua **cùng một
 *   `mauTrangThai.ts`**. Đó là điều kiện của §9.9 ("bản 2D render từ CHÍNH dữ
 *   liệu đó") — nếu hai bản đọc hai nguồn thì chúng sẽ lệch nhau, và lúc đó bản
 *   fallback lại nói khác bản chính về cùng một nhà máy.
 *
 * ★ SVG, không canvas — mỗi máy là một `<rect>` DOM thật, nên:
 *   • Playwright click được, trình đọc màn hình đọc được
 *   • KHÔNG tốn WebGL context (đây là fallback khi WebGL hỏng — RB-4)
 */

import { useMemo } from "react";

import { giaiMauCanh, mauChoTrangThai } from "../mauTrangThai";
import { mmSangMet } from "../heToaDo";
import type { MayTrongLo } from "../loi";

export interface CanhVanHanh2DProps {
  may: readonly MayTrongLo[];
  /** Trạng thái ĐÃ xét tuổi, tra theo `machineId` — cùng nguồn với bản 3D. */
  trangThaiTheoMay: ReadonlyMap<number, string>;
  /** Mã máy để hiện nhãn + đọc bằng trình đọc màn hình. */
  maTheoMay: ReadonlyMap<number, string>;
  machineIdChon: number | null;
  onChonMay: (machineId: number | null) => void;
  sanRongM: number;
  sanSauM: number;
  /** Nhãn trạng thái ĐÃ qua `t()` — component không gọi `t()` (RB-8.3). */
  nhanTrangThai: (trangThai: string) => string;
  ariaLabel: string;
}

/** Lề quanh mặt sàn, mét — để máy sát mép không bị cắt. */
const LE_M = 2;

export function CanhVanHanh2D({
  may,
  trangThaiTheoMay,
  maTheoMay,
  machineIdChon,
  onChonMay,
  sanRongM,
  sanSauM,
  nhanTrangThai,
  ariaLabel,
}: CanhVanHanh2DProps) {
  const rong = Math.max(sanRongM, 10) + LE_M * 2;
  const sau = Math.max(sanSauM, 10) + LE_M * 2;

  /**
   * Phân giải màu MỘT LẦN cho mỗi trạng thái xuất hiện, không mỗi máy: mỗi lượt
   * `giaiMauCanh` gọi `getComputedStyle`, và gọi nó 42 lần mỗi render là một
   * reflow không cần thiết.
   */
  const mauTheoTrangThai = useMemo(() => {
    const m = new Map<string, { mau: string; doMo: number; gachCheo: boolean }>();
    for (const tt of new Set(trangThaiTheoMay.values())) {
      const kieu = mauChoTrangThai(tt);
      m.set(tt, {
        mau: giaiMauCanh(kieu.token) ?? "#94a3b8",
        doMo: kieu.doMo,
        gachCheo: kieu.hoaTiet === "gach_cheo",
      });
    }
    return m;
  }, [trangThaiTheoMay]);

  return (
    <svg
      viewBox={`${-LE_M} ${-LE_M} ${rong} ${sau}`}
      className="h-full w-full"
      role="img"
      aria-label={ariaLabel}
      data-testid="canh-van-hanh-2d"
      onClick={(e) => {
        // Click nền = bỏ chọn, cùng hành vi `onPointerMissed` của bản 3D.
        if (e.target === e.currentTarget) onChonMay(null);
      }}
    >
      <defs>
        {/*
          ★ NT-3 — HOẠ TIẾT GẠCH CHÉO cho `khong_ro`, y hệt bản 3D.
          Mã hoá dư thừa (§10.3 luật 2): người mù màu vẫn phân biệt được "không
          rõ" với "đang chạy" nhờ hoạ tiết, không chỉ nhờ sắc xám.
        */}
        <pattern id="twin-gach-cheo" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="currentColor" opacity="0.25" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" opacity="0.9" />
        </pattern>
      </defs>

      {/* Mặt sàn — xám trung tính (§10.1). */}
      <rect x="0" y="0" width={sanRongM} height={sanSauM} className="fill-muted/40 stroke-border" strokeWidth="0.1" />

      {may.map((m) => {
        const tt = trangThaiTheoMay.get(m.machineId) ?? "khong_ro";
        const kieu = mauTheoTrangThai.get(tt) ?? { mau: "#94a3b8", doMo: 1, gachCheo: true };
        const rongM = mmSangMet(m.kichThuocMm.rongMm);
        const sauM = mmSangMet(m.kichThuocMm.sauMm);
        const daChon = m.machineId === machineIdChon;
        const ma = maTheoMay.get(m.machineId) ?? `#${m.machineId}`;

        return (
          <g
            key={m.machineId}
            transform={`translate(${m.viTri.x} ${m.viTri.z}) rotate(${(-m.gocXoayRad * 180) / Math.PI})`}
            data-testid={`may-2d-${m.machineId}`}
            data-trang-thai={tt}
            style={{ cursor: "pointer" }}
            onClick={() => onChonMay(m.machineId)}
          >
            <rect
              x={-rongM / 2}
              y={-sauM / 2}
              width={rongM}
              height={sauM}
              fill={kieu.mau}
              fillOpacity={kieu.doMo}
              stroke={daChon ? "currentColor" : kieu.mau}
              strokeWidth={daChon ? 0.28 : 0.05}
            />
            {/* Lớp hoạ tiết chồng lên — chỉ cho `khong_ro`. */}
            {kieu.gachCheo ? (
              <rect
                x={-rongM / 2}
                y={-sauM / 2}
                width={rongM}
                height={sauM}
                fill="url(#twin-gach-cheo)"
                color={kieu.mau}
                pointerEvents="none"
              />
            ) : null}
            {/* Trình đọc màn hình đọc được TỪNG máy — không chỉ tóm tắt cả cảnh. */}
            <title>{`${ma} — ${nhanTrangThai(tt)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export default CanhVanHanh2D;
