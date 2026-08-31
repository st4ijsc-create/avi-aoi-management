/**
 * ★★★ 2026-08-29 — LƯỚI CHO **`dauRaSong.ts`** (hàm thuần của khối sống panel Terminal).
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest gom `client/src/**\/*.unit.test.ts` — lớp "glob rỗng").
 *
 * `gopVachVe` mô phỏng ngữ nghĩa TERMINAL cho `\r`: progress thật (vite `transforming (n)`,
 * dotnet, vitest) in `\r` + vẽ đè hàng trăm lần một dòng. Lưới hỏi KẾT CỤC (chuỗi ra) chứ không
 * hỏi cơ chế: mỗi ca là một cặp vào→ra `toBe` — đột biến nào đổi ngữ nghĩa là đỏ ngay dòng ấy.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • quên chuẩn hoá `\r\n` trước khi gập ⇒ mọi dòng CRLF gập oan thành rỗng   ⇒ §1.3 ĐỎ
 *   • `\r` treo cuối chunk trả chuỗi rỗng (mất khung hiện có)                  ⇒ §1.4 ĐỎ
 *   • quên lột ANSI ⇒ `[36m` rác đi vào <pre>                                  ⇒ §2 ĐỎ
 */
import { describe, expect, it } from "vitest";
import { gopVachVe, lotAnsi, nhanGiayTroi } from "./dauRaSong";

describe("§1 gopVachVe — ngữ nghĩa viết-đè của \\r", () => {
  it("★★★ progress vẽ đè nhiều lượt ⇒ chỉ còn KHUNG CUỐI", () => {
    expect(gopVachVe("transforming (1)\rtransforming (57)\rtransforming (110)")).toBe(
      "transforming (110)",
    );
  });

  it("★ dòng thường không \\r ⇒ nguyên vẹn, đa dòng giữ nguyên \\n", () => {
    expect(gopVachVe("dong mot\ndong hai")).toBe("dong mot\ndong hai");
  });

  it("★★★ \\r\\n (CRLF Windows) là XUỐNG DÒNG, không phải viết-đè — không được gập oan", () => {
    expect(gopVachVe("dong mot\r\ndong hai\r\n")).toBe("dong mot\ndong hai\n");
  });

  it("★★★ \\r TREO cuối chunk (lượt vẽ kế chưa tới) ⇒ giữ khung TRƯỚC, không trả rỗng", () => {
    expect(gopVachVe("dang tai 45%\r")).toBe("dang tai 45%");
    // …kể cả khi đã có vài lượt vẽ trước đó:
    expect(gopVachVe("10%\r45%\r")).toBe("45%");
  });

  it("★ trộn: dòng progress gập, dòng thường giữ", () => {
    expect(gopVachVe("build...\rbuild xong\ntest 3/3 PASS")).toBe("build xong\ntest 3/3 PASS");
  });

  it("★ chuỗi rỗng ⇒ rỗng", () => {
    expect(gopVachVe("")).toBe("");
  });
});

describe("§2 lotAnsi — mã màu/xoá-dòng không được vào <pre>", () => {
  it("★★★ CSI màu + reset bị lột, chữ giữ nguyên", () => {
    expect(lotAnsi("\x1b[36mvite\x1b[0m v7.3.1 \x1b[2mbuilding\x1b[22m")).toBe(
      "vite v7.3.1 building",
    );
  });

  it("★ xoá-đến-cuối-dòng `\\x1b[K` đi kèm progress \\r — gập xong sạch rác", () => {
    expect(gopVachVe("10%\x1b[K\r45%\x1b[K")).toBe("45%");
  });
});

describe("§3 nhanGiayTroi — nhãn giây của khối sống", () => {
  it("★ dưới một phút: `Ns`", () => {
    expect(nhanGiayTroi(0)).toBe("0s");
    expect(nhanGiayTroi(7500)).toBe("7s");
    expect(nhanGiayTroi(59_999)).toBe("59s");
  });

  it("★ từ một phút: `Mm Ss`", () => {
    expect(nhanGiayTroi(60_000)).toBe("1m 0s");
    expect(nhanGiayTroi(83_000)).toBe("1m 23s");
  });

  it("★ âm (đồng hồ lệch) ⇒ kẹp về 0s, không hiện số âm", () => {
    expect(nhanGiayTroi(-500)).toBe("0s");
  });
});
