/**
 * LopVung.tsx — lớp VÙNG 3D translucent + nhãn trong cảnh (§11.1 #5).
 *
 * Toàn bộ hình học nằm ở `vungAnToan.ts` (module thuần, 49 test). Tệp này chỉ
 * biến kết quả đó thành `THREE.Shape` / `ExtrudeGeometry` và một lớp nhãn.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẪY HOÁN VỊ TRỤC — `Shape` CỦA THREE NẰM TRÊN MẶT PHẲNG X–Y
 * ════════════════════════════════════════════════════════════════════════════
 * `THREE.Shape` là hình 2D trên X–Y, và `ExtrudeGeometry` đùn theo **+Z**.
 * Nhưng mặt sàn của ta trải trên **X–Z** và trục đứng là **Y** (`heToaDo.ts`).
 * Nên sau khi đùn phải **xoay −90° quanh X** để mặt phẳng hình rơi xuống sàn.
 *
 * Quên phép xoay đó dựng ra một tấm ván DỰNG ĐỨNG giữa xưởng — vẫn là mesh hợp
 * lệ, vẫn translucent, vẫn có nhãn, **không có gì nổ**. Đây đúng lớp lỗi mà
 * `vungAnToan.ts` cảnh báo, chỉ khác tầng. Nghiệm thu bằng MẮT là phép đo duy
 * nhất phân biệt được, nên C4 có ảnh chụp.
 *
 * ★ Dựng `dinh.y = -z` khi đưa vào `Shape` rồi xoay `-π/2`: hai phép này khử
 *   nhau đúng một lần. Viết `dinh.y = z` (không đổi dấu) cho ra vùng LẬT GƯƠNG
 *   theo trục sâu — cũng không nổ gì.
 *
 * ★ RB-7 — mọi `geometry`/`material` dựng ở đây đều `dispose()` trong cleanup.
 * ★ RB-3 — `invalidate()` sau mỗi lần dựng lại, nếu không `frameloop="demand"`
 *   không vẽ lại và vùng mới "không xuất hiện".
 * ★ §4 — mỗi vùng là MỘT mesh. Số vùng an toàn của một xưởng đếm bằng đơn vị,
 *   không bằng chục, nên không cần instancing; và một vùng phải chọn được riêng.
 */

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import { NHAC_KHOI_SAN_M, type VungVe } from "./vungAnToan";

export interface LopVungProps {
  vung: readonly VungVe[];
  /** Click vào một vùng — `null` khi click ra ngoài. */
  onChon?: (khoa: string | null) => void;
  /** Ẩn nhãn (bậc `tat_nhan` của `matDoKhungHinh`, hoặc công tắc Nhãn). */
  tatNhan?: boolean;
}

/** Một vùng: mặt đùn mỏng + viền nét + nhãn. */
function MotVung({
  v,
  onChon,
  tatNhan,
}: {
  v: VungVe;
  onChon?: (khoa: string) => void;
  tatNhan?: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);

  const { hinh, vien, chatLieu, chatLieuVien } = useMemo(() => {
    const shape = new THREE.Shape();
    v.dinh.forEach((d, i) => {
      // ★★★ HOÁN VỊ + ĐỔI DẤU — xem docblock đầu tệp. `-d.z` ở đây và phép xoay
      //   `-π/2` quanh X ở dưới khử nhau; bỏ một trong hai là vùng lật gương.
      if (i === 0) shape.moveTo(d.x, -d.z);
      else shape.lineTo(d.x, -d.z);
    });
    shape.closePath();

    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(v.dayM, 0.001),
      bevelEnabled: false,
    });
    // Mặt phẳng Shape (X–Y) → mặt sàn (X–Z).
    g.rotateX(-Math.PI / 2);

    const m = new THREE.MeshBasicMaterial({
      color: v.mau,
      transparent: true,
      opacity: v.doMo,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Viền: cùng polygon, vẽ bằng LineLoop trên cao độ mặt trên. Không có viền
    // thì hai vùng cùng màu chồng mép nhau trông như một vùng duy nhất.
    const diem = v.dinh.map((d) => new THREE.Vector3(d.x, 0, d.z));
    const gv = new THREE.BufferGeometry().setFromPoints([...diem, diem[0]]);
    const mv = new THREE.LineBasicMaterial({ color: v.mau, transparent: true, opacity: 0.9 });

    return { hinh: g, vien: gv, chatLieu: m, chatLieuVien: mv };
  }, [v.dinh, v.mau, v.doMo, v.dayM]);

  // ★ RB-7 — three KHÔNG tự thu hồi bộ nhớ GPU.
  useEffect(() => {
    invalidate();
    return () => {
      hinh.dispose();
      vien.dispose();
      chatLieu.dispose();
      chatLieuVien.dispose();
    };
  }, [hinh, vien, chatLieu, chatLieuVien, invalidate]);

  return (
    <group>
      <mesh
        geometry={hinh}
        material={chatLieu}
        position={[0, v.caoDoY, 0]}
        renderOrder={1}
        onClick={(e) => {
          e.stopPropagation();
          onChon?.(v.khoa);
        }}
        name={v.khoa}
      />
      <lineLoop
        geometry={vien}
        material={chatLieuVien}
        position={[0, v.caoDoY + v.dayM + NHAC_KHOI_SAN_M, 0]}
        renderOrder={2}
      />
      {/* ★ NHÃN — nửa sau của #5 ("vùng translucent **+ nhãn**"). Điểm neo là
          `v.nhan`, do `diemDatNhan` bảo đảm NẰM TRONG vùng kể cả khi vùng lõm.
          Số vùng an toàn của một xưởng đếm bằng đơn vị nên một `<Html>` mỗi
          vùng là chấp nhận được; lớp nhãn MÁY (42 cái) mới cần chiếu tay như
          `loi/LopNhan.tsx` làm. */}
      {tatNhan ? null : (
        <Html
          position={[v.nhan.x, v.nhan.y, v.nhan.z]}
          center
          zIndexRange={[15, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {/* ⚠ `data-testid` PHẢI ở phần tử DOM BÊN TRONG `<Html>`: R3F coi prop
              lạ trên phần tử trong cây Canvas là đường dẫn thuộc tính three và
              tách theo `-`. Xem docblock `loi/LopNhan.tsx` — `npm run check`
              XANH với lỗi đó, chỉ mở màn thật mới bắt ra. */}
          <div
            data-testid="nhan-vung-twin3d"
            data-vung={v.khoa}
            style={{
              whiteSpace: "nowrap",
              fontSize: 11,
              fontWeight: 600,
              lineHeight: 1.25,
              padding: "2px 6px",
              borderRadius: 4,
              color: "#fff",
              background: "rgba(15,23,42,0.72)",
              border: `1px solid ${v.mau}`,
            }}
          >
            {v.ten}
            <span style={{ opacity: 0.75, fontWeight: 400 }}>
              {" · "}
              {v.dienTichM2.toFixed(1)} m²
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

export function LopVung({ vung, onChon, tatNhan }: LopVungProps) {
  if (vung.length === 0) return null;
  return (
    <group name="lop-vung-an-toan">
      {vung.map((v) => (
        <MotVung key={v.khoa} v={v} onChon={onChon} tatNhan={tatNhan} />
      ))}
    </group>
  );
}

export default LopVung;
