function Get-BienNodeSet {
  param([Parameter(Mandatory)][string]$Path)
  $doc = New-Object System.Xml.XmlDocument
  $doc.Load((Resolve-Path -LiteralPath $Path).ProviderPath)
  $ns = New-Object System.Xml.XmlNamespaceManager $doc.NameTable
  $ns.AddNamespace('u', 'http://opcfoundation.org/UA/2011/03/UANodeSet.xsd')
  foreach ($v in $doc.SelectNodes('/u:UANodeSet/u:UAVariable', $ns)) {
    $ten = $v.GetAttribute('BrowseName') -replace '^\d+:', ''
    $kieu = $v.GetAttribute('DataType')
    if ([string]::IsNullOrEmpty($kieu)) { $kieu = 'BaseDataType' }
    $hien = $v.SelectSingleNode('u:DisplayName', $ns)
    [PSCustomObject]@{
      NodeId     = $v.GetAttribute('NodeId')
      BrowseName = $ten
      DataType   = $kieu
      TenHienThi = if ($hien) { [string]$hien.InnerText } else { '' }
    }
  }
}
