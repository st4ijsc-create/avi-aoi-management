# Extension VSCode cho AI Local — ĐỢT A (xương sống CHỈ ĐỌC)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng xương sống extension VSCode nối AI Local: đăng nhập lấy cookie phiên, mở bảng
trò chuyện, hỏi một lượt và thấy chữ chảy về theo thời gian thực, có ngữ cảnh mã (tệp đang mở /
đoạn chọn) và ô chọn dự án LOCAL/SERVER — **không có bất kỳ đường ghi tệp nào**.

**Architecture:** Extension độc lập trong `vscode-extension/` (package riêng, bundle esbuild).
Mọi logic quyết định nằm ở module **THUẦN** dưới `src/loi/` (không import `vscode`) để lưới
vitest của repo mẹ đo thẳng; lớp `src/mang/` chỉ làm I/O mạng; lớp `src/ui/` chỉ dựng webview.
Kênh model là `POST /api/ai/local-kb/stream` (SSE) với cookie `app_session_id`.

**Tech Stack:** TypeScript · esbuild (bundle) · VSCode Extension API 1.90+ · vitest (lưới repo
mẹ) · fetch/ReadableStream của Node 20 · tRPC qua HTTP + superjson.

**Spec:** `docs/superpowers/specs/2026-08-28-vscode-extension-ai-local-design.md`

## Global Constraints

- **KHÔNG đường ghi tệp trong Đợt A.** Không `fs.write*`, không `applyEdit`, không
  `confirmAction`. Đợt A chỉ đọc.
- **KHÔNG ghi vào `sandbox-projects/`** — đó là đề thi (exam material) của hệ thống.
- **KHÔNG sửa `.env`.**
- **Commit SURGICAL**: chỉ `git add` đúng tệp của việc này. Tuyệt đối không quét
  `knowledge/*.json`, `docs/superpowers/*` của người khác, hay WIP song song.
- Module dưới `src/loi/` **không được import `vscode`** (nếu import, lưới vitest repo mẹ sẽ nổ vì
  không phân giải được module `vscode`). Đây vừa là ràng buộc kỹ thuật vừa là kỷ luật thiết kế.
- Tên hàm/biến **tiếng Việt không dấu** theo đúng lối repo (`tachKhungSse`, `dungNguCanh`…).
- Chuỗi hiển thị cho người dùng: **tiếng Việt**.
- Mọi lệnh `npm` phải có **`--prefix vscode-extension`** và phải kiểm chứng nó chạy đúng thư mục
  con (bài học cũ: npm đi ngược lên cây thư mục).
- Server URL mặc định `http://localhost:3000`; cookie tên `app_session_id`.
- tRPC: mount `/api/trpc`, transformer **superjson** (input bọc `{"json":…}`, output ở
  `result.data.json`).

---

### Task 1: Scaffold extension + đường build + nối lưới

**Files:**
- Create: `vscode-extension/package.json`
- Create: `vscode-extension/tsconfig.json`
- Create: `vscode-extension/build.mjs`
- Create: `vscode-extension/.vscodeignore`
- Create: `vscode-extension/src/extension.ts`
- Create: `vscode-extension/src/loi/manifest.unit.test.ts`
- Modify: `vitest.config.ts:31-37` (thêm glob cho lưới extension)
- Modify: `package.json` (thêm 3 script `ext:*`)

**Interfaces:**
- Consumes: (không có — task đầu)
- Produces: lệnh `aviAiLocal.moBangChat` / `aviAiLocal.dangNhap` / `aviAiLocal.dangXuat`; cấu
  hình `aviAiLocal.serverUrl` (string) · `aviAiLocal.nganSachNguCanh` (number) ·
  `aviAiLocal.uiLanguage` (string). Thư mục `vscode-extension/src/loi/` là nơi đặt module thuần.

- [ ] **Step 1: Viết lưới manifest (sẽ ĐỎ vì chưa có package.json)**

Tạo `vscode-extension/src/loi/manifest.unit.test.ts`:

```ts
/**
 * LƯỚI manifest extension: giữ các bất biến mà một lỗi gõ nhầm sẽ làm extension im lặng không
 * chạy (main sai đường ⇒ VSCode nạp rỗng; id lệnh lệch tiền tố ⇒ không tìm thấy trong Command
 * Palette). Đo THẲNG trên tệp thật, không mô phỏng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const goc = join(__dirname, "..", "..");
const manifest = JSON.parse(readFileSync(join(goc, "package.json"), "utf8"));

describe("manifest extension", () => {
  it("★★★ trỏ đúng bundle đã build", () => {
    expect(manifest.main).toBe("./dist/extension.js");
  });

  it("★★★ khai trần phiên bản VSCode", () => {
    expect(manifest.engines?.vscode).toBeTruthy();
  });

  it("★★ MỌI lệnh dùng tiền tố aviAiLocal.", () => {
    const ds: Array<{ command: string }> = manifest.contributes.commands;
    expect(ds.length).toBeGreaterThan(0);
    for (const l of ds) expect(l.command.startsWith("aviAiLocal.")).toBe(true);
  });

  it("★★ MỌI khoá cấu hình dùng tiền tố aviAiLocal.", () => {
    const khoa = Object.keys(manifest.contributes.configuration.properties);
    expect(khoa.length).toBeGreaterThan(0);
    for (const k of khoa) expect(k.startsWith("aviAiLocal.")).toBe(true);
  });

  it("★★★ Đợt A KHÔNG khai lệnh nào mang nghĩa GHI/ÁP/DUYỆT", () => {
    // Dùng mẫu CHÍNH XÁC, không dùng `contains("ghi")` — "nghiệm thu" cũng chứa "ghi" nên phép
    // đo thô sẽ đỏ oan và người sau sẽ nới lỏng lưới cho hết đỏ (tệ hơn là không có lưới).
    const ten = JSON.stringify(manifest.contributes.commands).toLowerCase();
    for (const mau of [/ghi\s*tệp/, /áp\s*dụng/, /apply/, /confirm/, /duyệt/]) {
      expect(ten).not.toMatch(mau);
    }
  });
});
```

- [ ] **Step 2: Thêm glob lưới extension vào vitest**

Sửa `vitest.config.ts`, mảng `include` (dòng 31-37) — thêm MỘT dòng cuối mảng:

```ts
      "scripts/**/*.test.ts",
      "vscode-extension/src/**/*.unit.test.ts",
```

- [ ] **Step 3: Chạy lưới, xác nhận ĐỎ**

Run: `npx vitest run vscode-extension/src/loi/manifest.unit.test.ts`
Expected: FAIL — không đọc được `package.json` (ENOENT).

- [ ] **Step 4: Tạo `vscode-extension/package.json`**

```json
{
  "name": "avi-ai-local",
  "displayName": "AI Local (ST4I)",
  "description": "Trợ lý lập trình AI chạy nội bộ — offline, mọi lượt ghi phải có người duyệt.",
  "version": "0.1.0",
  "publisher": "st4i",
  "private": true,
  "license": "UNLICENSED",
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Programming Languages", "Other"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "aviAiLocal.moBangChat", "title": "AI Local: Mở bảng trò chuyện" },
      { "command": "aviAiLocal.dangNhap", "title": "AI Local: Đăng nhập" },
      { "command": "aviAiLocal.dangXuat", "title": "AI Local: Đăng xuất" }
    ],
    "configuration": {
      "title": "AI Local",
      "properties": {
        "aviAiLocal.serverUrl": {
          "type": "string",
          "default": "http://localhost:3000",
          "description": "Địa chỉ máy chủ AI Local (box chạy model)."
        },
        "aviAiLocal.nganSachNguCanh": {
          "type": "number",
          "default": 24000,
          "description": "Trần số ký tự mã nguồn gửi kèm mỗi lượt hỏi."
        },
        "aviAiLocal.uiLanguage": {
          "type": "string",
          "enum": ["vi", "en", "zh"],
          "default": "vi",
          "description": "Ngôn ngữ trả lời."
        }
      }
    }
  },
  "scripts": {
    "check": "tsc --noEmit -p .",
    "build": "node build.mjs",
    "package": "vsce package --no-dependencies --allow-missing-repository"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/vscode": "^1.90.0",
    "@vscode/vsce": "^3.2.0",
    "esbuild": "^0.25.12",
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 5: Tạo `vscode-extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "outDir": "dist",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "types": ["node", "vscode"]
  },
  "include": ["src/**/*"]
}
```

Ghi chú: `lib` có `DOM` để dùng `ReadableStream`/`TextDecoder`/`fetch` của Node 20.

- [ ] **Step 6: Tạo `vscode-extension/build.mjs`**

```js
// Bundle extension bằng esbuild. `vscode` là module do VSCode cấp lúc chạy ⇒ PHẢI external.
import { build } from "esbuild";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
});
```

- [ ] **Step 7: Tạo `vscode-extension/.vscodeignore`**

```
src/**
build.mjs
tsconfig.json
node_modules/**
**/*.unit.test.ts
**/*.map
```

- [ ] **Step 8: Tạo `vscode-extension/src/extension.ts` (bản tối thiểu)**

```ts
/**
 * Điểm vào extension "AI Local". ĐỢT A: chỉ đọc — không có bất kỳ đường ghi tệp nào.
 */
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("aviAiLocal.moBangChat", () => {
      void vscode.window.showInformationMessage("AI Local: bảng trò chuyện sẽ mở ở Task 7.");
    }),
    vscode.commands.registerCommand("aviAiLocal.dangNhap", () => {
      void vscode.window.showInformationMessage("AI Local: đăng nhập sẽ có ở Task 3.");
    }),
    vscode.commands.registerCommand("aviAiLocal.dangXuat", () => {
      void vscode.window.showInformationMessage("AI Local: đăng xuất sẽ có ở Task 3.");
    }),
  );
}

export function deactivate(): void {
  // không giữ tài nguyên nền nào ở Đợt A
}
```

- [ ] **Step 9: Cài dependency (máy này CÓ internet; nhà máy thì không)**

Run: `npm install --prefix vscode-extension`
Rồi **kiểm chứng nó cài đúng thư mục con** (bài học npm đi ngược cây):
Run: `ls vscode-extension/node_modules/.bin/ | head` — phải thấy `tsc`, `esbuild`, `vsce`.

- [ ] **Step 10: Thêm script vào `package.json` gốc**

Trong khối `"scripts"`, thêm 3 dòng:

```json
    "ext:check": "npm run check --prefix vscode-extension",
    "ext:build": "npm run build --prefix vscode-extension",
    "ext:package": "npm run package --prefix vscode-extension",
```

- [ ] **Step 11: Chạy lưới + check + build, xác nhận XANH**

Run: `npx vitest run vscode-extension/src/loi/manifest.unit.test.ts`
Expected: PASS (5 ca).
Run: `npm run ext:check` → Expected: 0 lỗi.
Run: `npm run ext:build` → Expected: sinh `vscode-extension/dist/extension.js`.

- [ ] **Step 12: Nghiệm thu LIVE (Extension Development Host)**

Mở `vscode-extension/` trong VSCode, bấm **F5**. Trong cửa sổ mới: `Ctrl+Shift+P` →
gõ "AI Local" → phải thấy **3 lệnh**; chạy "Mở bảng trò chuyện" → hiện thông báo.
Ghi lại kết quả thật (thấy mấy lệnh, có thông báo không).

- [ ] **Step 13: Commit**

```bash
git add vscode-extension/package.json vscode-extension/package-lock.json \
  vscode-extension/tsconfig.json vscode-extension/build.mjs vscode-extension/.vscodeignore \
  vscode-extension/src/extension.ts vscode-extension/src/loi/manifest.unit.test.ts \
  vitest.config.ts package.json
git commit -m "feat(vscode-ext): scaffold extension AI Local + đường build + nối lưới (Đợt A/1)"
```

---

### Task 2: Bộ tách khung SSE (THUẦN)

**Files:**
- Create: `vscode-extension/src/loi/khungSse.ts`
- Test: `vscode-extension/src/loi/khungSse.unit.test.ts`

**Interfaces:**
- Consumes: (không)
- Produces: `tachKhungSse(dem: string, chunk: string): KetQuaTach` với
  `interface KetQuaTach { suKien: Array<Record<string, unknown>>; du: string; hong: string[] }`.
  Task 6 dùng hàm này.

- [ ] **Step 1: Viết lưới (ĐỎ trước)**

Tạo `vscode-extension/src/loi/khungSse.unit.test.ts`:

```ts
/**
 * LƯỚI tách khung SSE. Ca SỐNG CÒN: một khung bị CẮT ĐÔI giữa hai chunk TCP — lỗi kinh điển của
 * SSE client viết tay (chunk không bao giờ trùng ranh giới khung). Đo bằng cách gọi hai lần và
 * mang `du` sang lần sau, đúng như vòng đọc thật.
 */
import { describe, it, expect } from "vitest";
import { tachKhungSse } from "./khungSse";

describe("tachKhungSse", () => {
  it("★★★ khung TRỌN VẸN ⇒ một sự kiện, dư rỗng", () => {
    const r = tachKhungSse("", 'data: {"type":"token","text":"a"}\n\n');
    expect(r.suKien).toEqual([{ type: "token", text: "a" }]);
    expect(r.du).toBe("");
    expect(r.hong).toEqual([]);
  });

  it("★★★ khung CẮT ĐÔI giữa hai chunk ⇒ chỉ ra sự kiện ở lần thứ hai", () => {
    const a = tachKhungSse("", 'data: {"type":"tok');
    expect(a.suKien).toEqual([]);
    const b = tachKhungSse(a.du, 'en","text":"xin"}\n\n');
    expect(b.suKien).toEqual([{ type: "token", text: "xin" }]);
    expect(b.du).toBe("");
  });

  it("★★★ HAI khung trong MỘT chunk ⇒ đúng thứ tự", () => {
    const r = tachKhungSse("", 'data: {"i":1}\n\ndata: {"i":2}\n\n');
    expect(r.suKien).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it("★★ CRLF (\\r\\n\\r\\n) cũng là ranh giới khung", () => {
    const r = tachKhungSse("", 'data: {"i":9}\r\n\r\n');
    expect(r.suKien).toEqual([{ i: 9 }]);
  });

  it("★★★ JSON hỏng ⇒ vào `hong`, KHÔNG ném, KHÔNG nuốt im lặng", () => {
    const r = tachKhungSse("", "data: {khong-phai-json}\n\n");
    expect(r.suKien).toEqual([]);
    expect(r.hong).toEqual(["{khong-phai-json}"]);
  });

  it("★★ dòng chú thích ': ping' bị bỏ qua", () => {
    const r = tachKhungSse("", ': ping\n\ndata: {"i":3}\n\n');
    expect(r.suKien).toEqual([{ i: 3 }]);
    expect(r.hong).toEqual([]);
  });

  it("★★ khung nhiều dòng `data:` ⇒ nối bằng \\n rồi mới parse", () => {
    const r = tachKhungSse("", 'data: {"a":\ndata: 1}\n\n');
    expect(r.suKien).toEqual([{ a: 1 }]);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ**

Run: `npx vitest run vscode-extension/src/loi/khungSse.unit.test.ts`
Expected: FAIL — "Failed to resolve import ./khungSse".

- [ ] **Step 3: Cài đặt tối thiểu**

Tạo `vscode-extension/src/loi/khungSse.ts`:

```ts
/**
 * Tách luồng SSE thành sự kiện JSON. THUẦN: nhận (đệm cũ, chunk mới) trả (sự kiện, đệm dư) — vòng
 * đọc chỉ việc mang `du` sang lần gọi kế. Vì chunk TCP không bao giờ trùng ranh giới khung, mọi
 * bộ đọc SSE tự viết đều phải có đệm; đây là chỗ dễ sai nhất nên tách ra đo riêng.
 *
 * Khung hỏng KHÔNG bị nuốt im lặng — trả về ở `hong` để lớp trên còn khai báo được.
 */
export interface KetQuaTach {
  suKien: Array<Record<string, unknown>>;
  du: string;
  hong: string[];
}

export function tachKhungSse(dem: string, chunk: string): KetQuaTach {
  const buf = dem + chunk;
  const phan = buf.split(/\r?\n\r?\n/);
  const du = phan.pop() ?? "";
  const suKien: Array<Record<string, unknown>> = [];
  const hong: string[] = [];

  for (const khung of phan) {
    const than = khung
      .split(/\r?\n/)
      .filter((d) => d.startsWith("data:"))
      .map((d) => d.slice(5).trimStart())
      .join("\n")
      .trim();
    if (than.length === 0) continue; // khung chú thích `: ping` hoặc khung rỗng
    try {
      const doiTuong = JSON.parse(than) as unknown;
      if (doiTuong && typeof doiTuong === "object") suKien.push(doiTuong as Record<string, unknown>);
      else hong.push(than);
    } catch {
      hong.push(than);
    }
  }
  return { suKien, du, hong };
}
```

- [ ] **Step 4: Chạy, xác nhận XANH**

Run: `npx vitest run vscode-extension/src/loi/khungSse.unit.test.ts`
Expected: PASS (7 ca).

- [ ] **Step 5: Giết lưới bằng đột biến (bắt buộc theo kỷ luật repo)**

Tạm đổi `const du = phan.pop() ?? "";` thành `const du = "";` → chạy lại → **ca "cắt đôi" phải
ĐỎ**. Hoàn nguyên. Ghi lại ca nào bắt được đột biến.

- [ ] **Step 6: Commit**

```bash
git add vscode-extension/src/loi/khungSse.ts vscode-extension/src/loi/khungSse.unit.test.ts
git commit -m "feat(vscode-ext): bộ tách khung SSE có đệm (Đợt A/2)"
```

---

### Task 3: Đăng nhập — vị từ THUẦN + lệnh thật + kho bí mật

**Files:**
- Create: `vscode-extension/src/loi/dangNhap.ts`
- Test: `vscode-extension/src/loi/dangNhap.unit.test.ts`
- Create: `vscode-extension/src/mang/dangNhap.ts`
- Modify: `vscode-extension/src/extension.ts`

**Interfaces:**
- Consumes: (không)
- Produces:
  - `type KetQuaDangNhap = { loai: "ok"; ten: string } | { loai: "can2fa" } | { loai: "loi"; thongDiep: string }`
  - `phanTichKetQuaDangNhap(du: unknown): KetQuaDangNhap`
  - `docCookiePhien(dong: string[]): string | null` — trả **giá trị** cookie `app_session_id`
  - `dangNhap(serverUrl: string, ten: string, matKhau: string): Promise<{ ket: KetQuaDangNhap; cookie: string | null }>`
  - Khoá SecretStorage: `"aviAiLocal.cookie"`. Task 6/7/8 đọc khoá này.

- [ ] **Step 1: Viết lưới (ĐỎ trước)**

Tạo `vscode-extension/src/loi/dangNhap.unit.test.ts`:

```ts
/**
 * LƯỚI đăng nhập (phần THUẦN). Hai vị từ dễ sai âm thầm: (1) đọc cookie phiên giữa nhiều
 * Set-Cookie có thuộc tính (HttpOnly/Path/SameSite) — lấy nhầm thuộc tính làm giá trị thì mọi
 * lượt sau 401; (2) phân loại kết quả — `requires2FA` PHẢI là nhánh riêng, không được coi là
 * "thành công" cũng không phải "sai mật khẩu".
 */
import { describe, it, expect } from "vitest";
import { docCookiePhien, phanTichKetQuaDangNhap } from "./dangNhap";

describe("docCookiePhien", () => {
  it("★★★ lấy ĐÚNG giá trị giữa nhiều cookie có thuộc tính", () => {
    const dong = [
      "other=abc; Path=/; HttpOnly",
      "app_session_id=eyJHEADER.PAYLOAD.SIG; Path=/; HttpOnly; SameSite=Lax",
    ];
    expect(docCookiePhien(dong)).toBe("eyJHEADER.PAYLOAD.SIG");
  });

  it("★★★ không có cookie phiên ⇒ null (KHÔNG trả chuỗi rỗng giả vờ có)", () => {
    expect(docCookiePhien(["other=abc; Path=/"])).toBeNull();
    expect(docCookiePhien([])).toBeNull();
  });

  it("★★ tên cookie khác chứa chuỗi con KHÔNG bị nhận nhầm", () => {
    expect(docCookiePhien(["xx_app_session_id_bak=zzz; Path=/"])).toBeNull();
  });
});

describe("phanTichKetQuaDangNhap", () => {
  it("★★★ requires2FA là NHÁNH RIÊNG", () => {
    expect(phanTichKetQuaDangNhap({ requires2FA: true, userId: 7 })).toEqual({ loai: "can2fa" });
  });

  it("★★★ thành công ⇒ ok + tên", () => {
    expect(phanTichKetQuaDangNhap({ success: true, user: { name: "Anh Minh" } })).toEqual({
      loai: "ok",
      ten: "Anh Minh",
    });
  });

  it("★★ thất bại ⇒ loi có thông điệp", () => {
    const r = phanTichKetQuaDangNhap({ message: "Sai tài khoản" });
    expect(r.loai).toBe("loi");
    if (r.loai === "loi") expect(r.thongDiep).toBe("Sai tài khoản");
  });

  it("★★ đáp ứng lạ (null/chuỗi) ⇒ loi, KHÔNG ném", () => {
    expect(phanTichKetQuaDangNhap(null).loai).toBe("loi");
    expect(phanTichKetQuaDangNhap("<html>").loai).toBe("loi");
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ**

Run: `npx vitest run vscode-extension/src/loi/dangNhap.unit.test.ts`
Expected: FAIL — không phân giải được `./dangNhap`.

- [ ] **Step 3: Cài đặt phần THUẦN**

Tạo `vscode-extension/src/loi/dangNhap.ts`:

```ts
/**
 * Phần THUẦN của đăng nhập: đọc cookie phiên và phân loại đáp ứng.
 *
 * 2FA là nhánh RIÊNG vì extension chạy headless: không có bước nhập mã ⇒ phải từ chối rành mạch
 * chứ không được im lặng coi như sai mật khẩu (giống ràng buộc của CLI hiện có).
 */
export const TEN_COOKIE = "app_session_id";

/** Khoá cất cookie phiên trong SecretStorage. Khai MỘT chỗ — mọi tệp khác import từ đây. */
export const KHOA_COOKIE = "aviAiLocal.cookie";

export type KetQuaDangNhap =
  | { loai: "ok"; ten: string }
  | { loai: "can2fa" }
  | { loai: "loi"; thongDiep: string };

/** Giá trị cookie phiên trong danh sách header `Set-Cookie`, hoặc `null` nếu không có. */
export function docCookiePhien(dong: string[]): string | null {
  for (const d of dong) {
    const dau = d.split(";")[0]?.trim() ?? "";
    const moc = dau.indexOf("=");
    if (moc <= 0) continue;
    if (dau.slice(0, moc) === TEN_COOKIE) return dau.slice(moc + 1);
  }
  return null;
}

export function phanTichKetQuaDangNhap(du: unknown): KetQuaDangNhap {
  if (!du || typeof du !== "object") return { loai: "loi", thongDiep: "Đáp ứng không hợp lệ" };
  const o = du as Record<string, unknown>;
  if (o.requires2FA === true) return { loai: "can2fa" };
  if (o.success === true) {
    const nd = o.user as { name?: unknown } | undefined;
    return { loai: "ok", ten: typeof nd?.name === "string" ? nd.name : "" };
  }
  return {
    loai: "loi",
    thongDiep: typeof o.message === "string" ? o.message : "Đăng nhập thất bại",
  };
}
```

- [ ] **Step 4: Chạy, xác nhận XANH**

Run: `npx vitest run vscode-extension/src/loi/dangNhap.unit.test.ts`
Expected: PASS (7 ca).

- [ ] **Step 5: Lớp mạng**

Tạo `vscode-extension/src/mang/dangNhap.ts`:

```ts
/**
 * I/O đăng nhập. Mật khẩu KHÔNG BAO GIỜ được ghi log, không vào settings.json — nó chỉ đi thẳng
 * vào thân request rồi bị bỏ.
 */
import { docCookiePhien, phanTichKetQuaDangNhap, type KetQuaDangNhap } from "../loi/dangNhap";

export async function dangNhap(
  serverUrl: string,
  ten: string,
  matKhau: string,
): Promise<{ ket: KetQuaDangNhap; cookie: string | null }> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ten, password: matKhau }),
  });
  let than: unknown = null;
  try {
    than = await res.json();
  } catch {
    than = null;
  }
  return { ket: phanTichKetQuaDangNhap(than), cookie: docCookiePhien(res.headers.getSetCookie()) };
}
```

- [ ] **Step 6: Nối lệnh + SecretStorage vào `extension.ts`**

Thay hai lệnh giữ chỗ `aviAiLocal.dangNhap` / `aviAiLocal.dangXuat` bằng:

```ts
import { dangNhap } from "./mang/dangNhap";
import { KHOA_COOKIE } from "./loi/dangNhap";

async function chayDangNhap(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("aviAiLocal");
  const serverUrl = cfg.get<string>("serverUrl", "http://localhost:3000");
  const ten = await vscode.window.showInputBox({ prompt: `Tài khoản trên ${serverUrl}`, ignoreFocusOut: true });
  if (!ten) return;
  const matKhau = await vscode.window.showInputBox({ prompt: "Mật khẩu", password: true, ignoreFocusOut: true });
  if (!matKhau) return;

  try {
    const { ket, cookie } = await dangNhap(serverUrl, ten, matKhau);
    if (ket.loai === "can2fa") {
      void vscode.window.showErrorMessage(
        "Tài khoản này bật 2FA — extension chưa hỗ trợ. Hãy dùng tài khoản không bật 2FA.",
      );
      return;
    }
    if (ket.loai === "loi") {
      void vscode.window.showErrorMessage(`AI Local: ${ket.thongDiep}`);
      return;
    }
    if (!cookie) {
      void vscode.window.showErrorMessage("Đăng nhập được nhưng máy chủ không cấp cookie phiên.");
      return;
    }
    await context.secrets.store(KHOA_COOKIE, cookie);
    void vscode.window.showInformationMessage(`AI Local: đã đăng nhập (${ket.ten || ten}).`);
  } catch (e) {
    void vscode.window.showErrorMessage(`Không nối được máy chủ: ${(e as Error).message}`);
  }
}
```

và đăng ký:

```ts
    vscode.commands.registerCommand("aviAiLocal.dangNhap", () => void chayDangNhap(context)),
    vscode.commands.registerCommand("aviAiLocal.dangXuat", async () => {
      await context.secrets.delete(KHOA_COOKIE);
      void vscode.window.showInformationMessage("AI Local: đã đăng xuất.");
    }),
```

- [ ] **Step 7: check + build**

Run: `npm run ext:check` → 0 lỗi. Run: `npm run ext:build` → thành công.

- [ ] **Step 8: Nghiệm thu LIVE — đăng nhập THẬT**

Bảo đảm server đang chạy ở `http://localhost:3000`. F5 → chạy "AI Local: Đăng nhập" → nhập tài
khoản thật → phải thấy "đã đăng nhập". **Đo hậu quả, không tin thông báo**: chạy lại lệnh đăng
nhập với **mật khẩu sai** → phải hiện thông điệp lỗi của server, KHÔNG phải "đã đăng nhập".

- [ ] **Step 9: Commit**

```bash
git add vscode-extension/src/loi/dangNhap.ts vscode-extension/src/loi/dangNhap.unit.test.ts \
  vscode-extension/src/mang/dangNhap.ts vscode-extension/src/extension.ts
git commit -m "feat(vscode-ext): đăng nhập lấy cookie phiên + kho bí mật OS (Đợt A/3)"
```

---

### Task 4: Che bí mật + dựng ngữ cảnh (THUẦN)

**Files:**
- Create: `vscode-extension/src/loi/nguCanh.ts`
- Test: `vscode-extension/src/loi/nguCanh.unit.test.ts`

**Interfaces:**
- Consumes: (không)
- Produces:
  - `cheBiMat(s: string): string`
  - `duocPhepGuiNoiDung(duong: string): boolean`
  - `interface DauVaoNguCanh { doanChon?: { duong: string; dongDau: number; dongCuoi: number; noiDung: string }; tepDangMo?: { duong: string; noiDung: string }; dsTep?: string[]; nganSach: number }`
  - `dungNguCanh(dv: DauVaoNguCanh): string`
  Task 5 nhận chuỗi từ `dungNguCanh`.

- [ ] **Step 1: Viết lưới (ĐỎ trước)**

Tạo `vscode-extension/src/loi/nguCanh.unit.test.ts`:

```ts
/**
 * LƯỚI ngữ cảnh. Ba bất biến: (1) KHÔNG bao giờ gửi tệp bí mật (.env, khoá riêng); (2) chuỗi
 * giống khoá bị CHE trước khi rời máy dev; (3) ngân sách là TRẦN THẬT — vượt thì CẮT và NÓI rõ
 * đã cắt, chứ không im lặng gửi quá.
 */
import { describe, it, expect } from "vitest";
import { cheBiMat, duocPhepGuiNoiDung, dungNguCanh } from "./nguCanh";

describe("duocPhepGuiNoiDung", () => {
  it("★★★ CẤM mọi biến thể .env", () => {
    expect(duocPhepGuiNoiDung(".env")).toBe(false);
    expect(duocPhepGuiNoiDung("d:/du-an/.env.local")).toBe(false);
    expect(duocPhepGuiNoiDung("sub/.env.production")).toBe(false);
  });

  it("★★★ CẤM khoá riêng", () => {
    expect(duocPhepGuiNoiDung("keys/id_rsa")).toBe(false);
    expect(duocPhepGuiNoiDung("a/b/server.pem")).toBe(false);
  });

  it("★★ mã nguồn bình thường thì CHO", () => {
    expect(duocPhepGuiNoiDung("src/Calculator.cs")).toBe(true);
    expect(duocPhepGuiNoiDung("client/src/env.ts")).toBe(true);
  });
});

describe("cheBiMat", () => {
  it("★★★ che khoá OpenAI-style và AWS", () => {
    expect(cheBiMat("k = sk-abcdefghijklmnopqrstuvwx")).not.toContain("abcdefghijklmnop");
    expect(cheBiMat("id AKIAIOSFODNN7EXAMPLE")).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("★★★ che JWT ba đoạn", () => {
    const s = "tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyM30.abcdEFGH_ij";
    expect(cheBiMat(s)).not.toContain("eyJzdWIiOjEyM30");
  });

  it("★★★ che gán mật khẩu/khoá", () => {
    expect(cheBiMat('password="Sieu@Bimat123"')).not.toContain("Sieu@Bimat123");
    expect(cheBiMat("api_key = zzz9999zzz")).not.toContain("zzz9999zzz");
  });

  it("★★ mã thường KHÔNG bị đụng", () => {
    const ma = "public int Add(int a, int b) => a + b;";
    expect(cheBiMat(ma)).toBe(ma);
  });
});

describe("dungNguCanh", () => {
  it("★★★ đoạn chọn đứng TRƯỚC tệp đang mở (ưu tiên thứ tự)", () => {
    const s = dungNguCanh({
      doanChon: { duong: "a.cs", dongDau: 3, dongCuoi: 4, noiDung: "CHON_DAY" },
      tepDangMo: { duong: "a.cs", noiDung: "TOAN_TEP" },
      nganSach: 10_000,
    });
    expect(s.indexOf("CHON_DAY")).toBeLessThan(s.indexOf("TOAN_TEP"));
    expect(s).toContain("a.cs");
    expect(s).toContain("3");
  });

  it("★★★ vượt ngân sách ⇒ CẮT và KHAI đã cắt", () => {
    const s = dungNguCanh({
      tepDangMo: { duong: "to.cs", noiDung: "x".repeat(5000) },
      nganSach: 500,
    });
    expect(s.length).toBeLessThanOrEqual(700); // 500 + nhãn/khung
    expect(s).toContain("đã cắt");
  });

  it("★★★ nội dung gửi đi ĐÃ qua che bí mật", () => {
    const s = dungNguCanh({
      tepDangMo: { duong: "a.ts", noiDung: 'const k = "sk-abcdefghijklmnopqrstuvwx";' },
      nganSach: 10_000,
    });
    expect(s).not.toContain("abcdefghijklmnop");
  });

  it("★★ không có gì ⇒ chuỗi rỗng (không đẻ khung trống)", () => {
    expect(dungNguCanh({ nganSach: 1000 })).toBe("");
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ**

Run: `npx vitest run vscode-extension/src/loi/nguCanh.unit.test.ts`
Expected: FAIL — không phân giải được `./nguCanh`.

- [ ] **Step 3: Cài đặt**

Tạo `vscode-extension/src/loi/nguCanh.ts`:

```ts
/**
 * Dựng ngữ cảnh mã gửi kèm câu hỏi. THUẦN để đo thẳng ba bất biến: cấm tệp bí mật · che chuỗi
 * giống khoá · ngân sách là trần THẬT (cắt thì phải KHAI là đã cắt, vì một ngữ cảnh bị cắt âm
 * thầm làm model trả lời sai mà không ai biết vì sao).
 */
const CHE = "«đã che»";

const CAM_TEP = [/(^|[\\/])\.env(\.|$)/i, /(^|[\\/])id_rsa$/i, /\.pem$/i, /\.pfx$/i, /\.p12$/i];

export function duocPhepGuiNoiDung(duong: string): boolean {
  return !CAM_TEP.some((r) => r.test(duong));
}

export function cheBiMat(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, CHE)
    .replace(/AKIA[0-9A-Z]{16}/g, CHE)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, CHE)
    .replace(
      /((?:password|matkhau|mat_khau|secret|token|api[_-]?key)\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
      `$1${CHE}`,
    );
}

export interface DauVaoNguCanh {
  doanChon?: { duong: string; dongDau: number; dongCuoi: number; noiDung: string };
  tepDangMo?: { duong: string; noiDung: string };
  dsTep?: string[];
  nganSach: number;
}

function khoi(nhan: string, noiDung: string, tran: number): string {
  const sach = cheBiMat(noiDung);
  const cat = sach.length > tran;
  const than = cat ? `${sach.slice(0, tran)}\n… (đã cắt ${sach.length - tran} ký tự)` : sach;
  return `--- ${nhan} ---\n${than}\n`;
}

export function dungNguCanh(dv: DauVaoNguCanh): string {
  const phan: string[] = [];
  let conLai = dv.nganSach;

  if (dv.doanChon && duocPhepGuiNoiDung(dv.doanChon.duong) && conLai > 0) {
    const k = khoi(
      `ĐOẠN ĐANG CHỌN ${dv.doanChon.duong} (dòng ${dv.doanChon.dongDau}-${dv.doanChon.dongCuoi})`,
      dv.doanChon.noiDung,
      conLai,
    );
    phan.push(k);
    conLai -= k.length;
  }

  if (dv.tepDangMo && duocPhepGuiNoiDung(dv.tepDangMo.duong) && conLai > 0) {
    const k = khoi(`TỆP ĐANG MỞ ${dv.tepDangMo.duong}`, dv.tepDangMo.noiDung, conLai);
    phan.push(k);
    conLai -= k.length;
  }

  if (dv.dsTep && dv.dsTep.length > 0 && conLai > 0) {
    const k = khoi("DANH SÁCH TỆP", dv.dsTep.join("\n"), conLai);
    phan.push(k);
  }

  return phan.join("\n");
}
```

- [ ] **Step 4: Chạy, xác nhận XANH**

Run: `npx vitest run vscode-extension/src/loi/nguCanh.unit.test.ts`
Expected: PASS (11 ca).

- [ ] **Step 5: Giết lưới bằng đột biến**

Tạm bỏ `cheBiMat(...)` trong `khoi()` (dùng thẳng `noiDung`) → ca "nội dung gửi đi ĐÃ qua che bí
mật" phải ĐỎ. Hoàn nguyên.

- [ ] **Step 6: Commit**

```bash
git add vscode-extension/src/loi/nguCanh.ts vscode-extension/src/loi/nguCanh.unit.test.ts
git commit -m "feat(vscode-ext): dựng ngữ cảnh có ngân sách + che bí mật trước khi rời máy (Đợt A/4)"
```

---

### Task 5: Dựng thân yêu cầu `/stream` (THUẦN)

**Files:**
- Create: `vscode-extension/src/loi/yeuCau.ts`
- Test: `vscode-extension/src/loi/yeuCau.unit.test.ts`

**Interfaces:**
- Consumes: chuỗi ngữ cảnh từ `dungNguCanh` (Task 4)
- Produces:
  - `type CheDoDuAn = { loai: "local"; nhan: string } | { loai: "server"; projectId: string; nhan: string }`
  - `type LuotChat = { role: "user" | "assistant"; content: string }`
  - `dungYeuCauStream(dv: { cauHoi: string; nguCanh: string; lichSu: LuotChat[]; ngonNgu: string; vaiTro: string; cheDo: CheDoDuAn }): Record<string, unknown>`
  Task 6 gửi vật thể này làm thân POST.

- [ ] **Step 1: Viết lưới (ĐỎ trước)**

Tạo `vscode-extension/src/loi/yeuCau.unit.test.ts`:

```ts
/**
 * LƯỚI thân yêu cầu SSE. Bất biến sống còn: chế độ LOCAL PHẢI gửi codingMode:false và KHÔNG gửi
 * projectId — vì mã nằm trên máy dev, bật tool server chỉ khiến model đọc nhầm repo của server
 * rồi trả lời tự tin mà sai. Ngược lại chế độ SERVER phải có đủ cặp (codingMode:true + projectId),
 * thiếu projectId thì server im lặng rơi về dự án mặc định — sai mà không báo.
 */
import { describe, it, expect } from "vitest";
import { dungYeuCauStream } from "./yeuCau";

const CHUNG = { cauHoi: "Hàm Divide sai chỗ nào?", nguCanh: "--- TỆP ---\nCODE\n", lichSu: [], ngonNgu: "vi", vaiTro: "engineer" };

describe("dungYeuCauStream", () => {
  it("★★★ LOCAL: codingMode=false và KHÔNG có projectId", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "d:/du-an" } });
    const ctx = t.context as Record<string, unknown>;
    expect(ctx.codingMode).toBe(false);
    expect("projectId" in ctx).toBe(false);
  });

  it("★★★ SERVER: codingMode=true VÀ có projectId", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "server", projectId: "csharp", nhan: "Demo" } });
    const ctx = t.context as Record<string, unknown>;
    expect(ctx.codingMode).toBe(true);
    expect(ctx.projectId).toBe("csharp");
  });

  it("★★★ ngữ cảnh đứng TRƯỚC câu hỏi trong `question`", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" } });
    const q = String(t.question);
    expect(q.indexOf("--- TỆP ---")).toBeLessThan(q.indexOf("Hàm Divide sai chỗ nào?"));
  });

  it("★★ ngữ cảnh RỖNG ⇒ question chỉ là câu hỏi (không có khung trống)", () => {
    const t = dungYeuCauStream({ ...CHUNG, nguCanh: "", cheDo: { loai: "local", nhan: "x" } });
    expect(t.question).toBe("Hàm Divide sai chỗ nào?");
  });

  it("★★ route khai đúng nguồn gọi để server phân biệt với web", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" } });
    expect((t.context as Record<string, unknown>).route).toBe("vscode");
  });

  it("★★ lịch sử đi nguyên vẹn", () => {
    const ls = [{ role: "user" as const, content: "trước đó" }];
    const t = dungYeuCauStream({ ...CHUNG, lichSu: ls, cheDo: { loai: "local", nhan: "x" } });
    expect(t.history).toEqual(ls);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ**

Run: `npx vitest run vscode-extension/src/loi/yeuCau.unit.test.ts`
Expected: FAIL — không phân giải được `./yeuCau`.

- [ ] **Step 3: Cài đặt**

Tạo `vscode-extension/src/loi/yeuCau.ts`:

```ts
/**
 * Dựng thân POST cho `/api/ai/local-kb/stream`.
 *
 * ⚠ Vì sao LOCAL phải là `codingMode:false`: tool đọc/grep của server chạy trên hộp cát CỦA
 * SERVER. Mã của dev không có ở đó, nên bật tool server chỉ khiến model đọc nhầm repo khác rồi
 * trả lời tự tin mà sai. Ở chế độ LOCAL, ngữ cảnh do extension gom sẵn và nhét vào `question`.
 */
export type CheDoDuAn =
  | { loai: "local"; nhan: string }
  | { loai: "server"; projectId: string; nhan: string };

export type LuotChat = { role: "user" | "assistant"; content: string };

export function dungYeuCauStream(dv: {
  cauHoi: string;
  nguCanh: string;
  lichSu: LuotChat[];
  ngonNgu: string;
  vaiTro: string;
  cheDo: CheDoDuAn;
}): Record<string, unknown> {
  const context: Record<string, unknown> = {
    route: "vscode",
    uiLanguage: dv.ngonNgu,
    codingMode: dv.cheDo.loai === "server",
  };
  if (dv.cheDo.loai === "server") context.projectId = dv.cheDo.projectId;

  const question = dv.nguCanh.trim().length > 0 ? `${dv.nguCanh}\n${dv.cauHoi}` : dv.cauHoi;

  return { question, history: dv.lichSu, userRole: dv.vaiTro, context };
}
```

- [ ] **Step 4: Chạy, xác nhận XANH**

Run: `npx vitest run vscode-extension/src/loi/yeuCau.unit.test.ts`
Expected: PASS (6 ca).

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/src/loi/yeuCau.ts vscode-extension/src/loi/yeuCau.unit.test.ts
git commit -m "feat(vscode-ext): dựng thân yêu cầu SSE, LOCAL không bật tool server (Đợt A/5)"
```

---

### Task 6: Đọc luồng SSE (nối bộ tách khung)

**Files:**
- Create: `vscode-extension/src/mang/dongSse.ts`
- Test: `vscode-extension/src/mang/dongSse.unit.test.ts`

**Interfaces:**
- Consumes: `tachKhungSse` (Task 2), thân yêu cầu từ `dungYeuCauStream` (Task 5), cookie (Task 3)
- Produces:
  - `docLuongSse(luong: ReadableStream<Uint8Array>, nhan: (sk: Record<string, unknown>) => void): Promise<{ hong: string[] }>`
  - `moDongSse(dv: { serverUrl: string; cookie: string; than: unknown; nhan: (sk: Record<string, unknown>) => void; tinHieu?: AbortSignal }): Promise<{ hong: string[] }>`

Lưu ý thiết kế: tách `docLuongSse` (nhận sẵn một `ReadableStream`) khỏi `moDongSse` (làm
`fetch`) để **đo được vòng đọc mà không cần mạng** — dựng stream giả trong lưới.

- [ ] **Step 1: Viết lưới (ĐỎ trước)**

Tạo `vscode-extension/src/mang/dongSse.unit.test.ts`:

```ts
/**
 * LƯỚI vòng đọc SSE. Dựng ReadableStream GIẢ cắt chunk ở giữa khung để chứng minh vòng đọc mang
 * đệm sang đúng — đây là chỗ mà lưới của `tachKhungSse` một mình KHÔNG phủ (nó đo hàm, còn đây
 * đo VÒNG dùng hàm).
 */
import { describe, it, expect } from "vitest";
import { docLuongSse } from "./dongSse";

function luongTu(manh: string[]): ReadableStream<Uint8Array> {
  const bo = new TextEncoder();
  return new ReadableStream({
    start(dk) {
      for (const m of manh) dk.enqueue(bo.encode(m));
      dk.close();
    },
  });
}

describe("docLuongSse", () => {
  it("★★★ khung cắt ngang chunk vẫn ra ĐỦ sự kiện, ĐÚNG thứ tự", async () => {
    const thu: Array<Record<string, unknown>> = [];
    await docLuongSse(luongTu(['data: {"i":1}\n\ndata: {"i', '":2}\n\n']), (sk) => thu.push(sk));
    expect(thu).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it("★★★ khung hỏng được BÁO CÁO chứ không nuốt", async () => {
    const r = await docLuongSse(luongTu(["data: {hong}\n\n"]), () => {});
    expect(r.hong).toEqual(["{hong}"]);
  });

  it("★★ luồng kết thúc giữa khung dở ⇒ không ném, khung dở bị bỏ", async () => {
    const thu: Array<Record<string, unknown>> = [];
    const r = await docLuongSse(luongTu(['data: {"i":1}\n\ndata: {"do']), (sk) => thu.push(sk));
    expect(thu).toEqual([{ i: 1 }]);
    expect(r.hong).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ**

Run: `npx vitest run vscode-extension/src/mang/dongSse.unit.test.ts`
Expected: FAIL — không phân giải được `./dongSse`.

- [ ] **Step 3: Cài đặt**

Tạo `vscode-extension/src/mang/dongSse.ts`:

```ts
/**
 * Vòng đọc SSE. Tách làm hai để đo được: `docLuongSse` nhận sẵn một stream (lưới dựng stream giả,
 * không cần mạng), `moDongSse` chỉ lo `fetch` + cookie.
 */
import { tachKhungSse } from "../loi/khungSse";

export async function docLuongSse(
  luong: ReadableStream<Uint8Array>,
  nhan: (sk: Record<string, unknown>) => void,
): Promise<{ hong: string[] }> {
  const doc = luong.getReader();
  const giaiMa = new TextDecoder();
  let dem = "";
  const hong: string[] = [];

  for (;;) {
    const { done, value } = await doc.read();
    if (done) break;
    const r = tachKhungSse(dem, giaiMa.decode(value, { stream: true }));
    dem = r.du;
    hong.push(...r.hong);
    for (const sk of r.suKien) nhan(sk);
  }
  return { hong };
}

export async function moDongSse(dv: {
  serverUrl: string;
  cookie: string;
  than: unknown;
  nhan: (sk: Record<string, unknown>) => void;
  tinHieu?: AbortSignal;
}): Promise<{ hong: string[] }> {
  const res = await fetch(`${dv.serverUrl.replace(/\/+$/, "")}/api/ai/local-kb/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      cookie: `app_session_id=${dv.cookie}`,
    },
    body: JSON.stringify(dv.than),
    signal: dv.tinHieu,
  });
  if (!res.ok) throw new Error(`Máy chủ trả ${res.status} — thử đăng nhập lại.`);
  if (!res.body) throw new Error("Máy chủ không trả luồng dữ liệu.");
  return docLuongSse(res.body, dv.nhan);
}
```

- [ ] **Step 4: Chạy, xác nhận XANH**

Run: `npx vitest run vscode-extension/src/mang/dongSse.unit.test.ts`
Expected: PASS (3 ca).

- [ ] **Step 5: Commit**

```bash
git add vscode-extension/src/mang/dongSse.ts vscode-extension/src/mang/dongSse.unit.test.ts
git commit -m "feat(vscode-ext): vòng đọc SSE có đệm, đo được bằng stream giả (Đợt A/6)"
```

---

### Task 7: Bảng trò chuyện (webview) + một lượt hỏi đáp đầu-cuối

**Files:**
- Create: `vscode-extension/src/loi/thoatHtml.ts`
- Test: `vscode-extension/src/loi/thoatHtml.unit.test.ts`
- Create: `vscode-extension/src/ui/bangChat.ts`
- Test: `vscode-extension/src/ui/htmlBang.unit.test.ts`
- Modify: `vscode-extension/src/extension.ts`

**Interfaces:**
- Consumes: `moDongSse` (Task 6), `dungYeuCauStream` (Task 5), `dungNguCanh` (Task 4), cookie
  (Task 3)
- Produces: `thoatHtml(s: string): string`; `dungHtmlBang(dv: { nonce: string }): string`; lớp
  `BangChat` với `BangChat.moHoacHien(context)`. Task 8 thêm ô chọn dự án vào chính bảng này.

Ghi chú: `dungHtmlBang` để trong `bangChat.ts` nhưng **không được import `vscode`** ở đường dẫn
của nó — vì vậy đặt hàm dựng HTML ở đầu tệp và lưới import trực tiếp tệp `ui/bangChat` sẽ kéo
theo `vscode`. **Giải pháp: tách hàm dựng HTML sang `src/ui/htmlBang.ts` (thuần)**, `bangChat.ts`
import lại. Lưới chỉ đo `htmlBang.ts`.

- [ ] **Step 1: Viết lưới thoát HTML + HTML bảng (ĐỎ trước)**

Tạo `vscode-extension/src/loi/thoatHtml.unit.test.ts`:

```ts
/**
 * LƯỚI thoát HTML. Model sinh chữ tự do; nhét thẳng vào innerHTML là mở cửa cho mã chạy trong
 * webview. Đây là vị từ chặn.
 */
import { describe, it, expect } from "vitest";
import { thoatHtml } from "./thoatHtml";

describe("thoatHtml", () => {
  it("★★★ vô hiệu hoá thẻ script", () => {
    expect(thoatHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });
  it("★★★ thoát dấu nháy và &", () => {
    expect(thoatHtml(`a & "b" 'c'`)).toBe("a &amp; &quot;b&quot; &#39;c&#39;");
  });
  it("★★ chữ thường không đổi", () => {
    expect(thoatHtml("Xin chào")).toBe("Xin chào");
  });
});
```

Tạo `vscode-extension/src/ui/htmlBang.unit.test.ts`:

```ts
/**
 * LƯỚI khung HTML của webview: CSP phải KHOÁ, và script phải chạy bằng nonce. Một webview lỡ mở
 * `script-src *` là lỗ hổng im lặng — không ai thấy cho tới lúc bị lợi dụng.
 */
import { describe, it, expect } from "vitest";
import { dungHtmlBang } from "./htmlBang";

describe("dungHtmlBang", () => {
  const html = dungHtmlBang({ nonce: "NONCE123" });

  it("★★★ có CSP và script chạy bằng nonce", () => {
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("nonce-NONCE123");
    expect(html).toContain('<script nonce="NONCE123">');
  });

  it("★★★ KHÔNG mở script-src cho mọi nguồn", () => {
    expect(html).not.toMatch(/script-src[^;]*\*/);
    expect(html).not.toContain("unsafe-inline");
  });

  it("★★ có ô nhập, nút gửi và vùng hội thoại", () => {
    expect(html).toContain('id="o-nhap"');
    expect(html).toContain('id="nut-gui"');
    expect(html).toContain('id="hoi-thoai"');
  });
});
```

- [ ] **Step 2: Chạy cả hai, xác nhận ĐỎ**

Run: `npx vitest run vscode-extension/src/loi/thoatHtml.unit.test.ts vscode-extension/src/ui/htmlBang.unit.test.ts`
Expected: FAIL — thiếu module.

- [ ] **Step 3: Cài `thoatHtml.ts`**

```ts
/** Thoát ký tự HTML trước khi đưa chữ do model sinh vào webview. */
export function thoatHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 4: Cài `src/ui/htmlBang.ts`**

```ts
/**
 * Khung HTML của bảng trò chuyện. THUẦN (không import `vscode`) để lưới đo được CSP.
 * Script chỉ chạy bằng `nonce` — không `unsafe-inline`, không nguồn ngoài (nhà máy offline).
 */
export function dungHtmlBang(dv: { nonce: string }): string {
  const n = dv.nonce;
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';" />
<style nonce="${n}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         margin: 0; padding: 8px; display: flex; flex-direction: column; height: 100vh; }
  #hoi-thoai { flex: 1; overflow-y: auto; white-space: pre-wrap; font-size: 13px; }
  .luot { margin-bottom: 10px; }
  .nhan { opacity: .7; font-size: 11px; text-transform: uppercase; }
  #hang-nhap { display: flex; gap: 6px; margin-top: 8px; }
  #o-nhap { flex: 1; background: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            padding: 6px; font-family: inherit; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 6px 12px; cursor: pointer; }
</style>
</head>
<body>
<div id="hoi-thoai"></div>
<div id="hang-nhap">
  <textarea id="o-nhap" rows="2" placeholder="Hỏi AI Local… (Ctrl+Enter để gửi)"></textarea>
  <button id="nut-gui">Gửi</button>
</div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const hoiThoai = document.getElementById("hoi-thoai");
  const oNhap = document.getElementById("o-nhap");
  let khoiTraLoi = null;

  function themLuot(nhan, chu) {
    const d = document.createElement("div");
    d.className = "luot";
    const t = document.createElement("div");
    t.className = "nhan";
    t.textContent = nhan;
    const c = document.createElement("div");
    c.textContent = chu;
    d.appendChild(t); d.appendChild(c);
    hoiThoai.appendChild(d);
    hoiThoai.scrollTop = hoiThoai.scrollHeight;
    return c;
  }

  function gui() {
    const cauHoi = oNhap.value.trim();
    if (!cauHoi) return;
    themLuot("Bạn", cauHoi);
    oNhap.value = "";
    khoiTraLoi = themLuot("AI Local", "");
    vscode.postMessage({ loai: "hoi", cauHoi });
  }

  document.getElementById("nut-gui").addEventListener("click", gui);
  oNhap.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); gui(); }
  });

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.loai === "token" && khoiTraLoi) khoiTraLoi.textContent += m.chu;
    else if (m.loai === "loi") themLuot("Lỗi", m.thongDiep);
    hoiThoai.scrollTop = hoiThoai.scrollHeight;
  });
</script>
</body>
</html>`;
}
```

Ghi chú: dùng `textContent` trong webview (không `innerHTML`) nên `thoatHtml` là lớp phòng thủ
thứ hai cho các chỗ buộc phải ghép chuỗi HTML về sau.

- [ ] **Step 5: Chạy hai lưới, xác nhận XANH**

Run: `npx vitest run vscode-extension/src/loi/thoatHtml.unit.test.ts vscode-extension/src/ui/htmlBang.unit.test.ts`
Expected: PASS (6 ca).

- [ ] **Step 6: Cài `src/ui/bangChat.ts`**

```ts
/**
 * Bảng trò chuyện AI Local. ĐỢT A: chỉ đọc — gom ngữ cảnh từ editor đang mở, gửi câu hỏi, đổ chữ
 * về. KHÔNG có bất kỳ đường ghi tệp nào ở đây.
 */
import * as vscode from "vscode";
import { dungHtmlBang } from "./htmlBang";
import { dungNguCanh } from "../loi/nguCanh";
import { dungYeuCauStream, type CheDoDuAn, type LuotChat } from "../loi/yeuCau";
import { moDongSse } from "../mang/dongSse";
import { KHOA_COOKIE } from "../loi/dangNhap";

function chuoiNgauNhien(): string {
  let s = "";
  const bang = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) s += bang[Math.floor(Math.random() * bang.length)];
  return s;
}

export class BangChat {
  private static hienTai: BangChat | undefined;
  private lichSu: LuotChat[] = [];
  private huy: AbortController | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel.webview.html = dungHtmlBang({ nonce: chuoiNgauNhien() });
    this.panel.onDidDispose(() => {
      this.huy?.abort();
      BangChat.hienTai = undefined;
    });
    this.panel.webview.onDidReceiveMessage((m: { loai: string; cauHoi?: string }) => {
      if (m.loai === "hoi" && m.cauHoi) void this.hoi(m.cauHoi);
    });
  }

  static moHoacHien(context: vscode.ExtensionContext): void {
    if (BangChat.hienTai) {
      BangChat.hienTai.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "aviAiLocalChat",
      "AI Local",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    BangChat.hienTai = new BangChat(panel, context);
  }

  private thuThapNguCanh(): string {
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const nganSach = cfg.get<number>("nganSachNguCanh", 24000);
    const ed = vscode.window.activeTextEditor;
    if (!ed) return dungNguCanh({ nganSach });

    const duong = vscode.workspace.asRelativePath(ed.document.uri);
    const chon = ed.selection.isEmpty
      ? undefined
      : {
          duong,
          dongDau: ed.selection.start.line + 1,
          dongCuoi: ed.selection.end.line + 1,
          noiDung: ed.document.getText(ed.selection),
        };
    return dungNguCanh({
      nganSach,
      doanChon: chon,
      tepDangMo: { duong, noiDung: ed.document.getText() },
    });
  }

  private async hoi(cauHoi: string): Promise<void> {
    const cookie = await this.context.secrets.get(KHOA_COOKIE);
    if (!cookie) {
      void this.panel.webview.postMessage({
        loai: "loi",
        thongDiep: "Chưa đăng nhập — chạy lệnh 'AI Local: Đăng nhập'.",
      });
      return;
    }
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const cheDo: CheDoDuAn = {
      loai: "local",
      nhan: vscode.workspace.workspaceFolders?.[0]?.name ?? "workspace",
    };
    const than = dungYeuCauStream({
      cauHoi,
      nguCanh: this.thuThapNguCanh(),
      lichSu: this.lichSu,
      ngonNgu: cfg.get<string>("uiLanguage", "vi"),
      vaiTro: "engineer",
      cheDo,
    });

    this.huy?.abort();
    this.huy = new AbortController();
    let traLoi = "";
    try {
      await moDongSse({
        serverUrl: cfg.get<string>("serverUrl", "http://localhost:3000"),
        cookie,
        than,
        tinHieu: this.huy.signal,
        nhan: (sk) => {
          // Tên trường ĐÃ ĐO trên mã máy chủ: `send({ type:"token", token: evt.token })`
          // (server/routes/aiLocalKnowledgeApi.ts:595) — KHÔNG phải `text`.
          if (sk.type === "token" && typeof sk.token === "string") {
            traLoi += sk.token;
            void this.panel.webview.postMessage({ loai: "token", chu: sk.token });
          } else if (sk.type === "error") {
            void this.panel.webview.postMessage({
              loai: "loi",
              thongDiep: typeof sk.message === "string" ? sk.message : "Máy chủ báo lỗi.",
            });
          }
        },
      });
      this.lichSu.push({ role: "user", content: cauHoi }, { role: "assistant", content: traLoi });
    } catch (e) {
      void this.panel.webview.postMessage({ loai: "loi", thongDiep: (e as Error).message });
    }
  }
}
```

Ghi chú: hằng `KHOA_COOKIE` **không được khai lại** ở tệp này — import từ `../loi/dangNhap` (hai
bản sao của một hằng là cách chắc chắn nhất để chúng lệch nhau về sau).

- [ ] **Step 7: Nối lệnh `moBangChat`**

Trong `extension.ts`, thay thân lệnh `aviAiLocal.moBangChat`:

```ts
import { BangChat } from "./ui/bangChat";
// …
    vscode.commands.registerCommand("aviAiLocal.moBangChat", () => BangChat.moHoacHien(context)),
```

- [ ] **Step 8: check + build + NGHIỆM THU LIVE (bắt buộc)**

Run: `npm run ext:check` → 0 lỗi. Run: `npm run ext:build`.
F5 → mở một tệp mã bất kỳ **trong scratchpad** (KHÔNG dùng `sandbox-projects/`) → chạy "AI Local:
Mở bảng trò chuyện" → hỏi "tệp này làm gì?" →
**Đo hậu quả, không đo cơ chế:**
1. Chữ có chảy về từng mẩu không (không phải hiện một cục cuối cùng)?
2. Câu trả lời có **nhắc đúng nội dung tệp đang mở** không (chứng minh ngữ cảnh THẬT tới nơi)?
3. Nếu không có chữ nào: mở Developer Tools của webview, **đọc tên trường thật** của sự kiện
   `token` rồi sửa Step 6 cho khớp.

Ghi lại số đo thật (bao nhiêu giây tới token đầu, có nhắc đúng tệp không).

- [ ] **Step 9: Commit**

```bash
git add vscode-extension/src/loi/thoatHtml.ts vscode-extension/src/loi/thoatHtml.unit.test.ts \
  vscode-extension/src/ui/htmlBang.ts vscode-extension/src/ui/htmlBang.unit.test.ts \
  vscode-extension/src/ui/bangChat.ts vscode-extension/src/extension.ts
git commit -m "feat(vscode-ext): bảng trò chuyện webview + một lượt hỏi đáp có ngữ cảnh (Đợt A/7)"
```

---

### Task 8: Ô chọn dự án LOCAL/SERVER + gọi tRPC

**Files:**
- Create: `vscode-extension/src/loi/trpc.ts`
- Test: `vscode-extension/src/loi/trpc.unit.test.ts`
- Create: `vscode-extension/src/loi/duAn.ts`
- Test: `vscode-extension/src/loi/duAn.unit.test.ts`
- Create: `vscode-extension/src/mang/trpc.ts`
- Modify: `vscode-extension/src/ui/htmlBang.ts`, `vscode-extension/src/ui/bangChat.ts`

**Interfaces:**
- Consumes: cookie (Task 3), `CheDoDuAn` (Task 5)
- Produces:
  - `boBoiSuperjson(dap: unknown): unknown`
  - `interface MucDuAn { id: string; nhan: string; loai: "local" | "server" }`
  - `gopDanhSachDuAn(thuMucLocal: string[], duAnServer: Array<{ id: string; name: string }>): MucDuAn[]`
  - `goiTruyVanTrpc(serverUrl: string, cookie: string, ten: string, dauVao?: unknown): Promise<unknown>`

- [ ] **Step 1: Viết lưới (ĐỎ trước)**

Tạo `vscode-extension/src/loi/trpc.unit.test.ts`:

```ts
/**
 * LƯỚI bóc vỏ superjson. Máy chủ dùng transformer superjson ⇒ dữ liệu thật nằm ở
 * `result.data.json`. Bóc sai một tầng thì mọi danh sách đều rỗng mà KHÔNG có lỗi nào — hỏng im.
 */
import { describe, it, expect } from "vitest";
import { boBoiSuperjson } from "./trpc";

describe("boBoiSuperjson", () => {
  it("★★★ bóc đúng result.data.json", () => {
    expect(boBoiSuperjson({ result: { data: { json: { projects: [1] } } } })).toEqual({ projects: [1] });
  });
  it("★★ dạng không bọc json vẫn bóc được result.data", () => {
    expect(boBoiSuperjson({ result: { data: { projects: [2] } } })).toEqual({ projects: [2] });
  });
  it("★★★ đáp ứng lỗi ⇒ null (không giả vờ có dữ liệu)", () => {
    expect(boBoiSuperjson({ error: { json: { message: "x" } } })).toBeNull();
    expect(boBoiSuperjson(null)).toBeNull();
  });
});
```

Tạo `vscode-extension/src/loi/duAn.unit.test.ts`:

```ts
/**
 * LƯỚI gộp danh sách dự án. Bất biến CHỐNG NHẦM LẪN CHẾT NGƯỜI: mục LOCAL và SERVER phải phân
 * biệt được bằng mắt (nhãn) và bằng mã (trường `loai`) — dev tưởng sửa tệp local mà thật ra động
 * vào box AI là tai nạn không cứu được.
 */
import { describe, it, expect } from "vitest";
import { gopDanhSachDuAn } from "./duAn";

describe("gopDanhSachDuAn", () => {
  it("★★★ LOCAL đứng trước và có nhãn LOCAL", () => {
    const ds = gopDanhSachDuAn(["d:/du-an/aoi"], [{ id: "csharp", name: "Demo Csharp" }]);
    expect(ds[0].loai).toBe("local");
    expect(ds[0].nhan).toContain("LOCAL");
  });

  it("★★★ mục SERVER có nhãn SERVER", () => {
    const ds = gopDanhSachDuAn([], [{ id: "csharp", name: "Demo Csharp" }]);
    expect(ds[0].loai).toBe("server");
    expect(ds[0].nhan).toContain("SERVER");
    expect(ds[0].nhan).toContain("Demo Csharp");
  });

  it("★★★ id KHÔNG đụng nhau giữa hai nguồn (tiền tố riêng)", () => {
    const ds = gopDanhSachDuAn(["d:/x/csharp"], [{ id: "csharp", name: "Csharp" }]);
    expect(new Set(ds.map((m) => m.id)).size).toBe(ds.length);
  });

  it("★★ không có workspace và không có dự án server ⇒ danh sách rỗng", () => {
    expect(gopDanhSachDuAn([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ**

Run: `npx vitest run vscode-extension/src/loi/trpc.unit.test.ts vscode-extension/src/loi/duAn.unit.test.ts`
Expected: FAIL — thiếu module.

- [ ] **Step 3: Cài `src/loi/trpc.ts`**

```ts
/**
 * Bóc vỏ đáp ứng tRPC. Máy chủ dùng superjson: dữ liệu thật ở `result.data.json`. Đáp ứng lỗi trả
 * `null` để lớp trên KHÔNG hiển thị danh sách rỗng như thể "không có gì" trong khi thật ra hỏng.
 */
export function boBoiSuperjson(dap: unknown): unknown {
  if (!dap || typeof dap !== "object") return null;
  const o = dap as Record<string, unknown>;
  if (o.error) return null;
  const kq = o.result as Record<string, unknown> | undefined;
  if (!kq || typeof kq !== "object") return null;
  const du = kq.data as Record<string, unknown> | undefined;
  if (!du || typeof du !== "object") return null;
  return "json" in du ? du.json : du;
}
```

- [ ] **Step 4: Cài `src/loi/duAn.ts`**

```ts
/**
 * Gộp dự án LOCAL (thư mục workspace) và SERVER (hộp cát trên box AI) vào MỘT danh sách.
 *
 * ⚠ Nhãn là hàng rào an toàn, không phải trang trí: hai chế độ ghi vào HAI NƠI KHÁC NHAU. Một dev
 * tưởng đang sửa tệp local mà thật ra động vào box AI (hoặc ngược lại) là tai nạn không cứu được,
 * nên `loai` phải hiện ra cả bằng mắt (nhãn) lẫn bằng mã (trường).
 */
export interface MucDuAn {
  id: string;
  nhan: string;
  loai: "local" | "server";
}

export function gopDanhSachDuAn(
  thuMucLocal: string[],
  duAnServer: Array<{ id: string; name: string }>,
): MucDuAn[] {
  const ds: MucDuAn[] = [];
  for (const t of thuMucLocal) ds.push({ id: `local:${t}`, nhan: `LOCAL · ${t}`, loai: "local" });
  for (const d of duAnServer) {
    ds.push({ id: `server:${d.id}`, nhan: `SERVER · ${d.name}`, loai: "server" });
  }
  return ds;
}
```

- [ ] **Step 5: Chạy, xác nhận XANH**

Run: `npx vitest run vscode-extension/src/loi/trpc.unit.test.ts vscode-extension/src/loi/duAn.unit.test.ts`
Expected: PASS (7 ca).

- [ ] **Step 6: Cài `src/mang/trpc.ts`**

```ts
/** Gọi truy vấn tRPC qua HTTP GET (mount `/api/trpc`, transformer superjson). */
import { boBoiSuperjson } from "../loi/trpc";

export async function goiTruyVanTrpc(
  serverUrl: string,
  cookie: string,
  ten: string,
  dauVao?: unknown,
): Promise<unknown> {
  const goc = serverUrl.replace(/\/+$/, "");
  const q = dauVao === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: dauVao }))}`;
  const res = await fetch(`${goc}/api/trpc/${ten}${q}`, {
    headers: { cookie: `app_session_id=${cookie}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`tRPC ${ten} trả ${res.status}`);
  return boBoiSuperjson(await res.json());
}
```

- [ ] **Step 7: Thêm ô chọn vào `htmlBang.ts`**

Trong `dungHtmlBang`, ngay trước `<div id="hoi-thoai"></div>` thêm:

```html
<select id="o-du-an" title="Chọn dự án"></select>
```

và trong `<style>` thêm:

```css
  #o-du-an { width: 100%; margin-bottom: 8px; background: var(--vscode-dropdown-background);
             color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);
             padding: 4px; }
```

và trong `<script>`, trong `window.addEventListener("message", …)` thêm nhánh:

```js
    else if (m.loai === "duAn") {
      const o = document.getElementById("o-du-an");
      o.innerHTML = "";
      for (const d of m.ds) {
        const opt = document.createElement("option");
        opt.value = d.id; opt.textContent = d.nhan;
        o.appendChild(opt);
      }
    }
```

và trong hàm `gui()` đổi dòng `postMessage` thành:

```js
    vscode.postMessage({ loai: "hoi", cauHoi, duAnId: document.getElementById("o-du-an").value });
```

Cập nhật lưới `htmlBang.unit.test.ts` — thêm ca:

```ts
  it("★★★ có ô chọn dự án", () => {
    expect(html).toContain('id="o-du-an"');
  });
```

- [ ] **Step 8: Nối vào `bangChat.ts`**

Thêm import và nạp danh sách khi mở bảng:

```ts
import { gopDanhSachDuAn, type MucDuAn } from "../loi/duAn";
import { goiTruyVanTrpc } from "../mang/trpc";
```

Thêm trường `private dsDuAn: MucDuAn[] = [];` và `private duAnChon: string | undefined;`
Thêm phương thức:

```ts
  private async napDuAn(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const serverUrl = cfg.get<string>("serverUrl", "http://localhost:3000");
    const cookie = await this.context.secrets.get(KHOA_COOKIE);
    const local = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    let server: Array<{ id: string; name: string }> = [];
    if (cookie) {
      try {
        const du = (await goiTruyVanTrpc(serverUrl, cookie, "repoWorkspace.listProjects")) as
          | { projects?: Array<{ id: string; name: string }> }
          | null;
        server = du?.projects ?? [];
      } catch {
        server = []; // không nối được server thì vẫn dùng được chế độ LOCAL
      }
    }
    this.dsDuAn = gopDanhSachDuAn(local, server);
    this.duAnChon = this.duAnChon ?? this.dsDuAn[0]?.id;
    void this.panel.webview.postMessage({ loai: "duAn", ds: this.dsDuAn });
  }
```

Gọi `void this.napDuAn();` ở cuối constructor. Trong `onDidReceiveMessage`, lưu
`if (m.duAnId) this.duAnChon = m.duAnId;` trước khi gọi `this.hoi(...)` (mở rộng kiểu tham số
thành `{ loai: string; cauHoi?: string; duAnId?: string }`).

Trong `hoi()`, thay chỗ dựng `cheDo` cứng bằng:

```ts
    const muc = this.dsDuAn.find((d) => d.id === this.duAnChon) ?? this.dsDuAn[0];
    const cheDo: CheDoDuAn =
      muc && muc.loai === "server"
        ? { loai: "server", projectId: muc.id.slice("server:".length), nhan: muc.nhan }
        : { loai: "local", nhan: muc?.nhan ?? "workspace" };
```

- [ ] **Step 9: check + build + lưới**

Run: `npm run ext:check` → 0 lỗi.
Run: `npx vitest run vscode-extension/src/` → Expected: PASS toàn bộ.
Run: `npm run ext:build`.

- [ ] **Step 10: Nghiệm thu LIVE**

F5 → mở bảng → ô chọn phải liệt kê **workspace LOCAL** và **các dự án SERVER thật** (đúng danh
sách `AI_REPO_SANDBOX_ROOTS`). Chọn một dự án SERVER, hỏi "liệt kê tệp trong dự án" → xem model
có trả lời theo repo server không. **Ghi lại kết quả thật**, kể cả khi vòng tool server hết giờ
20 giây (đây chính là rủi ro spec §7 yêu cầu đo).

- [ ] **Step 11: Commit**

```bash
git add vscode-extension/src/loi/trpc.ts vscode-extension/src/loi/trpc.unit.test.ts \
  vscode-extension/src/loi/duAn.ts vscode-extension/src/loi/duAn.unit.test.ts \
  vscode-extension/src/mang/trpc.ts vscode-extension/src/ui/htmlBang.ts \
  vscode-extension/src/ui/htmlBang.unit.test.ts vscode-extension/src/ui/bangChat.ts
git commit -m "feat(vscode-ext): ô chọn dự án LOCAL/SERVER + gọi tRPC superjson (Đợt A/8)"
```

---

### Task 9: Đóng gói `.vsix` + nghiệm thu Đợt A + ghi nhận sự thật

**Files:**
- Create: `vscode-extension/README.md`
- Create: `docs/superpowers/plans/2026-08-28-vscode-extension-dot-a-ket-qua.md`

**Interfaces:**
- Consumes: toàn bộ Task 1-8
- Produces: tệp `vscode-extension/avi-ai-local-0.1.0.vsix` (KHÔNG commit tệp .vsix vào git) và
  báo cáo nghiệm thu.

- [ ] **Step 1: Viết `vscode-extension/README.md`**

Nội dung tối thiểu: extension làm gì · **Đợt A chỉ ĐỌC, chưa ghi tệp** · cách cấu hình
`aviAiLocal.serverUrl` · cách đăng nhập · **tài khoản bật 2FA không dùng được** · cách cài offline
(`code --install-extension avi-ai-local-0.1.0.vsix`).

- [ ] **Step 2: Thêm `*.vsix` vào `.gitignore` gốc**

Thêm dòng `vscode-extension/*.vsix` vào `.gitignore`.

- [ ] **Step 3: Đóng gói**

Run: `npm run ext:build` rồi `npm run ext:package`
Expected: sinh `vscode-extension/avi-ai-local-0.1.0.vsix`.

- [ ] **Step 4: Cài THẬT vào VSCode rồi chạy (không phải Dev Host)**

Run: `code --install-extension vscode-extension/avi-ai-local-0.1.0.vsix`
Mở lại VSCode → chạy "AI Local: Đăng nhập" → "AI Local: Mở bảng trò chuyện" → hỏi một câu.

- [ ] **Step 5: Đo và GHI SỰ THẬT vào tệp kết quả**

Tạo `docs/superpowers/plans/2026-08-28-vscode-extension-dot-a-ket-qua.md` ghi **số đo thật**:
- Bao nhiêu giây tới token đầu tiên; tổng thời gian một lượt.
- Câu trả lời có nhắc đúng nội dung tệp đang mở không (ngữ cảnh có tới nơi không).
- Ô chọn dự án liệt kê được bao nhiêu mục LOCAL / SERVER.
- Chế độ SERVER: vòng tool có chạy nổi trong 20 giây không (spec §7 yêu cầu đo).
- **Mọi thứ KHÔNG chạy được** — ghi thẳng, không giấu.

- [ ] **Step 6: Chạy toàn bộ cổng lần cuối**

Run: `npm run ext:check` → 0 lỗi
Run: `npx vitest run vscode-extension/src/` → PASS toàn bộ
Run: `npm run check` (repo mẹ, chạy RIÊNG — không song song với vitest) → không lỗi MỚI

- [ ] **Step 7: Commit**

```bash
git add vscode-extension/README.md .gitignore \
  docs/superpowers/plans/2026-08-28-vscode-extension-dot-a-ket-qua.md
git commit -m "docs(vscode-ext): README + kết quả nghiệm thu LIVE Đợt A (Đợt A/9)"
```

---

## Cổng ra Đợt A

Đợt A coi là XONG khi **tất cả** đúng:

- [ ] `npm run ext:check` 0 lỗi; `npx vitest run vscode-extension/src/` xanh toàn bộ (≈39 ca).
- [ ] `npm run check` của repo mẹ không sinh lỗi MỚI.
- [ ] `.vsix` cài được và chạy được trên VSCode thật (không chỉ Dev Host).
- [ ] Nghiệm thu LIVE: đăng nhập thật · một lượt hỏi có chữ chảy về · câu trả lời **chứng minh
      ngữ cảnh tệp đang mở đã tới nơi** · ô chọn liệt kê đúng dự án LOCAL và SERVER thật.
- [ ] Tệp kết quả ghi **số đo thật**, kể cả phần chưa chạy được.
- [ ] Không có `fs.write*`, `applyEdit`, `confirmAction` nào trong `vscode-extension/src/`
      (kiểm bằng: `grep -rn "writeFile\|applyEdit\|confirmAction" vscode-extension/src/` ⇒ rỗng).

## Ngoài phạm vi Đợt A

Ghi lại để khỏi trôi vào đây: đường ghi tệp · Cmd+K · vòng tác nhân đa bước · @-mention · duyệt
diff · kiểm toán client · migration enum · vá lỗ `executed`. Tất cả thuộc Đợt B/C/D theo spec §10.
