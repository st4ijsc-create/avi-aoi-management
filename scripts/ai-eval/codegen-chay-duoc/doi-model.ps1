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
  [int]$NganSachNghi = 12000
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
function Go-TamDung { Remove-Item -LiteralPath $tepTamDung -Force -ErrorAction SilentlyContinue }
function Cham-TamDung { try { (Get-Item -LiteralPath $tepTamDung -ErrorAction Stop).LastWriteTime = Get-Date } catch { } }
Set-Content -LiteralPath $tepTamDung -Value "doi-model.ps1 PID $PID $(Get-Date -Format o) $Model" -Encoding ASCII

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
          '--slots', '--metrics', '--no-webui')
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
      Go-TamDung  # /health xanh => tra quyen trong coi cho giam sat cua app
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
