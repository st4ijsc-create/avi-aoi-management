function Get-TongHopLoi {
  param([Parameter(Mandatory)][string]$Path)
  $dong = Import-Csv -LiteralPath $Path -Delimiter ';' -Encoding UTF8
  $kq = foreach ($g in ($dong | Group-Object -Property May)) {
    $tong = 0
    foreach ($x in $g.Group) { $tong += [int]$x.SoLan }
    [PSCustomObject]@{
      May       = [string]$g.Name
      TongSoLan = [int]$tong
      SoMaLoi   = [int]@($g.Group | Select-Object -ExpandProperty MaLoi -Unique).Count
    }
  }
  $kq | Sort-Object -Property @{ Expression = { $_.TongSoLan }; Descending = $true }, @{ Expression = { $_.May }; Descending = $false }
}
