/**
 * Bộ nạp Mocha — chạy BÊN TRONG extension host VSCode thật (`extensionTestsPath` trỏ tới tệp đã
 * biên dịch của module này). VSCode gọi `run()`, ném lỗi ⇒ toàn lượt ĐỎ.
 */
import { resolve } from "node:path";
import { glob } from "glob";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mocha = require("mocha");

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 60_000 });
  const testsRoot = resolve(__dirname);

  const files = await glob("**/*.test.js", { cwd: testsRoot });
  if (files.length === 0) throw new Error(`Không tìm thấy tệp *.test.js nào dưới ${testsRoot} — build có chạy chưa?`);
  for (const f of files) mocha.addFile(resolve(testsRoot, f));

  return new Promise((resolvePromise, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) reject(new Error(`${failures} ca ĐỎ trong extension host thật.`));
        else resolvePromise();
      });
    } catch (err) {
      reject(err as Error);
    }
  });
}
