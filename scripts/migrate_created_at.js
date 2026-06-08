const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const configPath = path.join(projectRoot, 'config', 'groups.json');
if (!fs.existsSync(configPath)) {
  console.error('groups.json not found');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

for (const group of config.groups) {
  const paths = [
    path.join(projectRoot, 'data', group.id, 'events.json'),
    path.join(projectRoot, 'docs', 'data', group.id, 'events.json')
  ];

  for (const eventsPath of paths) {
    if (!fs.existsSync(eventsPath)) {
      continue;
    }
    let events = [];
    try {
      events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
    } catch (e) {
      console.error(`Failed to parse ${eventsPath}`);
      continue;
    }

    let migratedCount = 0;
    const migratedEvents = events.map(ev => {
      if (!ev.created_at || ev.created_at.trim() === '') {
        ev.created_at = "2020-01-01T00:00:00Z";
        migratedCount++;
      }
      return ev;
    });

    if (migratedCount > 0) {
      fs.writeFileSync(eventsPath, JSON.stringify(migratedEvents, null, 2) + '\n', 'utf-8');
      console.log(`Migrated ${migratedCount} events in ${eventsPath}`);
    } else {
      console.log(`No migration needed for ${eventsPath}`);
    }
  }
}
console.log('Migration completed!');
