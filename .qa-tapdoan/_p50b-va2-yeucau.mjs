import { readFileSync, writeFileSync } from "node:fs";
const F = "client/src/components/twin3d/loi/KhungCanh.tsx";
let s = readFileSync(F, "utf8");

// (3) Cửa sổ đo: mặt phẳng cắt mà TRANG YÊU CẦU (prop), đứng cạnh số camera THẬT.
const cu = `  __demSaBan?: {`;
const moi = `  /**
   * ★★★ PH-50b — MẶT PHẲNG CẮT **TRANG YÊU CẦU** (prop \`far\` của \`KhungCanh\`, và \`near\`
   * suy ra từ nó). Đặt CẠNH \`__thongKeVe.{near,far}\` (số của camera THẬT) để hai số ấy
   * so được với nhau bằng một phép trừ, thay vì phải suy từ px.
   *
   * Bất biến của sản phẩm sau bản vá PH-50b: \`__thongKeVe.far === __catCanhYeuCau.far\`.
   * Trước bản vá hai số này LỆCH HẲN (\`far\` camera đứng ở 2000 trong khi trang yêu cầu
   * 11.064) — và chính khoảng lệch ấy là toàn bộ khuyết tật.
   */
  __catCanhYeuCau?: { near: number; far: number };
  __demSaBan?: {`;
if (!s.includes(cu)) throw new Error("không thấy mốc __demSaBan");
s = s.replace(cu, moi);

// (4) Ghi cửa sổ ấy ở TẦNG NGOÀI `<Canvas>` — độc lập hoàn toàn với bộ đồng bộ bên trong,
//     để bản ablation gỡ bộ đồng bộ vẫn còn số "trang yêu cầu" mà đối chiếu.
const cu2 = `  const mauNenArgs = useMemo(() => [mauNen] as [string], [mauNen]);`;
const moi2 = `  // ★ PH-50b — phơi mặt phẳng cắt TRANG YÊU CẦU. Ở NGOÀI \`<Canvas>\`: nó phải còn đúng
  //   kể cả khi bộ đồng bộ bên trong bị gỡ (ablation), nếu không thì không so được hai số.
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as WindowDo).__catCanhYeuCau = { near: camera.near, far: camera.far };
  }, [camera]);
  const mauNenArgs = useMemo(() => [mauNen] as [string], [mauNen]);`;
if (!s.includes(cu2)) throw new Error("không thấy mốc mauNenArgs");
s = s.replace(cu2, moi2);
writeFileSync(F, s, "utf8");
console.log("ok");
