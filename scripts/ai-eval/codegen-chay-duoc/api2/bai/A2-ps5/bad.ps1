# SAI (lỗi điển hình): khai SupportsShouldProcess nhưng xoá bằng [IO.File]::Delete — API .NET không biết -WhatIf.
function Remove-NhatKyCu {
  [CmdletBinding(SupportsShouldProcess)]
  param([Parameter(Mandatory)][string]$ThuMuc, [Parameter(Mandatory)][int]$SoNgay)
  $moc = (Get-Date).AddDays(-$SoNgay)
  $tep = Get-ChildItem -LiteralPath $ThuMuc -File | Where-Object { $_.Extension -ieq '.log' -and $_.LastWriteTime -lt $moc } | Sort-Object -Property Name
  foreach ($f in $tep) {
    [IO.File]::Delete($f.FullName)
    $f.Name
  }
}
