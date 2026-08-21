# PredictionAI Automatic Pipeline rollback v1.4 - preserves pre-upgrade source backup
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Ensure-ParentDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
}

function Get-Fingerprint {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths
    )
    $parts = foreach ($relative in $RelativePaths) {
        $full = Join-Path $BasePath $relative
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
            throw "Fingerprint source is missing: $relative"
        }
        $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
        "$relative=$hash"
    }
    $joined = [string]::Join("`n", $parts)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($joined)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-RepositoryRootUnicodeSafe {
    param([Parameter(Mandatory = $true)][string]$StartPath)

    $current = New-Object System.IO.DirectoryInfo($StartPath)
    while ($null -ne $current) {
        $gitMarker = Join-Path $current.FullName '.git'
        if (Test-Path -LiteralPath $gitMarker) {
            return $current.FullName
        }
        $current = $current.Parent
    }

    throw 'Could not locate the Git repository root. Run this script from inside football-ai-platform-scientific.'
}

$repoRoot = Get-RepositoryRootUnicodeSafe -StartPath (Get-Location).ProviderPath
Set-Location -LiteralPath $repoRoot
$backupDir = Join-Path $repoRoot '.predictionai-automatic-pipeline-v1-backup'
$manifestPath = Join-Path $backupDir 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Automatic-pipeline V1 backup manifest was not found. Nothing safe to roll back.'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$existingFiles = @($manifest.existingFiles | ForEach-Object { [string]$_ })
$newFiles = @($manifest.newFiles | ForEach-Object { [string]$_ })

if ($manifest.installSucceeded -eq $true -and $manifest.postUpgradeFingerprint -and -not $Force) {
    $currentFingerprint = Get-Fingerprint -BasePath $repoRoot -RelativePaths $existingFiles
    if ($currentFingerprint -ne [string]$manifest.postUpgradeFingerprint) {
        throw 'Touched source files changed after the automatic-pipeline install. Rollback refused to avoid overwriting newer work. Re-run with -Force only if you intentionally want the exact pre-upgrade files restored.'
    }
}

foreach ($relative in $existingFiles) {
    $backup = Join-Path $backupDir $relative
    $target = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
        throw "Safety backup is incomplete: $relative"
    }
    Ensure-ParentDirectory -Path $target
    Copy-Item -LiteralPath $backup -Destination $target -Force
}
foreach ($relative in $newFiles) {
    $target = Join-Path $repoRoot $relative
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Force
    }
}

$restoredFingerprint = Get-Fingerprint -BasePath $repoRoot -RelativePaths $existingFiles
if ($restoredFingerprint -ne [string]$manifest.preUpgradeFingerprint) {
    throw "Rollback fingerprint mismatch. Backup has been retained at $backupDir"
}

Remove-Item -LiteralPath $backupDir -Recurse -Force
Write-Host 'PredictionAI automatic pipeline V1 rollback completed.'
Write-Host 'Exact pre-upgrade source state restored (including the already-verified O/U V11 changes).'
Write-Host 'No database schema migration was part of this upgrade.'
