// ==========================================
// CONSTANTS & INITIAL STATE
// ==========================================
const TOTAL_FLOORS = 10;
const MAX_CAPACITY = 12;
const TICK_MS = 900;
const FLOOR_HEIGHT = 54;   // must match --floor-height in style.css
const MOVE_MS = 600;       // must match the car's "top" transition in style.css

// true  -> shaft is drawn G, 1, 2 ... 10 from top to bottom
// false -> shaft is drawn like a real building: 10 at the top, G at the bottom
const GROUND_AT_TOP = false;

let seqCounter = 0; // gives every press a number so we always know who was first

const state = {
  currentFloor: 0,
  direction: 0,     // 1 = UP, -1 = DOWN, 0 = IDLE
  load: 0,
  running: null,
  requests: [],     // hall calls (outside buttons), in order pressed: { seq, floor, direction, waiting }
  destinations: [], // in-lift buttons, in order pressed: { seq, floor }
  doorsOpen: false,
  moving: false
};


let _doorsOpen = false;
let doorPromptOpen = false;
const pendingHallCalls = new Set();

Object.defineProperty(state, 'doorsOpen', {
  enumerable: true,
  get() { return _doorsOpen; },
  set(value) {
    const wasOpen = _doorsOpen;
    _doorsOpen = value;
    if (value && !wasOpen) onDoorsOpened(state.currentFloor);  // only on false → true
  }
});

async function onDoorsOpened(floor) {
  doorPromptOpen = true;
  try {
    const r = await openModal({
      title: `Floor ${floorName(floor)}: doors open`,
      body: 'Enter the passenger counts observed while the doors are open.',
      fields: [
        { id: 'out', label: 'People getting out of the lift', value: 0 },
        { id: 'in', label: 'People getting into the lift', value: 0 },
      ],
    });

    console.log('Door count - floor:', floor);
    console.log('People getting out:', r.out);
    console.log('People getting in:', r.in);
    state.load = Math.max(0, state.load - r.out + r.in);
    updateUI();

  } finally {
    doorPromptOpen = false;
  }
}

const floorName = floor => (floor === 0 ? 'G' : String(floor));
const levelName = floor => (floor === 0 ? 'GROUND' : `LEVEL ${String(floor).padStart(2, '0')}`);
const carTop = floor => (GROUND_AT_TOP ? floor : TOTAL_FLOORS - floor) * FLOOR_HEIGHT + 5;

// LOGGING & UI UPDATE FUNCTIONS
function logEvent(message, type = '') {
  const logContainer = document.getElementById('event-log');
  if (!logContainer) return;

  const item = document.createElement('li');
  item.className = type;
  item.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>${message}</span>`;
  logContainer.prepend(item);

  const logCount = document.getElementById('log-count');
  if (logCount) logCount.textContent = `${logContainer.children.length} EVENTS`;
}

function updateUI() {
  const dirText = state.direction === 1 ? 'UP' : state.direction === -1 ? 'DOWN' : 'IDLE';
  const arrow = state.direction === 1 ? '▲ ' : state.direction === -1 ? '▼ ' : '';

  const car = document.getElementById('car');
  if (car) {
    car.style.top = `${carTop(state.currentFloor)}px`;
    car.classList.toggle('doors-open', state.doorsOpen);
  }

  const carCount = document.getElementById('car-count');
  if (carCount) carCount.textContent = state.load;//here's the number is displayed as load as on top of the lift

  const ledText = document.getElementById('led-text');
  if (ledText) ledText.textContent = `${arrow}${floorName(state.currentFloor)}`;

  const floorLabel = document.getElementById('current-floor-label');
  if (floorLabel) floorLabel.textContent = `${floorName(state.currentFloor)} FLOOR`;

  const statusText = document.getElementById('text');
  if (statusText) statusText.textContent = state.doorsOpen ? 'Doors open' : 'Doors closed';

  const statusPanel = document.getElementById('status');
  if (statusPanel) {
    const calls = state.requests.map(r => `${floorName(r.floor)}${r.direction === 'up' ? '▲' : '▼'}`).join(' ');
    statusPanel.textContent =
      `POSITION     ${floorName(state.currentFloor)}\n` +
      `DIRECTION    ${dirText}\n` +
      `DOORS        ${state.doorsOpen ? 'OPEN' : 'CLOSED'}\n` +
      `PASSENGERS   ${state.load} / ${MAX_CAPACITY}\n` +
      `HALL CALLS   ${calls || 'none'}\n` +
      `DESTINATIONS ${state.destinations.map(d => floorName(d.floor)).join(', ') || 'none'}`;
  }

  document.querySelectorAll('[data-dest-floor]').forEach(btn => {
    const floor = Number(btn.dataset.destFloor);
    btn.classList.toggle('active', state.destinations.some(d => d.floor === floor));
  });

  document.querySelectorAll('.floor-control').forEach(row => {
    const floor = Number(row.dataset.floor);
    const hasUpReq = state.requests.some(req => req.floor === floor && req.direction === 'up');
    const hasDownReq = state.requests.some(req => req.floor === floor && req.direction === 'down');
    row.classList.toggle('queued-up', hasUpReq);
    row.classList.toggle('queued-down', hasDownReq);
  });
  document.querySelectorAll('[data-call]').forEach(btn => {
    const floor = Number(btn.dataset.floor);
    btn.classList.toggle('lit', state.requests.some(r => r.floor === floor && r.direction === btn.dataset.call));
  });

  const runBtn = document.getElementById('btn-run');
  if (runBtn) runBtn.classList.toggle('active', !!state.running);
}

function buildUI() {
  const shaft = document.getElementById('shaft');
  const floorControls = document.getElementById('floor-controls');

  if (shaft) {
    shaft.innerHTML = '';
    const order = [];
    for (let i = 0; i <= TOTAL_FLOORS; i++) order.push(i);
    if (!GROUND_AT_TOP) order.reverse();

    order.forEach(i => {
      shaft.insertAdjacentHTML('beforeend',
        `<div class="floor" data-floor="${i}">
          <span>${floorName(i)}</span>
          <small>${levelName(i)}</small>
        </div>`
      );
    });
    const car = document.createElement('div');
    car.id = 'car';
    car.innerHTML = '<span class="car-label">LIFT</span><strong id="car-count">0</strong><span class="car-unit">PEOPLE</span>';
    shaft.appendChild(car);
  }

  if (floorControls) {
    floorControls.innerHTML = '';
    for (let n = 0; n <= TOTAL_FLOORS; n++) {
      const i = GROUND_AT_TOP ? n : TOTAL_FLOORS - n;
      floorControls.insertAdjacentHTML('beforeend',
        `<div class="floor-control" data-floor="${i}">
          <strong>${floorName(i)}</strong>
          <span>${i === 0 ? 'GROUND' : `FLOOR ${i}`}</span>
          <div class="btns">
            <button class="btn" data-call="up" data-floor="${i}" ${i === TOTAL_FLOORS ? 'disabled' : ''}>UP</button>
            <button class="btn" data-call="down" data-floor="${i}" ${i === 0 ? 'disabled' : ''}>DOWN</button>
          </div>
        </div>`
      );
    }
  }

  const inLiftPanel = document.getElementById('in-lift-buttons');
  if (inLiftPanel) {
    inLiftPanel.innerHTML = '';
    for (let row = Math.floor(TOTAL_FLOORS / 2) * 2; row >= 0; row -= 2) {
      [row, row + 1].forEach(f => {
        if (f > TOTAL_FLOORS) return;
        const alone = row + 1 > TOTAL_FLOORS;
        inLiftPanel.insertAdjacentHTML('beforeend',
          `<button class="btn btn-dest${alone ? ' single' : ''}" data-dest-floor="${f}" aria-label="Floor ${floorName(f)}">${floorName(f)}</button>`
        );
      });
    }
  }

  updateUI();
  logEvent('System initialized at G floor.', 'system');
}

const isFull = () => state.load >= MAX_CAPACITY;
const hasDest = floor => state.destinations.some(d => d.floor === floor);

async function requestFloor(floor, callDirection) {
  const callKey = `${floor}:${callDirection}`;
  if (state.requests.some(req => req.floor === floor && req.direction === callDirection)
    || pendingHallCalls.has(callKey)) return;

  pendingHallCalls.add(callKey);
  try {
    const result = await openModal({
      title: `Outside call: ${floorName(floor)} floor`,
      body: 'Enter the number of people waiting for the lift.',
      fields: [
        { id: 'waiting', label: 'People waiting for the lift', value: 0 },
      ],
    });

    console.log('Outside call - floor:', floor);
    console.log('People waiting:', result.waiting);

    state.requests.push({ seq: ++seqCounter, floor, direction: callDirection, waiting: null });
    logEvent(`${callDirection.toUpperCase()} call registered at ${floorName(floor)} floor.`);
    updateUI();
  } finally {
    pendingHallCalls.delete(callKey);
  }
}




function selectDestination(floor) {
  if (floor === state.currentFloor) {
    if (!state.doorsOpen && !state.moving) {
      state.doorsOpen = true;
      logEvent(`Doors re-opened at ${floorName(floor)} floor.`);
      updateUI();
    }
    return;
  }
  if (hasDest(floor)) return;
  if (isFull()) {
    logEvent(`Lift full. Button ${floorName(floor)} ignored.`, 'warning');
    return;
  }
  state.destinations.push({ seq: ++seqCounter, floor });
  state.riders[floor] = (state.riders[floor] || 0) + 1; // someone inside pressed it
  logEvent(`In-lift button pressed for ${floorName(floor)} floor.`);
  updateUI();
}

function activeTargets() {
  const targets = state.destinations.map(d => ({ floor: d.floor, seq: d.seq }));
  if (!isFull()) state.requests.forEach(r => targets.push({ floor: r.floor, seq: r.seq }));
  return targets;
}

function targetsAhead(dir) {
  return activeTargets().some(t => (t.floor - state.currentFloor) * dir > 0);
}

function shouldStop() {
  const floor = state.currentFloor;
  if (hasDest(floor)) return true;           // someone wants to get off
  if (isFull()) return false;                // full: drive past hall calls
  const here = state.requests.filter(r => r.floor === floor);
  if (!here.length) return false;
  const dir = state.direction;
  if (dir === 0) return true;                // idle: serve it
  if (here.some(r => r.direction === (dir === 1 ? 'up' : 'down'))) return true; // going my way
  return !targetsAhead(dir);                 // wrong way, but nothing further ahead: turn here
}

function chooseDirection() {
  const targets = activeTargets();
  if (!targets.length) return 0;
  const dir = state.direction;
  const floor = state.currentFloor;

  if (dir !== 0) {
    if (targets.some(t => (t.floor - floor) * dir > 0)) return dir;   // keep going
    if (targets.some(t => (t.floor - floor) * dir < 0)) return -dir;  // reverse
    return 0;
  }
  const oldest = targets.reduce((a, b) => (b.seq < a.seq ? b : a));   // first come, first served
  return Math.sign(oldest.floor - floor);
}

function serveFloor() {
  const floor = state.currentFloor;

  state.destinations = state.destinations.filter(d => d.floor !== floor);

  const here = state.requests.filter(r => r.floor === floor);
  const dir = state.direction;
  let call = here.find(r => dir !== 0 && r.direction === (dir === 1 ? 'up' : 'down'));
  if (!call && here.length && (dir === 0 || !targetsAhead(dir))) call = here[0];

  if (call) {
    state.direction = call.direction === 'up' ? 1 : -1;

    state.requests = state.requests.filter(r => r !== call);
  }

  state.doorsOpen = true;
  logEvent(`Doors opened at ${floorName(floor)} floor.`);
  updateUI();
}

function normal_lift_logic() {
  if (state.moving) return;

  if (state.doorsOpen) {
    if (doorPromptOpen) return;
    if (shouldStop()) { serveFloor(); return; }
    state.doorsOpen = false;
    logEvent(`Doors closed at ${floorName(state.currentFloor)} floor.`);
    updateUI();
    return;
  }

  if (shouldStop()) { serveFloor(); return; }

  const previous = state.direction;
  state.direction = chooseDirection();

  if (state.direction === 0) {
    if (previous !== 0) logEvent(`Lift idle at ${floorName(state.currentFloor)} floor.`, 'system');
    updateUI();
    return;
  }

  state.currentFloor += state.direction;
  state.moving = true;
  setTimeout(() => { state.moving = false; }, MOVE_MS);
  logEvent(`Lift moved ${state.direction === 1 ? 'up' : 'down'} to ${floorName(state.currentFloor)} floor.`);
  updateUI();
}

//MODAL OPENER
function openModal({ title, body, fields = [] }) {
  return new Promise(resolve => {
    const modal = document.getElementById('modal');
    document.getElementById('m-title').textContent = title;
    document.getElementById('m-body').textContent = body;

    const box = document.getElementById('m-fields');
    box.innerHTML = fields.map(f => `
      <label>${f.label ?? f.id}
        <input id="f-${f.id}" type="${f.type ?? 'number'}"
               min="${f.min ?? 0}" ${f.max !== undefined ? `max="${f.max}"` : ''}
               value="${f.value ?? 0}">
      </label>`).join('');

    modal.classList.remove('hidden');

    document.getElementById('m-ok').onclick = () => {
      const result = {};
      fields.forEach(f => {
        const el = document.getElementById(`f-${f.id}`);
        result[f.id] = (f.type === 'text') ? el.value : Number(el.value);
      });
      modal.classList.add('hidden');
      resolve(result);
    };
  });
}

// ==========================================
// EVENT LISTENERS
// ==========================================
document.getElementById('floor-controls')?.addEventListener('click', event => {
  const button = event.target.closest('[data-call]');
  if (button) requestFloor(Number(button.dataset.floor), button.dataset.call);
});

document.body.addEventListener('click', event => {
  const button = event.target.closest('[data-dest-floor]');
  if (button) selectDestination(Number(button.dataset.destFloor));
});

document.getElementById('btn-step')?.addEventListener('click', normal_lift_logic);

document.getElementById('btn-run')?.addEventListener('click', () => {
  if (!state.running) {
    state.running = setInterval(normal_lift_logic, TICK_MS);
    updateUI();
    logEvent('Automatic operation started.', 'system');
  }
});

document.getElementById('btn-stop')?.addEventListener('click', () => {
  if (state.running) {
    clearInterval(state.running);
    state.running = null;
    updateUI();
    logEvent('Automatic operation paused.', 'system');
  }
});

document.getElementById('btn-reset')?.addEventListener('click', () => {
  if (state.running) clearInterval(state.running);
  Object.assign(state, {
    currentFloor: 0,
    direction: 0,
    load: 0,
    running: null,
    requests: [],
    destinations: [],
    doorsOpen: false,
    moving: false
  });
  const log = document.getElementById('event-log');
  if (log) log.innerHTML = '';
  logEvent('Simulation reset to G floor.', 'system');
  updateUI();
});

// Manual door controls (not while the car is travelling)
document.getElementById('grid5')?.addEventListener('click', () => {
  if (state.moving || state.doorsOpen) return;
  state.doorsOpen = true;
  logEvent(`Doors opened manually at ${floorName(state.currentFloor)} floor.`);
  updateUI();
});

document.getElementById('gridclose')?.addEventListener('click', () => {
  if (!state.doorsOpen || doorPromptOpen) return;
  state.doorsOpen = false;
  logEvent(`Doors closed manually at ${floorName(state.currentFloor)} floor.`);
  updateUI();
});

// Initialize on load
buildUI();




/* // ==========================================
// CONSTANTS & INITIAL STATE
// ==========================================
const TOTAL_FLOORS = 10;
const MAX_CAPACITY = 12;
const TICK_MS = 900;
const FLOOR_HEIGHT = 54;   // must match --floor-height in style.css
const MOVE_MS = 600;       // must match the car's "top" transition in style.css

// true  -> shaft is drawn G, 1, 2 ... 10 from top to bottom
// false -> shaft is drawn like a real building: 10 at the top, G at the bottom
const GROUND_AT_TOP = false;

let seqCounter = 0; // gives every press a number so we always know who was first

const state = {
  currentFloor: 0,
  direction: 0,     // 1 = UP, -1 = DOWN, 0 = IDLE
  load: 0,
  running: null,
  requests: [],     // hall calls (outside buttons), in order pressed: { seq, floor, direction, waiting }
  destinations: [], // in-lift buttons, in order pressed: { seq, floor }
  riders: {},       // floor -> number of passengers getting off there
  doorsOpen: false,
  moving: false
};

const floorName = floor => (floor === 0 ? 'G' : String(floor));
const levelName = floor => (floor === 0 ? 'GROUND' : `LEVEL ${String(floor).padStart(2, '0')}`);
const carTop = floor => (GROUND_AT_TOP ? floor : TOTAL_FLOORS - floor) * FLOOR_HEIGHT + 5;

// ==========================================
// MOCK OPENCV INTEGRATION
// ==========================================
// Simulates an OpenCV camera feed detecting people waiting on a floor
function getOpenCVPeopleCount(floor) {
  // Replace this function with a fetch() call to your Python/OpenCV server when ready
  return 3;// Simulates 3 waiting passengers
  
  //or use like this 
  //const WAITING = [3, 1, 0, 4, 2, 2, 1, 5, 3, 2, 1];
  //return WAITING[floor];
}

// ==========================================
// LOGGING & UI UPDATE FUNCTIONS
// ==========================================
function logEvent(message, type = '') {
  const logContainer = document.getElementById('event-log');
  if (!logContainer) return;

  const item = document.createElement('li');
  item.className = type;
  item.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>${message}</span>`;
  logContainer.prepend(item);

  const logCount = document.getElementById('log-count');
  if (logCount) logCount.textContent = `${logContainer.children.length} EVENTS`;
}

function updateUI() {
  const dirText = state.direction === 1 ? 'UP' : state.direction === -1 ? 'DOWN' : 'IDLE';
  const arrow = state.direction === 1 ? '▲ ' : state.direction === -1 ? '▼ ' : '';

  const car = document.getElementById('car');
  if (car) {
    car.style.top = `${carTop(state.currentFloor)}px`;
    car.classList.toggle('doors-open', state.doorsOpen);
  }

  const carCount = document.getElementById('car-count');
  if (carCount) carCount.textContent = state.load;

  const ledText = document.getElementById('led-text');
  if (ledText) ledText.textContent = `${arrow}${floorName(state.currentFloor)}`;

  const floorLabel = document.getElementById('current-floor-label');
  if (floorLabel) floorLabel.textContent = `${floorName(state.currentFloor)} FLOOR`;

  const statusText = document.getElementById('text');
  if (statusText) statusText.textContent = state.doorsOpen ? 'Doors open' : 'Doors closed';

  const statusPanel = document.getElementById('status');
  if (statusPanel) {
    const calls = state.requests.map(r => `${floorName(r.floor)}${r.direction === 'up' ? '▲' : '▼'}`).join(' ');
    statusPanel.textContent =
      `POSITION     ${floorName(state.currentFloor)}\n` +
      `DIRECTION    ${dirText}\n` +
      `DOORS        ${state.doorsOpen ? 'OPEN' : 'CLOSED'}\n` +
      `PASSENGERS   ${state.load} / ${MAX_CAPACITY}\n` +
      `HALL CALLS   ${calls || 'none'}\n` +
      `DESTINATIONS ${state.destinations.map(d => floorName(d.floor)).join(', ') || 'none'}`;
  }

  // In-lift buttons light up while the floor is queued
  document.querySelectorAll('[data-dest-floor]').forEach(btn => {
    const floor = Number(btn.dataset.destFloor);
    btn.classList.toggle('active', state.destinations.some(d => d.floor === floor));
  });

  // Hall call buttons light up while the call is queued
  document.querySelectorAll('.floor-control').forEach(row => {
    const floor = Number(row.dataset.floor);
    const hasUpReq = state.requests.some(req => req.floor === floor && req.direction === 'up');
    const hasDownReq = state.requests.some(req => req.floor === floor && req.direction === 'down');
    row.classList.toggle('queued-up', hasUpReq);
    row.classList.toggle('queued-down', hasDownReq);
  });
  document.querySelectorAll('[data-call]').forEach(btn => {
    const floor = Number(btn.dataset.floor);
    btn.classList.toggle('lit', state.requests.some(r => r.floor === floor && r.direction === btn.dataset.call));
  });

  const runBtn = document.getElementById('btn-run');
  if (runBtn) runBtn.classList.toggle('active', !!state.running);
}

// ==========================================
// DYNAMIC UI BUILDER
// ==========================================
function buildUI() {
  const shaft = document.getElementById('shaft');
  const floorControls = document.getElementById('floor-controls');

  if (shaft) {
    shaft.innerHTML = '';
    const order = [];
    for (let i = 0; i <= TOTAL_FLOORS; i++) order.push(i);
    if (!GROUND_AT_TOP) order.reverse();

    order.forEach(i => {
      shaft.insertAdjacentHTML('beforeend',
        `<div class="floor" data-floor="${i}">
          <span>${floorName(i)}</span>
          <small>${levelName(i)}</small>
        </div>`
      );
    });
    const car = document.createElement('div');
    car.id = 'car';
    car.innerHTML = '<span class="car-label">LIFT</span><strong id="car-count">0</strong><span class="car-unit">PEOPLE</span>';
    shaft.appendChild(car);
  }

  // Outside floor controls (hall calls)
  if (floorControls) {
    floorControls.innerHTML = '';
    for (let n = 0; n <= TOTAL_FLOORS; n++) {
      const i = GROUND_AT_TOP ? n : TOTAL_FLOORS - n;
      floorControls.insertAdjacentHTML('beforeend',
        `<div class="floor-control" data-floor="${i}">
          <strong>${floorName(i)}</strong>
          <span>${i === 0 ? 'GROUND' : `FLOOR ${i}`}</span>
          <div class="btns">
            <button class="btn" data-call="up" data-floor="${i}" ${i === TOTAL_FLOORS ? 'disabled' : ''}>UP</button>
            <button class="btn" data-call="down" data-floor="${i}" ${i === 0 ? 'disabled' : ''}>DOWN</button>
          </div>
        </div>`
      );
    }
  }

  // Inside-lift panel: two columns, numbers rise going up the panel
  //   10
  //  8  9
  //  6  7
  //  4  5
  //  2  3
  //  G  1
  const inLiftPanel = document.getElementById('in-lift-buttons');
  if (inLiftPanel) {
    inLiftPanel.innerHTML = '';
    for (let row = Math.floor(TOTAL_FLOORS / 2) * 2; row >= 0; row -= 2) {
      [row, row + 1].forEach(f => {
        if (f > TOTAL_FLOORS) return;
        const alone = row + 1 > TOTAL_FLOORS;
        inLiftPanel.insertAdjacentHTML('beforeend',
          `<button class="btn btn-dest${alone ? ' single' : ''}" data-dest-floor="${f}" aria-label="Floor ${floorName(f)}">${floorName(f)}</button>`
        );
      });
    }
  }

  updateUI();
  logEvent('System initialized at G floor.', 'system');
}

// ==========================================
// BUTTON PRESSES (they only join the queue)
// ==========================================
const isFull = () => state.load >= MAX_CAPACITY;
const hasDest = floor => state.destinations.some(d => d.floor === floor);

// Outside hall call (Up/Down)
function requestFloor(floor, callDirection) {
  if (state.requests.some(req => req.floor === floor && req.direction === callDirection)) return;
  state.requests.push({ seq: ++seqCounter, floor, direction: callDirection, waiting: null });
  logEvent(`${callDirection.toUpperCase()} call registered at ${floorName(floor)} floor.`);
  updateUI();
}

// Inside-lift destination selection
function selectDestination(floor) {
  if (floor === state.currentFloor) {
    // Pressing the current floor re-opens the doors, like a real lift
    if (!state.doorsOpen && !state.moving) {
      state.doorsOpen = true;
      logEvent(`Doors re-opened at ${floorName(floor)} floor.`);
      updateUI();
    }
    return;
  }
  if (hasDest(floor)) return;
  if (isFull()) {
    logEvent(`Lift full. Button ${floorName(floor)} ignored.`, 'warning');
    return;
  }
  state.destinations.push({ seq: ++seqCounter, floor });
  state.riders[floor] = (state.riders[floor] || 0) + 1; // someone inside pressed it
  state.load += 1;
  logEvent(`In-lift button pressed for ${floorName(floor)} floor.`);
  updateUI();
}

// ==========================================
// ROUTING (LOOK / ELEVATOR ALGORITHM)
// ==========================================
// Keep going the same way while anything is queued ahead. Reverse only when
// nothing is left ahead. When idle, go for whoever pressed first.

// Floors the lift is willing to visit right now. A full lift ignores hall calls.
function activeTargets() {
  const targets = state.destinations.map(d => ({ floor: d.floor, seq: d.seq }));
  if (!isFull()) state.requests.forEach(r => targets.push({ floor: r.floor, seq: r.seq }));
  return targets;
}

function targetsAhead(dir) {
  return activeTargets().some(t => (t.floor - state.currentFloor) * dir > 0);
}

// Should the lift stop at the floor it is standing on?
function shouldStop() {
  const floor = state.currentFloor;
  if (hasDest(floor)) return true;           // someone wants to get off
  if (isFull()) return false;                // full: drive past hall calls
  const here = state.requests.filter(r => r.floor === floor);
  if (!here.length) return false;
  const dir = state.direction;
  if (dir === 0) return true;                // idle: serve it
  if (here.some(r => r.direction === (dir === 1 ? 'up' : 'down'))) return true; // going my way
  return !targetsAhead(dir);                 // wrong way, but nothing further ahead: turn here
}

function chooseDirection() {
  const targets = activeTargets();
  if (!targets.length) return 0;
  const dir = state.direction;
  const floor = state.currentFloor;

  if (dir !== 0) {
    if (targets.some(t => (t.floor - floor) * dir > 0)) return dir;   // keep going
    if (targets.some(t => (t.floor - floor) * dir < 0)) return -dir;  // reverse
    return 0;
  }
  const oldest = targets.reduce((a, b) => (b.seq < a.seq ? b : a));   // first come, first served
  return Math.sign(oldest.floor - floor);
}

// Open the doors: passengers get off first, then waiting passengers get on
function serveFloor() {
  const floor = state.currentFloor;

  // 1. Drop off
  const leaving = state.riders[floor] || 0;
  if (leaving) {
    delete state.riders[floor];
    state.destinations = state.destinations.filter(d => d.floor !== floor);
    state.load = Math.max(0, state.load - leaving);
    logEvent(`${leaving} passenger(s) got off at ${floorName(floor)} floor.`);
  }

  // 2. Pick up
  const here = state.requests.filter(r => r.floor === floor);
  const dir = state.direction;
  let call = here.find(r => dir !== 0 && r.direction === (dir === 1 ? 'up' : 'down'));
  if (!call && here.length && (dir === 0 || !targetsAhead(dir))) call = here[0];

  if (call && !isFull()) {
    if (call.waiting === null) call.waiting = getOpenCVPeopleCount(floor); // camera counts people on arrival
    const boarding = Math.min(call.waiting, MAX_CAPACITY - state.load);
    call.waiting -= boarding;
    state.load += boarding;
    state.direction = call.direction === 'up' ? 1 : -1;

    // Boarding passengers press a floor in the direction they called for
    const offset = call.direction === 'up' ? 2 : -2;
    const target = Math.max(0, Math.min(TOTAL_FLOORS, floor + offset));
    if (target !== floor) {
      state.riders[target] = (state.riders[target] || 0) + boarding;
      if (!hasDest(target)) state.destinations.push({ seq: ++seqCounter, floor: target });
    }
    logEvent(`${boarding} passenger(s) boarded at ${floorName(floor)} going ${call.direction} (OpenCV counted). They pressed ${floorName(target)}.`);

    if (call.waiting > 0) {
      logEvent(`Lift full. ${call.waiting} still waiting at ${floorName(floor)} floor.`, 'warning');
    } else {
      state.requests = state.requests.filter(r => r !== call);
    }
  }

  state.doorsOpen = true;
  logEvent(`Doors opened at ${floorName(floor)} floor.`);
  updateUI();
}

// ==========================================
// ONE TICK = ONE MOVEMENT
// arrive -> doors open -> doors close -> move on
// ==========================================
function normal_lift_logic() {
  if (state.moving) return; // still travelling between floors

  // Doors are open
  if (state.doorsOpen) {
    if (shouldStop()) { serveFloor(); return; } // someone just pressed this floor, keep serving
    state.doorsOpen = false;
    logEvent(`Doors closed at ${floorName(state.currentFloor)} floor.`);
    updateUI();
    return;
  }

  // Doors are closed. Stop here?
  if (shouldStop()) { serveFloor(); return; }

  // Pick a direction and move exactly one floor
  const previous = state.direction;
  state.direction = chooseDirection();

  if (state.direction === 0) {
    if (previous !== 0) logEvent(`Lift idle at ${floorName(state.currentFloor)} floor.`, 'system');
    updateUI();
    return;
  }

  state.currentFloor += state.direction;
  state.moving = true;
  setTimeout(() => { state.moving = false; }, MOVE_MS);
  logEvent(`Lift moved ${state.direction === 1 ? 'up' : 'down'} to ${floorName(state.currentFloor)} floor.`);
  updateUI();
}

// ==========================================
// EVENT LISTENERS
// ==========================================
document.getElementById('floor-controls')?.addEventListener('click', event => {
  const button = event.target.closest('[data-call]');
  if (button) requestFloor(Number(button.dataset.floor), button.dataset.call);
});

document.body.addEventListener('click', event => {
  const button = event.target.closest('[data-dest-floor]');
  if (button) selectDestination(Number(button.dataset.destFloor));
});

document.getElementById('btn-step')?.addEventListener('click', normal_lift_logic);

document.getElementById('btn-run')?.addEventListener('click', () => {
  if (!state.running) {
    state.running = setInterval(normal_lift_logic, TICK_MS);
    updateUI();
    logEvent('Automatic operation started.', 'system');
  }
});

document.getElementById('btn-stop')?.addEventListener('click', () => {
  if (state.running) {
    clearInterval(state.running);
    state.running = null;
    updateUI();
    logEvent('Automatic operation paused.', 'system');
  }
});

document.getElementById('btn-reset')?.addEventListener('click', () => {
  if (state.running) clearInterval(state.running);
  Object.assign(state, {
    currentFloor: 0,
    direction: 0,
    load: 0,
    running: null,
    requests: [],
    destinations: [],
    riders: {},
    doorsOpen: false,
    moving: false
  });
  const log = document.getElementById('event-log');
  if (log) log.innerHTML = '';
  logEvent('Simulation reset to G floor.', 'system');
  updateUI();
});

// Manual door controls (not while the car is travelling)
document.getElementById('grid5')?.addEventListener('click', () => {
  if (state.moving || state.doorsOpen) return;
  state.doorsOpen = true;
  logEvent(`Doors opened manually at ${floorName(state.currentFloor)} floor.`);
  updateUI();
});

document.getElementById('gridclose')?.addEventListener('click', () => {
  if (!state.doorsOpen) return;
  state.doorsOpen = false;
  logEvent(`Doors closed manually at ${floorName(state.currentFloor)} floor.`);
  updateUI();
});

// Initialize on load
buildUI();
 */