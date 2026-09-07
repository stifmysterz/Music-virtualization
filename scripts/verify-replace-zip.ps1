[CmdletBinding()]
param(
    [string]$PackageRoot,
    [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'

if (-not $PackageRoot) {
    $scriptDir = $PSScriptRoot
    if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
    if (-not $scriptDir) { throw 'Cannot determine the script location; pass -PackageRoot explicitly.' }
    $PackageRoot = Split-Path -Parent $scriptDir
}
$PackageRoot = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($PackageRoot)

if (-not $ArchivePath) {
    $ArchivePath = Join-Path $PackageRoot 'Music-Visualisation-Claude-Code-Replace.zip'
}
$ArchivePath = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($ArchivePath)
$source = Join-Path $PackageRoot '61.html'

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing source of truth: $source" }
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw "Missing Replace ZIP: $ArchivePath" }

function Get-StreamSha256([IO.Stream]$Stream) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Stream))).Replace('-', '') }
    finally { $sha.Dispose() }
}

$sourceStream = [IO.File]::OpenRead($source)
try { $sourceHash = Get-StreamSha256 $sourceStream }
finally { $sourceStream.Dispose() }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
try {
    $payloadEntries = @($archive.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq 'replacement/61.html' })
    if ($payloadEntries.Count -ne 1) { throw "Replace ZIP must contain exactly one replacement/61.html entry." }
    $hashEntries = @($archive.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq 'replacement.sha256' })
    if ($hashEntries.Count -ne 1) { throw "Replace ZIP must contain exactly one replacement.sha256 entry." }

    $payloadStream = $payloadEntries[0].Open()
    try { $payloadHash = Get-StreamSha256 $payloadStream }
    finally { $payloadStream.Dispose() }

    $reader = New-Object IO.StreamReader($hashEntries[0].Open())
    try { $declaredHash = $reader.ReadToEnd().Trim().ToUpperInvariant() }
    finally { $reader.Dispose() }

    if ($payloadHash -ne $sourceHash) {
        throw "STALE REPLACE ZIP: archived replacement/61.html ($payloadHash) does not match root 61.html ($sourceHash)."
    }
    if ($declaredHash -ne $sourceHash) {
        throw "STALE REPLACE ZIP: replacement.sha256 ($declaredHash) does not match root 61.html ($sourceHash)."
    }
}
finally {
    $archive.Dispose()
}

Write-Host "PASS: Replace ZIP contains the current root 61.html. (SHA256 $sourceHash)"
