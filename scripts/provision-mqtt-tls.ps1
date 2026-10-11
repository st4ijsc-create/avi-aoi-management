<#
.SYNOPSIS
  Provision the TLS private key + self-signed certificate of the built-in MQTT broker (doc 81 Dot 7 task J, redesign round 4).

.DESCRIPTION
  Run ONCE, as Administrator, on the server host (Windows PowerShell 5.1 / .NET Framework 4.7.2+; no other dependency).
    1. Creates the protected folder (default %ProgramData%\avi-aoi\mqtt-tls) WITH its access list at creation time
       (no inherit window): SYSTEM and Administrators = full control, the server account = READ, nothing else, no inheritance.
       The parent folder (avi-aoi) is created the same way, or tightened if it already exists and is owned by an administrator.
    2. Generates an EC P-256 (default) or RSA-3072 private key and a self-signed X.509 v3 server certificate:
       subjectAltName = hostname, every LAN IPv4 of this host, localhost, 127.0.0.1 (+ -DnsName / -IpAddress); 20 years.
    3. Writes broker.key and broker.crt with that same access list at creation (CreateNew: never overwrites), then re-reads
       each file through its own handle and verifies owner, protection, every access entry, hard-link count and reparse flag.
    4. Prints the SHA-256 fingerprint that technicians enter on every tablet (app >= 1.0.18), and the next steps.
  The SERVER never writes here: it only reads these two files and verifies them the same way on every start.

  REFUSES (nothing written) when: not elevated (exit 2); the folder, its parent or an existing file is owned by another
  account, grants access to another account, inherits its access list, is a reparse point, has a second hard link, or the
  folder holds unexpected entries (exit 3); the files already exist and -Rotate was not given (exit 4); generation or
  writing failed (exit 5); a parameter is wrong (exit 6).

  -Rotate generates and writes the NEW pair FIRST, into a protected <dir>\staging-<yyyyMMdd-HHmmss>\ folder, verifies it, and
  only then moves the current pair into <dir>\backup-<yyyyMMdd-HHmmss>\ (same access list) and the new pair into place; a
  failure before the swap leaves the current pair untouched, a failure during the swap puts the current pair back.
  Rotation changes the fingerprint: EVERY pinned tablet shows "certificate changed" until the new fingerprint is entered.

  -Repair (doc 81 Dot 7 final wave F5) re-applies the protected access list (SYSTEM + Administrators full, the server account
  READ, no inheritance) to the existing folder, broker.key, broker.crt and backup-* folders: the way out of the server's
  TLS_FILE_UNREADABLE (wrong -ServerAccount: repair with the right one), TLS_KEY_ACL_OPEN and TLS_KEY_ACL_UNPROTECTED.
  It REFUSES (exit 3, nothing changed) when any of them is owned by an account other than SYSTEM / Administrators / the
  server account (possibly planted: never adopted), is a reparse point, or has a second hard link - then quarantine the
  folder by hand (DEPLOY_LAN_GUIDE.md, TLS recovery) and provision a new pair. When another account could read the private
  key, it says so: combine with -Rotate (-Repair -Rotate) unless you can rule out that the key was read.

.PARAMETER ServerAccount
  The account the server process runs as: a name ("NT AUTHORITY\SYSTEM", ".\svc-aoi", "DOMAIN\user") or a SID ("S-1-5-...").
  Find it: Get-CimInstance Win32_Service -Filter "Name='<service>'" | Select StartName, or Task Manager > Details > User name.
.PARAMETER Dir
  Target folder. Default: $env:ProgramData\avi-aoi\mqtt-tls. When changed, set MQTT_TLS_CERT and MQTT_TLS_KEY in the server .env.
.PARAMETER Algorithm
  EC (P-256, default) or RSA (3072 bit).
.PARAMETER Days
  Certificate validity in days (default 7300 ~ 20 years; the PIN, not the date, is the trust decision).
.PARAMETER DnsName
  Extra DNS names for subjectAltName.
.PARAMETER IpAddress
  Extra IPv4 addresses for subjectAltName.
.PARAMETER Rotate
  Replace an existing pair (the new pair is generated and staged first; the old one is backed up).
.PARAMETER Repair
  Re-apply the protected access list to the existing folder and files (see above); with -Rotate, rotate afterwards.
.PARAMETER TestUnelevated
  FOR AUTOMATED TESTS ON A SCRATCH FOLDER ONLY: skips the elevation check; the current user stands in for Administrators
  (gets full control and stays the owner). Refused (exit 6) unless the environment variable AVI_MQTT_TLS_TEST=1 is set AND
  -Dir is under the temp folder ([IO.Path]::GetTempPath()). Never use it for a real deployment.

.EXAMPLE
  .\scripts\provision-mqtt-tls.ps1 -ServerAccount 'NT AUTHORITY\SYSTEM'
.EXAMPLE
  .\scripts\provision-mqtt-tls.ps1 -ServerAccount '.\svc-aoi' -Rotate
.EXAMPLE
  .\scripts\provision-mqtt-tls.ps1 -ServerAccount '.\svc-aoi' -Repair -Rotate
#>
[CmdletBinding()]
param(
  [string]$ServerAccount,
  [string]$Dir = (Join-Path $env:ProgramData 'avi-aoi\mqtt-tls'),
  [ValidateSet('EC', 'RSA')][string]$Algorithm = 'EC',
  [int]$Days = 7300,
  [string[]]$DnsName = @(),
  [string[]]$IpAddress = @(),
  [switch]$Rotate,
  [switch]$Repair,
  [switch]$TestUnelevated
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$SID_SYSTEM = 'S-1-5-18'
$SID_ADMINS = 'S-1-5-32-544'
$FILE_ATTRIBUTE_REPARSE_POINT = 0x400
$CERT_NAME = 'broker.crt'
$KEY_NAME = 'broker.key'

function Fail([int]$code, [string]$msg) {
  [Console]::Error.WriteLine("provision-mqtt-tls: REFUSED ($code): $msg")
  exit $code
}

# ── test mode gate (final wave F5): only an automated test on a scratch folder may skip elevation ───────────────
if ($TestUnelevated) {
  $tmpRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $dirFull = [System.IO.Path]::GetFullPath($Dir)
  if ($env:AVI_MQTT_TLS_TEST -ne '1' -or -not $dirFull.StartsWith($tmpRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail 6 "-TestUnelevated is for automated tests only: it needs the environment variable AVI_MQTT_TLS_TEST=1 AND -Dir under the temp folder ($tmpRoot). For a real deployment run an ELEVATED PowerShell without it."
  }
}

# ── who ──────────────────────────────────────────────────────────────────────────
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
$isElevated = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
$meSid = $identity.User.Value
if (-not $isElevated -and -not $TestUnelevated) {
  Fail 2 'this script must run in an ELEVATED PowerShell (Run as Administrator). It creates a folder that only SYSTEM, Administrators and the server account may open.'
}
if ($TestUnelevated) {
  Write-Warning 'TestUnelevated: elevation check skipped; the current user stands in for Administrators. For tests on a scratch folder ONLY.'
}

if (-not $ServerAccount) {
  Fail 6 "-ServerAccount is required: the account the server runs as, e.g. 'NT AUTHORITY\SYSTEM', '.\svc-aoi', 'DOMAIN\user' or a SID. The server must be able to READ the key; nobody else may."
}
if ($Days -lt 1 -or $Days -gt 36500) { Fail 6 '-Days must be between 1 and 36500' }
try {
  if ($ServerAccount -match '^S-1-\d+(-\d+)+$') {
    $serverSid = (New-Object System.Security.Principal.SecurityIdentifier($ServerAccount)).Value
  } else {
    $acct = $ServerAccount
    if ($acct -match '^\.\\') { $acct = $env:COMPUTERNAME + '\' + $acct.Substring(2) }
    $serverSid = (New-Object System.Security.Principal.NTAccount($acct)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  }
} catch {
  Fail 6 "cannot resolve -ServerAccount '$ServerAccount' to a SID: $($_.Exception.Message)"
}

# Owners the server accepts: SYSTEM, Administrators (+ the server account itself). In test mode the current user is the creator.
$allowedOwners = @($SID_SYSTEM, $SID_ADMINS, $serverSid)
$allowedAces = @($SID_SYSTEM, $SID_ADMINS, $serverSid)
if ($TestUnelevated) { $allowedOwners += $meSid; $allowedAces += $meSid }
$allowedOwners = $allowedOwners | Select-Object -Unique
$allowedAces = $allowedAces | Select-Object -Unique

# ── access lists (SDDL) ──────────────────────────────────────────────────────────
function New-Sddl([bool]$isDir) {
  $inh = ''
  if ($isDir) { $inh = 'OICI' }
  $aces = "(A;$inh;FA;;;SY)(A;$inh;FA;;;BA)"
  $fullForMe = $TestUnelevated -and ($meSid -ne $SID_SYSTEM) -and ($meSid -ne $SID_ADMINS)
  if ($serverSid -ne $SID_SYSTEM -and $serverSid -ne $SID_ADMINS) {
    if ($fullForMe -and $serverSid -eq $meSid) { $aces += "(A;$inh;FA;;;$serverSid)" } else { $aces += "(A;$inh;FR;;;$serverSid)" }
  }
  if ($fullForMe -and $serverSid -ne $meSid) { $aces += "(A;$inh;FA;;;$meSid)" }
  $owner = ''
  if (-not $TestUnelevated) { $owner = 'O:BA' }
  return "${owner}D:PAI$aces"
}
# Only the DACL (+ the owner when elevated) is written — never the SACL (that would need SeSecurityPrivilege and is not ours).
function Get-Sections {
  $sections = [System.Security.AccessControl.AccessControlSections]::Access
  if (-not $TestUnelevated) { $sections = $sections -bor [System.Security.AccessControl.AccessControlSections]::Owner }
  return $sections
}
function New-DirSecurity { $s = New-Object System.Security.AccessControl.DirectorySecurity; $s.SetSecurityDescriptorSddlForm((New-Sddl $true), (Get-Sections)); return $s }
function New-FileSecurity { $s = New-Object System.Security.AccessControl.FileSecurity; $s.SetSecurityDescriptorSddlForm((New-Sddl $false), (Get-Sections)); return $s }

# ── facts through a handle (files) / by path (folders) ────────────────────────────
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class AviMqttTlsProv {
  [StructLayout(LayoutKind.Sequential)] public struct BHFI { public uint Attributes; public uint C1, C2, A1, A2, W1, W2; public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; public uint IndexHigh; public uint IndexLow; }
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetFileInformationByHandle(SafeFileHandle h, out BHFI info);
}
'@

function Get-Facts([string]$path) {
  $item = Get-Item -LiteralPath $path -Force
  $facts = [ordered]@{ Path = $path; IsDir = ($item -is [System.IO.DirectoryInfo]); Attributes = [int]$item.Attributes; Links = 1; Owner = ''; Protected = $false; DaclNull = $false; Aces = @(); Content = $null }
  if ($facts.IsDir) {
    $bin = (Get-Acl -LiteralPath $path).GetSecurityDescriptorBinaryForm()
  } else {
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
      $info = New-Object AviMqttTlsProv+BHFI
      if (-not [AviMqttTlsProv]::GetFileInformationByHandle($fs.SafeFileHandle, [ref]$info)) { throw 'GetFileInformationByHandle failed' }
      $facts.Links = [int]$info.Links
      $facts.Attributes = $facts.Attributes -bor [int]$info.Attributes
      $bin = $fs.GetAccessControl().GetSecurityDescriptorBinaryForm()
      $len = [int]$fs.Length
      $buf = New-Object byte[] $len
      $n = 0
      while ($n -lt $len) { $r = $fs.Read($buf, $n, $len - $n); if ($r -le 0) { break }; $n += $r }
      $facts.Content = $buf
    } finally { $fs.Dispose() }
  }
  $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor -ArgumentList @($bin, 0)
  $facts.Owner = $sd.Owner.Value
  $facts.Protected = (($sd.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0)
  if ($null -eq $sd.DiscretionaryAcl) {
    $facts.DaclNull = $true
  } else {
    $list = @()
    foreach ($a in $sd.DiscretionaryAcl) {
      if ($a -is [System.Security.AccessControl.KnownAce]) { $list += @{ Type = [string]$a.AceType; Sid = $a.SecurityIdentifier.Value } }
      else { $list += @{ Type = [string]$a.AceType; Sid = '?' } }
    }
    $facts.Aces = $list
  }
  return $facts
}

# Every reason the server would refuse this object (empty = fine). $strictInherit: an unprotected DACL is a problem.
function Get-Problems($facts, [string[]]$owners, [string[]]$aces, [bool]$strictInherit) {
  $p = @()
  if (($facts.Attributes -band $FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) { $p += 'is a reparse point (symlink/junction)' }
  if (-not $facts.IsDir -and $facts.Links -ne 1) { $p += "has $($facts.Links) hard links (expected 1)" }
  if ($owners -notcontains $facts.Owner) { $p += "is owned by $($facts.Owner) (allowed: $($owners -join ', '))" }
  if ($facts.DaclNull) { $p += 'has a NULL access list (everyone has full control)' }
  foreach ($a in $facts.Aces) {
    if ($a.Type -eq 'AccessAllowed' -and $aces -notcontains $a.Sid) { $p += "grants access to $($a.Sid)" }
    elseif ($a.Type -ne 'AccessAllowed' -and $a.Type -ne 'AccessDenied') { $p += "has an access entry of type $($a.Type) that cannot be evaluated" }
  }
  if ($strictInherit -and -not $facts.Protected) { $p += 'inherits its access list (not protected)' }
  return $p   # callers wrap in @(): 0 ⇒ empty, 1 ⇒ one string, n ⇒ strings (a leading comma would nest the array)
}
function Assert-Clean([string]$path, [bool]$strictInherit, [string]$what) {
  $f = Get-Facts $path
  $problems = @(Get-Problems $f $allowedOwners $allowedAces $strictInherit)
  if ($problems.Count -gt 0) {
    Fail 3 "$what $path $($problems -join '; '). Nothing was written. Inspect it (another account may have planted it), remove or fix it, then run again."
  }
  return $f
}

# ── subjectAltName inputs (validated BEFORE anything is created on disk) ───────────
function ToPem([string]$label, [byte[]]$der) {
  $b64 = [Convert]::ToBase64String($der)
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("-----BEGIN $label-----`n")
  for ($i = 0; $i -lt $b64.Length; $i += 64) { [void]$sb.Append($b64.Substring($i, [Math]::Min(64, $b64.Length - $i))).Append("`n") }
  [void]$sb.Append("-----END $label-----`n")
  return $sb.ToString()
}
function Get-LanIPv4 {
  $out = @()
  foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) { continue }
    if ($nic.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) { continue }
    foreach ($ua in $nic.GetIPProperties().UnicastAddresses) {
      $ip = $ua.Address
      if ($ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
      $s = $ip.ToString()
      if ($s -like '169.254.*') { continue }
      $out += $s
    }
  }
  return $out
}

$hostName = ([System.Net.Dns]::GetHostName()).Trim().ToLowerInvariant()
$dns = New-Object System.Collections.Generic.List[string]
[void]$dns.Add('localhost')
if ($hostName -match '^[a-z0-9]([a-z0-9-]{0,62})(\.[a-z0-9]([a-z0-9-]{0,62}))*$') { [void]$dns.Add($hostName) }
foreach ($d in $DnsName) { if ($d -and -not $dns.Contains($d.ToLowerInvariant())) { [void]$dns.Add($d.ToLowerInvariant()) } }
$ips = New-Object System.Collections.Generic.List[string]
[void]$ips.Add('127.0.0.1')
foreach ($ip in (Get-LanIPv4)) { if (-not $ips.Contains($ip)) { [void]$ips.Add($ip) } }
foreach ($ip in $IpAddress) {
  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($ip, [ref]$parsed) -or $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { Fail 6 "-IpAddress '$ip' is not an IPv4 address" }
  if (-not $ips.Contains($parsed.ToString())) { [void]$ips.Add($parsed.ToString()) }
}

# ── folders ───────────────────────────────────────────────────────────────────────
$Dir = [System.IO.Path]::GetFullPath($Dir)
$parent = Split-Path -Parent $Dir
if (-not $parent) { Fail 6 "-Dir must have a parent folder: $Dir" }
$grand = Split-Path -Parent $parent
if ($grand -and -not (Test-Path -LiteralPath $grand -PathType Container)) { Fail 6 "the folder above $parent does not exist ($grand) - create the parent chain first" }

$created = @()
if (Test-Path -LiteralPath $parent) {
  $pf = Get-Facts $parent
  if (-not $pf.IsDir) { Fail 6 "$parent is not a folder" }
  $pp = @(Get-Problems $pf $allowedOwners $allowedAces $false)
  $ownerOrLink = @($pp | Where-Object { $_ -match 'owned by|reparse' })
  if ($ownerOrLink.Count -gt 0) {
    Fail 3 "the parent folder $parent $($ownerOrLink -join '; '). An account other than an administrator created it (ProgramData lets any user create folders). Remove it as Administrator, then run again."
  }
  if ($pp.Count -gt 0 -or -not $pf.Protected) {
    if ((Split-Path -Leaf $parent) -ieq 'avi-aoi') {
      (Get-Item -LiteralPath $parent -Force).SetAccessControl((New-DirSecurity))
      $pf2 = Get-Facts $parent
      $pp2 = @(Get-Problems $pf2 $allowedOwners $allowedAces $true)
      if ($pp2.Count -gt 0) { Fail 3 "could not tighten the parent folder $parent ($($pp2 -join '; '))" }
      Write-Output "Tightened the access list of the existing parent folder $parent (it $($pp -join '; '))."
    } else {
      Write-Warning "the parent folder $parent $($pp -join '; ') - it is not managed by this script. Other accounts with write access there could rename the mqtt-tls folder (the server would then refuse the planted replacement, i.e. no TLS)."
    }
  }
} else {
  [void][System.IO.Directory]::CreateDirectory($parent, (New-DirSecurity))
  $created += $parent
  [void](Assert-Clean $parent $true 'the new parent folder')
}

# ── repair (final wave F5): re-apply the protected access list to what is already there; never adopt a foreign owner ──
if ($Repair) {
  if (-not (Test-Path -LiteralPath $Dir)) { Fail 6 "-Repair: $Dir does not exist - nothing to repair (run without -Repair to provision)." }
  $targets = @($Dir)
  foreach ($e in @(Get-ChildItem -LiteralPath $Dir -Force)) {
    if (-not $e.PSIsContainer -and ($e.Name -eq $CERT_NAME -or $e.Name -eq $KEY_NAME)) { $targets += $e.FullName }
    elseif ($e.PSIsContainer -and $e.Name -like 'backup-*') {
      $targets += $e.FullName
      foreach ($bf in @(Get-ChildItem -LiteralPath $e.FullName -Force)) { $targets += $bf.FullName }
    }
  }
  # every check BEFORE any change: one refusal => nothing is changed
  $exposed = @()
  foreach ($t in $targets) {
    try { $f = Get-Facts $t } catch { Fail 3 "-Repair: cannot read the owner / access list of $t ($($_.Exception.Message)). Nothing was changed. Quarantine the folder by hand (DEPLOY_LAN_GUIDE.md, TLS recovery) and provision a new pair." }
    if (($f.Attributes -band $FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) { Fail 3 "-Repair: $t is a reparse point (symlink/junction). Nothing was changed. Quarantine the folder by hand (DEPLOY_LAN_GUIDE.md, TLS recovery) and provision a new pair." }
    if (-not $f.IsDir -and $f.Links -ne 1) { Fail 3 "-Repair: $t has $($f.Links) hard links. Nothing was changed. Quarantine the folder by hand (DEPLOY_LAN_GUIDE.md, TLS recovery) and provision a new pair." }
    if ($allowedOwners -notcontains $f.Owner) { Fail 3 "-Repair: $t is owned by $($f.Owner) - another account created it (possibly planted); it is never adopted. Nothing was changed. Quarantine the folder by hand (DEPLOY_LAN_GUIDE.md, TLS recovery) and provision a new pair." }
    if (-not $f.IsDir -and (Split-Path -Leaf $t) -eq $KEY_NAME) {
      if ($f.DaclNull) { $exposed += 'everyone (no access list)' }
      foreach ($a in $f.Aces) { if ($a.Type -eq 'AccessAllowed' -and $allowedAces -notcontains $a.Sid) { $exposed += $a.Sid } }
    }
  }
  foreach ($t in $targets) {
    $item = Get-Item -LiteralPath $t -Force
    if ($item -is [System.IO.DirectoryInfo]) { $item.SetAccessControl((New-DirSecurity)) } else { $item.SetAccessControl((New-FileSecurity)) }
  }
  foreach ($t in $targets) { [void](Assert-Clean $t $true 'the repaired object') }
  Write-Output "Repaired the access list of $($targets.Count) object(s) under ${Dir}: SYSTEM + Administrators full, server account read ($serverSid), protected (no inheritance)."
  $exposed = @($exposed | Select-Object -Unique)
  if ($exposed.Count -gt 0) {
    Write-Warning "the private key $KEY_NAME was readable by: $($exposed -join ', '). Unless you can rule out that it was read, rotate now (run again with -Rotate, or use -Repair -Rotate): every tablet then enters the NEW fingerprint; rotate the device passwords too."
    Write-Output "MQTT-TLS-KEY-WAS-EXPOSED-TO=$($exposed -join ',')"
  }
  if (-not $Rotate) {
    Write-Output "MQTT-TLS-REPAIRED=$Dir"
    Write-Output 'Restart the server (or wait for its next start) and check that the admin card shows the fingerprint again.'
    exit 0
  }
}

$existing = @()
if (Test-Path -LiteralPath $Dir) {
  $df = Assert-Clean $Dir $true 'the existing folder'
  if (-not $df.IsDir) { Fail 6 "$Dir is not a folder" }
  $entries = @(Get-ChildItem -LiteralPath $Dir -Force)
  foreach ($e in $entries) {
    if ($e.PSIsContainer -and $e.Name -like 'staging-*') { Fail 3 "the folder $Dir holds '$($e.Name)', left by an interrupted -Rotate (it holds an UNUSED new pair). Inspect it, delete it as Administrator, then run again." }
    $ok = ($e.Name -eq $CERT_NAME) -or ($e.Name -eq $KEY_NAME) -or ($e.PSIsContainer -and $e.Name -like 'backup-*')
    if (-not $ok) { Fail 3 "the folder $Dir holds an unexpected entry '$($e.Name)'. Only $CERT_NAME, $KEY_NAME and backup-* folders belong there. Inspect and remove it, then run again." }
    if (-not $e.PSIsContainer) { $existing += $e.FullName }
  }
  if ($existing.Count -gt 0 -and -not $Rotate) {
    Fail 4 "already provisioned: $($existing -join ', ') exist. Use -Rotate to replace them (the old pair is backed up; every tablet must then enter the NEW fingerprint)."
  }
} else {
  [void][System.IO.Directory]::CreateDirectory($Dir, (New-DirSecurity))
  $created += $Dir
  [void](Assert-Clean $Dir $true 'the new folder')
  if (@(Get-ChildItem -LiteralPath $Dir -Force).Count -ne 0) { Fail 3 "something appeared inside the new folder $Dir before it was used" }
}
# rotate: the current pair must be clean BEFORE anything is generated or moved
foreach ($f in $existing) { [void](Assert-Clean $f $true 'the existing file') }

# ── generate (in memory; nothing on disk changes if this fails) ───────────────────
try {
  if ($Algorithm -eq 'EC') {
    $key = [System.Security.Cryptography.ECDsa]::Create([System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256'))
    $req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest("CN=AVI-AOI built-in MQTT broker ($hostName)", $key, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    # final wave F5 - an ECDSA key signs (RFC 5480): DigitalSignature only, never KeyEncipherment
    $usage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature
  } else {
    $key = New-Object System.Security.Cryptography.RSACng(3072)
    $req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest("CN=AVI-AOI built-in MQTT broker ($hostName)", $key, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $usage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment
  }
  $san = New-Object System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder
  foreach ($d in $dns) { $san.AddDnsName($d) }
  foreach ($ip in $ips) { $san.AddIpAddress([System.Net.IPAddress]::Parse($ip)) }
  $req.CertificateExtensions.Add($san.Build())
  $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension($false, $false, 0, $true)))
  $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509KeyUsageExtension($usage, $true)))
  $eku = New-Object System.Security.Cryptography.OidCollection
  [void]$eku.Add((New-Object System.Security.Cryptography.Oid('1.3.6.1.5.5.7.3.1')))
  $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension($eku, $false)))
  $now = [DateTimeOffset]::UtcNow
  $cert = $req.CreateSelfSigned($now.AddDays(-1), $now.AddDays($Days))
  $certDer = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
  $fingerprint = ($cert.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256).ToUpperInvariant() -replace '(..)(?!$)', '$1:')
  $notAfter = $cert.NotAfter.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $pkcs8 = $key.Key.Export([System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)
  $keyPem = [System.Text.Encoding]::ASCII.GetBytes((ToPem 'PRIVATE KEY' $pkcs8))
  $certPem = [System.Text.Encoding]::ASCII.GetBytes((ToPem 'CERTIFICATE' $certDer))
  $cert.Dispose(); $key.Dispose()
} catch {
  Fail 5 "key/certificate generation failed: $($_.Exception.Message)"
}

# ── write with the access list at creation; never overwrite; verify through a handle ──
function Write-Protected([string]$path, [byte[]]$bytes) {
  $stream = New-Object System.IO.FileStream($path, [System.IO.FileMode]::CreateNew, [System.Security.AccessControl.FileSystemRights]::Write, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::WriteThrough, (New-FileSecurity))
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
function Write-Pair([string]$folder) {
  $kp = Join-Path $folder $KEY_NAME
  $cp = Join-Path $folder $CERT_NAME
  try {
    Write-Protected $kp $keyPem
    Write-Protected $cp $certPem
  } catch {
    throw "could not write the files: $($_.Exception.Message)"
  }
  foreach ($pair in @(@($kp, $keyPem), @($cp, $certPem))) {
    $wf = Get-Facts $pair[0]
    $wp = @(Get-Problems $wf $allowedOwners $allowedAces $true)
    if ($wp.Count -gt 0) { throw "the written file $($pair[0]) $($wp -join '; ')" }
    $readBack = ''
    if ($null -ne $wf.Content) { $readBack = [Convert]::ToBase64String([byte[]]$wf.Content) }
    if ($readBack -ne [Convert]::ToBase64String([byte[]]$pair[1])) { throw "the content read back from $($pair[0]) differs from what was written" }
  }
}
# Test-only fault injection: inert unless the gated -TestUnelevated mode is on (AVI_MQTT_TLS_TEST=1 + a temp -Dir).
function Test-Fault([string]$at) {
  if ($TestUnelevated -and $env:AVI_MQTT_TLS_TEST_FAULT -eq $at) { throw "test fault at $at" }
}
$certPath = Join-Path $Dir $CERT_NAME
$keyPath = Join-Path $Dir $KEY_NAME
$backupDir = $null
if ($existing.Count -eq 0) {
  try { Write-Pair $Dir } catch { Fail 5 "$($_.Exception.Message)" }
} else {
  # final wave F5 - ROTATE: the NEW pair is generated, written and verified in a protected staging folder FIRST; only then
  # is the current pair moved into backup-* and the new pair moved into place (same volume: a move keeps each file's
  # protected access list). A failure before the swap leaves the current pair untouched; during it, it is put back.
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $stagingDir = Join-Path $Dir ('staging-' + $stamp)
  $backupDir = Join-Path $Dir ('backup-' + $stamp)
  if ((Test-Path -LiteralPath $stagingDir) -or (Test-Path -LiteralPath $backupDir)) { Fail 5 "staging/backup folder for $stamp already exists - wait a second and run again" }
  try {
    [void][System.IO.Directory]::CreateDirectory($stagingDir, (New-DirSecurity))
    $sf = Get-Facts $stagingDir
    $sp = @(Get-Problems $sf $allowedOwners $allowedAces $true)
    if ($sp.Count -gt 0) { throw "the staging folder $stagingDir $($sp -join '; ')" }
    Write-Pair $stagingDir
    Test-Fault 'staged'
  } catch {
    $why = $_.Exception.Message
    if (Test-Path -LiteralPath $stagingDir) { Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue }
    Fail 5 "rotation stopped BEFORE the swap - the current pair is untouched: $why"
  }
  $moved = @()
  try {
    [void][System.IO.Directory]::CreateDirectory($backupDir, (New-DirSecurity))
    $bfx = Get-Facts $backupDir
    $bp = @(Get-Problems $bfx $allowedOwners $allowedAces $true)
    if ($bp.Count -gt 0) { throw "the backup folder $backupDir $($bp -join '; ')" }
    foreach ($f in $existing) {
      $to = Join-Path $backupDir (Split-Path -Leaf $f)
      Move-Item -LiteralPath $f -Destination $to
      $moved += , @($f, $to)
    }
    Test-Fault 'backed-up'
    foreach ($n in @($KEY_NAME, $CERT_NAME)) { Move-Item -LiteralPath (Join-Path $stagingDir $n) -Destination (Join-Path $Dir $n) }
  } catch {
    $why = $_.Exception.Message
    # put the current pair back (never leave the folder without a pair): first take out a half-moved new pair
    foreach ($n in @($KEY_NAME, $CERT_NAME)) {
      $placed = Join-Path $Dir $n
      $wasMoved = @($moved | Where-Object { $_[0] -eq $placed }).Count -gt 0
      if ($wasMoved -and (Test-Path -LiteralPath $placed)) { Remove-Item -LiteralPath $placed -Force -ErrorAction SilentlyContinue }
    }
    foreach ($m in $moved) { if (-not (Test-Path -LiteralPath $m[0])) { Move-Item -LiteralPath $m[1] -Destination $m[0] -ErrorAction SilentlyContinue } }
    Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    if ((Test-Path -LiteralPath $backupDir) -and @(Get-ChildItem -LiteralPath $backupDir -Force).Count -eq 0) { Remove-Item -LiteralPath $backupDir -Force -ErrorAction SilentlyContinue }
    $back = @($existing | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -eq 0
    if ($back) { Fail 5 "rotation failed during the swap and was ROLLED BACK - the current pair is back in place: $why" }
    Fail 5 "rotation failed during the swap and the current pair could NOT be put back automatically - move broker.key and broker.crt from $backupDir back into $Dir by hand: $why"
  }
  Remove-Item -LiteralPath $stagingDir -Force
  foreach ($m in $moved) { [void](Assert-Clean $m[1] $true 'the backed-up file') }
  foreach ($p2 in @($keyPath, $certPath)) { [void](Assert-Clean $p2 $true 'the rotated file') }
  Write-Output "Previous pair moved to $backupDir (same access list). Keep it until every tablet has the new fingerprint; then delete it."
}
# nothing else may be in the folder now
foreach ($e in @(Get-ChildItem -LiteralPath $Dir -Force)) {
  $ok = ($e.Name -eq $CERT_NAME) -or ($e.Name -eq $KEY_NAME) -or ($e.PSIsContainer -and $e.Name -like 'backup-*')
  if (-not $ok) { Fail 3 "unexpected entry '$($e.Name)' appeared in $Dir while provisioning" }
}

# ── report ────────────────────────────────────────────────────────────────────────
$finalOwner = (Get-Facts $keyPath).Owner
Write-Output ''
Write-Output 'Built-in MQTT broker TLS material provisioned.'
Write-Output "MQTT-TLS-DIR=$Dir"
Write-Output "MQTT-TLS-CERT=$certPath"
Write-Output "MQTT-TLS-KEY=$keyPath"
Write-Output "MQTT-TLS-ALGORITHM=$Algorithm"
Write-Output "MQTT-TLS-FINGERPRINT-SHA256=$fingerprint"
Write-Output ("MQTT-TLS-SAN=" + (($dns | ForEach-Object { "DNS:$_" }) + ($ips | ForEach-Object { "IP:$_" }) -join ', '))
Write-Output "MQTT-TLS-NOT-AFTER=$notAfter"
Write-Output "MQTT-TLS-OWNER=$finalOwner"
Write-Output "MQTT-TLS-SERVER-ACCOUNT=$serverSid"
if ($backupDir) { Write-Output "MQTT-TLS-BACKUP=$backupDir" }
Write-Output ''
Write-Output 'Access list (both files and the folder): SYSTEM = full, Administrators = full, server account = read; protected (no inheritance).'
Write-Output 'Next steps:'
$defaultDir = [System.IO.Path]::GetFullPath((Join-Path $env:ProgramData 'avi-aoi\mqtt-tls'))
if ($Dir -ine $defaultDir) {
  Write-Output "  1. In the server .env set:  MQTT_TLS_CERT=$certPath  and  MQTT_TLS_KEY=$keyPath  (non-default folder)."
} else {
  Write-Output '  1. Nothing to configure: this is the default location the server reads.'
}
Write-Output '  2. Restart the server. The admin card (Connectivity -> Devices -> "Built-in broker TLS") must show this fingerprint.'
Write-Output '  3. Firewall: allow inbound TCP 8884 (MQTT_TLS_PORT), e.g.'
Write-Output '       New-NetFirewallRule -DisplayName "AVI-AOI MQTTS 8884" -Direction Inbound -Protocol TCP -LocalPort 8884 -Action Allow'
Write-Output '  4. On every tablet (app >= 1.0.18): Settings -> MQTT -> TCP + TLS, port 8884, enter this fingerprint next to the device password, Save.'
Write-Output '  5. Backup: copy the folder to an encrypted, access-controlled medium. Losing the key means a new fingerprint on every tablet.'
exit 0
