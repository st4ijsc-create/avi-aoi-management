<#
  khoi-llama-tay.ps1 - KHOI llama-server bang tay voi chuoi tham so cho san, KHONG BAO GIO DUNG tien trinh nao.
  Nguon: khoi-ls-v2.ps1 ngoai repo (do-model 16/11, sha16 67f49087), chep vao repo theo HST q1 (lo D1-script, 2026-11-19).
  Ly do co ban 2: 16/11 10:28 ban 1 (Stop-Process -Force vo dieu kien) da giet llama-server pid 1316 cua llama-watchdog :3000.

  Khac ban ngoai repo:
  - -Exe / -Cong / -ThuMucLog / -TepTamDung la THAM SO (mac dinh = gia tri that cu) de chay kho tren exe GIA + cong GIA + tep GIA.
    Ten tien trinh dem "da co llama" lay tu ten tep cua -Exe, khong ghi cung `llama-server`.
  - Cho /health (khong phai /props). Sau khi xanh: doc /props (gui khoa neu LLAMA_SERVER_API_KEY_FILE co) CHI de in n_ctx.
  - Khai LLAMA_SERVER_API_KEY_FILE ma -ArgStr thieu --api-key-file => thoat 2 (khong khoi server KHONG khoa khi da khai khoa).
    -ArgStr co `--api-key <gia tri>` => thoat 2 (gia tri khoa tren dong lenh lo qua Win32_Process).
  - Het gio ma con CON SONG => thoat 5, GIU tep tam dung, KHONG dung con, in PID + CreationDate + err.log + gio tep het hieu luc (HST q2).
  - -ChiKiem: chay HET cac chot (6 / 7 / 2) roi thoat 0 "SE KHOI" - KHONG tao tep tam dung, KHONG khoi gi. Dung cho ca doi chung voi
    cau hinh that: chot hong thi van khong khoi duoc gi that.

  MA THOAT: 0 san sang (hoac -ChiKiem: qua het chot) | 6 da co tien trinh ten exe nay, HOAC cong dang LISTEN | 7 tep tam dung da co
    | 2 cau hinh | 4 thoat som / khong khoi duoc | 8 sau khi xanh co != 1 tien trinh ten exe nay (KHONG dung ai) | 5 het gio, con con song.
  Moi CommandLine in ra deu qua Che-DongLenh: an gia tri sau `--api-key` (giu `--api-key-file <duong>`).
  Lo D1b M5: KHONG can chot "chu cong co khoa" rieng - chot 6 da tu choi MOI chu cong / MOI tien trinh cung ten exe truoc khi khoi.
    Gioi han chung voi doi-model.ps1: khong co llama nao (cong trong) thi khong co tin hieu khoa cu.
  Goi tu bash: powershell -NoProfile -File scripts/ai/khoi-llama-tay.ps1 -ArgStr "<chuoi>" -Ten <nhan> > log 2>&1
#>
param(
  [Parameter(Mandatory = $true)][string]$ArgStr,
  [Parameter(Mandatory = $true)][string]$Ten,
  [int]$ChoGiay = 600,
  [string]$Exe = 'D:\SOURCES\16.AI\llama-cuda\llama-server.exe',
  [int]$Cong = 8091,
  [string]$ThuMucLog = '',
  [string]$TepTamDung = '',
  [switch]$ChiKiem
)
if (-not $ThuMucLog) { $ThuMucLog = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tmp\khoi-llama-tay' }
if (-not $TepTamDung) { $TepTamDung = Join-Path $env:TEMP 'llama-watchdog.pause' }
$tenTienTrinh = [System.IO.Path]::GetFileNameWithoutExtension($Exe)
function Che-DongLenh([string]$s) {
  if (-not $s) { return $s }
  return [regex]::Replace($s, '(--api-key)(?!-file)(\s+|=)("[^"]*"|\S+)', '$1$2<che>')
}
function In-TienTrinh {
  foreach ($q in @(Get-Process $tenTienTrinh -ErrorAction SilentlyContinue)) {
    $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$($q.Id)" -ErrorAction SilentlyContinue).CommandLine
    "  pid $($q.Id) | $(Che-DongLenh $cl)"
  }
}
# Chot 6: da co tien trinh cung ten exe, hoac cong dang nghe => KHONG khoi, KHONG dung.
$cu = @(Get-Process $tenTienTrinh -ErrorAction SilentlyContinue)
$nghe = @(Get-NetTCPConnection -LocalPort $Cong -State Listen -ErrorAction SilentlyContinue)
if ($cu.Count -gt 0 -or $nghe.Count -gt 0) {
  "DA CO $tenTienTrinh / cong $Cong dang nghe - KHONG KHOI, KHONG DUNG:"
  In-TienTrinh
  foreach ($n in $nghe) { "  cong $Cong LISTEN boi pid $($n.OwningProcess)" }
  exit 6
}
# Chot 7: tep tam dung da co => co nguoi giu khe.
if (Test-Path -LiteralPath $TepTamDung) { "TEP TAM DUNG WATCHDOG DA CO ($TepTamDung) - co nguoi giu khe - KHONG KHOI, KHONG DUNG TEP"; exit 7 }
# Chot 2: cau hinh.
if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { "KHONG co exe: $Exe"; exit 2 }
$tepKhoa = "$env:LLAMA_SERVER_API_KEY_FILE".Trim()
if ($ArgStr -match '--api-key(?!-file)(\s|=)') { "ArgStr co --api-key <gia tri> (lo qua dong lenh) - dung --api-key-file. KHONG KHOI."; exit 2 }
if ($tepKhoa -and ($ArgStr -notmatch '--api-key-file\s')) { "Da khai LLAMA_SERVER_API_KEY_FILE ma ArgStr thieu --api-key-file - KHONG khoi server khong khoa."; exit 2 }
if ($tepKhoa -and -not (Test-Path -LiteralPath $tepKhoa -PathType Leaf)) { "LLAMA_SERVER_API_KEY_FILE khong ton tai: $tepKhoa"; exit 2 }
if ($ChiKiem) { "CHI KIEM: qua chot 6 / 7 / 2 - SE KHOI $Exe cong $Cong (KHONG khoi, KHONG tao tep tam dung)"; exit 0 }

$dau = "khoi-llama-tay $PID $(Get-Date -Format o)"
# HST 19/11 18:2x: ghi tep tam dung hong / doc lai khong dung dau cua minh => THOAT truoc khi khoi bat ky tien trinh nao
# (khong co tep thi watchdog :3000 co the dung llama thu hai). Khong xoa tep: co the khong phai cua minh.
try {
  Set-Content -LiteralPath $TepTamDung -Value $dau -Encoding ascii -ErrorAction Stop
  $docLai = (Get-Content -LiteralPath $TepTamDung -Raw -ErrorAction Stop).Trim()
} catch { $docLai = $null }
if ($docLai -ne $dau) { "KHONG GHI / DOC LAI DUOC TEP TAM DUNG ($TepTamDung) - KHONG KHOI"; exit 2 }
function Go-TepDung {
  try { if ((Get-Content -LiteralPath $TepTamDung -Raw -ErrorAction Stop).Trim() -eq $dau) { Remove-Item -LiteralPath $TepTamDung -ErrorAction Stop } } catch { }
}
if (-not (Test-Path -LiteralPath $ThuMucLog)) { New-Item -ItemType Directory -Path $ThuMucLog -Force | Out-Null }
$logErr = "$ThuMucLog\ls-$Ten.err.log"
try {
  $p = Start-Process -FilePath $Exe -ArgumentList $ArgStr -WindowStyle Hidden -PassThru -ErrorAction Stop `
    -RedirectStandardOutput "$ThuMucLog\ls-$Ten.log" -RedirectStandardError $logErr
} catch { Go-TepDung; "KHONG khoi duoc $Exe - xem $logErr"; exit 4 }
$ciCon = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction SilentlyContinue
$taoCon = if ($ciCon) { $ciCon.CreationDate.ToString('o') } else { '(khong doc duoc)' }
"PID CON: $($p.Id) (CreationDate $taoCon)"
$het = (Get-Date).AddSeconds($ChoGiay)
while ((Get-Date) -lt $het) {
  if ($p.HasExited) { Go-TepDung; "THOAT SOM exit $($p.ExitCode) - xem $logErr"; exit 4 }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Cong/health" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
      Go-TepDung
      $tatCa = @(Get-Process $tenTienTrinh -ErrorAction SilentlyContinue)
      if ($tatCa.Count -ne 1) { "CO $($tatCa.Count) $tenTienTrinh sau khi khoi - KHONG DUNG, bao dieu-phoi:"; In-TienTrinh; exit 8 }
      $nCtx = try {
        $h = @{}
        if ($tepKhoa) { $h['Authorization'] = 'Bearer ' + (Get-Content -LiteralPath $tepKhoa -Raw -ErrorAction Stop).Trim() }
        $pr = Invoke-WebRequest -Uri "http://127.0.0.1:$Cong/props" -Headers $h -TimeoutSec 5 -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json
        "$($pr.default_generation_settings.n_ctx)"
      } catch { '(khong doc duoc /props)' }
      $vram = try { (nvidia-smi --query-gpu=memory.used --format=csv,noheader) -join ' ' } catch { '(khong do duoc)' }
      "SAN SANG PID $($p.Id) | n_ctx $nCtx | VRAM: $vram"
      "CMDLINE: $(Che-DongLenh $ciCon.CommandLine)"
      exit 0
    }
  } catch { }
  Start-Sleep -Seconds 3
}
if ($p.HasExited) { Go-TepDung; "THOAT SOM exit $($p.ExitCode) - xem $logErr"; exit 4 }
# HET GIO, con CON SONG (HST q2): GIU tep tam dung, KHONG dung con.
$hetGiamSat = try { (Get-Item -LiteralPath $TepTamDung -ErrorAction Stop).LastWriteTime.AddMinutes(30).ToString('yyyy-MM-dd HH:mm:ss') } catch { '(khong doc duoc)' }
"HET GIO $ChoGiay s - KHONG dung con, GIU tep tam dung."
"CON CON SONG: PID $($p.Id), CreationDate $taoCon, err.log $logErr"
"TEP TAM DUNG: $TepTamDung | giam sat bo qua tep sau $hetGiamSat (mac dinh LLAMA_WATCHDOG_PAUSE_MAX_MS 30 phut)"
"VIEC NGUOI VAN HANH: truoc $hetGiamSat phai (a) dung con PID $($p.Id) SAU KHI kiem PID + CreationDate + CommandLine, roi xoa tep tam dung; hoac (b) chap nhan bo giam sat dung ban thu hai."
exit 5
