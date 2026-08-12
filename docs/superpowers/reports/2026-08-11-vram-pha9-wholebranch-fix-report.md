# Pha 9 — VÁ REVIEW TOÀN NHÁNH (lượt thứ mười một)

**Nhánh** `feat/hmi-dep` · **gốc** `a2785a53` → **HEAD** `ee1df5f7` (8 commit)
**Ngày** 2026-08-12 · **0 DDL · 0 migration · 0 seed · 0 `kb:sync` · 0 cấp quyền · 0 sub-agent**
Ba `.DRAFT` trong `drizzle/` **không đụng, không đổi tên**. ~245 mục dirty ngoài phạm vi **không chạm**.
`git status --porcelain -- server/ client/ shared/ scripts/ drizzle/` sau lượt vá ⇒ **0 dòng**.

---

## 0. Bảng finding × phán quyết

| # | Mức | Phán quyết | Commit | Đột biến ⇒ ca ĐỎ |
|---|---|---|---|---|
| **C-1** | Critical | **ĐÃ VÁ** (hai nửa) | `c1c72c2a` | 3 lượt, xem §2 |
| **I-1** | Important | **ĐÃ VÁ** | `91e86445` | registrar mới ngoài hai thư mục ⇒ 2 ca đỏ |
| **I-2** | Important | **ĐÃ VÁ** — nhưng **số của báo cáo sai tập** (21 → thật là **1**) | `70afa7bf` | `vi.mock` không factory mới ⇒ §4 đỏ |
| **I-3** | Important | **ĐÃ VÁ** | `464e435a` | trả regex về bản cũ ⇒ ca `SELECT s.*` đỏ |
| **I-4** | Important | **ĐÃ VÁ** | `314cd37a` | gỡ `showCloseButton={false}` ⇒ §3 đỏ |
| **I-5** | Important | **HOÃN — có lý do** (§5) | — | — |
| **I-6** | Important | **ĐÃ VÁ** (cả (a) và (b)) | `66651c9f` + `91e86445` | — (nghiệm thu **sống**: 400 → 401) |
| **M-1** | Minor | ĐÃ VÁ | `92109258` | — |
| **M-2** | Minor | **VÁ NỬA LƯỚI**; nửa `package.json` **HOÃN** (§5) | `ee1df5f7` | `import "otplib"` trong `client/` ⇒ đỏ |
| **M-3** | Minor | ĐÃ VÁ | `92109258` | — |
| **M-4** | Minor | **HOÃN — có lý do** (§5) | — | — |
| **M-5** | Minor | ĐÃ VÁ | `92109258` | (lưới `backupCodeWriteScan` đã đỏ trên bản vá đầu — xem §4) |
| **M-6** | Minor | ĐÃ VÁ + thêm cầu chì thứ hai | `92109258` | — |

**7 mục reviewer tự rút lại (R-1…R-7): KHÔNG vá lại mục nào.** R-1 đã được hạ xuống M-6 và vá ở
đúng mức ấy; R-4 (`.DRAFT 0320`) **không áp**, đúng như phán quyết.

---

## 1. Cổng ra

| lệnh | kết quả |
|---|---|
| `npm run check` | **exit 0** |
| `npm run check:tests` | **exit 0** |
| `npm run i18n:check` | **exit 0** |
| §Cổng kiểm chung (**55 đường**, 157 file) | **2449 / 2450** — đỏ **duy nhất** là ca có trước |
| §Cổng kiểm chung + `--sequence.shuffle.tests` | **2449 / 2450** — **cùng một** ca, không ca phụ-thuộc-thứ-tự nào |

Ca đỏ duy nhất: `server/api.test.ts › Factory Router › should reject non-admin from creating factory`
— **có trước, không chạm**. Ca đỏ thứ hai được khai (`authService.test.ts › F9-Minor`) **XANH** ở cả
hai lượt chạy của lượt này; nó phụ thuộc thời gian, nên đừng đọc màu xanh ấy thành "đã sửa".

**`CONG` 52 → 55** · **`FILE_CANH` 115 → 119** — cả hai **đọc từ số thật** bằng cách để cổng đỏ, không đoán.

| lượt | `CONG` | `FILE_CANH` | vì |
|---|---|---|---|
| C-1 | 52 → 53 | 115 → 116 | `taiKhoanBiTatMoiBeMat.test.ts` |
| I-2 | 53 → 55 | 116 → 118 | `mockKhongFactory.test.ts` **+** `edgeDownloadProxy.test.ts` (bản vá làm nó tự khai `Pha 9` ⇒ bộ nhận diện thứ ba kéo vào) |
| I-4 | 55 (giữ) | 118 → 119 | `client/src/lib/hopThoaiHienMotLan.unit.test.ts` (`client/src/lib/` đã là một đường của cổng) |

---

## 2. C-1 — tài khoản bị TẮT vẫn xác thực được trên MỌI bề mặt phiên

### 2.1 Tự đo lại trước khi vá (không tin tóm tắt)

```
npx vitest run server/_core/__probeC1Ban.test.ts        (probe, đã xoá)
### hàng user_sessions sau lượt tắt: isActive = true
### KẾT QUẢ SAU KHI TẮT TÀI KHOẢN: ĐI QUA id=2103 role=user isActive=false
```

Trình tự: dựng tài khoản → dựng phiên THẬT → `authenticateRequest` ⇒ OK (cầu chì) →
`db.updateUser(uid,{isActive:false})` (**đường sản phẩm**) → khẳng định `getUserById().isActive===false`
(cầu chì 2) → `authenticateRequest` ⇒ **ĐI QUA**. **Finding đúng nguyên văn.**

### 2.2 Bản vá — HAI NỬA, không nửa nào thay được nửa kia

1. **CƯỠNG CHẾ** — `chanNeuTaiKhoanBiTat(user)` (`_core/sdk.ts`), gọi ở **LỐI RA DUY NHẤT** của
   `xacThucTho`. Hai nhánh (trúng cache · đi DB) **hội về một biến** rồi một cổng rồi một lối ra —
   **không** chép phép kiểm vào hai nhánh (lớp lỗi đã đẻ bốn Critical). Lưới ghim **đúng 1** call
   site bằng AST.
   ⚠ Đọc cờ **từ hàng trong tay**, không thêm một `SELECT`: *"vá cho khớp bên chặt hơn, đừng phát
   minh cơ chế mới"* — cả hai đường hẹp đã có (`index.ts` nhánh Bearer · `authService` lượt đăng
   nhập) đều kiểm `user.isActive` trên đúng hàng chúng vừa lấy. **Chi phí thêm: 0 truy vấn.**
   ⚠ `=== false` **tường minh**: cột cho phép `NULL`; `!user.isActive` là `true` với `null` ⇒ viết `!`
   là dựng một nhà tù cho mọi hàng chưa đặt cờ.
2. **THU HỒI** — `db.updateUser` gọi `revokeAllSessions(userId)` khi `data.isActive === false`.
   ★ **Đây là mục ★★ của brief**: A2 trả **−44% thông lượng** để mua *"thu hồi có hiệu lực NGAY"*,
   nhưng ý định thu hồi phổ biến nhất **không sinh ra lượt thu hồi nào**. Nay nó có. Phép đo ấy
   **hết đúng**, và §7 của lưới mới **đỏ** nếu ai gỡ dòng đó ra.
3. `validateExternalAuth` thôi giữ bản sao thứ hai (`user && user.isActive` viết thẳng) — nay gọi
   cùng một chủ. Bình luận `auth.ts:290` (*"covers role change + ban"*) đã được sửa: nửa **ban** SAI.

**Lưới**: `server/_core/taiKhoanBiTatMoiBeMat.test.ts` — **19 ca**, lượng từ ∀ trên **hình dạng phân
giải danh tính** (không trên một danh sách ba tên) + hành vi sống trên DB thật + đối chứng dương
*"không khoá ai ra ngoài"* + ca `isActive = NULL` được **THA**.

### 2.3 Đột biến ⇒ tên ca ĐỎ (commit TRƯỚC, đột biến SAU)

| đột biến | ca ĐỎ |
|---|---|
| bình luận-hoá `await chanNeuTaiKhoanBiTat(nguoiDung)` trong `sdk.ts` | `§4 ∀ điểm xác thực…` · `§4b ĐIỂM CHUNG thật sự kiểm cờ` · `§6 …ĐÚNG MỘT lần (AST)` · `§5c LẬT CỜ BẰNG SQL THẲNG…` (**4 ca**) |
| bình luận-hoá `revokeAllSessions(userId)` trong `db.updateUser` | `§7 NỬA THU HỒI — lượt TẮT tài khoản sinh ra một lượt thu hồi THẬT trong sổ` (**1 ca**) |
| **bề mặt MỚI trong FILE MỚI** (`server/routes/__dotBienC1Moi.ts`) — có **đủ hai** phép chặn của hai pha trước, thiếu đúng trục thứ ba | `§4 ∀ điểm xác thực…` ⇒ `+ "server/routes/__dotBienC1Moi.ts:9 [phien]"` |

★ Đột biến thứ ba là ca phân biệt *"lưới theo ĐƯỜNG THOÁT"* với *"lưới theo FILE"*, và nó chứng minh
thêm một điều: gộp ba trục thành **một cờ "đã canh"** sẽ để bề mặt ấy đi lọt.
★ Hai nửa được canh bằng **hai ô khác nhau**: đột biến (1) không làm §7 đỏ, đột biến (2) không làm
§5c đỏ. Đó là bằng chứng hai nửa **thật sự** độc lập.

### 2.4 ★★★ NGHIỆM THU SỐNG — máy chủ đang chạy + DB SẢN XUẤT

Redeploy bằng `scripts/redeploy.ps1` (script B6 vừa ghim): PID **8360 → 37004**, `GET /` = **200**,
đếm lại ⇒ **đúng 1** tiến trình phục vụ cổng 3000. Nhận diện **theo cổng**
(`Get-NetTCPConnection -LocalPort 3000 -State Listen` ⇒ `OwningProcess`), dòng lệnh thật
`node␣␣dist/index.js` (**19** ký tự).

Tài khoản **tạm của riêng lượt đo**, tạo và xoá trong cùng lượt — **không chạm tài khoản nào có sẵn**:

```
### tài khoản tạm: id=10506 username=pha9c1-live-1786538258030
### đăng nhập => HTTP=200  cookie=CÓ
### auth.me khi CÒN BẬT      => HTTP=200  id=10506      ← ĐỐI CHỨNG DƯƠNG
### cầu chì 2: users.isActive = false                    ← lật bằng SQL THẲNG (đường vận hành)
### auth.me NGAY sau khi tắt => HTTP=200  id=10506      ← VÙNG MÙ ĐƯỢC KHAI (cache ≤45 s)
### chờ 50 s cho hết TTL bộ nhớ đệm phiên…
### auth.me SAU TTL          => HTTP=200  id=null       ← BỊ CHẶN
### PHÁN QUYẾT: BỊ CHẶN (id=null)
### dọn dẹp: còn lại 0 hàng users cho id=10506
```

⚠⚠ **Mã trạng thái là thước HỎNG ở đây** — `auth.me` trả **200 ở CẢ BA lượt**. Thứ đếm được là `id`.
Đây đúng cảnh báo trong kỷ luật đo, và nó **đã suýt** cho ra một kết luận sai.
⚠ Cửa sổ ≤ TTL đo được ở lượt thứ hai là **vùng mù ĐÃ KHAI**, không phải một lượt bỏ sót: nó chỉ tồn
tại cho lượt lật cờ **ngoài đường sản phẩm**. Đường sản phẩm (`db.updateUser`) dọn cache **và** thu
hồi phiên ⇒ ăn ngay (canh bởi §5b/§7 trên DB test).

**KHÔNG KHOÁ AI RA NGOÀI** — đối chứng dương trên một tài khoản **THẬT**, trên máy chủ sống:

```
### engineer1 đăng nhập => HTTP=200 cookie=CÓ
### auth.me lượt 1/2/3 => HTTP=200 id=51 role=engineer   (ba lượt liên tiếp)
### GET /api/observability/health (vai engineer) => HTTP=403   ← qua cửa xác thực, chặn theo VAI
```

**Neo vào bản đã deploy** (`dist/index.js`, neo vào thân `async xacThucTho(`, **không** vào bảng xuất):
`ACCOUNT_DISABLED` có mặt · thân `xacThucTho` chứa `chanNeuTaiKhoanBiTat` · thứ tự
`chanNeuPhienDaThuHoi` < `getCachedAuthUser` < `chanNeuTaiKhoanBiTat` · **1** lượt gọi trong thân.

---

## 3. I-2 — ★★ BÁO CÁO ĐÚNG VỀ CƠ CHẾ, SAI VỀ TẬP: 21 → thật là **1**

### 3.1 Hai lượt thiết bị đo nói dối, cả hai của **tôi**, cả hai được ghim vào lưới

| # | thiết bị | trả về | vì sao sai |
|---|---|---|---|
| 27 | `git grep -nE 'vi\.mock\("[^"]*db[^"]*"\)\s*;'` | **5** | `git grep -E` là POSIX ERE, **không hiểu `\s`**. Cùng mẫu qua ripgrep ⇒ **21**. Nhỏ hơn **4 lần**, hình dạng đúng. |
| 28 | vị từ *"bao đóng **LƯỢT NHẬP** của module đích có chạm `db/auth.ts`"* | **9** | `vi.mock` chỉ thay **bề mặt XUẤT của chính module ấy**, **không** thay cây phụ thuộc. Đi theo cạnh **RE-EXPORT** ⇒ **1**. Tám cái kia là dương tính giả **mang đúng hình dạng của một kết luận thật** — lớp nguy nhất. |

### 3.2 Số thật, và cơ chế thì **có thật**

`vi.mock` **không factory** trong `server/**/*.test.ts`: **30**. Trong đó nuốt `server/db/auth.ts`
(thùng `db/index.ts` `export * from "./auth"`): **1** — `server/edgeDownloadProxy.test.ts:15`.

Cơ chế im lặng **đo được**, dưới `vi.mock("../db")` **THẬT** (không mô phỏng):

```
typeof db.phaiDoiMatKhau      = function      ← khoá CÓ MẶT
db.phaiDoiMatKhau(1)          => undefined    ← KHÔNG ném
biChanBoiCongDoiMatKhau('user', undefined) = false
chanNeuPhaiDoiMatKhau(...)    => KHÔNG NÉM    ← CỔNG MỞ, IM LẶNG
```

⇒ Con số **99,1% bề mặt tầng `db` là HÀM** của báo cáo nhóm B không phải lý do yên tâm — nó **chính
là cơ chế** khiến automock im lặng: một hàm **có thật** trả `undefined`.

**ĐỐI CHỨNG dưới CÙNG bản giả**: `chanNeuPhienDaThuHoi` ⇒ **NÉM** `SESSION_NOT_IN_LEDGER` (fail-closed
nhờ lượt siết 0318). ⇒ *"automock mở MỌI cổng"* là **SAI**, và lưới nói được điều đó.

### 3.3 Bản vá

`edgeDownloadProxy.test.ts` đổi sang **factory** khai đúng **một** khoá nó cần (`getMachineByApiKey`);
tập vi phạm hôm nay **RỖNG**. Lưới `server/_core/mockKhongFactory.test.ts` (11 ca) giữ nó rỗng.

⚠ **Phạm vi CỐ Ý HẸP** — không áp cơ chế cho 1.526 lượt `vi.mock` của repo: Pha 8 đã đo rằng một tập
ngoại lệ 624 phần tử **không phải một cổng**.
⚠ Tập được **THA** có **đúng một** phần tử, nhận diện bằng **`import.meta.url`** (một cơ chế, không
phải một danh sách đường dẫn): chính file lưới, vì nó **cố ý** automock để §3 đo được sự im lặng.
§4b ghim rằng cơ chế ấy chưa bị nới thành danh sách.

**Đột biến**: thêm `vi.mock("../db")` vào `server/routers/sessionGrantScan.test.ts` ⇒ §4 **ĐỎ** với
`server/routers/sessionGrantScan.test.ts:49 ← ../db`.
⚠ Lượt đột biến **đầu tiên** rơi vào **một khối bình luận** (chèn theo chỉ số dòng) và lưới **XANH** —
đúng thứ nó phải làm (bộ suy AST không đếm bình luận), nhưng nó suýt được đọc thành *"lưới không có
răng"*. **Đột biến cũng cần một cầu chì.**

---

## 4. I-1 · I-3 · I-4 · I-6 · Minor — cái đã đo và cái đã đổi

### I-1 — thiết bị chống-"N+1" tự nó là một danh sách N+1

```
REGISTRAR (server/routes + server/api) = 22      ← con số §6 ghim
CÙNG VỊ TỪ trên toàn server/           = 55
```

Ba trong 33 file ngoài tầm là registrar Express **THẬT**: `_core/oauth.ts` (**6** tuyến, gồm
`POST /api/auth/verify-2fa` — chính tuyến A5 vừa đổi người tiêu mã dự phòng) · `_core/samlProvider.ts`
(**3**) · `_core/securityHeaders.ts` (**1**).

⚠ **Phạm vi rộng đòi vị từ ĐÚNG.** `export function register\w*(` trên toàn `server/` tóm thêm **30**
file **không phải Express** (`registerHandlers` kho công cụ AI, `registerDriver` kho driver OT/robot…).
Khai 30 mục *"ngoài phạm vi"* là dựng đúng cái danh sách vô nghĩa mà lượng từ này ra đời để giết.
⇒ Vị từ siết theo **HÌNH DẠNG**: registrar TUYẾN = `register…` nhận **một tham số kiểu Express**.
**55 → 25** = 22 cũ + đúng **ba** file `_core/`. §6a ghim **CẢ HAI** con số (55 và 25), nên **hai lượt
sửa ngược nhau** (thu phạm vi · nới vị từ) đều ĐỎ.

**§6b — ∀ THỨ HAI theo hình dạng GẮN TUYẾN**, không theo tên hàm: `server/_core/index.ts` gắn **98**
điểm tuyến **thẳng** vào `app` ⇒ câu *"0/12 tuyến trả 5xx"* đúng **cho 12 tuyến của ba registrar**.
Nợ được **KHAI kèm SỐ** (98) — tuyến thứ 99 là một quyết định phải nói ra.

Ba registrar `_core/` được **KHAI** chứ không bị kéo vào §2: chúng là **cửa ĐÚC vé** (đăng nhập ·
callback OAuth · ACS SAML) và một bề mặt **công khai có chủ ý** (điểm nhận báo cáo CSP của trình
duyệt) — bất biến *"không cookie ⇒ 401"* **sai với chúng theo định nghĩa**. Trục của chúng có người
canh riêng, **có tên** (`sessionGrantScan.test.ts` §4 · `verify2faPasswordStep.test.ts`), và mỗi mục
ghim **số tuyến** để một tuyến thứ 7 của `oauth.ts` không lặng lẽ thừa hưởng lời khai.

**Đột biến**: `server/services/__dotBienRegistrar.ts` (registrar Express mới, **ngoài** hai thư mục cũ)
⇒ **2 ca ĐỎ**: `§6a …HAI con số được ghim` (56≠55) và `∀ registrar: được GỌI THẬT, hoặc được KHAI TÊN`.

### I-3 — A3 mù với `SELECT <bí danh>.*`

Đo qua chính `diemDocBiMatTrongNguon`: `SELECT *` ⇒ **1** điểm · `SELECT s.*` ⇒ **0** · `SELECT us.*, u.id`
(JOIN) ⇒ **0**. Nới **đúng một bậc**; giữ **hai** ô đối chứng dương (`SELECT COUNT(*)` ⇒ 0 ·
`SELECT us."userId"` ⇒ 0) để lượt nới không đi quá.
**Đột biến**: trả vị từ về bản cũ ⇒ ca `I-3 — SELECT <bí danh>.* … cũng bị bắt` **ĐỎ**.

⚠ **Thiết bị nói dối lần 29**: bình luận đầu tiên tôi viết chứa chuỗi `\*/`, và **`*/` đóng khối bình
luận** ⇒ hai file test khai `Tests: no tests` + `2 failed`. Đúng lớp lỗi đã ghi (*"1 failed + no tests"
KHÔNG phải xanh*), và nó bắt được **cả** một lỗi cùng loại tôi đã ghi vào `deployProcedureScan.ts`.

### I-4 — hộp thoại mã dự phòng đóng được bằng X và Esc

Đo trên `dialog.tsx`: `showCloseButton = true` là **MẶC ĐỊNH** · `handleEscapeKeyDown` chỉ chặn khi
**IME đang gõ** · `onOpenChange` đóng thật. Bản A4 chỉ viết `onInteractOutside` ⇒ **1/3**.
Nay đủ ba. **Lưới**: `client/src/lib/hopThoaiHienMotLan.unit.test.ts` (4 ca) — nhận diện hộp thoại
theo **CẤU TRÚC cây JSX** (`<DialogContent>` nào **BỌC** một biểu thức `backupCodes`), §2 ghim **TIỀN
ĐỀ** (mặc định của `dialog.tsx`) để luật có lý do, §3b hiệu chuẩn bằng ba nguồn dựng sẵn — trong đó
có **đúng hình dạng đã ship** và ca `showCloseButton` **TRẦN** (JSX ⇒ `true`; thước đọc **GIÁ TRỊ**,
không đọc **TÊN**).
⚠ **VÙNG MÙ ĐƯỢC KHAI**: lưới **HÌNH DẠNG**, không phải lưới **DỰNG** — `client/src/**` chạy ở môi
trường node, không có DOM.
**Đột biến**: gỡ `showCloseButton={false}` ⇒ `§3 …chặn nút X, phím Esc, và bấm ra ngoài` **ĐỎ**.
⚠ Lượt đột biến **đầu tiên** rơi vào bình luận (bình luận có chứa nguyên văn `showCloseButton={false}`)
— **lần thứ hai** trong lượt này.

### I-6 — `/api/ai/local-kb/feedback`

Cả **(a)** và **(b)** của báo cáo:
- **(a)** cưỡng chế **loopback HOẶC vai đặc quyền**, đúng khuôn `/api/observability/metrics`. Cặp vị
  từ ấy **đã tồn tại** ở `observabilityRoutes.ts` nhưng không xuất ra ⇒ **rút về MỘT CHỦ**
  (`server/routes/_congLoopback.ts`); chép sang là dựng bản sao thứ hai dưới một bất biến an ninh.
- **(b)** `AUTH_FREE` từ `Record<string,string>` sang bản ghi có **`coCheThayThe`**, và §4c kiểm bằng
  **AST** rằng cơ chế ấy **có thật trong mã của tuyến**. `NGOAI_PHAM_VI` cũng ghim `soTuyen` cho từng
  mục (khuôn *"chữ ký chênh lệch chính xác"* của `hoTuyenSongSong`).
- ★ `POST /api/ai/local-kb/feedback` **RỜI KHỎI** `AUTH_FREE` — nó nay tự cưỡng chế nên vào thẳng
  lượng từ §2. **Một miễn trừ được XOÁ là kết cục tốt hơn một miễn trừ viết hay.**

**NGHIỆM THU SỐNG** (máy chủ PID 37004):

```
POST /api/ai/local-kb/feedback  từ 192.168.8.10 (KHÔNG loopback), không cookie
  {"success":false,"error":"Authentication required (invalid session)."}   HTTP=401   ← trước: 400
POST /api/ai/local-kb/feedback  từ 127.0.0.1 (loopback)
  {"success":false,"error":"messageId and question are required"}          HTTP=400   ← ĐỐI CHỨNG
```

Nhánh loopback **vẫn đi qua** ⇒ lượt gọi tự-thân của tRPC **không bị đứt**.
⚠ **CAVEAT ĐƯỢC KHAI**: `KB_API_BASE` mặc định `http://localhost:3000` (không có trong `.env`). Một
triển khai đặt biến ấy sang địa chỉ **không loopback** phải đổi **cùng lúc** với một đường mang danh
tính — không được sửa bằng cách gỡ phép kiểm.

### Minor

- **M-1** — docstring khai *"cặp thứ mười tám"*, tên ca *"thứ mười sáu"*, `MIEN_TRU` có **16** khoá
  ⇒ cặp mới là thứ **17**. Sửa cả hai.
- **M-3** — trả lại câu cảnh báo staleness A2 đã bỏ, **thu hẹp đúng phần đã vá**: cửa sổ còn cho VAI
  và TẮT TÀI KHOẢN (chỉ khi lật cờ ngoài đường sản phẩm), **không** còn cho thu hồi PHIÊN.
- **M-5** — `quayVongMaDuPhong` nay **một giao dịch**, `tx` truyền xuống `xoaMoiMaDuPhong` (hàm ấy đã
  nhận `tx?` từ đầu, chỉ chưa ai truyền).
  ★ **Bản vá ĐẦU của tôi làm `backupCodeWriteScan.test.ts` ĐỎ**: tôi băm 10 mã **trước** rồi mới vào
  giao dịch (để giao dịch ngắn), và lượng từ ∀ ở đó đòi khoá `code` phải là một lượt gọi
  `bamMaDuPhong()` **ngay tại chỗ**. Màu đỏ ấy **nói ĐÚNG** ⇒ **mã được nắn cho vừa lưới, không
  ngược lại**. Giá được nói ra: giao dịch mở trong ~10 lượt `bcrypt` (~1 s), chỉ trên đường bật/quay
  vòng 2FA.
- **M-6** — bao đóng **1041** → **1051** khi đi theo `tsconfig.paths`; **10** file bỏ sót, toàn bộ
  `shared/**`. ⚠ Cầu chì `> 500` **không thể** thấy mất mát ấy (1041 ≫ 500) — *"cầu chì đặt ở ngưỡng
  không bao giờ chạm tới"* ⇒ thêm **cầu chì thứ hai** hỏi thẳng *"bao đóng có chứa file `shared/**`
  không"*. Bảng alias đọc **từ chính `tsconfig.json`**, không chép lại.
- **M-2 (nửa lưới)** — lượng từ `otplib` nay phủ **bốn cây** (`server` · `client` · `shared` ·
  `scripts`), kèm cầu chì *"tập bốn cây phải LỚN HƠN tập `server/**`"*. **Đột biến**: `import "otplib"`
  trong `client/src/` ⇒ **ĐỎ**.

---

## 5. HOÃN — và vì sao (không phải vì hết giờ)

| # | mục | lý do hoãn |
|---|---|---|
| **I-5** | ba phép phân giải danh tính được tin **THEO TÊN**; hình dạng thứ ba (`getSessionByToken` + `getUserById`) vô hình với **cả hai** lưới ∀ | **KHÔNG nằm trong danh sách brief giao** (brief liệt kê I-1, I-2 và *"ba Important còn lại"* = I-3 · I-4 · I-6 ⇒ **năm**, không sáu). Đây là một **thiếu sót của brief**, không phải của báo cáo — và tôi **không tự ý mở rộng phạm vi** cho một finding đòi sửa `quetDiemXacThuc` (bộ suy mà **ba** lưng ∀ đang dùng chung, gồm hai lưới tôi vừa đổi trong lượt này). ⚠ **Đây là mục cần quyết đầu tiên của lượt sau.** Khuôn vá đã có sẵn trong repo: `totpReplayScan.test.ts:220+` (*"∀ file gọi `X`: phải nhập `X` từ chính module chủ"*, nhận diện module bằng **phép nối đường dẫn**). |
| **M-4** | `catch { return null }` ở `_xacThucRest.ts` gộp mọi nguyên nhân về 401 | Vá đúng đòi đổi **hợp đồng mã trạng thái của 7 tuyến REST** (401 vs 403) — một **quyết định sản phẩm**, không phải một lượt trả nợ an ninh. Fail-closed **giữ nguyên** ở cả 7. ⚠ Lượt C-1 vừa **thêm** một nguyên nhân mới (`ACCOUNT_DISABLED`) vào cùng cái `catch` ấy, nên món nợ này **lớn thêm** — nêu ra để chủ dự án quyết. |
| **M-2** (nửa `package.json`) | `otplib` vẫn ở `dependencies` dù **0 người nhập** trên cả bốn cây | Chuyển sang `devDependencies` (hoặc gỡ hẳn) là đổi **bề mặt cài đặt sản xuất** + sinh lại `package-lock.json`. Sau nửa lưới đã vá, món nợ là *"một thư viện **có mặt** mà **không ai gọi được**"* — và tính không-với-tới nay là một **bất biến có lưới**, không còn là một quan sát. |

---

## 6. Nợ MỚI do chính lượt này đẻ ra

1. **Cửa sổ ≤ `AUTH_CACHE_TTL_S` cho lượt tắt tài khoản bằng SQL THẲNG** — **đo được sống** (§2.4,
   lượt `auth.me` thứ hai vẫn trả `id=10506`). Đường sản phẩm không có cửa sổ này. Đóng nó đòi hoặc
   một lượt đọc `users` mới **mỗi request** (A2 đã trả −44% cho lượt đọc thứ hai; đây sẽ là thứ ba),
   hoặc gộp hai `SELECT` hiện có thành một `JOIN` — **đúng món nợ A2 đã ghi và cố ý hoãn**.
2. **`quayVongMaDuPhong` giữ giao dịch mở trong ~10 lượt `bcrypt` (~1 s)** — cái giá của việc nắn mã
   cho vừa lưới `backupCodeWriteScan` thay vì nới lưới. Chỉ trên đường bật/quay vòng 2FA.
3. **98 điểm gắn tuyến thẳng trong `server/_core/index.ts` chưa từng được gọi thật** — nay đã **khai
   kèm số** (§6b của `xacThucBeMatRest.test.ts`), nhưng vẫn là nợ.
4. **`_congLoopback.ts` có hai người dùng; `laLoopback` KHÔNG phải một phép xác thực.** Đặt nó trước
   một bề mặt **đọc dữ liệu người dùng** là mở cửa cho mọi tiến trình trên cùng máy. Đã ghi thành
   cảnh báo trong chính file; chưa có lượng từ nào canh *"nó chỉ đứng ở bề mặt được phép"*.
5. **`AUTH_FREE` nay đòi một `coCheThayThe` là TÊN MỘT HÀM.** Kiểm bằng AST rằng hàm ấy **được gọi**
   trong file registrar — **không** kiểm rằng nó được gọi **trên đúng tuyến ấy**. Một tuyến auth-free
   thứ ba đặt trong cùng file sẽ thừa hưởng lời khai. Chặt hơn một câu văn, chưa chặt bằng một cổng.

---

## 7. Thiết bị đo nói dối trong lượt này — **3 lần** (tổng chuỗi pha: **29**)

| # | thiết bị | triệu chứng | cách bắt |
|---|---|---|---|
| 27 | `git grep -E` với `\s` | **5** thay vì **21** | chạy lại bằng **ripgrep**; hai công cụ, hai số ⇒ nghi thiết bị |
| 28 | vị từ với-tới đi theo **lượt nhập** thay vì **re-export** | **9** thay vì **1** — *"tám dương tính giả mang đúng hình dạng của một kết luận thật"* | đọc lại **ngữ nghĩa của `vi.mock`**, không đọc lại kết quả |
| 29 | `\*/` trong bình luận **đóng khối comment** | `Tests: no tests` + `2 failed` | *"1 failed + no tests" KHÔNG phải xanh* — đã có trong kỷ luật đo |

**Cộng hai lượt ĐỘT BIẾN rơi vào khối bình luận** (I-2 · I-4) và **XANH** — đúng như bộ suy AST phải
làm, nhưng suýt được đọc thành *"lưới không có răng"*. ⇒ **Một lượt đột biến cũng cần cầu chì**: sau
khi chèn, phải **đọc lại chỗ chèn** trước khi tin màu.

---

## 8. Ràng buộc cứng — đã giữ

* **0** DDL · **0** migration · **0** seed · **0** `kb:sync` · **0** cấp quyền.
* **0** đổi mật khẩu/cờ/vai/quyền của **bất kỳ tài khoản có sẵn nào**. `engineer1` #51 chỉ được
  **đăng nhập để đo**; bit `vram_control`/`canDelete` **không thu, không cấp**.
  ⚠ Lượt nghiệm thu sống C-1 **tạo và xoá** một tài khoản tạm của riêng nó (id 10506) trên DB sản
  xuất; kiểm cuối ⇒ **0 hàng còn lại**. Không tài khoản nào có sẵn bị chạm.
* Ba `.DRAFT` trong `drizzle/` **không đụng, không đổi tên**.
* ~245 mục dirty ngoài phạm vi **không chạm, không stage**. `git diff --cached --name-only` được xác
  nhận **trước mỗi lượt commit**; **0** lượt `git add -A`.
* **0** sub-agent.
* Mọi file probe/đột biến (`__probeC1Ban.test.ts` · `__probeI2.test.ts` · `__dotBienC1Moi.ts` ·
  `__dotBienRegistrar.ts` · `__dotBienM2.ts` · các script `.cjs` đo lường) đã **xoá**.
  `git status --porcelain -- server/ client/ shared/ scripts/ drizzle/` ⇒ **0 dòng**.
* **1** lượt redeploy (được phép), qua `scripts/redeploy.ps1`; `GET /` = **200**; **đúng 1** tiến
  trình phục vụ cổng 3000 (PID **37004**).
