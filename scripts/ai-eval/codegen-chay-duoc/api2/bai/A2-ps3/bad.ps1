# SAI (lỗi điển hình PowerShell): kết quả Wait() rơi ra pipeline ⇒ hàm trả MẢNG [bool, bool] thay vì một [bool].
function Test-CongMo {
  param([Parameter(Mandatory)][string]$MayChu, [Parameter(Mandatory)][int]$Cong, [int]$ThoiGianMs = 1000)
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $viec = $c.ConnectAsync($MayChu, $Cong)
    $viec.Wait($ThoiGianMs)
    return $c.Connected
  } catch {
    return $false
  } finally {
    $c.Close()
  }
}
