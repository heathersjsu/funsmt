param(
  [string]$HtmlPath = "E:\\Trae\\pinme\\docs\\项目说明.html",
  [string]$PdfPath = "E:\\Trae\\pinme\\docs\\项目说明.pdf"
)

$ErrorActionPreference = "Stop"

function Find-Browser {
  $candidates = @(
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  )
  foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
  return $null
}

if (-not (Test-Path $HtmlPath)) { throw "HTML not found: $HtmlPath" }
$browser = Find-Browser
if (-not $browser) {
  throw "No Chromium-based browser found. Please install Microsoft Edge or Google Chrome."
}

Write-Host "Using browser: $browser"
Write-Host "Printing to PDF: $PdfPath"

# Ensure directory exists
$dir = Split-Path -Parent $PdfPath
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

# Use file:// URI to ensure Chrome/Edge can load local file reliably
$uri = [System.Uri]::new((Resolve-Path $HtmlPath)).AbsoluteUri

# Build argument list to avoid manual quoting issues
$argsList = @(
  "--headless",
  "--disable-gpu",
  "--no-sandbox",
  "--print-to-pdf=$PdfPath",
  $uri
)

# Launch headless browser and wait for completion
$proc = Start-Process -FilePath $browser -ArgumentList $argsList -PassThru -WindowStyle Hidden
$proc.WaitForExit()

if ($proc.ExitCode -ne 0) {
  throw "Headless print failed with exit code $($proc.ExitCode)."
}

# Extra wait in case of delayed filesystem flush
Start-Sleep -Milliseconds 300

if (-not (Test-Path $PdfPath)) { throw "PDF not generated: $PdfPath" }

Write-Host "PDF generated successfully: $PdfPath"