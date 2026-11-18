// Chạy: node --test scripts/ai/kiem-he-thong.test.mjs (không GPU, không gọi llama-server)
import assert from "node:assert/strict";
import { test } from "node:test";
import { danhGia, docEnv, tachDongLenh, TRAN_VRAM_MIB, vramDuKienMib } from "./kiem-he-thong.mjs";

const LENH = '"D:\\16.AI\\llama-server.exe" -m D:/16.AI/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf --host 127.0.0.1 --port 8091 -c 65536 -np 1 --reasoning-budget 12000 --mmproj D:/16.AI/mm.gguf';
const GPU = [{ ten: "RTX", driver: "610.88", tongMib: 32607, dungMib: 27395 }];
const TOT = { gpu: GPU, health: 200, tienTrinh: [tachDongLenh(LENH)], env: { LLAMA_SERVER_MODEL: "x/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", LLAMA_SERVER_CTX_TOTAL: "65536", LLAMA_SERVER_REASONING_BUDGET: "12000" }, tepModel: { ten: "m.gguf", ton: true, byte: 1 }, sha: { giaTri: "ab", doiSoVoiCu: false } };
const ma = (t, muc) => danhGia(t).filter((d) => d.muc === muc).map((d) => d.ma);

test("tachDongLenh đọc đúng tham số thật của máy", () => {
  const p = tachDongLenh(LENH);
  assert.equal(p.model, "D:/16.AI/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf");
  assert.equal(p.mmproj, "D:/16.AI/mm.gguf");
  assert.equal(p.host, "127.0.0.1");
  assert.equal(p.port, 8091);
  assert.equal(p.ctx, 65536);
  assert.equal(p.slot, 1);
  assert.equal(p.reasoningBudget, 12000);
  assert.equal(p.coKhoaApi, false);
});

test("tachDongLenh không giữ giá trị khoá API, chỉ biết là có", () => {
  const p = tachDongLenh("llama-server --api-key bi-mat-123 --port 8091");
  assert.equal(p.coKhoaApi, true);
  assert.ok(!JSON.stringify(p).includes("bi-mat-123"));
  assert.equal(tachDongLenh("llama-server --api-key-file k.txt").coKhoaApi, true);
});

test("-c không khớp nhầm vào đuôi tham số khác (-ctk, -ctv)", () => {
  assert.equal(tachDongLenh("llama-server -ctk f16 -ctv f16 -c 98304").ctx, 98304);
  assert.equal(tachDongLenh("llama-server -ctk f16").ctx, null);
});

test("vramDuKienMib khớp ba mốc đo ±1 MiB", () => {
  assert.equal(vramDuKienMib(65536), 27157);
  assert.ok(Math.abs(vramDuKienMib(98304) - 27825) <= 3);
  assert.equal(vramDuKienMib(131072), 28497);
});

test("máy đúng cấu hình hiện tại: không có Phải sửa", () => {
  assert.deepEqual(ma(TOT, "phai-sua"), []);
  assert.deepEqual(ma(TOT, "nen-sua").sort(), ["ALIAS", "KHOA_API"]);
});

test("ctx làm VRAM dự kiến vượt 30,5 GB ⇒ Phải sửa, ngay dưới trần thì không", () => {
  const t = (ctx) => ({ ...TOT, env: null, tienTrinh: [{ ...tachDongLenh(LENH), ctx }] });
  let duoi = 65536;
  while (vramDuKienMib(duoi + 1024) <= TRAN_VRAM_MIB) duoi += 1024;
  assert.ok(!ma(t(duoi), "phai-sua").includes("CTX_VRAM"));
  assert.ok(ma(t(duoi + 1024), "phai-sua").includes("CTX_VRAM"));
});

test("bind ra ngoài ⇒ Phải sửa; 127.0.0.1 và không khai host ⇒ không", () => {
  const t = (host) => ({ ...TOT, tienTrinh: [{ ...tachDongLenh(LENH), host }] });
  assert.ok(ma(t("0.0.0.0"), "phai-sua").includes("BIND"));
  assert.ok(!ma(t("127.0.0.1"), "phai-sua").includes("BIND"));
  assert.ok(!ma(t(null), "phai-sua").includes("BIND"));
});

test("không GPU, /health chết, thiếu tệp model ⇒ Phải sửa đúng mã", () => {
  assert.ok(ma({ ...TOT, gpu: null }, "phai-sua").includes("GPU"));
  assert.ok(ma({ ...TOT, health: null }, "phai-sua").includes("CONG_8091"));
  assert.ok(ma({ ...TOT, health: 503 }, "phai-sua").includes("CONG_8091"));
  assert.ok(ma({ ...TOT, tepModel: { ten: "m", ton: false } }, "phai-sua").includes("TEP_MODEL"));
});

test("model chưa nạp: VRAM trống thiếu cho ctx đã khai ⇒ Phải sửa; đủ thì không", () => {
  const t = (dungMib) => ({ ...TOT, health: null, tienTrinh: [], gpu: [{ ...GPU[0], dungMib }] });
  assert.ok(ma(t(10000), "phai-sua").includes("VRAM_TRONG"));
  assert.ok(!ma(t(1000), "phai-sua").includes("VRAM_TRONG"));
});

test("dòng lệnh lệch .env ⇒ Nên sửa nêu đúng trường; khớp thì TỐT", () => {
  const lech = danhGia({ ...TOT, env: { ...TOT.env, LLAMA_SERVER_CTX_TOTAL: "131072" } }).find((d) => d.ma === "LECH_ENV");
  assert.equal(lech.muc, "nen-sua");
  assert.match(lech.chiTiet, /ctx \.env 131072, đang chạy 65536/);
  assert.equal(danhGia(TOT).find((d) => d.ma === "LECH_ENV").muc, "tot");
});

test("băm model: đổi so với lần trước ⇒ Nên sửa; chưa có ⇒ Nên sửa; khớp ⇒ TỐT", () => {
  const m = (sha) => danhGia({ ...TOT, sha }).find((d) => d.ma === "SHA_MODEL").muc;
  assert.equal(m({ giaTri: "x", doiSoVoiCu: true }), "nen-sua");
  assert.equal(m(null), "nen-sua");
  assert.equal(m({ giaTri: "x", doiSoVoiCu: false }), "tot");
});

test("hai GPU ⇒ Nên sửa vì broker mới đọc GPU 0", () => {
  assert.ok(ma({ ...TOT, gpu: [GPU[0], GPU[0]] }, "nen-sua").includes("NHIEU_GPU"));
});

test("docEnv chỉ lấy khoá được phép, bỏ chú thích và nháy", () => {
  const e = docEnv('DATABASE_URL=postgres://u:p@h/d\nLLAMA_SERVER_CTX_TOTAL="65536" # ctx\nLLAMA_SERVER_MODEL=a.gguf\nJWT_SECRET=s\n');
  assert.deepEqual(e, { LLAMA_SERVER_MODEL: "a.gguf", LLAMA_SERVER_CTX_TOTAL: "65536" });
});
