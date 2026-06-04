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
    
    // 引数のパース
    const args = process.argv.slice(2);
    let targetGroupId = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--group' && args[i+1]) {
        targetGroupId = args[i+1];
      }
    }
    
    // 対象グループの選定
    let groupsToScrape = config.groups.filter(g => g.timetree_id);
    if (targetGroupId) {
      groupsToScrape = groupsToScrape.filter(g => g.id === targetGroupId);
      if (groupsToScrape.length === 0) {
        console.error(`Group with id "${targetGroupId}" not found or does not have a timetree_id.`);
        process.exit(1);
      }
    }
    
    console.log(`Starting TimeTree scraper for groups: ${groupsToScrape.map(g => g.id).join(', ')}`);

    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true
    });
    
    for (const group of groupsToScrape) {
      console.log(`\n==================================================`);
      console.log(`Processing group: ${group.name} (${group.id})`);
      console.log(`==================================================`);
      
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 1000 });
      
      const targetUrl = `https://timetreeapp.com/public_calendars/${group.timetree_id}`;
      console.log(`Navigating to ${targetUrl} ...`);
      await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 40000 });
      
      const allEvents = [];
      
      // 当月、前月、翌月の3ヶ月分をループして取得
      console.log('Parsing current month...');
      const currentEvents = await parseCurrentMonth(page);
      allEvents.push(...currentEvents);
      
      // 前月へ移動するためのボタン探索
      const buttons = await page.$$('button');
      let prevMonthBtn = null;
      let nextMonthBtn = null;
      for (const btn of buttons) {
        const label = await page.evaluate(el => el.getAttribute('aria-label') || '', btn);
        const cls = await page.evaluate(el => el.className || '', btn);
        const text = await page.evaluate(el => el.innerText || '', btn);
        if (label === '前月' || cls.includes('_94ajna1') || text.includes('‹')) prevMonthBtn = btn;
        if (label === '翌月' || cls.includes('_94ajna2') || text.includes('›')) nextMonthBtn = btn;
      }
      
      if (prevMonthBtn) {
        await prevMonthBtn.click();
        await new Promise(r => setTimeout(r, 2000)); // ロード待ち
        console.log('Parsing previous month...');
        const prevEvents = await parseCurrentMonth(page);
        allEvents.push(...prevEvents);
        
        // 元の月に戻すために次へをクリック
        // ボタンを再取得（DOM更新されている可能性があるため）
        const reButtons = await page.$$('button');
        let reNextMonthBtn = null;
        for (const btn of reButtons) {
          const label = await page.evaluate(el => el.getAttribute('aria-label') || '', btn);
          const cls = await page.evaluate(el => el.className || '', btn);
          const text = await page.evaluate(el => el.innerText || '', btn);
          if (label === '翌月' || cls.includes('_94ajna2') || text.includes('›')) reNextMonthBtn = btn;
        }
        if (reNextMonthBtn) {
          await reNextMonthBtn.click();
          await new Promise(r => setTimeout(r, 2000));
        }
      } else {
        console.log('Could not find previous month button.');
      }
      
      // 翌月へ移動
      // ボタンを再取得
      const postReButtons = await page.$$('button');
      let finalNextMonthBtn = null;
      for (const btn of postReButtons) {
        const label = await page.evaluate(el => el.getAttribute('aria-label') || '', btn);
        const cls = await page.evaluate(el => el.className || '', btn);
        const text = await page.evaluate(el => el.innerText || '', btn);
        if (label === '翌月' || cls.includes('_94ajna2') || text.includes('›')) finalNextMonthBtn = btn;
      }
      
      if (finalNextMonthBtn) {
        await finalNextMonthBtn.click();
        await new Promise(r => setTimeout(r, 2000));
        console.log('Parsing next month...');
        const nextEvents = await parseCurrentMonth(page);
        allEvents.push(...nextEvents);
      } else {
        console.log('Could not find next month button.');
      }
      
      console.log(`Scraped ${allEvents.length} raw events for ${group.id} from TimeTree.`);
      
      // データの標準化と events.json へのマージ
      const eventsFilePath = path.join(projectRoot, 'data', group.id, 'events.json');
      const docsEventsFilePath = path.join(projectRoot, 'docs', 'data', group.id, 'events.json');
      
      let existingEvents = [];
      if (fs.existsSync(eventsFilePath)) {
        try {
          existingEvents = JSON.parse(fs.readFileSync(eventsFilePath, 'utf-8'));
        } catch (e) {
          console.warn(`Failed to parse existing JSON at ${eventsFilePath}, resetting to empty array.`);
        }
      }
      
      // スクレイピングデータをカレンダーのイベント形式に変換
      const newEvents = allEvents.map(ev => {
        const dateStr = ev.date;
        const type = ev.title.includes('無料') || ev.title.includes('オフ会') || ev.title.includes('フリー') || ev.title.includes('FREE') ? 'free' : 'live';
        const cleanTitle = ev.title.replace(/^【配信】.*$/, 'SHOWROOM配信');
        const digest = crypto_digest(`${dateStr}:${type}:${cleanTitle}`);
        const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) || 'event';
        const id = `${group.id}-${dateStr}-${type}-${slug}-${digest}`;
        
        return {
          id,
          group_id: group.id,
          type,
          title: ev.title,
          date: dateStr,
          time_start: ev.time_start || undefined,
          description: ev.title,
          created_at: new Date().toISOString()
        };
      });
      
      // マージ（既存データを優先的に保護しつつ、TimeTreeからの新規分を補正・追加）
      const mergedMap = new Map();
      existingEvents.forEach(ev => mergedMap.set(ev.id, ev));
      newEvents.forEach(ev => {
        if (mergedMap.has(ev.id)) {
          // 既存のRSS経由データ等の方が詳細（チケットURLなど）を持っていることが多いため、
          // マージ時は既存の値を壊さないようにする。ただし日時やタイトルなどの基本は更新
          mergedMap.set(ev.id, { ...ev, ...mergedMap.get(ev.id) });
        } else {
          mergedMap.set(ev.id, ev);
        }
      });
      
      const finalEvents = Array.from(mergedMap.values());
      finalEvents.sort((a, b) => `${a.date} ${a.time_start || '99:99'}`.localeCompare(`${b.date} ${b.time_start || '99:99'}`));
      
      // 書き出し
      fs.mkdirSync(path.dirname(eventsFilePath), { recursive: true });
      fs.writeFileSync(eventsFilePath, JSON.stringify(finalEvents, null, 2) + '\n', 'utf-8');
      fs.mkdirSync(path.dirname(docsEventsFilePath), { recursive: true });
      fs.writeFileSync(docsEventsFilePath, JSON.stringify(finalEvents, null, 2) + '\n', 'utf-8');
      
      console.log(`Saved ${finalEvents.length} events in total for ${group.id}.`);
      await page.close();
    }
    
  } catch (err) {
    console.error('Error during scraping process:', err);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();

async function parseCurrentMonth(page) {
  return page.evaluate(() => {
    const events = [];
    const headers = Array.from(document.querySelectorAll('h2, div, span'));
    let monthText = '';
    for (const h of headers) {
      if (h.innerText && /\d{4}年\d{1,2}月/.test(h.innerText)) {
        monthText = h.innerText;
        break;
      }
    }
    
    if (!monthText) return [];
    const yearMatch = monthText.match(/(\d{4})年\d{1,2}月/) || monthText.match(/(\d{4})-(\d{1,2})/);
    const monthMatch = monthText.match(/\d{4}年(\d{1,2})月/) || monthText.match(/-(\d{1,2})/);
    if (!yearMatch || !monthMatch) return [];
    
    const currentYear = parseInt(yearMatch[1]);
    const currentMonth = parseInt(monthMatch[1]);
    
    // 当月の1日を取得
    const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1);
    const dayOfWeekOfFirst = firstDayOfMonth.getDay(); // 0=日, 1=月, ..., 6=土
    const daysToSubtract = dayOfWeekOfFirst === 0 ? 6 : dayOfWeekOfFirst - 1;
    
    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(firstDayOfMonth.getDate() - daysToSubtract);
    
    // すべてのイベントボタン要素を取得
    const eventButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
      const cls = btn.className || '';
      return cls.includes('_1r1c5vl3') || cls.includes('_2353s62');
    });
    
    eventButtons.forEach(btn => {
      const parentDiv = btn.parentElement;
      if (!parentDiv) return;
      const style = parentDiv.getAttribute('style') || '';
      const colMatch = style.match(/--lndlxo0:\s*(\d+)/);
      const rowMatch = style.match(/--lndlxo1:\s*(\d+)/);
      if (!colMatch || !rowMatch) return;
      
      const col = parseInt(colMatch[1]); // 曜日 (1=月, ..., 7=日)
      const row = parseInt(rowMatch[1]); // 週 (1=1週目, ...)
      
      const eventDate = new Date(startDate);
      eventDate.setDate(startDate.getDate() + (row - 1) * 7 + (col - 1));
      
      const y = eventDate.getFullYear();
      const m = String(eventDate.getMonth() + 1).padStart(2, '0');
      const d = String(eventDate.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      
      const titleSpan = btn.querySelector('span[class*="lndlxo6"]');
      const timeSpan = btn.querySelector('span[class*="_1r1c5vl6"]');
      
      const title = titleSpan ? titleSpan.innerText.trim() : btn.innerText.trim();
      const time_start = timeSpan ? timeSpan.innerText.trim() : null;
      
      events.push({
        title,
        date: dateStr,
        time_start: time_start || undefined
      });
    });
    
    return events;
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
