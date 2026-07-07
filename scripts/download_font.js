const fs = require('fs');
const https = require('https');
const path = require('path');

const targetPath = path.join(__dirname, "../public/NotoNastaliqUrdu-Regular.ttf");
const file = fs.createWriteStream(targetPath);

console.log('Downloading Noto Nastaliq Urdu font...');

const request = https.get("https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoNastaliqUrdu/NotoNastaliqUrdu-Regular.ttf", function(response) {
  if (response.statusCode !== 200) {
    console.error(`Error downloading font: Server responded with status code ${response.statusCode}`);
    file.close();
    fs.unlinkSync(targetPath); // Delete corrupted/incomplete file
    process.exit(1);
  }

  response.pipe(file);
  
  file.on('finish', () => {
    file.close();
    console.log('Font downloaded successfully!');
  });
});

request.on('error', (err) => {
  console.error('Network error downloading font:', err.message);
  file.close();
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath); // Cleanup
  }
  process.exit(1);
});
