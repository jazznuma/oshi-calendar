const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const paths = [
  path.join(projectRoot, 'data', 'stainy', 'events.json'),
  path.join(projectRoot, 'docs', 'data', 'stainy', 'events.json')
];

for (const eventsPath of paths) {
  if (fs.existsSync(eventsPath)) {
    const events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
    const filtered = events.filter(ev => ev.id !== "stainy-dummy-new-event-999999");
    fs.writeFileSync(eventsPath, JSON.stringify(filtered, null, 2) + '\n', 'utf-8');
    console.log(`Cleaned up dummy event from ${eventsPath}`);
  }
}
