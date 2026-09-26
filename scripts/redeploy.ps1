<#
.SYNOPSIS
  Build lai + trien khai lai may chu SYNAPSE tren cong 3000, roi NGHIEM THU that.

.DESCRIPTION
  ==============================================================================================
  ⚠⚠⚠ SCRIPT NAY GHIM BA BAI HOC DA TRA GIA THAT. DUNG "DON DEP" NO MA KHONG DOC HET.
  ==============================================================================================

  ---------------------------------------------------------------------------------------------
  BAI HOC 1 — `node dist/index.js` TRAN ⇒ MAY CHU CHAY CHE DO DEV, VA NGHIEM THU VAN PASS
  ---------------------------------------------------------------------------------------------
  Mot luot truoc dung `Invoke-CimMethod Win32_Process Create` voi dong lenh `node dist/index.js`
  TRAN. Dieu do BO QUA `cross-env` cua `npm run start`, nen `NODE_ENV` KHONG duoc dat ⇒ may chu
  chay che do development ⇒ **`GET /` tra 500**.
  ⚠ Va day moi la phan dat: luot nghiem thu song hom ay **PASS TOAN BO** — vi no chi goi API,
    **khong bao gio goi trang goc**. Mot may chu hong hoan toan voi nguoi dung cuoi da duoc khai
    la "chay tot".
  ⇒ Vi the script nay (a) LUON dat `NODE_ENV=production` qua `cmd.exe /c "set … && node …"`, va
    (b) **BAT BUOC** kiem `GET /` = 200. Khong co duong tat nao qua hai dieu nay.

  ---------------------------------------------------------------------------------------------
  BAI HOC 2 — `npm run start` qua `Start-Process`/`nohup … &` ⇒ MAY CHU CHET THEO SHELL
  ---------------------------------------------------------------------------------------------
  Da xay ra **HAI LAN**: may chu song trong luot chay, roi chet ngay khi luot chay ket thuc.
  ⇒ Chi dung `Invoke-CimMethod -ClassName Win32_Process -MethodName Create`. Tien trinh do cach
    ly khoi cay tien trinh cua shell, nen no song qua luot chay.

  ---------------------------------------------------------------------------------------------
  BAI HOC 3 — NHAN DIEN TIEN TRINH PHAI THEO KHAI NIEM, KHONG THEO CHINH TA
  ---------------------------------------------------------------------------------------------
  Dong lenh THAT cua may chu dang chay la  `node  dist/index.js`  — **HAI dau cach**, do lenh
  duoc dung tu `set NODE_ENV=production && node ` + `dist/index.js`. Do dai 19, khong phai 18.
  ⇒ Bo loc `-ceq 'node dist/index.js'` **KHONG KHOP**, va mot luot "don dep" theo chinh ta se im
    lang khong giet gi ca, roi khoi dong may chu THU HAI tren cung mot DB.
  ⚠ Va quy tac cu (khop long `-like '*node*'`) da tung **giet nham 12 sidecar MCP**.
  ⇒ Quy tac dung, giu duoc CA HAI tinh chat: hoi **`Get-NetTCPConnection -LocalPort 3000 -State
    Listen`** roi lay `OwningProcess`. No nhan dien theo **cai tien trinh dang lam** (phuc vu
    cong 3000), khong theo **cai ten no duoc go ra**.

  ---------------------------------------------------------------------------------------------
  BAI HOC 4 — DA TUNG CO **HAI** MAY CHU SONG SONG TREN CUNG MOT DB
  ---------------------------------------------------------------------------------------------
  ⇒ Buoc cuoi DEM LAI so tien trinh phuc vu cong 3000 va doi dung **1**.

  ---------------------------------------------------------------------------------------------
  BAI HOC 5 (Pha 9 B6, do duoc ngay o luot chay dau tien cua chinh script nay)
  FILE .ps1 PHAI CO **BOM UTF-8**, KHONG THI NO KHONG PARSE DUOC
  ---------------------------------------------------------------------------------------------
  Windows PowerShell 5.1 doc file `.ps1` **khong BOM** bang **codepage ANSI**, khong phai UTF-8.
  Moi ky tu ngoai ASCII trong file nay (`—`, `⚠`, `⇒`, `·`) bien thanh rac nhieu byte, va khi rac
  do roi vao mot chuoi nhay kep thi **parser vo** — 6 loi `Unexpected token`, script khong chay
  duoc mot dong nao.
  ⚠ Trieu chung **khong** tro ve nguyen nhan: thong bao loi noi ve `}` va `dung`/`hai`, tuc no
    tro vao dung nhung dong **khong** co gi sai. Ai doc no se di sua cu phap.
  ⇒ Giu 3 byte dau `EF BB BF`. Neu ban sua file nay bang mot cong cu ghi UTF-8 **khong** BOM
    (`Set-Content` mac dinh, nhieu editor), hay them BOM lai truoc khi commit.


.PARAMETER SkipBuild
  Bo qua `npm run build` (chi trien khai lai `dist/` dang co). Dung khi vua build xong.

.PARAMETER Port
  Cong may chu. Mac dinh 3000.

.PARAMETER TimeoutSec
  Tran cho may chu len. Mac dinh 120.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/redeploy.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [int]$Port = 3000,
  [int]$TimeoutSec = 120
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Write-Buoc([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok  ([string]$m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Loi ([string]$m) { Write-Host "  !!  $m" -ForegroundColor Red }

<#
  Tra ve MOI PID dang LISTEN tren $Port.
  ⚠ Day la phep nhan dien DUY NHAT duoc phep dung trong script nay (xem BAI HOC 3).
    Dung them mot phep loc theo TEN/dong lenh la mo lai dung cai da giet nham 12 sidecar MCP.
#>
function Get-PidTheoCong([int]$p) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($null -eq $c) { return @() }
  return @($c.OwningProcess | Select-Object -Unique)
}

function Show-TienTrinh([int[]]$pids) {
  foreach ($procId in $pids) {
    $pr = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($null -ne $pr) {
      Write-Host ("      PID={0}  len={1}  cmd=[{2}]" -f $procId, $pr.CommandLine.Length, $pr.CommandLine)
    }
  }
}

# ══════════════════════════════════════════════════════════════════════════════════════════════
Write-Buoc "0. TRUOC KHI DONG — ai dang phuc vu cong $Port"
# ══════════════════════════════════════════════════════════════════════════════════════════════
$pidTruoc = Get-PidTheoCong $Port
if ($pidTruoc.Count -eq 0) { Write-Host "      (khong co tien trinh nao)" }
else { Show-TienTrinh $pidTruoc }

# ══════════════════════════════════════════════════════════════════════════════════════════════
if (-not $SkipBuild) {
  Write-Buoc "1. BUILD"
  Push-Location $RepoRoot
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build that bai (exit $LASTEXITCODE) — KHONG trien khai." }
  } finally { Pop-Location }
  Write-Ok "build xong"
} else {
  Write-Buoc "1. BUILD — BO QUA (-SkipBuild)"
}

$distJs = Join-Path $RepoRoot 'dist\index.js'
if (-not (Test-Path $distJs)) { throw "Khong thay $distJs — build chua chay hoac that bai." }
Write-Ok ("dist/index.js  {0:N0} byte  mtime={1:yyyy-MM-dd HH:mm:ss}" -f (Get-Item $distJs).Length, (Get-Item $distJs).LastWriteTime)

# ══════════════════════════════════════════════════════════════════════════════════════════════
Write-Buoc "2. GIET tien trinh dang phuc vu cong $Port (nhan dien THEO CONG, khong theo ten)"
# ══════════════════════════════════════════════════════════════════════════════════════════════
foreach ($procId in $pidTruoc) {
  Write-Host "      Stop-Process -Id $procId"
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}
# Doi cong duoc nha that su — `Stop-Process` tra ve TRUOC khi HDH thu hoi socket.
$het = (Get-Date).AddSeconds(30)
while ((Get-PidTheoCong $Port).Count -gt 0 -and (Get-Date) -lt $het) { Start-Sleep -Milliseconds 300 }
if ((Get-PidTheoCong $Port).Count -gt 0) { throw "Cong $Port van bi giu sau 30 s — dung lai, dung khoi dong chong len." }
Write-Ok "cong $Port da trong"

# ══════════════════════════════════════════════════════════════════════════════════════════════
Write-Buoc "3. KHOI DONG — tach khoi shell, NODE_ENV=production"
# ══════════════════════════════════════════════════════════════════════════════════════════════
# ⚠⚠ HAI dieu duoi day deu la BAI HOC DA TRA GIA, dung doi:
#   · `cmd.exe /c "set NODE_ENV=production && node dist/index.js"` — KHONG duoc rut gon thanh
#     `node dist/index.js` (BAI HOC 1: NODE_ENV rong ⇒ che do dev ⇒ GET / = 500).
#   · `Invoke-CimMethod … Win32_Process Create` — KHONG duoc doi sang `Start-Process` hay
#     `npm run start &` (BAI HOC 2: may chu chet theo shell, da xay ra HAI lan).
$lenh = 'cmd.exe /c "set NODE_ENV=production && node dist/index.js"'
$kq = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine      = $lenh
  CurrentDirectory = $RepoRoot
}
if ($kq.ReturnValue -ne 0) { throw "Win32_Process.Create that bai, ReturnValue=$($kq.ReturnValue)" }
Write-Ok "da phat lenh, PID cmd.exe = $($kq.ProcessId)"

# ══════════════════════════════════════════════════════════════════════════════════════════════
Write-Buoc "4. CHO VA THAM DO — lap cho toi khi cong co nguoi nghe"
# ══════════════════════════════════════════════════════════════════════════════════════════════
$het = (Get-Date).AddSeconds($TimeoutSec)
$pidSau = @()
while ((Get-Date) -lt $het) {
  $pidSau = Get-PidTheoCong $Port
  if ($pidSau.Count -gt 0) { break }
  Start-Sleep -Milliseconds 500
}
if ($pidSau.Count -eq 0) { throw "Sau $TimeoutSec s khong co ai nghe cong $Port — may chu khong len." }
Show-TienTrinh $pidSau
Write-Ok "cong $Port da co nguoi nghe"

# ══════════════════════════════════════════════════════════════════════════════════════════════
Write-Buoc "5. NGHIEM THU BAT BUOC — GET / phai la 200"
# ══════════════════════════════════════════════════════════════════════════════════════════════
# ⚠⚠⚠ DUNG BO BUOC NAY, VA DUNG THAY NO BANG MOT LUOT GOI API.
#     Luot nghiem thu cua BAI HOC 1 PASS TOAN BO tren mot may chu tra `GET /` = 500, vi no chi
#     goi API. Trang goc la thu DUY NHAT phan biet che do production voi che do dev o day.
$het = (Get-Date).AddSeconds($TimeoutSec)
$ma = 0
$loiCuoi = ''
while ((Get-Date) -lt $het) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 10
    $ma = $r.StatusCode
    if ($ma -eq 200) { break }
  } catch {
    $loiCuoi = $_.Exception.Message
    if ($null -ne $_.Exception.Response) { $ma = [int]$_.Exception.Response.StatusCode }
  }
  Start-Sleep -Milliseconds 500
}
if ($ma -ne 200) {
  Write-Loi "GET / = $ma  ($loiCuoi)"
  Write-Loi "⚠ Ma 500 o day gan nhu chac chan la NODE_ENV KHONG duoc dat (BAI HOC 1)."
  throw "NGHIEM THU THAT BAI: GET / = $ma, phai la 200."
}
Write-Ok "GET / = 200"

# ══════════════════════════════════════════════════════════════════════════════════════════════
Write-Buoc "6. DEM LAI — phai co DUNG MOT may chu tren cong $Port"
# ══════════════════════════════════════════════════════════════════════════════════════════════
# ⚠ BAI HOC 4: da tung co HAI may chu song song tren cung mot DB.
$pidCuoi = Get-PidTheoCong $Port
Show-TienTrinh $pidCuoi
if ($pidCuoi.Count -ne 1) {
  throw "Co $($pidCuoi.Count) tien trinh phuc vu cong $Port (phai la 1) — hai may chu song song tren cung mot DB."
}
Write-Ok "dung 1 tien trinh, PID = $($pidCuoi[0])"

Write-Host "`n=== TRIEN KHAI LAI XONG — PID $($pidCuoi[0]), GET / = 200 ===`n" -ForegroundColor Green
