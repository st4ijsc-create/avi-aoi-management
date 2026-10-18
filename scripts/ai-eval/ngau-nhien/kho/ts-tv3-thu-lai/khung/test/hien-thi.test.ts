import { test } from "node:test";
import assert from "node:assert/strict";
import { thuLai } from "../src/thuLai.ts";

/** Hàm chờ giả: ghi lại số ms, không chờ thật. */
function choGia() {
  const lich: number[] = [];
  const cho = async (ms: number) => {
    lich.push(ms);
  };
  return { lich, cho };
}

test("thành công ngay lần đầu: không chờ", async () => {
  const { lich, cho } = choGia();
  assert.equal(await thuLai(async () => "ok", { cho }), "ok");
  assert.deepEqual(lich, []);
});

test("hỏng 2 lần rồi được: chờ 100 rồi 200 ms (mặc định)", async () => {
  const { lich, cho } = choGia();
  const cacLan: number[] = [];
  const kq = await thuLai(async (lan) => {
    cacLan.push(lan);
    if (lan < 3) throw new Error(`hỏng ${lan}`);
    return 42;
  }, { cho });
  assert.equal(kq, 42);
  assert.deepEqual(cacLan, [1, 2, 3]);
  assert.deepEqual(lich, [100, 200]);
});

test("lỗi không nên thử lại ⇒ ném ngay lỗi gốc", async () => {
  const { lich, cho } = choGia();
  const goc = new TypeError("sai dữ liệu");
  await assert.rejects(thuLai(async () => { throw goc; }, { cho, nenThuLai: () => false }), (e) => e === goc);
  assert.deepEqual(lich, []);
});
