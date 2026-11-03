# vendor/oip-plc — trình biên dịch + AST walker Structured Text (IEC 61131-3, tập con) của Open Industry Project

| | |
|---|---|
| Nguồn | https://github.com/Open-Industry-Project/Open-Industry-Project (TypeScript) |
| Commit | `8970f09059c657c60b2a0fc3bc77a0fe95ba6195` (2026-11-02T19:46:38-05:00) |
| Giấy phép | MIT — `LICENSE` (Copyright (c) 2024-present, Automation Standard LLC and Contributors), sao nguyên văn |
| Sao ngày | 2026-11-03 (do-model, dieu-phoi duyệt B1 cùng ngày) |
| Phạm vi | 37 tệp `.ts`, 15 372 dòng = bao đóng import TĨNH của `src/plc/interpreter.ts` (`compile`); đường dẫn giữ nguyên ⇒ không sửa import nào |
| Cập nhật | KHÔNG tự cập nhật theo upstream (dự án "early development"); muốn lên commit mới ⇒ sao lại + rà lại + so bảng băm dưới |

## Dùng để làm gì — và KHÔNG làm gì

- CHỈ trong test: bộ chấm ST HÀNH VI bổ sung cho Đợt 9 (`compile` + `setInput` / `scan(dt)` / `get`, thời gian mô phỏng tất định).
  MATIEC vẫn là cổng biên dịch; OIP là điểm hành vi bổ sung.
- KHÔNG mã server / client / shared nào import thư mục này (census ghim; không vào `dist`).
- CHỈ AST walker. ST do model sinh là ĐẦU VÀO KHÔNG TIN CẬY ⇒ không bao giờ dùng đường "typed" (sinh JS rồi `new Function`). Ba lớp
  (dieu-phoi duyệt 03/11, làm cùng lúc):
  1. bộ bọc test-only gọi `setScanEngine('walker')` khi nạp và kiểm lại trước MỖI `compile`;
  2. bẫy: trong `compile` + mọi `scan`, `globalThis.Function` / `globalThis.eval` bị thay bằng hàm NÉM, trả lại trong `finally`;
  3. **sửa HÀNH VI vendor (không chỉ import) — `va-vendor.patch`**: `evaluate()` của `src/plc/scanCodegen.ts` NÉM "cam sinh ma" thay vì
     `new Function` / `Compartment.evaluate`. Lý do: ST do model sinh là đầu vào không tin cậy; biên dịch ra JS rồi chạy trong tiến trình
     test = thực thi mã tuỳ ý nếu bộ phát có lỗ. Đường typed khi gặp lỗi này tự lùi về walker (`generateBody` bắt lỗi ⇒ `null`).

## Rà tĩnh TRƯỚC khi chạy (37 tệp, 03/11)

| mẫu | số dòng khớp |
|---|---|
| `fetch(` · `http(s)://` · `XMLHttpRequest` · `WebSocket` | 0 · 0 · 0 · 0 |
| `child_process` · `worker_threads` / `new Worker` | 0 · 0 |
| `from 'node:…'` · `require(` · `fs.` · `process.` | 0 · 0 · 0 · 0 |
| `eval(` · `setTimeout` / `setInterval` / `queueMicrotask` | 0 · 0 |
| `localStorage` / `indexedDB` / `document.` / `window.` | 0 |
| `new Function` | 1 — `scanCodegen.ts:1039` `evaluate()` (đường typed) ⇒ bị `va-vendor.patch` chặn |
| `Compartment` | 8 — chú thích + `scanCodegen.ts:1036` (cùng `evaluate()`) |
| `globalThis` | 2 — `partSandbox.ts:8` CHỈ ĐỌC `globalThis.Compartment`; `scanCodegen.ts:1036` (cùng `evaluate()`) |
| `import(` | 1 — `types.ts:644` là KIỂU (`import('./ladder/ladder').LdSection[]`), không phải import động |
| `console.` | 2 — `console.warn` khi lùi về walker (`interpreter.ts:1217`, `scanCodegen.ts:1075`) |

Không import ngoài (không gói npm, không `node:`). Không gì ngoài mục đích.

## Bảng tệp (bản UPSTREAM — sha256 để lần sau so lại)

`src/plc/scanCodegen.ts` sau `va-vendor.patch`: sha256 `401596aa9cabcc1bed1fb9b3b9e81fc1c313ac5ab792480ad34ebbe2eb431874`.

| tệp | dòng | sha256 (upstream 8970f09) |
|---|---|---|
| `LICENSE` | 21 | `7df94d38c1acf252388708fa243383f1b2f22ad4e5eedb3caeaeda83c81b0e50` |
| `src/core/io/iecAddress.ts` | 88 | `f89cb454bbdd28f1d9e49308ccaae54449ceb0b0f9772060f1c7d6d27b6878be` |
| `src/core/motionAxis.ts` | 664 | `6ffd30426030de5fd5b1e156a97243d2114795a1f2c03ec610f3b2673890f6a9` |
| `src/core/parts/partSandbox.ts` | 9 | `e4b33cd45e8da8677d391e77ef79d090fe3eae7322ec0b69457ea69e3bc39090` |
| `src/plc/builtins.ts` | 661 | `0c3cfa093794a8fefa39c5100dc132278b1a8c42cfb2a7918d63e797cc5a9ce6` |
| `src/plc/checkAssign.ts` | 152 | `4f2b9fc55040f9c5c291450d8f056b9b90557c573a93bc033576adaf2ab41db6` |
| `src/plc/checkCalls.ts` | 346 | `f6d684aee75ad39406bdbc0d69d9dfa3386cfd62c9b709aa26b50ad08f39fe7e` |
| `src/plc/checkConfiguration.ts` | 253 | `3d921b8e0fb1adc9e049c42c4389040bdafe075cab9ac29439c15516ddb3e98e` |
| `src/plc/checkExpr.ts` | 545 | `dde83a11c66efca8c353764d298371c7f7ffd48b399fd49f63056057faa91b72` |
| `src/plc/checkInit.ts` | 276 | `553535a6e01f3bf4b216477d48dafeb7797094e94ace7adf52871c3576962508` |
| `src/plc/checkPous.ts` | 402 | `5f253ece484002e3d782c71f855bf32cc2ed506f5c9605ddad3ccf5ca4c9b954` |
| `src/plc/checkScope.ts` | 177 | `5dd8c4f28f543327a9cc791055c2ed630d01158b16c4c29bdc54dd5c486cc57e` |
| `src/plc/checkStmt.ts` | 258 | `7339d9d3fc3b76d6cdb9ec669a620563da2bee71812a7568c29a60c744993f4f` |
| `src/plc/checkTypeDefs.ts` | 333 | `1502eeecf012caadfe2c83ded1f070d4635ec5a0c0f773471b5a077e673ad908` |
| `src/plc/checker.ts` | 366 | `41398fa9ab0f57ed6ca1d8e6d3fa626d0b0b6979aa3dd5a0ce8ecf4bf5cc029d` |
| `src/plc/faults.ts` | 34 | `db3f9210f7979b01145cd014b0115b63990fb1559b870b6cfe5299543a5d7e8a` |
| `src/plc/interpreter.ts` | 1384 | `121de765e46f613131c321f500b6ff35838a82aeef599d18c1794d415a733e44` |
| `src/plc/ladder/ladder.ts` | 1158 | `94504d05f2c6b90501e8ee449984a8d08e59dfc084d4ec9c0ae71f900cbfb099` |
| `src/plc/lexer.ts` | 493 | `4008fa0c213b65e881321ec83c097c6337060b8ce481144d4b1f93fb94e6a0bb` |
| `src/plc/motionChannel.ts` | 162 | `6ccce8cdb7ace80bd45c3f467f74788412d025d26682ec4f6f773b430de958ab` |
| `src/plc/motionPrelude.ts` | 473 | `a6e06bb93e6875bfb17165087c4714b76ce08f4c84a3ba634a96e76008625c0d` |
| `src/plc/parser.ts` | 447 | `66500e15c3da46c4bf863aad094f50e3a5ff0f26acd3a27bd37c083537bc1f6a` |
| `src/plc/parserBase.ts` | 220 | `d9928cba8f767fceff89acf0a2625249827e53f82fc9531b37e4ea84bcced2ff` |
| `src/plc/parserDecl.ts` | 535 | `9b17a782ce8218b2c0d359b8a36273521d42f928dc8293f2da40edecbc230849` |
| `src/plc/parserExpr.ts` | 291 | `cde81af5ae8e2d372ffe6ec83cda2195884d66d9ba39337be0b95b6a7ba026e3` |
| `src/plc/parserLadder.ts` | 324 | `0143f6cfc7acece3e6d64aa09ca02877aba0702a7bf46a13c66c5009c5b815ad` |
| `src/plc/parserStmt.ts` | 261 | `1b0b27d01ef1209c15e43c5fe3c3e97d8238ea02d70f2835becf4df3b0621b63` |
| `src/plc/pou.ts` | 374 | `dbd894c2cd680da11b80beec39b29fd67456f18ca96b6c05a6ebbf261015690d` |
| `src/plc/program.ts` | 174 | `a0d216a446e313cb28fcc2cf6c611942fe311353da630a9d13f34b7f0aef23d1` |
| `src/plc/runtime.ts` | 987 | `764f606c4c09983512307b62ddc3455553ff13b992748216e71d7cd34a1d6e4b` |
| `src/plc/scanCodegen.ts` | 1100 | `89cb62b1d0c8a881e7f9cc7dab9b478e8290643b7c187487b68f4e02a5f90225` |
| `src/plc/typed/arena.ts` | 106 | `70ad7fdcd4a7ca54286e079a65a8a49f8c3d5f3490e5739103884be5729184c6` |
| `src/plc/typed/blocks.ts` | 169 | `0d6180d4226efec078fd36639edd77a69702726965f21a1116c88555676d3f67` |
| `src/plc/typed/calls.ts` | 100 | `c24045d8247072352f4bebe2c34fe2a9c766baa25304098952ef967b705260ff` |
| `src/plc/typed/compile.ts` | 66 | `cf56eb397bc94956aa0b3b229af9b9a33f11375934115f0326523e0bc551aa04` |
| `src/plc/typed/layout.ts` | 328 | `fa6ced9d170cc76ac659fcb299c4de0aaa7a164a87a6c772d92d78a395dbed12` |
| `src/plc/typed/pou.ts` | 848 | `9c10c468a3f3f06cd5ba92efab3e37e6f065233dd57d08006e51897ef837dddc` |
| `src/plc/types.ts` | 808 | `071d9f1af613f61ae68d8f8e438e125d9c5ae54c5af3df8d6283ec0a5a7bdb66` |
