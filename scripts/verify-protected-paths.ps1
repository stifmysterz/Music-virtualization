[CmdletBinding()]
param(
    # Do NOT give this a $PSScriptRoot-based default. When the script is launched
    # with `powershell -File <script>`, $PSScriptRoot is still empty at the moment
    # param() defaults are evaluated, so `Split-Path -Parent $PSScriptRoot` threw
    # "Cannot bind argument to parameter 'Path' because it is an empty string"
    # before the body ever ran -- which is exactly how README step 3 invokes it.
    # The value is resolved in the body instead, where $PSScriptRoot is populated.
    [string]$PackageRoot
)

$ErrorActionPreference = 'Stop'

if (-not $PackageRoot) {
    $scriptDir = $PSScriptRoot
    if (-not $scriptDir) {
        # Belt and braces for hosts that populate neither: dot-sourcing, ISE, iex.
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    if (-not $scriptDir) {
        throw 'Cannot determine the script location; pass -PackageRoot explicitly.'
    }
    $PackageRoot = Split-Path -Parent $scriptDir
}

# Resolve through the PowerShell provider, not [IO.Path]::GetFullPath(): the
# latter resolves a relative path against the .NET process working directory,
# which does not follow Set-Location.
$PackageRoot = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($PackageRoot)

$replacementRoot = Join-Path $PackageRoot 'replacement'
$protected = @('source', 'assets', 'shaders')

if (-not (Test-Path -LiteralPath $replacementRoot -PathType Container)) {
    throw "Missing replacement directory: $replacementRoot"
}

$violations = Get-ChildItem -LiteralPath $replacementRoot -Force -Recurse | Where-Object {
    $relative = $_.FullName.Substring($replacementRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $top = ($relative -split '[\/]')[0]
    $protected -contains $top.ToLowerInvariant()
}

if ($violations) {
    $paths = ($violations.FullName | ForEach-Object { " - $_" }) -join [Environment]::NewLine
    throw "Protected paths found in replacement payload:$([Environment]::NewLine)$paths"
}

Write-Host "PASS: replacement payload contains no protected paths. ($replacementRoot)"
