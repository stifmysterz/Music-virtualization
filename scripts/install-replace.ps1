[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    # Must name the target project directory. A relative path is resolved against
    # your current PowerShell location (see the resolution note below); passing an
    # absolute path is still the safest habit because the resolved root is what
    # gets overwritten.
    [Parameter(Mandatory)]
    [string]$Target
)

$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$replacementRoot = Join-Path $packageRoot 'replacement'

# Resolve -Target through the PowerShell provider rather than
# [IO.Path]::GetFullPath(). GetFullPath() resolves a relative path against the
# .NET process working directory, which does NOT follow Set-Location: standing in
# C:\Users\me and passing -Target "." resolved to whichever directory the host
# process happened to start in, and the Copy-Item below would then overwrite
# 61.html in a project the caller never named -- with no backup taken.
$targetRoot = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($Target)
if (-not [IO.Path]::IsPathRooted($targetRoot)) {
    throw "Target did not resolve to an absolute path: $Target"
}

$protected = @('source', 'assets', 'shaders')

& (Join-Path $PSScriptRoot 'verify-protected-paths.ps1') -PackageRoot $packageRoot
& (Join-Path $PSScriptRoot 'verify-replacement.ps1') -PackageRoot $packageRoot

if (-not (Test-Path -LiteralPath $targetRoot -PathType Container)) {
    throw "Target project directory does not exist: $targetRoot"
}

# Windows may hand us an 8.3 short path (for example CONCEP~1) while GetFullPath()
# expands the destination to its long form. Canonicalize the existing directory first so the
# containment comparison below does not reject two spellings of the same target directory.
$targetRoot = (Get-Item -LiteralPath $targetRoot).FullName

# Echo the resolved root before touching anything, so a mis-resolved -Target is
# visible in the -WhatIf preview instead of only after the overwrite.
Write-Host "Target project: $targetRoot"

$files = Get-ChildItem -LiteralPath $replacementRoot -Force -Recurse -File |
    Where-Object { $_.Name -ne 'README.md' }

if (-not $files) {
    Write-Host 'No replacement payload files found; nothing was changed.'
    return
}

$planned = New-Object System.Collections.Generic.List[string]

foreach ($file in $files) {
    $relative = $file.FullName.Substring($replacementRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $top = ($relative -split '[\/]')[0].ToLowerInvariant()
    if ($protected -contains $top) {
        throw "Refusing protected path: $relative"
    }

    $destination = [IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
    $targetPrefix = $targetRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $destination.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing path outside target: $relative"
    }

    $planned.Add($destination)

    if ($PSCmdlet.ShouldProcess($destination, 'Copy replacement file')) {
        $parent = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    }
}

Write-Host ''
Write-Host ("Files in scope ({0}) -- nothing outside this list is written:" -f $planned.Count)
foreach ($p in $planned) { Write-Host "  $p" }
Write-Host 'Protected directories (source/, assets/, shaders/) were not touched.'
