# Bộ đo NGẪU NHIÊN — "AI code được, tự sinh code và CHẠY ĐƯỢC"

Câu hỏi đo (chủ dự án, 2026-10-18): *AI Local có tự sinh mã CHẠY ĐƯỢC trên nhiều ngôn ngữ + platform không — đo bằng
BÀI NGẪU NHIÊN, không bằng bộ cũ mà hệ thống đã được chỉnh theo?* Trả lời bằng MÁY CHẠY TEST (hiển thị + ẩn), không bằng
người đọc mã, không tin lời khai của model/agent.

```
kho/<id>/            72+ bài MỚI viết cho bộ này (9 ngôn ngữ × 3 mức) — luật kho ở dưới
lib/                 moiTruong (toolchain) · kho (nạp + vân tay) · chon (rút phân tầng có seed) · cham (7 trình chấm)
                     · trichTep (trích tệp từ câu trả lời) · cauHoi (prompt a/b) · goiModel · baoCao
kiem-thuoc.mjs       KIỂM THƯỚC kho (offline, bắt buộc)
mot-luot.mjs         đường (a) MỘT LƯỢT — raw (trục M) | pipeline (trục H) | mau/khung/sai (kiểm thước)
agent.mjs            đường (b) AGENT máy chủ /api/ai/agent/runs | mau/khung/gian-lan/sai (kiểm thước)
vscode.mjs           đường (c) extension VSCode headless (giao cho vscode-e2e/run.mjs, ngân hàng = vscode-ngan-hang.mjs)
multipl-e/           lát chuẩn công khai MultiPL-E — BÁO RIÊNG (nguy cơ nhiễm)
mau-khung/, tao-bai.mjs   khuôn + dựng khung bài mới
reports/             báo cáo JSON (.gitignore)
```

## Ngôn ngữ / toolchain (đo 2026-10-18 trên máy này)

| lang | kiểu chấm | toolchain | ghi chú |
|---|---|---|---|
| py | pytest | `C:\Users\Admin\AppData\Local\Python\bin\python.exe` 3.14.6 + pytest 9.1.1 (`AI_EVAL_PYTHON`) | ⚠ KHÔNG có tzdata ⇒ bài Python chỉ dùng múi giờ lệch cố định |
| sql | pytest | SQLite 3.50.4 qua `sqlite3` của python trên | cửa sổ, CTE đệ quy, JSON1, UPSERT, RETURNING, STRICT |
| js / ts | node | Node 24.18 (`process.execPath`), TS = tự bóc kiểu (chỉ cú pháp xoá được) | React 19 + esbuild lấy từ `node_modules` của repo (bài `canNodeModulesRepo`) |
| cs | dotnet | .NET SDK 10.0.30x, xUnit 2.9.2 / Test.Sdk 17.11.1 / runner 2.8.2 từ cache NuGet (offline) | |
| java | java | JDK 26.0.1 (`javac` + `java -ea`), không Maven | test = lớp có `main` + `Kt.java` |
| cpp | cmake | CMake 4.4.3 (`C:\Program Files\CMake\bin`) → MSVC VS 2026, C++20 | CMake tự dò MSVC, không cần vcvars64 |
| go | go | **go1.27.2** di động `D:\SOURCES\16.AI\toolchains\go` (`AI_EVAL_GO_ROOT`) | GOTOOLCHAIN=local, GOPROXY=off, GOCACHE/GOPATH dưới `toolchains\` |
| rs | cargo | **rustc/cargo 1.99.1** msvc di động `CARGO_HOME=D:\SOURCES\16.AI\toolchains\cargo`, `RUSTUP_HOME=…\rustup` | `cargo test --offline`, linker MSVC có sẵn |
| st | st | **RuSTy 1.0.7** (`plc`, LGPL-3.0) trong Docker: ảnh `st-rusty:1.0.7` (`lib/st/Dockerfile`, .deb chính thức lưu ở `D:SOURCES.AI	oolchainsstdl`, ảnh lưu `…imagesst-rusty-1.0.7.tar` ⇒ `docker load` offline) | `--network none`, ~0,5 s/lượt; prelude `lib/st/prelude-dong-ho-gia.st` = đồng hồ GIẢ `G_NOW` + TON/TOF/TP tất định (timers.st của stdlib KHÔNG nạp); phương ngữ CODESYS — cú pháp Siemens SCL (`#x`, `"FB"`, `REGION`) KHÔNG phân tích được |

Cài Go/Rust (mức người dùng, không admin, không sửa PATH hệ thống) — đã chạy 2026-10-18:

```bash
# Go: zip chính thức, kiểm sha256 theo https://go.dev/dl/?mode=json
curl -sSL https://go.dev/dl/go1.27.2.windows-amd64.zip -o D:/SOURCES/16.AI/toolchains/_tai/go1.27.2.windows-amd64.zip
sha256sum …/go1.27.2.windows-amd64.zip   # 1314008898bd40df77af4b014f777f08873dbdfbcd3d92308728ee03304fe04f
unzip -q …/go1.27.2.windows-amd64.zip -d D:/SOURCES/16.AI/toolchains        # ⇒ toolchains/go
# Rust: rustup-init chính thức (kiểm .sha256), toolchain stable msvc, profile minimal
curl -sSL https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe -o …/_tai/rustup-init.exe
$env:CARGO_HOME="D:\SOURCES\16.AI\toolchains\cargo"; $env:RUSTUP_HOME="D:\SOURCES\16.AI\toolchains\rustup"
…\_tai\rustup-init.exe -y --no-modify-path --profile minimal --default-toolchain stable --default-host x86_64-pc-windows-msvc
```
Trình chấm tự đặt GOROOT/CARGO_HOME/RUSTUP_HOME/PATH cho tiến trình con (`lib/moiTruong.mjs`); máy khác ⇒ đặt biến
`AI_EVAL_GO_ROOT`, `AI_EVAL_CARGO_HOME`, `AI_EVAL_RUSTUP_HOME`, `AI_EVAL_PYTHON`. Thiếu toolchain ⇒ exit 2 (không thành "model trượt").

## LUẬT KHO BÀI — không ai được chỉnh kho theo kết quả

1. Bài MỚI chỉ thêm vào CUỐI (id mới, `tao-bai.mjs`); không xoá bài đã đo.
2. KHÔNG sửa bài (đặc tả, test, mẫu, khung) sau khi bài đã xuất hiện trong một lượt đo — trừ **lỗi đặc tả** (đặc tả mâu
   thuẫn/ thiếu so với test, test sai so với đặc tả), và khi sửa phải ghi `kho/SUA-LOI.md`: ngày, id, vân tay cũ → mới,
   lỗi gì, bằng chứng (lời giải đúng-theo-đặc-tả bị đánh trượt). "Model trượt nhiều bài này" KHÔNG phải lý do sửa.
3. Mọi báo cáo ghi `seed`, danh sách bài và **vân tay** từng bài (sha256 12 hex của cả thư mục bài) ⇒ kiểm được bài có bị
   sửa sau khi đo. So sánh hai lượt đo chỉ hợp lệ trên CÙNG vân tay.
4. Không ai chỉnh prompt hệ thống / đường ống dựa trên từng bài của kho này rồi báo số trên CHÍNH kho này như "đo mù": chỉnh
   theo kho ⇒ kho trở thành bộ cũ ⇒ cần bài mới (thêm cuối) để đo lại mù.

## KIỂM THƯỚC — offline, bắt buộc trước mọi lượt đo (lệch ⇒ exit 1 ⇒ VỨT số)

```bash
node scripts/ai-eval/ngau-nhien/kiem-thuoc.mjs --song-song 4 --label kt-1          # cả kho (~3–6 phút)
node --test scripts/ai-eval/ngau-nhien/lib/trichTep.test.mjs                        # bộ trích tệp đường (a)
# đường (a)/(b) trên chính mẫu được rút (cùng seed/n với lượt đo):
node scripts/ai-eval/ngau-nhien/mot-luot.mjs --config mau   --seed S --n 27   # 100 %   (+ --config khung / sai ⇒ 0 %)
node scripts/ai-eval/ngau-nhien/agent.mjs    --config gian-lan --seed S --n 27 # 0 %, mọi lượt TEP_TEST_BI_SUA (+ mau/khung/sai)
# đường (c):
node scripts/ai-eval/ngau-nhien/vscode.mjs --tat-ca -- --config mau  --label NN-c-mau-1     # 100 %
node scripts/ai-eval/ngau-nhien/vscode.mjs --tat-ca -- --config goc  --label NN-c-goc-1     # 0 %
node scripts/ai-eval/ngau-nhien/vscode.mjs --tat-ca -- --config dung --label NN-c-dung-1    # model giả qua extension ⇒ 100 %, 0 ngoài, 0 rò
node scripts/ai-eval/ngau-nhien/vscode.mjs --tat-ca -- --config sua-test --label NN-c-st-1  # 0 %, mọi lượt TEP_TEST_BI_SUA
# MultiPL-E:
node scripts/ai-eval/ngau-nhien/multipl-e/run.mjs --config mau      # 3 bài cố định × 8 ngôn ngữ ⇒ 100 %
node scripts/ai-eval/ngau-nhien/multipl-e/run.mjs --config sai      # ⇒ 0 %   (+ rong ⇒ 0 %, mau-chat ⇒ 100 %)
node --test --test-concurrency=1 scripts/ai-eval/ngau-nhien/multipl-e/ghep.test.mjs   # bộ ghép chat với các dạng trả lời
```

`kiem-thuoc.mjs`, mỗi bài: **mẫu ⇒ ĐẠT** (đi qua đường trích của (a), số test đạt phải BẰNG `soTest`) · **khung ⇒ trượt** ·
**đột biến `sai` ⇒ trượt** (và báo nó có lọt test hiển thị không — lọt mà vẫn bị bắt = test ẩn chặt hơn test hiển thị) ·
**sửa tệp test ⇒ bị bắt** (TEP_TEST_BI_SUA) · **thêm tệp cấu hình test (conftest, Directory.Build.props, build.rs, go.work,
CMakeLists con…) ⇒ bị bắt** · **prompt sạch** (câu hỏi (a)/(b) không chứa dòng nào của test ẩn/mẫu).

## ĐO THẬT (tôi không gọi model khi dựng — các lệnh dưới đây để chủ dự án chạy)

Chọn bài: `--seed <chuỗi>` + `--n <số>` (rút PHÂN TẦNG: chia đều cho ngôn ngữ, trong ngôn ngữ luân phiên mức) hoặc
`--tat-ca`; `--only <id,…|lang|muc|kieu>` lọc trước khi rút. Không `--seed` ⇒ sinh từ đồng hồ và in ra. **Dùng seed MỚI
cho mỗi đợt đánh giá** (seed cũ = đề đã lộ cho người chỉnh). Nhãn kết thúc bằng số lượt (`-1`, `-2`…).

```bash
# (a) MỘT LƯỢT — trục M (model thuần, llama-server :8091), nghĩ BẬT trần rộng; và nghĩ TẮT
node scripts/ai-eval/ngau-nhien/mot-luot.mjs --config raw --seed 2026-10-18a --n 27 --max-tokens 16000 --label NN-a-raw-1
node scripts/ai-eval/ngau-nhien/mot-luot.mjs --config raw --seed 2026-10-18a --n 27 --khong-nghi --max-tokens 4000 --label NN-a-rawnt-1
# (a) trục H — đường sản phẩm (cookie tmp/audit-ai/ck.txt của :3010)
AI_EVAL_BASE=http://127.0.0.1:3010 node scripts/ai-eval/ngau-nhien/mot-luot.mjs --config pipeline --seed 2026-10-18a --n 27 --label NN-a-pipe-1
# (b) AGENT máy chủ — server :3010 chạy TỪ worktree này (agent làm trong tmp/ngau-nhien-agent/<id> của repo server)
AI_EVAL_BASE=http://127.0.0.1:3010 node scripts/ai-eval/ngau-nhien/agent.mjs --config agent --seed 2026-10-18a --n 27 --tran-phut 25 --label NN-b-agent-1
#     … đủ 9 ngôn ngữ tự chạy test: server thêm vào AI_REPO_SANDBOX_ROOTS mục
#     `nnbai=Bai ngau nhien|D:SOURCES_ai7_wt	mp
gau-nhien-agent_bai` (restart), rồi mỗi bài dựng vào ĐÚNG thư mục ấy = gốc dự án:
AI_EVAL_BASE=http://127.0.0.1:3010 node scripts/ai-eval/ngau-nhien/agent.mjs --config agent --project-id nnbai --goc-bai tmp/ngau-nhien-agent/_bai --seed 2026-10-18a --n 27 --label NN-b-goc-1
# (c) EXTENSION headless — token avgw_ (scripts/ai-eval/vscode-e2e/tao-token.mjs), lát nhiều tệp
AI_EVAL_BASE=http://127.0.0.1:3010 AI_EVAL_TOKEN=avgw_… node scripts/ai-eval/ngau-nhien/vscode.mjs --seed 2026-10-18a --n 8 -- --config that --label NN-c-that-1
# Lát MultiPL-E (BÁO RIÊNG) — giao thức gốc (hoàn thành thô + stop token) và chế độ chat
node scripts/ai-eval/ngau-nhien/multipl-e/tai.mjs                                    # một lần
node scripts/ai-eval/ngau-nhien/multipl-e/run.mjs --config raw --che-do hoan-thanh --seed 2026-10-18a --n 10 --label MPE-ht-1
node scripts/ai-eval/ngau-nhien/multipl-e/run.mjs --config raw --che-do chat --seed 2026-10-18a --n 10 --max-tokens 16000 --label MPE-chat-1
```

Gom nhiều lượt: `node scripts/ai-eval/ngau-nhien/so-sanh.mjs NN-a-raw- NN-a-pipe- NN-b-agent-` (kiểm vân tay: bài bị sửa
giữa các lượt bị loại khỏi so).

Mỗi lượt in bảng ngôn ngữ × mức (`thuat-toan / thu-vien / ung-dung`) + **số lượt CỤT** (luật số 1 của
`codegen-chay-duoc/README.md`: cụt ≠ 0 ⇒ số là CHẶN DƯỚI). Cổng sức khoẻ llama-server (+ server) trước/sau: chết ⇒ exit 2.
Nhiễu: một lượt n = 27 có biên rộng (±1 bài/ngôn ngữ là bình thường) — để so A/B chạy `--luot 3` cùng seed, hoặc nhiều seed.

### Ba đường — đo cái gì, giới hạn đã biết

| đường | đo | giới hạn (nói thẳng) |
|---|---|---|
| (a) một lượt | model viết đủ các tệp `tepGiai` trong MỘT câu trả lời; bộ trích nhận dòng `// tệp: …`, chuỗi thông tin rào, dòng đứng trước khối | không cho model chạy thử; thiếu tệp ⇒ TRƯỢT (`THIEU_TEP`) |
| (b) agent máy chủ | model tự đọc/ghi/chạy lệnh trong dự án bài | từ 241e1880f agent chạy được test MỌI ngôn ngữ theo khuôn cố định (`lib/cauHoi.mjs` `lenhTest` — đề bài nêu đúng lệnh, mỗi lệnh một `run_command`): `python -m pytest <tệp>` · `node --test <tệp>` · `dotnet test <Bai.csproj>` · `javac -d <out-kt> <src> <test>` → `java -cp <out-kt> HienThiTest` · `cmake -S . -B _b` → `cmake --build _b` → `ctest --test-dir _b` · `go test ./...` · `cargo test --offline`. ⚠ Ba khuôn cuối KHÔNG có ô đường ⇒ chỉ chạy ở GỐC dự án agent: mặc định (dự án `repo`, bài ở `tmp/ngau-nhien-agent/<id>`) C++/Go/Rust vẫn NGOÀI khuôn — báo cáo giữ cột "trong/ngoài khuôn"; muốn đủ 9 ngôn ngữ dùng `--goc-bai` (dưới). Dự án ở `tmp/` (đã .gitignore) vì hàng rào ghi chặn tệp chưa commit (docblock `agent.mjs`) |
| (c) extension | mã THẬT của extension, người duyệt giả bấm "Áp" | chỉ node/pytest/dotnet: allowlist extension ĐÃ có java/cmake/go/cargo (241e1880f) nhưng bộ chấm `vscode-e2e/agent-f/cham.mjs` chỉ hiểu ba kiểu này, và workspace dưới %TEMP% (MSVC từ chối — MSB8029); không bài cần `node_modules` repo (React) |

## Lát MultiPL-E — chuẩn công khai, BÁO RIÊNG

- Nguồn: HuggingFace `nuprl/MultiPL-E` (HumanEval + MBPP dịch: cpp, cs, go, java, js, rs, ts) qua API hàng
  datasets-server; Python từ `openai/openai_humaneval`. CHỈ đề + test, không lời giải của model nào. `tai.mjs` ghi
  `tmp/ngau-nhien/multipl-e/nguon.json` (URL, số hàng, sha256). javatuples 1.2 (Maven Central, kiểm sha1) cho Java.
- ⚠ **NHIỄM DỮ LIỆU HUẤN LUYỆN**: đề công khai từ 2021–2022, model gần như chắc đã thấy ⇒ điểm ở đây không chứng minh
  năng lực tổng quát; chỉ để đặt cạnh bảng công bố. **Không trộn vào số chính.**
- Rút: `--n` bài MỖI ngôn ngữ, luân phiên HumanEval/MBPP theo seed.
- Bù nền tảng (áp như nhau cho mọi lời giải): C++ trên MSVC — `long` 32 bit ⇒ viết lại `long` đơn thành `long long`;
  `<bits/stdc++.h>` ⇒ header thay thế; assert bật trong Release. C# chạy Debug (Debug.Assert có hiệu lực).
- Chế độ `chat` khác giao thức gốc (model trả cả hàm; bộ ghép bỏ `main` của model, gộp import Go, lấy thân lớp Java/C#) ⇒
  so `chat` với `chat`, `hoan-thanh` với bảng công bố.

## Bẫy đã gặp (đừng lặp)

- `python` trên PATH là bí danh WindowsApps (spawn UNKNOWN/treo) ⇒ trình chấm dùng đường tuyệt đối `AI_EVAL_PYTHON`;
  `vscode.mjs` đặt thư mục python thật lên đầu PATH cho harness vscode-e2e.
- Python KHÔNG có tzdata ⇒ `zoneinfo.ZoneInfo("Asia/…")` NÉM — bài Python chỉ múi lệch cố định (Node/Java/Go có tzdata).
- `dotnet` dựng đồng thời: biến `MSBUILDDISABLENODEREUSE=1`, `UseSharedCompilation=false` (nút MSBuild sống khoá tệp ⇒ không
  dọn được thư mục); kiểm thước chạy song song nhiều bài nhưng mỗi bài thư mục riêng; nhiều lượt C# cùng lúc thì `--song-song 3`.
- MSVC từ chối thư mục dựng dưới `%TEMP%` hệ thống (MSB8029) ⇒ mọi thư mục làm việc ở `tmp/` của repo.
- `cargo test` chạy cả doc-test ⇒ khối ``` trong doc comment của lời giải được chạy như test.
- `go test` chạy kèm `go vet` (một phần) ⇒ lỗi vet làm bài trượt (đúng hành vi `go test`).
- `JsonStringEnumConverter` nhận cả tên C# lẫn số dù có naming policy ⇒ đặc tả "chỉ nhận chuỗi kebab" cần converter riêng.
- Bash: đừng nhúng mã có dấu `` ` `` trong `node -e "…"` (bash thay lệnh — đã làm hỏng một docblock khi dựng).
- `docKho` kiểm hình dạng bài TRONG phạm vi `--only` thôi — bài đang viết dở của người khác không chặn lượt của bạn.
- Bash Git ghi đè `cd`; dùng đường tuyệt đối.
- `ctest` chỉ chạy test dự án KHAI (`enable_testing()` + `add_test`) — khung C++ cũ không khai ⇒ agent `ctest --no-tests=error` ĐỎ dù mã đúng (sửa 2026-10-18, `kho/SUA-LOI.md`).
- Agent dựng CMake vào thư mục khác `_b` ⇒ cây dựng đầy `*.cmake` SINH RA; bộ chấm bỏ cây có `CMakeCache.txt` (trừ gốc) để không thành `TEP_CAU_HINH_TEST_MOI` oan.
- Khuôn agent trần 8 token/lệnh ⇒ `javac` nhận THƯ MỤC (`src test`), không liệt kê từng tệp (bài ud Java > 5 tệp).

## Định dạng bài (`kho/<id>/`)

```
kho/<id>/
  bai.json   siêu dữ liệu
  khung/     dự án KHỞI ĐẦU đầy đủ: cấu hình, test HIỂN THỊ, tệp mã khung (chữ ký, thân rỗng/ném lỗi)
  an/        test ẨN, cùng đường tương đối như trong dự án
  mau/       lời giải mẫu — đúng các tệp trong `tepGiai` (chép đè lên khung)
```

| trường | ý nghĩa |
|---|---|
| `id` | `<lang>-<tt\|tv\|ud><số>-<tên-ngắn>` = tên thư mục. `tt` thuật toán/CTDL · `tv` thư viện chuẩn/API platform · `ud` ứng dụng nhỏ NHIỀU TỆP |
| `lang` / `kieu` | `py`/`sql` ⇒ `pytest` · `js`/`ts` ⇒ `node` · `cs` ⇒ `dotnet` · `java` ⇒ `java` · `cpp` ⇒ `cmake` · `go` ⇒ `go` · `rs` ⇒ `cargo` · `st` ⇒ `st` |
| `muc` | `thuat-toan` · `thu-vien` · `ung-dung` |
| `tieuDe`, `deBai` | đặc tả tiếng Việt, ĐỦ để làm đúng không cần đoán: chữ ký chính xác, định dạng trả về, MỌI hành vi biên mà test ẩn kiểm. Test ẩn chỉ được kiểm điều `deBai` nói |
| `tepGiai` | tệp lời giải phải viết (đường tương đối gốc dự án). Đường (a) ghi ĐÚNG các tệp này. `ud` ⇒ ≥ 2 tệp |
| `dinhDanh` | (tuỳ chọn) ký hiệu có trong lời giải — giúp chọn khối mã khi model trả nhiều khối |
| `testHienThi` / `testAn` | tệp test hiển thị (trong `khung/`) / ẩn (trong `an/`) |
| `tepBaoVe` | tệp model/agent KHÔNG được sửa: mọi test hiển thị + cấu hình (`pytest.ini`, `package.json`, `Bai.csproj`, `CMakeLists.txt`, `go.mod`, `Cargo.toml`) + trợ giúp test (`Kt.java`, `kt.hpp`, `kiem_sql.py`) + giao diện cho sẵn không được đổi |
| `soTest` | `{hienThi, an}` = ĐÚNG số test (kiểm thước đòi lời giải mẫu đạt đúng tổng này) |
| `sai` | đột biến `[{tep, tu, den}]`: thay đúng MỘT lần xuất hiện của `tu` trong tệp mẫu ⇒ lời giải sai-nhưng-biên-dịch-được, nên QUA test hiển thị nhưng PHẢI TRƯỢT test ẩn |
| `tranGiay` | (tuỳ chọn) trần thời gian chạy test |
| `canNodeModulesRepo` | (tuỳ chọn) bài dùng `node_modules` của repo (React/esbuild) — loại khỏi đường (c) |

Dựng khung bài mới: `node scripts/ai-eval/ngau-nhien/tao-bai.mjs <id>` (chép khuôn `mau-khung/<lang>/`).

### Quy ước theo ngôn ngữ

| lang | bố cục | test | đếm "một test" |
|---|---|---|---|
| py | module ở gốc (hoặc gói); `pytest.ini` (`pythonpath = .`) | `tests/test_hien_thi.py`, `tests/test_an.py` — pytest, chỉ thư viện chuẩn | mỗi hàm test / mỗi ca parametrize |
| sql | tệp `.sql` lời giải ở gốc; `schema.sql` cho sẵn (bảo vệ) nếu có | pytest + `kiem_sql.py` (`ket_noi`, `chay_kich_ban`, `truy_van`, `cot`) | như py |
| js | `src/*.mjs`, `package.json` `"type":"module"` | `test/hien-thi.test.mjs`, `test/an.test.mjs` — `node:test` + `node:assert/strict`; test PHẲNG | mỗi `test(...)` |
| ts | `src/*.ts` — CHỈ cú pháp TS xoá được (không enum/namespace/parameter properties), import ghi đuôi `.ts` | `test/*.test.ts` như js | như js |
| cs | `Bai.csproj` (xUnit, net10.0) ở gốc; mã `src/*.cs` namespace `Bai` | `tests/HienThiTests.cs`, `tests/AnTests.cs`: namespace `KiemThu`, tên lớp = tên tệp | mỗi `[Fact]` / mỗi ca `[Theory]` |
| java | `src/*.java` package MẶC ĐỊNH | `test/HienThiTest.java`, `test/AnTest.java` có `main` dùng `Kt.chay(...)` … `Kt.ketThuc()`; chạy `java -ea`. Tên lớp test PHẢI kết thúc `Test` (khuôn agent `java -cp <ra> <LớpTest>` tự chạy chỉ lớp `Test*`/`*Test`/`*Tests`) | mỗi `Kt.chay` |
| cpp | `src/*.hpp` + `src/*.cpp`; `CMakeLists.txt` khuôn (mỗi `tests/*.cpp` một tệp chạy, liên kết mọi `src/*.cpp`, và MỘT `add_test` — `ctest` của agent chạy được; bộ chấm vẫn chạy thẳng `.exe` Release), C++20, MSVC `/utf-8 /EHsc /permissive-` | `tests/hien_thi.cpp`, `tests/an.cpp` dùng `kt.hpp` (`kt::chay`, `KT_BANG`, `KT_DUNG`, `KT_NEM`, `KT_GAN`), `return kt::ketThuc();` | mỗi `kt::chay` |
| go | gói `bai` ở gốc module `bai` (`go 1.24`, `go.mod` ở GỐC — khuôn agent `go test ./...` đòi), chỉ thư viện chuẩn | `hien_thi_test.go`, `an_test.go` (package `bai`) | mỗi hàm `TestXxx` cấp cao (test con không tính) |
| rs | crate `bai` (`src/lib.rs`, có thể thêm module, `Cargo.toml` ở GỐC — khuôn `cargo test --offline`), không crate ngoài | `tests/hien_thi.rs`, `tests/an.rs` (test tích hợp, `use bai::…`) | mỗi `#[test]` (tránh khối mã ``` trong doc comment — `cargo test` chạy doc-test) |
| st | POU trong `src/*.st` (biên dịch theo thứ tự tên tệp), khối khai báo vào/ra cho sẵn trong khung — không đổi | `tests/hien_thi.st`, `tests/an.st`: mỗi tệp một `FUNCTION main : DINT` gọi `KT_BOOL/KT_DINT/KT_REAL/KT_TIME` (`tests/kt.st`, bảo vệ), tiến đồng hồ bằng `KT_BUOC(T#10ms)`, kết thúc `main := KT_TONG();`. Mỗi tệp test = một chương trình (prelude + src + kt + test). Tệp `.st` MỚI ngoài `src/` ⇒ `TEP_CAU_HINH_TEST_MOI`. Đường (b)/(c): agent không có lệnh test ST | mỗi lời gọi `KT_*` |

### Luật chất lượng bài

1. Kỳ vọng trong test được suy TỪ ĐẶC TẢ, tính tay/độc lập — không chép đầu ra của lời giải mẫu. Mẫu và test lệch ⇒ đọc lại đặc tả xem bên nào sai.
2. Tất định: không mạng, không phụ thuộc múi giờ/locale máy, không ngẫu nhiên không hạt giống, test đồng thời có biên rộng.
3. Nhanh: test một bài < 10 s (chưa tính biên dịch).
4. Khung biên dịch được (ngôn ngữ biên dịch) nhưng TRƯỢT test.
5. Câu hỏi gửi model = `deBai` + MỌI tệp khung ⇒ không đặt dòng nào của test ẩn/lời giải vào khung hay `deBai`.
6. `node scripts/ai-eval/ngau-nhien/kiem-thuoc.mjs --only <id>` ⇒ phải `KIỂM THƯỚC: ĐẠT`.
7. Kiểm `git check-ignore` mọi tệp bài mới (`.gitignore` của repo nuốt `bin/`, `obj/`, `build/`, `*.db`… ⇒ tệp biến mất khi commit).
