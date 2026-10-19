function Remove-NhatKyCu {
  [CmdletBinding(SupportsShouldProcess)]
  param([Parameter(Mandatory)][string]$ThuMuc, [Parameter(Mandatory)][int]$SoNgay)
  $moc = (Get-Date).AddDays(-$SoNgay)
  $tep = Get-ChildItem -LiteralPath $ThuMuc -File | Where-Object { $_.Extension -ieq '.log' -and $_.LastWriteTime -lt $moc } | Sort-Object -Property Name
  foreach ($f in $tep) {
    if ($PSCmdlet.ShouldProcess($f.FullName, 'Xoá nhật ký cũ')) {
      Remove-Item -LiteralPath $f.FullName -Force -WhatIf:$false -Confirm:$false
    }
    $f.Name
  }
}
