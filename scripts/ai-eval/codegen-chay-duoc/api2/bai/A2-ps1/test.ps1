$ErrorActionPreference = 'Stop'
function Kiem($dk, $tb) { if (-not $dk) { throw "TRUOT: $tb" } }
try {
  . (Join-Path $PSScriptRoot 'sol.ps1')
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $a = Join-Path $PSScriptRoot 'macdinh.json'; $b = Join-Path $PSScriptRoot 'rieng.json'
  [IO.File]::WriteAllText($a, '{"ten":"Dây chuyền ép nhựa","cong":502,"plc":{"ip":"10.0.0.5","timeoutMs":2000,"the":["a","b"],"sau":{"x":1,"y":2}},"canhBao":{"email":["ky.thuat@nm.vn"],"muc":"cao"},"dsMay":[{"ma":"M01"}]}', $utf8)
  [IO.File]::WriteAllText($b, '{"plc":{"timeoutMs":5000,"the":["c"],"sau":{"y":3}},"canhBao":"tắt","dsMay":[{"ma":"M02","ten":"Máy ép số 2"}],"moi":null}', $utf8)
  $r = Merge-CauHinh -MacDinh $a -Rieng $b
  Kiem ($r -is [hashtable]) "ket qua phai la MOT hashtable, thay $($r.GetType().FullName)"
  Kiem ($r.ten -eq 'Dây chuyền ép nhựa') "tieng Viet phai doc dung UTF-8: '$($r.ten)'"
  Kiem ($r.cong -eq 502 -and ($r.cong -is [int] -or $r.cong -is [long])) "cong phai la so 502"
  Kiem ($r.plc -is [hashtable]) "plc phai la hashtable"
  Kiem ($r.plc.ip -eq '10.0.0.5' -and $r.plc.timeoutMs -eq 5000) "plc gop de quy sai"
  Kiem ($r.plc.the -is [array] -and $r.plc.the.Count -eq 1 -and $r.plc.the[0] -eq 'c') "mang the phai thay nguyen va van la mang 1 phan tu"
  Kiem ($r.plc.sau -is [hashtable] -and $r.plc.sau.x -eq 1 -and $r.plc.sau.y -eq 3) "gop de quy cap 2 sai"
  Kiem ($r.canhBao -eq 'tắt') "gia tri rieng (chuoi) phai thang doi tuong mac dinh"
  Kiem ($r.dsMay -is [array] -and $r.dsMay.Count -eq 1) "dsMay phai la mang 1 phan tu"
  Kiem ($r.dsMay[0] -is [hashtable] -and $r.dsMay[0].ma -eq 'M02' -and $r.dsMay[0].ten -eq 'Máy ép số 2') "doi tuong trong mang phai la hashtable dung noi dung"
  Kiem ($r.ContainsKey('moi') -and $null -eq $r.moi) "khoa moi (null) phai ton tai"
  Kiem ($r.Keys.Count -eq 6) "so khoa cap 1: $($r.Keys.Count)"
  Write-Output 'OK'; exit 0
} catch { Write-Output $_.Exception.Message; exit 1 }
