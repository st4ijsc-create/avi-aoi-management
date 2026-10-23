# Lấy mẫu bộ nhớ llama-server mỗi $Giay giây ⇒ CSV. Dừng khi có tệp cờ $Dung. Cột: giờ, pid, Private(commit) GB, WorkingSet GB, commit trống OS GB, số prompt_save trong log.
param([string]$Csv, [string]$Dung, [string]$Log, [int]$Giay = 10)
"gio,pid,privateGB,wsGB,osCommitTrongGB,soPromptSave" | Set-Content -Path $Csv -Encoding ascii
while (-not (Test-Path $Dung)) {
  $p = Get-Process llama-server -ErrorAction SilentlyContinue | Select-Object -First 1
  $os = Get-CimInstance Win32_OperatingSystem
  $n = 0; if ($Log -and (Test-Path $Log)) { $n = (Select-String -Path $Log -Pattern 'prompt_save' -SimpleMatch | Measure-Object).Count }
  if ($p) { "{0},{1},{2:N3},{3:N3},{4:N2},{5}" -f (Get-Date -Format HH:mm:ss), $p.Id, ($p.PrivateMemorySize64/1GB), ($p.WorkingSet64/1GB), ($os.FreeVirtualMemory/1MB), $n | Add-Content -Path $Csv -Encoding ascii }
  else { "{0},,,,{1:N2},{2}" -f (Get-Date -Format HH:mm:ss), ($os.FreeVirtualMemory/1MB), $n | Add-Content -Path $Csv -Encoding ascii }
  Start-Sleep -Seconds $Giay
}
