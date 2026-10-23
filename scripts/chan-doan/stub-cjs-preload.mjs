// --import scripts/chan-doan/stub-cjs-preload.mjs  (+ DIAG_STUB_NATIVE=rollup,lightningcss,oxide)
// Chặn require() CommonJS của addon native của Vite (rollup / lightningcss / @tailwindcss/oxide) và trả Proxy: khởi động xong,
// chỉ lỗi khi CÓ AI GỌI HÀM (boot không biên dịch trang nào nên không gọi). Dùng để bisect lỗi heap lúc boot dev.
import Module from "node:module";
const muon = new Set((process.env.DIAG_STUB_NATIVE ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const KHOP = {
  rollup: /rollup[-.]win32|@rollup[\/]rollup-win32/i,
  lightningcss: /lightningcss[-.]win32|lightningcss-win32/i,
  oxide: /oxide[-.]win32|@tailwindcss[\/]oxide-win32/i,
};
const stub = () => new Proxy(function () {}, {
  get: (_t, p) => (p === "__esModule" ? false : p === "then" ? undefined : stub()),
  apply: () => { throw new Error("DIAG stub native"); },
  construct: () => { throw new Error("DIAG stub native"); },
});
const goc = Module._load;
Module._load = function (request, parent, isMain) {
  for (const k of muon) if (KHOP[k]?.test(String(request))) return stub();
  return goc.apply(this, arguments);
};
