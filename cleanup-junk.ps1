# ============================================================
# cleanup-junk.ps1 - Remove junk files/folders from the repo
# Run:  powershell -ExecutionPolicy Bypass -File cleanup-junk.ps1
# NOTE: ASCII-only messages so Windows PowerShell 5.1 can parse it.
# Safe: removes ONLY known junk; never touches code, .env, docs.
# ============================================================

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "=== Step 1: Remove tracked junk files/folders ===" -ForegroundColor Cyan

git rm -r -q --ignore-unmatch `
  artifacts `
  packages/sync/artifacts `
  football-v7-upgrade.patch `
  predictionai-automatic-pipeline-v1-stable.patch `
  predictionai-automatic-pipeline-v1.6-stable.patch `
  predictionai-automatic-pipeline-v1.3-transform.mjs `
  predictionai-automatic-pipeline-v1.4-transform.mjs `
  predictionai-automatic-pipeline-v1.5-transform.mjs `
  predictionai-automatic-pipeline-v1.6-transform.mjs `
  predictionai-automatic-pipeline-v1.7-transform.mjs `
  apply-predictionai-automatic-pipeline-v1.3.ps1 `
  apply-predictionai-automatic-pipeline-v1.4.ps1 `
  apply-predictionai-automatic-pipeline-v1.5.ps1 `
  apply-predictionai-automatic-pipeline-v1.6.ps1 `
  apply-predictionai-automatic-pipeline-v1.7.ps1 `
  rollback-predictionai-automatic-pipeline-v1.3.ps1 `
  rollback-predictionai-automatic-pipeline-v1.4.ps1 `
  rollback-predictionai-automatic-pipeline-v1.5.ps1 `
  rollback-predictionai-automatic-pipeline-v1.6.ps1 `
  rollback-predictionai-automatic-pipeline-v1.7.ps1 `
  check-admin-login-temp.ts check-admin-temp.ts check-all-t180.cjs `
  check-data-range.ts check-next-fresh-odds.cjs `
  find-working-database.ps1 inspect-databases.ts `
  README-PREDICTIONAI-AUTOMATIC-PIPELINE-V1.3.txt `
  README-PREDICTIONAI-AUTOMATIC-PIPELINE-V1.4.txt `
  README-PREDICTIONAI-AUTOMATIC-PIPELINE-V1.5.txt `
  README-PREDICTIONAI-AUTOMATIC-PIPELINE-V1.6.txt `
  README-PREDICTIONAI-AUTOMATIC-PIPELINE-V1.7.txt

if ($LASTEXITCODE -ne 0) {
  Write-Host "git rm reported an error (some paths may not exist) - continuing." -ForegroundColor Yellow
}

Write-Host "=== Step 2: Add ignore rules to .gitignore ===" -ForegroundColor Cyan

$rules = @'

# ===== Junk guard (added by cleanup-junk.ps1) =====
artifacts/
packages/sync/artifacts/
*.patch
predictionai-automatic-pipeline-*
apply-predictionai-*
rollback-predictionai-*
check-*.ts
check-*.cjs
inspect-databases.ts
find-working-database.ps1
README-PREDICTIONAI-AUTOMATIC-PIPELINE-*
'@

Add-Content -Path .gitignore -Value $rules
Write-Host ".gitignore updated." -ForegroundColor Green

Write-Host "=== Step 3: Review changes before commit ===" -ForegroundColor Cyan
git status --short | Select-Object -First 15
$total = (git status --short | Measure-Object -Line).Lines
Write-Host "... total changed lines: $total" -ForegroundColor Yellow

$confirm = Read-Host "Commit these changes? (y/N)"
if ($confirm -match '^[yY]') {
  git add -A
  git commit -m "chore: remove junk artifacts and obsolete pipeline scripts; ignore them going forward"
  Write-Host "Committed." -ForegroundColor Green

  $push = Read-Host "Push to GitHub? (y/N)"
  if ($push -match '^[yY]') {
    git push origin main
    Write-Host "Pushed." -ForegroundColor Green
  } else {
    Write-Host "Not pushed yet. Run: git push origin main" -ForegroundColor Yellow
  }
} else {
  Write-Host "Cancelled - nothing committed. Run: git checkout -- . to revert." -ForegroundColor Yellow
}
