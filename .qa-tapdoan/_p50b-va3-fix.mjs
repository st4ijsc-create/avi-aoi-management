import { readFileSync, writeFileSync } from "node:fs";
const F = "client/src/components/twin3d/loi/KhungCanh.tsx";
let s = readFileSync(F, "utf8");

// (A) import
const cuI = `import { laCheDoDo } from "./cheDoDo";`;
const moiI = `import { nearTheoFar } from "./catCanh";
import { laCheDoDo } from "./cheDoDo";`;
if (!s.includes(cuI)) throw new Error("A");
s = s.replace(cuI, moiI);

// (B) component đồng bộ, đặt ngay trước `CameraBanDau`
const cuB = `/** Đặt camera ban đầu ĐÚNG MỘT LẦN — đổi prop sau không giật camera của người dùng. */`;
const moiB = `/**
 * ★★★ PH-50b — ĐƯA \`near\`/\`far\` MỚI VÀO CAMERA ĐANG SỐNG.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO KHÔNG THỂ CHỈ TRUYỀN \`camera={{…far}}\` CHO \`<Canvas>\`
 * ════════════════════════════════════════════════════════════════════════════
 * Prop \`camera\` của \`<Canvas>\` là **CẤU HÌNH KHỞI TẠO**. Bundle đang dùng
 * (\`@react-three/fiber@9.5.0\`, \`dist/events-5a94e5eb.esm.js:15613\`):
 *
 *   if (!state.camera || state.camera === lastCamera && !is.equ(lastCamera, cameraOptions, …))
 *
 * \`state.camera\` là THỰC THỂ camera, \`lastCamera\` là OBJECT CẤU HÌNH của lần
 * trước — với một cấu hình thuần, hai thứ đó không bao giờ \`===\` nhau, nên khối
 * này chỉ chạy đúng một lần (\`!state.camera\`). Nhánh \`===\` chỉ dành cho người
 * truyền THẲNG một camera instance vào.
 *
 * Hệ quả đã đo sống ở 5 vai QATD (\`.qa-tapdoan/p50b-far-t2.json\`): \`/twin\` mount
 * lúc \`khuonVien\` còn \`null\` nên \`far\` chốt ở sàn **2000**; dữ liệu về sau đổi
 * prop thành 25.449,6 mà \`camera.far\` vẫn **2000**. Người dùng cuộn ra xa là
 * **mất toà nhà**, và khởi phát bám theo \`camXa ≈ 2000\` chứ không theo cỡ cảnh
 * — chữ ký của một \`far\` HẰNG. Đây cũng là lý do cảnh \`qatd_admin\` từng ĐEN
 * HOÀN TOÀN: sa bàn 28,9 km ⇒ camera cách gốc 62,9 km ⇒ toàn cảnh ngoài \`far\`,
 * \`frustumCulled={false}\` vẫn nộp lệnh vẽ nhưng 0 pixel.
 *
 * ⚠ \`invalidate()\` là BẮT BUỘC: \`frameloop="demand"\` không biết ma trận chiếu
 *   vừa đổi, và không có khung mới thì \`far\` mới không thành pixel nào.
 * ⚠ Có gác \`===\`: \`updateProjectionMatrix()\` mỗi render là một phép nhân ma trận
 *   + một \`invalidate\` thừa ở màn vẽ theo yêu cầu.
 */
export function DongBoCatCanh({ near, far }: { near: number; far: number }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (camera.near === near && camera.far === far) return;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, near, far, invalidate]);
  return null;
}

/** Đặt camera ban đầu ĐÚNG MỘT LẦN — đổi prop sau không giật camera của người dùng. */`;
if (!s.includes(cuB)) throw new Error("B");
s = s.replace(cuB, moiB);

// (C) `near` suy từ `far`, và nối bộ đồng bộ vào cây
const cuC = `  const camera = useMemo(
    () => ({ fov, near: 0.1, far, position: viTriCamera as [number, number, number] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ghim theo GIÁ TRỊ ba toạ độ, không theo tham chiếu mảng
    [fov, far, viTriCamera[0], viTriCamera[1], viTriCamera[2]],
  );`;
const moiC = `  // ★★★ PH-50b — \`near\` KHÔNG còn là hằng 0,1: nó đi theo \`far\` để nới \`far\` không
  //   ăn hết độ chính xác z-buffer (§7.2), và có TRẦN để không bao giờ cắt vật ở gần.
  //   Xem \`catCanh.ts\` để biết hai trần ấy từ đâu ra.
  const near = nearTheoFar(far);
  const camera = useMemo(
    () => ({ fov, near, far, position: viTriCamera as [number, number, number] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ghim theo GIÁ TRỊ ba toạ độ, không theo tham chiếu mảng
    [fov, near, far, viTriCamera[0], viTriCamera[1], viTriCamera[2]],
  );`;
if (!s.includes(cuC)) throw new Error("C");
s = s.replace(cuC, moiC);

const cuD = `        <CameraBanDau viTri={viTriCamera} />`;
const moiD = `        {/* ★★★ PH-50b — prop \`camera\` chỉ là cấu hình KHỞI TẠO; đây mới là chỗ \`far\` tới camera. */}
        <DongBoCatCanh near={near} far={far} />
        <CameraBanDau viTri={viTriCamera} />`;
if (!s.includes(cuD)) throw new Error("D");
s = s.replace(cuD, moiD);

writeFileSync(F, s, "utf8");
console.log("ok");
