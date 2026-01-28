
Add-Type -AssemblyName System.Drawing

function Resize-WithPadding {
    param (
        [string]$Path,
        [double]$ScaleFactor
    )

    if (-not (Test-Path $Path) -and -not (Test-Path "$Path.bak")) {
        Write-Host "File not found: $Path"
        return
    }

    # Prefer backup as source to avoid double-resizing/quality loss and ensure we work from original
    $sourcePath = $Path
    if (Test-Path "$Path.bak") {
        Write-Host "Found backup, using $Path.bak as source for better quality..."
        $sourcePath = "$Path.bak"
    } else {
        # Create backup if it doesn't exist
        Copy-Item $Path "$Path.bak"
        Write-Host "Created backup at $Path.bak"
    }

    Write-Host "Processing $Path (source: $sourcePath) with scale $ScaleFactor..."

    # Load original
    $img = [System.Drawing.Image]::FromFile($sourcePath)
    $width = $img.Width
    $height = $img.Height

    # Calculate new dimensions (content size)
    $newWidth = [int]($width * $ScaleFactor)
    $newHeight = [int]($height * $ScaleFactor)
    
    # Center position
    $x = [int](($width - $newWidth) / 2)
    $y = [int](($height - $newHeight) / 2)

    # Create new bitmap with SAME original dimensions (canvas size stays same)
    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $graph = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Set high quality
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graph.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Clear with transparent background
    $graph.Clear([System.Drawing.Color]::Transparent)

    # Draw scaled image in center
    $graph.DrawImage($img, $x, $y, $newWidth, $newHeight)

    # Dispose original to release file lock
    $img.Dispose()
    $graph.Dispose()

    # Save over the main file
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    
    Write-Host "Done. Resized content to $($ScaleFactor * 100)% center."
}

# Resize adaptive icon (Android foreground) - 50% size
Resize-WithPadding -Path "e:\Trae\pinme\assets\adaptive-icon.png" -ScaleFactor 0.50

# Resize standard icon (iOS/General) - 50% size
Resize-WithPadding -Path "e:\Trae\pinme\assets\icon.png" -ScaleFactor 0.50
