param(
  [string]$RepoUrl = "https://github.com/heathersjsu/funsmt.git",
  [string]$UserName = "",
  [string]$UserEmail = ""
)

Write-Host "== Pinme: push to GitHub ==" -ForegroundColor Cyan
Write-Host "Repo URL: $RepoUrl"

function Exec($cmd) {
Write-Host "-> $cmd" -ForegroundColor Yellow
  try {
    iex $cmd
  } catch {
    Write-Host "Failed: $cmd" -ForegroundColor Red
    throw $_
  }
}

# Ensure we are in project root (this script is under scripts/)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir "..")

# 1) Verify git is available
try {
  git --version | Out-Null
} catch {
  Write-Host "Git not installed or not in PATH. Please install Git: https://git-scm.com/" -ForegroundColor Red
  exit 1
}

# 2) Init repo if needed
if (-not (Test-Path ".git")) {
  Exec "git init"
}

# 3) Set user config if provided
if ($UserName -and $UserName.Trim().Length -gt 0) { Exec "git config user.name `"$UserName`"" }
if ($UserEmail -and $UserEmail.Trim().Length -gt 0) { Exec "git config user.email `"$UserEmail`"" }

# 4) Stage files
Exec "git add ."

# 5) Commit (handle empty commit gracefully)
try {
  Exec "git commit -m `"chore: initial commit or sync`""
} catch {
  Write-Host "No changes to commit, proceeding..." -ForegroundColor DarkYellow
}

# 6) Add or update remote
$hasOrigin = $false
try {
  $remotes = git remote -v
  if ($remotes -match "origin") { $hasOrigin = $true }
} catch {}

if ($hasOrigin) { Exec "git remote set-url origin $RepoUrl" } else { Exec "git remote add origin $RepoUrl" }

# 7) Set main branch
Exec "git branch -M main"

# 8) Push, handle unrelated histories
$pushOk = $true
try {
  Exec "git push -u origin main"
} catch {
  $pushOk = $false
}

if (-not $pushOk) {
  Write-Host "Initial push failed; attempting fetch + pull with --allow-unrelated-histories..." -ForegroundColor DarkYellow
  try {
    Exec "git fetch origin"
    Exec "git pull origin main --allow-unrelated-histories"
    Exec "git add ."
    try { Exec "git commit -m `"chore: merge local into origin/main`"" } catch {}
    Exec "git push -u origin main"
  } catch {
    Write-Host "Push still failed. Please check credentials and remote repo status." -ForegroundColor Red
    exit 1
  }
}

Write-Host "Push completed: $RepoUrl (branch: main)" -ForegroundColor Green