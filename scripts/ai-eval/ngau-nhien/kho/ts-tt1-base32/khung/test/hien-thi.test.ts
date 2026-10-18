import { test } from "node:test";
import assert from "node:assert/strict";
import { maHoa, giaiMa, maHoaSo } from "../src/base32.ts";

const b = (s: string) => new TextEncoder().encode(s);

test("mã hoá chuỗi ngắn", () => {
  assert.equal(maHoa(b("f")), "CR");
  assert.equal(maHoa(b("foobar")), "CSQPYRK1E8");
});

test("giải mã ngược lại", () => {
  assert.deepEqual(giaiMa("CSQPYRK1E8"), b("foobar"));
});

test("mã hoá số", () => {
  assert.equal(maHoaSo(0n), "0");
  assert.equal(maHoaSo(1234n), "16J");
});
