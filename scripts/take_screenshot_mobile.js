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

    // 1. モバイル表示 - 日付非選択（新着リストが下部に回り、今後の予定が上に来ているはず）
    await page.setViewport({ width: 450, height: 1000 });
    console.log('Navigating to http://localhost:8000/stainy/ ...');
    await page.goto('http://localhost:8000/stainy/', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2000));
    
    await page.screenshot({ path: path.join(artifactsDir, 'screenshot_new_mobile_home.png') });
    console.log('Saved screenshot_new_mobile_home.png');

    // 2. モバイル表示 - 日付「20」を選択（新着リストが非表示になり、20日の予定が上に来ているはず）
    // カレンダーの「20」ボタンをクリック
    const dayBtn = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('.day-button'));
      return buttons.find(b => b.innerText.trim().startsWith('20'));
    });

    if (dayBtn && dayBtn.asElement()) {
      console.log('Clicking day button 20...');
      await dayBtn.asElement().click();
      await new Promise(r => setTimeout(r, 1000));
      await page.screenshot({ path: path.join(artifactsDir, 'screenshot_new_mobile_selected.png') });
      console.log('Saved screenshot_new_mobile_selected.png');
    } else {
      console.log('Could not find day button 20.');
    }

  } catch (err) {
    console.error('Error during screenshot capture:', err);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
