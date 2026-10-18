$ErrorActionPreference = 'Stop'
function Kiem($dk, $tb) { if (-not $dk) { throw "TRUOT: $tb" } }
try {
  . (Join-Path $PSScriptRoot 'sol.ps1')
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $p = Join-Path $PSScriptRoot 'loi.csv'
  [IO.File]::WriteAllText($p, "May;MaLoi;SoLan`r`nM01;E01;9`r`nM02;E01;10`r`nM01;E02;3`r`nMáy-03;Lỗi cảm biến;100`r`nM02;E01;2`r`nMáy-03;E05;0`r`nM04;E07;4`r`n", $utf8)
  $r = @(Get-TongHopLoi -Path $p)
  Kiem ($r.Count -eq 4) "so dong $($r.Count)"
  $ten = ($r | ForEach-Object { $_.May }) -join ','
  Kiem ($ten -eq 'Máy-03,M01,M02,M04') "thu tu/ten may: $ten"
  Kiem ($r[0].TongSoLan -is [int] -and $r[0].SoMaLoi -is [int]) "TongSoLan/SoMaLoi phai [int], thay $($r[0].TongSoLan.GetType().Name)/$($r[0].SoMaLoi.GetType().Name)"
  $chuoi = ($r | ForEach-Object { "$($_.May)=$($_.TongSoLan)/$($_.SoMaLoi)" }) -join ' '
  Kiem ($chuoi -eq 'Máy-03=100/2 M01=12/2 M02=12/1 M04=4/1') "noi dung: $chuoi"
  $tt = ($r[0].PSObject.Properties | ForEach-Object { $_.Name }) -join ','
  Kiem ($tt -eq 'May,TongSoLan,SoMaLoi') "thu tu thuoc tinh: $tt"
  Write-Output 'OK'; exit 0
} catch { Write-Output $_.Exception.Message; exit 1 }
