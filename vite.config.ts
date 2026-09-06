import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";


const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
    // ★★★ Twin 3D Đợt 0 — HAI BẢN `three` CÙNG TỒN TẠI LÀ LỖI CÂM PHỔ BIẾN NHẤT CỦA R3F.
    // `@react-three/fiber` và `@react-three/drei` mỗi gói khai `three` là peer dep; nếu
    // npm nâng lên hai bản khác nhau thì `instanceof THREE.Object3D` trả FALSE giữa hai
    // bản, raycast không bắt được vật thể, và KHÔNG có lỗi nào nổ — chỉ là "click vào máy
    // mà không có gì xảy ra". dedupe ép mọi import về MỘT bản duy nhất.
    dedupe: ["three"],
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Twin 3D Đợt 0 — gom `three` + hệ sinh thái R3F vào MỘT chunk `vendor-three`.
        //
        // VÌ SAO: three r182 nén ~600 KB. Không tách thì mọi màn KHÔNG dùng 3D (đăng nhập,
        // báo cáo, quản trị) vẫn phải tải nó vì nó nằm lẫn trong chunk chung. Tách ra thì
        // trình duyệt cache MỘT LẦN và chỉ tải khi vào màn 3D đầu tiên.
        //
        // ⚠ Vì sao khớp bằng ĐƯỜNG DẪN node_modules chứ không chỉ tên gói: `id` mà rollup
        // đưa vào là đường dẫn tuyệt đối đã resolve. Kiểm `/node_modules/three/` với hai
        // dấu gạch chéo bao quanh để KHÔNG nuốt nhầm `three-mesh-bvh` / `three-stdlib`
        // (§1.3 dự kiến cài `three-mesh-bvh` cho snap vật-vào-vật ở đợt sau) — gộp nhầm
        // sẽ kéo phụ thuộc của chúng vào chunk lõi và làm nó phình câm.
        manualChunks(id: string) {
          const p = id.replace(/\\/g, "/");
          if (p.includes("/node_modules/three/") || p.includes("/node_modules/@react-three/")) {
            return "vendor-three";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
