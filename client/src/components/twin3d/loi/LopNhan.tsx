/**
 * LopNhan.tsx — lớp nhãn HTML chiếu từ 3D, CAP CỨNG 30 nhãn DOM (§4).
 *
 * Vì sao chiếu tay thay vì dùng `<Html>` của drei cho từng máy: `<Html>` tạo một
 * portal DOM + một `Object3D` cho MỖI nhãn và tự chiếu trong `useFrame`. Với 43
 * máy đó là 43 portal chạy mỗi khung — mà điều ta cần lại là **cull xuống 30**.
 * Ở đây một `<Html>` DUY NHẤT giữ toàn bộ lớp nhãn ở toạ độ màn hình, và
 * `locNhan.ts` (thuần, có test) quyết định 30 cái nào được vẽ.
 *
 * Quyết định lọc nằm HẾT trong `locNhan.ts`; tệp .tsx này chỉ chiếu toạ độ và
 * vẽ div. Nhờ vậy luật ưu tiên (chọn > bất thường > hover > gần) test được trong
 * node, còn phần không test được (chiếu ma trận) không chứa quyết định nào.
 */

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useRef, useState } from "react";
import * as THREE from "three";

import { locNhan, TRAN_NHAN_DOM, type NhanUngVien } from "./locNhan";

/** Một nhãn trước khi chiếu — vị trí ở KHÔNG GIAN THẾ GIỚI (mét). */
export interface NhanTheGioi {
  khoa: string;
  machineId: number;
  /** Điểm neo nhãn, thường là đỉnh máy + một khoảng hở. */
  viTri: { x: number; y: number; z: number };
  /** Dòng chính — mã máy. */
  ma: string;
  /** Dòng phụ — nhãn trạng thái đã qua `t()`. */
  phu?: string;
  batThuong?: boolean;
}

export interface LopNhanProps {
  nhan: NhanTheGioi[];
  dangChon: number | null;
  dangHover: number | null;
  /** Tắt hẳn lớp nhãn (bậc `tat_nhan` của matDoKhungHinh). */
  tat?: boolean;
  tranNhan?: number;
}

interface NhanDaChieu {
  khoa: string;
  x: number;
  y: number;
  ma: string;
  phu?: string;
  batThuong: boolean;
  dangChon: boolean;
}

/** Chiếu 1 điểm thế giới → pixel canvas. Trả `null` khi ở sau lưng camera. */
function chieu(
  diem: THREE.Vector3,
  camera: THREE.Camera,
  rong: number,
  cao: number,
): { x: number; y: number } | null {
  const v = diem.clone().project(camera);
  // z > 1 nghĩa là sau mặt phẳng xa / sau lưng camera → không chiếu được.
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.z > 1) return null;
  return { x: ((v.x + 1) / 2) * rong, y: ((1 - v.y) / 2) * cao };
}

export function LopNhan({ nhan, dangChon, dangHover, tat = false, tranNhan = TRAN_NHAN_DOM }: LopNhanProps) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const [hienThi, setHienThi] = useState<NhanDaChieu[]>([]);
  const tamRef = useRef(new THREE.Vector3());
  const chuKyRef = useRef("");

  const tinhLai = useCallback(() => {
    if (tat || nhan.length === 0) {
      if (hienThi.length !== 0) setHienThi([]);
      return;
    }

    const ungVien: NhanUngVien[] = [];
    const theoKhoa = new Map<string, NhanTheGioi>();

    for (const n of nhan) {
      const p = tamRef.current.set(n.viTri.x, n.viTri.y, n.viTri.z);
      const kc = camera.position.distanceTo(p);
      const mh = chieu(p, camera, size.width, size.height);
      theoKhoa.set(n.khoa, n);
      ungVien.push({
        khoa: n.khoa,
        x: mh?.x ?? 0,
        y: mh?.y ?? 0,
        khoangCachMet: kc,
        dangChon: n.machineId === dangChon,
        batThuong: n.batThuong === true,
        hover: n.machineId === dangHover,
        // Ngoài khung: sau lưng camera, hoặc lệch quá 10 % ra ngoài mép canvas.
        ngoaiKhung:
          mh === null ||
          mh.x < -0.1 * size.width ||
          mh.x > 1.1 * size.width ||
          mh.y < -0.1 * size.height ||
          mh.y > 1.1 * size.height,
      });
    }

    const kq = locNhan(ungVien, { tranNhan });

    // Cửa sổ đo cho e2e (§13.2). Ghi CẢ khi 0 nhãn — "không đo được" phải khác
    // "đo được 0", nếu không thì test đọc `undefined` rồi coi như đạt.
    if (typeof window !== "undefined") {
      (window as WindowCoDo).__demNhan = {
        ve: kq.ve.length,
        tong: kq.tongUngVien,
        ngoaiKhung: kq.soNgoaiKhung,
        chongLap: kq.soBiChongLap,
        vuotTran: kq.soVuotTran,
        tran: tranNhan,
      };
    }

    // Chỉ setState khi TẬP nhãn thực sự đổi. Không có bước này, mỗi khung xoay
    // camera lại đẩy một mảng mới vào React → re-render 60 lần/giây, đúng thứ
    // `frameloop="demand"` sinh ra để tránh.
    const chuKy = kq.ve.map((v) => `${v.khoa}:${Math.round(v.x)}:${Math.round(v.y)}`).join("|");
    if (chuKy === chuKyRef.current) return;
    chuKyRef.current = chuKy;

    setHienThi(
      kq.ve.map((v) => {
        const g = theoKhoa.get(v.khoa)!;
        return {
          khoa: v.khoa,
          x: v.x,
          y: v.y,
          ma: g.ma,
          phu: g.phu,
          batThuong: g.batThuong === true,
          dangChon: g.machineId === dangChon,
        };
      }),
    );
  }, [nhan, camera, size.width, size.height, dangChon, dangHover, tat, tranNhan, hienThi.length]);

  // Chiếu lại mỗi khung ĐƯỢC VẼ. Với `frameloop="demand"` đây KHÔNG phải 60fps:
  // hàm chỉ chạy khi có ai đó gọi `invalidate()` (xoay camera, đổi dữ liệu).
  useFrame(tinhLai);

  if (tat || hienThi.length === 0) return null;

  return (
    <Html fullscreen zIndexRange={[20, 0]} style={{ pointerEvents: "none", userSelect: "none" }}>
      {/* ★ `data-testid` phải nằm trên phần tử DOM BÊN TRONG `<Html>`, KHÔNG trên
          chính `<Html>`. R3F coi mọi prop lạ trên phần tử trong cây Canvas là
          ĐƯỜNG DẪN thuộc tính three.js và tách theo dấu `-`, nên `data-testid`
          thành `data.testid` → ném "Cannot set data-testid. Ensure it is an
          object before setting testid" và ErrorBoundary nuốt cả cảnh.
          Đo được: `npm run check` XANH với lỗi này (kiểu JSX của `<Html>` nhận
          prop tuỳ ý) — chỉ mở màn thật mới bắt ra. */}
      <div
        data-testid="lop-nhan-twin3d"
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        {hienThi.map((n) => (
          <div
            key={n.khoa}
            data-testid="nhan-may-twin3d"
            style={{
              position: "absolute",
              left: n.x,
              top: n.y,
              transform: "translate(-50%, -100%)",
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              background: "var(--card, rgba(255,255,255,0.94))",
              color: "var(--card-foreground, #0f172a)",
              border: `1px solid ${
                n.batThuong
                  ? "var(--destructive, #ef4444)"
                  : n.dangChon
                    ? "var(--primary, #3b82f6)"
                    : "var(--border, rgba(100,116,139,0.3))"
              }`,
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            }}
          >
            {n.ma}
            {n.phu ? (
              <span style={{ opacity: 0.6, fontWeight: 400 }}>{` · ${n.phu}`}</span>
            ) : null}
          </div>
        ))}
      </div>
    </Html>
  );
}

/** Hình dạng cửa sổ đo `window.__demNhan` — e2e đọc đúng các khoá này. */
export interface WindowCoDo extends Window {
  __demNhan?: {
    ve: number;
    tong: number;
    ngoaiKhung: number;
    chongLap: number;
    vuotTran: number;
    tran: number;
  };
}

export default LopNhan;
