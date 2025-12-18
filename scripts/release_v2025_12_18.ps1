# Release Script for v2025.12.18
Write-Host "== Pinme: Release v2025.12.18 ==" -ForegroundColor Cyan

# 1. Add all changes
Write-Host "-> git add ." -ForegroundColor Yellow
git add .

# 2. Commit
Write-Host "-> git commit" -ForegroundColor Yellow
git commit -m "Release: v2025.12.18 - UI: Owner font style update"

# 3. Tag
Write-Host "-> git tag v2025.12.18" -ForegroundColor Yellow
# Delete tag if exists locally to avoid error (optional, safe to ignore error)
git tag -d v2025.12.18 2>$null
git tag v2025.12.18

# 4. Push
Write-Host "-> git push origin main --tags" -ForegroundColor Yellow
git push origin main --tags

Write-Host "Release v2025.12.18 completed!" -ForegroundColor Green
