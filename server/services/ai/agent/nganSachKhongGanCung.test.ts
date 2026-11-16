/**
 * (HST 15/11, điều kiện 2 của cờ ép) trên đường agent (server/services/ai/agent + shared/agentCore, mã không phải test) KHÔNG có chỗ nào đọc
 * ngân sách 65 536 GẮN CỨNG ngoài mặc định lõi `GIOI_HAN_MAC_DINH` (shared/agentCore/kieu.ts). Mọi nơi dùng ngân sách phải đọc
 * `gh.nganSachNguCanhToken` (ngưỡng + đích nén, ctx%, "ngữ cảnh đầy", con kế thừa) ⇒ cờ ép áp ở MỘT chỗ là đủ.
 * Thuần: chỉ đọc tệp nguồn trong repo. Thêm một literal 65 536 mới (ngoài chú thích) ⇒ ĐỎ, nêu tệp:dòng.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const THU_MUC = ["server/services/ai/agent", "shared/agentCore"];
const RE_SO = /\b65_?536\b/;
const laChuThich = (dong: string) => /^\s*(\/\/|\*|\/\*)/.test(dong);

function choDoc(): string[] {
  const ra: string[] = [];
  for (const tm of THU_MUC) {
    for (const ten of fs.readdirSync(path.join(GOC, tm), { recursive: true }) as string[]) {
      const rel = `${tm}/${ten.split(path.sep).join("/")}`;
      if (!/\.ts$/.test(rel) || /\.test\.ts$/.test(rel) || /\.d\.ts$/.test(rel)) continue;
      fs.readFileSync(path.join(GOC, rel), "utf8")
        .split("\n")
        .forEach((d, i) => {
          if (RE_SO.test(d) && !laChuThich(d)) ra.push(`${rel}:${i + 1}: ${d.trim()}`);
        });
    }
  }
  return ra;
}

describe("đường agent không gắn cứng ngân sách 65 536", () => {
  it("chỉ còn đúng mặc định lõi GIOI_HAN_MAC_DINH.nganSachNguCanhToken", () => {
    const ds = choDoc();
    expect(ds.map((x) => x.replace(/:\d+:/, ":<dong>:"))).toEqual(["shared/agentCore/kieu.ts:<dong>: nganSachNguCanhToken: 65_536,"]);
  });
});
