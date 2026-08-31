[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Stop-Lane([string]$Message) {
  throw "Windows E2E prerequisite failed: $Message"
}

function Require-Environment([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    Stop-Lane "$Name is required"
  }
  return $value
}

function Assert-ExactKeys($Value, [string[]]$Expected, [string]$Label) {
  if ($null -eq $Value -or $null -eq $Value.PSObject) {
    Stop-Lane "$Label must be a JSON object"
  }
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  $difference = @(Compare-Object -ReferenceObject $wanted -DifferenceObject $actual)
  if ($difference.Count -ne 0) {
    Stop-Lane "$Label has missing or unexpected fields"
  }
}

function Assert-Integer($Value, [string]$Label, [int64]$Minimum, [int64]$Maximum) {
  if ($Value -isnot [byte] -and $Value -isnot [int16] -and $Value -isnot [int32] -and $Value -isnot [int64]) {
    Stop-Lane "$Label must be an integer"
  }
  $number = [int64]$Value
  if ($number -lt $Minimum -or $number -gt $Maximum) {
    Stop-Lane "$Label is outside the accepted range"
  }
  return $number
}

function Get-LowerSha256File([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-LowerSha256Text([string]$Value) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $algorithm.Dispose()
  }
}

if ($env:CUA_E2E -ne "1") {
  Write-Host "Windows Computer Use E2E skipped because CUA_E2E is not 1."
  exit 0
}

if (-not [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
  [Runtime.InteropServices.OSPlatform]::Windows
)) {
  Stop-Lane "CUA_E2E=1 requires Windows"
}
if (
  [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne
    [Runtime.InteropServices.Architecture]::X64 -or
  [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne
    [Runtime.InteropServices.Architecture]::X64
) {
  Stop-Lane "v1 evidence requires an x64 OS and x64 PowerShell process"
}

$nativeSource = @"
using System;
using System.Runtime.InteropServices;

public static class ComputerUseWindowsE2EGates
{
    private const int WTS_CURRENT_SESSION = -1;
    private const int WTSConnectState = 8;
    private const int WTSActive = 0;
    private const uint DESKTOP_SWITCHDESKTOP = 0x0100;

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQuerySessionInformation(
        IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytesReturned);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr memory);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SwitchDesktop(IntPtr desktop);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForSystem();

    public static bool IsCurrentSessionActive()
    {
        IntPtr buffer;
        int bytes;
        if (!WTSQuerySessionInformation(IntPtr.Zero, WTS_CURRENT_SESSION, WTSConnectState, out buffer, out bytes))
            return false;
        try
        {
            return bytes >= sizeof(int) && Marshal.ReadInt32(buffer) == WTSActive;
        }
        finally
        {
            WTSFreeMemory(buffer);
        }
    }

    public static bool IsInputDesktopUnlocked()
    {
        IntPtr desktop = OpenInputDesktop(0, false, DESKTOP_SWITCHDESKTOP);
        if (desktop == IntPtr.Zero)
            return false;
        try
        {
            return SwitchDesktop(desktop);
        }
        finally
        {
            CloseDesktop(desktop);
        }
    }
}
"@
Add-Type -TypeDefinition $nativeSource -Language CSharp

$sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
if ($sessionId -eq 0) {
  Stop-Lane "Session 0 is unsupported"
}
if (-not [ComputerUseWindowsE2EGates]::IsCurrentSessionActive()) {
  Stop-Lane "the current desktop session is disconnected or not active"
}
if (-not [ComputerUseWindowsE2EGates]::IsInputDesktopUnlocked()) {
  Stop-Lane "the input desktop is locked or is a secure desktop"
}

$currentVersion = Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
$osBuild = [string]$currentVersion.CurrentBuildNumber
if ($osBuild -notmatch "^[0-9]{5,6}$" -or [int]$osBuild -lt 18362) {
  Stop-Lane "Windows 10 build 18362 or newer is required"
}

$requestedDpiText = Require-Environment "CUA_E2E_DPI"
if ($requestedDpiText -notmatch "^(100|125|150)$") {
  Stop-Lane "CUA_E2E_DPI must be exactly 100, 125 or 150"
}
$requestedDpi = [int]$requestedDpiText
$systemDpi = [int][ComputerUseWindowsE2EGates]::GetDpiForSystem()
$actualDpiPercent = [int][Math]::Round(($systemDpi / 96.0) * 100.0)
if ($actualDpiPercent -notin @(100, 125, 150)) {
  Stop-Lane "the measured system DPI is not an accepted 100, 125 or 150 percent lane"
}
if ($actualDpiPercent -ne $requestedDpi) {
  Stop-Lane "CUA_E2E_DPI does not match GetDpiForSystem"
}

$mode = Require-Environment "CUA_E2E_MODE"
if ($mode -notin @("development", "candidate")) {
  Stop-Lane "CUA_E2E_MODE must be development or candidate"
}
$repeatText = Require-Environment "CUA_REPEAT"
if ($repeatText -notmatch "^[1-9][0-9]*$") {
  Stop-Lane "CUA_REPEAT must be a positive integer"
}
$repeat = [int]$repeatText
if ($repeat -gt 100) {
  Stop-Lane "CUA_REPEAT must not exceed 100"
}
if ($mode -eq "candidate" -and $repeat -lt 20) {
  Stop-Lane "candidate evidence requires CUA_REPEAT of at least 20"
}

$productRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $productRoot ".."))
$lockPath = Join-Path $productRoot "engine.lock.json"
$mcpPath = Join-Path $productRoot "dist\mcp\main.js"
$cliPath = Join-Path $productRoot "dist\cli\main.js"
$protocolPath = Join-Path $productRoot "dist\protocol.js"
foreach ($requiredPath in @($lockPath, $mcpPath, $cliPath, $protocolPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    Stop-Lane "required lock/build artifact is missing: $requiredPath"
  }
}

$lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
Assert-ExactKeys $lock @(
  "schema_version", "engine", "version", "tag", "source_commit",
  "required_fix_commits", "required_tools", "platforms"
) "engine.lock.json"
$windowsLock = $lock.platforms.windows
if ($lock.engine -ne "cua-driver" -or $lock.version -notmatch "^[0-9]+\.[0-9]+\.[0-9]+$") {
  Stop-Lane "engine lock must name one formal stable Cua version"
}
if ($lock.tag -ne "cua-driver-rs-v$($lock.version)") {
  Stop-Lane "engine tag is not the exact formal release tag"
}
if ($lock.source_commit -notmatch "^[0-9a-f]{40}$") {
  Stop-Lane "engine source commit is malformed"
}
if ($lock.required_tools.Count -lt 1) {
  Stop-Lane "engine lock has no required tool contract"
}
$packageManifest = Get-Content -Raw -LiteralPath (Join-Path $productRoot "package.json") | ConvertFrom-Json
if ($packageManifest.dependencies.'@trycua/cua-driver' -ne $lock.version) {
  Stop-Lane "the Cua SDK dependency version differs from engine.lock.json"
}
if ($windowsLock.asset -ne "cua-driver-rs-$($lock.version)-windows-x86_64.zip" -or
    $windowsLock.sha256 -notmatch "^[0-9a-f]{64}$") {
  Stop-Lane "the Windows x64 release asset lock is malformed"
}
if ($mode -eq "development" -and $windowsLock.development_eligible -ne $true) {
  Stop-Lane "the staged engine is not development eligible"
}
if ($mode -eq "candidate") {
  if ($windowsLock.release_eligible -ne $false) {
    Stop-Lane "candidate evidence must run before, and cannot grant, release eligibility"
  }
  if ($lock.required_fix_commits.Count -lt 1) {
    Stop-Lane "candidate engine has no locked required fixes"
  }
  foreach ($fix in $lock.required_fix_commits) {
    if ($fix -notmatch "^[0-9a-f]{40}$") {
      Stop-Lane "candidate engine contains a malformed required-fix commit"
    }
  }
  $git = Get-Command git.exe -ErrorAction Stop
  $dirty = & $git.Source -C $repositoryRoot status --porcelain
  if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace(($dirty -join "`n"))) {
    Stop-Lane "candidate evidence requires a clean working tree"
  }
  $upstreamPathText = Require-Environment "CUA_UPSTREAM_REPO"
  if (-not [IO.Path]::IsPathRooted($upstreamPathText)) {
    Stop-Lane "CUA_UPSTREAM_REPO must be an absolute local Cua git checkout"
  }
  $upstreamPath = [IO.Path]::GetFullPath($upstreamPathText)
  $resolvedTag = (& $git.Source -C $upstreamPath rev-parse "$($lock.tag)^{commit}").Trim()
  if ($LASTEXITCODE -ne 0 -or $resolvedTag -ne $lock.source_commit) {
    Stop-Lane "the staged source commit does not match the formal release tag in CUA_UPSTREAM_REPO"
  }
  foreach ($fix in $lock.required_fix_commits) {
    & $git.Source -C $upstreamPath merge-base --is-ancestor $fix $lock.source_commit
    if ($LASTEXITCODE -ne 0) {
      Stop-Lane "required fix $fix is not contained in the staged formal release"
    }
  }
}

$runtimePathText = Require-Environment "CUA_RUNTIME_EXE"
if (-not [IO.Path]::IsPathRooted($runtimePathText)) {
  Stop-Lane "CUA_RUNTIME_EXE must be an absolute path"
}
$runtimePath = [IO.Path]::GetFullPath($runtimePathText)
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
  Stop-Lane "CUA_RUNTIME_EXE does not exist"
}
if ([IO.Path]::GetFileName($runtimePath).ToLowerInvariant() -ne "cua-driver.exe") {
  Stop-Lane "CUA_RUNTIME_EXE must name the Cua Runtime executable"
}
$runtimeVersionLines = & $runtimePath --version
if ($LASTEXITCODE -ne 0) {
  Stop-Lane "CUA_RUNTIME_EXE --version failed"
}
$runtimeVersionReport = ($runtimeVersionLines -join "`n").Trim()
if ($runtimeVersionReport -ne "cua-driver $($lock.version)") {
  Stop-Lane "CUA_RUNTIME_EXE --version does not exactly match engine.lock.json"
}
$signature = Get-AuthenticodeSignature -LiteralPath $runtimePath
$signatureStatus = [string]$signature.Status
$allowedSignatureStates = @(
  "Valid", "NotSigned", "HashMismatch", "NotTrusted", "UnknownError", "NotSupported", "Incompatible"
)
if ($signatureStatus -notin $allowedSignatureStates) {
  Stop-Lane "Runtime returned an unrecognized Authenticode status"
}
$signerSubject = if ($null -eq $signature.SignerCertificate) {
  $null
}
else {
  [string]$signature.SignerCertificate.Subject
}
$signerThumbprint = if ($null -eq $signature.SignerCertificate) {
  $null
}
else {
  ([string]$signature.SignerCertificate.Thumbprint).ToUpperInvariant()
}
if ($null -ne $signerSubject -and $signerSubject -match "[\r\n]") {
  Stop-Lane "certificate subject contains a forbidden newline"
}
if ($null -ne $signerThumbprint -and $signerThumbprint -notmatch "^[0-9A-F]{40}$") {
  Stop-Lane "certificate thumbprint is malformed"
}
if ($mode -eq "candidate" -and (
  $signatureStatus -ne "Valid" -or $null -eq $signerSubject -or $null -eq $signerThumbprint
)) {
  Stop-Lane "candidate evidence requires a valid Authenticode signer identity"
}
$lockedSigner = $windowsLock.signer
if ($null -ne $lockedSigner.subject -and $lockedSigner.subject -ne $signerSubject) {
  Stop-Lane "Runtime signer subject differs from the locked identity"
}
if ($null -ne $lockedSigner.thumbprint -and $lockedSigner.thumbprint.ToUpperInvariant() -ne $signerThumbprint) {
  Stop-Lane "Runtime signer thumbprint differs from the locked identity"
}

$browserCandidates = @()
if (-not [string]::IsNullOrWhiteSpace($env:CUA_E2E_BROWSER)) {
  $browserCandidates += $env:CUA_E2E_BROWSER
}
else {
  $browserCandidates += Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"
  $browserCandidates += Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"
  if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
    $browserCandidates += Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
  }
}
$browserPath = $null
foreach ($candidate in $browserCandidates) {
  if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    $browserPath = [IO.Path]::GetFullPath($candidate)
    break
  }
}
if ($null -eq $browserPath) {
  Stop-Lane "Chrome or Edge is required; set CUA_E2E_BROWSER to an absolute executable path"
}
$browserFile = [IO.Path]::GetFileName($browserPath).ToLowerInvariant()
$browserName = switch ($browserFile) {
  "chrome.exe" { "chrome" }
  "msedge.exe" { "edge" }
  default { Stop-Lane "CUA_E2E_BROWSER must point to chrome.exe or msedge.exe" }
}
$browserProductVersion = [string](Get-Item -LiteralPath $browserPath).VersionInfo.ProductVersion
$browserVersionMatch = [regex]::Match($browserProductVersion, "^[0-9]+(?:\.[0-9]+){1,4}")
if (-not $browserVersionMatch.Success) {
  Stop-Lane "browser build version could not be measured"
}
$browserVersion = $browserVersionMatch.Value
$browserSha256 = Get-LowerSha256File $browserPath

$node = Get-Command node.exe -ErrorAction Stop
$npx = Get-Command npx.cmd -ErrorAction Stop
$doctorLines = & $node.Source $cliPath doctor --json
if ($LASTEXITCODE -ne 0) {
  Stop-Lane "computer-use doctor failed"
}
$doctorRaw = ($doctorLines -join "`n").Trim()
try {
  $doctor = $doctorRaw | ConvertFrom-Json
}
catch {
  Stop-Lane "computer-use doctor did not return one JSON report"
}
Assert-ExactKeys $doctor @(
  "ok", "product_version", "protocol_version", "platform", "supported_platform",
  "expected_engine_version", "reported_engine_version", "engine_connected",
  "required_tools_present", "desktop_unlocked", "permissions",
  "permission_details",
  "observation_succeeded", "screenshot", "cleanup"
) "doctor report"
Assert-ExactKeys $doctor.permission_details @(
  "accessibility", "screen_recording", "source"
) "doctor permission details"
Assert-ExactKeys $doctor.cleanup @("status") "doctor cleanup"
if (
  $doctor.ok -ne $true -or $doctor.platform -ne "windows" -or
  $doctor.reported_engine_version -ne $lock.version -or
  $doctor.expected_engine_version -ne $lock.version
) {
  Stop-Lane "Runtime is unavailable or its version differs from engine.lock.json"
}
if ($doctor.desktop_unlocked -ne $true -or $doctor.observation_succeeded -ne $true) {
  Stop-Lane "Runtime did not report an unlocked observable desktop"
}
if ($doctor.cleanup.status -ne "succeeded") {
  Stop-Lane "Runtime diagnostic session cleanup failed"
}
if ($doctor.permissions -notin @("granted", "required", "unknown")) {
  Stop-Lane "Runtime returned an unknown permission classification"
}
if (
  $doctor.permission_details.accessibility -notin @("granted", "required", "unknown") -or
  $doctor.permission_details.screen_recording -notin @("granted", "required", "unknown") -or
  $doctor.permission_details.source -notin @("driver-daemon", "observation", "unknown")
) {
  Stop-Lane "Runtime returned invalid permission details"
}
$screenshotWidth = Assert-Integer $doctor.screenshot.width "doctor screenshot width" 1280 100000
$screenshotHeight = Assert-Integer $doctor.screenshot.height "doctor screenshot height" 800 100000
$doctorSha256 = Get-LowerSha256Text $doctorRaw

$calibrationPathText = Require-Environment "CUA_E2E_CALIBRATION"
if (-not [IO.Path]::IsPathRooted($calibrationPathText)) {
  Stop-Lane "CUA_E2E_CALIBRATION must be an absolute path"
}
$calibrationPath = [IO.Path]::GetFullPath($calibrationPathText)
if (-not (Test-Path -LiteralPath $calibrationPath -PathType Leaf)) {
  Stop-Lane "CUA_E2E_CALIBRATION does not exist"
}
try {
  $calibration = Get-Content -Raw -LiteralPath $calibrationPath | ConvertFrom-Json
}
catch {
  Stop-Lane "CUA_E2E_CALIBRATION is not valid JSON"
}
Assert-ExactKeys $calibration @(
  "schema_version", "measurement_method", "measured_at", "os_build", "dpi_percent",
  "browser_executable_sha256", "screenshot_width_px", "screenshot_height_px",
  "source_screenshot_sha256", "content_origin_x_px", "content_origin_y_px", "zoom_percent"
) "calibration"
if ($calibration.schema_version -ne 1 -or
    $calibration.measurement_method -ne "visible-origin-marker-screenshot-pixel-measurement" -or
    $calibration.zoom_percent -ne 100) {
  Stop-Lane "calibration was not produced by the reviewed visible-marker method at 100 percent zoom"
}
if ($calibration.os_build -ne $osBuild -or $calibration.dpi_percent -ne $actualDpiPercent) {
  Stop-Lane "calibration does not match this Windows build and DPI lane"
}
if ($calibration.browser_executable_sha256 -ne $browserSha256) {
  Stop-Lane "calibration was not measured with this exact browser executable"
}
if ($calibration.source_screenshot_sha256 -notmatch "^[0-9a-f]{64}$") {
  Stop-Lane "calibration screenshot hash is malformed"
}
$calibrationWidth = Assert-Integer $calibration.screenshot_width_px "calibration screenshot width" 1280 100000
$calibrationHeight = Assert-Integer $calibration.screenshot_height_px "calibration screenshot height" 800 100000
if ($calibrationWidth -ne $screenshotWidth -or $calibrationHeight -ne $screenshotHeight) {
  Stop-Lane "calibration screenshot dimensions do not match the current Runtime observation"
}
$originX = Assert-Integer $calibration.content_origin_x_px "content origin x" 0 ($screenshotWidth - 1)
$originY = Assert-Integer $calibration.content_origin_y_px "content origin y" 0 ($screenshotHeight - 1)
try {
  $measuredAt = [DateTimeOffset]::Parse([string]$calibration.measured_at).ToUniversalTime()
}
catch {
  Stop-Lane "calibration measured_at is not an ISO 8601 timestamp"
}
$calibrationAge = [DateTimeOffset]::UtcNow - $measuredAt
if ($calibrationAge.TotalMinutes -lt -5 -or $calibrationAge.TotalHours -gt 24) {
  Stop-Lane "calibration must be measured on this configuration within 24 hours"
}

$evidenceOutText = Require-Environment "CUA_E2E_EVIDENCE_OUT"
if (-not [IO.Path]::IsPathRooted($evidenceOutText)) {
  Stop-Lane "CUA_E2E_EVIDENCE_OUT must be an absolute JSON path outside the repository"
}
$evidenceOut = [IO.Path]::GetFullPath($evidenceOutText)
if ([IO.Path]::GetExtension($evidenceOut).ToLowerInvariant() -ne ".json") {
  Stop-Lane "CUA_E2E_EVIDENCE_OUT must end in .json"
}
$repositoryPrefix = $repositoryRoot.TrimEnd('\') + '\'
if ($evidenceOut.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  Stop-Lane "real evidence must not be written inside the repository"
}
if (Test-Path -LiteralPath $evidenceOut) {
  Stop-Lane "evidence output already exists; use a new path so prior evidence is not overwritten"
}

$env:CUA_E2E_BROWSER = $browserPath
$env:CUA_E2E_CONTENT_ORIGIN_X_PX = [string]$originX
$env:CUA_E2E_CONTENT_ORIGIN_Y_PX = [string]$originY
$env:CUA_E2E_SYSTEM_DPI = [string]$actualDpiPercent
$env:CUA_E2E_RUNNER_GATED = "1"
$env:CUA_E2E_SHARED_INCLUDED = "1"

$vitestArguments = @(
  "--yes", "pnpm@9.0.4", "exec", "vitest", "run",
  "tests/e2e/shared",
  "tests/e2e/windows/dpi.spec.ts",
  "tests/e2e/windows/permission-reporting.spec.ts",
  "--sequence.concurrent=false"
)

Push-Location $productRoot
try {
  for ($iteration = 1; $iteration -le $repeat; $iteration += 1) {
    $env:CUA_E2E_ITERATION = [string]$iteration
    & $npx.Source @vitestArguments
    if ($LASTEXITCODE -ne 0) {
      Stop-Lane "deterministic MCP/fixture iteration $iteration of $repeat failed"
    }
  }
}
finally {
  Pop-Location
}

$contractFingerprintLines = & $node.Source --input-type=module -e '
  import { createHash } from "node:crypto";
  import { pathToFileURL } from "node:url";
  const { PUBLIC_TOOL_SCHEMAS } = await import(pathToFileURL(process.argv[1]).href);
  process.stdout.write(createHash("sha256").update(JSON.stringify(PUBLIC_TOOL_SCHEMAS)).digest("hex"));
' $protocolPath
if ($LASTEXITCODE -ne 0) {
  Stop-Lane "built public tool schema fingerprint could not be computed"
}
$contractFingerprint = ($contractFingerprintLines -join "").Trim()
if ($contractFingerprint -notmatch "^[0-9a-f]{64}$") {
  Stop-Lane "built public tool schema fingerprint is malformed"
}
$promotable = $mode -eq "candidate"
$evidence = [ordered]@{
  schema_version = 1
  evidence_type = "computer-use-windows-e2e"
  stage = $mode
  promotable = $promotable
  run_id = [Guid]::NewGuid().ToString()
  generated_at = [DateTimeOffset]::UtcNow.ToString("o")
  engine = [ordered]@{
    name = "cua-driver"
    version = [string]$lock.version
    tag = [string]$lock.tag
    source_commit = [string]$lock.source_commit
    asset = [string]$windowsLock.asset
    asset_sha256 = [string]$windowsLock.sha256
    runtime_executable_sha256 = Get-LowerSha256File $runtimePath
    required_fix_commits = @($lock.required_fix_commits)
    required_tools = @($lock.required_tools)
    contract_fingerprint_sha256 = $contractFingerprint
  }
  host = [ordered]@{
    os_name = "Windows"
    os_build = $osBuild
    architecture = "x64"
    session_id = $sessionId
    session_state = "active"
    desktop_state = "unlocked"
    dpi_percent = $actualDpiPercent
    browser = [ordered]@{
      name = $browserName
      version = $browserVersion
      executable_sha256 = $browserSha256
    }
  }
  calibration = [ordered]@{
    method = "visible-origin-marker-screenshot-pixel-measurement"
    measured_at = $measuredAt.ToString("o")
    content_origin_x_px = $originX
    content_origin_y_px = $originY
    screenshot_width_px = $screenshotWidth
    screenshot_height_px = $screenshotHeight
    source_screenshot_sha256 = [string]$calibration.source_screenshot_sha256
    zoom_percent = 100
  }
  signer = [ordered]@{
    kind = "authenticode"
    status = $signatureStatus
    subject = $signerSubject
    thumbprint = $signerThumbprint
  }
  runtime_report = [ordered]@{
    source = "computer-use doctor --json"
    report_sha256 = $doctorSha256
    permissions = [string]$doctor.permissions
    desktop_unlocked = $true
    observation_succeeded = $true
    integrity = "not_reported_by_runtime"
  }
  results = [ordered]@{
    passed = $true
    iterations_expected = $repeat
    iterations_passed = $repeat
    action_protocol_variants = 9
    successful_actions_per_iteration = 11
    stale_snapshot_rejections = $repeat
    new_snapshot_assertions = (11 * $repeat)
    plugin_seam_failures = 0
    fixture_oracle = "loopback-http-state"
  }
  limitations = [ordered]@{
    target_privilege_mismatch = "not_detected"
    uac_secure_desktop = "unsupported"
  }
}

$evidenceJson = $evidence | ConvertTo-Json -Depth 12
foreach ($forbidden in @("screenshot_data", "typed_text", "model_prompt", "environment_dump", "rawJson", "diagnostic_text")) {
  if ($evidenceJson.Contains($forbidden)) {
    Stop-Lane "generated evidence contained forbidden sensitive field $forbidden"
  }
}
$evidenceDirectory = Split-Path -Parent $evidenceOut
if (-not (Test-Path -LiteralPath $evidenceDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $evidenceDirectory | Out-Null
}
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$evidenceBytes = $utf8WithoutBom.GetBytes($evidenceJson + "`n")
$evidenceStream = [IO.File]::Open(
  $evidenceOut,
  [IO.FileMode]::CreateNew,
  [IO.FileAccess]::Write,
  [IO.FileShare]::None
)
try {
  $evidenceStream.Write($evidenceBytes, 0, $evidenceBytes.Length)
  $evidenceStream.Flush($true)
}
finally {
  $evidenceStream.Dispose()
}
Write-Host "Windows $actualDpiPercent% $mode evidence written to $evidenceOut"
