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
  # Dot 9 (2026-10-22): chu khoa nhan BAN GIAO khi /health xanh (vd chu cua khoaKhe.mjs giu cua phep do) - xem khoi KHOA ben duoi.
  [string]$GiuKhoa = ""
)

$exe = 'D:\SOURCES\16.AI\llama-cuda\llama-server.exe'
$log = 'D:\SOURCES\avi-aoi-management\tmp\audit-ai'
if (-not (Test-Path $Model)) { Write-Error "KHONG co tep model: $Model"; exit 2 }

# 0. *** Dot 0.1 (2026-10-14) - TAM DUNG bo giam sat llama-server cua app (server/services/ai/giamSatLlamaServer.ts).
#    Khong co tep nay: app (:3000/:3010) thay cong 8091 khong ai nghe 2 nhip (~30 s) trong luc doi model
#    => tu chay start-llama-server.ps1 => HAI llama-server tranh cong/VRAM ngay giua phep do.
#    Tep nam o %TEMP% (KHONG o goc repo) vi nhieu worktree dung chung mot :8091. Ghi de bang
#    LLAMA_WATCHDOG_PAUSE_FILE (phai dat GIONG NHAU o .env cua app va o shell chay kich ban nay).
#    Giam sat bo qua tep cu hon 30 phut (LLAMA_WATCHDOG_PAUSE_MAX_MS) => vong cho ben duoi CHAM mtime moi lan.
$tepTamDung = if ($env:LLAMA_WATCHDOG_PAUSE_FILE) { $env:LLAMA_WATCHDOG_PAUSE_FILE }
              elseif ($env:TEMP) { Join-Path $env:TEMP 'llama-watchdog.pause' }
              else { Join-Path ([System.IO.Path]::GetTempPath()) 'llama-watchdog.pause' }
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
# Ban giao /health xanh: -GiuKhoa ⇒ ghi khoa cua nguoi nhan (han 2 phut); khong ⇒ go nhu cu.
function Ban-Giao {
  if ($GiuKhoa) { Ghi-Khoa $GiuKhoa 2; "BAN GIAO khoa cho: $GiuKhoa (han 2 phut)" } else { Go-TamDung }
}
$khoaCu = Doc-Khoa
if ($khoaCu -and $khoaCu.chu -ne $GiuKhoa) {
  Write-Error ("KHE DANG BI KHOA boi '" + $khoaCu.chu + "' toi " + $khoaCu.hetHan + " (" + $khoaCu.lyDo + ") - KHONG doi model. Dung -GiuKhoa '<chu>' neu ban la nguoi giu.")
  exit 3
}
Ghi-Khoa

try {
# 1. Dung ban dang chay va CHO cong 8091 that su nha ra.
Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
$het = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $het) {
  if (-not (Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue)) { break }
  Cham-TamDung
  Start-Sleep -Milliseconds 500
}

$ten = [System.IO.Path]::GetFileNameWithoutExtension($Model)
$thamSo = @('-m', $Model, '--host', '127.0.0.1', '--port', '8091', '-c', "$Ctx",
          '-np', '1', '-fa', 'on', '-ngl', '999', '-ctk', 'f16', '-ctv', 'f16',
          '--slots', '--metrics', '--no-webui',
          # Dot 9 (2026-10-22, dieu-phoi duyet): tran prompt-cache tren RAM MAY = 4 GB. Su co 18:21: llama-server 27B chet giua luc
          # luu prompt cache (bo nho tam ~5,9 GB/muc) khi Windows het commit ("Virtual Memory Minimum Too Low"). Chi anh huong
          # TOC DO (dung lai KV), KHONG anh huong dau ra.
          '--cache-ram', '4096')
if ($NganSachNghi -ge 0) { $thamSo += @('--reasoning-budget', "$NganSachNghi") }
$thamSo += $ThemArgs
Start-Process -FilePath $exe -ArgumentList $thamSo -WindowStyle Hidden `
  -RedirectStandardOutput "$log\ls-$ten.log" -RedirectStandardError "$log\ls-$ten.err.log"

# 2. CHO SAN SANG THAT. Nap mot model day mat hang phut; "da goi lenh" khong phai "da san sang".
$het = (Get-Date).AddSeconds($ChoGiay)
while ((Get-Date) -lt $het) {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8091/health' -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
      $vram = (nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader) -join ' '
      "SAN SANG: $ten (ctx=$Ctx) | VRAM: $vram"
      Ban-Giao  # /health xanh => -GiuKhoa: ban giao khoa khong khe ho; khong => tra quyen cho giam sat cua app
      exit 0
    }
  } catch { }
  Cham-TamDung
  Start-Sleep -Seconds 3
}
Go-TamDung  # that bai cung go: de giam sat dung lai model cua .env thay vi bo trong may
Write-Error "HET GIO: $ten khong san sang sau $ChoGiay giay - xem $log\ls-$ten.err.log"
exit 2
}
finally {
  # Ctrl+C / loi bat ngo giua chung: KHONG de tep tam dung o lai (giam sat se bo qua no sau 30 phut, nhung khong can doi).
  Go-TamDung
}
