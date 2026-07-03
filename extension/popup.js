const TRACKER_URL_PATTERN = 'https://trackschool.kerehama.nz/*';
const TRACKER_URL = 'https://trackschool.kerehama.nz/';

const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

let tabId = null;
let state = null; // { classes, assignments }
let tickInterval = null;
let preferredClassId = null;
let preferredAssignmentId = null;

const app = document.getElementById('app');

async function init(){
  const tabs = await chrome.tabs.query({ url: TRACKER_URL_PATTERN });
  if(tabs.length === 0){
    renderNoTab();
    return;
  }
  tabId = tabs[0].id;
  await refreshState();
}

async function refreshState(){
  try{
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => window.getTrackerState()
    });
    state = result;
    renderApp();
  }catch(e){
    tabId = null;
    renderNoTab();
  }
}

function renderNoTab(){
  clearInterval(tickInterval);
  app.innerHTML = `
    <div class="status">
      Your School Tracker tab isn't open.
      <button id="openBtn">Open tracker</button>
    </div>
  `;
  document.getElementById('openBtn').onclick = async () => {
    const tab = await chrome.tabs.create({ url: TRACKER_URL, active: false });
    tabId = tab.id;
    await new Promise(resolve => {
      function listener(id, info){
        if(id === tabId && info.status === 'complete'){
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
    await refreshState();
  };
}

function findRunning(){
  return state.assignments.find(a => a.timerStart);
}

function getAssignmentSeconds(a){
  let s = (a.timeSessions || []).reduce((sum, sess) => sum + sess.seconds, 0);
  if(a.timerStart) s += (Date.now() - a.timerStart) / 1000;
  return s;
}

function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getTodaySeconds(){
  const today = todayISO();
  let total = 0;
  state.assignments.forEach(a=>{
    (a.timeSessions || []).forEach(sess => { if(sess.date === today) total += sess.seconds; });
    if(a.timerStart) total += (Date.now() - a.timerStart) / 1000;
  });
  return total;
}

function formatDuration(totalSeconds){
  totalSeconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function renderApp(){
  clearInterval(tickInterval);
  const running = findRunning();

  const classOptions = state.classes.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  let nowPlayingHtml = '';
  if(running){
    const cls = state.classes.find(c => c.id === running.classId);
    nowPlayingHtml = `
      <div class="now-playing">
        <div class="np-name">⏱ ${escapeHtml(running.name)}</div>
        <div>${escapeHtml(cls?.name || '')}</div>
      </div>
    `;
  }

  app.innerHTML = `
    ${nowPlayingHtml}
    <label>Subject</label>
    <select id="classSelect">
      <option value="">Select a subject...</option>
      ${classOptions}
    </select>
    <label>Assignment</label>
    <select id="assignSelect" disabled>
      <option value="">Select a subject first...</option>
    </select>

    <div class="timer-ring-wrap" id="ringWrap">
      <svg class="timer-ring" viewBox="0 0 120 120">
        <defs>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#5b5bf6"/>
            <stop offset="100%" stop-color="#ec4899"/>
          </linearGradient>
        </defs>
        <circle class="ring-track" cx="60" cy="60" r="${RING_RADIUS}"></circle>
        <circle class="ring-fill" id="ringFill" cx="60" cy="60" r="${RING_RADIUS}"
          stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>
      </svg>
      <div class="timer-ring-text idle" id="timerDisplay">00:00</div>
    </div>

    <button class="btn-start" id="actionBtn" disabled>▶ Start timer</button>
    <div class="today-stat">
      <span>Today's total</span>
      <strong id="todayTotal">${formatDuration(getTodaySeconds())}</strong>
    </div>
    <a class="footer-link" href="${TRACKER_URL}" id="openLink">Open full tracker →</a>
  `;

  const todayTotalEl = document.getElementById('todayTotal');

  const classSelect = document.getElementById('classSelect');
  const assignSelect = document.getElementById('assignSelect');
  const actionBtn = document.getElementById('actionBtn');
  const timerDisplay = document.getElementById('timerDisplay');
  const ringWrap = document.getElementById('ringWrap');
  const ringFill = document.getElementById('ringFill');

  document.getElementById('openLink').onclick = (e) => {
    e.preventDefault();
    chrome.tabs.update(tabId, { active: true });
    window.close();
  };

  function populateAssignments(classId){
    const list = state.assignments.filter(a => a.classId === classId && !a.done);
    assignSelect.innerHTML = list.length
      ? '<option value="">Select an assignment...</option>' + list.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')
      : '<option value="">No pending assignments</option>';
    assignSelect.disabled = list.length === 0;
  }

  function setRing(seconds, running){
    const progress = (seconds % 60) / 60;
    const offset = running ? RING_CIRCUMFERENCE * (1 - progress) : RING_CIRCUMFERENCE;
    ringFill.style.strokeDashoffset = offset;
    ringFill.classList.toggle('running', running);
    ringWrap.classList.toggle('running', running);
  }

  function updateButtonState(){
    const selectedId = assignSelect.value;
    if(!selectedId){
      actionBtn.disabled = true;
      actionBtn.textContent = '▶ Start timer';
      actionBtn.className = 'btn-start';
      timerDisplay.className = 'timer-ring-text idle';
      timerDisplay.textContent = '00:00';
      setRing(0, false);
      clearInterval(tickInterval);
      return;
    }
    const a = state.assignments.find(x => x.id === selectedId);
    actionBtn.disabled = false;
    if(a.timerStart){
      actionBtn.textContent = '⏸ Stop timer';
      actionBtn.className = 'btn-stop';
      startTicking(a);
    }else{
      actionBtn.textContent = '▶ Start timer';
      actionBtn.className = 'btn-start';
      timerDisplay.className = 'timer-ring-text idle';
      timerDisplay.textContent = formatDuration(getAssignmentSeconds(a));
      setRing(0, false);
      clearInterval(tickInterval);
    }
  }

  function startTicking(a){
    timerDisplay.className = 'timer-ring-text running';
    const tick = () => {
      const secs = getAssignmentSeconds(a);
      timerDisplay.textContent = formatDuration(secs);
      setRing(secs, true);
      if(todayTotalEl) todayTotalEl.textContent = formatDuration(getTodaySeconds());
    };
    tick();
    tickInterval = setInterval(tick, 1000);
  }

  classSelect.onchange = () => {
    preferredClassId = classSelect.value;
    preferredAssignmentId = null;
    populateAssignments(classSelect.value);
    updateButtonState();
  };

  assignSelect.onchange = () => {
    preferredAssignmentId = assignSelect.value;
    updateButtonState();
  };

  actionBtn.onclick = async () => {
    const selectedId = assignSelect.value;
    if(!selectedId) return;
    const a = state.assignments.find(x => x.id === selectedId);
    actionBtn.disabled = true;
    preferredClassId = a.classId;
    preferredAssignmentId = selectedId;
    if(a.timerStart){
      await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (id) => { window.stopTimer(id); }, args: [selectedId] });
    }else{
      await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (id) => { window.startTimer(id); }, args: [selectedId] });
    }
    chrome.runtime.sendMessage({ type: 'refreshBadge' });
    await refreshState();
  };

  const initialClassId = preferredClassId || (running && running.classId);
  if(initialClassId){
    classSelect.value = initialClassId;
    populateAssignments(initialClassId);
    const initialAssignId = preferredAssignmentId || (running && running.id);
    if(initialAssignId) assignSelect.value = initialAssignId;
    updateButtonState();
  }
}

init();
