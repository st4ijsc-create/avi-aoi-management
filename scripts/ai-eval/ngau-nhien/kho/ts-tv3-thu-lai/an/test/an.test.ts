import { test } from "node:test";
import assert from "node:assert/strict";
import { thuLai } from "../src/thuLai.ts";

function choGia() {
  const lich: number[] = [];
  const cho = async (ms: number) => {
    lich.push(ms);
  };
  return { lich, cho };
}

const laHuy = (lyDo: unknown) => (e: unknown) => {
  assert.ok(e instanceof Error, "phải là Error");
  assert.equal(e.name, "AbortError");
  assert.equal(e.cause, lyDo);
  return true;
};

test("hết lượt ⇒ AggregateError gom mọi lỗi theo thứ tự; lịch luỹ thừa", async () => {
  const { lich, cho } = choGia();
  const ds = [1, 2, 3, 4].map((i) => new Error(`e${i}`));
  const cacLan: number[] = [];
  await assert.rejects(
    thuLai(async (lan) => {
      cacLan.push(lan);
      throw ds[lan - 1];
    }, { lanToiDa: 4, cho }),
    (e) => {
      assert.ok(e instanceof AggregateError);
      assert.equal(e.errors.length, 4);
      e.errors.forEach((x: unknown, i: number) => assert.equal(x, ds[i]));
      return true;
    },
  );
  assert.deepEqual(cacLan, [1, 2, 3, 4]);
  assert.deepEqual(lich, [100, 200, 400]);
});

test("mặc định lanToiDa = 3; lanToiDa = 1 ⇒ không chờ", async () => {
  const a = choGia();
  let goi = 0;
  await assert.rejects(thuLai(async () => { goi++; throw new Error("x"); }, { cho: a.cho }), AggregateError);
  assert.equal(goi, 3);
  assert.deepEqual(a.lich, [100, 200]);
  const b = choGia();
  await assert.rejects(thuLai(async () => { throw new Error("y"); }, { lanToiDa: 1, cho: b.cho }), (e) => {
    assert.ok(e instanceof AggregateError);
    assert.equal(e.errors.length, 1);
    return true;
  });
  assert.deepEqual(b.lich, []);
});

test("choToiDaMs chặn trên từng lần chờ; heSo và choMs tuỳ chỉnh", async () => {
  const { lich, cho } = choGia();
  await assert.rejects(
    thuLai(async () => { throw new Error("x"); }, { lanToiDa: 5, choMs: 300, heSo: 3, choToiDaMs: 1000, cho }),
    AggregateError,
  );
  assert.deepEqual(lich, [300, 900, 1000, 1000]);
  const b = choGia();
  await assert.rejects(thuLai(async () => { throw new Error("x"); }, { lanToiDa: 3, choMs: 0, cho: b.cho }), AggregateError);
  assert.deepEqual(b.lich, [0, 0]);
});

test("fn đồng bộ: ném đồng bộ cũng được thử lại; trả giá trị thường", async () => {
  const { lich, cho } = choGia();
  const kq = await thuLai((lan) => {
    if (lan === 1) throw new Error("đồng bộ");
    return lan * 10;
  }, { cho, choMs: 50, heSo: 1 });
  assert.equal(kq, 20);
  assert.deepEqual(lich, [50]);
});

test("nenThuLai nhận (lỗi, lần); trả false ⇒ ném lỗi gốc, kể cả ở lần cuối", async () => {
  const { lich, cho } = choGia();
  const ds = [new Error("tạm"), new RangeError("vĩnh viễn")];
  const nhan: [unknown, number][] = [];
  await assert.rejects(
    thuLai(async (lan) => { throw ds[lan - 1]; }, {
      cho,
      lanToiDa: 5,
      nenThuLai: (loi, lan) => {
        nhan.push([loi, lan]);
        return !(loi instanceof RangeError);
      },
    }),
    (e) => e === ds[1],
  );
  assert.equal(nhan.length, 2);
  assert.equal(nhan[0][0], ds[0]);
  assert.equal(nhan[0][1], 1);
  assert.equal(nhan[1][0], ds[1]);
  assert.equal(nhan[1][1], 2);
  assert.deepEqual(lich, [100]);
  const cuoi = new Error("lần 2");
  await assert.rejects(
    thuLai(async (lan) => { throw lan === 2 ? cuoi : new Error("lần 1"); }, { cho, lanToiDa: 2, nenThuLai: (_l, lan) => lan < 2 }),
    (e) => e === cuoi,
  );
});

test("signal đã huỷ từ trước ⇒ AbortError, fn không được gọi", async () => {
  const { cho } = choGia();
  const ac = new AbortController();
  const lyDo = new Error("người dùng huỷ");
  ac.abort(lyDo);
  let goi = 0;
  await assert.rejects(thuLai(async () => { goi++; return 1; }, { cho, signal: ac.signal }), laHuy(lyDo));
  assert.equal(goi, 0);
});

test("huỷ trong lúc chờ ⇒ AbortError, không gọi fn thêm; fn nhận signal", async () => {
  const ac = new AbortController();
  const lyDo = { ma: "HUY" };
  const lich: number[] = [];
  const nhanSignal: unknown[] = [];
  const cho = async (ms: number, signal?: AbortSignal) => {
    lich.push(ms);
    assert.equal(signal, ac.signal);
    ac.abort(lyDo);
    throw signal!.reason;
  };
  let goi = 0;
  await assert.rejects(
    thuLai(async (_lan, signal) => { goi++; nhanSignal.push(signal); throw new Error("x"); }, { cho, signal: ac.signal, lanToiDa: 5 }),
    laHuy(lyDo),
  );
  assert.equal(goi, 1);
  assert.deepEqual(lich, [100]);
  assert.equal(nhanSignal[0], ac.signal);
});

test("huỷ trong lúc fn chạy ⇒ AbortError ngay, không hỏi nenThuLai, không chờ", async () => {
  const { lich, cho } = choGia();
  const ac = new AbortController();
  let hoi = 0;
  await assert.rejects(
    thuLai(async () => { ac.abort("dừng"); throw new Error("bị ngắt"); }, {
      cho, signal: ac.signal, nenThuLai: () => { hoi++; return true; },
    }),
    laHuy("dừng"),
  );
  assert.equal(hoi, 0);
  assert.deepEqual(lich, []);
});

test("hàm chờ tự ném lỗi (không huỷ) ⇒ lỗi đó đi ra nguyên vẹn", async () => {
  const hong = new Error("đồng hồ hỏng");
  await assert.rejects(
    thuLai(async () => { throw new Error("x"); }, { cho: async () => { throw hong; } }),
    (e) => e === hong,
  );
});

test("tuỳ chọn sai ⇒ RangeError, fn không được gọi", async () => {
  let goi = 0;
  const fn = async () => { goi++; return 1; };
  for (const tc of [{ lanToiDa: 0 }, { lanToiDa: 1.5 }, { choMs: -1 }, { choMs: Number.NaN }, { heSo: 0.5 }, { choToiDaMs: -5 }]) {
    await assert.rejects(thuLai(fn, tc), RangeError, JSON.stringify(tc));
  }
  assert.equal(goi, 0);
});

test("hàm chờ mặc định dùng đồng hồ thật và tôn trọng signal (AbortSignal.timeout)", async () => {
  let goi = 0;
  assert.equal(await thuLai(async () => { if (++goi < 2) throw new Error("x"); return "xong"; }, { choMs: 1 }), "xong");
  const t0 = Date.now();
  const signal = AbortSignal.timeout(50);
  await assert.rejects(
    thuLai(async () => { throw new Error("x"); }, { choMs: 60_000, signal }),
    (e) => {
      assert.ok(e instanceof Error);
      assert.equal(e.name, "AbortError");
      assert.equal((e.cause as Error).name, "TimeoutError");
      return true;
    },
  );
  assert.ok(Date.now() - t0 < 5000, "phải dừng sớm khi signal hết hạn");
});
