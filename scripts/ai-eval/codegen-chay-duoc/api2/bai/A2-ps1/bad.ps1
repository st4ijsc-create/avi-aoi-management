# SAI (lỗi điển hình của 5.1): Get-Content không -Encoding đọc tệp UTF-8 không BOM theo bảng mã ANSI ⇒ hỏng tiếng Việt.
function ConvertTo-BangBam {
  param($GiaTri)
  if ($null -eq $GiaTri) { return $null }
  if ($GiaTri -is [System.Management.Automation.PSCustomObject]) {
    $h = @{}
    foreach ($p in $GiaTri.PSObject.Properties) { $h[$p.Name] = ConvertTo-BangBam $p.Value }
    return $h
  }
  if ($GiaTri -is [array]) {
    $mang = New-Object System.Collections.ArrayList
    foreach ($x in $GiaTri) { [void]$mang.Add((ConvertTo-BangBam $x)) }
    return , ([object[]]$mang.ToArray())
  }
  return $GiaTri
}

function Merge-BangBam {
  param([hashtable]$Goc, [hashtable]$De)
  $kq = @{}
  foreach ($k in $Goc.Keys) { $kq[$k] = $Goc[$k] }
  foreach ($k in $De.Keys) {
    if ($kq.ContainsKey($k) -and $kq[$k] -is [hashtable] -and $De[$k] -is [hashtable]) {
      $kq[$k] = Merge-BangBam $kq[$k] $De[$k]
    } else {
      $kq[$k] = $De[$k]
    }
  }
  return $kq
}

function Merge-CauHinh {
  param([Parameter(Mandatory)][string]$MacDinh, [Parameter(Mandatory)][string]$Rieng)
  $a = ConvertTo-BangBam ((Get-Content -Raw $MacDinh) | ConvertFrom-Json)
  $b = ConvertTo-BangBam ((Get-Content -Raw $Rieng) | ConvertFrom-Json)
  return (Merge-BangBam $a $b)
}
