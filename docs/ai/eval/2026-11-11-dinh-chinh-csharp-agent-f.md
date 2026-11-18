# Đính chính: số C# agent-f đêm 09/11 và 10/11 là âm tính giả của thiết bị đo

Người đo: do-model, 11/11 00:30–01:00. Đính chính cho `2026-11-09-agent-f-baseline.*` (0750a413c) và `2026-11-10-dem-ab.md` (56e33affb). Hai tệp đó giữ nguyên, không sửa đè.

## Tóm tắt

- **Ở cả 18 lượt C# agent-f (2 bài × 9 lượt, hai đêm, cả D0 lẫn D), agent không lần nào build hay chạy test được.** Có 68 lần `dotnet build`/`dotnet test` được phép chạy, và cả 68 lần đều thoát mã 1 vì cùng một lỗi NuGet: `ConfigurationDefaults` ném ngoại lệ, `Value cannot be null. (Parameter 'path1')`.
- **Nguyên nhân là thiết bị đo, không phải model và không phải sản phẩm.** `may.mts` (`D:/DO-AI/may-3013`, ngoài repo) khởi động máy :3013 với một danh sách biến môi trường tự chế, thiếu `ProgramFiles`/`ProgramFiles(x86)`. Sandbox lệnh của sản phẩm (`repoCommandSandbox.ts`, `BIEN_MOI_TRUONG_CHO_PHEP`) đã cho hai biến này đi qua từ 19/10, đúng để chữa lỗi này. Nhưng :3013 không có hai biến đó nên sandbox cũng không có gì để chuyển cho tiến trình con.
- Bộ chấm chạy trong shell có env đầy đủ, nên vẫn chấm đúng. Chỉ agent là làm việc mù với C#.
- Hệ quả:
  - Mọi số C# agent-f của hai đêm không dùng được.
  - Kết luận "chênh D0 và D nằm hết ở 2 bài C#" (56e33affb) không còn nghĩa.
  - So sánh NEN_MOC chỉ còn trên 4 bài không phải C#: **12/12 ở cả hai nhánh**, không có tín hiệu.
- Trục H không bị ảnh hưởng (xem §4).

## 1. Bằng chứng từ `_test` (chỉ đọc)

Khe do dieu-phoi cho lúc 11/11 00:30. Có 4 truy vấn trong khoảng 00:31:39–00:33:06, mỗi truy vấn đọc 18 hàng `ai_agent_runs` (cột `suKien`) theo `runId` của 18 lượt C#.

- Vai `avi_app`, `default_transaction_read_only = on` cộng `SET TRANSACTION READ ONLY`. Có kiểm `current_database() = aoi_management_test` và `transaction_read_only = on`.
- Không ghi gì. Kết nối đóng trong `finally`.

Tổng cộng 148 lần gọi `run_command`:

| Nhóm | Kết quả | Số lần |
|---|---|---|
| biên dịch/test (`dotnet build <đường>`, `dotnet test <đường>`) | **được chạy, cả 68 lần thoát 1, lỗi NuGet `path1`** | 68 |
| biên dịch/test kèm cờ restore (`--no-restore`, `--offline`, `-p:NuGetRestoreTargets=`, `/p:RestorePackages=false`) | từ chối `LENH_CAN_DUYET_TAY` | 24 |
| `dotnet restore …` | từ chối | 19 |
| `dotnet --info` | từ chối | 17 |
| `dotnet nuget …` (list source, locals, add source, delete) | từ chối | 15 |
| `dotnet clean …` | từ chối | 2 |
| đọc (`ls -la ~/.nuget/`, `ls -la /root/.nuget/`) | từ chối | 2 |
| khác (`git status`) | từ chối | 1 |

Thứ tự lệnh trong mọi lượt (18/18) giống nhau. Agent chạy `dotnet build/test` trước, bị lỗi NuGet, rồi lập tức thử `restore`/`nuget`/`--info` hoặc build/test kèm cờ restore. Các lệnh thử đó bị sandbox từ chối, đúng thiết kế: lệnh ngoài tập kiểm chứng thì phải duyệt tay. Agent quay lại `dotnet build/test`, lại bị lỗi, và lặp như vậy tới hết lượt hoặc tới khi tự dừng. Bài nào đạt là nhờ model viết mã đúng mà không lần nào chạy được test.

Danh sách đầy đủ, nguyên văn, với số lần theo bài (dp = cs-dat-phong, nk = cs-nhat-ky):

| Nhóm | Kết quả | Lệnh | Tổng | dp | nk |
|---|---|---|---|---|---|
| biên dịch/test | chạy (thoát 1) | `dotnet test cs-dat-phong/tests/DatPhong.Tests` | 18 | 18 | 0 |
| biên dịch/test | chạy (thoát 1) | `dotnet test cs-nhat-ky/tests/NhatKy.Tests` | 17 | 0 | 17 |
| biên dịch/test | chạy (thoát 1) | `dotnet build cs-nhat-ky/src/NhatKy/NhatKy.csproj` | 13 | 0 | 13 |
| biên dịch/test | chạy (thoát 1) | `dotnet build cs-dat-phong/src/DatPhong/DatPhong.csproj` | 10 | 10 | 0 |
| biên dịch/test | chạy (thoát 1) | `dotnet build cs-dat-phong/src/DatPhong` | 3 | 3 | 0 |
| biên dịch/test | chạy (thoát 1) | `dotnet build cs-nhat-ky/tests/NhatKy.Tests/NhatKy.Tests.csproj` | 3 | 0 | 3 |
| biên dịch/test | chạy (thoát 1) | `dotnet build cs-dat-phong/tests/DatPhong.Tests/DatPhong.Tests.csproj` | 1 | 1 | 0 |
| biên dịch/test | chạy (thoát 1) | `dotnet build cs-nhat-ky/src/NhatKy` | 1 | 0 | 1 |
| biên dịch/test | chạy (thoát 1) | `dotnet test cs-dat-phong/tests/DatPhong.Tests/DatPhong.Tests.csproj` | 1 | 1 | 0 |
| biên dịch/test | chạy (thoát 1) | `dotnet test cs-nhat-ky/tests/NhatKy.Tests/NhatKy.Tests.csproj` | 1 | 0 | 1 |
| biên dịch/test + cờ restore | từ chối | `dotnet test cs-dat-phong/tests/DatPhong.Tests --no-restore` | 7 | 7 | 0 |
| biên dịch/test + cờ restore | từ chối | `dotnet build cs-nhat-ky/src/NhatKy/NhatKy.csproj --no-restore` | 4 | 0 | 4 |
| biên dịch/test + cờ restore | từ chối | `dotnet test cs-nhat-ky/tests/NhatKy.Tests --no-restore` | 3 | 0 | 3 |
| biên dịch/test + cờ restore | từ chối | `dotnet build cs-dat-phong/src/DatPhong/DatPhong.csproj --no-restore` | 2 | 2 | 0 |
| biên dịch/test + cờ restore | từ chối | `dotnet build cs-dat-phong/src/DatPhong -p:NuGetRestoreTargets=""` | 1 | 1 | 0 |
| biên dịch/test + cờ restore | từ chối | `dotnet build cs-dat-phong/src/DatPhong/DatPhong.csproj /p:NuGetRestoreTargets=""` | 1 | 1 | 0 |
| biên dịch/test + cờ restore | từ chối | `dotnet build cs-dat-phong/src/DatPhong/DatPhong.csproj /t:Build /p:RestorePackages=false` | 1 | 1 | 0 |
| biên dịch/test + cờ restore | từ chối | `dotnet build cs-nhat-ky/src/NhatKy --no-restore` | 1 | 0 | 1 |
| biên dịch/test + cờ restore | từ chối | `dotnet build cs-nhat-ky/src/NhatKy/NhatKy.csproj -p:NuGetRestoreTargets=` | 1 | 0 | 1 |
| biên dịch/test + cờ restore | từ chối | `dotnet build cs-nhat-ky/tests/NhatKy.Tests/NhatKy.Tests.csproj --no-restore` | 1 | 0 | 1 |
| biên dịch/test + cờ restore | từ chối | `dotnet test cs-dat-phong/tests/DatPhong.Tests --offline` | 1 | 1 | 0 |
| biên dịch/test + cờ restore | từ chối | `dotnet test cs-nhat-ky/tests/NhatKy.Tests/NhatKy.Tests.csproj --no-restore` | 1 | 0 | 1 |
| restore | từ chối | `dotnet restore cs-nhat-ky/src/NhatKy/NhatKy.csproj` | 7 | 0 | 7 |
| restore | từ chối | `dotnet restore cs-dat-phong/src/DatPhong/DatPhong.csproj` | 6 | 6 | 0 |
| restore | từ chối | `dotnet restore` | 2 | 2 | 0 |
| restore | từ chối | `cd cs-dat-phong && dotnet restore` | 1 | 1 | 0 |
| restore | từ chối | `dotnet restore cs-dat-phong/src/DatPhong` | 1 | 1 | 0 |
| restore | từ chối | `dotnet restore cs-nhat-ky` | 1 | 0 | 1 |
| restore | từ chối | `dotnet restore cs-nhat-ky/src/NhatKy` | 1 | 0 | 1 |
| thông tin | từ chối | `dotnet --info` | 17 | 9 | 8 |
| nuget | từ chối | `dotnet nuget list source` | 9 | 3 | 6 |
| nuget | từ chối | `dotnet nuget locals all --list` | 2 | 1 | 1 |
| nuget | từ chối | `dotnet nuget add source nuget.org` | 1 | 1 | 0 |
| nuget | từ chối | `dotnet nuget delete` | 1 | 1 | 0 |
| nuget | từ chối | `dotnet nuget locals global-packages -l` | 1 | 0 | 1 |
| nuget | từ chối | `dotnet nuget locals http-cache -c` | 1 | 0 | 1 |
| clean | từ chối | `dotnet clean cs-dat-phong/src/DatPhong/DatPhong.csproj` | 1 | 1 | 0 |
| clean | từ chối | `dotnet clean cs-nhat-ky/src/NhatKy/NhatKy.csproj` | 1 | 0 | 1 |
| đọc | từ chối | `ls -la /root/.nuget/` | 1 | 1 | 0 |
| đọc | từ chối | `ls -la ~/.nuget/` | 1 | 1 | 0 |
| khác | từ chối | `git status` | 1 | 0 | 1 |

**Trả lời giả thuyết "harness chặn dotnet build/test (L2)":** không đúng như phát biểu. Dạng thường `dotnet build/test <đường>` không bị chặn: nó được chạy 68 lần. Thứ chặn agent là lỗi env của **thiết bị đo**. 80 lệnh bị từ chối là phản ứng của model trước lỗi NuGet. Dữ liệu này **không** cho thấy cần nới danh sách lệnh cho phép, vì khi env đúng thì dạng thường tự restore từ cache máy, đúng như lời từ chối của sandbox nói với model ("dotnet build|test &lt;path&gt; restore NuGet packages automatically (offline, …"). Có nên cho phép `--no-restore` hay không thì chỉ đo được sau khi đo lại với env đúng.

## 2. Dựng lại trên bản sao

Lấy bản sao `sandbox-projects/agent-f/cs-dat-phong` (bỏ `bin/obj`) vào scratchpad. Chạy `dotnet build src/DatPhong/DatPhong.csproj` với env = (danh sách giữ của `may.mts` cũ) ∩ (`BIEN_MOI_TRUONG_CHO_PHEP`) + `BIEN_MOI_TRUONG_DAT_THEM`, tức đúng env mà agent nhận:

```
keep may.mts hien tai: ma thoat 1 · path1 true · Build succeeded false · bien 22 (co ProgramFiles: false)
keep + ProgramFiles, ProgramFiles(x86): ma thoat 0 · path1 false · Build succeeded true · bien 24 (co ProgramFiles: true)
```

Chỉ khác đúng hai biến. Bản sao đã xoá sau khi chạy.

## 3. Sửa thiết bị đo

`may.mts` (ngoài repo) giờ dựng env trong hàm `envGoc()`:

- Danh sách giữ = `BIEN_MOI_TRUONG_CHO_PHEP` import trực tiếp từ `server/services/aiLocalTools/repoCommandSandbox.ts` (cùng nguồn với sandbox), hợp với danh sách cũ. So không phân biệt hoa/thường.
- Thiếu `PROGRAMFILES` hoặc `PROGRAMFILES(X86)` thì dừng, không khởi :3013.
- Có lệnh mới `may.mts bien` in **tên** các biến sẽ giữ, không in giá trị. Tên được ghi thêm vào `trang-thai.json` (`bienGiu`) mỗi lần khởi.
- sha256 `may.mts` = `c48ce16d6180a982e4a8d3abc47bf9169dfa34f9546dc8befb2528cdd4597df6`.

Lưới `D:/DO-AI/may-3013/may-env.test.mts` (sha256 `1cc6f86da3e3084e5026159aa6a9beb6ee8eeef3bfe8b5f36c52ea99cd5ee38a`), chạy bằng `node node_modules/tsx/dist/cli.mjs --test D:/DO-AI/may-3013/may-env.test.mts` từ worktree:

1. Tên mà `may.mts bien` in ra phải phủ mọi khoá của `moiTruongDaLoc(process.env)`, tức hàm lọc env thật của sandbox sản phẩm, trừ các biến đặt thêm. Không có hàm `envSachChoTienTrinhCon` trong repo; hàm lọc tên là `moiTruongDaLoc`.
2. Có `PROGRAMFILES` và `PROGRAMFILES(X86)`.
3. Env máy thiếu `ProgramFiles` thì `may.mts` từ chối.

Kết quả: **3/3 xanh**. Đột biến trên bản sao (trỏ bằng `MAY_MTS`, bản gốc không đổi sha) **5/5 đỏ**:

- d1: về danh sách cũ, bỏ nguồn chung và bỏ chặn: 3 đỏ.
- d2: lọc bỏ ProgramFiles và bỏ chặn: 3 đỏ.
- d3: chỉ bỏ chặn: 1 đỏ.
- d4: bỏ nguồn chung, giữ chặn: 2 đỏ.
- d5: lệch một biến khác (`PATHEXT`): 1 đỏ.

## 4. Trục H không bị ảnh hưởng

Trục H gọi model một lần, không có tool, nên agent không chạy `dotnet` qua :3013. Bộ chấm (`tasks/<ngôn ngữ>/<bài>/check.mjs` → `lib/chay.mjs` → `codegen-chay-duoc/cham.mjs`) gọi `execFile("dotnet", …)` trong tiến trình run-eval và kế thừa `process.env` đầy đủ của shell chạy đêm (Git Bash có `PROGRAMFILES`). Bằng chứng:

- 9/12 mẫu H-cs2 đêm 10/11 được bộ chấm biên dịch và chạy đạt. Nếu thiếu env thì không mẫu nào qua được.
- kiem-dinh biên dịch lại độc lập 12 mẫu: 3 mẫu trượt **chỉ** lỗi CS0122, 9 mẫu đạt biên dịch được.
- Đêm 09/11 trục H có H-cs1 3/3 và H-cs3 3/3.
- Ở các lượt agent-f, bộ chấm in "All projects are up-to-date for restore" và có lượt đạt 15/15.

Vì vậy H-cs2 (5/6, 4/6, và 0/3 đêm 09/11) cùng các bài cs khác trên trục H là số thật. CS0122 ở H-cs2 nay có bằng chứng biên dịch (kiem-dinh), không còn chỉ suy từ đọc mã.

Bổ sung từ kiem-dinh: mỗi khối H-cs2 gồm 3 mẫu chạy liền nhau trên cùng trạng thái máy, nên các mẫu có thể tương quan. Fisher giả định độc lập nên p có thể lạc quan. Các so sánh đều không có ý nghĩa, nên kết luận "không phân biệt được" không đổi.

## 5. Số đã đính chính

| | Trước (56e33affb) | Sau đính chính |
|---|---|---|
| agent-f D0 / D (đủ 6 bài) | 15/18 / 13/18 | **không dùng được**: 6/18 mẫu mỗi nhánh là C# đo hỏng |
| agent-f D0 / D, 4 bài không phải C# | (không tách) | **12/12 / 12/12** |
| D0 10/11 so với D0 09/11, bỏ py-dang-ky | 12/15 = 12/15 | chỉ còn js, py-kho-cache, ts: **9/9 = 9/9** |
| cs-dat-phong, cs-nhat-ky (09/11 và 10/11) | 1/3, 2/3, 0/3, 1/3, 2/3, 1/3 | **âm tính giả của thiết bị đo**: agent chưa lần nào chạy được build/test |
| H-cs2 trục H | 5/6, 4/6 | giữ nguyên (§4) |
| py-dang-ky | 6/6, do đổi thước | giữ nguyên ghi chú |

Số "agent-f 12/18 trước, 15/18 sau" trong 80-ai §8 gồm 6 mẫu C# đo hỏng mỗi bên, nên cần đính chính ở đó (chu-du-an-HST).

Phạm vi bị ảnh hưởng: mọi lượt agent-f chạy qua `may.mts` cũ (từ 08/11). Với js, py, ts, lỗi này không đụng tới vì NuGet là thứ duy nhất cần `ProgramFiles`. Các lệnh của những bài đó chưa được đọc ở mức từng lệnh; tỉ lệ đạt 12/12 không gợi ý vấn đề gì.

## 6. Việc tiếp theo

- Đo lại C# agent-f ×3 mỗi nhánh với `may.mts` đã sửa. Kế hoạch gửi dieu-phoi để duyệt khe đêm 11/11.
- Trước mỗi lần `khoi`, chạy `may-env.test.mts` và `may.mts bien`, rồi ghi tên biến vào nhật ký đêm.
