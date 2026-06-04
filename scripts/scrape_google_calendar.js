const https = require('https');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const configPath = path.join(projectRoot, 'config', 'groups.json');
    if (!fs.existsSync(configPath)) {
      console.error('groups.json not found at:', configPath);
      process.exit(1);
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const tohkeiGroup = config.groups.find(g => g.id === 'tohkei');
    if (!tohkeiGroup || !tohkeiGroup.google_calendar_id) {
      console.error('Tohkei group or google_calendar_id not found in groups.json');
      process.exit(1);
    }
    
    const calendarId = tohkeiGroup.google_calendar_id;
    const icsUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
    
    console.log(`Downloading Google Calendar ICS from ${icsUrl} ...`);
    const icsText = await downloadUrl(icsUrl);
    
    console.log('Parsing ICS content...');
    const rawEvents = parseIcs(icsText);
    console.log(`Parsed ${rawEvents.length} raw events from Google Calendar.`);
    
    const eventsFilePath = path.join(projectRoot, 'data', 'tohkei', 'events.json');
    const docsEventsFilePath = path.join(projectRoot, 'docs', 'data', 'tohkei', 'events.json');
    
    let existingEvents = [];
    if (fs.existsSync(eventsFilePath)) {
      try {
        existingEvents = JSON.parse(fs.readFileSync(eventsFilePath, 'utf-8'));
      } catch (e) {
        console.warn(`Failed to parse existing JSON at ${eventsFilePath}, resetting to empty array.`);
      }
    }
    
    // イベントデータを共通フォーマットに整形
    const newEvents = rawEvents.map(ev => {
      const summary = ev.summary || 'Tohkei イベント';
      const parsedTime = parseIcsDateTime(ev.dtstart);
      const dateStr = parsedTime.date;
      
      const type = summary.includes('無料') || summary.includes('オフ会') || summary.includes('フリー') || summary.includes('FREE') ? 'free' : 'live';
      const digest = crypto_digest(`${dateStr}:${type}:${summary}`);
      const slug = summary.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) || 'event';
      const id = `tohkei-${dateStr}-${type}-${slug}-${digest}`;
      
      // 説明文からチケットURLなどを簡易抽出
      let ticket_url = undefined;
      if (ev.description) {
        const urlMatch = ev.description.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          ticket_url = urlMatch[0].replace(/[。、)]$/, '');
        }
      }
      
      return {
        id,
        group_id: 'tohkei',
        type,
        title: summary,
        date: dateStr,
        time_start: parsedTime.time_start || undefined,
        venue: ev.location || undefined,
        ticket_url: ticket_url,
        description: ev.description || summary,
        created_at: new Date().toISOString()
      };
    });
    
    // マージ
    const mergedMap = new Map();
    existingEvents.forEach(ev => mergedMap.set(ev.id, ev));
    newEvents.forEach(ev => {
      if (mergedMap.has(ev.id)) {
        mergedMap.set(ev.id, { ...ev, ...mergedMap.get(ev.id) }); // 既存のものを優先（手動追加などのメタデータを維持）
      } else {
        mergedMap.set(ev.id, ev);
      }
    });
    
    const finalEvents = Array.from(mergedMap.values());
    finalEvents.sort((a, b) => `${a.date} ${a.time_start || '99:99'}`.localeCompare(`${b.date} ${b.time_start || '99:99'}`));
    
    // 保存
    fs.mkdirSync(path.dirname(eventsFilePath), { recursive: true });
    fs.writeFileSync(eventsFilePath, JSON.stringify(finalEvents, null, 2) + '\n', 'utf-8');
    fs.mkdirSync(path.dirname(docsEventsFilePath), { recursive: true });
    fs.writeFileSync(docsEventsFilePath, JSON.stringify(finalEvents, null, 2) + '\n', 'utf-8');
    
    console.log(`Saved ${finalEvents.length} events in total for tohkei.`);
    
  } catch (err) {
    console.error('Error during Google Calendar sync:', err);
  }
})();

function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // リダイレクト対応
        downloadUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download: Status ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseIcs(icsText) {
  const events = [];
  const lines = icsText.split(/\r?\n/);
  let currentEvent = null;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // 折り返し行の処理
    while (i + 1 < lines.length && (lines[i+1].startsWith(' ') || lines[i+1].startsWith('\t'))) {
      line += lines[i+1].substring(1);
      i++;
    }
    
    if (line.startsWith('BEGIN:VEVENT')) {
      currentEvent = {};
    } else if (line.startsWith('END:VEVENT')) {
      if (currentEvent && currentEvent.dtstart) {
        events.push(currentEvent);
      }
      currentEvent = null;
    } else if (currentEvent) {
      const match = line.match(/^([^:;]+)(?:;([^:]+))?:(.*)$/);
      if (match) {
        const key = match[1];
        const value = match[3];
        
        if (key === 'SUMMARY') {
          currentEvent.summary = value.replace(/\\(.)/g, '$1');
        } else if (key === 'DESCRIPTION') {
          currentEvent.description = value.replace(/\\n/g, '\n').replace(/\\(.)/g, '$1');
        } else if (key === 'LOCATION') {
          currentEvent.location = value.replace(/\\(.)/g, '$1');
        } else if (key === 'DTSTART') {
          currentEvent.dtstart = value;
        } else if (key === 'DTEND') {
          currentEvent.dtend = value;
        }
      }
    }
  }
  return events;
}

function parseIcsDateTime(dtstr) {
  // 例: 20260530T045500Z または 20260530
  if (!dtstr) return { date: '1970-01-01', time_start: null };
  
  // DTSTART;VALUE=DATE:20260530 のようにプレフィックスが一部残っている場合のクリーニング
  const cleanStr = dtstr.replace(/^VALUE=DATE:/, '');
  
  if (cleanStr.includes('T')) {
    const parts = cleanStr.split('T');
    const dPart = parts[0];
    const tPart = parts[1];
    
    const y = dPart.substring(0, 4);
    const m = dPart.substring(4, 6);
    const d = dPart.substring(6, 8);
    const hh = tPart.substring(0, 2);
    const mm = tPart.substring(2, 4);
    const ss = tPart.substring(4, 6);
    
    let dateObj;
    if (tPart.endsWith('Z')) {
      // UTC時間
      dateObj = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss)));
    } else {
      // タイムゾーン指定がない場合は日本時間とする（簡易的）
      dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss));
      // jstとして補正したくない場合はUTCと同様に扱うが、ここではJSTとする
      return {
        date: `${y}-${m}-${d}`,
        time_start: `${hh}:${mm}`
      };
    }
    
    // 日本時間(JST)への変換 (UTC + 9)
    const jstDate = new Date(dateObj.getTime() + (9 * 60 * 60 * 1000));
    const year = jstDate.getUTCFullYear();
    const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(jstDate.getUTCDate()).padStart(2, '0');
    const hours = String(jstDate.getUTCHours()).padStart(2, '0');
    const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
    
    return {
      date: `${year}-${month}-${day}`,
      time_start: `${hours}:${minutes}`
    };
  } else {
    // 終日イベント (20260530)
    const y = cleanStr.substring(0, 4);
    const m = cleanStr.substring(4, 6);
    const d = cleanStr.substring(6, 8);
    return {
      date: `${y}-${m}-${d}`,
      time_start: null
    };
  }
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
