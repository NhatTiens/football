param(
    [switch]$SkipPrismaGenerate
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "Football AI Platform - Windows clean install" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"

if ($ProjectRoot -match "\\OneDrive\\") {
    Write-Warning "Project is inside OneDrive. File locking may cause EPERM errors. Recommended location: C:\dev\football-ai-platform-mvp"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found. Install Node.js 20.9+ (Node.js 22 recommended)."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found. Reinstall Node.js with npm enabled."
}

Write-Host "Node: $(node --version)"
Write-Host "npm:  $(npm --version)"

# Stop development processes that may lock files under node_modules.
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if (Test-Path "node_modules") {
    Write-Host "Removing partial node_modules..."
    try {
        Remove-Item "node_modules" -Recurse -Force -ErrorAction Stop
    }
    catch {
        Write-Warning "PowerShell could not remove node_modules. Retrying with cmd.exe..."
        cmd.exe /d /c "rmdir /s /q node_modules"
    }
}

# Sanitize lockfiles from older packages created against a private build registry.
$LockPath = Join-Path $ProjectRoot "package-lock.json"
if (Test-Path $LockPath) {
    $InternalRegistry = "https://packages.applied-caas-gateway1.internal.api.openai.org/artifactory/api/npm/npm-public"
    $PublicRegistry = "https://registry.npmjs.org"
    $Content = [System.IO.File]::ReadAllText($LockPath)
    if ($Content.Contains($InternalRegistry)) {
        Write-Host "Replacing private registry URLs in package-lock.json..."
        $Content = $Content.Replace($InternalRegistry, $PublicRegistry)
        [System.IO.File]::WriteAllText(
            $LockPath,
            $Content,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
}

Write-Host "Configuring the project npm registry..."
npm config set registry "https://registry.npmjs.org/" --location=project
npm config delete proxy --location=project 2>$null
npm config delete https-proxy --location=project 2>$null

Write-Host "Verifying npm cache..."
npm cache verify

Write-Host "Installing dependencies from the public npm registry..."
npm install --registry="https://registry.npmjs.org/"

if (-not $SkipPrismaGenerate) {
    Write-Host "Generating Prisma Client..."
    npm run db:generate
}

Write-Host "Installation completed successfully." -ForegroundColor Green
Write-Host "Next commands:"
Write-Host "  npm run db:push"
Write-Host "  npm run db:seed"
Write-Host "  npm run worker -- generate"
Write-Host "  npm run dev"
