$ErrorActionPreference = 'Stop'
function Kiem($dk, $tb) { if (-not $dk) { throw "TRUOT: $tb" } }
try {
  . (Join-Path $PSScriptRoot 'sol.ps1')
  $nghe = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), 0
  $nghe.Start()
  $mo = $nghe.LocalEndpoint.Port
  $tam = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), 0
  $tam.Start(); $dong = $tam.LocalEndpoint.Port; $tam.Stop()
  $r = Test-CongMo -MayChu '127.0.0.1' -Cong $mo -ThoiGianMs 2000
  Kiem ($r -is [bool]) "phai tra DUNG MOT [bool], thay $(if ($null -eq $r) { 'null' } else { $r.GetType().FullName })"
  Kiem ($r -eq $true) "cong dang nghe phai la true"
  $r2 = Test-CongMo -MayChu '127.0.0.1' -Cong $dong -ThoiGianMs 2000
  Kiem ($r2 -is [bool] -and $r2 -eq $false) "cong dong phai la DUNG MOT false"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r3 = Test-CongMo -MayChu '10.255.255.1' -Cong 502 -ThoiGianMs 400
  $sw.Stop()
  Kiem ($r3 -is [bool] -and $r3 -eq $false) "dia chi khong tra loi phai la false"
  Kiem ($sw.ElapsedMilliseconds -lt 3000) "phai ton trong han ThoiGianMs (mat $($sw.ElapsedMilliseconds) ms)"
  $r4 = Test-CongMo -MayChu 'khong-ton-tai.invalid' -Cong 80 -ThoiGianMs 1500
  Kiem ($r4 -is [bool] -and $r4 -eq $false) "ten may khong phan giai duoc phai la false, khong nem"
  $nghe.Stop()
  Write-Output 'OK'; exit 0
} catch { Write-Output $_.Exception.Message; exit 1 }
