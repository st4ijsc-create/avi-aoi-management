# Dựng / dừng llama-server THAM CHIẾU cho phép đo đọc ảnh (Đợt 9, 2026-10-24): Qwen3-VL-8B + mmproj, CÙNG tham số sidecar thị giác
# (llamaVisionSidecar.ts: -ngl 999, -c 8192) nhưng cổng RIÊNG 8095 để không đụng sidecar :8081 của :3000. Chỉ dùng trong đợt đo có khoá khe.
#   powershell -File model-tham-chieu.ps1 -Lam bat|tat
param([ValidateSet('bat','tat')][string]$Lam = 'bat', [int]$Cong = 8095, [int]$ChoGiay = 180)
$exe = 'D:\SOURCES\16.AI\llama-cuda\llama-server.exe'
$m = 'D:\SOURCES\16.AI\Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf'; $mm = 'D:\SOURCES\16.AI\Qwen3-VL-8B-mmproj-F16.gguf'
$log = 'D:\SOURCES\avi-aoi-management\tmp\audit-ai'
$tepPid = Join-Path $env:TEMP "thi-giac-tham-chieu-$Cong.pid"
if ($Lam -eq 'tat') {
  if (Test-Path $tepPid) { $p = Get-Content $tepPid; Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Remove-Item $tepPid; "DA TAT pid $p" } else { "KHONG CO pid" }
  exit 0
}
$dauGio = Get-Date -Format 'yyyyMMdd-HHmmss'
$args2 = @('-m', $m, '--mmproj', $mm, '--host', '127.0.0.1', '--port', "$Cong", '-ngl', '999', '-c', '8192', '-np', '1', '--no-webui')
$p = Start-Process -FilePath $exe -ArgumentList $args2 -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$log\vl8b-$dauGio.log" -RedirectStandardError "$log\vl8b-$dauGio.err.log"
$p.Id | Set-Content $tepPid
for ($i = 0; $i -lt $ChoGiay; $i += 2) {
  Start-Sleep 2
  try { $h = Invoke-RestMethod "http://127.0.0.1:$Cong/health" -TimeoutSec 2; if ($h.status -eq 'ok') { "SAN SANG VL-8B :$Cong pid $($p.Id) LOG: $log\vl8b-$dauGio.err.log"; exit 0 } } catch {}
  if ($p.HasExited) { Write-Error "CHET khi nap - xem $log\vl8b-$dauGio.err.log"; exit 4 }
}
Write-Error "HET GIO"; exit 5
