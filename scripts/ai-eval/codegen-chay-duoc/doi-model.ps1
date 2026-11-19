<#
  *** DOI MODEL TREN llama-server :8091 - MOT DUONG DUY NHAT, CO CHO SAN SANG.

  VI SAO CAN MOT KICH BAN THAY VI GO TAY MOI LAN:
    * Do duoc trong dot audit nay: `llama-server` chet giua chung ma bo do van chay tiep, va
      "0/9 dat + 79 luot OOM" suyt duoc ghi thanh khuyet tat cua MODEL thay vi cua MAY. Moi luot
      doi model vi the phai KET THUC bang mot phep do suc khoe THANH CONG, khong phai bang
      "da goi lenh khoi dong".
    * `nohup ... &` KHONG song sot qua tac vu nen cua cong cu (da do) => bat buoc
      `Start-Process -WindowStyle Hidden`.

  !! `-c` (do dai ngu canh) KHONG dung chung mot gia tri cho moi model: 30B-A3B la MoE (chi ~3B
    tham so hoat dong) nen ganh noi 65536; mot model DAY 27B voi KV f16 o cung ngu canh se nuot
    het phan VRAM con lai roi bi driver tu choi. Goi kem -Ctx cho model day.

  !! GOI TU BASH: KHONG pipe (`| tr`, `| tee`) va KHONG `$( )` dau ra cua kich ban nay. llama-server (Start-Process co
    -Redirect*) THUA KE handle stdout cua powershell => ben doc pipe khong bao gio thay EOF => treo den khi llama-server chet
    (do 2026-10-22: doi-model thoat exit 0 luc 16:29:07, `| tr` treo 10 phut; truoc do `$( )` treo 30 phut). Ghi ra TEP:
    `powershell.exe -File doi-model.ps1 ... > tmp/doi-model.log 2>&1; echo $?` - roi doc tep.
#>
param(
  [Parameter(Mandatory = $true)][string]$Model,
  [int]$Ctx = 65536,
  [int]$ChoGiay = 600,
  # B5 (2026-09-22): co them cho llama-server, vi du MTP: '--spec-type','draft-mtp','--spec-draft-n-max','2'.
  # Truyen mang chuoi; de trong = khong them gi.
  [string[]]$ThemArgs = @(),
  # B4 (2026-09-22, DO DUOC): ngan sach token cho <think> cua model biet nghi. 12000 tren Qwen3.6-35B-A3B (ctx 32k,
  # tran sinh 16k): G5-D/G18-B1 3/6 -> 0/6 tren agentic A2, truc H 25/36 -> 27/36, khong luot H nao bi cat (max nghi 8.6k),
  # 2 luot agentic bi ep ket thuc o 12k van ra ban sua. -1 = khong gioi han (mac dinh cua llama-server) - dung khi A/B.
  # `/props` KHONG lo co nay; xac nhan bang log: "reasoning-budget: activated, budget=N".
  [int]$NganSachNghi = 12000,
  # Dot 9 (2026-10-24, DO DUOC, dieu-phoi duyet): prompt-cache tren RAM, MiB. MAC DINH 0 = TAT: Qwen3.6-27B/35B-A3B la model
  # HYBRID/RECURRENT (9/9 luot "forcing full prompt re-processing") => cache khong tai dung, chi ton commit (+3,3..+4,3 GB o 4096) va
  # ~1,5 s/luot; tat: commit phang, nhanh hon 13-24 %. Su co 2026-10-23 22:20: llama-server 27B giu ~40 GB commit. Spec 2026-10-20 §6.
  [int]$CacheRam = 0,
  # Dot 9 (2026-10-24, dieu-phoi duyet): bo chieu thi giac --mmproj THEO MODEL: off | auto | <duong dan>. auto = cung quy tac
  # scripts/ai/tim-mmproj.ps1 voi start-llama-server.ps1 (<ten model bo duoi luong tu>-mmproj-F16.gguf canh model).
  # Mac dinh "auto" (2026-10-24, cung mac dinh san pham sau cong (A)) - "off" de do duong chu khong mmproj.
  [string]$Mmproj = "auto",
  # Dot 9 (2026-10-24, dieu-phoi duyet): tran context checkpoint/slot. 8 = mac dinh san pham (27B commit dinh 5,02 -> 1,50 GB, toc do 0,967x);
  # 32 = mac dinh llama.cpp. Spec 2026-10-20 §6.
  [int]$CtxCheckpoints = 8,
  # Dot 9 (2026-10-22): chu khoa nhan BAN GIAO khi /health xanh (vd chu cua khoaKhe.mjs giu cua phep do) - xem khoi KHOA ben duoi.
  [string]$GiuKhoa = "",
  # Lo D1-script (2026-11-19): exe / cong / thu muc log / tep tam dung la THAM SO de chay kho tren exe GIA, cong GIA, tep GIA.
  # Mac dinh GIU NGUYEN gia tri that cu. -TepTamDung trong => LLAMA_WATCHDOG_PAUSE_FILE => %TEMP%\llama-watchdog.pause nhu cu.
  [string]$Exe = 'D:\SOURCES\16.AI\llama-cuda\llama-server.exe',
  [int]$Cong = 8091,
  [string]$ThuMucLog = 'D:\SOURCES\avi-aoi-management\tmp\audit-ai',
  [string]$TepTamDung = "",
  # Lo D1b M5 (HST 20/11 00:50): chu y dung llama KHONG khoa khi chu cong hien tai CO khoa (mac dinh: tu choi, ma 11).
  [switch]$KhongKhoa
)

# MA THOAT (lo D1-script): 0 san sang | 2 cau hinh (model / exe / tep khoa / mmproj / -KhongKhoa mau thuan) hoac khong tao duoc thu
#   muc log - KIEM TRUOC khi dung ai | 3 khe dang bi khoa boi chu khac | 9 chu cong khong phai DUNG MOT tien trinh $Exe nghe --port $Cong,
#   hoac co tien trinh cung ten exe khong nghe cong (co the dang nap), hoac dung/doi danh tinh hong - KHONG dung ai | 4 tien trinh moi
#   thoat som / khong khoi duoc | 5 het gio, con CON SONG: GIU tep tam dung, KHONG dung con (HST q2)
#   | 10 (D1b M3) SAN SANG nhung khoa KHONG chuyen duoc cho -GiuKhoa | 11 (D1b M5) chu cong CO khoa ma lan doi nay se khoi khong khoa /
#   khac tep khoa - KHONG dung ai.
# Lo D1b M4: loi in bang [Console]::Error.WriteLine (KHONG Write-Error): nguoi goi bat ErrorAction Stop thi Write-Error thanh loi dung,
#   `exit N` khong toi, ma thanh 1 (do toy 20/11). Nguoi goi qua -Command van phai them `; exit $LASTEXITCODE`.
if (-not (Test-Path -LiteralPath $Model -PathType Leaf)) { [Console]::Error.WriteLine("KHONG co tep model: $Model"); exit 2 }
if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { [Console]::Error.WriteLine("KHONG co exe: $Exe"); exit 2 }
$exeThat = (Resolve-Path -LiteralPath $Exe).ProviderPath
$tenTienTrinh = [System.IO.Path]::GetFileName($exeThat)
$log = $ThuMucLog
# Lo D1-script: khoa llama-server CHI qua DUONG DAN (llama-server tu doc tep) - khong dua gia tri khoa len dong lenh.
# Bien co gia tri ma tep khong co => thoat 2 TRUOC khi dung ai (khong dung server KHONG khoa khi da khai khoa).
$tepKhoa = "$env:LLAMA_SERVER_API_KEY_FILE".Trim()
if ($tepKhoa -and -not (Test-Path -LiteralPath $tepKhoa -PathType Leaf)) { [Console]::Error.WriteLine("LLAMA_SERVER_API_KEY_FILE khong ton tai: $tepKhoa"); exit 2 }
# D1b M5 dong 7: -KhongKhoa ma shell CO bien khoa => mau thuan, dung truoc khi ghi tep tam dung.
if ($KhongKhoa -and $tepKhoa) { [Console]::Error.WriteLine("-KhongKhoa MAU THUAN voi LLAMA_SERVER_API_KEY_FILE dang dat - KHONG lam gi."); exit 2 }

# Dung tham so TRUOC khi dung ai: loi cau hinh (mmproj) => thoat 2 khi server cu van con nguyen.
$ten = [System.IO.Path]::GetFileNameWithoutExtension($Model)
$thamSo = @('-m', $Model, '--host', '127.0.0.1', '--port', "$Cong", '-c', "$Ctx",
          '-np', '1', '-fa', 'on', '-ngl', '999', '-ctk', 'f16', '-ctv', 'f16',
          '--slots', '--metrics', '--no-webui',
          # Dot 9: 4096 (2026-10-22, sau su co 18:21) -> 0 (2026-10-24, xem -CacheRam). Chi anh huong TOC DO, KHONG anh huong dau ra.
          '--cache-ram', "$CacheRam", '--ctx-checkpoints', "$CtxCheckpoints")
if ($NganSachNghi -ge 0) { $thamSo += @('--reasoning-budget', "$NganSachNghi") }
if ($tepKhoa) { $thamSo += @('--api-key-file', $tepKhoa) }
. (Join-Path $PSScriptRoot '..\..\ai\tim-mmproj.ps1')
try { $mm = Resolve-Mmproj -ModelPath $Model -CheDo $Mmproj } catch { [Console]::Error.WriteLine("MMPROJ: $_"); exit 2 }
if ($mm) { $thamSo += @('--mmproj', $mm); "MMPROJ: $mm" }
$thamSo += $ThemArgs

# 0. *** Dot 0.1 (2026-10-14) - TAM DUNG bo giam sat llama-server cua app (server/services/ai/giamSatLlamaServer.ts).
#    Khong co tep nay: app (:3000/:3010) thay cong 8091 khong ai nghe 2 nhip (~30 s) trong luc doi model
#    => tu chay start-llama-server.ps1 => HAI llama-server tranh cong/VRAM ngay giua phep do.
#    Tep nam o %TEMP% (KHONG o goc repo) vi nhieu worktree dung chung mot :8091. Ghi de bang
#    LLAMA_WATCHDOG_PAUSE_FILE (phai dat GIONG NHAU o .env cua app va o shell chay kich ban nay), hoac -TepTamDung (chay kho).
#    Giam sat bo qua tep cu hon 30 phut (LLAMA_WATCHDOG_PAUSE_MAX_MS) => vong cho ben duoi CHAM mtime moi lan.
if (-not $TepTamDung) {
  $TepTamDung = if ($env:LLAMA_WATCHDOG_PAUSE_FILE) { $env:LLAMA_WATCHDOG_PAUSE_FILE }
                elseif ($env:TEMP) { Join-Path $env:TEMP 'llama-watchdog.pause' }
                else { Join-Path ([System.IO.Path]::GetTempPath()) 'llama-watchdog.pause' }
}
$tepTamDung = $TepTamDung
# *** Dot 9 (2026-10-21) - tep nay dong thoi la KHOA KHE (server/services/ai/khoaKhe.ts): JSON {chu, lyDo, hetHan}.
#     Bo lap lich khe nang cua app gap khoa con han => KHONG doi khe (su co 14:00: :3000 doi khe giet 27B giua luot do).
#     Moi lan "cham" GHI LAI hetHan = bay gio + 10 phut; script chet => khoa tu het han.
#     !! Go-TamDung xoa tep ca khi mot phep do khac dang giu khoa: nguoi giu (scripts/ai-eval/lib/khoaKhe.mjs) ghi lai trong
#       <= 30 s => cua so ho <= 30 s, CHAP NHAN (dieu-phoi 2026-10-21).
# *** Dot 9 (2026-10-22, dieu-phoi) - sua o GOC cua so ho 3 s (KheNang cua :3000 "ve nha" ngay khi doi-model xoa khoa):
#     -GiuKhoa <chu>: /health xanh => GHI khoa mang <chu> (han ngan 2 phut) THAY VI xoa => nguoi giu ke tiep (phep do co cung
#     <chu>) tiep quan KHONG khe ho. Khong co tuy chon => nhu cu (xoa). Va: doi-model KHONG BAO GIO xoa/ghi de khoa CON HAN cua
#     CHU KHAC - khoa la cua chu khac (khong khop -GiuKhoa) => TU CHOI doi model (exit 3).
$chuCuaToi = 'doi-model.ps1 PID ' + $PID
function Doc-Khoa {
  try {
    $j = Get-Content -LiteralPath $tepTamDung -Raw -ErrorAction Stop | ConvertFrom-Json
    if ($j.hetHan -and ([DateTime]::Parse($j.hetHan).ToUniversalTime() -gt (Get-Date).ToUniversalTime())) { return $j }
  } catch { }
  return $null
}
function Ghi-Khoa([string]$chu = $chuCuaToi, [int]$phut = 10) {
  $hetHan = (Get-Date).ToUniversalTime().AddMinutes($phut).ToString('o')
  $o = [ordered]@{ chu = $chu; lyDo = ('doi model ' + [IO.Path]::GetFileName($Model)); hetHan = $hetHan }
  Set-Content -LiteralPath $tepTamDung -Value ($o | ConvertTo-Json -Compress) -Encoding UTF8
}
# Chi xoa khi khoa la CUA TOI (hoac het han / hong).
function Go-TamDung {
  $k = Doc-Khoa
  if ($k -and $k.chu -ne $chuCuaToi) { return }
  Remove-Item -LiteralPath $tepTamDung -Force -ErrorAction SilentlyContinue
}
function Cham-TamDung {
  try {
    $k = Doc-Khoa
    if ($k -and $k.chu -ne $chuCuaToi -and $k.chu -ne $GiuKhoa) { return }  # chu khac chen vao: khong ghi de
    Ghi-Khoa
  } catch { }
}
# Ban giao /health xanh: -GiuKhoa => ghi khoa cua nguoi nhan (han 2 phut); khong => go nhu cu.
# D1b M3 (HST 20/11 00:50): doc lai sau khi ghi; khoa khong mang chu nguoi nhan => KHONG in "BAN GIAO", thoat 10 (finally go khoa cua toi).
function Ban-Giao {
  if (-not $GiuKhoa) { Go-TamDung; return }
  try { Ghi-Khoa $GiuKhoa 2 } catch { }
  $kBg = Doc-Khoa
  if ((-not $kBg) -or ($kBg.chu -ne $GiuKhoa)) { [Console]::Error.WriteLine("SAN SANG nhung KHOA KHONG CHUYEN DUOC cho: $GiuKhoa ($tepTamDung) - giam sat cua app tro lai sau khi go khoa."); exit 10 }
  "BAN GIAO khoa cho: $GiuKhoa (han 2 phut)"
}
# Lo D1-script: danh tinh tien trinh qua CIM; loi CIM => $null (nguoi goi coi la KHONG xac dinh => khong dung).
function Doc-TienTrinh([int]$id) {
  if ($id -le 0) { return $null }
  try { return (Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop) } catch { return $null }
}
function Exe-Cua($ci) {
  if (-not ($ci -and $ci.ExecutablePath)) { return '' }
  try { return [System.IO.Path]::GetFullPath($ci.ExecutablePath) } catch { return '' }
}
function Chu-Cong {
  return @(Get-NetTCPConnection -LocalPort $Cong -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}
# D1b M5: duong day du de so tep khoa; hong => '' (nguoi goi coi la KHAC => tu choi).
function Duong-Day([string]$p) { try { return [System.IO.Path]::GetFullPath($p) } catch { return '' } }
$khoaCu = Doc-Khoa
if ($khoaCu -and $khoaCu.chu -ne $GiuKhoa) {
  [Console]::Error.WriteLine("KHE DANG BI KHOA boi '" + $khoaCu.chu + "' toi " + $khoaCu.hetHan + " (" + $khoaCu.lyDo + ") - KHONG doi model. Dung -GiuKhoa '<chu>' neu ban la nguoi giu.")
  exit 3
}
Ghi-Khoa
# HST 19/11 18:2x: doc lai khoa vua ghi; khong doc duoc / khong phai cua toi => THOAT truoc khi dung hay khoi bat ky ai
# (ghi hong ma van dung chu cu => khong co tep tam dung => watchdog :3000 co the dung llama thu hai).
$khoaVuaGhi = Doc-Khoa
if (-not $khoaVuaGhi -or $khoaVuaGhi.chu -ne $chuCuaToi) { [Console]::Error.WriteLine("KHONG GHI / DOC LAI DUOC TEP TAM DUNG ($tepTamDung) - KHONG doi model, KHONG dung ai."); exit 2 }
$giuTamDung = $false

try {
# D1b M1 (HST 20/11): thu muc log tao TRUOC khoi dung chu cu, trong try de finally go tep tam dung cua toi. Hong => thoat 2, chu cu nguyen.
#   kiem-dinh 01:05 [DO]: New-Item -Force tren duong la TEP / cha la TEP KHONG nem, KHONG tao => kiem HAU DIEU KIEN, khong tin catch.
try { if (-not (Test-Path -LiteralPath $log -PathType Container)) { New-Item -ItemType Directory -Path $log -Force -ErrorAction Stop | Out-Null } } catch { }
if (-not (Test-Path -LiteralPath $log -PathType Container)) { [Console]::Error.WriteLine("KHONG TAO DUOC THU MUC LOG ($log) - KHONG dung ai, KHONG khoi."); exit 2 }
# 1. Lo D1-script: KHONG con giet vo dieu kien theo ten (ban cu: Get-Process llama-server | Stop-Process).
#    Chi dung khi chu cong $Cong la DUNG MOT tien trinh co ExecutablePath = $Exe, CommandLine co --port $Cong, va KHONG co tien
#    trinh cung ten exe nao khac (dang nap, chua bind). CreationDate doc lai ngay truoc khi dung phai trung luc kiem.
#    Khong ai nghe va khong ai cung ten => di tiep. Moi truong hop khac => thoat 9, KHONG dung ai.
$chu = @(Chu-Cong)
try {
  $cungTen = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -ieq $tenTienTrinh } | Select-Object -ExpandProperty ProcessId)
} catch { [Console]::Error.WriteLine("Khong doc duoc danh sach tien trinh (CIM) - KHONG dung ai."); exit 9 }
if ($chu.Count -gt 1) { [Console]::Error.WriteLine("Cong $Cong co " + $chu.Count + " chu (PID " + ($chu -join ', ') + ") - KHONG dung ai."); exit 9 }
$khac = @($cungTen | Where-Object { $chu -notcontains $_ })
if ($khac.Count -gt 0) { [Console]::Error.WriteLine("Co $tenTienTrinh KHONG nghe cong $Cong (PID " + ($khac -join ', ') + ", co the dang nap) - KHONG dung ai, KHONG khoi them."); exit 9 }
if ($chu.Count -eq 1) {
  $id = [int]$chu[0]
  $ci = Doc-TienTrinh $id
  $exeCu = Exe-Cua $ci
  if ((-not $ci) -or (-not $exeCu) -or ($exeCu -ine $exeThat) -or ("$($ci.CommandLine)" -notmatch "--port\s+$Cong(\s|$)")) {
    [Console]::Error.WriteLine("Chu cong $Cong PID $id KHONG du dieu kien (doc duoc tien trinh + exe = $exeThat + --port $Cong) - KHONG dung.")
    exit 9
  }
  $taoLuc = $ci.CreationDate
  $lai = Doc-TienTrinh $id
  if ((-not $lai) -or ($lai.CreationDate -ne $taoLuc)) { [Console]::Error.WriteLine("PID $id doi danh tinh / khong con giua luc kiem va luc dung - KHONG dung."); exit 9 }
  # D1b M5 (HST 20/11 00:50, bang 8 dong): tin hieu khoa = CommandLine cua chu cong (khong doc .env). KHONG in nguyen CommandLine.
  $clCu = "$($ci.CommandLine)"
  #   kiem-dinh 01:05 + arg.cpp (487a6cc16): llama doi '_' thanh '-' trong ten co "--" => bat ca --api_key_file / --api_key; dang "=" llama
  #   KHONG nhan (invalid argument) nhung van bat cho chac (that bai => coi la CO khoa, tu choi).
  $tepCu = if ($clCu -match '--api[-_]key[-_]file(?:\s+|=)(?:"([^"]+)"|(\S+))') { if ($Matches[1]) { $Matches[1] } else { $Matches[2] } } else { '' }
  $coKhoaCu = [bool]$tepCu -or ($clCu -match '--api[-_]key([-_]file)?(\s|=)')
  if ($coKhoaCu -and (-not $tepKhoa) -and (-not $KhongKhoa)) { [Console]::Error.WriteLine("CHU CONG $Cong PID $id DANG CO KHOA; shell thieu LLAMA_SERVER_API_KEY_FILE - KHONG dung, KHONG khoi llama khong khoa. Dat bien, hoac -KhongKhoa neu chu y."); exit 11 }
  if ($coKhoaCu -and $tepKhoa -and ((-not $tepCu) -or ((Duong-Day $tepCu) -ine (Duong-Day $tepKhoa)) -or (-not (Duong-Day $tepCu)))) {
    $moTaCu = if ($tepCu) { "--api-key-file $tepCu" } else { '--api-key <che>' }
    [Console]::Error.WriteLine("TEP KHOA KHAC chu cong $Cong PID $id ($moTaCu / bien $tepKhoa) - KHONG dung, KHONG khoi."); exit 11
  }
  if ($coKhoaCu -and $KhongKhoa) { "KHONG KHOA THEO -KhongKhoa: llama moi KHONG co khoa (chu cu PID $id co khoa)." }
  "DUNG PID $id (CreationDate $($taoLuc.ToString('o')), exe + --port $Cong da kiem)"
  try { Stop-Process -Id $id -Force -ErrorAction Stop } catch { [Console]::Error.WriteLine("Stop-Process PID $id hong - KHONG bao thanh cong."); exit 9 }
  # CHO cong nha that (<= 60 s).
  $het = (Get-Date).AddSeconds(60)
  while (((@(Chu-Cong)).Count -gt 0) -and ((Get-Date) -lt $het)) { Cham-TamDung; Start-Sleep -Milliseconds 500 }
  if ((@(Chu-Cong)).Count -gt 0) { [Console]::Error.WriteLine("Cong $Cong chua nha sau 60 s - KHONG khoi them."); exit 9 }
}
# D1b M5 dong 2: khong co chu cong => khong co tin hieu khoa cu (gioi han neu ten).
if (($chu.Count -eq 0) -and (-not $tepKhoa)) { "KHONG CO CHU CONG $Cong - khong biet khoa cu; khoi KHONG khoa (shell khong co LLAMA_SERVER_API_KEY_FILE)." }

# Dot 9 (2026-10-24, dieu-phoi duyet P2): log CO DAU GIO, KHONG ghi de (su co 22:20: log luc 27B chet bi lan khoi dong sau xoa mat).
# Giu 10 ban gan nhat CUA MODEL NAY; chi don trong dung thu muc log nay, dung mau ten ls-<model>-<dau gio>. Thu muc da tao o D1b M1.
$dauGio = Get-Date -Format 'yyyyMMdd-HHmmss'
$logOut = "$log\ls-$ten-$dauGio.log"; $logErr = "$log\ls-$ten-$dauGio.err.log"
Get-ChildItem -LiteralPath $log -Filter "ls-$ten-*.err.log" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -Skip 9 | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath ($_.FullName -replace '\.err\.log$', '.log') -Force -ErrorAction SilentlyContinue
}
"LOG: $logErr"
try {
  $con = Start-Process -FilePath $exeThat -ArgumentList $thamSo -WindowStyle Hidden `
    -RedirectStandardOutput $logOut -RedirectStandardError $logErr -PassThru -ErrorAction Stop
} catch { [Console]::Error.WriteLine("KHONG khoi duoc $exeThat - xem $logErr"); exit 4 }
$ciCon = Doc-TienTrinh $con.Id
$taoCon = if ($ciCon) { $ciCon.CreationDate.ToString('o') } else { '(khong doc duoc)' }
"PID CON: $($con.Id) (CreationDate $taoCon)"

# 2. CHO SAN SANG THAT. Nap mot model day mat hang phut; "da goi lenh" khong phai "da san sang".
$het = (Get-Date).AddSeconds($ChoGiay)
while ((Get-Date) -lt $het) {
  if ($con.HasExited) { [Console]::Error.WriteLine("THOAT SOM: $ten (PID $($con.Id), ma $($con.ExitCode)) - xem $logErr"); exit 4 }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Cong/health" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
      $vram = try { (nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader) -join ' ' } catch { '(khong do duoc)' }
      "SAN SANG: $ten (ctx=$Ctx, PID $($con.Id)) | VRAM: $vram"
      Ban-Giao  # /health xanh => -GiuKhoa: ban giao khoa khong khe ho; khong => tra quyen cho giam sat cua app
      exit 0
    }
  } catch { }
  Cham-TamDung
  Start-Sleep -Seconds 3
}
if ($con.HasExited) { [Console]::Error.WriteLine("THOAT SOM: $ten (PID $($con.Id), ma $($con.ExitCode)) - xem $logErr"); exit 4 }
# HET GIO, con CON SONG (HST q2): GIU tep tam dung, KHONG dung con. Gia han khoa lan cuoi roi in cac moc het hieu luc.
Cham-TamDung
$giuTamDung = $true
$khoaNay = Doc-Khoa
$hetKhoa = if ($khoaNay) { [DateTime]::Parse($khoaNay.hetHan).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss') } else { '(khong doc duoc)' }
$hetGiamSat = try { (Get-Item -LiteralPath $tepTamDung -ErrorAction Stop).LastWriteTime.AddMinutes(30).ToString('yyyy-MM-dd HH:mm:ss') } catch { '(khong doc duoc)' }
"CON CON SONG: PID $($con.Id), CreationDate $taoCon, err.log $logErr"
"TEP TAM DUNG: $tepTamDung | khoa khe het han $hetKhoa (KheNang :3000 co the doi khe sau moc nay) | giam sat bo qua tep sau $hetGiamSat (mac dinh LLAMA_WATCHDOG_PAUSE_MAX_MS 30 phut)"
"VIEC NGUOI VAN HANH: truoc $hetKhoa phai (a) dung con PID $($con.Id) SAU KHI kiem PID + CreationDate + CommandLine, roi xoa tep tam dung; hoac (b) chap nhan bo giam sat dung ban thu hai."
[Console]::Error.WriteLine("HET GIO: $ten khong san sang sau $ChoGiay giay. KHONG dung con, GIU tep tam dung.")
exit 5
}
finally {
  # Ctrl+C / loi bat ngo giua chung: KHONG de tep tam dung o lai - TRU duong het gio con con song (giu, xem tren).
  if (-not $giuTamDung) { Go-TamDung }
}
