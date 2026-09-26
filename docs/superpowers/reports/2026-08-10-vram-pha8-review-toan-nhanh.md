# Pha 8 — Review TOÀN NHÁNH (lượt thứ MƯỜI)

**Phạm vi:** `feat/hmi-dep`, `774f35a9..3add9595` (17 commit, 33 file, +4.320/−140).
**Ngày:** 2026-08-10 · **Kỷ luật:** CHỈ ĐỌC VÀ ĐO. Mọi đột biến đã hoàn nguyên bằng `git checkout HEAD -- <file>`;
`git status --porcelain -- server/ client/ shared/ scripts/ drizzle/` **RỖNG** ở cuối lượt.

---

## 0. Hiệu chuẩn thước TRƯỚC KHI TIN BẤT KỲ SỐ NÀO

Lượt này dùng bốn thiết bị đo. Mỗi cái được hiệu chuẩn bằng một **sự kiện có đáp số biết trước**:

| Thiết bị | Hiệu chuẩn | Kết quả |
|---|---|---|
| `psql` (owner `aoi`) | `\d user_sessions` trên **cả hai** DB | `sessionToken` = `text` ⇒ mig 0317 **đã áp thật** |
| Máy chủ sống PID 37600 | giải mã payload JWT vừa cấp | có ô `"jti":"uWtVsHKDlOkR"` ⇒ **bản dựng CÓ commit `1803d6e8` (nonce)**, tức không phải bản cũ |
| `curl` không kèm xác thực | `GET /api/external/health` | **401** ⇒ 200 ở các ô dưới KHÔNG phải "tuyến vốn công khai" |
| `vitest` trên các lưới mới | chạy nguyên trạng | **32 + 19 + 39 ca XANH**, `npm run check` **exit 0** ⇒ mọi ca ĐỎ bên dưới là do đột biến của tôi, không do hạ tầng |

⚠ Ba khẳng định trong brief được **tự đếm lại** và **KHỚP**: mig 0317 đã áp (cả hai DB), nonce đã ship,
`user.getSessions` đã thôi trả `sessionToken`. Brief lượt này **không** lệch trạng thái thật (khác Pha 7+8).

**Bảng tóm tắt**

| Mức | Số |
|---|---|
| **Critical** | **2** |
| **Important** | **3** |
| **Minor** | **4** |
| Tổng | 9 |

---

## C-1 — CRITICAL · `auth.logout` và `session.revoke` KHÔNG có hiệu lực trên 58 tuyến REST `/api/external/*`

**File:** `server/_core/index.ts:1652-1678` (nhánh `Authorization: Bearer` của `validateExternalAuth`) ·
`server/routers.ts:279-287` (`auth.logout`) · `server/db/auth.ts::thuHoiPhienTheoToken` ·
lưới `server/auth.logoutThuHoi.test.ts:232-245`.

### Cái sai

Task 1 **tự tay tìm ra** rằng `validateExternalAuth` là *"ĐIỂM XÁC THỰC DUY NHẤT VÒNG QUA `authenticateRequest`"*
(chú thích ở `index.ts:1663-1669`) và vá nó — **chỉ cho cổng buộc-đổi-mật-khẩu**
(`await chanNeuPhaiDoiMatKhau(user)` ở dòng 1670).

Task 2 làm `auth.logout` thu hồi thật, và cơ chế cưỡng chế là **hàng `user_sessions`** —
`sdk.xacThucTho` tra `getSessionByToken` mỗi lượt (`sdk.ts:462-484`).

Nhánh Bearer **tự phân giải danh tính** (`verifySession` + `getUserByOpenId`) và **không bao giờ tra sổ phiên**.
⇒ Bất biến của Task 2 được cưỡng chế **đúng trên con đường đi qua điểm chung**, và **hở** ở đúng cái điểm mà
Task 1 vừa cầm trên tay.

### Bằng chứng ĐO ĐƯỢC (máy chủ sống PID 37600, `engineer1` #51)

```
# 1) đăng nhập, lấy cookie phiên
$ curl -s -c c.txt -X POST http://localhost:3000/api/auth/login -d '{"username":"engineer1",...}'
{"success":true,"user":{"id":51,...,"role":"engineer"}}                      HTTP=200

# 2) ĐỐI CHỨNG ÂM — không có gì thì 401
$ curl -s http://localhost:3000/api/external/health
{"success":false,"message":"Unauthorized. Provide x-master-key ..."}          HTTP=401

# 3) chính cookie ấy dùng làm Bearer  ⇒ 200
$ curl -s -H "Authorization: Bearer $TOK" http://localhost:3000/api/external/health
{"success":true,"status":"ok","db":"up",...}                                  HTTP=200

# 4) ĐĂNG XUẤT
$ curl -s -b c.txt -X POST http://localhost:3000/api/trpc/auth.logout
{"result":{"data":{"json":{"success":true}}}}                                 HTTP=200

# 5) đường tRPC: Task 2 CHẠY ĐÚNG
$ curl -s -b c.txt http://localhost:3000/api/trpc/auth.me
{"result":{"data":{"json":null}}}                                             HTTP=200

# 6) CÙNG token ấy, đường Bearer: VẪN VÀO
$ curl -s -H "Authorization: Bearer $TOK" http://localhost:3000/api/external/health
{"success":true,"status":"ok","db":"up",...}                                  HTTP=200
```

Hàng sổ xác nhận lượt thu hồi **đã xảy ra**:

```
$ psql -d aoi_management -c 'select id,"isActive" from user_sessions where "userId"=51 order by id desc limit 1'
 290 | f
```

⇒ Sổ ghi **f**, `auth.me` trả `null`, mà tuyến Bearer vẫn **200**. Không phải lỗi phép đo: bước (2) là đối chứng âm.

### Bề mặt

`grep` đếm được **31** tuyến `app.<verb>("…", validateExternalAuth|validateMasterKey, …)` trong
`server/_core/index.ts` + **27** tuyến trong `server/routes/externalInspectionApi.ts` = **58 tuyến**, trong đó có
`POST /api/external/machines/register` (**trả `apiKey` của máy**), `POST /api/external/alerts/:id/acknowledge`,
`/resolve`, `/resolve-v2`, `POST /api/external/reports/generate`, `PUT /api/external/user/preferences`,
và toàn bộ trục đọc OEE / station / product / inspection / measurement.

### Hậu quả thật nếu không vá

*"Đăng xuất"* là lời hứa suông **theo đúng nghĩa Task 2 vừa dựng ra để chấm dứt**, chỉ đổi cửa. Một cookie bị bắt
(XSS · máy bỏ ngỏ · log) vẫn đọc và ghi được trên 58 tuyến cho tới `exp` = **2027**. Và nó làm **nhẹ đi** cả lượt
thu hồi 236 phiên của Pha 7 Task 8 — những token ấy cũng chưa bao giờ bị chặn ở nhánh này.

### Đường vá đề xuất

1. Trong nhánh Bearer, sau `getUserByOpenId`, tra `db.getSessionByToken(token)` và **từ chối** khi hàng tồn tại và
   `isActive === false` hoặc `expiresAt <= now` — **đúng vị từ** `sdk.xacThucTho` đang dùng, đừng viết bản sao thứ hai
   (lớp *"nhiều chủ cho một bất biến"* đã đẻ ba Critical). Cách sạch hơn: rút vị từ ấy ra một hàm
   `chanNeuPhienDaThuHoi(token)` ở `sdk.ts` và gọi từ **cả hai** chỗ.
2. **Mở rộng lượng từ, đừng vá một chỗ.** Lưới `auth.logoutThuHoi.test.ts` §3 chỉ nói về `sdk.authenticateRequest`.
   Dùng lại `quetDiemXacThuc()` của Task 1 (đã có sẵn, đã suy từ AST toàn `server/**`) với vị từ đổi từ
   *"thân có gọi `chanNeuPhaiDoiMatKhau`"* thành *"thân có tra sổ phiên"* ⇒ một bề mặt thứ ba trong một file chưa
   tồn tại tự vào lượng từ. Đây là bản sao gần như miễn phí của một bộ suy đã trả giá để học bài R1b.

---

## C-2 — CRITICAL · Một header `User-Agent` dài là đủ để đúc một phiên **KHÔNG THU HỒI ĐƯỢC**

**File:** `server/_core/authService.ts:365-372` (`deviceName: audit.userAgent ?? undefined`) ·
`drizzle/schema/auth.ts:238` (`deviceName: varchar("deviceName", { length: 255 })`) ·
`server/db/auth.ts:510-526` (`createUserSession`, không cắt gì) ·
`server/_core/sdk.ts:462-484` (*"No row → backward-compatible allow"*).

### Cái sai

Mig **0317** đóng đúng một cột (`sessionToken` → `text`) với lý lẽ được viết rất rõ:

> *"độ dài JWT do `users.name` lái — **dữ liệu người dùng, ta không kiểm soát**… một con số mới (512) chỉ dời cùng
> lớp lỗi sang chỗ khác — nó vẫn là một TRẦN ĐOÁN."*

Cột **ngay bên cạnh, trong CÙNG một câu `INSERT`**, vẫn là `varchar(255)` và được nạp bằng
`req.headers["user-agent"]` — **không phải dữ liệu người dùng, mà là dữ liệu KẺ TẤN CÔNG**, đặt tuỳ ý trong một
header. Và `authService.ts` khẳng định thẳng:

> *"**HAI NGUYÊN NHÂN ĐÃ BIẾT CỦA LƯỢT HỎNG NAY ĐỀU ĐÃ ĐÓNG**… nên **bất cứ lỗi nào còn lọt tới `catch` này đều là
> dấu hiệu của một thứ KHÁC HẲN**"*

Phép đo **bác bỏ** câu ấy: còn một nguyên nhân **thứ ba**, và nó **do bên ngoài điều khiển**.

Lưới `phienTrungTrongMotGiay.test.ts:262-265` thậm chí ghi lại rằng ca cũ *"dùng một chuỗi 300 ký tự để ép `22001`"*
và phải đổi đường ép lỗi vì cột đã thành `text` — chuỗi 300 ký tự được **dời khỏi** `sessionToken` mà **không ai
hỏi cột kế bên có trần không**.

### Bằng chứng ĐO ĐƯỢC

Cơ chế (PostgreSQL, giao dịch tạm, đã `ROLLBACK`, bảng TEMP):

```
$ psql -d aoi_management_test -c "BEGIN; CREATE TEMP TABLE t_probe(x varchar(255));
                                  INSERT INTO t_probe VALUES (repeat('x',300)); ROLLBACK;"
ERROR:  value too long for type character varying(255)
```

Đầu-cuối trên máy chủ sống (`engineer1` #51, `User-Agent` dài 3.770 ký tự):

```
$ psql -t -c 'select max(id) from user_sessions'                      →  290

$ curl -s -c c2.txt -A "<3770 ký tự>" -X POST /api/auth/login ...
{"success":true,"user":{"id":51,...}}                                    HTTP=200   ← ĐĂNG NHẬP THÀNH CÔNG

$ psql -c 'select id from user_sessions where id > 290'
(0 rows)                                                                            ← KHÔNG CÓ HÀNG SỔ

$ curl -s -b c2.txt /api/trpc/auth.me
{"result":{"data":{"json":{"id":51,"username":"engineer1",...}}}}        HTTP=200

$ curl -s -b c2.txt -X POST /api/trpc/auth.logout
{"result":{"data":{"json":{"success":true}}}}                            HTTP=200   ← "ĐĂNG XUẤT THÀNH CÔNG"

$ curl -s -b c2.txt /api/trpc/auth.me
{"result":{"data":{"json":{"id":51,"username":"engineer1",...}}}}        HTTP=200   ← VẪN ĐỦ HỒ SƠ
```

Đối chứng: cùng lượt đo ở C-1, một phiên **CÓ** hàng sổ thì `auth.logout` ⇒ `auth.me` = `null`. Biến duy nhất đổi
giữa hai thí nghiệm là **độ dài header `User-Agent`**.

`thuHoiPhienTheoToken` chạy đúng nhưng lật **0 hàng**; `invalidateAuthSession` dọn cache; rồi
`sdk.xacThucTho` gặp *"không có hàng ⇒ CHO QUA"* và cấp lại danh tính. Ba cơ chế đều đúng phần của mình.

### Hậu quả thật nếu không vá

Kẻ tấn công **tự chọn** cho phiên của mình trở nên:
- **vô hình** với `session.list` / `user.getSessions` (nạn nhân không thấy thiết bị lạ),
- **ngoài tầm** `session.revoke`, `session.revokeAll`, `user.revokeAllSessions` **và** `auth.logout`,
- sống tới `exp` (đo được: **2027-08-09**), không có cơ chế sản phẩm nào thu hồi được.

Đây là **cách vô hiệu hoá toàn bộ Task 2 bằng một dòng header**, và nó cũng vô hiệu hoá lượt thu hồi 236 phiên
của Pha 7 cho mọi phiên đúc theo kiểu này.

⚠ **Lượt đo này đã tạo ra một token như thế cho `engineer1` (#51).** Nó không nằm trong sổ nên không thu hồi được
bằng giao diện. Đường vô hiệu hoá khả dụng ngay: đặt `passwordInvalidBefore` cho #51 (vai `engineer` **không** thuộc
tập miễn trừ ⇒ `chanNeuPhaiDoiMatKhau` chặn), **hoặc** xoay `COOKIE_SECRET`/`JWT_SECRET`.
Giá trị token đã bị xoá khỏi đĩa; nó chỉ còn trong nhật ký phiên làm việc này.

### Đường vá đề xuất

1. **Cắt tại nguồn** (nhỏ nhất, chặn ngay): `deviceName: audit.userAgent?.slice(0, 255)` và làm tương tự cho
   `ipAddress` (`varchar(45)`). Đây là bản vá nên deploy trước.
2. **Đúng lớp lỗi** (theo chính lý lẽ của 0317): đổi `deviceName` → `text`. Trần đoán trên dữ liệu ngoài tầm kiểm
   soát là lớp lỗi, không phải con số cụ thể.
3. **Cắt đường im lặng**: đưa `demLoiGhiSoPhien()` ra một bề mặt quan sát được (health/metrics). Hôm nay bộ đếm chỉ
   đọc được **từ lưới** — tức nó chứng minh được "không im lặng" trong test, còn trong sản xuất thì vẫn im lặng.
4. **Xem lại nhánh fail-open** `sdk.ts:472` (*"không có hàng ⇒ cho qua"*). Nó có lý do tương thích ngược thật (phiên
   cũ trước khi `user_sessions` ra đời), nhưng nó biến **mọi** lượt ghi sổ hỏng thành một lỗ vĩnh viễn. Đề xuất:
   chỉ cho qua khi `iat` của JWT **cũ hơn** một mốc cấu hình được, mọi vé đúc sau mốc ấy **phải** có hàng sổ.
5. **Lưới**: ca *"đăng nhập với `User-Agent` 300 ký tự ⇒ vẫn có hàng `user_sessions`"* trong
   `phienTrungTrongMotGiay.test.ts` — đúng chỗ ca 300-ký-tự vừa bị dời đi.

---

## I-1 — IMPORTANT · Tập "người đọc bí mật `user_secrets`" được suy **CHỈ TỪ MỘT FILE** ⇒ hai lưới cùng mù

**File:** `server/routers/deployProcedureScan.ts:765` — `const duong = join(goc, "server", "db", "auth.ts");`
Người tiêu thụ: `server/_core/hangRaoKhongAiCanh.test.ts:75` (luật KHAI BẮT BUỘC) và
`server/routers/userExposureScan.test.ts:171` (C-2 §5, quét **giá trị**, gác cổng ở
`quetRoBiMat: if (!DOC_BI_MAT.some(r => src.includes(r))) continue;`).

### Cái sai

Task 4a gộp hai bản sao của vị từ về **một chủ** — đúng bài học, nhưng chủ ấy **ghim cứng một đường dẫn**. Câu lưới
hứa là *"∀ thủ tục tRPC trong `server/**` gọi một NGƯỜI ĐỌC BÍ MẬT của `user_secrets`"*; câu nó chứng minh là
*"∀ thủ tục gọi một hàm **khai trong `server/db/auth.ts`** …"*. Danh sách **VÙNG MÙ ĐƯỢC KHAI** của file (3 mục)
**không** có mục này. Và vì Task 4a hợp nhất hai lưới về một chủ, một điểm mù nay che **cả hai** thay vì một.

### Bằng chứng ĐO ĐƯỢC (đột biến trên đĩa, đã hoàn nguyên)

Thêm vào `server/routers/twoFactorRouter.ts` một thủ tục đọc `user_secrets` **thẳng bằng drizzle** rồi
**trả hạt giống TOTP nguyên vẹn** cho client:

```ts
rotHatGiong: protectedProcedure.query(async ({ ctx }) => {
  const db = await getDb(); …
  const { userSecrets } = await import("../../drizzle/schema");
  const hang = await db.select({ twoFactorSecret: userSecrets.twoFactorSecret })
                       .from(userSecrets).where(eq(userSecrets.userId, ctx.user.id)).limit(1);
  return { twoFactorSecret: hang[0]?.twoFactorSecret ?? null };   // ← HẠT GIỐNG RA TRÌNH DUYỆT
}),
```

```
$ npx vitest run server/_core/hangRaoKhongAiCanh.test.ts \
                 server/routers/userExposureScan.test.ts \
                 server/routers/hoTuyenSongSong.test.ts
 Test Files  3 passed (3)
      Tests  39 passed (39)

$ npm run check
(exit 0, 0 lỗi)
```

Đây **đúng lượt rò mà C-2 của Pha 7 đã đo** (*"thêm `twoFactorSecret` vào `user.get2FAStatus` ⇒ check SẠCH, 58/58
XANH"*), tái hiện được ở HEAD qua một cánh cửa khác: **không đi qua `server/db/auth.ts`**.

### Hậu quả thật nếu không vá

Ai đọc được hạt giống TOTP tự sinh mã hợp lệ **mãi mãi** ⇒ vé một-lần (Pha 7 Task 6), sổ chống phát lại
`totp_consumed` (Pha 7 Task 5), step-up mỗi lượt (Pha 6) **đều thành trang trí**. Cả ba lưới được dựng để chặn
đúng chuyện này đều xanh.

### Đường vá đề xuất

- Cho `nguoiDocBiMatCuaUserSecrets` quét **`moiFileDuoi(goc, "server")`** thay vì một đường dẫn ghim (chi phí:
  tiền lọc bằng `src.includes("userSecrets")`, đã là khuôn dùng ở các bộ suy khác trong chính file này).
- **Hoặc/và** thêm một **cầu chì đảo lượng từ**: *"∀ file sản xuất dưới `server/**` nhập `userSecrets` từ
  `drizzle/schema` mà KHÔNG phải `server/db/auth.ts` ⇒ ĐỎ"*. Hôm nay tập ấy **rỗng** (đo được: chỉ
  `_core/publicUser.ts` nhập, và chỉ để lấy kiểu) ⇒ chốt một con số đang bằng 0 thì rẻ.

---

## I-2 — IMPORTANT · "∀ TUYỆT ĐỐI: không đơn vị nào trả NGUYÊN HÀNG" đi lọt bằng **một biến trung gian**

**File:** `server/routers/hoXacThucScan.ts:430-444` (`bangTraTho` — `if (!chieu && ts.isCallExpression(e))`) ·
lưới `server/routers/hoTuyenSongSong.test.ts:261-274` (§3).

### Cái sai

`bangTraTho` chỉ nhận `return <lời gọi>`. Một `return <định danh>` — hình dạng phổ biến nhất của cùng một lỗi —
nằm ngoài lượng từ. Câu lưới hứa (*"∀ đơn vị xử lý trả kết quả một phép đọc THÔ"*) mạnh hơn hẳn thứ nó canh.

### Bằng chứng ĐO ĐƯỢC (hai đột biến, đã hoàn nguyên)

**Đối chứng dương** — dựng lại **đúng** hình dạng cũ:

```ts
getSessions: protectedProcedure.query(async ({ ctx }) => {
  return db.getUserSessions(ctx.user.id);
}),
```
⇒ `2 failed`: **§3 ĐỎ** + §7 ĐỎ. Lưới còn sống.

**Đột biến** — cùng lỗ hổng, thêm đúng một dòng:

```ts
getSessions: protectedProcedure.query(async ({ ctx }) => {
  const hang = await db.getUserSessions(ctx.user.id);
  return hang;                       // ← sessionToken vẫn bay xuống trình duyệt
}),
```
⇒ `1 failed`: **§3 XANH**, chỉ §7 đỏ.

§7 là lưới **HÀNH VI** và nó gọi đích danh **`user.getSessions`** (`hoTuyenSongSong.test.ts:458`). Một thủ tục
**MỚI trong FILE MỚI** mang cùng hình dạng ⇒ §3 mù (đã chứng minh) và §7 không chạm tới ⇒ **không lưới nào bắt**.
Ô §4 (phép thử M3) không cứu được: nó ghép cặp theo **tác động GHI**, còn đây là đường **ĐỌC**.

### Hậu quả thật nếu không vá

`user_sessions.sessionToken` là **khoá phiên**. Bất biến quan trọng nhất của Task 5 chỉ đứng vững nhờ một ca hành vi
gắn cứng vào một tên thủ tục — đúng khuôn *"∃ x"* mà Task 4a vừa bỏ ra để đổi lấy *"∀ x"* ở trục bên cạnh.

### Đường vá đề xuất

Theo dõi biến (khuôn `hatGiongCua()` ở `userExposureScan.test.ts:617` đã làm đúng việc này cho trục bí mật —
dùng lại, đừng viết bộ suy thứ N+1). **Hoặc** đảo lượng từ sang trục KIỂU, đúng khuôn `KhongMangBiMat`:
*"∀ thủ tục có tác động đọc trên bảng tài nguyên xác thực ⇒ handler phải KHAI `Promise<PublicSession[]>`
(hay tương đương)"* — cổng ấy bắt lúc **biên dịch** và không quan tâm mã đi qua bao nhiêu biến.

---

## I-3 — IMPORTANT · §1a của lưới Task 1 **không** hiệu chuẩn thứ tên nó nói

**File:** `server/_core/buocDoiMatKhauMoiBeMat.test.ts:266-274` · vị từ `duocPhu` ở dòng 245-246.

### Cái sai

```ts
const ho = quetDiemXacThuc("tong-hop.ts", ma).filter((d) => !duocPhu(d) || d.boQua || !d.tuCanh);
expect(ho.length, `bộ nhận diện MÙ với hình dạng "${ten}"`).toBeGreaterThan(0);
```

Ba vế **hợp** (`||`) trong đó `!d.tuCanh` đúng với mọi mã tổng hợp không tự canh ⇒ ô này thoả **bất kể** `duocPhu`
phán quyết thế nào. Nó chứng minh *"bộ dò tìm THẤY một điểm"*, chứ không phải *"bộ dò XẾP điểm ấy là HỞ"* — trong
khi docstring khai: *"Thước chết ⇒ §1 đỏ NGAY, kể cả khi kho mã sạch tuyệt đối"*.

### Bằng chứng ĐO ĐƯỢC (đột biến trên chính vị từ phủ, đã hoàn nguyên)

```ts
const duocPhu = (_d: DiemXacThuc): boolean => true;   // ⇒ cổng §4 bị VÔ HIỆU HOÁ hoàn toàn
```
```
$ npx vitest run server/_core/buocDoiMatKhauMoiBeMat.test.ts
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

**14/14 XANH** — kể cả §1a, §4 và §4b. Tức toàn bộ lượng từ chính có thể bị tắt mà không một ô nào đỏ.

### Hậu quả thật nếu không vá

Đây là **lưới canh lưới**. Một lượt "dọn dẹp" `duocPhu` (thêm một nhánh tha, đổi thứ tự `||`) sẽ mở lại 12 bề mặt
mà **không có tín hiệu nào**. Cùng lớp với C-1 của Pha 5 (*hai cổng độc lập cùng canh một TẬP*).

### Đường vá đề xuất

§1a phải khẳng định **đúng vị từ mà §4 dùng**, với `DIEM_CHUNG_CUONG_CHE` giả định `true` (như §1b đã làm đúng):

```ts
const phu = (d) => (d.loai === "xt" && !d.boQua) || d.tuCanh;   // cùng công thức, cục bộ hoá
for (const [ten, ma] of MA_HO) {
  expect(quetDiemXacThuc("tong-hop.ts", ma).filter((d) => !phu(d)).length,
    `hình dạng "${ten}" KHÔNG bị xếp là HỞ`).toBeGreaterThan(0);
}
```
…và tách `duocPhu` thành `phuTheoHinhDang(d)` (dùng chung cho §1a/§1b/§4) ⊕ `laTuCanhGhim(d)`, để §1 hiệu chuẩn
**đúng** mảnh mà §4 tin.

---

## M-1 — MINOR · `drizzle/0317_session_token_text.sql:6-7` tự khai một khoản nợ **không tồn tại**

Header của mig ghi:

> *"⚠ NỢ SỔ SÁCH: lượt áp đi NGOÀI `scripts/migrate-standalone.mjs`, nên bảng `__applied_migrations` **không có
> hàng nào** cho `0317` trên cả hai DB."*

Đo được:

```
aoi_management        401 | 0317_session_token_text.sql | 2026-08-10 07:26:15.534376 | t
aoi_management_test   385 | 0317_session_token_text.sql | 2026-08-10 07:26:15.628428 | t
```

Cả hai DB **đã có hàng**. Đây đúng lớp lỗi mà commit cuối `3add9595` vừa vá cho 0316 (*"0316 thôi tự khai 'CHƯA ÁP'
— chú thích cũ đã gây một kết luận sai"*), sót lại ở file ngay bên cạnh trong cùng lượt.
**Vá:** sửa hai dòng ấy (một chú thích sai về trạng thái đã gây **một** kết luận sai trong chính pha này).

---

## M-2 — MINOR · Nhánh D3 của lưới Task 3 gán **cứng** `bang: "users"` cho mọi lượt xoá được nuôi bởi mọi hàm liệt kê

**File:** `server/_core/xoaHangKhongGioiHanTrongTest.test.ts:187-194`.

```ts
if (nguon !== null) {
  ra.push({ …, loai: `hàm:${t}←${nguon}`, bang: BANG_CANH /* "users" */, coGioiHan: false });
}
```

`LIET_KE` khớp `getAll[A-Z]` · `listAll[A-Z]` · `findAll[A-Z]` — tức `getAllMachines`, `getAllProducts`, … Một
`beforeEach(async () => { for (const m of await db.getAllMachines()) await db.deleteMachine(m.id); })` sẽ được ghi là
một lượt **xoá không giới hạn bảng `users`** và làm §4 đỏ với **câu lỗi chỉ sai bảng**. Hôm nay tập vi phạm bằng 0
nên nó chưa nổ, nhưng người gặp nó lần đầu sẽ đi tìm một lượt xoá `users` không tồn tại — đúng thứ `vitest.setup.ts`
vừa được sửa để **không** làm.
**Vá:** suy tên bảng từ chính hàm liệt kê (`getAllUsers`/`getUsersByRole` → `users`; ngoài ra → tên suy từ hậu tố),
hoặc giới hạn `LIET_KE` vào đúng các hàm liệt kê `users`.

---

## M-3 — MINOR · Với tài khoản **KHÔNG** xác thực nội bộ, ô `password` của cả hai tuyến tắt 2FA là **trang trí**

**File:** `server/routers/twoFactorRouter.ts:225-232` · `server/routers/userRouters.ts:361-367`.

```ts
if (laXacThucNoiBo(hoSo.loginMethod) && biMat.passwordHash) {
  const ok = await bcrypt.compare(input.password, biMat.passwordHash);
  if (!ok) throw …;
}
```

Vị từ đúng theo chủ ý đã khai (**chống nhà tù**: tài khoản SSO không có hash cục bộ). Nhưng hệ quả cần **được nói ra**:
với người dùng SSO, tắt 2FA vẫn chỉ cần **một** yếu tố, và `z.string().min(1)` khiến hợp đồng API trông như đòi hai.
Đáng chú ý về mặt lưới: **hai tuyến KHỚP nhau** nên `hoTuyenSongSong` xanh — một ví dụ sạch của *"khớp TẬP mà cả hai
cùng hở"*. Cặp ấy chỉ so **A với B**, không so **A với một chuẩn**.
**Vá đề xuất:** ghi vào docstring + `MIEN_TRU.lyDo`; nếu muốn siết, dùng bước-up SSO (re-auth OIDC) thay cho mật khẩu.

---

## M-4 — MINOR · Hai bề mặt client song song cho cùng một màn "phiên đăng nhập"

`client/src/pages/SessionManagement.tsx:63` gọi `trpc.user.getSessions`;
`client/src/components/SessionManagement.tsx:56` gọi `trpc.session.list`. Task 5 vá **cả hai** tuyến máy chủ (tốt),
nhưng trang `pages/…` **không** dùng `isCurrent` (grep: 0 điểm), nên sau bản vá người dùng vẫn không phân biệt được
phiên đang dùng — trong khi component `components/…` dùng `isCurrent` ở 4 chỗ.
Lượng từ họ-tuyến-song-song cố ý **chỉ quét `server/**`**; trục client là vùng mù chưa được khai.
**Vá:** hợp nhất về một tuyến (hoặc một hook dùng chung), và bổ sung một lượng từ cho trục client.

---

## Những thứ tôi ĐÃ NGHI rồi **RÚT LẠI SAU KHI ĐO**

Ghi lại vì phần này cũng là kết quả:

1. **"Bộ nhớ đệm phiên trả hàng chưa che bí mật ở nhánh cache-hit"** — đọc `sdk.ts:408-411` thấy `return cachedUser`
   trước lượt `redactServerOnlyUserFields`. **Sai:** `setCachedAuthUser` (`authSessionCache.ts:136`) đã che
   **trước khi** ghi. Hai nhánh giống nhau, đúng như docstring khai.
2. **"Mig 0317 chưa vào sổ ⇒ `db:migrate` lượt sau sẽ vỡ"** — **Sai** hai lần: sổ **có** hàng (M-1), và
   `ALTER … TYPE text` vốn không vỡ khi chạy lại.
3. **"Tập `MIEN_TRU` 15 cặp là một vé trắng"** — **Sai:** §2 ghim **chữ ký chênh lệch chính xác**, §6 cấm lời khai
   rộng hơn tập bất đồng, và §3 số cặp bất đồng phải **bằng đúng** `SO_MIEN_TRU`. Ba ràng buộc đóng đủ ba đường thoát.
4. **"`twoFactor.disable` đổi hợp đồng API sẽ làm vỡ một client chưa sửa"** — **Sai:** `grep` toàn `client/` cho đúng
   **một** điểm gọi (`TwoFactorSetup.tsx:73`, đã sửa) + một khối tài liệu (`ApiDocs.tsx:1680`, đã sửa).
5. **"Task 3 để lại rác admin trong DB test làm `setupAdmin` đỏ"** — **Sai:** `select … where role='admin'` trên
   `aoi_management_test` cho **0 hàng** (và `count(*) from users` = 0).

---

## Ghi chú vận hành

- Không sửa mã, không commit, không `git add`, không DDL/DML sản xuất, không restart máy chủ.
  Lượt kiểm `varchar(255)` chạy trên **DB test**, trong một giao dịch **`ROLLBACK`**, trên một **bảng TEMP**.
- Bốn đột biến (I-1, I-2 ×2, I-3) đều hoàn nguyên bằng `git checkout HEAD -- <file>`;
  `git status --porcelain -- server/ client/ shared/ scripts/ drizzle/` **rỗng**.
- Phiên `engineer1` của lượt đo C-1 đã bị thu hồi (hàng 290, `isActive = f`).
  **Phiên của lượt đo C-2 KHÔNG thu hồi được** — xem khối cảnh báo trong C-2.
