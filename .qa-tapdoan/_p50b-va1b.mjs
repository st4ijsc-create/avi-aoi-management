import { readFileSync, writeFileSync } from "node:fs";
const F = "client/src/components/twin3d/loi/KhungCanh.tsx";
let s = readFileSync(F, "utf8");
// Hai chỗ ghi lại `__thongKeVe` khi mất/khôi phục context: giữ nguyên các ô đo camera.
const cu = `          matContext: (w.__thongKeVe?.matContext ?? 0) + 1,
          khoiPhuc: w.__thongKeVe?.khoiPhuc ?? 0,
        };`;
const moi = `          matContext: (w.__thongKeVe?.matContext ?? 0) + 1,
          khoiPhuc: w.__thongKeVe?.khoiPhuc ?? 0,
          near: w.__thongKeVe?.near ?? 0,
          far: w.__thongKeVe?.far ?? 0,
          camXa: w.__thongKeVe?.camXa ?? 0,
          tiLeFarNear: w.__thongKeVe?.tiLeFarNear ?? -1,
        };`;
if (!s.includes(cu)) throw new Error("không thấy khối mất-context");
s = s.replace(cu, moi);
const cu2 = `          matContext: w.__thongKeVe?.matContext ?? 0,
          khoiPhuc: (w.__thongKeVe?.khoiPhuc ?? 0) + 1,
        };`;
const moi2 = `          matContext: w.__thongKeVe?.matContext ?? 0,
          khoiPhuc: (w.__thongKeVe?.khoiPhuc ?? 0) + 1,
          near: w.__thongKeVe?.near ?? 0,
          far: w.__thongKeVe?.far ?? 0,
          camXa: w.__thongKeVe?.camXa ?? 0,
          tiLeFarNear: w.__thongKeVe?.tiLeFarNear ?? -1,
        };`;
if (!s.includes(cu2)) throw new Error("không thấy khối khôi-phục-context");
s = s.replace(cu2, moi2);
writeFileSync(F, s, "utf8");
console.log("ok");
