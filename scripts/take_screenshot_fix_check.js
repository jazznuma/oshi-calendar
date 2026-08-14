const puppeteer = require('puppeteer-core');
const path = require('path');
const http = require('http');
const fs = require('fs');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const docsDir = path.join(__dirname, '..', 'docs');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(docsDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(data);
    }
  });
});

server.listen(8085, async () => {
  console.log('Server running at http://localhost:8085');
  try {
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--window-size=1280,800']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto('http://localhost:8085/', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    const artifactPath = 'C:\\Users\\presi\\.gemini\\antigravity\\brain\\16f38889-0403-42bc-8ae4-2cfa9e8bc2c5\\screenshot_fix_check.png';
    await page.screenshot({ path: artifactPath, fullPage: true });
    console.log('Screenshot saved to:', artifactPath);

    await browser.close();
  } catch (err) {
    console.error('Error taking screenshot:', err);
  } finally {
    server.close();
  }
});
