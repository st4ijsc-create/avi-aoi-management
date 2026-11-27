/**
 * V0 — kế hoạch Thợ Cả §10.3: lệnh kiểm vitest đỏ ⇒ model nhận TÊN mọi ca đỏ + thông báo đầu từng ca, chi tiết trong một ngân sách, cắt thì nói rõ.
 * Mọi ca đi qua đường công khai đã có (taoChayLenhKiem → tomTatKiemChoModel / driverHost / chayMotViec): một tiến trình con PHÁT LẠI đầu ra THẬT của vitest 2.1.9
 * (stdout phần đầu → stderr → stdout phần tổng kết, như thứ tự trong đầu ra thật). Fixture sinh bằng script từ đầu ra bắt ngày 27/11; đường thư mục tạm đổi thành <tam>.
 * LỆCH CÓ TÊN «V0-TRAN-TEN» (HST duyệt 27/11): §10.3 ghi "không cắt tên"; ở đây tối đa 100 tên × 300 ký tự, quá thì nói còn bao nhiêu.
 * ĐỘT BIẾN PHẢI BẮT: cắt đuôi như cũ · bỏ đói khối đầu / khối cuối · mất tên thứ hai của khối gộp · không báo cắt · không báo đọc thiếu tên · đọc cả stdout (dính FAIL giả) ·
 * không che token ở khối · vượt ngân sách · bỏ trần tên · đổi byte lượt xanh · gửi tên ở chế độ chỉ số · khối lọt vào chay.json.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chayMotViec, type DauVaoDriver } from "./chayMotViec";
import { driverHost, tomTatKiemChoModel, tomTatChiSoChoModel, type ChinhSachDuyet, type PhuThuocHost } from "./driverHost";
import { taoChayLenhKiem, type KetQuaKiem } from "./kiemChung";
import type { TheViec } from "./theViec";

const FX: Record<string, { out: string; err: string }> = {
  "sau-do": {
    out: "\n RUN  v2.1.9 <tam>\n\nstdout | sau-do.test.ts\n FAIL  gia.test.ts > nhom gia > ca gia in ra tu console\n\n ❯ sau-do.test.ts (7 tests | 6 failed) 9ms\n   × nhom ngoai > nhom trong > ca 1 mang lech 4ms\n     → expected [ 'SPI', 'FCT' ] to deeply equal [ 'SPI', 'AOI_PRE', 'REFLOW', …(4) ]\n   × nhom ngoai > nhom trong > ca 2 so gan dung 0ms\n     → expected +0 to be close to 1, received difference is 1, but expected 0.005\n   × nhom ngoai > nhom trong > ca 3 do dai 1ms\n     → expected [ { station: 'AOI_PRE', …(2) }, …(1) ] to have a length of 1 but got 2\n   × nhom ngoai > nhom trong > ca 4 doi tuong 1ms\n     → expected { a: 1, …(2) } to deeply equal { a: 2, b: [], …(1) }\n   × nhom ngoai > nhom trong > ca 5 chuoi dai 1ms\n     → expected 'dong mot\\ndong hai\\ndong ba' to be 'dong mot\\ndong HAI\\ndong ba' // Object.is equality\n   × nhom ngoai > nhom trong > ca 6 nem loi 0ms\n     → khong doc duoc thuoc tinh\n\n Test Files  1 failed (1)\n      Tests  6 failed | 1 passed (7)\n   Start at  22:33:59\n   Duration  296ms (transform 18ms, setup 0ms, collect 10ms, tests 9ms, environment 0ms, prepare 122ms)\n\n",
    err: "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  sau-do.test.ts > nhom ngoai > nhom trong > ca 1 mang lech\nAssertionError: expected [ 'SPI', 'FCT' ] to deeply equal [ 'SPI', 'AOI_PRE', 'REFLOW', …(4) ]\n\n- Expected\n+ Received\n\n  Array [\n    \"SPI\",\n-   \"AOI_PRE\",\n-   \"REFLOW\",\n-   \"AOI_POST\",\n-   \"AXI\",\n-   \"ICT\",\n    \"FCT\",\n  ]\n\n ❯ sau-do.test.ts:5:56\n      3| describe(\"nhom ngoai\", () => {\n      4|   describe(\"nhom trong\", () => {\n      5|     it(\"ca 1 mang lech\", () => { expect([\"SPI\",\"FCT\"]).toEqual(tram); …\n       |                                                        ^\n      6|     it(\"ca 2 so gan dung\", () => { expect(0).toBeCloseTo(1.0); });\n      7|     it(\"ca 3 do dai\", () => { expect([{ station: \"AOI_PRE\", escapes: 2…\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯\n\n FAIL  sau-do.test.ts > nhom ngoai > nhom trong > ca 2 so gan dung\nAssertionError: expected +0 to be close to 1, received difference is 1, but expected 0.005\n ❯ sau-do.test.ts:6:46\n      4|   describe(\"nhom trong\", () => {\n      5|     it(\"ca 1 mang lech\", () => { expect([\"SPI\",\"FCT\"]).toEqual(tram); …\n      6|     it(\"ca 2 so gan dung\", () => { expect(0).toBeCloseTo(1.0); });\n       |                                              ^\n      7|     it(\"ca 3 do dai\", () => { expect([{ station: \"AOI_PRE\", escapes: 2…\n      8|     it(\"ca 4 doi tuong\", () => { expect({ a: 1, b: tram, c: \"x\".repeat…\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯\n\n FAIL  sau-do.test.ts > nhom ngoai > nhom trong > ca 3 do dai\nAssertionError: expected [ { station: 'AOI_PRE', …(2) }, …(1) ] to have a length of 1 but got 2\n\n- Expected\n+ Received\n\n- 1\n+ 2\n\n ❯ sau-do.test.ts:7:132\n      5|     it(\"ca 1 mang lech\", () => { expect([\"SPI\",\"FCT\"]).toEqual(tram); …\n      6|     it(\"ca 2 so gan dung\", () => { expect(0).toBeCloseTo(1.0); });\n      7|     it(\"ca 3 do dai\", () => { expect([{ station: \"AOI_PRE\", escapes: 2…\n       |                                                                                                                                    ^\n      8|     it(\"ca 4 doi tuong\", () => { expect({ a: 1, b: tram, c: \"x\".repeat…\n      9|     it(\"ca 5 chuoi dai\", () => { expect(\"dong mot\\ndong hai\\ndong ba\")…\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯\n\n FAIL  sau-do.test.ts > nhom ngoai > nhom trong > ca 4 doi tuong\nAssertionError: expected { a: 1, …(2) } to deeply equal { a: 2, b: [], …(1) }\n\n- Expected\n+ Received\n\n  Object {\n-   \"a\": 2,\n-   \"b\": Array [],\n-   \"c\": \"yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\",\n+   \"a\": 1,\n+   \"b\": Array [\n+     \"SPI\",\n+     \"AOI_PRE\",\n+     \"REFLOW\",\n+     \"AOI_POST\",\n+     \"AXI\",\n+     \"ICT\",\n+     \"FCT\",\n+   ],\n+   \"c\": \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\",\n  }\n\n ❯ sau-do.test.ts:8:80\n      6|     it(\"ca 2 so gan dung\", () => { expect(0).toBeCloseTo(1.0); });\n      7|     it(\"ca 3 do dai\", () => { expect([{ station: \"AOI_PRE\", escapes: 2…\n      8|     it(\"ca 4 doi tuong\", () => { expect({ a: 1, b: tram, c: \"x\".repeat…\n       |                                                                                ^\n      9|     it(\"ca 5 chuoi dai\", () => { expect(\"dong mot\\ndong hai\\ndong ba\")…\n     10|     it(\"ca 6 nem loi\", () => { throw new TypeError(\"khong doc duoc thu…\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯\n\n FAIL  sau-do.test.ts > nhom ngoai > nhom trong > ca 5 chuoi dai\nAssertionError: expected 'dong mot\\ndong hai\\ndong ba' to be 'dong mot\\ndong HAI\\ndong ba' // Object.is equality\n\n- Expected\n+ Received\n\n  dong mot\n- dong HAI\n+ dong hai\n  dong ba\n\n ❯ sau-do.test.ts:9:72\n      7|     it(\"ca 3 do dai\", () => { expect([{ station: \"AOI_PRE\", escapes: 2…\n      8|     it(\"ca 4 doi tuong\", () => { expect({ a: 1, b: tram, c: \"x\".repeat…\n      9|     it(\"ca 5 chuoi dai\", () => { expect(\"dong mot\\ndong hai\\ndong ba\")…\n       |                                                                        ^\n     10|     it(\"ca 6 nem loi\", () => { throw new TypeError(\"khong doc duoc thu…\n     11|     it(\"ca xanh\", () => { expect(1).toBe(1); });\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯\n\n FAIL  sau-do.test.ts > nhom ngoai > nhom trong > ca 6 nem loi\nTypeError: khong doc duoc thuoc tinh\n ❯ sau-do.test.ts:10:38\n      8|     it(\"ca 4 doi tuong\", () => { expect({ a: 1, b: tram, c: \"x\".repeat…\n      9|     it(\"ca 5 chuoi dai\", () => { expect(\"dong mot\\ndong hai\\ndong ba\")…\n     10|     it(\"ca 6 nem loi\", () => { throw new TypeError(\"khong doc duoc thu…\n       |                                      ^\n     11|     it(\"ca xanh\", () => { expect(1).toBe(1); });\n     12|   });\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯\n\n",
  },
  "gop": {
    out: "\n RUN  v2.1.9 <tam>\n\n ❯ gop.test.ts (2 tests | 2 failed) 5ms\n   × nhom gop > ca gop mot 4ms\n     → expected 1 to be 2 // Object.is equality\n   × nhom gop > ca gop hai 0ms\n     → expected 1 to be 2 // Object.is equality\n\n Test Files  1 failed (1)\n      Tests  2 failed (2)\n   Start at  22:34:00\n   Duration  285ms (transform 16ms, setup 0ms, collect 9ms, tests 5ms, environment 0ms, prepare 117ms)\n\n",
    err: "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  gop.test.ts > nhom gop > ca gop mot\n FAIL  gop.test.ts > nhom gop > ca gop hai\nAssertionError: expected 1 to be 2 // Object.is equality\n\n- Expected\n+ Received\n\n- 2\n+ 1\n\n ❯ gop.test.ts:2:77\n      1| describe(\"nhom gop\", () => {\n      2|   for (const ten of [\"ca gop mot\", \"ca gop hai\"]) it(ten, () => { expe…\n       |                                                                             ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯\n\n",
  },
  "nap-hong": {
    out: "\n RUN  v2.1.9 <tam>\n\n ❯ nap-hong.test.ts (0 test)\n\n Test Files  1 failed (1)\n      Tests  no tests\n   Start at  22:34:01\n   Duration  299ms (transform 18ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 121ms)\n\n",
    err: "⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  nap-hong.test.ts [ nap-hong.test.ts ]\nError: Failed to load url ./khong-co-tep-nay (resolved id: ./khong-co-tep-nay) in <tam>/nap-hong.test.ts. Does the file exist?\n ❯ loadAndTransform D:/SOURCES/avi-aoi-management/node_modules/vitest/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯\n\n",
  },
  "khong-xu-ly": {
    out: "\n RUN  v2.1.9 <tam>\n\n ✓ khong-xu-ly.test.ts (1 test) 32ms\n\n⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯\n\nVitest caught 1 unhandled error during the test run.\nThis might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n Test Files  1 passed (1)\n      Tests  1 passed (1)\n     Errors  1 error\n   Start at  22:34:01\n   Duration  320ms (transform 16ms, setup 0ms, collect 9ms, tests 32ms, environment 0ms, prepare 116ms)\n\n",
    err: "\n⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯\nError: loi khong ai bat\n ❯ khong-xu-ly.test.ts:2:18\n      1| it(\"ca xanh nhung co loi roi\", async () => {\n      2|   Promise.reject(new Error(\"loi khong ai bat\"));\n       |                  ^\n      3|   await new Promise((r) => setTimeout(r, 30));\n      4| });\n ❯ D:/SOURCES/avi-aoi-management/node_modules/@vitest/runner/dist/index.js:146:14\n ❯ D:/SOURCES/avi-aoi-management/node_modules/@vitest/runner/dist/index.js:533:11\n ❯ runWithTimeout D:/SOURCES/avi-aoi-management/node_modules/@vitest/runner/dist/index.js:39:7\n ❯ runTest D:/SOURCES/avi-aoi-management/node_modules/@vitest/runner/dist/index.js:1056:17\n ❯ processTicksAndRejections node:internal/process/task_queues:104:5\n ❯ runSuite D:/SOURCES/avi-aoi-management/node_modules/@vitest/runner/dist/index.js:1205:15\n ❯ runFiles D:/SOURCES/avi-aoi-management/node_modules/@vitest/runner/dist/index.js:1262:5\n ❯ startTests D:/SOURCES/avi-aoi-management/node_modules/@vitest/runner/dist/index.js:1271:3\n ❯ D:/SOURCES/avi-aoi-management/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11\n\nThis error originated in \"khong-xu-ly.test.ts\" test file. It doesn't mean the error was thrown inside the file itself, but while it was running.\nThe latest test that might've caused the error is \"ca xanh nhung co loi roi\". It might mean one of the following:\n- The error was thrown, while Vitest was running this test.\n- If the error occurred after the test had been completed, this was the last documented test before it was thrown.\n\n",
  },
  "xanh": {
    out: "\n RUN  v2.1.9 <tam>\n\n ✓ xanh.test.ts (1 test) 1ms\n\n Test Files  1 passed (1)\n      Tests  1 passed (1)\n   Start at  22:34:02\n   Duration  292ms (transform 16ms, setup 0ms, collect 9ms, tests 1ms, environment 0ms, prepare 118ms)\n\n",
    err: "",
  },
  "nhieu-do": {
    out: "\n RUN  v2.1.9 <tam>\n\n ❯ nhieu-do.test.ts (30 tests | 30 failed) 12ms\n   × nhom nhieu > ca nhieu 1 4ms\n     → expected [ 1, …(1) ] to deeply equal [ 2, …(1) ]\n   × nhom nhieu > ca nhieu 2 0ms\n     → expected [ 2, …(1) ] to deeply equal [ 3, …(1) ]\n   × nhom nhieu > ca nhieu 3 0ms\n     → expected [ 3, …(1) ] to deeply equal [ 4, …(1) ]\n   × nhom nhieu > ca nhieu 4 0ms\n     → expected [ 4, …(1) ] to deeply equal [ 5, …(1) ]\n   × nhom nhieu > ca nhieu 5 0ms\n     → expected [ 5, …(1) ] to deeply equal [ 6, …(1) ]\n   × nhom nhieu > ca nhieu 6 0ms\n     → expected [ 6, …(1) ] to deeply equal [ 7, …(1) ]\n   × nhom nhieu > ca nhieu 7 0ms\n     → expected [ 7, …(1) ] to deeply equal [ 8, …(1) ]\n   × nhom nhieu > ca nhieu 8 0ms\n     → expected [ 8, …(1) ] to deeply equal [ 9, …(1) ]\n   × nhom nhieu > ca nhieu 9 0ms\n     → expected [ 9, …(1) ] to deeply equal [ 10, …(1) ]\n   × nhom nhieu > ca nhieu 10 0ms\n     → expected [ 10, …(1) ] to deeply equal [ 11, …(1) ]\n   × nhom nhieu > ca nhieu 11 0ms\n     → expected [ 11, …(1) ] to deeply equal [ 12, …(1) ]\n   × nhom nhieu > ca nhieu 12 0ms\n     → expected [ 12, …(1) ] to deeply equal [ 13, …(1) ]\n   × nhom nhieu > ca nhieu 13 0ms\n     → expected [ 13, …(1) ] to deeply equal [ 14, …(1) ]\n   × nhom nhieu > ca nhieu 14 0ms\n     → expected [ 14, …(1) ] to deeply equal [ 15, …(1) ]\n   × nhom nhieu > ca nhieu 15 0ms\n     → expected [ 15, …(1) ] to deeply equal [ 16, …(1) ]\n   × nhom nhieu > ca nhieu 16 0ms\n     → expected [ 16, …(1) ] to deeply equal [ 17, …(1) ]\n   × nhom nhieu > ca nhieu 17 0ms\n     → expected [ 17, …(1) ] to deeply equal [ 18, …(1) ]\n   × nhom nhieu > ca nhieu 18 0ms\n     → expected [ 18, …(1) ] to deeply equal [ 19, …(1) ]\n   × nhom nhieu > ca nhieu 19 0ms\n     → expected [ 19, …(1) ] to deeply equal [ 20, …(1) ]\n   × nhom nhieu > ca nhieu 20 0ms\n     → expected [ 20, …(1) ] to deeply equal [ 21, …(1) ]\n   × nhom nhieu > ca nhieu 21 0ms\n     → expected [ 21, …(1) ] to deeply equal [ 22, …(1) ]\n   × nhom nhieu > ca nhieu 22 0ms\n     → expected [ 22, …(1) ] to deeply equal [ 23, …(1) ]\n   × nhom nhieu > ca nhieu 23 0ms\n     → expected [ 23, …(1) ] to deeply equal [ 24, …(1) ]\n   × nhom nhieu > ca nhieu 24 0ms\n     → expected [ 24, …(1) ] to deeply equal [ 25, …(1) ]\n   × nhom nhieu > ca nhieu 25 0ms\n     → expected [ 25, …(1) ] to deeply equal [ 26, …(1) ]\n   × nhom nhieu > ca nhieu 26 0ms\n     → expected [ 26, …(1) ] to deeply equal [ 27, …(1) ]\n   × nhom nhieu > ca nhieu 27 0ms\n     → expected [ 27, …(1) ] to deeply equal [ 28, …(1) ]\n   × nhom nhieu > ca nhieu 28 0ms\n     → expected [ 28, …(1) ] to deeply equal [ 29, …(1) ]\n   × nhom nhieu > ca nhieu 29 0ms\n     → expected [ 29, …(1) ] to deeply equal [ 30, …(1) ]\n   × nhom nhieu > ca nhieu 30 0ms\n     → expected [ 30, …(1) ] to deeply equal [ 31, …(1) ]\n\n Test Files  1 failed (1)\n      Tests  30 failed (30)\n   Start at  22:34:03\n   Duration  320ms (transform 14ms, setup 0ms, collect 9ms, tests 12ms, environment 0ms, prepare 101ms)\n\n",
    err: "⎯⎯⎯⎯⎯⎯ Failed Tests 30 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 1\nAssertionError: expected [ 1, …(1) ] to deeply equal [ 2, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   2,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   1,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 2\nAssertionError: expected [ 2, …(1) ] to deeply equal [ 3, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   3,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   2,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 3\nAssertionError: expected [ 3, …(1) ] to deeply equal [ 4, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   4,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   3,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 4\nAssertionError: expected [ 4, …(1) ] to deeply equal [ 5, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   5,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   4,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 5\nAssertionError: expected [ 5, …(1) ] to deeply equal [ 6, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   6,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   5,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 6\nAssertionError: expected [ 6, …(1) ] to deeply equal [ 7, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   7,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   6,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 7\nAssertionError: expected [ 7, …(1) ] to deeply equal [ 8, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   8,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   7,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 8\nAssertionError: expected [ 8, …(1) ] to deeply equal [ 9, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   9,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   8,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 9\nAssertionError: expected [ 9, …(1) ] to deeply equal [ 10, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   10,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   9,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 10\nAssertionError: expected [ 10, …(1) ] to deeply equal [ 11, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   11,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   10,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 11\nAssertionError: expected [ 11, …(1) ] to deeply equal [ 12, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   12,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   11,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 12\nAssertionError: expected [ 12, …(1) ] to deeply equal [ 13, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   13,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   12,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 13\nAssertionError: expected [ 13, …(1) ] to deeply equal [ 14, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   14,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   13,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 14\nAssertionError: expected [ 14, …(1) ] to deeply equal [ 15, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   15,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   14,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[14/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 15\nAssertionError: expected [ 15, …(1) ] to deeply equal [ 16, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   16,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   15,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[15/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 16\nAssertionError: expected [ 16, …(1) ] to deeply equal [ 17, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   17,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   16,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[16/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 17\nAssertionError: expected [ 17, …(1) ] to deeply equal [ 18, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   18,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   17,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[17/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 18\nAssertionError: expected [ 18, …(1) ] to deeply equal [ 19, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   19,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   18,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[18/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 19\nAssertionError: expected [ 19, …(1) ] to deeply equal [ 20, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   20,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   19,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[19/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 20\nAssertionError: expected [ 20, …(1) ] to deeply equal [ 21, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   21,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   20,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[20/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 21\nAssertionError: expected [ 21, …(1) ] to deeply equal [ 22, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   22,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   21,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[21/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 22\nAssertionError: expected [ 22, …(1) ] to deeply equal [ 23, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   23,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   22,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[22/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 23\nAssertionError: expected [ 23, …(1) ] to deeply equal [ 24, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   24,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   23,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[23/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 24\nAssertionError: expected [ 24, …(1) ] to deeply equal [ 25, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   25,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   24,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[24/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 25\nAssertionError: expected [ 25, …(1) ] to deeply equal [ 26, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   26,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   25,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[25/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 26\nAssertionError: expected [ 26, …(1) ] to deeply equal [ 27, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   27,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   26,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[26/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 27\nAssertionError: expected [ 27, …(1) ] to deeply equal [ 28, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   28,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   27,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[27/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 28\nAssertionError: expected [ 28, …(1) ] to deeply equal [ 29, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   29,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   28,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[28/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 29\nAssertionError: expected [ 29, …(1) ] to deeply equal [ 30, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   30,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   29,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[29/30]⎯\n\n FAIL  nhieu-do.test.ts > nhom nhieu > ca nhieu 30\nAssertionError: expected [ 30, …(1) ] to deeply equal [ 31, …(1) ]\n\n- Expected\n+ Received\n\n  Array [\n-   31,\n-   \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\n+   30,\n+   \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ]\n\n ❯ nhieu-do.test.ts:2:89\n      1| describe(\"nhom nhieu\", () => {\n      2|   for (let i = 1; i <= 30; i++) it(`ca nhieu ${i}`, () => { expect([i,…\n       |                                                                                         ^\n      3| });\n      4| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[30/30]⎯\n\n",
  },
};

const NGAN_SACH = 6000;
const CAU_CHAN = "Đỏ ⇒ sửa tệp rồi gọi lại đúng lệnh này; xanh ⇒ báo kết quả cuối. Bộ chạy cũng tự chạy lại lệnh kiểm khi bạn kết thúc.";

let kho: string;
beforeAll(() => {
  kho = fs.mkdtempSync(path.join(os.tmpdir(), "v0ca-"));
  fs.writeFileSync(
    path.join(kho, "phat-lai-vitest.cjs"),
    [
      'const fs = require("node:fs");',
      'const f = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
      'const i = f.out.lastIndexOf("\\n Test Files");',
      "process.stdout.write(f.out.slice(0, i));",
      "setTimeout(() => { process.stderr.write(f.err); setTimeout(() => { process.stdout.write(f.out.slice(i)); process.exitCode = f.exit; }, 60); }, 60);",
    ].join("\n"),
  );
});
afterAll(() => fs.rmSync(kho, { recursive: true, force: true }));

let soTep = 0;
/** Chạy tiến trình con phát lại đầu ra qua bộ chạy lệnh kiểm THẬT (tên script chứa "vitest" ⇒ được coi là lệnh vitest). */
async function phatLai(f: { out: string; err: string; exit?: number }, opt: { testDbUrl?: string } = {}): Promise<KetQuaKiem> {
  const tep = path.join(kho, `fx-${++soTep}.json`);
  fs.writeFileSync(tep, JSON.stringify({ out: f.out, err: f.err, exit: f.exit ?? 1 }));
  return taoChayLenhKiem(opt)(`node phat-lai-vitest.cjs "${tep}"`, kho, 60);
}
const loiNhan = async (f: { out: string; err: string; exit?: number }) => tomTatKiemChoModel(await phatLai(f), 1);
const coTen = (s: string, ten: string) => new RegExp(`${ten.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`).test(s);
const TEN_SAU = ["ca 1 mang lech", "ca 2 so gan dung", "ca 3 do dai", "ca 4 doi tuong", "ca 5 chuoi dai", "ca 6 nem loi"];
const VACH = /^⎯+\[\d+\/\d+\]⎯\s*$/m;
/** Tách phần "Failed Tests" thật thành (tiêu đề, các khối) để dựng biến thể. */
function tachFixture(err: string) {
  const m = /^.*Failed Tests \d+.*\n/m.exec(err)!;
  const khoi = err.slice(m.index + m[0].length).split(VACH).map((k) => k.trim()).filter((k) => k !== "");
  return { dau: m[0], khoi };
}
const ghepErr = (dau: string, khoi: string[]) => `${dau}\n${khoi.map((k, i) => ` ${k}\n\n⎯⎯⎯⎯⎯⎯⎯⎯[${i + 1}/${khoi.length}]⎯\n`).join("\n")}\n`;
const tongKet = (hong: number) => `\n RUN  v2.1.9 <tam>\n\n Test Files  1 failed (1)\n      Tests  ${hong} failed (${hong})\n   Start at  22:34:00\n`;

describe("V0 — đủ tên và thông báo đầu của mọi ca đỏ", () => {
  it("V0-T1 sáu ca đỏ, đầu ra dài ⇒ đủ sáu tên và sáu thông báo đầu", async () => {
    const s = await loiNhan(FX["sau-do"]!);
    expect(TEN_SAU.filter((t) => !s.includes(t))).toEqual([]);
    for (const m of [
      "expected [ 'SPI', 'FCT' ] to deeply equal",
      "expected +0 to be close to 1",
      "to have a length of 1 but got 2",
      "expected { a: 1, …(2) } to deeply equal",
      "to be 'dong mot\\ndong HAI\\ndong ba'",
      "TypeError: khong doc duoc thuoc tinh",
    ]) expect(s).toContain(m);
  }, 90_000);

  it("V0-T2 ba mươi ca đỏ, vượt ngân sách ⇒ đủ tên, đủ thông báo đầu, có câu báo cắt, không vượt ngân sách", async () => {
    const s = await loiNhan(FX["nhieu-do"]!);
    const thieuTen: number[] = [];
    const thieuBao: number[] = [];
    for (let i = 1; i <= 30; i++) {
      if (!coTen(s, `ca nhieu ${i}`)) thieuTen.push(i);
      if (!s.includes(`AssertionError: expected [ ${i}, …(1) ]`)) thieuBao.push(i);
    }
    expect(thieuTen).toEqual([]);
    expect(thieuBao).toEqual([]);
    expect(s).toContain("đã cắt bớt chi tiết");
    expect(s).toContain("tên ca giữ đủ");
    const chuTen = Array.from({ length: 30 }, (_, i) => `nhieu-do.test.ts > nhom nhieu > ca nhieu ${i + 1}`.length + 12).reduce((a, b) => a + b, 0);
    expect(s.length).toBeLessThanOrEqual(NGAN_SACH + chuTen + 1200);
    // không bỏ đói: khối đầu và khối cuối đều còn phần chi tiết ngoài thông báo (dòng vị trí)
    expect(s.split("❯ nhieu-do.test.ts:2:89").length - 1).toBe(30);
  }, 90_000);

  it("V0-T3 hai ca cùng lỗi gộp một khối ⇒ đủ hai tên, không báo đọc thiếu", async () => {
    const s = await loiNhan(FX["gop"]!);
    expect(s).toContain("nhom gop > ca gop mot");
    expect(s).toContain("nhom gop > ca gop hai");
    expect(s).not.toContain("chỉ đọc được tên");
  }, 90_000);

  it("V0-T4 tệp hỏng khi nạp (0 ca) ⇒ tên tệp và thông báo, không báo đọc thiếu", async () => {
    const s = await loiNhan(FX["nap-hong"]!);
    expect(s).toContain("nap-hong.test.ts");
    expect(s).toContain("Failed to load url ./khong-co-tep-nay");
    expect(s).not.toContain("chỉ đọc được tên");
  }, 90_000);

  it("V0-T5 tách được ít tên hơn số ca hỏng ⇒ nói đọc được mấy trên mấy và kèm đuôi đầu ra", async () => {
    const { dau, khoi } = tachFixture(FX["sau-do"]!.err);
    const s = await loiNhan({ out: FX["sau-do"]!.out, err: ghepErr(dau, [khoi[0]!]) });
    expect(s).toContain("chỉ đọc được tên 1/6 ca đỏ");
    expect(s).toContain("--- đuôi đầu ra ---");
    expect(s).toContain("ca 1 mang lech");
  }, 90_000);

  it("V0-T11 (V0-TRAN-TEN) 200 ca đỏ, một tên 500 ký tự ⇒ đúng 100 tên, mỗi tên ≤ 300 ký tự, nói còn 100 ca; phần chi tiết trong ngân sách", async () => {
    const { dau, khoi } = tachFixture(FX["nhieu-do"]!.err);
    const mau = khoi[0]!;
    const ds = Array.from({ length: 200 }, (_, i) => mau.replace("ca nhieu 1", i === 0 ? `ca dai ${"d".repeat(500)}` : `ca tran ${i + 1}`));
    const s = await loiNhan({ out: tongKet(200), err: ghepErr(dau, ds) });
    const lietKe = Array.from({ length: 199 }, (_, i) => i + 2).filter((i) => coTen(s, `ca tran ${i}`));
    expect(lietKe).toEqual(Array.from({ length: 99 }, (_, i) => i + 2));
    expect(s).toContain("còn 100 ca đỏ không liệt kê");
    expect(s).toContain("ca dai ddd");
    expect(s).not.toContain("d".repeat(301));
    expect(s.length).toBeLessThanOrEqual(NGAN_SACH + 100 * 320 + 1200);
  }, 90_000);
});

describe("V0 — đối chứng: không đổi thứ không thuộc V0", () => {
  it("V0-T6 lượt xanh ⇒ đúng từng byte định dạng cũ", async () => {
    const k = await phatLai({ ...FX["xanh"]!, exit: 0 });
    expect(tomTatKiemChoModel(k, 1)).toBe(
      [
        "[pilot] KHÔNG PHẢI bị người từ chối: bộ chạy đã TỰ CHẠY lệnh kiểm này thay bạn (lần 1); đây là KẾT QUẢ THẬT. thoát mã 0.",
        "Test Files 1 passed (1)",
        "Tests 1 passed (1)",
        "--- đuôi đầu ra ---",
        k.duoi,
        CAU_CHAN,
      ].join("\n"),
    );
  }, 90_000);

  it("V0-T7 chế độ chỉ số (--cho-phep-db) ⇒ không tên ca, không thông báo", async () => {
    const k = await phatLai(FX["sau-do"]!, { testDbUrl: "postgres" + "://u:" + "khong-phai-mat-khau" + "@127.0.0.1:9/none_test" });
    const s = tomTatChiSoChoModel(k, 1, ["khong-phai-" + "mat-khau"]);
    for (const t of TEN_SAU) expect(s).not.toContain(t);
    expect(s).not.toContain("AssertionError");
    expect(s).toContain("Tests 6 failed | 1 passed (7)");
  }, 90_000);

  it("V0-T9 dòng FAIL giả do console.log (stdout) hoặc console.error (stderr, trước tiêu đề) ⇒ không được tính, không tới model như ca đỏ", async () => {
    const f = FX["sau-do"]!;
    const s = await loiNhan({ out: f.out, err: `stderr | sau-do.test.ts > x\n FAIL  gia-loi.test.ts > ca gia tu console.error\n\n${f.err}` });
    expect(s).not.toContain("ca gia in ra tu console");
    expect(s).not.toContain("ca gia tu console.error");
    expect(s).not.toContain("chỉ đọc được tên");
  }, 90_000);

  it("V0-T12a lỗi ngoài ca (Unhandled), mọi ca xanh ⇒ thông báo lỗi vẫn tới model, không báo đọc thiếu", async () => {
    const s = await loiNhan(FX["khong-xu-ly"]!);
    expect(s).toContain("loi khong ai bat");
    expect(s).not.toContain("chỉ đọc được tên");
  }, 90_000);
});

describe("V0 — che bí mật, lỗi ngoài ca, số đo, JSON kết quả", () => {
  it("V0-T8 token trong tên ca và thông báo của một khối ĐẦU ⇒ tên vẫn tới model, token đã che", async () => {
    const token = ["gh", "p_"].join("") + "A1b2".repeat(9);
    const { dau, khoi } = tachFixture(FX["nhieu-do"]!.err);
    const dauTien = khoi[0]!.replace("ca nhieu 1", `ca mang token ${token}`).replace("AssertionError: expected", `AssertionError: ${token} expected`);
    const s = await loiNhan({ out: tongKet(30), err: ghepErr(dau, [dauTien, ...khoi.slice(1)]) });
    expect(s).toContain("ca mang token [REDACTED_SECRET]");
    expect(s).toContain("AssertionError: [REDACTED_SECRET] expected");
    expect(s).not.toContain(token);
  }, 90_000);

  it("V0-T12b sáu ca đỏ KÈM lỗi Unhandled ⇒ đủ sáu tên và vẫn kèm đuôi đầu ra có lỗi ngoài ca", async () => {
    const f = FX["sau-do"]!;
    const s = await loiNhan({ out: f.out, err: `${f.err}\n${FX["khong-xu-ly"]!.err}` });
    expect(TEN_SAU.filter((t) => !s.includes(t))).toEqual([]);
    expect(s).toContain("--- đuôi đầu ra ---");
    expect(s).toContain("loi khong ai bat");
  }, 90_000);

  describe("trong driverHost", () => {
    const THE: TheViec = { ma: "TC-V0", mucTieu: "x", tepDuocPhep: ["a.test.ts"], nguCanhDoc: [], lenhKiem: "npx vitest run a.test.ts", gioiHan: { giay: 5, vong: 3 } };
    let wt: string;
    let ra: string;
    beforeEach(() => {
      wt = fs.mkdtempSync(path.join(os.tmpdir(), "v0-wt-"));
      ra = fs.mkdtempSync(path.join(os.tmpdir(), "v0-ra-"));
    });
    afterEach(() => {
      fs.rmSync(wt, { recursive: true, force: true });
      fs.rmSync(ra, { recursive: true, force: true });
    });

    it("V0-T13 (M19) mỗi lần tự chạy lệnh kiểm đỏ ghi một dòng số đo: gửi tên mấy trên mấy ca đỏ", async () => {
      const k = await phatLai(FX["sau-do"]!);
      type Su = { loai: string; [x: string]: unknown };
      let f: ((m: { seq: number; suKien: Su }) => void) | null = null;
      const dep: PhuThuocHost = {
        kiemMoiTruong: async () => null,
        taoLuot: async () => {
          setTimeout(
            () =>
              void (async () => {
                f?.({ seq: 0, suKien: { loai: "can-duyet", id: "tc-1", deXuat: { ten: "run_command", thamSo: { command: THE.lenhKiem }, moTa: "m", pendingActionId: "rc1", xemTruoc: "diff" } } });
                await new Promise((r) => setTimeout(r, 80));
                f?.({ seq: 1, suKien: { loai: "xong", lyDo: "hoan-thanh" } });
              })(),
            30,
          );
          return { ok: true, runId: "r1" };
        },
        nghe: (_r, fn) => {
          f = fn as never;
          return () => {
            f = null;
          };
        },
        huy: () => undefined,
        duyet: async () => ({ ok: true, daGhi: true, status: "executed" }),
        bac: async () => undefined,
        duAnId: () => "_tho_ca_wt_ao",
        chinhSachDuyet: (async () => ({ quyet: "tu-choi" })) as ChinhSachDuyet,
        bay: () => Date.now(),
        datKhoaKy: () => ({ ok: true, tam: false }),
        chayKiem: async () => k,
      };
      const dv: DauVaoDriver = { the: THE, wt, lenh: "L", hanGiay: 5, ra, ghiLuotDir: null, khoGhi: {} };
      const kq = await driverHost(dep)(dv);
      expect(kq.ghiChu.join("\n")).toContain("gửi model tên 6/6 ca đỏ");
    }, 90_000);
  });

  it("V0-T14 chay.json không mang văn bản các khối ca đỏ (trường mới của KetQuaKiem bị gỡ như dauRaDayDu)", async () => {
    const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
    const goc = fs.mkdtempSync(path.join(os.tmpdir(), "v0cmv-"));
    try {
      const wt = path.join(goc, "_tho_ca_wt_v0");
      const TEP = "server/x/a.test.ts";
      fs.mkdirSync(path.join(wt, "server/x"), { recursive: true });
      git(wt, "init", "-q");
      git(wt, "config", "user.email", "t@t");
      git(wt, "config", "user.name", "t");
      git(wt, "config", "core.autocrlf", "false");
      fs.writeFileSync(path.join(wt, TEP), 'import { it, expect } from "vitest";\nit("cu", () => { expect(1).toBe(1); });\n');
      git(wt, "add", ".");
      git(wt, "commit", "-q", "-m", "init");
      const k = { ...(await phatLai(FX["sau-do"]!)), khoiDo: [{ ten: ["DAU_KHOI_V0"], thongBao: "x", viTri: "", conLai: "" }] };
      const van = `MÃ: TC-V0\nQUY TRÌNH: làm\nMỤC TIÊU: thử\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}\nLỆNH KIỂM: npx vitest run ${TEP}\nGIỚI HẠN: 1 phút, 3 vòng`;
      const r = await chayMotViec({ van, wt, base: "HEAD", driver: "kho", ra: path.join(goc, "ra"), choPhepKhoRieng: true, luat: "# l\n", chayKiem: async () => k, khoGhi: { [TEP]: 'import { it, expect } from "vitest";\nit("cu", () => { expect(1).toBe(1); });\nit("moi", () => { expect(2).toBe(2); });\n' } });
      expect(r.kiem).toMatchObject({ exit: 1 });
      expect(JSON.stringify(r)).not.toContain("DAU_KHOI_V0");
    } finally {
      fs.rmSync(goc, { recursive: true, force: true });
    }
  }, 90_000);
});
