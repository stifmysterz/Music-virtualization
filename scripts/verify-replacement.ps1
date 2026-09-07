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

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Missing source of truth: $source"
}
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

$sourceHash = Get-Sha256 $source
$replacementHash = Get-Sha256 $replacement

if ($sourceHash -ne $replacementHash) {
    throw @"
STALE REPLACEMENT: replacement/61.html does not match root 61.html.
  Source:      $sourceHash  $source
  Replacement: $replacementHash  $replacement
Synchronize replacement/61.html before building or installing the Replace Pack.
"@
}

Write-Host "PASS: replacement/61.html matches root 61.html. (SHA256 $sourceHash)"
