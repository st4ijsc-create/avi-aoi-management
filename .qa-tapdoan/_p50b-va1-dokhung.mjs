import { readFileSync, writeFileSync } from "node:fs";
const F = "client/src/components/twin3d/loi/KhungCanh.tsx";
let s = readFileSync(F, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
if (eol !== "\n") throw new Error("tệp là CRLF — dừng, không chuẩn hoá ngầm");

// (1) Mở rộng hình dạng cửa sổ đo `__thongKeVe` — thêm near/far/camXa.
const cu1 = `  __thongKeVe?: {
    calls: number;
    triangles: number;
    /** Số lần mất WebGL context kể từ khi tải trang — 0 là bình thường. */
    matContext: number;
    /** Số lần context được khôi phục. */
    khoiPhuc: number;
  };`;
const moi1 = `  __thongKeVe?: {
    calls: number;
    triangles: number;
    /** Số lần mất WebGL context kể từ khi tải trang — 0 là bình thường. */
    matContext: number;
    /** Số lần context được khôi phục. */
    khoiPhuc: number;
    /**
     * ★★★ PH-50b — MẶT PHẲNG CẮT **SỐNG** CỦA CAMERA ĐANG VẼ (\`camera.near\`/\`camera.far\`).
     *
     * Vì sao phải có: \`far\` là prop của \`KhungCanh\`, nhưng thứ quyết định pixel là
     * \`camera.far\` TRÊN camera mà R3F đã tạo. Hai số ấy có thể LỆCH HẲN NHAU — và đã
     * lệch: R3F 9.5 chỉ áp cấu hình \`camera\` LÚC TẠO (\`events-5a94e5eb.esm.js:15613\`,
     * điều kiện \`!state.camera || state.camera === lastCamera && …\` không bao giờ đúng
     * cho một object cấu hình thuần ở lần thứ hai). Suốt 3 lượt QA, cách duy nhất ai đó
     * biết \`far\` sai là SUY từ \`rongPx ∝ 1/khoảng cách\` — sai số ~5 % và không phân biệt
     * được "far hằng" với "far thích ứng nhưng nhỏ".
     * · \`camXa\` — khoảng cách camera→gốc, để so trực tiếp với \`far\`.
     * · \`tiLeFarNear\` — \`far/near\`; §7.2 cảnh báo z-fighting khi tỉ lệ này lớn.
     */
    near: number;
    far: number;
    camXa: number;
    tiLeFarNear: number;
  };`;
if (!s.includes(cu1)) throw new Error("không thấy khối (1)");
s = s.replace(cu1, moi1);

// (2) BomThongKe đọc thêm camera.
const cu2 = `function BomThongKe() {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (typeof window === "undefined") return;
    const w = window as WindowDo;
    const truoc = w.__thongKeVe;
    w.__thongKeVe = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      matContext: truoc?.matContext ?? 0,
      khoiPhuc: truoc?.khoiPhuc ?? 0,
    };
  }, -1);
  return null;
}`;
const moi2 = `function BomThongKe() {
  const gl = useThree((s) => s.gl);
  // ★ PH-50b — camera LÀ một phần của "khung vừa vẽ": near/far quyết định pixel nào tồn tại.
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    if (typeof window === "undefined") return;
    const w = window as WindowDo;
    const truoc = w.__thongKeVe;
    const lam3 = (n: number) => Math.round(n * 1000) / 1000;
    w.__thongKeVe = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      matContext: truoc?.matContext ?? 0,
      khoiPhuc: truoc?.khoiPhuc ?? 0,
      near: lam3(camera.near),
      far: lam3(camera.far),
      camXa: lam3(Math.hypot(camera.position.x, camera.position.y, camera.position.z)),
      tiLeFarNear: camera.near > 0 ? Math.round(camera.far / camera.near) : -1,
    };
  }, -1);
  return null;
}`;
if (!s.includes(cu2)) throw new Error("không thấy khối (2)");
s = s.replace(cu2, moi2);

writeFileSync(F, s, "utf8");
console.log("đã vá thiết bị đo vào " + F);
