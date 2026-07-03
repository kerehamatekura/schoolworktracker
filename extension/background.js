const TRACKER_URL_PATTERN = 'https://trackschool.kerehama.nz/*';

async function updateBadge(){
  try{
    const tabs = await chrome.tabs.query({ url: TRACKER_URL_PATTERN });
    if(tabs.length === 0){
      await clearBadge();
      return;
    }
    const tabId = tabs[0].id;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => window.getTrackerState()
    });

    const running = result.assignments.find(a => a.timerStart);
    if(!running){
      await clearBadge();
      return;
    }

    const cls = result.classes.find(c => c.id === running.classId);
    const sessionSecs = (running.timeSessions || []).reduce((s, x) => s + x.seconds, 0);
    const totalSecs = sessionSecs + (Date.now() - running.timerStart) / 1000;
    const mins = Math.floor(totalSecs / 60);
    const hrs = Math.floor(mins / 60);

    let label = hrs > 0 ? `${hrs}h${mins % 60}` : `${mins}m`;
    if(label.length > 4) label = `${hrs}h`;

    await chrome.action.setBadgeText({ text: label });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    const niceTime = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
    await chrome.action.setTitle({ title: `⏱ ${running.name} (${cls?.name || ''}) — ${niceTime} worked` });
  }catch(e){
    await clearBadge();
  }
}

async function clearBadge(){
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'School Tracker Timer' });
}

function scheduleAlarm(){
  chrome.alarms.create('tick', { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => { scheduleAlarm(); updateBadge(); });
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(); updateBadge(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if(alarm.name === 'tick') updateBadge();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if(info.status === 'complete' && tab.url && tab.url.startsWith('https://trackschool.kerehama.nz/')){
    updateBadge();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if(msg && msg.type === 'refreshBadge') updateBadge();
});

updateBadge();
