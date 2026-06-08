const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1200 });
  await page.goto('https://timetreeapp.com/public_calendars/stainy_liveschedule', { waitUntil: 'networkidle0' });
  
  // 日付セル（1lkmlsaを含むクラス）を正確にダンプ
  const dateCells = await page.evaluate(() => {
    const results = [];
    const elements = document.querySelectorAll('*');
    for (const el of elements) {
      const cls = el.className || '';
      if (typeof cls === 'string' && (cls.includes('1lkmlsa') || cls.includes('dayCell'))) {
        results.push({
          tag: el.tagName,
          class: cls,
          text: el.innerText.trim().replace(/\n/g, ' '),
          style: el.getAttribute('style') || '',
          parentStyle: el.parentElement ? el.parentElement.getAttribute('style') || '' : ''
        });
      }
    }
    return results;
  });
  console.log('Date cells grid info:');
  console.log(JSON.stringify(dateCells, null, 2));

  await browser.close();
})();
