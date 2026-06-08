const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

(async () => {
  let browser;
  try {
    const projectRoot = path.join(__dirname, '..');
    const configPath = path.join(projectRoot, 'config', 'groups.json');
    if (!fs.existsSync(configPath)) {
      console.error('groups.json not found at:', configPath);
      process.exit(1);
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const miaoGroup = config.groups.find(g => g.id === 'miao');
    if (!miaoGroup || !miaoGroup.schedule_url) {
      console.error('miao group or schedule_url not found in groups.json');
      process.exit(1);
    }
    
    console.log(`Starting miao official schedule scraper at: ${miaoGroup.schedule_url}`);
    
    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1000 });
    
    console.log(`Navigating to ${miaoGroup.schedule_url} ...`);
    await page.goto(miaoGroup.schedule_url, { waitUntil: 'networkidle0', timeout: 40000 });
    
    const allRawEvents = [];
    
    // 1. 今月のイベント取得
    console.log('Parsing current month...');
    const currentEvents = await parseFullCalendarPage(page);
    allRawEvents.push(...currentEvents);
    
    // 2. 前月へ移動して取得
    const prevBtn = await page.$('.fc-prev-button');
    if (prevBtn) {
      console.log('Navigating to previous month...');
      await prevBtn.click();
      await new Promise(r => setTimeout(r, 2000));
      const prevEvents = await parseFullCalendarPage(page);
      allRawEvents.push(...prevEvents);
      
      // 今月に戻す
      const nextBtn = await page.$('.fc-next-button');
      if (nextBtn) {
        await nextBtn.click();
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    // 3. 翌月へ移動して取得
    const nextBtn = await page.$('.fc-next-button');
    if (nextBtn) {
      console.log('Navigating to next month...');
      await nextBtn.click();
      await new Promise(r => setTimeout(r, 2000));
      const nextEvents = await parseFullCalendarPage(page);
      allRawEvents.push(...nextEvents);
    }
    
    console.log(`Scraped ${allRawEvents.length} raw events for miao from official website.`);
    
    // データの標準化とマージ
    const eventsFilePath = path.join(projectRoot, 'data', 'miao', 'events.json');
    const docsEventsFilePath = path.join(projectRoot, 'docs', 'data', 'miao', 'events.json');
    
    let existingEvents = [];
    if (fs.existsSync(eventsFilePath)) {
      try {
        existingEvents = JSON.parse(fs.readFileSync(eventsFilePath, 'utf-8'));
      } catch (e) {
        console.warn(`Failed to parse existing JSON at ${eventsFilePath}, resetting to empty array.`);
      }
    }
    
    const newEvents = [];
    const dateMap = {
      '1st': '01', '2nd': '02', '3rd': '03', '4th': '04', '5th': '05', '6th': '06', '7th': '07', '8th': '08', '9th': '09', '10th': '10',
      '11th': '11', '12th': '12', '13th': '13', '14th': '14', '15th': '15', '16th': '16', '17th': '17', '18th': '18', '19th': '19', '20th': '20',
      '21st': '21', '22nd': '22', '23rd': '23', '24th': '24', '25th': '25', '26th': '26', '27th': '27', '28th': '28', '29th': '29', '30th': '30',
      '31st': '31'
    };
    
    allRawEvents.forEach(raw => {
      // 例: "月曜日, 6月 1st 2026\n渋谷音楽堂"
      const parts = raw.split('\n');
      if (parts.length < 2) return;
      const dateHeader = parts[0];
      const title = parts.slice(1).join('\n').trim();
      
      // "6月 1st 2026" のように、月・日・年を抽出
      const match = dateHeader.match(/(\d+)月\s+(\d+(?:st|nd|rd|th))\s+(\d{4})/);
      if (!match) return;
      
      const rawMonth = match[1];
      const rawDaySuffix = match[2];
      const year = match[3];
      
      const month = rawMonth.padStart(2, '0');
      const day = dateMap[rawDaySuffix] || rawDaySuffix.replace(/\D/g, '').padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const type = title.includes('無料') || title.includes('オフ会') || title.includes('フリー') || title.includes('FREE') ? 'free' : 'live';
      const digest = crypto_digest(`${dateStr}:${type}:${title}`);
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) || 'event';
      const id = `miao-${dateStr}-${type}-${slug}-${digest}`;
      
      newEvents.push({
        id,
        group_id: 'miao',
        type,
        title,
        date: dateStr,
        description: title,
        created_at: new Date().toISOString()
      });
    });
    
    // マージ
    const mergedMap = new Map();
    existingEvents.forEach(ev => mergedMap.set(ev.id, ev));
    newEvents.forEach(ev => {
      if (mergedMap.has(ev.id)) {
        const existing = mergedMap.get(ev.id);
        mergedMap.set(ev.id, {
          ...existing,
          ...ev,
          created_at: existing.created_at || ev.created_at,
          image_url: existing.image_url || ev.image_url,
          post_url: existing.post_url || ev.post_url
        });
      } else {
        mergedMap.set(ev.id, ev);
      }
    });
    
    const finalEvents = Array.from(mergedMap.values());
    finalEvents.sort((a, b) => `${a.date} 99:99`.localeCompare(`${b.date} 99:99`));
    
    // 保存
    fs.mkdirSync(path.dirname(eventsFilePath), { recursive: true });
    fs.writeFileSync(eventsFilePath, JSON.stringify(finalEvents, null, 2) + '\n', 'utf-8');
    fs.mkdirSync(path.dirname(docsEventsFilePath), { recursive: true });
    fs.writeFileSync(docsEventsFilePath, JSON.stringify(finalEvents, null, 2) + '\n', 'utf-8');
    
    console.log(`Saved ${finalEvents.length} events in total for miao.`);
    
  } catch (err) {
    console.error('Error during miao schedule sync:', err);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();

async function parseFullCalendarPage(page) {
  return page.evaluate(() => {
    // fc-event クラスを持つ A 要素からテキストを取得
    const eventElements = Array.from(document.querySelectorAll('a.fc-event, a[class*="fc-day-grid-event"]'));
    return eventElements.map(el => el.innerText.trim()).filter(text => text.length > 0);
  });
}

function crypto_digest(string) {
  let hash = 0;
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}
