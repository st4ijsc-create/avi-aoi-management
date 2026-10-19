$ErrorActionPreference = 'Stop'
function Kiem($dk, $tb) { if (-not $dk) { throw "TRUOT: $tb" } }
try {
  . (Join-Path $PSScriptRoot 'sol.ps1')
  $d = Join-Path $PSScriptRoot 'nhatky'
  if (Test-Path $d) { Remove-Item $d -Recurse -Force }
  New-Item -ItemType Directory -Path (Join-Path $d 'con') -Force | Out-Null
  $cu = (Get-Date).AddDays(-10); $moi = (Get-Date).AddDays(-2)
  foreach ($t in @(@('a.log', $cu), @('b.log', $moi), @('c.txt', $cu), @('E.LOG', $cu), @('con\d.log', $cu), @('máy-01.log', $cu))) {
    $f = Join-Path $d $t[0]; Set-Content -LiteralPath $f -Value 'x'; (Get-Item -LiteralPath $f).LastWriteTime = $t[1]
  }
  $r = @(Remove-NhatKyCu -ThuMuc $d -SoNgay 7 -WhatIf)
  Kiem (($r -join ',') -eq 'a.log,E.LOG,máy-01.log') "WhatIf: danh sach $($r -join ',')"
  foreach ($t in 'a.log', 'E.LOG', 'máy-01.log') { Kiem (Test-Path -LiteralPath (Join-Path $d $t)) "WhatIf da XOA $t" }
  $r2 = @(Remove-NhatKyCu -ThuMuc $d -SoNgay 7)
  Kiem (($r2 -join ',') -eq 'a.log,E.LOG,máy-01.log') "xoa that: danh sach $($r2 -join ',')"
  Kiem ($r2[0] -is [string]) "phai tra chuoi ten tep"
  foreach ($t in 'a.log', 'E.LOG', 'máy-01.log') { Kiem (-not (Test-Path -LiteralPath (Join-Path $d $t))) "chua xoa $t" }
  foreach ($t in 'b.log', 'c.txt', 'con\d.log') { Kiem (Test-Path -LiteralPath (Join-Path $d $t)) "xoa nham $t" }
  $r3 = @(Remove-NhatKyCu -ThuMuc $d -SoNgay 7)
  Kiem ($r3.Count -eq 0) "lan hai khong con gi de xoa"
  Write-Output 'OK'; exit 0
} catch { Write-Output $_.Exception.Message; exit 1 }
