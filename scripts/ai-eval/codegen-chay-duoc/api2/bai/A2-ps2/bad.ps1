# SAI (lỗi điển hình): Measure-Object -Sum trả [double] mà không ép [int].
function Get-TongHopLoi {
  param([Parameter(Mandatory)][string]$Path)
  $dong = Import-Csv -LiteralPath $Path -Delimiter ';' -Encoding UTF8
  $kq = foreach ($g in ($dong | Group-Object -Property May)) {
    [PSCustomObject]@{
      May       = [string]$g.Name
      TongSoLan = ($g.Group | ForEach-Object { [int]$_.SoLan } | Measure-Object -Sum).Sum
      SoMaLoi   = [int]@($g.Group | Select-Object -ExpandProperty MaLoi -Unique).Count
    }
  }
  $kq | Sort-Object -Property @{ Expression = { $_.TongSoLan }; Descending = $true }, @{ Expression = { $_.May }; Descending = $false }
}
