const { Jimp } = require('jimp');
const path = require('path');
const fs = require('fs');

async function generateIcon(sourceName, targetName, scale, isAdaptive) {
  const assetsDir = path.join(__dirname, '../assets');
  const sourcePath = path.join(assetsDir, sourceName);
  const targetPath = path.join(assetsDir, targetName);
  
  // Try to find the pristine backup first
  let inputPath = sourcePath + '.bak';
  if (!fs.existsSync(inputPath)) {
    // If no .bak, check if the source itself exists
    inputPath = sourcePath;
    if (!fs.existsSync(inputPath)) {
      console.error(`Source not found: ${inputPath}`);
      return;
    }
  }

  try {
    console.log(`Reading source from: ${path.basename(inputPath)}`);
    const image = await Jimp.read(inputPath);

    // 1. Autocrop to remove existing padding
    console.log('Autocropping to remove transparent borders...');
    image.autocrop();

    // 2. Calculate target dimensions
    // We want the *content* (logo) to occupy 'scale' percentage of the 1024x1024 canvas
    const CANVAS_SIZE = 1024;
    const targetSize = Math.floor(CANVAS_SIZE * scale);

    console.log(`Resizing content to fit ${targetSize}x${targetSize} (scale: ${scale})`);
    
    // Resize to fit within targetSize while maintaining aspect ratio
    // Try object syntax if arguments fail (Jimp v1 vs v0 differences?)
    try {
      image.contain({ w: targetSize, h: targetSize });
    } catch (e) {
      // Fallback to standard arguments
      image.contain(targetSize, targetSize);
    }

    // 3. Create background and composite
    const bgColor = isAdaptive ? 0x00000000 : 0xFFFFFFFF; // Transparent vs White
    const background = new Jimp({ width: CANVAS_SIZE, height: CANVAS_SIZE, color: bgColor });

    // Composite center
    const x = (CANVAS_SIZE - image.bitmap.width) / 2;
    const y = (CANVAS_SIZE - image.bitmap.height) / 2;

    background.composite(image, x, y);

    await background.write(targetPath);
    console.log(`Success: ${targetName} created.`);
  } catch (err) {
    console.error(`Error processing ${targetName}:`, err);
  }
}

async function main() {
  // User reported "didn't get bigger". Boosting scale significantly.
  // Adaptive: 0.4 -> 0.65 (Near max safe zone)
  // Standard: 0.6 -> 0.85 (Large)
  
  // 1. Launcher Adaptive Icon (Android)
  await generateIcon('adaptive-icon.png', 'launcher-adaptive-icon.png', 0.65, true);
  
  // 2. Launcher Standard Icon (iOS/Home Screen)
  await generateIcon('icon.png', 'launcher-icon.png', 0.85, false);
}

main();
