$ErrorActionPreference = 'Stop'
function Kiem($dk, $tb) { if (-not $dk) { throw "TRUOT: $tb" } }
try {
  . (Join-Path $PSScriptRoot 'sol.ps1')
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $p = Join-Path $PSScriptRoot 'nodeset.xml'
  $xml = @'
<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd" xmlns:uax="http://opcfoundation.org/UA/2008/02/Types.xsd">
  <NamespaceUris><Uri>urn:aoi:line1</Uri></NamespaceUris>
  <Aliases><Alias Alias="Double">i=11</Alias></Aliases>
  <UAObject NodeId="ns=1;i=1000" BrowseName="1:May1"><DisplayName>Máy 1</DisplayName></UAObject>
  <UAVariable NodeId="ns=1;s=May1.NhietDo" BrowseName="1:NhietDo" DataType="Double" ParentNodeId="ns=1;i=1000"><DisplayName Locale="vi-VN">Nhiệt độ trục</DisplayName><DisplayName Locale="en">Shaft temperature</DisplayName></UAVariable>
  <UAVariableType NodeId="ns=1;i=2000" BrowseName="1:KieuBien" DataType="Double"><DisplayName>Kiểu biến</DisplayName></UAVariableType>
  <UAVariable NodeId="ns=1;s=May1.TrangThai" BrowseName="TrangThai"><DisplayName>Trạng thái</DisplayName></UAVariable>
  <UAVariable NodeId="ns=1;i=1003" BrowseName="12:SoLuong" DataType="i=7"><DisplayName Locale="">Số lượng</DisplayName></UAVariable>
</UANodeSet>
'@
  [IO.File]::WriteAllText($p, $xml, $utf8)
  $r = @(Get-BienNodeSet -Path $p)
  Kiem ($r.Count -eq 3) "so UAVariable $($r.Count)"
  $chuoi = ($r | ForEach-Object { "$($_.NodeId)|$($_.BrowseName)|$($_.DataType)|$($_.TenHienThi)" }) -join ' ## '
  $ky = 'ns=1;s=May1.NhietDo|NhietDo|Double|Nhiệt độ trục ## ns=1;s=May1.TrangThai|TrangThai|BaseDataType|Trạng thái ## ns=1;i=1003|SoLuong|i=7|Số lượng'
  Kiem ($chuoi -ceq $ky) "noi dung: $chuoi"
  Kiem ($r[0].TenHienThi -is [string]) "TenHienThi phai la chuoi, thay $($r[0].TenHienThi.GetType().Name)"
  Write-Output 'OK'; exit 0
} catch { Write-Output $_.Exception.Message; exit 1 }
