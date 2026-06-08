const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const eventsPath = path.join(projectRoot, 'docs', 'data', 'stainy', 'events.json');

if (!fs.existsSync(eventsPath)) {
  console.error('events.json not found');
  process.exit(1);
}

const events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));

// ダミーの新着ライブイベント
const now = new Date();
const dummyEvent = {
  id: "stainy-dummy-new-event-999999",
  group_id: "stainy",
  type: "live",
  title: "【新着テスト】超プレミアム新着ライブ",
  date: "2026-06-20",
  venue: "渋谷ストリームホール",
  time_start: "18:00",
  description: "これは新着機能のテスト用ダミーイベントです。最近追加された予定のパネルや、カレンダーチップ、イベントカードにNEWバッジが表示されます。",
  created_at: now.toISOString() // 現在時刻 (新着)
};

// 重複を防ぐため、既に存在すれば削除
const filtered = events.filter(ev => ev.id !== dummyEvent.id);
filtered.push(dummyEvent);

fs.writeFileSync(eventsPath, JSON.stringify(filtered, null, 2) + '\n', 'utf-8');
console.log('Dummy event inserted successfully to stainy!');
