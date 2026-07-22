$ErrorActionPreference = "Continue"

$schema = (Resolve-Path ".\packages\database\prisma\schema.prisma").Path
$envFiles = Get-ChildItem -Path . -Recurse -Force -File |
    Where-Object { $_.Name -like ".env*" }

$workingFile = $null
$workingUrl = $null

foreach ($file in $envFiles) {
    $line = Get-Content $file.FullName |
        Where-Object { $_ -match "^\s*DATABASE_URL\s*=" } |
        Select-Object -First 1

    if (-not $line) {
        continue
    }

    $url = ($line -replace "^\s*DATABASE_URL\s*=\s*", "").Trim()
    $url = $url.Trim('"').Trim("'")

    if ([string]::IsNullOrWhiteSpace($url)) {
        continue
    }

    $masked = $url -replace "://([^:]+):([^@]+)@", '://$1:***@'

    Write-Host ""
    Write-Host "Testing: $($file.FullName)"
    Write-Host "URL: $masked"

    $env:DATABASE_URL = $url

    "SELECT 1;" |
        & npx prisma db execute --schema="$schema" --stdin *> $null

    if ($LASTEXITCODE -eq 0) {
        $workingFile = $file.FullName
        $workingUrl = $url

        Write-Host "RESULT: WORKING" -ForegroundColor Green
        break
    }

    Write-Host "RESULT: FAILED" -ForegroundColor Red
}

if (-not $workingFile) {
    throw "No working DATABASE_URL was found in the project env files."
}

$env:DATABASE_URL = $workingUrl

Write-Host ""
Write-Host "Working env file:" -ForegroundColor Green
Write-Host $workingFile
Write-Host ""
Write-Host "DATABASE_URL has been loaded into this PowerShell session."
