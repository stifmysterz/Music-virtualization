[CmdletBinding()]
param(
    [string]$PackageRoot,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not $PackageRoot) {
    $scriptDir = $PSScriptRoot
    if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
    if (-not $scriptDir) { throw 'Cannot determine the script location; pass -PackageRoot explicitly.' }
    $PackageRoot = Split-Path -Parent $scriptDir
}
$PackageRoot = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($PackageRoot)

if (-not $OutputPath) {
    $OutputPath = Join-Path $PackageRoot 'Music-Visualisation-Claude-Code-Replace.zip'
}
$OutputPath = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($OutputPath)
$outputDir = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDir -PathType Container)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$source = Join-Path $PackageRoot '61.html'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing source of truth: $source" }

& (Join-Path $PackageRoot 'scripts\verify-protected-paths.ps1') -PackageRoot $PackageRoot

$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ('sub-remix-replace-' + [Guid]::NewGuid().ToString('N'))
$tempArchive = Join-Path $outputDir ('.' + [IO.Path]::GetFileName($OutputPath) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')

$payload = @(
    @{ Source = '61.html'; Destination = 'replacement\61.html' },
    @{ Source = 'scripts\install-replace.ps1'; Destination = 'scripts\install-replace.ps1' },
    @{ Source = 'scripts\verify-protected-paths.ps1'; Destination = 'scripts\verify-protected-paths.ps1' },
    @{ Source = 'scripts\verify-replacement.ps1'; Destination = 'scripts\verify-replacement.ps1' },
    @{ Source = 'CLAUDE_CODE_REPLACE.md'; Destination = 'CLAUDE_CODE_REPLACE.md' },
    @{ Source = 'manifest.json'; Destination = 'manifest.json' },
    @{ Source = 'README.md'; Destination = 'README.md' }
)

try {
    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    foreach ($item in $payload) {
        $from = Join-Path $PackageRoot $item.Source
        if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { throw "Missing Replace Pack input: $from" }
        $to = Join-Path $stagingRoot $item.Destination
        $parent = Split-Path -Parent $to
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $from -Destination $to
    }

    $sourceStream = [IO.File]::OpenRead($source)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $sourceHash = ([BitConverter]::ToString($sha.ComputeHash($sourceStream))).Replace('-', '') }
        finally { $sha.Dispose() }
    }
    finally { $sourceStream.Dispose() }
    [IO.File]::WriteAllText((Join-Path $stagingRoot 'replacement.sha256'), $sourceHash + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))

    & (Join-Path $stagingRoot 'scripts\verify-protected-paths.ps1') -PackageRoot $stagingRoot
    & (Join-Path $stagingRoot 'scripts\verify-replacement.ps1') -PackageRoot $stagingRoot

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stagingRoot, $tempArchive, [IO.Compression.CompressionLevel]::Optimal, $false)
    & (Join-Path $PackageRoot 'scripts\verify-replace-zip.ps1') -PackageRoot $PackageRoot -ArchivePath $tempArchive

    Move-Item -LiteralPath $tempArchive -Destination $OutputPath -Force
    Write-Host "PASS: generated fresh Replace ZIP: $OutputPath"
}
finally {
    if (Test-Path -LiteralPath $tempArchive) { Remove-Item -LiteralPath $tempArchive -Force }
    if (Test-Path -LiteralPath $stagingRoot) {
        $resolvedStage = [IO.Path]::GetFullPath($stagingRoot)
        $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (-not $resolvedStage.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove staging path outside the temp directory: $resolvedStage"
        }
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}

