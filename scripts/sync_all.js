const { execSync } = require('child_process');
const path = require('path');

(async () => {
  try {
    const projectRoot = path.join(__dirname, '..');
    
    console.log('==================================================');
    console.log('Starting All Calendar Synchronization');
    console.log('==================================================');
    
    // 1. TimeTree 同期 (jumpingkiss, stainy, anthurium, hbn)
    console.log('\n[1/3] Syncing TimeTree Calendars...');
    execSync('node scripts/scrape_timetree.js', { stdio: 'inherit', cwd: projectRoot });
    
    // 2. Google Calendar 同期 (tohkei)
    console.log('\n[2/3] Syncing Google Calendar (Tohkei)...');
    execSync('node scripts/scrape_google_calendar.js', { stdio: 'inherit', cwd: projectRoot });
    
    // 3. miao 公式HP 同期 (miao)
    console.log('\n[3/3] Syncing miao Official Website Schedule...');
    execSync('node scripts/scrape_miao.js', { stdio: 'inherit', cwd: projectRoot });
    
    console.log('\n==================================================');
    console.log('Synchronization completed successfully!');
    console.log('==================================================');
    
  } catch (err) {
    console.error('\nSynchronization failed with error:', err.message);
    process.exit(1);
  }
})();
