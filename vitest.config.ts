import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  // doc69 Wave 0-C — mirrors vite.config.ts's @vitejs/plugin-react automatic JSX
  // runtime (no explicit `React` import needed in .tsx source) so *.unit.test.ts
  // files can import pure-logic .tsx modules (e.g. client/src/lib/navigation.tsx)
  // without every file needing an explicit `import React from "react"`. Test-only;
  // does not add the plugin itself (no fast-refresh/babel needed for node-env tests).
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    // server tests + node-env client logic tests (named *.unit.test.ts so jsdom-only client
    // tests like exportUtils.test.ts are NOT pulled into the node environment).
    // dot2 Task 1 — "scripts/**/*.test.ts" thêm vào vì scripts/ai-bench/bench.production-parity.test.ts
    // là test server-side (đọc mã nguồn bench.mjs) nhưng KHÔNG nằm dưới server/; trước khi thêm,
    // scripts/ chỉ có test *.test.mjs chạy trực tiếp bằng `node` (không qua vitest) nên dòng này
    // không đổi hành vi của các test .mjs đó.
    //
    // BG-129 (Lô 9 Mục 1) — "client/src/**/*.dom.test.tsx" thêm CHỈ cho đuôi MỚI này. Global
    // `environment` GIỮ NGUYÊN "node" (rẻ/nhanh cho phần lớn test) — mỗi file `*.dom.test.tsx`
    // tự chọn jsdom qua docblock `// @vitest-environment jsdom` đầu file (vitest đọc per-file,
    // xem https://vitest.dev/config/#environment — "you can also set this by adding a docblock");
    // đây là cách ÍT ĐỤNG CONFIG TOÀN CỤC NHẤT trong hai phương án đã cân nhắc:
    //   (A, CHỌN) docblock per-file + suffix riêng — 0 project/workspace mới, 0 đổi hành vi cho
    //   test cũ, đúng NGUYÊN VĂN convention đã có sẵn (nhưng chưa từng chạy) ở
    //   `exportUtils.test.ts`/`resolveOklchColors.dom.test.ts`/`reportPrintView.dom.test.ts` — ba
    //   file này tự khai "environment: node, 0 jsdom" trong docblock của chính chúng nhưng
    //   KHÔNG NẰM trong `include` cũ nên chưa từng được vitest thu thập (xác nhận: chạy
    //   `npx vitest run <file>` trên HEAD trước lô này ra "No test files found"). KHÔNG thêm
    //   `*.test.ts`/`*.dom.test.ts` (đuôi CŨ, không .tsx) vào include ở đây — đó là di trú test cũ,
    //   brief Lô 9 cấm ("KHÔNG di trú test cũ nào"); chỉ mở đuôi MỚI `.dom.test.tsx` cho việc dùng
    //   từ lô này trở đi.
    //   (B, BỎ) vitest workspace/projects (một "project" jsdom riêng qua `test.projects`) — đổi
    //   cấu trúc config cho MỌI người chạy test (thêm bước resolve project, ảnh hưởng
    //   `vitest --project` CLI, script CI), phạm vi lớn hơn hẳn nhu cầu (chỉ vài file DOM ở lô
    //   này) — không chọn.
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "shared/**/*.test.ts",
      "client/src/**/*.unit.test.ts",
      "client/src/**/*.dom.test.tsx",
      "scripts/**/*.test.ts",
      "vscode-extension/src/**/*.unit.test.ts",
    ],
    // Loads .env + forces DATABASE_URL to an ISOLATED test DB (see vitest.setup.ts).
    // Provision once: `node scripts/setup-test-db.mjs`.
    setupFiles: ["./vitest.setup.ts"],
  },
});
