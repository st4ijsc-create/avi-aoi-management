/**
 * DongChayLine.tsx — ĐƯỜNG DÒNG CHẢY CÓ HƯỚNG của phạm vi Line (§10C.3 mục 1).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐÂY LÀ THỨ DUY NHẤT TRÊN TOÀN TWIN ĐƯỢC PHÉP ANIMATION LÚC BÌNH THƯỜNG
 * ════════════════════════════════════════════════════════════════════════════
 * §10.1 cấm animation lúc bình thường — animation chỉ để làm nổi bật tình huống
 * BẤT THƯỜNG, vì mắt người bị chuyển động cướp sự chú ý và một màn hình lúc nào
 * cũng nhúc nhích sẽ dạy người vận hành bỏ qua chuyển động.
 *
 * Ngoại lệ ở đây có lý do cụ thể: **HƯỚNG DÒNG CHẢY LÀ THÔNG TIN**, không phải
 * trang trí. Một đường tĩnh nối 12 trạm không nói được đầu nào là đầu vào; mũi
 * tên chạy thì nói được ngay, và đó là câu hỏi vận hành có thật.
 *
 * ★ VÀ NÓ PHẢI TRUNG THỰC: tốc độ mũi tên **tỉ lệ với nhịp THẬT**, và **ĐỨNG YÊN
 *   khi Line dừng**. Một dòng chảy chạy đều trong khi chuyền đã dừng là lời khai
 *   sai về thế giới — đúng thứ NT-3 cấm, chỉ đổi phương tiện từ màu sang chuyển
 *   động. `nhipMs = null` ⇒ đứng im hoàn toàn.
 *
 * ★ RB-3 — animation với `frameloop="demand"` PHẢI tự gọi `invalidate()` mỗi
 *   khung, nếu không nó chạy một bước rồi đứng.
 * ★ RB-7 — geometry/material tự cấp phát đều `dispose()` trong cleanup.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { giaiMauCanh } from "../mauTrangThai";

export interface DiemDongChay {
  /** Đường tâm Line — nối tâm các trạm theo `orderIndex` (từ `hinhHocLine`). */
  diem: readonly { x: number; y: number; z: number }[];
  /**
   * Nhịp thật của chuyền, ms mỗi đơn vị (`commandLog.avgDurations`).
   * `null` = **Line đang dừng hoặc chưa đo được** ⇒ mũi tên ĐỨNG YÊN.
   */
  nhipMs: number | null;
}

export interface DongChayLineProps {
  dongChay: DiemDongChay;
  /** Số mũi tên rải dọc đường. Nhiều hơn không thêm thông tin, chỉ thêm nhiễu. */
  soMuiTen?: number;
}

/** Mặc định — đủ để đọc hướng, chưa đủ để thành hoa văn. */
export const SO_MUI_TEN_MAC_DINH = 8;

/** Nhịp chậm nhất còn cho mũi tên nhúc nhích (ms). Chậm hơn nữa coi như đứng. */
export const NHIP_TOI_DA_MS = 120_000;

export function DongChayLine({ dongChay, soMuiTen = SO_MUI_TEN_MAC_DINH }: DongChayLineProps) {
  const invalidate = useThree((s) => s.invalidate);
  const nhomRef = useRef<THREE.InstancedMesh | null>(null);
  const tienDo = useRef(0);

  const { diem, nhipMs } = dongChay;

  /** Đường cong đi qua tâm các trạm; `null` khi chưa đủ 2 điểm để có hướng. */
  const duong = useMemo(() => {
    if (diem.length < 2) return null;
    return new THREE.CatmullRomCurve3(
      diem.map((d) => new THREE.Vector3(d.x, d.y, d.z)),
      false,
      "catmullrom",
      0.1,
    );
  }, [diem]);

  /**
   * Đường kẻ nền — cho thấy TUYẾN, kể cả khi mũi tên đứng yên.
   *
   * ★★★ RB-7 — `THREE.Line` được dựng MỘT LẦN trong `useMemo`, KHÔNG dựng trong
   *   thân render. `Factory3DScene.tsx:219-226` của repo cấp phát
   *   `new THREE.Line(new BufferGeometry(), new LineBasicMaterial())` **mỗi lần
   *   render** và không `dispose()` — §1.7 ghi đó là một rò rỉ GPU CÓ THẬT. Dựng
   *   trong `useMemo` rồi gắn bằng `<primitive>` là cách tránh đúng lớp lỗi đó.
   */
  const { hinhDuong, chatLieuDuong, duongVe } = useMemo(() => {
    if (!duong) return { hinhDuong: null, chatLieuDuong: null, duongVe: null };
    const g = new THREE.BufferGeometry().setFromPoints(duong.getPoints(Math.max(16, diem.length * 8)));
    const m = new THREE.LineBasicMaterial({
      color: new THREE.Color(giaiMauCanh("--info") ?? "#3b82f6"),
      transparent: true,
      opacity: 0.45,
    });
    return { hinhDuong: g, chatLieuDuong: m, duongVe: new THREE.Line(g, m) };
  }, [duong, diem.length]);

  /** Mũi tên: MỘT `InstancedMesh` hình nón — 8 mũi tên trong 1 draw call. */
  const { hinhNon, chatLieuNon } = useMemo(() => {
    const g = new THREE.ConeGeometry(0.14, 0.42, 6);
    // Nón mặc định chĩa +Y; xoay để chĩa +Z rồi mới hướng theo tiếp tuyến.
    g.rotateX(Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(giaiMauCanh("--info") ?? "#3b82f6"),
    });
    return { hinhNon: g, chatLieuNon: m };
  }, []);

  // ★ RB-7 — three KHÔNG tự thu hồi bộ nhớ GPU.
  useEffect(
    () => () => {
      hinhDuong?.dispose();
      chatLieuDuong?.dispose();
      hinhNon.dispose();
      chatLieuNon.dispose();
    },
    [hinhDuong, chatLieuDuong, hinhNon, chatLieuNon],
  );

  /**
   * Đặt mũi tên tại các vị trí `t` rải đều, lệch dần theo `tienDo`.
   * Tách khỏi `useFrame` để còn gọi được MỘT LẦN khi Line dừng (mũi tên vẫn
   * phải HIỆN, chỉ là không chạy).
   */
  const datMuiTen = useMemo(
    () => (lech: number) => {
      const inst = nhomRef.current;
      if (!inst || !duong) return;
      const mt = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const mot = new THREE.Vector3(1, 1, 1);
      // Trục gốc của nón SAU `rotateX(π/2)` ở trên — nón chĩa +Z.
      const trucGoc = new THREE.Vector3(0, 0, 1);
      for (let i = 0; i < soMuiTen; i += 1) {
        const t = ((i / soMuiTen + lech) % 1 + 1) % 1;
        const p = duong.getPointAt(t);
        const tan = duong.getTangentAt(t).normalize();
        q.setFromUnitVectors(trucGoc, tan);
        mt.compose(p.clone().setY(p.y + 0.25), q, mot);
        inst.setMatrixAt(i, mt);
      }
      inst.count = soMuiTen;
      inst.instanceMatrix.needsUpdate = true;
    },
    [duong, soMuiTen],
  );

  // Đặt một lần khi dữ liệu đổi — kể cả lúc Line dừng.
  useEffect(() => {
    datMuiTen(tienDo.current);
    invalidate();
  }, [datMuiTen, invalidate]);

  useFrame((_, delta) => {
    // ★★★ Line dừng / chưa đo được nhịp ⇒ ĐỨNG YÊN. Không có nhánh nào cho một
    //   tốc độ "mặc định" — một tốc độ bịa là lời khai sai về nhịp sản xuất.
    if (nhipMs == null || !Number.isFinite(nhipMs) || nhipMs <= 0 || nhipMs > NHIP_TOI_DA_MS) return;
    // Một chu kỳ mũi tên đi hết đường trong `nhipMs * số trạm`.
    const chuKyGiay = (nhipMs * Math.max(1, diem.length)) / 1000;
    tienDo.current = (tienDo.current + delta / chuKyGiay) % 1;
    datMuiTen(tienDo.current);
    // ★ RB-3 — animation của TA, `demand` không tự biết.
    invalidate();
  });

  if (!duong || !duongVe) return null;

  /**
   * ★★★ KHÔNG `data-testid` TRÊN THẺ R3F.
   *   `<group data-testid="…">` làm R3F cố GÁN thuộc tính `data.testid` lên
   *   `THREE.Group` — nó không phải DOM. Đo được trên trình duyệt thật:
   *     "R3F: Cannot set \"data-testid\". Ensure it is an object before setting"
   *     → TypeError: Cannot convert undefined or null to object
   *     → ErrorBoundary nuốt CẢ `<Canvas>` ⇒ phạm vi Line ra màn hình TRẮNG.
   *   `name` là thuộc tính THẬT của `Object3D`, nên e2e đọc scene graph qua nó.
   */
  return (
    <group name="dong-chay-line">
      <primitive object={duongVe} />
      <instancedMesh
        ref={nhomRef}
        args={[hinhNon, chatLieuNon, Math.max(1, soMuiTen)]}
        frustumCulled={false}
      />
    </group>
  );
}

export default DongChayLine;
