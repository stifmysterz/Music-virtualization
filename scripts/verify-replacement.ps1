[CmdletBinding()]
param(
    [string]$PackageRoot
)

$ErrorActionPreference = 'Stop'

if (-not $PackageRoot) {
    $scriptDir = $PSScriptRoot
    if (-not $scriptDir) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    if (-not $scriptDir) {
        throw 'Cannot determine the script location; pass -PackageRoot explicitly.'
    }
    $PackageRoot = Split-Path -Parent $scriptDir
}

$PackageRoot = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($PackageRoot)
$source = Join-Path $PackageRoot '61.html'
$replacement = Join-Path $PackageRoot 'replacement\61.html'
$hashManifest = Join-Path $PackageRoot 'replacement.sha256'

if (-not (Test-Path -LiteralPath $replacement -PathType Leaf)) {
    throw "Missing replacement payload: $replacement"
}

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
        }
        finally {
            $sha.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

$replacementHash = Get-Sha256 $replacement

$expectedHash = $null
$expectedLabel = $null
if (Test-Path -LiteralPath $source -PathType Leaf) {
    $expectedHash = Get-Sha256 $source
    $expectedLabel = $source
}
elseif (Test-Path -LiteralPath $hashManifest -PathType Leaf) {
    $expectedHash = ([IO.File]::ReadAllText($hashManifest)).Trim().ToUpperInvariant()
    if ($expectedHash -notmatch '^[0-9A-F]{64}$') {
        throw "Invalid replacement SHA-256 manifest: $hashManifest"
    }
    $expectedLabel = $hashManifest
}
else {
    throw "Cannot verify replacement payload: missing both $source and $hashManifest"
}

if ($expectedHash -ne $replacementHash) {
    throw @"
STALE REPLACEMENT: replacement/61.html does not match its source of truth.
  Expected:    $expectedHash  $expectedLabel
  Replacement: $replacementHash  $replacement
Synchronize replacement/61.html before building or installing the Replace Pack.
"@
}

Write-Host "PASS: replacement/61.html is fresh. (SHA256 $expectedHash)"
