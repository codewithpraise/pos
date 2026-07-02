const fs = require('fs');
const https = require('https');

const file = fs.createWriteStream("public/NotoNastaliqUrdu-Regular.ttf");
https.get("https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoNastaliqUrdu/NotoNastaliqUrdu-Regular.ttf", function(response) {
  response.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Font downloaded successfully!');
  });
}).on('error', (err) => {
  console.error('Error downloading font:', err.message);
});
