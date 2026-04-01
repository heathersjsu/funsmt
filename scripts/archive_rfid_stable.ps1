# scripts/archive_rfid_stable.ps1

Write-Host "== Pinme: Archiving RFID Stable Version (v2026.01.06) ==" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir "..")

# Ensure remote is correct
Write-Host "Setting remote..."
git remote set-url origin https://github.com/heathersjsu/funsmt
if ($LASTEXITCODE -ne 0) {
    git remote add origin https://github.com/heathersjsu/funsmt
}

# Add all changes
Write-Host "Staging files..."
git add .

# Commit
Write-Host "Committing..."
git commit -m "feat(rfid): Implement Smart Poll, Auto Freq Hopping, and fix Code 15"

# Tag
Write-Host "Tagging v2026.01.06..."
# Delete tag if exists locally to avoid error
git tag -d v2026.01.06 2>$null
git tag -a v2026.01.06 -m "Release: RFID Stable with Smart Poll & Auto FH"

# Push
Write-Host "Pushing to GitHub..."
git push origin main
git push origin v2026.01.06

Write-Host "Archive Complete! Please check: https://github.com/heathersjsu/funsmt" -ForegroundColor Green
