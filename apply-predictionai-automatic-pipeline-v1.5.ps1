param()

# PredictionAI Automatic Pipeline installer v1.5 - route-block API integration

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )
    Write-Host ""
    Write-Host "=== $Name ==="
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

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
Write-Host "Repository: $repoRoot"

$stablePatch = Join-Path $PSScriptRoot 'predictionai-automatic-pipeline-v1-stable.patch'
$transformer = Join-Path $PSScriptRoot 'predictionai-automatic-pipeline-v1.5-transform.mjs'
if (-not (Test-Path -LiteralPath $stablePatch -PathType Leaf)) { throw "Missing stable patch: $stablePatch" }
if (-not (Test-Path -LiteralPath $transformer -PathType Leaf)) { throw "Missing transformer: $transformer" }

$existingFiles = @(
    'packages/sync/src/index.ts',
    'scripts/api-football-quota-preload.mjs',
    'apps/worker/src/jobs.ts',
    'apps/worker/src/index.ts',
    'apps/api/src/server.ts',
    'apps/api/src/app.ts',
    'apps/web/components/RealtimeHistoryRefresh.tsx',
    'apps/web/components/UpcomingPredictionBoard.tsx',
    'packages/sync/src/history-result-worker.ts',
    'apps/api/src/realtime-server.ts'
)

$newFiles = @(
    'packages/sync/src/automatic-pipeline-core.ts',
    'packages/sync/src/automatic-pipeline-engine.ts',
    'packages/sync/tests/automatic-pipeline-core.test.ts',
    'apps/web/app/admin/automation/page.tsx',
    'deploy/pm2-ecosystem.config.cjs',
    'docs/AUTOMATIC_PIPELINE.md',
    'scripts/verify-automatic-pipeline-v1.mjs'
)

foreach ($relative in $existingFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relative) -PathType Leaf)) {
        throw "Required current source file is missing: $relative"
    }
}
foreach ($relative in $newFiles) {
    if (Test-Path -LiteralPath (Join-Path $repoRoot $relative)) {
        throw "New automatic-pipeline path already exists: $relative. If a previous automatic-pipeline install succeeded, use its rollback script first."
    }
}

$backupDir = Join-Path $repoRoot '.predictionai-automatic-pipeline-v1-backup'
if (Test-Path -LiteralPath $backupDir) {
    throw "Backup directory already exists: $backupDir. Do not overwrite it; use rollback or move it aside first."
}

# Hide the safety backup from normal git status without changing tracked .gitignore.
$gitExclude = Join-Path $repoRoot '.git/info/exclude'
if (Test-Path -LiteralPath $gitExclude) {
    $excludeContent = Get-Content -LiteralPath $gitExclude -Raw
    if ($excludeContent -notmatch '(?m)^\.predictionai-automatic-pipeline-v1-backup/$') {
        Add-Content -LiteralPath $gitExclude -Value "`n.predictionai-automatic-pipeline-v1-backup/"
    }
}

Invoke-Checked -Name 'Transformer JavaScript syntax' -Command { node --check $transformer }
Invoke-Checked -Name 'Stable patch syntax/preflight' -Command { git apply --check --whitespace=error-all $stablePatch }

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("predictionai-auto-pipeline-preflight-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
    foreach ($relative in $existingFiles) {
        $source = Join-Path $repoRoot $relative
        $target = Join-Path $tempRoot $relative
        Ensure-ParentDirectory -Path $target
        Copy-Item -LiteralPath $source -Destination $target -Force
    }

    Write-Host ""
    Write-Host '=== Transformer preflight on exact current local files ==='
    Push-Location $tempRoot
    try {
        & node $transformer
        if ($LASTEXITCODE -ne 0) { throw "Transformer preflight pass 1 failed with exit code $LASTEXITCODE" }
        $fingerprint1 = Get-Fingerprint -BasePath $tempRoot -RelativePaths $existingFiles
        & node $transformer
        if ($LASTEXITCODE -ne 0) { throw "Transformer preflight pass 2 failed with exit code $LASTEXITCODE" }
        $fingerprint2 = Get-Fingerprint -BasePath $tempRoot -RelativePaths $existingFiles
        if ($fingerprint1 -ne $fingerprint2) {
            throw 'Transformer is not idempotent on the exact local source tree.'
        }
        Write-Host 'PREDICTIONAI_AUTOMATIC_PIPELINE_V1_3_LOCAL_TRANSFORM_PREFLIGHT_PASS'
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$preFingerprint = Get-Fingerprint -BasePath $repoRoot -RelativePaths $existingFiles
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
foreach ($relative in $existingFiles) {
    $source = Join-Path $repoRoot $relative
    $target = Join-Path $backupDir $relative
    Ensure-ParentDirectory -Path $target
    Copy-Item -LiteralPath $source -Destination $target -Force
}

$manifestPath = Join-Path $backupDir 'manifest.json'
$manifest = [ordered]@{
    version = 'predictionai-automatic-pipeline-v1'
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    repository = $repoRoot
    preUpgradeFingerprint = $preFingerprint
    existingFiles = $existingFiles
    newFiles = $newFiles
    installSucceeded = $false
    completedAt = $null
    postUpgradeFingerprint = $null
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$applied = $false
try {
    Invoke-Checked -Name 'Apply automatic pipeline stable files' -Command { git apply --whitespace=error-all $stablePatch }
    $applied = $true

    Invoke-Checked -Name 'Transform current V11/current-main source' -Command { node $transformer }
    Invoke-Checked -Name 'Automatic pipeline static contract verification' -Command { node scripts/verify-automatic-pipeline-v1.mjs }
    Invoke-Checked -Name 'Prisma generate' -Command { npm run db:generate }
    Invoke-Checked -Name 'Full repository verify (typecheck + tests + lint + build)' -Command { npm run verify }

    $postFingerprint = Get-Fingerprint -BasePath $repoRoot -RelativePaths $existingFiles
    $manifest['installSucceeded'] = $true
    $manifest['completedAt'] = (Get-Date).ToUniversalTime().ToString('o')
    $manifest['postUpgradeFingerprint'] = $postFingerprint
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    Write-Host ""
    Write-Host '=== UPDATE COMPLETE ==='
    Write-Host 'PredictionAI automatic fixture/prediction/result/realtime pipeline V1.3 applied and full repository verify passed.'
    Write-Host 'No database schema migration was required.'
    Write-Host 'The pre-upgrade V11/current state backup is retained locally for safe rollback.'
    Write-Host 'Production process config: deploy/pm2-ecosystem.config.cjs'
}
catch {
    Write-Host ""
    Write-Host 'Automatic pipeline installation failed. Restoring the exact pre-upgrade source state...'
    foreach ($relative in $existingFiles) {
        $backup = Join-Path $backupDir $relative
        $target = Join-Path $repoRoot $relative
        if (Test-Path -LiteralPath $backup -PathType Leaf) {
            Ensure-ParentDirectory -Path $target
            Copy-Item -LiteralPath $backup -Destination $target -Force
        }
    }
    if ($applied) {
        foreach ($relative in $newFiles) {
            $target = Join-Path $repoRoot $relative
            if (Test-Path -LiteralPath $target) {
                Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
            }
        }
    }

    $restoredFingerprint = Get-Fingerprint -BasePath $repoRoot -RelativePaths $existingFiles
    if ($restoredFingerprint -ne $preFingerprint) {
        Write-Error "Automatic rollback fingerprint mismatch. Safety backup retained at $backupDir"
    }
    else {
        Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host 'PREDICTIONAI_AUTOMATIC_PIPELINE_V1_PRE_UPGRADE_SOURCE_RESTORED'
        Write-Host 'Your pre-existing V11/current changes were preserved; no git restore/reset was used.'
    }
    throw
}
