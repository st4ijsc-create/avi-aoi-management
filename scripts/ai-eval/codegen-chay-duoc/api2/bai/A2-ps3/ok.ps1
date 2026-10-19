function Test-CongMo {
  param([Parameter(Mandatory)][string]$MayChu, [Parameter(Mandatory)][int]$Cong, [int]$ThoiGianMs = 1000)
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $viec = $c.ConnectAsync($MayChu, $Cong)
    $kipThoi = $false
    try { $kipThoi = $viec.Wait($ThoiGianMs) } catch { $kipThoi = $false }
    return [bool]($kipThoi -and $c.Connected)
  } catch {
    return $false
  } finally {
    $c.Close()
    $c.Dispose()
  }
}
