# Kế hoạch hoàn thiện 3D Twin sau QA lần 11

> **Cho người thực thi (kể cả agent):** BẮT BUỘC dùng `superpowers:subagent-driven-development` (khuyến nghị) hoặc `superpowers:executing-plans` để chạy kế hoạch này theo từng task. Mọi bước dùng checkbox `- [ ]` để theo dõi.

**Mục tiêu:** Đóng 9 khuyết tật còn mở và 7 món nợ phát sinh sau đợt vá QA lần 11, để màn 3D Twin dùng được thật cho cả bốn vai trên dữ liệu quy mô tập đoàn.

**Cách tiếp cận:** Chia theo *lớp hậu quả* chứ không theo màn: an toàn dữ liệu trước, rồi sự thật của con số, rồi mã chưa nối chỗ gọi, rồi năng lực còn thiếu. Mỗi task viết lưới trước, vá sau, và chứng minh bằng ablation. Hạ tầng đo và hạ tầng schema xử lý trước vì chúng chặn mọi phép đo sau đó.

**Công nghệ:** React 19 + TypeScript, tRPC, Drizzle ORM trên PostgreSQL, React Three Fiber, Playwright, Vitest.

**Nguồn:** `docs/superpowers/specs/2026-09-15-qa-lan11-tap-doan-twin.md` và sổ phát hiện `.qa-tapdoan/PHAT-HIEN.md` (51 mục, PH-01 đến PH-37 và V-01 đến V-14). Người thực thi phải đọc cả hai.

---

## Ràng buộc toàn cục

Áp cho mọi task, không nhắc lại trong từng task.

- **Không nới hàng rào phạm vi.** Mọi bản vá phải giữ nguyên các đối chứng âm: người ngoài phạm vi bị chặn ở cả giao diện lẫn API, thủ tục tra theo id ngoài phạm vi trả `NOT_FOUND` chứ không `FORBIDDEN`, danh sách ngoài phạm vi trả mảng rỗng. Một bản vá nới quyền nguy hiểm hơn lỗi nó vá.
- **Lưới trước, vá sau.** Mỗi task: viết lưới, chạy để thấy nó ĐỎ, vá, chạy để thấy XANH, rồi ablation (gỡ bản vá ra, lưới phải ĐỎ lại, hoàn nguyên và kiểm md5).
- **Tập rỗng là HỎNG, không phải ĐẠT.** `every()` trên mảng rỗng luôn đúng. Lưới không đọc được dữ kiện phải báo HỎNG kèm tên dữ kiện thiếu, không được dùng `??` để vá lỗ đọc.
- **Đo theo nghĩa, không theo testid.** Đọc chữ người dùng nhìn thấy. Testid chỉ để tìm phần tử.
- **Số máy của một tầng** đo bằng **số khối trong cảnh 3D**, không bằng ô đếm ở bảng trái (ô đó cố ý đếm theo nhà máy, xem `cayVanHanh.ts:58-61`).
- **Cổng nền phải giữ:** `npm run check` 0 lỗi · `npm run i18n:check` 0 · `npx vitest run client/src/components/twin3d` 113 tệp / 2.639 ca xanh · `npx vitest run phamVi` 17 tệp / 441 ca xanh · `npx vitest run commandCenter` 5 tệp / 91 ca xanh.
- **Playwright** phải launch kèm `--use-angle=default --enable-gpu --ignore-gpu-blocklist`; mặc định là bộ dựng hình phần mềm chạy CPU và cho số khung hình sai một nửa. Luôn ghi kèm số worker.
- **`vite build --outDir` phải là đường tuyệt đối.** Cấu hình đặt gốc ở thư mục `client` nên đường tương đối ghi lạc vào đó mà vẫn báo thành công.
- **Cấm `drizzle-kit push`** trên repo này (lý do ở Task 2).
- Mỗi task kết thúc bằng một commit riêng, dùng pathspec. Không `git stash`, không `git checkout --`, không `reset --hard` trên cây dùng chung.
- **Thông điệp commit luôn ghi ra tệp rồi dùng `-F`, không bao giờ dùng `-m` với chuỗi dài.** Dấu huyền ngược và `$(...)` trong chuỗi nháy kép bị shell **thực thi**. Chủ đợt đã dính đúng bẫy này ở Task 1-2: thông điệp trích tên hai lệnh đồng bộ schema và bash chạy cả hai. Vô hại nhờ may (quyền cơ sở dữ liệu thiếu, lệnh kia không có trong đường dẫn). Kiểm sau commit: `git log -1 --format=%B | grep -cE '^>'` phải bằng 0.
- **Hai ca lưới trong kế hoạch này từng tự thoả trên tập rỗng** (`expect(Array.isArray([])).toBe(true)` đúng cả khi không đọc được gì). Agent thực thi Task 1 bắt được và thêm ca dữ kiện nền cùng ràng buộc số hàng tối thiểu. Khi gặp lưới tương tự trong các task sau, **sửa lưới trước khi chạy**, đừng chạy rồi tin.
- `scripts/apply-migration-0350.mjs` **không tồn tại** (cao nhất là `0349`). Chỗ nào trong kế hoạch trích dẫn tên đó thì đọc `apply-migration-0349.mjs` làm mẫu.

---

## Bản đồ tệp

| Tệp | Trách nhiệm | Task |
|---|---|---|
| `drizzle/schema/hierarchy.ts` | khai cột `workshops.tangId` cho ORM nhìn thấy | 1 |
| `docs/DEPLOYMENT_GUIDE.md` | luật cấm `drizzle-kit push` | 2 |
| `client/src/pages/TwinStudio.tsx` | cổng chặn mất dữ liệu cho đổi tab và nạp lại nền | 3, 4 |
| `client/src/components/twin3d/van-hanh/kpiNoiLogic.ts` | mẫu số KPI theo phạm vi đang xem | 5 |
| `client/src/pages/TwinVanHanh.tsx` | nguồn máy cho KPI, vị trí bảng KPI, ngăn xử lý trên màn nhà máy | 5, 6, 10 |
| `client/src/components/twin3d/van-hanh/DanhSachMay.tsx` | rút tiền tố mã máy | 7 |
| `client/src/components/twin3d/van-hanh/daiCanhBaoLogic.ts` | danh tính máy và công ty cho dòng cảnh báo | 8 |
| `client/src/components/twin3d/van-hanh/DaiCanhBao.tsx` | hiển thị danh tính | 8 |
| `client/src/components/twin3d/van-hanh/nganXuLyLogic.ts` | hành động báo bất thường, ghi chú, đích cấp nhà máy | 9, 10, 11 |
| `client/src/components/twin3d/van-hanh/NganXuLy.tsx` | giao diện các hành động trên | 9, 10, 11 |
| `client/src/components/twin3d/van-hanh/sucKhoeMay.ts` | nối `xepHangSucKhoe` vào giao diện | 12 |
| `client/src/components/twin3d/loi/KhungCanh.tsx` | bộ đếm vòng sức khoẻ để đo được | 12 |
| `server/routers/hierarchyRouters.ts` | cổng quyền cho `factory.list` | 13 |
| `client/public/aoi-upload-test-client.html` | gỡ khoá API mặc định | 14 |

---

## Giai đoạn 0 — Hạ tầng chặn (Task 1-2)

Hai task này không sửa hành vi sản phẩm nhưng phải làm trước, vì mọi task sau đều chạm schema hoặc dựng lại.

### Task 1: Khai `workshops.tangId` vào schema Drizzle

Cột có thật trong cơ sở dữ liệu (migration `drizzle/0350_twin_toa_nha_va_tang.sql:127`, khoá ngoại dòng 134, chỉ mục dòng 138) nhưng vắng trong schema nên mọi truy vấn có kiểu đều mù với nó. Một agent trong đợt QA đã đọc schema rồi kết luận "cột không tồn tại" và phải đi đường vòng.

**Tệp:**
- Sửa: `drizzle/schema/hierarchy.ts:109-129` (bảng `workshops`)
- Lưới: `server/db/workshopTangId.db.test.ts` (tạo mới)

**Giao diện:**
- Sản xuất: cột `workshops.tangId` kiểu `integer | null` đọc được qua Drizzle, dùng cho các task sau nếu cần truy vấn xưởng theo tầng.

- [ ] **Bước 1: Viết lưới đọc cột qua Drizzle**

```ts
import { describe, expect, it } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { workshops } from "../../drizzle/schema/hierarchy";

describe("workshops.tangId — cột có trong DB phải đọc được qua Drizzle", () => {
  it("chọn được cột tangId mà không lỗi kiểu", async () => {
    const db = await getDb();
    if (!db) throw new Error("KHÔNG ĐỌC ĐƯỢC: kết nối DB");
    const hang = await db
      .select({ id: workshops.id, tangId: workshops.tangId })
      .from(workshops)
      .limit(5);
    expect(Array.isArray(hang)).toBe(true);
    for (const h of hang) {
      expect(h.tangId === null || typeof h.tangId === "number").toBe(true);
    }
  });

  it("lọc theo tangId khác null chạy được (chứng minh cột vào được WHERE)", async () => {
    const db = await getDb();
    if (!db) throw new Error("KHÔNG ĐỌC ĐƯỢC: kết nối DB");
    const hang = await db
      .select({ id: workshops.id })
      .from(workshops)
      .where(isNotNull(workshops.tangId))
      .limit(5);
    expect(Array.isArray(hang)).toBe(true);
  });
});
```

- [ ] **Bước 2: Chạy lưới để thấy nó ĐỎ**

Chạy: `npx vitest run server/db/workshopTangId.db.test.ts`
Kỳ vọng: ĐỎ ở bước biên dịch với thông báo kiểu `Property 'tangId' does not exist on type`.

- [ ] **Bước 3: Khai cột vào schema**

Trong `drizzle/schema/hierarchy.ts`, bảng `workshops`, thêm cột sau cột `factoryId`:

```ts
  /**
   * Tầng của xưởng trong lớp Twin 3D. Cột có từ migration 0350 (FK
   * fk_workshops_tang → twin_tang(id) ON DELETE SET NULL, index
   * idx_workshops_tang) nhưng trước 2026-09-15 KHÔNG được khai ở đây, nên mọi
   * truy vấn có kiểu đều mù với nó. Nullable: xưởng chưa gắn tầng là hợp lệ.
   *
   * ⚠ KHÔNG thêm .references() — bảng twin_tang nằm ở drizzle/schema/twin3d.ts
   * và khai chéo hai tệp sẽ tạo vòng tròn import. Ràng buộc đã có trong DB.
   */
  tangId: integer("tangId"),
```

- [ ] **Bước 4: Chạy lưới để thấy nó XANH**

Chạy: `npx vitest run server/db/workshopTangId.db.test.ts`
Kỳ vọng: 2 ca XANH.

- [ ] **Bước 5: Ablation**

Comment dòng `tangId: integer("tangId"),` vừa thêm, chạy lại lưới, kỳ vọng ĐỎ trở lại, rồi bỏ comment và chạy lại để chắc XANH.

- [ ] **Bước 6: Kiểm cổng nền và commit**

```bash
npm run check
npx vitest run phamVi
git add drizzle/schema/hierarchy.ts server/db/workshopTangId.db.test.ts
git commit -m "fix(schema): khai workshops.tangId vao Drizzle - cot co tu mig 0350 nhung ORM mu"
```

### Task 2: Ghi luật cấm `drizzle-kit push` và đóng băng `generate`

Thư mục `drizzle/meta/` dừng ở `0017_snapshot.json`, `_journal.json` chỉ có 18 mục, trong khi thư mục migration có 355 tệp `.sql` và cao nhất là `0356`. Lệch khoảng 338 migration. Hệ quả: `generate` sẽ diff với ảnh chụp cũ và sinh ra một migration khổng lồ dựng lại gần như toàn bộ schema; `push` so với cơ sở dữ liệu sống và sẽ gỡ mọi thứ không có trong schema, gồm cả các cột như `tangId` ở Task 1 nếu ai đó quên khai.

**Tệp:**
- Sửa: `docs/DEPLOYMENT_GUIDE.md` (thêm mục vào phần thao tác cơ sở dữ liệu)
- Tạo: `scripts/kiem-drizzle-meta.mjs`
- Lưới: chính script trên, chạy được trong cổng

- [ ] **Bước 1: Viết script đo độ lệch**

```js
#!/usr/bin/env node
// Đo độ lệch giữa chuỗi migration .sql và ảnh chụp trong drizzle/meta/.
// Lệch lớn nghĩa là `drizzle-kit generate` không dùng được và `push` nguy hiểm.
// Thoát 1 khi lệch vượt ngưỡng, để cắm vào cổng CI được.
import fs from "node:fs";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "..");
const soSql = fs
  .readdirSync(path.join(GOC, "drizzle"))
  .filter((t) => t.endsWith(".sql")).length;
const journal = JSON.parse(
  fs.readFileSync(path.join(GOC, "drizzle/meta/_journal.json"), "utf8"),
);
const soMeta = journal.entries.length;
const lech = soSql - soMeta;

console.log(`migration .sql: ${soSql}`);
console.log(`mục trong _journal.json: ${soMeta} (cuối: ${journal.entries.at(-1)?.tag})`);
console.log(`LỆCH: ${lech}`);

if (lech > 0) {
  console.log("");
  console.log("⛔ drizzle-kit KHÔNG dùng được trên repo này:");
  console.log("   · `generate` diff với ảnh chụp cũ hơn " + lech + " migration");
  console.log("     ⇒ sinh migration khổng lồ dựng lại gần như toàn schema.");
  console.log("   · `push` so với DB SỐNG và GỠ mọi cột không có trong schema.ts");
  console.log("     ⇒ mất dữ liệu. TUYỆT ĐỐI KHÔNG CHẠY.");
  console.log("   Viết migration bằng TAY, đánh số tiếp, chạy bằng owner `aoi`.");
  process.exit(1);
}
```

- [ ] **Bước 2: Chạy để thấy nó báo lệch**

Chạy: `node scripts/kiem-drizzle-meta.mjs`
Kỳ vọng: in `LỆCH: 337` (hoặc số tương đương tại thời điểm chạy) và thoát mã 1.

- [ ] **Bước 3: Ghi luật vào tài liệu triển khai**

Thêm vào `docs/DEPLOYMENT_GUIDE.md`, phần thao tác cơ sở dữ liệu:

```markdown
### ⛔ CẤM `drizzle-kit push` — và `generate` cũng không dùng được

Đo 2026-09-15: `drizzle/` có 355 tệp `.sql` (cao nhất `0356`), nhưng
`drizzle/meta/_journal.json` chỉ ghi 18 mục, ảnh chụp dừng ở `0017_snapshot.json`.
Lệch khoảng 338 migration.

- `drizzle-kit generate` so schema với **ảnh chụp**, không so với cơ sở dữ liệu
  sống ⇒ nó sẽ sinh một migration khổng lồ dựng lại gần như toàn bộ schema.
- `drizzle-kit push` so với **cơ sở dữ liệu sống** ⇒ nó GỠ mọi cột không có
  trong `schema.ts`. Repo này đang có ít nhất một cột như vậy từng tồn tại
  (`workshops.tangId`, đã khai lại 2026-09-15) và có thể còn nữa. **Mất dữ liệu.**

**Cách làm đúng:** viết migration bằng tay, đánh số tiếp, chạy bằng owner `aoi`
(xem `scripts/apply-migration-0350.mjs` làm mẫu). Kiểm độ lệch bất cứ lúc nào
bằng `node scripts/kiem-drizzle-meta.mjs`.

Muốn dùng lại `drizzle-kit`, phải rebase ảnh chụp trước — đó là một đợt riêng.
```

- [ ] **Bước 4: Commit**

```bash
git add scripts/kiem-drizzle-meta.mjs docs/DEPLOYMENT_GUIDE.md
git commit -m "docs(db): cam drizzle-kit push, generate dong bang - meta lech 338 migration"
```

---

## Giai đoạn 1 — An toàn dữ liệu còn lại (Task 3-4)

Đợt vá trước đã chặn được lối mất dữ liệu qua ô chọn tầng. Hai lối còn lại cùng lớp lỗi, khác cửa vào.

### Task 3: Chặn mất dữ liệu khi đổi tab trong Studio

Bộ tab của Studio gỡ nội dung tab không hoạt động khỏi cây, nên bấm sang tab khác khi còn thay đổi chưa lưu sẽ vứt buffer trong im lặng. Cùng lớp với lỗi đã vá cho ô chọn tầng, và cổng chặn đã có sẵn.

**Tệp:**
- Sửa: `client/src/pages/TwinStudio.tsx`
- Lưới: `client/src/components/twin3d/thiet-ke/chanDoiTang.dom.test.tsx` (thêm nhóm ca mới vào tệp đã có)

**Giao diện:**
- Tiêu thụ: `xinDoiNap`, `refChuaLuu`, `HopThoaiChuaLuu` — đã tồn tại từ đợt vá trước.
- Sản xuất: hàm `xinDoiTab(tabMoi: string): void` trong `TwinStudio.tsx`, cùng khuôn với `xinDoiNap`.

- [ ] **Bước 1: Viết lưới ĐỎ**

Thêm vào `chanDoiTang.dom.test.tsx`:

```tsx
describe("★★★ Đổi TAB khi còn thay đổi chưa lưu — cùng lớp lỗi với đổi tầng", () => {
  it("còn thay đổi chưa lưu ⇒ bấm tab khác PHẢI hỏi, KHÔNG đổi ngay", async () => {
    const man = dungManStudio({ soThayDoiChuaLuu: 1 });
    await man.bamTab("tab-con-duong-b");
    expect(man.hopThoaiHien()).toBe(true);
    expect(man.tabDangMo()).toBe("tab-thiet-ke");
  });

  it("không có thay đổi ⇒ đổi tab mượt, KHÔNG hỏi", async () => {
    const man = dungManStudio({ soThayDoiChuaLuu: 0 });
    await man.bamTab("tab-con-duong-b");
    expect(man.hopThoaiHien()).toBe(false);
    expect(man.tabDangMo()).toBe("tab-con-duong-b");
  });

  it("bấm 'Ở lại' ⇒ giữ tab cũ và giữ nguyên thay đổi", async () => {
    const man = dungManStudio({ soThayDoiChuaLuu: 2 });
    await man.bamTab("tab-con-duong-a");
    await man.bam("nut-huy-doi");
    expect(man.tabDangMo()).toBe("tab-thiet-ke");
    expect(man.soThayDoi()).toBe(2);
  });
});
```

Nếu `dungManStudio` trong tệp chưa có phương thức `bamTab`/`tabDangMo`, thêm chúng theo đúng khuôn các phương thức sẵn có trong tệp đó.

- [ ] **Bước 2: Chạy lưới, kỳ vọng ĐỎ**

Chạy: `npx vitest run client/src/components/twin3d/thiet-ke/chanDoiTang.dom.test.tsx`
Kỳ vọng: 3 ca mới ĐỎ; các ca cũ vẫn XANH.

- [ ] **Bước 3: Cho bộ tab đi qua cổng**

Trong `TwinStudio.tsx`, thêm cạnh `xinDoiNap`:

```tsx
  /**
   * Đổi TAB đi qua đúng cổng của đổi tầng. Bộ tab gỡ nội dung tab không hoạt
   * động khỏi cây, nên đổi tab cũng vứt buffer y như đổi tầng — cùng lớp lỗi,
   * khác cửa vào (đo được ở QA lần 11, mục V-14 số 1).
   */
  const xinDoiTab = useCallback(
    (tabMoi: string) => {
      const chuaLuu = refChuaLuu.current;
      if (!chuaLuu || chuaLuu.so === 0) {
        setTabDangMo(tabMoi);
        return;
      }
      setYDinh({ loai: "tab", tab: tabMoi });
    },
    [],
  );
```

Mở rộng kiểu `YDinhDoiNap` để mang thêm nhánh `{ loai: "tab"; tab: string }`, và trong `apDoiNap` xử lý nhánh đó bằng `setTabDangMo`. Nối `onValueChange={xinDoiTab}` vào thành phần `Tabs`.

- [ ] **Bước 4: Chạy lưới, kỳ vọng XANH**

Chạy: `npx vitest run client/src/components/twin3d/thiet-ke/chanDoiTang.dom.test.tsx`
Kỳ vọng: tất cả XANH.

- [ ] **Bước 5: Ablation**

Đổi `onValueChange={xinDoiTab}` về `onValueChange={setTabDangMo}`, chạy lại, kỳ vọng 3 ca ĐỎ, rồi hoàn nguyên.

- [ ] **Bước 6: Cổng nền và commit**

```bash
npx vitest run client/src/components/twin3d
npm run check
git add client/src/pages/TwinStudio.tsx client/src/components/twin3d/thiet-ke/chanDoiTang.dom.test.tsx
git commit -m "fix(studio): doi TAB cung phai qua cong chan mat du lieu (cung lop voi doi tang)"
```

### Task 4: Chặn rơi tầng im lặng khi danh sách tầng đổi

Một lượt nạp lại nền có thể làm tầng đang chọn biến mất khỏi danh sách; hàm phân giải khi đó rơi về tầng đầu mà không đi qua cổng hỏi, nên vẫn mất dữ liệu trong im lặng. Hiếm nhưng có thật.

**Tệp:**
- Sửa: `client/src/components/twin3d/thiet-ke/napStudio.ts`
- Sửa: `client/src/pages/TwinStudio.tsx`
- Lưới: `client/src/components/twin3d/thiet-ke/napStudio.unit.test.ts` (thêm ca)

**Giao diện:**
- Sản xuất: `giaiNapThietKe` trả thêm ô `tangBienMat: boolean` — `true` khi tầng người dùng đang chọn không còn trong danh sách mới.

- [ ] **Bước 1: Viết lưới ĐỎ**

```ts
it("tầng đang chọn biến mất khỏi danh sách ⇒ khai cờ, KHÔNG âm thầm rơi về tầng đầu", () => {
  const kq = giaiNapThietKe({
    yDinh: { nhaMayId: 41, toaNhaId: 65, tangId: 166 },
    nhaMay: [{ id: 41, ten: "Công ty A" }],
    toaNha: [{ id: 65, ma: "T1", ten: "Toà 1" }],
    tang: [{ id: 165, capSo: 1, ten: "Tầng 1" }],
  });
  expect(kq.tangBienMat).toBe(true);
  expect(kq.tangId).toBe(165);
});

it("tầng đang chọn còn trong danh sách ⇒ cờ tắt", () => {
  const kq = giaiNapThietKe({
    yDinh: { nhaMayId: 41, toaNhaId: 65, tangId: 165 },
    nhaMay: [{ id: 41, ten: "Công ty A" }],
    toaNha: [{ id: 65, ma: "T1", ten: "Toà 1" }],
    tang: [{ id: 165, capSo: 1, ten: "Tầng 1" }],
  });
  expect(kq.tangBienMat).toBe(false);
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ĐỎ**

Chạy: `npx vitest run client/src/components/twin3d/thiet-ke/napStudio.unit.test.ts`
Kỳ vọng: 2 ca mới ĐỎ với `tangBienMat` là `undefined`.

- [ ] **Bước 3: Thêm cờ vào hàm phân giải**

Trong `napStudio.ts`, hàm `giaiNapThietKe`, sau khi phân giải tầng:

```ts
  /**
   * `true` khi tầng người dùng ĐANG CHỌN không còn trong danh sách mới (một
   * lượt nạp lại nền, hoặc tầng bị xoá ở nơi khác). Trang phải cảnh báo thay vì
   * âm thầm rơi về tầng đầu — nếu buffer còn thay đổi chưa lưu thì rơi im lặng
   * chính là lối mất dữ liệu thứ ba (QA lần 11, V-14 số 2).
   */
  const tangBienMat =
    yDinh.tangId != null && !tang.some((t) => t.id === yDinh.tangId);
```

Thêm `tangBienMat` vào giá trị trả về.

- [ ] **Bước 4: Chạy, kỳ vọng XANH**

Chạy: `npx vitest run client/src/components/twin3d/thiet-ke/napStudio.unit.test.ts`

- [ ] **Bước 5: Nối cờ vào giao diện**

Trong `TwinStudio.tsx`, khi `tangBienMat` là `true` và buffer còn thay đổi chưa lưu, hiện một toast cảnh báo dùng đúng kit toast sẵn có trong trang, nội dung nói rõ tầng đang xem không còn và các thay đổi chưa lưu đã mất. Thêm khoá i18n mới vào cả ba tệp `client/src/i18n/locales/{en,vi,zh}.json` dưới nhánh `twin3d.studioUi`.

- [ ] **Bước 6: Ablation, cổng nền, commit**

Gỡ dòng tính `tangBienMat` (trả về `false` cứng), chạy lại lưới, kỳ vọng ĐỎ, hoàn nguyên.

```bash
npx vitest run client/src/components/twin3d
npm run check && npm run i18n:check
git add client/src/components/twin3d/thiet-ke/napStudio.ts client/src/components/twin3d/thiet-ke/napStudio.unit.test.ts client/src/pages/TwinStudio.tsx client/src/i18n/locales
git commit -m "fix(studio): canh bao khi tang dang chon bien mat, khong roi ve tang dau im lang"
```

---

## Giai đoạn 2 — Sự thật của con số (Task 5-8)

Bốn task này sửa cùng một lớp lỗi: con số hiển thị không thuộc phạm vi mà nhãn cạnh nó đang khai.

### Task 5: Mẫu số KPI theo đúng phạm vi đang xem

Bảng chỉ số in nhãn phạm vi tới cấp tầng (lấy từ breadcrumb) nhưng mẫu số và mọi ô đều tính trên cả nhà máy. Ở một tầng không có máy, cảnh vẽ 0 khối mà bảng vẫn nói "371 machines · Running 261". Chính chú thích tại chỗ truyền nhãn nói mục tiêu là chống lớp lỗi này.

**Tệp:**
- Sửa: `client/src/pages/TwinVanHanh.tsx:2011` (nguồn máy cho KPI)
- Lưới: `client/src/components/twin3d/van-hanh/kpiNoiLogic.unit.test.ts` (thêm ca)

**Giao diện:**
- Tiêu thụ: `tinhKpiNoi(may, chuaDo)` giữ nguyên chữ ký. Thay đổi nằm ở **đầu vào**: truyền tập máy của tầng đang xem thay vì của cả nhà máy.

- [ ] **Bước 1: Viết lưới ĐỎ**

```ts
it("★ mẫu số PHẢI bằng số máy được truyền vào, không phải tổng nhà máy", () => {
  const mayTang = [
    { id: 1, status: "running" as const, oeePercent: 80, andonActive: false, pdmRiskHigh: false },
    { id: 2, status: "idle" as const, oeePercent: null, andonActive: false, pdmRiskHigh: false },
  ];
  const kq = tinhKpiNoi(mayTang, false);
  expect(kq.mauSo).toBe(2);
});

it("★ tầng KHÔNG có máy ⇒ mẫu số 0 và mọi ô null, KHÔNG mượn số của nhà máy", () => {
  const kq = tinhKpiNoi([], false);
  expect(kq.mauSo).toBe(0);
  for (const o of kq.o) expect(o.giaTri).toBeNull();
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ca thứ nhất XANH và ca thứ hai XANH**

Chạy: `npx vitest run client/src/components/twin3d/van-hanh/kpiNoiLogic.unit.test.ts`

Hai ca này đo **hợp đồng của hàm**, và hàm vốn đã đúng. Chúng là lưới bảo vệ, không phải lưới bắt lỗi. Lỗi nằm ở **chỗ gọi**. Ghi lại kết quả rồi sang bước 3.

- [ ] **Bước 3: Viết lưới cho chỗ gọi**

Tạo `client/src/components/twin3d/van-hanh/nguonKpiTheoTang.unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { docMaNguon } from "@shared/testing/docMaNguon";

describe("★★★ Nguồn máy cho bảng KPI phải là máy của TẦNG đang xem", () => {
  const nguon = docMaNguon("client/src/pages/TwinVanHanh.tsx");

  it("tinhKpiNoi KHÔNG được nhận thẳng tập máy của cả nhà máy", () => {
    expect(nguon).not.toMatch(/tinhKpiNoi\(\s*mayKpi\s*,/);
  });

  it("tinhKpiNoi nhận tập đã lọc theo tầng", () => {
    expect(nguon).toMatch(/tinhKpiNoi\(\s*mayKpiTang\s*,/);
  });

  it("tập lọc theo tầng được dựng từ danh sách máy VẼ TRONG CẢNH", () => {
    expect(nguon).toMatch(/const mayKpiTang\s*=/);
  });
});
```

- [ ] **Bước 4: Chạy, kỳ vọng ĐỎ**

Chạy: `npx vitest run client/src/components/twin3d/van-hanh/nguonKpiTheoTang.unit.test.ts`
Kỳ vọng: 2 trong 3 ca ĐỎ.

- [ ] **Bước 5: Lọc nguồn máy theo tầng đang xem**

Trong `TwinVanHanh.tsx`, trước dòng 2011, thêm:

```tsx
  /**
   * ★★★ QA lần 11 PH-06 — MẪU SỐ PHẢI CÙNG PHẠM VI VỚI NHÃN.
   *
   * `mayKpi` đến từ `factoryCommand.overview`, tức tập của CẢ NHÀ MÁY. Nhưng
   * bảng KPI in nhãn phạm vi lấy từ breadcrumb, chạy tới cấp TẦNG. Ở một tầng
   * không có máy, cảnh vẽ 0 khối mà bảng vẫn nói "371 máy · Running 261" —
   * người xem đọc nhãn "Tầng" rồi đọc số của nhà máy.
   *
   * Tập đúng là tập máy CÓ CHỖ trên tầng đang xem, tức chính tập mà cảnh 3D vẽ.
   */
  const mayKpiTang = useMemo(() => {
    const idTrongCanh = new Set(mayVeTrongCanh.map((m) => m.id));
    return mayKpi.filter((m) => idTrongCanh.has(m.id));
  }, [mayKpi, mayVeTrongCanh]);
```

Thay `tinhKpiNoi(mayKpi, kpiChuaDo)` thành `tinhKpiNoi(mayKpiTang, kpiChuaDo)`.

Tên `mayVeTrongCanh` là biến đang giữ danh sách máy được vẽ trong cảnh ở tệp này. Người thực thi phải đọc tệp để lấy đúng tên biến đó, và nếu nó tên khác thì dùng tên thật.

- [ ] **Bước 6: Chạy hai lưới, kỳ vọng XANH**

```bash
npx vitest run client/src/components/twin3d/van-hanh/nguonKpiTheoTang.unit.test.ts
npx vitest run client/src/components/twin3d/van-hanh/kpiNoiLogic.unit.test.ts
```

- [ ] **Bước 7: Ablation và commit**

Đổi lại thành `tinhKpiNoi(mayKpi, kpiChuaDo)`, chạy lưới chỗ gọi, kỳ vọng ĐỎ, hoàn nguyên.

```bash
npx vitest run client/src/components/twin3d
npm run check
git add client/src/pages/TwinVanHanh.tsx client/src/components/twin3d/van-hanh/nguonKpiTheoTang.unit.test.ts client/src/components/twin3d/van-hanh/kpiNoiLogic.unit.test.ts
git commit -m "fix(twin3d): mau so KPI theo TANG dang xem, khong phai ca nha may (PH-06)"
```

### Task 6: Bảng KPI không được che lời khai trung thực của sản phẩm

Ba ảnh vai giám đốc cho thấy lớp phủ chỉ số đè lên banner "326 machines are outside this load" và lên cả hai dòng banner của phạm vi tập đoàn, cắt câu giải thích ở giữa. Sản phẩm nói thật về hạn chế của mình rồi tự che câu đó. Lưới hiện chỉ đo chồng lấn giữa nhãn và badge bên trong canvas, chưa đo cặp lớp phủ với banner.

**Tệp:**
- Sửa: `client/src/pages/TwinVanHanh.tsx` (vị trí neo của bảng KPI)
- Lưới: `client/src/components/twin3d/van-hanh/lopPhuKhongChe.dom.test.tsx` (tạo mới)

- [ ] **Bước 1: Viết lưới ĐỎ**

```tsx
describe("★★★ Lớp phủ KPI KHÔNG được che banner/thông báo của chính sản phẩm", () => {
  it("bbox bảng KPI không giao với bbox banner khi cả hai cùng hiện", () => {
    const man = dungManVanHanh({ coBanner: true, kpiMo: true });
    const kpi = man.bbox("bang-kpi-noi");
    const banner = man.bbox("banner-doi-soat");
    expect(dienTichGiao(kpi, banner)).toBe(0);
  });

  it("đối chứng: khi banner không hiện thì phép đo vẫn chạy và trả 0", () => {
    const man = dungManVanHanh({ coBanner: false, kpiMo: true });
    expect(man.coPhanTu("banner-doi-soat")).toBe(false);
  });
});
```

Hàm `dienTichGiao` lấy theo đúng khuôn đã dùng trong các lưới bbox sẵn có của thư mục này.

- [ ] **Bước 2: Chạy, kỳ vọng ca thứ nhất ĐỎ**

Chạy: `npx vitest run client/src/components/twin3d/van-hanh/lopPhuKhongChe.dom.test.tsx`

- [ ] **Bước 3: Đẩy bảng KPI xuống dưới banner khi banner hiện**

Trong `TwinVanHanh.tsx`, chỗ neo `BangKpiNoi` (`absolute left-2 top-2`), đổi `top` thành giá trị phụ thuộc việc banner có hiện hay không, ví dụ dùng lớp `top-2` khi không có banner và một giá trị lớn hơn chiều cao banner khi có. Đọc chiều cao thật của banner trong tệp trước khi chọn số.

- [ ] **Bước 4: Chạy, kỳ vọng XANH; rồi ablation và commit**

```bash
npx vitest run client/src/components/twin3d
npm run check
git add client/src/pages/TwinVanHanh.tsx client/src/components/twin3d/van-hanh/lopPhuKhongChe.dom.test.tsx
git commit -m "fix(twin3d): bang KPI thoi che banner trung thuc cua san pham (PH-31)"
```

### Task 7: Rút tiền tố mã máy trong danh sách

Ở bề rộng 1280, mã máy bị cắt còn phần tiền tố dùng chung nên mọi hàng đọc giống hệt nhau. Màn Chuyền đã có lời giải: in tiền tố một lần rồi rút phần còn lại. Hai hàm cần dùng đã tồn tại.

**Tệp:**
- Sửa: `client/src/components/twin3d/van-hanh/DanhSachMay.tsx:388-392`
- Lưới: `client/src/components/twin3d/van-hanh/danhSachMayMaNgan.unit.test.ts` (tạo mới)

**Giao diện:**
- Tiêu thụ: `tienToChung(ma: readonly string[]): string` và `rutTienTo(ma: string, tienTo: string): string` từ `./maNgan`.

- [ ] **Bước 1: Viết lưới ĐỎ**

```ts
import { describe, expect, it } from "vitest";
import { rutTienTo, tienToChung } from "./maNgan";

describe("★★★ Danh sách máy phải rút tiền tố như màn Chuyền", () => {
  const ma = [
    "QATD-A-T1-X1-L1-M01",
    "QATD-A-T1-X1-L1-M02",
    "QATD-A-T1-X1-L1-M03",
  ];

  it("tiền tố chung được nhận ra", () => {
    expect(tienToChung(ma)).toBe("QATD-A-T1-X1-L1-");
  });

  it("phần rút ra phân biệt được từng máy", () => {
    const tienTo = tienToChung(ma);
    const ngan = ma.map((m) => rutTienTo(m, tienTo));
    expect(new Set(ngan).size).toBe(ma.length);
    expect(ngan[0].length).toBeLessThanOrEqual(6);
  });

  it("một máy duy nhất ⇒ không rút (không có tiền tố chung có nghĩa)", () => {
    expect(tienToChung(["QATD-A-T1-X1-L1-M01"])).toBe("");
  });
});
```

- [ ] **Bước 2: Chạy để biết hợp đồng thật của hai hàm**

Chạy: `npx vitest run client/src/components/twin3d/van-hanh/danhSachMayMaNgan.unit.test.ts`
Nếu ca thứ ba đỏ vì hàm trả giá trị khác, sửa **lưới** cho khớp hành vi thật rồi ghi lại — đây là lưới học hợp đồng, không phải lưới áp đặt.

- [ ] **Bước 3: Áp vào danh sách**

Trong `DanhSachMay.tsx`, tính tiền tố chung một lần bằng `useMemo` trên tập máy đang hiển thị, in nó một lần ở đầu danh sách với testid `danh-sach-may-tien-to`, và render phần rút cho từng hàng. Giữ `title={m.ma}` để rê chuột vẫn thấy mã đầy đủ.

- [ ] **Bước 4: Thêm lưới đo chữ không bị cắt**

Thêm ca đo `scrollWidth <= clientWidth + 1` cho ô mã máy ở bề rộng 1280 trong lưới dom sẵn có của thành phần này.

- [ ] **Bước 5: Ablation, cổng nền, commit**

```bash
npx vitest run client/src/components/twin3d
npm run check
git add client/src/components/twin3d/van-hanh/DanhSachMay.tsx client/src/components/twin3d/van-hanh/danhSachMayMaNgan.unit.test.ts
git commit -m "fix(twin3d): rut tien to ma may trong danh sach - moi hang doc duoc rieng (PH-27)"
```

### Task 8: Dòng cảnh báo phải mang danh tính máy và công ty

Dòng trong dải cảnh báo chỉ in tiêu đề, nên 15 dòng đọc giống hệt nhau và câu hỏi "công ty nào tệ nhất hôm nay" không trả lời được. Kiểu dữ liệu đã có `machineId`, `lineId`, `workshopId` nhưng chưa có nhà máy và chưa có mã máy để hiển thị.

**Tệp:**
- Sửa: `client/src/components/twin3d/van-hanh/daiCanhBaoLogic.ts` (kiểu và hàm chuẩn hoá)
- Sửa: `client/src/components/twin3d/van-hanh/DaiCanhBao.tsx:137`
- Lưới: `client/src/components/twin3d/van-hanh/daiCanhBaoDanhTinh.unit.test.ts` (tạo mới)

**Giao diện:**
- Sản xuất: `CanhBaoDai` có thêm `maMay: string | null` và `tenNhaMay: string | null`.

- [ ] **Bước 1: Viết lưới ĐỎ**

```ts
it("★ mỗi dòng cảnh báo mang mã máy để phân biệt được", () => {
  const hang = chuanHoaHang(mauAndon({ id: 1, machineId: 4977 }), {
    maTheoMay: new Map([[4977, "QATD-C-T1-X1-L1-M05"]]),
    tenNhaMayTheoMay: new Map([[4977, "Công ty C"]]),
  });
  expect(hang.maMay).toBe("QATD-C-T1-X1-L1-M05");
  expect(hang.tenNhaMay).toBe("Công ty C");
});

it("★ cảnh báo không gắn máy ⇒ hai ô null, KHÔNG bịa", () => {
  const hang = chuanHoaHang(mauAndon({ id: 2, machineId: null }), {
    maTheoMay: new Map(),
    tenNhaMayTheoMay: new Map(),
  });
  expect(hang.maMay).toBeNull();
  expect(hang.tenNhaMay).toBeNull();
});

it("★ hai cảnh báo khác máy ⇒ hai dòng phân biệt được bằng chữ", () => {
  const a = chuanHoaHang(mauAndon({ id: 1, machineId: 1 }), banDo);
  const b = chuanHoaHang(mauAndon({ id: 2, machineId: 2 }), banDo);
  expect(a.maMay).not.toBe(b.maMay);
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ĐỎ**

- [ ] **Bước 3: Thêm hai ô vào kiểu và hàm chuẩn hoá**

Thêm vào `CanhBaoDai`:

```ts
  /**
   * Mã máy để người đọc phân biệt các dòng. QA lần 11 đo được 15 dòng cảnh báo
   * đọc giống hệt nhau vì chỉ có tiêu đề (PH-30). `null` khi cảnh báo không gắn
   * máy nào — KHÔNG bịa chuỗi rỗng.
   */
  maMay: string | null;
  /** Tên nhà máy, để vai nhìn nhiều công ty phân rã được theo công ty. */
  tenNhaMay: string | null;
```

Hàm chuẩn hoá nhận thêm hai bản đồ tra cứu và điền hai ô này.

- [ ] **Bước 4: Hiển thị**

Trong `DaiCanhBao.tsx`, dưới dòng tiêu đề, thêm một dòng phụ in `maMay` và `tenNhaMay` khi có, dùng cỡ chữ và màu của các chip phụ sẵn có trong tệp. Không thêm khoá i18n mới nếu chỉ hiển thị dữ liệu.

- [ ] **Bước 5: Ablation, cổng nền, commit**

```bash
npx vitest run client/src/components/twin3d
npm run check && npm run i18n:check
git add client/src/components/twin3d/van-hanh/daiCanhBaoLogic.ts client/src/components/twin3d/van-hanh/DaiCanhBao.tsx client/src/components/twin3d/van-hanh/daiCanhBaoDanhTinh.unit.test.ts
git commit -m "fix(twin3d): dong canh bao mang ma may va ten nha may (PH-30)"
```

---

## Giai đoạn 3 — Mã có mà chưa nối chỗ gọi (Task 9-12)

Bốn chỗ có mã, có ca kiểm đơn vị, nhưng không có đường nào tới người dùng.

### Task 9: Hành động báo bất thường cho công nhân

Bảng hành động khai đúng sáu hành động và không có hành động bật cảnh báo, trong khi máy chủ có sẵn hai thủ tục và khuôn quyền mặc định của vai vận hành đã cho phép tạo. Đây là việc thường xuyên nhất của công nhân mà màn không có.

**Tệp:**
- Sửa: `client/src/components/twin3d/van-hanh/nganXuLyLogic.ts`
- Sửa: `client/src/components/twin3d/van-hanh/NganXuLy.tsx`
- Lưới: `client/src/components/twin3d/van-hanh/nganXuLyLogic.unit.test.ts` (thêm ca)

**Giao diện:**
- Sản xuất: hành động `baoSuCo` trong bảng hành động, gác bằng quyền `andon` mức tạo, gọi thủ tục `andon.quickReport`.

- [ ] **Bước 1: Viết lưới ĐỎ**

```ts
it("★ vai có andon mức TẠO ⇒ thấy hành động báo sự cố", () => {
  const ds = hanhDongChoMay({ quyen: { andonTao: true }, machineId: 7 });
  expect(ds.map((h) => h.khoa)).toContain("baoSuCo");
});

it("★ vai KHÔNG có andon mức tạo ⇒ hành động bị ẨN, không phải disable", () => {
  const ds = hanhDongChoMay({ quyen: { andonTao: false }, machineId: 7 });
  expect(ds.map((h) => h.khoa)).not.toContain("baoSuCo");
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ĐỎ**

- [ ] **Bước 3: Thêm hành động vào bảng và nối thủ tục**

Thêm mục `baoSuCo` vào bảng hành động với `duocPhep` lấy từ quyền `andon` mức tạo, và trong `NganXuLy.tsx` render nút gọi `andon.quickReport` với `machineId` đang chọn. Thêm khoá i18n cho nhãn nút và thông báo thành công vào cả ba tệp ngôn ngữ.

- [ ] **Bước 4: Chạy lưới XANH, ablation, cổng nền, commit**

```bash
npx vitest run client/src/components/twin3d
npm run check && npm run i18n:check
git add client/src/components/twin3d/van-hanh/nganXuLyLogic.ts client/src/components/twin3d/van-hanh/NganXuLy.tsx client/src/components/twin3d/van-hanh/nganXuLyLogic.unit.test.ts client/src/i18n/locales
git commit -m "feat(twin3d): cong nhan bao su co ngay tren twin (PH-34)"
```

### Task 10: Ngăn xử lý hoạt động ngay trên màn nhà máy

Trên màn nhà máy, ngăn xử lý không render nút nào; nút chỉ xuất hiện ở màn máy. Với một tầng có 21 cảnh báo thì đó là 21 lần điều hướng đi về. Tài liệu đặt mục tiêu ngược lại: hành động ở ngăn bên phải, ngữ cảnh ở cảnh 3D bên trái.

**Tệp:**
- Sửa: `client/src/pages/TwinVanHanh.tsx` (chỗ dựng ngăn xử lý)
- Lưới: `client/src/components/twin3d/van-hanh/nganXuLyTrenManNhaMay.dom.test.tsx` (tạo mới)

- [ ] **Bước 1: Viết lưới ĐỎ**

```tsx
it("★ chọn một máy trên cảnh ⇒ ngăn xử lý render nút theo quyền", () => {
  const man = dungManVanHanh({ quyen: { andonSua: true }, mayDangChon: 7 });
  expect(man.nutTrongNgan()).toContain("nut-ack");
});

it("★ chưa chọn máy ⇒ ngăn hiện trạng thái chưa chọn, KHÔNG nút rỗng", () => {
  const man = dungManVanHanh({ quyen: { andonSua: true }, mayDangChon: null });
  expect(man.coPhanTu("ngan-chua-chon")).toBe(true);
  expect(man.nutTrongNgan()).toHaveLength(0);
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ca thứ nhất ĐỎ**

- [ ] **Bước 3: Truyền đủ ngữ cảnh cho ngăn xử lý**

Đọc chỗ dựng `NganXuLy` trong `TwinVanHanh.tsx` và truyền `machineId` của máy đang chọn cùng tập quyền, đúng như màn máy đang làm. Không nhân bản logic: dùng lại chính bảng hành động.

- [ ] **Bước 4: XANH, ablation, cổng nền, commit**

```bash
npx vitest run client/src/components/twin3d
npm run check
git add client/src/pages/TwinVanHanh.tsx client/src/components/twin3d/van-hanh/nganXuLyTrenManNhaMay.dom.test.tsx
git commit -m "fix(twin3d): ngan xu ly hoat dong ngay tren man nha may (PH-35)"
```

### Task 11: Nối hành động ghi chú và đích cấp nhà máy

Hành động ghi chú được khai trong bảng nhưng không vai nào thấy nút, kể cả quản trị. Nút mở chức năng có ba loại đích nhưng không chỗ gọi nào truyền loại khác ngoài cấp máy, nên quản đốc chọn nhà máy vẫn chỉ thấy năm đích cấp máy.

**Tệp:**
- Sửa: `client/src/components/twin3d/van-hanh/NganXuLy.tsx`
- Sửa: `client/src/pages/TwinVanHanh.tsx` (truyền loại đích theo cấp đang chọn)
- Lưới: `client/src/components/twin3d/van-hanh/nganXuLyLogic.unit.test.ts` (thêm ca)

- [ ] **Bước 1: Viết lưới ĐỎ**

```ts
it("★ chọn cấp NHÀ MÁY ⇒ đích gồm bảng điều khiển tập đoàn và OEE", () => {
  const ds = nutDieuHuongCho("factory", 41);
  const duong = ds.map((n) => n.duong);
  expect(duong.some((d) => d.startsWith("/corporate-dashboard"))).toBe(true);
  expect(duong.some((d) => d.startsWith("/oee-dashboard"))).toBe(true);
});

it("★ chọn cấp MÁY ⇒ giữ nguyên tập đích cũ (không hồi quy)", () => {
  const ds = nutDieuHuongCho("machine", 7);
  expect(ds.length).toBeGreaterThan(0);
  expect(ds.every((n) => n.duong.includes("7"))).toBe(true);
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ca thứ nhất ĐỎ nếu chưa có chỗ gọi**

- [ ] **Bước 3: Truyền loại đích thật và render nút ghi chú**

Trong `TwinVanHanh.tsx`, truyền `loaiDich` theo cấp đang chọn thay vì để mặc định. Trong `NganXuLy.tsx`, render nút ghi chú theo đúng mục đã khai trong bảng hành động.

- [ ] **Bước 4: XANH, ablation, cổng nền, commit**

```bash
npx vitest run client/src/components/twin3d
npm run check
git add client/src/components/twin3d/van-hanh/NganXuLy.tsx client/src/pages/TwinVanHanh.tsx client/src/components/twin3d/van-hanh/nganXuLyLogic.unit.test.ts
git commit -m "fix(twin3d): noi hanh dong ghi chu va dich cap nha may/chuyen (PH-16, PH-17)"
```

### Task 12: Bảng xếp hạng sức khoẻ và bộ đếm để đo được lớp phủ màu

Hàm xếp hạng sức khoẻ tồn tại và có ca kiểm đơn vị nhưng không chỗ gọi nào trong mã sản phẩm, trong khi lớp phủ màu đã giao. Và không có bộ đếm cho vòng sức khoẻ nên suốt 11 đợt chưa ai đo được lớp phủ ấy: đọc điểm ảnh bị cấm vì bộ đệm vẽ không được giữ.

**Tệp:**
- Sửa: `client/src/components/twin3d/loi/KhungCanh.tsx` (thêm bộ đếm)
- Sửa: `client/src/pages/TwinVanHanh.tsx` (bảng xếp hạng)
- Lưới: `client/src/components/twin3d/van-hanh/vienSucKhoeDoDuoc.dom.test.tsx` (tạo mới)

**Giao diện:**
- Sản xuất: `window.__demVien` mang `{ tong: number; theoHang: Record<string, number> }`, chỉ bật ở chế độ đo giống các bộ đếm sẵn có.

- [ ] **Bước 1: Viết lưới ĐỎ**

```tsx
it("★ bộ đếm vòng sức khoẻ khai đúng số vòng đã vẽ", () => {
  const man = dungCanh({ may: [hangNguyKich(), hangCanh(), hangKhoe()] });
  expect(window.__demVien?.tong).toBe(3);
  expect(window.__demVien?.theoHang.nguy_kich).toBe(1);
});

it("★ không máy nào ⇒ bộ đếm là 0, KHÔNG undefined (tập rỗng phải nói được)", () => {
  const man = dungCanh({ may: [] });
  expect(window.__demVien?.tong).toBe(0);
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ĐỎ với `__demVien` là `undefined`**

- [ ] **Bước 3: Thêm bộ đếm theo đúng khuôn các bộ đếm sẵn có**

Trong `KhungCanh.tsx`, khai `__demVien` cạnh `__demNhan` và `__demBadge`, chỉ bật khi ở chế độ đo. Cập nhật mỗi khi lớp vòng dựng lại.

- [ ] **Bước 4: Nối hàm xếp hạng vào một bảng đọc được**

Thêm một bảng nhỏ trong bảng trái liệt kê số máy theo từng hạng sức khoẻ, dùng `xepHangSucKhoe` đã có. Thêm khoá i18n cho tiêu đề bảng và tên các hạng vào cả ba tệp ngôn ngữ.

- [ ] **Bước 5: XANH, ablation, cổng nền, commit**

```bash
npx vitest run client/src/components/twin3d
npm run check && npm run i18n:check
git add client/src/components/twin3d/loi/KhungCanh.tsx client/src/pages/TwinVanHanh.tsx client/src/components/twin3d/van-hanh/vienSucKhoeDoDuoc.dom.test.tsx client/src/i18n/locales
git commit -m "feat(twin3d): bang xep hang suc khoe + bo dem vien de do duoc lop phu mau (PH-28)"
```

---

## Giai đoạn 4 — Bảo mật nhỏ (Task 13-14)

### Task 13: Cổng quyền cho danh sách nhà máy

Người không có hàng quyền nào vẫn nhận về danh sách nhà máy mình được gán, trong khi mọi cổng khác trả về từ chối. Rò tên và mã nhà máy, không rò máy.

**Tệp:**
- Sửa: `server/routers/hierarchyRouters.ts:157-159`
- Lưới: `server/routers/factoryListCongQuyen.db.test.ts` (tạo mới)

- [ ] **Bước 1: Viết lưới ĐỎ**

```ts
it("★ vai 0 quyền ⇒ factory.list bị chặn", async () => {
  const ctx = ctxCuaVai("khong_quyen");
  await expect(goi(ctx, "factory.list")).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("★ đối chứng dương: vai có quyền xem máy ⇒ vẫn nhận đúng tập được gán", async () => {
  const ctx = ctxCuaVai("co_quyen_1_nha_may");
  const ds = await goi(ctx, "factory.list");
  expect(ds).toHaveLength(1);
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ca thứ nhất ĐỎ**

- [ ] **Bước 3: Thêm cổng quyền**

Thêm `requirePermission("machine_status", "canView")` vào `factory.list`, cùng khoá mà màn twin vốn đã đòi, để không thu hẹp ai đang dùng được.

- [ ] **Bước 4: XANH, ablation, cổng nền, commit**

```bash
npx vitest run phamVi
npx vitest run server/routers/factoryListCongQuyen.db.test.ts
npm run check
git add server/routers/hierarchyRouters.ts server/routers/factoryListCongQuyen.db.test.ts
git commit -m "fix(rbac): factory.list them cong quyen - vai 0 quyen khong con doc duoc ten nha may (PH-03)"
```

### Task 14: Gỡ khoá API mặc định khỏi tệp thử tải ảnh

Tệp thử nằm trong thư mục công khai nên được phục vụ ở đường dẫn gốc, mang sẵn một khoá dài 52 ký tự trong thuộc tính giá trị. Trên môi trường phát triển đó là khoá chết, đã đối chiếu 55 hàng khoá và không hàng nào khớp. Môi trường sản xuất chưa đo.

**Tệp:**
- Sửa: `client/public/aoi-upload-test-client.html`
- Lưới: `server/api/khongLoKhoaTrongTepCong.test.ts` (tạo mới)

- [ ] **Bước 1: Viết lưới ĐỎ**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("★★★ Tệp trong thư mục công khai KHÔNG được mang khoá API", () => {
  const thuMuc = path.resolve(import.meta.dirname, "../../client/public");

  it("không tệp nào chứa chuỗi giống khoá API", () => {
    const viPham: string[] = [];
    for (const ten of fs.readdirSync(thuMuc)) {
      const noiDung = fs.readFileSync(path.join(thuMuc, ten), "utf8");
      if (/\b(avi|sk)_[0-9a-f]{32,}\b/.test(noiDung)) viPham.push(ten);
    }
    expect(viPham).toEqual([]);
  });
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ĐỎ với tên tệp thử trong danh sách**

- [ ] **Bước 3: Bỏ giá trị mặc định**

Đổi thuộc tính giá trị của ô nhập khoá thành rỗng, giữ phần gợi ý để người thử biết dán khoá của mình vào.

- [ ] **Bước 4: XANH và commit**

```bash
npx vitest run server/api/khongLoKhoaTrongTepCong.test.ts
git add client/public/aoi-upload-test-client.html server/api/khongLoKhoaTrongTepCong.test.ts
git commit -m "fix(security): go khoa API mac dinh khoi tep thu trong thu muc cong khai (PH-01)"
```

- [ ] **Bước 5: Báo chủ dự án**

Khoá này chết trên môi trường phát triển nhưng **chưa đo trên môi trường sản xuất**. Nếu nó từng sống ở đó thì phải xoay khoá. Đây là việc của người có quyền truy cập môi trường sản xuất, không làm được từ đây.

---

## Giai đoạn 5 — Nghiệm thu lại toàn phần (Task 15)

### Task 15: Chạy lại đúng bộ đo của QA lần 11

Mọi task trên đều đo ở mức lưới. Task này đo kết cục người dùng trên dữ liệu quy mô tập đoàn, đúng bộ đo đã bắt ra 15 khuyết tật.

**Tệp:** không sửa mã. Dùng lại hạ tầng trong `.qa-tapdoan/`.

- [ ] **Bước 1: Dựng lại môi trường đo**

```bash
node .qa-tapdoan/sinh-tap-doan.mjs --kho
node .qa-tapdoan/sinh-tap-doan.mjs --ghi
node .qa-tapdoan/tai-khoan.mjs tao
sh .qa-tapdoan/nhip.sh &
```

Cầu chì phải đạt 32 trên 32. Ghi lại các mã định danh mới vì bộ sinh cấp mã mới mỗi lần.

- [ ] **Bước 2: Dựng bản đo riêng, đường tuyệt đối**

```bash
T=/d/SOURCES/avi-aoi-management/.qa-tapdoan/dist-hoanthien
rm -rf "$T" && mkdir -p "$T"
NODE_ENV=production npx vite build --outDir "$T/public" --emptyOutDir
npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir="$T"
cp server/license/sdk/index.cjs "$T/index.cjs"
node scripts/copy-font-assets.mjs --dest "$T/assets/fonts"
(cd "$T" && find . -type f \( -path './public/*' -o -name 'index.js' -o -name 'index.cjs' \) | sort | xargs md5sum) > .qa-tapdoan/md5-dist-hoanthien.txt
```

Xác minh bản dựng mang các bản vá bằng cách tìm trong gói: `danh-sach-may-tien-to`, `baoSuCo`, `__demVien`.

- [ ] **Bước 3: Bật máy chủ đo trên cổng riêng**

```bash
sh .qa-tapdoan/server.sh start hoanthien
```

- [ ] **Bước 4: Chạy lại từng ca đã sai**

Chạy lại các lô đã dựng sẵn trong `.qa-tapdoan/`, đối chiếu với `BANG-AB.md`, `BANG-C.md`, `BANG-DE.md`, `BANG-F.md`. Mỗi ca từng SAI phải chuyển ĐẠT, mỗi ca CHẶN-ĐÚNG phải giữ nguyên.

- [ ] **Bước 4b: Đo lại chiều cao khối tổng quan ở bảng trái — hằng đang lạc thực tế**

Task 12 thêm bảng xếp hạng sức khoẻ vào khối tổng quan. Lưới mô hình bố cục (`boCucPanelTrai.unit.test.ts`) dùng **số viết tay** chứ không đo DOM, nên nó vẫn xanh trong khi mô hình đã sai. Ước lượng chưa đo: khối cao thêm khoảng 28 điểm ảnh, tức hằng thật khoảng 69 thay vì 41.

Mở `/twin` ở **1280×720** và **1600×900**, đọc `getBoundingClientRect().height` của `khoi-tong-quan`, rồi:
- cập nhật hằng trong lưới kèm **ngày đo** và gỡ khối cảnh báo đã cắm ở đó;
- đếm số hàng thật của nhóm tồn đọng và của danh sách máy ở cả hai bề rộng, so với mô hình (mô hình dự đoán tồn đọng 3 → 2 ở 1280, danh sách máy 9 → 8 ở 1600);
- chỉ khi có số thật mới quyết được có cần cân lại tỉ lệ 7 trên 5 và trần 328 điểm ảnh hay không. Hai con số ấy là quyết định của các đợt trước, **không đổi khi chưa có phép đo**.

- [ ] **Bước 5: Chạy lại suite đầu cuối**

```bash
PLAYWRIGHT_BASE_URL=http://localhost:<cổng> npx playwright test --project=chromium-canh-3d
PLAYWRIGHT_BASE_URL=http://localhost:<cổng> npx playwright test --project=chromium e2e/twin-
```

Vòng đầu tiên của QA lần 11 cho 79 cộng 5 ca đạt và 8 ca đỏ, trong đó một là nợ đã biết. Bảy ca còn lại chưa phân xử được là hồi quy thật hay lệch tiền đề dữ liệu; task này phải phân xử dứt điểm từng ca.

- [ ] **Bước 6: Dọn và báo cáo**

```bash
touch .qa-tapdoan/NHIP-DUNG
sh .qa-tapdoan/server.sh stop
node .qa-tapdoan/sinh-tap-doan.mjs --go
node .qa-tapdoan/tai-khoan.mjs xoa
```

Viết báo cáo vào `docs/superpowers/specs/` theo đúng khuôn của QA lần 11, và cập nhật trang báo cáo đã publish.

---

### Task 16: Đo ba món chưa ai đo, trước khi quyết có vá hay không

Ba món dưới đây là **giả thuyết chưa đo**, không phải lỗi đã xác nhận. Vá trước khi đo là vá mù. Task này chỉ đo và kết luận; nếu ra lỗi thì mở task vá riêng.

**Tệp:** không sửa mã. Harness đặt trong `.qa-tapdoan/`, chạy trên môi trường đã dựng ở Task 15 bước 1 đến 3.

- [ ] **Bước 1: Đo nhánh ghi hỏng của "Lưu rồi chuyển"**

Bản vá chống mất dữ liệu có một nhánh chưa đo sống: khi máy chủ từ chối lượt ghi, hộp thoại phải đứng lại và tầng phải giữ nguyên. Dựng ca này bằng cách chặn lượt gọi ghi ở tầng mạng của trình duyệt và trả về mã lỗi:

```js
await page.route("**/api/trpc/twinCanh.luuHangLoat*", (r) =>
  r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { json: { message: "ép lỗi để đo" } } }) }),
);
```

Kỳ vọng: hộp thoại **vẫn mở**, ô chọn tầng **chưa đổi**, số thay đổi chưa lưu **giữ nguyên**, và có thông báo lỗi đọc được. Nếu tầng đổi mà dữ liệu không được ghi thì đó là lỗi mất dữ liệu, mở task vá ngay.

- [ ] **Bước 2: Đo buffer nhiều hàng và thay đổi kiểu kéo dời**

Mọi ca đã đo đều dùng đúng một thay đổi cùng loại là lật khoá. Dựng ca có **ba hàng** thay đổi thuộc **hai loại khác nhau** (lật khoá và dời vị trí), rồi lặp lại đúng ba lối: ở lại, bỏ thay đổi, lưu rồi chuyển. Với lối lưu rồi chuyển, kiểm bằng cơ sở dữ liệu rằng **cả ba hàng** được ghi và đều mang mã tầng cũ.

- [ ] **Bước 3: Đo chuyền trải hai toà nhà**

Hàm chọn nơi của thực thể chọn toà giữ **đa số** hàng đặt chỗ. Nếu một chuyền có máy nằm ở hai toà thì toà thiểu số sẽ không được vẽ. Trước hết đo xem ca đó có tồn tại không:

```sql
SELECT l.id, l.code, COUNT(DISTINCT tn.id) AS so_toa
FROM production_lines l
JOIN stations s ON s."lineId" = l.id
JOIN machines m ON m."stationId" = s.id
JOIN twin_dat_cho d ON d."loaiThucThe" = 'machine' AND d."thucTheId" = m.id
JOIN twin_tang t ON t.id = d."tangId"
JOIN twin_toa_nha tn ON tn.id = t."toaNhaId"
GROUP BY l.id, l.code
HAVING COUNT(DISTINCT tn.id) > 1;
```

Nếu truy vấn trả 0 hàng: ghi **N/A kèm chính câu truy vấn** làm bằng chứng, và ghi rằng bộ sinh dữ liệu hiện không dựng được ca này. Nếu trả hàng: mở chuyền đó và đếm khối trong cảnh so với số máy trong cơ sở dữ liệu; thiếu khối thì đó là lỗi đã xác nhận.

- [ ] **Bước 4: Đo hai chỉ số rủi ro ngược nhau trên màn máy**

Ảnh đo được cho thấy một chip nói tình trạng nguy kịch trong khi ô cạnh nó nói rủi ro hỏng bằng không, cách nhau khoảng 300 điểm ảnh. Giả thuyết của chủ dự án: **lỗi dữ liệu sinh ngẫu nhiên**, không phải lỗi mã. Đo để phân xử.

Truy vấn hai nguồn cho cùng một máy và so:

```sql
SELECT m.id, m.code,
       (SELECT h."healthScore" FROM machine_health_history h
         WHERE h."machineId" = m.id ORDER BY h."createdAt" DESC LIMIT 1) AS suc_khoe,
       (SELECT COUNT(*) FROM predictive_alerts p
         WHERE p."machineId" = m.id AND p."resolvedAt" IS NULL) AS canh_bao_pdm
FROM machines m
WHERE m.code LIKE 'QATD-%'
ORDER BY suc_khoe ASC NULLS LAST
LIMIT 20;
```

Ba kết cục có thể, mỗi kết cục một hành động khác nhau:
- **Hai nguồn khớp nhau trong cơ sở dữ liệu nhưng màn hiển thị lệch** ⇒ lỗi mã, mở task vá.
- **Hai nguồn lệch nhau ngay trong cơ sở dữ liệu** ⇒ đúng giả thuyết của chủ dự án: bộ sinh dữ liệu đặt điểm sức khoẻ và cảnh báo dự đoán **độc lập** nên chúng mâu thuẫn. Sửa bộ sinh trong `.qa-tapdoan/sinh-tap-doan.mjs` để hai đại lượng cùng một nguồn ngẫu nhiên, rồi sinh lại và đo lại.
- **Một trong hai nguồn rỗng** ⇒ màn đang hiển thị giá trị mặc định thay vì nói không biết; ghi thành lỗi riêng.

Ghi rõ kết cục nào xảy ra kèm số liệu, đừng kết luận trước khi truy vấn.

- [ ] **Bước 5: Ghi kết quả**

Ghi ba kết quả vào `.qa-tapdoan/PHAT-HIEN.md` theo đúng khuôn các mục sẵn có, mỗi mục nêu rõ đo được gì, phán quyết, và một câu vì sao. Món nào ra lỗi thì mở task vá riêng với bằng chứng kèm theo; món nào ra N/A thì ghi rõ điều kiện để đo lại được.

---

## Giai đoạn 6 — Mở rộng cảnh cho nhiều nhà máy (Task 17-19)

Chủ dự án chốt: **thiết kế để mở rộng thêm**. Hiện phạm vi tập đoàn không gộp được nhiều nhà máy vì thủ tục dựng cảnh nhận đúng một mã nhà máy; sản phẩm khai thẳng hạn chế bằng banner nên không nói dối, nhưng vai giám đốc vì thế chưa dùng được.

### Task 17: Viết thiết kế trước khi chạm mã

Đây là thay đổi hợp đồng dữ liệu, không phải một bản vá. Chạm mã trước khi có thiết kế là cách chắc chắn nhất để phải làm lại.

**Tệp:**
- Tạo: `docs/superpowers/specs/2026-09-16-twin-canh-nhieu-nha-may.md`

- [ ] **Bước 1: Đo hiện trạng hợp đồng**

Đọc và ghi lại chính xác, kèm số dòng: `server/routers/twinCanhRouter.ts:1003-1060` (thủ tục dựng cảnh, đầu vào nhận một mã nhà máy và tối đa 50 mã tầng), `server/db/twinCanh.ts:962` (cây phân cấp nhận một mã nhà máy, ngoài phạm vi trả cây rỗng), `server/db/twinCanh.ts:917` (đặt chỗ theo danh sách tầng, lọc từng tầng qua phạm vi), và `client/src/components/twin3d/van-hanh/boChonNap.ts` (hàm hạ cấp phạm vi tập đoàn xuống nhà máy). Ghi rõ chỗ nào đang chặn việc gộp.

- [ ] **Bước 2: Đo chi phí thật trước khi thiết kế**

Với dữ liệu đợt đo: một nhà máy có 371 đến 409 máy, ba nhà máy là 1.108. Đo thời gian và kích thước phản hồi của thủ tục dựng cảnh cho một nhà máy, rồi ước lượng cho ba. Nếu một nhà máy đã tốn 500 mili giây thì ba nhà máy trong một lượt gọi là một quyết định khác hẳn với việc ba lượt gọi song song. **Đo trước, thiết kế sau.**

- [ ] **Bước 3: Viết thiết kế với ít nhất hai phương án và một khuyến nghị**

Thiết kế phải trả lời được, mỗi câu kèm bằng chứng đo được:
- Gộp ở đâu: mở rộng đầu vào thành danh sách mã nhà máy, hay giữ nguyên thủ tục và để phía trình duyệt gọi song song rồi ghép.
- Hàng rào phạm vi giữ thế nào khi có nhiều mã: hiện mỗi mã được lọc riêng; với danh sách thì phải lọc từng mã và **im lặng bỏ mã ngoài phạm vi**, không được để một mã hợp lệ kéo theo cả danh sách.
- Toạ độ: mỗi nhà máy có hệ toạ độ riêng gốc ở không. Gộp ba nhà máy vào một cảnh cần một phép dời chỗ, và phải quyết định dời theo lưới cố định hay theo vị trí địa lý thật nếu có.
- Trần an toàn: giới hạn số nhà máy một lượt, và hành vi khi vượt trần.
- Cách đo nghiệm thu: phép đo nào chứng minh cảnh có đủ ba khối nhà máy, và phép đo nào chứng minh người chỉ được gán một nhà máy vẫn chỉ thấy một.

- [ ] **Bước 4: Trình chủ dự án chọn phương án**

Không tự chọn. Thiết kế nêu khuyến nghị kèm lý do, chủ dự án chốt, rồi mới sang Task 18.

### Task 17b: Vá cổng phạm vi — chủ dự án chốt làm TRƯỚC Task 18

**Chủ dự án quyết 2026-09-15:** vá cổng trước, giữ nguyên đầu vào một nhà máy; nới danh sách để lượt sau. Lý do: phần lợi lớn nhất rơi **ngoài** việc gộp — màn một nhà máy của vai thường đi từ 207 câu truy vấn xuống khoảng 9, cho **mọi** người dùng không phải quản trị.

Thiết kế đã đo: `traDatChoTheoTang(N)` sinh `4N+1` câu khi có phạm vi (84 tầng ra 337 câu, khớp tuyệt đối), `traVungAnToan(N)` sinh `3N+2` (84 tầng ra 254 câu **dù trả về 0 hàng**). Cổng phân giải lại phạm vi cho **từng tầng** thay vì gộp một lần. Ablation cổng gộp đã chạy thật: 10 câu, 25 mili giây, và trả về **kết quả giống hệt** đường sản phẩm, không rò dữ liệu nhà máy ngoài phạm vi.

**Tệp:**
- Sửa: `server/db/twinCanh.ts` (`traDatChoTheoTang`, `traVungAnToan`)
- Lưới: `server/db/congPhamViGop.db.test.ts` (tạo mới)

- [ ] **Bước 1: Viết lưới đo SỐ CÂU TRUY VẤN, không chỉ đo kết quả**

Dùng bộ đếm của chính sản phẩm (`queryMonitor.getQueryStats`) như thiết kế đã làm. Lưới phải có: ca đếm câu cho 1 tầng, ca cho 84 tầng, và **ca đối chứng biết kêu** (gỡ bản vá thì số câu phải vọt lên lại). Kèm ca kết quả: tập đặt chỗ trả về phải **giống hệt** trước và sau.

- [ ] **Bước 2: Chạy, ghi số câu trước khi vá**

Kỳ vọng khớp công thức `4N+1` và `3N+2`.

- [ ] **Bước 3: Gộp phép phân giải phạm vi một lần cho cả danh sách tầng**

Lọc tầng qua phép nối tới bảng toà nhà, **không** qua danh sách mã nhà máy do phía gọi truyền xuống. Đây là điều kiện để cổng tầng đứng độc lập.

- [ ] **Bước 4: Chạy lại, kỳ vọng số câu giảm mạnh và kết quả không đổi**

- [ ] **Bước 5: Ablation và đối chứng âm**

Gỡ bản vá, số câu phải vọt lại. Và với vai chỉ được gán một nhà máy, kết quả phải **vẫn chỉ có nhà máy đó**, không rò tên nhà máy khác.

- [ ] **Bước 6: Cổng nền và commit**

```bash
npx vitest run phamVi
npx vitest run server/db/congPhamViGop.db.test.ts
npm run check
```

### Task 17c: Hai lỗi đang tồn tại — chủ dự án chốt vá trong giai đoạn này

**Lỗi một: màn vận hành cắt im lặng 34 trong 84 tầng.** `client/src/pages/TwinVanHanh.tsx:650` có `.slice(0, 50)` trên danh sách mã tầng gửi lên. Với toà 7 tầng và nhiều toà thì danh sách vượt 50 và phần dư bị bỏ **không báo gì**. Vá: hoặc nâng trần theo đúng giới hạn thật của thủ tục, hoặc giữ trần nhưng **nói ra** khi cắt. Lưới phải có ca danh sách vượt trần và kỳ vọng người dùng đọc được điều đó.

**Lỗi hai: phép dựng cảnh chưa bao giờ cộng toạ độ toà nhà.** `client/src/components/twin3d/van-hanh/hopNhatCanh.ts:191` đưa thẳng toạ độ đặt chỗ vào cảnh, không cộng gốc của toà. Hai toà của **cùng một nhà máy** vì thế sẽ chồng lên nhau; chưa lộ vì cảnh chỉ lọc một tầng. Vá trước khi gộp nhiều nhà máy, nếu không thì lỗi này sẽ bị đổ nhầm cho việc gộp. ⚠ Dữ liệu thử đã nướng sẵn một khoảng dời một kilômét cho mỗi nhà máy vào toạ độ toà, nhưng dữ liệu cũ thì ở gốc toạ độ — nên đó là quyết định của **bộ sinh**, không phải luật của hệ thống. Một lưới dời chỗ cố định chồng lên nó sẽ cộng hai lần. Lưới phải có ca hai toà và kỳ vọng chúng **không** giao nhau.

### Task 18: Mở rộng hợp đồng phía máy chủ

Chỉ làm sau khi Task 17 được chốt. Nếu thiết kế chọn phương án gọi song song ở trình duyệt thì **bỏ hẳn task này** và ghi rõ lý do.

**Tệp:**
- Sửa: `server/routers/twinCanhRouter.ts` (đầu vào thủ tục dựng cảnh)
- Sửa: `server/db/twinCanh.ts` (cây phân cấp nhận danh sách)
- Lưới: `server/routers/canhNhieuNhaMayPhamVi.db.test.ts` (tạo mới)

**Giao diện:**
- Sản xuất: đầu vào nhận thêm trường danh sách mã nhà máy, giữ nguyên trường một mã cũ để không phá chỗ gọi hiện có.

- [ ] **Bước 1: Viết lưới phạm vi trước, đây là phần dễ sai nhất**

```ts
it("★ danh sách nhà máy ⇒ chỉ trả nhà máy TRONG phạm vi, im lặng bỏ phần ngoài", async () => {
  const ctx = ctxCuaVai("gan_mot_nha_may_A");
  const kq = await goi(ctx, "twinCanh.canhThietKe", { factoryIds: [idA, idB] });
  // ⚠ `machines` KHÔNG có cột nhà máy. Chuỗi thật: máy → trạm → chuyền → xưởng → nhà máy.
  // Đối chiếu bằng mã máy (tiền tố mang mã nhà máy) hoặc bằng tập id lấy từ truy vấn riêng.
  expect(kq.cay.may.every((m) => m.code.startsWith("QATD-A-"))).toBe(true);
  expect(kq.cay.may.length).toBeGreaterThan(0);
});

it("★ mọi mã đều ngoài phạm vi ⇒ cây rỗng, KHÔNG lỗi và KHÔNG rò tên", async () => {
  const ctx = ctxCuaVai("gan_mot_nha_may_A");
  const kq = await goi(ctx, "twinCanh.canhThietKe", { factoryIds: [idB, idC] });
  expect(kq.cay.may).toHaveLength(0);
  expect(JSON.stringify(kq)).not.toContain("QATD-B");
});

it("★ đối chứng dương: admin xin ba nhà máy ⇒ nhận đủ ba", async () => {
  const ctx = ctxCuaVai("admin");
  const kq = await goi(ctx, "twinCanh.canhThietKe", { factoryIds: [idA, idB, idC] });
  expect(new Set(kq.cay.may.map((m) => m.factoryId)).size).toBe(3);
});

it("★ vượt trần ⇒ từ chối rõ ràng, không cắt im lặng", async () => {
  const ctx = ctxCuaVai("admin");
  await expect(
    goi(ctx, "twinCanh.canhThietKe", { factoryIds: Array.from({ length: 20 }, (_, i) => i + 1) }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ĐỎ toàn bộ**

- [ ] **Bước 3: Mở rộng theo đúng phương án đã chốt, giữ nguyên đường một nhà máy**

- [ ] **Bước 4: XANH, ablation gỡ bộ lọc phạm vi để thấy ca thứ nhất và thứ hai ĐỎ lại, hoàn nguyên**

- [ ] **Bước 5: Cổng nền và commit**

```bash
npx vitest run phamVi
npx vitest run server/routers/canhNhieuNhaMayPhamVi.db.test.ts
npm run check
git add server/routers/twinCanhRouter.ts server/db/twinCanh.ts server/routers/canhNhieuNhaMayPhamVi.db.test.ts
git commit -m "feat(twin3d): canhThietKe nhan danh sach nha may, loc pham vi tung ma"
```

### Task 19: Cảnh tập đoàn ở phía trình duyệt

**Tệp:**
- Sửa: `client/src/components/twin3d/van-hanh/boChonNap.ts` (thôi hạ cấp phạm vi tập đoàn)
- Sửa: `client/src/pages/TwinVanHanh.tsx`
- Lưới: `client/src/components/twin3d/van-hanh/canhTapDoan.unit.test.ts` (tạo mới)

- [ ] **Bước 1: Viết lưới ĐỎ**

```ts
it("★ phạm vi tập đoàn KHÔNG còn bị hạ cấp xuống một nhà máy", () => {
  const kq = phamViThuc({ pv: "tapdoan", soNhaMayTrongPhamVi: 3 });
  expect(kq.cap).toBe("tapDoan");
  expect(kq.daHaCap).toBe(false);
});

it("★ chỉ được gán một nhà máy ⇒ phạm vi tập đoàn vẫn chỉ ra một khối", () => {
  const kq = phamViThuc({ pv: "tapdoan", soNhaMayTrongPhamVi: 1 });
  expect(kq.soNhaMayVe).toBe(1);
});
```

- [ ] **Bước 2: Chạy, kỳ vọng ĐỎ**

- [ ] **Bước 3: Bỏ hạ cấp và dời chỗ từng khối nhà máy theo thiết kế**

- [ ] **Bước 4: Đo kết cục trên trình duyệt thật**

Với tài khoản được gán cấp tập đoàn, mở phạm vi tập đoàn và đếm **số cụm khối** trong cảnh, kỳ vọng bằng ba. Với tài khoản chỉ được gán một nhà máy, kỳ vọng bằng một. Đây chính là mục 26 của bản thiết kế gốc, thứ chưa bao giờ đo được.

- [ ] **Bước 5: Đo lại ngân sách vẽ**

Cảnh ba nhà máy có 1.108 máy. Kiểm số lệnh vẽ vẫn dưới 150, số tam giác dưới 500 nghìn, số nhãn dưới 30, và số khung hình khi xoay vẫn từ 30 trở lên. Nếu vượt, đó là lý do chính đáng để quay lại thiết kế chứ không phải để nới ngưỡng.

- [ ] **Bước 6: Gỡ banner khai hạn chế**

Banner nói phạm vi tập đoàn chưa nạp được nhiều nhà máy nay thành lời khai sai, phải gỡ cùng lượt. Để lại là sản phẩm nói dối theo chiều ngược.

- [ ] **Bước 7: Cổng nền và commit**

```bash
npx vitest run client/src/components/twin3d
npm run check && npm run i18n:check
git add client/src/components/twin3d/van-hanh/boChonNap.ts client/src/pages/TwinVanHanh.tsx client/src/components/twin3d/van-hanh/canhTapDoan.unit.test.ts
git commit -m "feat(twin3d): canh pham vi tap doan gop nhieu nha may (muc 26 spec goc)"
```

---

## Quyết định chốt đợt 2 (2026-09-16)

| việc | quyết định | hệ quả |
|---|---|---|
| Gộp nhiều nhà máy | **Mở rộng đầu vào nhận danh sách** | Task 18 và 19 chạy như viết. Cổng phạm vi đã vá trước nên ba nhà máy chỉ còn 28 câu truy vấn và 37 mili giây. Bắt buộc giữ ba bất biến hàng rào: lọc từng mã, im lặng bỏ mã ngoài phạm vi, toàn ngoài thì rỗng và không rò tên. |
| Hai tiêu chí bố cục | **Cân lại tỉ lệ khung theo số đã đo** | Việc mới. Dùng hai con số thật 85 và 68 điểm ảnh cộng hằng 17 điểm ảnh của dòng tiền tố, chia lại chỗ giữa dải cảnh báo và danh sách máy, rồi đo lại bằng ảnh. |
| Ba phát hiện mới | **Vá cả ba** | Dải cảnh báo đếm lệch danh sách, chỉ số rủi ro luôn bằng không, và bấm cảnh khi đang chọn nhiều. Riêng cái thứ ba phải đo để phân xử trước khi vá. |
| Dữ liệu thử | **Gỡ hết, sinh lại khi cần** | Đã gỡ 2026-09-16: cơ sở dữ liệu về nền cũ (2 nhà máy, 43 máy, 10 người dùng, 82 hàng đặt chỗ). Bộ sinh tất định nên dựng lại được, nhưng **mã định danh sẽ khác** — mọi harness phải đọc lại từ tệp tóm tắt, không dùng số cũ. |

## Quyết định của chủ dự án (2026-09-15) — đã chốt, không còn treo

| việc | quyết định | hệ quả trong kế hoạch |
|---|---|---|
| Bản dựng ở cổng 3000 | **Để tắt** cho tới khi kế hoạch này xong và đồng bộ | Không task nào bật lại cổng đó. Mọi phép đo dùng cổng riêng và bản dựng riêng trong `.qa-tapdoan/`. Bật lại là việc sau khi Task 15 đạt. |
| Dữ liệu và tài khoản thử | **Toàn quyền xoá bỏ nếu cần** — hệ thống vẫn đang phát triển | Người thực thi được tự do gỡ và sinh lại bất cứ lúc nào bằng hai lệnh ở Task 15. Không cần hỏi lại. Vẫn phải giữ nguyên dữ liệu không mang tiền tố của đợt đo. |
| Gộp nhiều nhà máy trong một cảnh | **Thiết kế để mở rộng thêm** | Thành Giai đoạn 6, Task 17 đến 19. |
| Chỉ mục cho môi trường sản xuất | **Không còn là nợ** — hệ thống hiện chỉ nằm trong hệ sinh thái máy tự động hoá, chưa chạm sản xuất thật | Gỡ khỏi danh sách chờ. Khi nào có môi trường sản xuất thật thì mở lại. |
| Hai chỉ số rủi ro ngược nhau | **Đồng ý đo**, giả thuyết là lỗi dữ liệu sinh ngẫu nhiên | Thành Task 16 bước 4. |
