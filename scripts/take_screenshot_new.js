const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true
    });
    const page = await browser.newPage();
    const artifactsDir = 'C:/Users/presi/.gemini/antigravity/brain/16f38889-0403-42bc-8ae4-2cfa9e8bc2c5';

    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    // 1. デスクトップ表示 - STAiNYカレンダー（新着パネルとバッジの確認）
    await page.setViewport({ width: 1200, height: 1100 });
    console.log('Navigating to http://localhost:8000/stainy/ ...');
    await page.goto('http://localhost:8000/stainy/', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2000)); // データ読み込みとアニメーション待機
    
    await page.screenshot({ path: path.join(artifactsDir, 'screenshot_new_desktop_stainy.png') });
    console.log('Saved screenshot_new_desktop_stainy.png');

    // 2. 新着テストイベントをクリックしてモーダル詳細の確認
    // 新着リスト内、またはイベントリスト内の「【新着テスト】」をクリックする
    const eventBtn = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('.new-event-row, .event-card'));
      return buttons.find(b => b.innerText.includes('【新着テスト】'));
    });

    if (eventBtn && eventBtn.asElement()) {
      console.log('Clicking dummy event card to open modal...');
      await eventBtn.asElement().click();
      await new Promise(r => setTimeout(r, 1000));
      await page.screenshot({ path: path.join(artifactsDir, 'screenshot_new_modal_detail.png') });
      console.log('Saved screenshot_new_modal_detail.png');
    } else {
      console.log('Could not find dummy event card button on the page.');
    }

  } catch (err) {
    console.error('Error during screenshot capture:', err);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
