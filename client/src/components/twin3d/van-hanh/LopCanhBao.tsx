/**
 * LopCanhBao.tsx — badge cảnh báo trên cảnh 3D, theo **BA LUẬT CỨNG của §10.3**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LUẬT 1 — VẼ Ở KHÔNG GIAN MÀN HÌNH, KHÔNG Ở KHÔNG GIAN THẾ GIỚI
 * ════════════════════════════════════════════════════════════════════════════
 * Badge KHÔNG phải sprite trong thế giới. Nếu là sprite, phối cảnh sẽ thu nhỏ
 * một badge P1 ở cuối xưởng thành vài pixel không đọc nổi — và alarm càng xa thì
 * càng khó thấy, tức là ĐÚNG NGƯỢC với thứ ta cần. Nên: chiếu điểm neo ra pixel
 * (`Vector3.project`) rồi vẽ DOM **cỡ cố định**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LUẬT 2 — MÃ HOÁ DƯ THỪA: HÌNH DẠNG + MÀU + CHỮ
 * ════════════════════════════════════════════════════════════════════════════
 * Màu đơn thuần KHÔNG BAO GIỜ là dấu hiệu duy nhất (khoảng 8 % nam giới mù màu
 * đỏ-lục; và màn hình panel-PC trong xưởng thường bị ám vàng). Mỗi badge mang cả
 * ba: một KÝ TỰ hình dạng (▲ / ◆ / ●), một MÀU token, và CHỮ mức độ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LUẬT 3 — GÓC CAMERA KHÔNG BAO GIỜ ĐƯỢC CHE MỘT ALARM ĐANG HOẠT ĐỘNG
 * ════════════════════════════════════════════════════════════════════════════
 * Đây là luật khó nhất và là lý do §10.3 tồn tại. Một alarm nằm sau lưng camera,
 * hoặc lệch ra ngoài mép canvas, sẽ **BIẾN MẤT** nếu ta chỉ chiếu rồi vẽ — người
 * vận hành xoay camera đi một chút là mất luôn cảnh báo P1, mà không có gì báo
 * rằng nó vừa mất. Đó chính là chế độ hỏng mà quy tắc "No 3D" của ASM sinh ra để
 * phòng, và là cái giá ta phải trả để được giữ 3D.
 *
 * ⇒ Alarm ngoài khung được **KẸP VỀ RÌA** màn hình và vẽ kèm **mũi tên chỉ
 *   hướng** tới vị trí thật. Không alarm nào rời khỏi màn hình bao giờ.
 *
 * ★ RB-7 — component này không cấp phát geometry/material nào (toàn DOM), nên
 *   không có gì phải `dispose()`.
 */

import { useCallback, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import { giaiMauCanh } from "../mauTrangThai";

/** Mức độ cảnh báo — khớp `andon_events.state`. */
export type MucCanhBao = "call" | "yellow" | "red";

export interface CanhBaoTheGioi {
  /** `andon_events.id`. */
  id: number;
  machineId: number | null;
  /** Điểm neo trong thế giới (đỉnh máy + khoảng hở). */
  viTri: { x: number; y: number; z: number };
  muc: MucCanhBao;
  /** Nhãn ngắn ĐÃ qua `t()` — component này không gọi `t()` (RB-8.3). */
  nhan: string;
  /** Đã xác nhận chưa — alarm đã ack vẫn hiện nhưng nhạt hơn. */
  daAck: boolean;
}

export interface LopCanhBaoProps {
  canhBao: readonly CanhBaoTheGioi[];
  /** Trần badge đồng thời. Nhiều hơn thì gộp thành một chip "+N". */
  tran?: number;
}

/** Trần badge — thấp hơn trần nhãn (30) vì badge to hơn và quan trọng hơn. */
export const TRAN_BADGE = 12;

/**
 * Mã hoá DƯ THỪA (luật 2): mỗi mức có hình dạng + token màu + trọng số riêng.
 *
 * ⚠ Ba token này nằm trong bảng ≤ 7 mã của §10.2 (`--destructive`, `--warning`,
 *   `--info`) — KHÔNG thêm mã thứ tám ở đây.
 */
const KIEU_MUC: Readonly<
  Record<MucCanhBao, { hinh: string; token: string; uuTien: number }>
> = {
  // Đỏ = critical. Tam giác — hình dạng "nguy hiểm" quy ước quốc tế.
  red: { hinh: "▲", token: "--destructive", uuTien: 3 },
  // Vàng = warning. Thoi.
  yellow: { hinh: "◆", token: "--warning", uuTien: 2 },
  // Xanh dương = information / gọi hỗ trợ. Tròn.
  call: { hinh: "●", token: "--info", uuTien: 1 },
};

interface BadgeDaChieu {
  id: number;
  x: number;
  y: number;
  muc: MucCanhBao;
  nhan: string;
  daAck: boolean;
  /** true ⇒ alarm nằm ngoài khung, badge đã bị kẹp về rìa (luật 3). */
  ngoaiKhung: boolean;
  /** Góc mũi tên chỉ về vị trí thật, radian. Chỉ có nghĩa khi `ngoaiKhung`. */
  gocMuiTen: number;
}

/** Lề tối thiểu khi kẹp badge vào rìa, px. */
const LE_RIA_PX = 28;

export function LopCanhBao({ canhBao, tran = TRAN_BADGE }: LopCanhBaoProps) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const [hienThi, setHienThi] = useState<BadgeDaChieu[]>([]);
  const [soAn, setSoAn] = useState(0);
  const tamRef = useRef(new THREE.Vector3());
  const chuKyRef = useRef("");

  const tinhLai = useCallback(() => {
    if (canhBao.length === 0) {
      if (hienThi.length !== 0) {
        setHienThi([]);
        setSoAn(0);
      }
      return;
    }

    const ra: BadgeDaChieu[] = [];
    const tamMh = { x: size.width / 2, y: size.height / 2 };

    for (const cb of canhBao) {
      const p = tamRef.current.set(cb.viTri.x, cb.viTri.y, cb.viTri.z);
      const v = p.clone().project(camera);

      // ★ LUẬT 3 — `v.z > 1` nghĩa là SAU LƯNG camera. Không được bỏ qua: đó
      //   chính là ca "xoay camera đi một chút là mất cảnh báo P1".
      const sauLung = v.z > 1 || !Number.isFinite(v.x) || !Number.isFinite(v.y);
      // Sau lưng camera thì toạ độ chiếu bị LẬT dấu — phải đảo lại trước khi kẹp,
      // nếu không mũi tên sẽ chỉ đúng ngược hướng.
      const nx = sauLung ? -v.x : v.x;
      const ny = sauLung ? -v.y : v.y;

      let x = ((nx + 1) / 2) * size.width;
      let y = ((1 - ny) / 2) * size.height;

      const ngoai =
        sauLung || x < LE_RIA_PX || x > size.width - LE_RIA_PX || y < LE_RIA_PX || y > size.height - LE_RIA_PX;

      let goc = 0;
      if (ngoai) {
        // Kẹp về rìa dọc theo tia từ tâm màn hình tới vị trí chiếu.
        const dx = x - tamMh.x;
        const dy = y - tamMh.y;
        goc = Math.atan2(dy, dx);
        const nuaRong = size.width / 2 - LE_RIA_PX;
        const nuaCao = size.height / 2 - LE_RIA_PX;
        // Tỉ lệ để tia chạm cạnh gần nhất của hình chữ nhật (không phải hình tròn
        // — kẹp theo tròn để lại bốn góc màn hình trống trong khi badge chen chúc
        // ở giữa các cạnh).
        const t = Math.min(
          nuaRong / Math.max(1e-6, Math.abs(dx)),
          nuaCao / Math.max(1e-6, Math.abs(dy)),
        );
        x = tamMh.x + dx * t;
        y = tamMh.y + dy * t;
      }

      ra.push({
        id: cb.id,
        x,
        y,
        muc: cb.muc,
        nhan: cb.nhan,
        daAck: cb.daAck,
        ngoaiKhung: ngoai,
        gocMuiTen: goc,
      });
    }

    /**
     * Sắp theo ĐỘ NGHIÊM TRỌNG trước, rồi mới tới thứ tự id — KHÔNG theo khoảng
     * cách camera. Nếu cắt theo khoảng cách, một alarm P1 ở cuối xưởng sẽ bị 12
     * alarm P3 ở gần đẩy ra khỏi trần. Alarm chưa ack xếp trước alarm đã ack.
     */
    ra.sort((a, b) => {
      if (a.daAck !== b.daAck) return a.daAck ? 1 : -1;
      const ua = KIEU_MUC[a.muc].uuTien;
      const ub = KIEU_MUC[b.muc].uuTien;
      if (ua !== ub) return ub - ua;
      return a.id - b.id;
    });

    const ve = ra.slice(0, tran);
    const an = ra.length - ve.length;

    const chuKy = `${an}|${ve.map((v) => `${v.id}:${Math.round(v.x)}:${Math.round(v.y)}:${v.ngoaiKhung ? 1 : 0}`).join("|")}`;
    if (chuKy === chuKyRef.current) return;
    chuKyRef.current = chuKy;
    setHienThi(ve);
    setSoAn(an);
  }, [canhBao, camera, size.width, size.height, tran, hienThi.length]);

  // Chiếu lại mỗi khung ĐƯỢC VẼ. Với `frameloop="demand"` đây không phải 60 fps.
  useFrame(tinhLai);

  if (hienThi.length === 0) return null;

  return (
    <Html fullscreen zIndexRange={[30, 10]} style={{ pointerEvents: "none", userSelect: "none" }}>
      <div data-testid="lop-canh-bao" data-so-badge={hienThi.length} data-so-an={soAn}>
        {hienThi.map((b) => {
          const kieu = KIEU_MUC[b.muc];
          const mau = giaiMauCanh(kieu.token) ?? "#ef4444";
          return (
            <div
              key={b.id}
              data-testid={`badge-canh-bao-${b.id}`}
              data-ngoai-khung={b.ngoaiKhung ? "1" : "0"}
              data-muc={b.muc}
              style={{
                position: "absolute",
                left: b.x,
                top: b.y,
                transform: "translate(-50%, -50%)",
                display: "flex",
                alignItems: "center",
                gap: 4,
                // Cỡ CỐ ĐỊNH — luật 1. Không `distanceFactor`, không scale theo z.
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1,
                padding: "3px 6px",
                borderRadius: 4,
                whiteSpace: "nowrap",
                color: "#fff",
                background: mau,
                // Alarm đã ack vẫn HIỆN (nó chưa được giải quyết) nhưng lùi lại.
                opacity: b.daAck ? 0.6 : 1,
                boxShadow: "0 1px 3px rgba(0,0,0,.4)",
              }}
            >
              {/* Luật 2 — hình dạng, rồi chữ. Màu là chiều thứ ba, không phải duy nhất. */}
              <span aria-hidden="true">{kieu.hinh}</span>
              <span>{b.nhan}</span>
              {b.ngoaiKhung ? (
                /* Luật 3 — mũi tên chỉ về vị trí THẬT của alarm ngoài khung. */
                <span
                  aria-hidden="true"
                  data-testid={`mui-ten-${b.id}`}
                  style={{ transform: `rotate(${b.gocMuiTen}rad)`, display: "inline-block" }}
                >
                  ➤
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </Html>
  );
}

export default LopCanhBao;
