/**
 * `bo-the-phu` — công cụ CLI cho NGƯỜI sau khi duyệt lượt có KIỂM PHỦ: bỏ tiền tố `[Dk] ` khỏi tên ca test (dấu của một thẻ, vô nghĩa sau khi gộp).
 * Dùng: `npx tsx scripts/tho-ca-pilot/boThePhu.ts [--chi-dem] <tệp test> …`. Chỉ sửa tệp được liệt kê; `--chi-dem` chỉ đếm, không ghi.
 * Mã thoát: 0 xong · 2 sai cách dùng · 3 không đọc/ghi được tệp. Ghi LF, giữ nguyên mọi thứ khác (xem `boTienToTag`).
 */
import fs from "node:fs";
import { boTienToTag } from "./kiemPhu";

export function main(argv: string[] = process.argv.slice(2), ra: (s: string) => void = (s) => process.stdout.write(s)): number {
  const chiDem = argv.includes("--chi-dem");
  const tep = argv.filter((a) => a !== "--chi-dem");
  if (tep.length === 0 || tep.some((t) => t.startsWith("--"))) {
    ra("Dùng: boThePhu.ts [--chi-dem] <tệp test> …\n");
    return 2;
  }
  let tong = 0;
  for (const t of tep) {
    let nguon: string;
    try {
      nguon = fs.readFileSync(t, "utf8");
    } catch (e) {
      ra(`✖ không đọc được ${t}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 3;
    }
    const kq = boTienToTag(nguon);
    tong += kq.soBo;
    if (!chiDem && kq.soBo > 0) {
      try {
        fs.writeFileSync(t, kq.nguon, "utf8");
      } catch (e) {
        ra(`✖ không ghi được ${t}: ${e instanceof Error ? e.message : String(e)}\n`);
        return 3;
      }
    }
    ra(`${t}: ${kq.soBo} tiền tố${chiDem ? " (chỉ đếm)" : kq.soBo > 0 ? " đã bỏ" : ""}\n`);
  }
  ra(`Tổng: ${tong}\n`);
  return 0;
}

if (process.argv[1] && /boThePhu\.(ts|js)$/.test(process.argv[1])) {
  process.exit(main());
}
