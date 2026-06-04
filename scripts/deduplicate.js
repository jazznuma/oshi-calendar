const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const configPath = path.join(projectRoot, 'config', 'groups.json');
    if (!fs.existsSync(configPath)) {
      console.error('groups.json not found');
      process.exit(1);
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    console.log('==================================================');
    console.log('Starting Event Deduplication (from 2026-06-01)');
    console.log('==================================================');
    
    for (const group of config.groups) {
      const eventsFilePath = path.join(projectRoot, 'data', group.id, 'events.json');
      const docsEventsFilePath = path.join(projectRoot, 'docs', 'data', group.id, 'events.json');
      
      if (!fs.existsSync(eventsFilePath)) {
        continue;
      }
      
      const events = JSON.parse(fs.readFileSync(eventsFilePath, 'utf-8'));
      console.log(`\nProcessing group: ${group.name} (${group.id}) - Current events: ${events.length}`);
      
      const oldEvents = events.filter(ev => ev.date < '2026-06-01');
      const newEvents = events.filter(ev => ev.date >= '2026-06-01');
      
      // 重複排除ロジック
      const uniqueNewEvents = deduplicateEvents(newEvents, group.id);
      
      const finalEvents = [...oldEvents, ...uniqueNewEvents];
      finalEvents.sort((a, b) => `${a.date} ${a.time_start || '99:99'}`.localeCompare(`${b.date} ${b.time_start || '99:99'}`));
      
      // 保存
      fs.writeFileSync(eventsFilePath, JSON.stringify(finalEvents, null, 2) + '\n', 'utf-8');
      fs.writeFileSync(docsEventsFilePath, JSON.stringify(finalEvents, null, 2) + '\n', 'utf-8');
      console.log(`Deduplication finished for ${group.id}: ${events.length} -> ${finalEvents.length} events.`);
    }
    
    console.log('\n==================================================');
    console.log('Deduplication completed successfully!');
    console.log('==================================================');
    
  } catch (err) {
    console.error('Error during deduplication:', err);
  }
})();

function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    // 括弧内のサブテキスト（例: "東京編", "Day1" など）は残したいので、外側の記号だけを除去
    .replace(/[「」『』【】\[\]\(\)（）!！〜〜~_+\-*\/\\\{\}:;'"<>？\?,.、。 　]/g, '')
    // 絵文字の除去
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
}

function scoreEvent(ev) {
  let score = 0;
  
  // 1. 画像がある場合は最優先 (+1000点)
  if (ev.image_url && ev.image_url.trim().length > 0 && !ev.image_url.includes('error')) {
    score += 1000;
  }
  
  // 2. チケットURLがある場合 (+500点)
  if (ev.ticket_url && ev.ticket_url.trim().length > 0) {
    score += 500;
  }
  
  // 3. 会場情報がある場合 (+200点)
  if (ev.venue && ev.venue.trim().length > 0) {
    score += 200;
  }
  
  // 4. 開場・開演時間がある場合 (+100点)
  if (ev.time_open && ev.time_open.trim().length > 0) score += 100;
  if (ev.time_start && ev.time_start.trim().length > 0) score += 100;
  
  // 5. 説明文の長さ (詳細度) を加算
  if (ev.description) {
    score += ev.description.trim().length;
  }
  
  return score;
}

function deduplicateEvents(events, groupId) {
  const result = [];
  
  // 重複判定のためのバケットマップ
  // キー: "date:type:time_start:normalized_title"
  const buckets = new Map();
  
  events.forEach(ev => {
    const normTitle = normalizeTitle(ev.title);
    
    // チケ発や締め切りなどはタイトルが微妙に揺れるため、
    // "sasaki-himari-birthday-chikehatsu" と "sasaki-himari-birthday" が同じ時間なら同一視できるように、
    // titleの一部に「チケ発」や「締切」が入っているかどうかもキーにする
    const isTicket = ev.type === 'ticket' || ev.title.includes('チケ発') || ev.title.includes('チケット');
    const isDeadline = ev.type === 'deadline' || ev.title.includes('締切') || ev.title.includes('締め切り');
    
    let bucketType = ev.type;
    if (isTicket) bucketType = 'ticket';
    if (isDeadline) bucketType = 'deadline';
    
    // 時間情報のキー化（終日の場合は "all-day"）
    const timeKey = ev.time_start || ev.time_open || 'all-day';
    
    // タイトル類似判定のための簡易正規化キー
    // "佐々木ひまり生誕祭チケ発" -> "佐々木ひまり生誕祭" として、チケ発はbucketTypeで区別
    let baseTitle = normTitle
      .replace(/チケ発$/, '')
      .replace(/チケット発売$/, '')
      .replace(/締切$/, '')
      .replace(/締め切り$/, '');
      
    const key = `${ev.date}:${bucketType}:${timeKey}:${baseTitle}`;
    
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(ev);
  });
  
  // 各バケットからベストな1件を選択
  buckets.forEach((bucketEvents, key) => {
    if (bucketEvents.length === 1) {
      result.push(bucketEvents[0]);
    } else {
      console.log(`  [Deduplicate] Found ${bucketEvents.length} duplicate events for key: ${key}`);
      
      // スコア計算して最大スコアのものを選択
      let bestEvent = bucketEvents[0];
      let maxScore = scoreEvent(bestEvent);
      
      for (let i = 1; i < bucketEvents.length; i++) {
        const ev = bucketEvents[i];
        const score = scoreEvent(ev);
        console.log(`    - "${ev.title}" (Score: ${score}, HasImage: ${!!ev.image_url}, DetailsLength: ${ev.description ? ev.description.length : 0})`);
        
        if (score > maxScore) {
          maxScore = score;
          bestEvent = ev;
        }
      }
      
      console.log(`    => Kept: "${bestEvent.title}" (Score: ${maxScore})`);
      result.push(bestEvent);
    }
  });
  
  return result;
}
