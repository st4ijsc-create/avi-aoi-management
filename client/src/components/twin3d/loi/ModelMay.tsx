/**
 * ModelMay.tsx — LỚP MODEL glTF THEO TỪNG MÁY, chồng lên lô `BatchedMesh` (#4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LỚP NÀY KHÔNG THAY `LoBatchMay` — NÓ ĐỨNG TRÊN
 * ════════════════════════════════════════════════════════════════════════════
 * `LoBatchMay` vẽ MỌI máy trong 1 draw call. Máy nào được xếp bậc L0 và có model
 * riêng thì lớp này vẽ thêm GLB tại đúng chỗ đó, và người gọi ẩn ô batch tương
 * ứng (`hien: false`). Ngân sách §4 vì thế chỉ tăng đúng số GLB đang nạp — tối
 * đa 8 theo `TRAN_GLB_DONG_THOI`, và đó chính là lý do trần đó tồn tại.
 *
 * ⚠ KHÔNG dựng lớp này cho cả 43 máy. `lapKeHoachNap` của `napModel.ts` đã quyết
 *   định ai được nạp; component này chỉ nhận danh sách ĐÃ LỌC.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MỖI MODEL CÓ BOUNDARY RIÊNG — KHÔNG PHẢI MỘT BOUNDARY CHO CẢ LỚP
 * ════════════════════════════════════════════════════════════════════════════
 * Một boundary bọc cả nhóm thì một tệp hỏng làm biến mất MỌI model trong nhóm.
 * Bọc từng cái tốn thêm vài instance component (0 draw call) và đổi lại: hỏng
 * một máy thì đúng một máy rơi về khối. Đây là điều nghiệm thu ca dương phải
 * chứng minh — nạp tệp hỏng thật, cảnh vẫn sống, MÁY ĐÓ về khối.
 *
 * ★ RB-5 — `<Gltf src>` chỉ nhận đường dẫn CÙNG GỐC (`/uploads/twin-assets/…`
 *   hoặc `/uploads/models/…`). Không CDN. Cưỡng chế bằng `duongDanCungGoc`.
 * ★ RB-3 — nạp xong phải `invalidate()`, nếu không `frameloop="demand"` giữ
 *   nguyên khung cũ và model đã nạp KHÔNG BAO GIỜ hiện. Lỗi này câm hoàn toàn.
 * ★ RB-7 — drei giữ document trong bộ đệm riêng của `useGLTF`; ta KHÔNG tự
 *   dispose cây đó (dùng chung giữa các instance cùng URI). Cái ta quản là
 *   DANH SÁCH đang nạp, qua `BoDemGlbLru` ở `napModel.ts`.
 */

import { Suspense, useEffect } from "react";
import { Center, Gltf, Resize } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

import { ModelErrorBoundary } from "./ModelErrorBoundary";

/**
 * Chỉ nhận đường dẫn tương đối cùng gốc (RB-5 + §7.4 "allowlist đường dẫn").
 *
 * ★★★ `//evil.com/x.glb` LÀ ĐƯỜNG DẪN TUYỆT ĐỐI GIAO THỨC-TƯƠNG-ĐỐI, không phải
 *   đường dẫn nội bộ. Một phép kiểm chỉ hỏi `startsWith("/")` sẽ cho nó qua và
 *   trình duyệt đi tải từ evil.com — đúng thứ allowlist sinh ra để chặn.
 */
export function duongDanCungGoc(uri: string | null | undefined): boolean {
  if (!uri) return false;
  if (!uri.startsWith("/")) return false;
  if (uri.startsWith("//")) return false;
  return true;
}

export interface MayCoModel {
  machineId: number;
  /** Đường dẫn GLB/glTF — cùng gốc. */
  modelUri: string;
  /** Vị trí ĐÁY máy trong scene, MÉT (cùng quy ước `MayTrongLo.viTri`). */
  viTri: { x: number; y: number; z: number };
  /** Góc xoay quanh trục đứng, radian. */
  gocXoayRad: number;
  /**
   * Chiều cao đích, MÉT — model được co về đúng chiều cao KHAI BÁO của máy.
   *
   * ★★★ VÌ SAO CO THEO KHAI BÁO CHỨ KHÔNG DÙNG TỈ LỆ GỐC CỦA FILE: model do
   *   người dùng xuất từ CAD có thể ở mm, cm, m, hoặc inch — và `docBanVe.ts`
   *   tự khai "chắc chắn" SAI với vật thể nhỏ (cảnh báo §10B.2). Một model ở
   *   milimét đặt thẳng vào cảnh mét sẽ cao 1.900 m. `<Resize height>` biến câu
   *   hỏi "file này đơn vị gì" thành câu hỏi không cần trả lời.
   */
  caoM: number;
}

export interface LopModelMayProps {
  may: readonly MayCoModel[];
  /** Vẽ gì cho máy có model hỏng. Nhận machineId để dựng đúng khối của máy đó. */
  khoiThayThe?: (machineId: number) => React.ReactNode;
  /** Báo lên trên khi một máy hỏng model — để hiện huy hiệu và ngừng nạp lại. */
  onModelLoi?: (machineId: number, loi: Error) => void;
}

/** Gọi `invalidate()` một lần khi con của nó đã mount xong (RB-3). */
function BaoVeLai({ khoa }: { khoa: string }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    // Hai lượt: một ngay bây giờ, một ở khung kế. `frameloop="demand"` chỉ vẽ
    // khi được đánh thức, và cây drei có thể còn đang gắn material ở lượt này.
    invalidate();
    const id = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(id);
  }, [invalidate, khoa]);
  return null;
}

function MotModel({
  m,
  khoiThayThe,
  onModelLoi,
}: {
  m: MayCoModel;
  khoiThayThe?: (machineId: number) => React.ReactNode;
  onModelLoi?: (machineId: number, loi: Error) => void;
}) {
  const thayThe = khoiThayThe?.(m.machineId) ?? null;
  return (
    <ModelErrorBoundary
      nhan={`machine:${m.machineId}`}
      khoaLamMoi={m.modelUri}
      fallback={thayThe}
      onLoi={(loi) => onModelLoi?.(m.machineId, loi)}
    >
      {/* ★ `fallback` của Suspense CŨNG phải là phần tử three hoặc null — xem
          docblock của `ModelErrorBoundary`. Trong lúc chờ nạp, ô batch của máy
          này vẫn đang hiện ở tầng gọi, nên `null` là đúng: không có khoảng trống. */}
      <Suspense fallback={null}>
        <group
          position={[m.viTri.x, m.viTri.y, m.viTri.z]}
          rotation={[0, m.gocXoayRad, 0]}
        >
          {/* `Center bottom` đặt ĐÁY model lên y=0 của group — trùng với quy ước
              "viTri là đáy máy" của `MayTrongLo`. Bỏ `bottom` thì mọi model chìm
              nửa dưới sàn và không gì nổ. */}
          <Resize height scale={Math.max(0.01, m.caoM)}>
            <Center bottom>
              <Gltf src={m.modelUri} />
            </Center>
          </Resize>
        </group>
        <BaoVeLai khoa={`${m.machineId}:${m.modelUri}`} />
      </Suspense>
    </ModelErrorBoundary>
  );
}

/**
 * Lớp model của cả cảnh. Máy có `modelUri` không cùng gốc bị BỎ QUA lặng lẽ ở
 * đây và vẫn hiện khối ở `LoBatchMay` — chặn đúng chỗ, không tạo lỗ hổng và
 * cũng không tạo một máy vô hình.
 */
export function LopModelMay({ may, khoiThayThe, onModelLoi }: LopModelMayProps) {
  const hopLe = may.filter((m) => duongDanCungGoc(m.modelUri));
  if (hopLe.length === 0) return null;
  return (
    <>
      {hopLe.map((m) => (
        <MotModel
          key={`${m.machineId}:${m.modelUri}`}
          m={m}
          khoiThayThe={khoiThayThe}
          onModelLoi={onModelLoi}
        />
      ))}
    </>
  );
}

export default LopModelMay;
