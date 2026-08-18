<#
.SYNOPSIS
    G1-E (2026-08-16) — Khởi động `llama-server` cho model chữ MỘT CÁCH BỀN VỮNG và IDEMPOTENT.

.DESCRIPTION
    LỖ ĐANG VÁ: `llama-server` hôm nay chạy bằng tay qua `nohup`. Máy khởi động lại là mất, và ứng
    dụng **im lặng lùi về in-process** (`LLAMA_SERVER_STRICT` cố ý để TẮT) — câu trả lời vẫn ra nên
    không ai biết. Cái mất là prefix-cache: TTFT đo thật 5.304 ms → 71 ms (nhanh 44–74× tuỳ ngữ cảnh).

    Script này:
      • ĐỌC MỌI THAM SỐ TỪ `.env` (không hard-code model/cổng/binary) — đổi roster ở G5 chỉ sửa MỘT chỗ.
      • IDEMPOTENT: nếu cổng đã có `llama-server` sống (`/health` trả ok) thì THOÁT 0, KHÔNG spawn cái
        thứ hai (spawn trùng = nạp bản thứ hai của model 30B = vỡ VRAM 32 GB).
      • Spawn tách rời (detached) + ghi log ra file + CHỜ `/health` xanh mới báo thành công.

    ⚠⚠ KHÔNG lượng tử hoá KV. ĐÃ ĐO trên build b9814 / RTX 5090 sm_120, chỉ đổi ĐÚNG kiểu cache:
        -ctk f16  -ctv f16  → prefill 6.485 tok/s · decode 176 tok/s · TTFT(4k)    656 ms   ✅
        -ctk q8_0 -ctv f16  → prefill   105 tok/s · decode 11,7 tok/s · TTFT(4k) 39.351 ms  ❌ 62× CHẬM
        -ctk q8_0 -ctv q4_0 → prefill   100 tok/s · decode 23,2 tok/s               ❌ 85× CHẬM
      Tiết kiệm ~1.939 MiB VRAM đổi bằng 15–85× thông lượng ⇒ f16 cho CẢ K VÀ V.

    ⚠ Cổng 8080 đang bị một Apache khác chiếm ⇒ phải dùng 8091 (lấy từ LLAMA_SERVER_URL trong .env).

.PARAMETER EnvFile
    Đường dẫn .env (mặc định: .env ở gốc repo).

.PARAMETER Force
    Giết tiến trình llama-server đang giữ cổng rồi khởi động lại. MẶC ĐỊNH KHÔNG — script bình thường
    không bao giờ giết tiến trình đang chạy.

.PARAMETER WaitSeconds
    Số giây chờ `/health` xanh sau khi spawn (mặc định 300 — model 30B nạp từ đĩa lạnh khá lâu).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\ai\start-llama-server.ps1

.NOTES
    Đăng ký chạy lúc đăng nhập/khởi động: xem `scripts/ai/llama-server.md` §Task Scheduler.
    Kiểm chứng sau khi chạy:  curl.exe -s http://127.0.0.1:3000/api/health/ai
#>
[CmdletBinding()]
param(
    [string]$EnvFile,
    [switch]$Force,
    [int]$WaitSeconds = 300
)

$ErrorActionPreference = 'Stop'

# ── Gốc repo = thư mục cha của scripts/ai ────────────────────────────────────────────────────────
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $EnvFile) { $EnvFile = Join-Path $RepoRoot '.env' }

function Write-Step($msg) { Write-Host "[llama-server] $msg" }
function Write-Bad($msg) { Write-Host "[llama-server] $msg" -ForegroundColor Red }

# ── Đọc .env (KHÔNG hard-code gì) ────────────────────────────────────────────────────────────────
# Cố ý parse tối giản: KEY=VALUE, bỏ dòng trống/# , bỏ nháy bao ngoài. Không expand biến — .env của
# repo này không dùng nội suy.
function Read-DotEnv([string]$path) {
    $map = @{}
    if (-not (Test-Path $path)) { return $map }
    foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
        $t = $line.Trim()
        if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim()
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $map[$k] = $v
    }
    return $map
}

if (-not (Test-Path $EnvFile)) { Write-Bad "Không thấy $EnvFile"; exit 2 }
$cfg = Read-DotEnv $EnvFile

# ── Binary ───────────────────────────────────────────────────────────────────────────────────────
$bin = $cfg['LLAMA_SERVER_BIN']
if ([string]::IsNullOrWhiteSpace($bin)) { Write-Bad 'LLAMA_SERVER_BIN chưa được gán trong .env'; exit 2 }
if (-not (Test-Path -LiteralPath $bin)) { Write-Bad "LLAMA_SERVER_BIN không tồn tại: $bin"; exit 2 }

# ── Model: LLAMA_SERVER_MODEL (ưu tiên) → GGUF_DEFAULT_MODEL, giải theo GGUF_MODELS_DIR ─────────
# Thứ tự tra CÙNG với `aiGgufEngine.resolveModelPath`: tuyệt đối → GGUF_MODELS_DIR → <repo>/uploads.
$modelRaw = $cfg['LLAMA_SERVER_MODEL']
if ([string]::IsNullOrWhiteSpace($modelRaw)) { $modelRaw = $cfg['GGUF_DEFAULT_MODEL'] }
if ([string]::IsNullOrWhiteSpace($modelRaw)) { Write-Bad 'Cả LLAMA_SERVER_MODEL lẫn GGUF_DEFAULT_MODEL đều rỗng trong .env'; exit 2 }
if (-not $modelRaw.ToLower().EndsWith('.gguf')) { $modelRaw = "$modelRaw.gguf" }

$modelPath = $null
if ([System.IO.Path]::IsPathRooted($modelRaw) -and (Test-Path -LiteralPath $modelRaw)) {
    $modelPath = $modelRaw
}
else {
    foreach ($dir in @($cfg['GGUF_MODELS_DIR'], (Join-Path $RepoRoot 'uploads/gguf-models'), (Join-Path $RepoRoot 'uploads'))) {
        if ([string]::IsNullOrWhiteSpace($dir)) { continue }
        $cand = Join-Path $dir $modelRaw
        if (Test-Path -LiteralPath $cand) { $modelPath = $cand; break }
    }
}
if (-not $modelPath) { Write-Bad "Không tìm thấy file model '$modelRaw' (đã tra GGUF_MODELS_DIR + uploads/)"; exit 2 }
$modelPath = (Resolve-Path -LiteralPath $modelPath).Path.Replace('\', '/')

# ── Host/cổng lấy từ LLAMA_SERVER_URL (một nguồn sự thật với ứng dụng) ──────────────────────────
$urlRaw = $cfg['LLAMA_SERVER_URL']
if ([string]::IsNullOrWhiteSpace($urlRaw)) { $urlRaw = 'http://127.0.0.1:8091' }
try { $u = [Uri]$urlRaw } catch { Write-Bad "LLAMA_SERVER_URL không hợp lệ: $urlRaw"; exit 2 }
$srvHost = $u.Host
$srvPort = if ($u.IsDefaultPort -and $urlRaw -notmatch ':\d+') { 8091 } else { $u.Port }
$healthUrl = "$($u.Scheme)://$srvHost`:$srvPort/health"

# ── Tham số đã NGHIỆM THU ở G1-A (khớp tiến trình đang chạy) ────────────────────────────────────
# -c là TỔNG, llama-server chia cho -np ⇒ 65536/2 = 32.768/slot ≥ GGUF_MAX_CTX=32768 (bắt buộc:
# ctx/slot < GGUF_MAX_CTX ⇒ request 32k bị từ chối ⇒ mã lùi in-process ⇒ nạp BẢN THỨ HAI model 30B).
$ctxTotal = if ($cfg['LLAMA_SERVER_CTX_TOTAL']) { $cfg['LLAMA_SERVER_CTX_TOTAL'] } else { '65536' }
$slots = if ($cfg['LLAMA_SERVER_SLOTS']) { $cfg['LLAMA_SERVER_SLOTS'] } else { '2' }

$srvArgs = @(
    '-m', $modelPath,
    '--host', $srvHost,
    '--port', "$srvPort",
    '-c', $ctxTotal,
    '-np', $slots,
    '-fa', 'on',
    '-ngl', '999',
    '-ctk', 'f16', # ⚠ KHÔNG q8_0/q4_0 — xem khối .NOTES ở đầu file (62–85× chậm hơn)
    '-ctv', 'f16',
    '--slots',
    '--metrics',
    '--no-webui'
)
$apiKey = $cfg['LLAMA_SERVER_API_KEY']
if (-not [string]::IsNullOrWhiteSpace($apiKey)) { $srvArgs += @('--api-key', $apiKey) }

# ── IDEMPOTENT: đã sống thì THOÁT, không spawn cái thứ hai ──────────────────────────────────────
function Test-ServerAlive {
    try {
        $r = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 3 -UseBasicParsing
        return ($r.StatusCode -eq 200)
    }
    catch { return $false }
}
function Get-PortOwners {
    try {
        return @(Get-NetTCPConnection -State Listen -LocalPort $srvPort -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
    }
    catch { return @() }
}

if (Test-ServerAlive) {
    if (-not $Force) {
        Write-Step "ĐÃ CHẠY — $healthUrl trả 200. Không spawn thêm (idempotent). Thoát 0."
        exit 0
    }
    Write-Step '-Force: dừng tiến trình llama-server đang giữ cổng...'
    foreach ($procId in (Get-PortOwners)) {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -like 'llama-server*') { Write-Step "  stop PID $procId"; Stop-Process -Id $procId -Force }
        else { Write-Bad "  PID $procId ($($p.ProcessName)) KHÔNG phải llama-server — KHÔNG đụng vào."; exit 3 }
    }
    Start-Sleep -Seconds 2
}
else {
    # Cổng có người nghe nhưng /health không xanh ⇒ CÓ THỂ là dịch vụ khác (nhắc lại: 8080 là Apache).
    $owners = Get-PortOwners
    if ($owners.Count -gt 0) {
        $names = ($owners | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName }) -join ', '
        Write-Bad "Cổng $srvPort ĐANG BỊ CHIẾM bởi: $names (PID: $($owners -join ', ')) nhưng /health không xanh."
        Write-Bad 'KHÔNG spawn đè — đổi LLAMA_SERVER_URL sang cổng khác, hoặc dừng dịch vụ kia bằng tay.'
        exit 3
    }
}

# ── Spawn ────────────────────────────────────────────────────────────────────────────────────────
$logDir = Join-Path $RepoRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outLog = Join-Path $logDir "llama-server-$stamp.out.log"
$errLog = Join-Path $logDir "llama-server-$stamp.err.log"

Write-Step "model : $modelPath"
Write-Step "listen: $srvHost`:$srvPort  (ctx tổng $ctxTotal / $slots slot ⇒ $([int]$ctxTotal / [int]$slots)/slot, KV f16)"
Write-Step "log   : $outLog"

$proc = Start-Process -FilePath $bin -ArgumentList $srvArgs `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
    -WindowStyle Hidden -PassThru
Write-Step "PID $($proc.Id) — chờ /health xanh (tối đa $WaitSeconds giây, model 30B nạp lâu)..."

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) {
        Write-Bad "Tiến trình THOÁT SỚM (exit $($proc.ExitCode)). Xem $errLog"
        exit 4
    }
    if (Test-ServerAlive) {
        Write-Step "SẴN SÀNG — $healthUrl trả 200 (PID $($proc.Id))."
        exit 0
    }
    Start-Sleep -Seconds 2
}
Write-Bad "Hết $WaitSeconds giây mà /health vẫn chưa xanh. Tiến trình PID $($proc.Id) vẫn chạy — xem $errLog"
exit 5
