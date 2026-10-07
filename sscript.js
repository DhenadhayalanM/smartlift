'use strict';

// ==========================================================================
//  LIFT SIMULATOR
//  Includes the skip_return_logic:
//    A) Lift FULL and reaching a hall call  -> don't stop, mark it SKIPPED,
//       keep it in the queue, serve in-lift destinations first.
//    B) Lift FULL and a call arrives in the OPPOSITE direction of travel
//       -> compare distances, keep serving in-lift destinations, and queue the
//       call normally (in order of arrival).
//    C) Load drops below the limit and a skipped floor is within
//       SKIP_RETURN_THRESHOLD floors -> go BACK and serve it first.
// ==========================================================================

// ==========================================
// CONSTANTS
// ==========================================
const TOTAL_FLOORS = 10;
const MAX_CAPACITY = 12;
const TICK_MS = 900;
const FLOOR_HEIGHT = 54;   // must match --floor-height in style.css
const MOVE_MS = 600;       // must match the car's "top" transition in style.css

// How close (in floors) a skipped call must be for the lift to turn back for it.
const SKIP_RETURN_THRESHOLD = 3;

// true  -> shaft drawn G, 1, 2 ... 10 from top to bottom
// false -> shaft drawn like a real building: 10 at the top, G at the bottom
const GROUND_AT_TOP = false;

const DEBUG = false;       // set true to print state to the console on every UI update

// ==========================================
// STATE
// ==========================================
let seqCounter = 0;        // every button press gets a number: lower = pressed earlier

const state = {
  currentFloor: 0,
  direction: 0,            // 1 = UP, -1 = DOWN, 0 = IDLE
  load: 0,                 // people currently inside the lift
  running: null,           // setInterval handle for automatic mode
  requests: [],            // hall calls: { seq, floor, direction:'up'|'down', waiting, skipped }
  destinations: [],        // in-lift buttons: { seq, floor }
  doorsOpen: false,
  moving: false,
  returnTarget: null       // floor of a skipped call the lift is currently going back for
};

let doorPromptOpen = false;      // true while the "people out / in" pop-up is showing
let plannedStopFloor = null;     // floor the lift decided to stop at on arrival
let moveTimer = null;            // timeout handle for the "moving" flag
let servedWaiting = 0;           // people waiting at the floor that was just served
let servedDirection = null;      // direction ('up'/'down') of the hall call just served
const pendingHallCalls = new Set();

// ==========================================
// SMALL HELPERS
// ==========================================
const $ = id => document.getElementById(id);
const floorName = floor => (floor === 0 ? 'G' : String(floor));
const levelName = floor => (floor === 0 ? 'GROUND' : `LEVEL ${String(floor).padStart(2, '0')}`);
const carTop = floor => (GROUND_AT_TOP ? floor : TOTAL_FLOORS - floor) * FLOOR_HEIGHT + 5;
const dirName = dir => (dir === 1 ? 'up' : 'down');
const isFull = () => state.load >= MAX_CAPACITY;
const hasDest = floor => state.destinations.some(d => d.floor === floor);

// ==========================================
// LOGGING & UI
// ==========================================
function logEvent(message, type = '') {
  const logContainer = $('event-log');
  if (!logContainer) return;

  const item = document.createElement('li');
  item.className = type;
  item.innerHTML =
    `<time>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>` +
    `<span>${message}</span>`;
  logContainer.prepend(item);

  const logCount = $('log-count');
  if (logCount) logCount.textContent = `${logContainer.children.length} EVENTS`;
}

function updateUI() {
  const dirText = state.direction === 1 ? 'UP' : state.direction === -1 ? 'DOWN' : 'IDLE';
  const arrow = state.direction === 1 ? '▲ ' : state.direction === -1 ? '▼ ' : '';

  const car = $('car');
  if (car) {
    car.style.top = `${carTop(state.currentFloor)}px`;
    car.classList.toggle('doors-open', state.doorsOpen);
    car.classList.toggle('full', isFull());
  }

  const carCount = $('car-count');
  if (carCount) carCount.textContent = state.load;

  const ledText = $('led-text');
  if (ledText) ledText.textContent = `${arrow}${floorName(state.currentFloor)}`;

  const floorLabel = $('current-floor-label');
  if (floorLabel) floorLabel.textContent = `${floorName(state.currentFloor)} FLOOR`;

  const statusText = $('text');
  if (statusText) statusText.textContent = state.doorsOpen ? 'Doors open' : 'Doors closed';

  const statusPanel = $('status');
  if (statusPanel) {
    // "!" after a call means it was skipped because the lift was full
    const calls = state.requests
      .map(r => `${floorName(r.floor)}${r.direction === 'up' ? '▲' : '▼'}${r.skipped ? '!' : ''}`)
      .join(' ');
    statusPanel.textContent =
      `POSITION     ${floorName(state.currentFloor)}\n` +
      `DIRECTION    ${dirText}\n` +
      `DOORS        ${state.doorsOpen ? 'OPEN' : 'CLOSED'}\n` +
      `PASSENGERS   ${state.load} / ${MAX_CAPACITY}${isFull() ? '  (FULL)' : ''}\n` +
      `HALL CALLS   ${calls || 'none'}\n` +
      `DESTINATIONS ${state.destinations.map(d => floorName(d.floor)).join(', ') || 'none'}\n` +
      `RETURNING TO ${state.returnTarget === null ? '-' : floorName(state.returnTarget)}`;
  }

  document.querySelectorAll('[data-dest-floor]').forEach(btn => {
    const floor = Number(btn.dataset.destFloor);
    btn.classList.toggle('active', hasDest(floor));
  });

  document.querySelectorAll('.floor-control').forEach(row => {
    const floor = Number(row.dataset.floor);
    row.classList.toggle('queued-up', state.requests.some(r => r.floor === floor && r.direction === 'up'));
    row.classList.toggle('queued-down', state.requests.some(r => r.floor === floor && r.direction === 'down'));
  });

  document.querySelectorAll('[data-call]').forEach(btn => {
    const floor = Number(btn.dataset.floor);
    btn.classList.toggle('lit', state.requests.some(r => r.floor === floor && r.direction === btn.dataset.call));
  });

  const runBtn = $('btn-run');
  if (runBtn) runBtn.classList.toggle('active', !!state.running);

  if (DEBUG) console.log(state);
}

function buildUI() {
  const shaft = $('shaft');
  const floorControls = $('floor-controls');

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
        </div>`);
    });
    const car = document.createElement('div');
    car.id = 'car';
    car.innerHTML =
      '<span class="car-label">LIFT</span><strong id="car-count">0</strong><span class="car-unit">PEOPLE</span>';
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
        </div>`);
    }
  }

  const inLiftPanel = $('in-lift-buttons');
  if (inLiftPanel) {
    inLiftPanel.innerHTML = '';
    for (let row = Math.floor(TOTAL_FLOORS / 2) * 2; row >= 0; row -= 2) {
      [row, row + 1].forEach(f => {
        if (f > TOTAL_FLOORS) return;
        const alone = row + 1 > TOTAL_FLOORS;
        inLiftPanel.insertAdjacentHTML('beforeend',
          `<button class="btn btn-dest${alone ? ' single' : ''}" data-dest-floor="${f}" aria-label="Floor ${floorName(f)}">${floorName(f)}</button>`);
      });
    }
  }

  updateUI();
  logEvent('System initialized at G floor.', 'system');
}

// ==========================================
// MODAL (queued, cancellable, validated)
// ==========================================
let modalChain = Promise.resolve();   // modals are shown one after another
let modalGeneration = 0;              // bumped on reset so stale modals are dropped
let activeModalResolve = null;

/**
 * Shows the pop-up and resolves with { fieldId: number } or null if cancelled.
 * Needs these ids in the HTML: modal, m-title, m-body, m-fields, m-ok
 * Optional: m-cancel (adds a Cancel button). Esc = cancel, Enter = OK.
 */
function openModal({ title, body, fields = [] }) {
  const generation = modalGeneration;

  const show = () => new Promise(resolve => {
    const modal = $('modal');
    if (!modal || generation !== modalGeneration) { resolve(null); return; }

    $('m-title').textContent = title;
    $('m-body').textContent = body;
    $('m-fields').innerHTML = fields.map(f => `
      <label>${f.label ?? f.id}
        <input id="f-${f.id}" type="${f.type ?? 'number'}"
               min="${f.min ?? 0}" ${f.max !== undefined ? `max="${f.max}"` : ''}
               step="1" value="${f.value ?? 0}">
      </label>`).join('');

    modal.classList.remove('hidden');
    const firstInput = $(`f-${fields[0]?.id}`);
    if (firstInput) { firstInput.focus(); firstInput.select?.(); }

    const finish = value => {
      document.removeEventListener('keydown', onKey);
      modal.classList.add('hidden');
      activeModalResolve = null;
      resolve(value);
    };

    const submit = () => {
      const result = {};
      fields.forEach(f => {
        const el = $(`f-${f.id}`);
        let v = Math.floor(Number(el.value));
        if (!Number.isFinite(v)) v = 0;
        v = Math.max(f.min ?? 0, v);
        if (f.max !== undefined) v = Math.min(f.max, v);
        result[f.id] = v;
      });
      finish(result);
    };

    const onKey = e => {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter') submit();
    };
    document.addEventListener('keydown', onKey);

    $('m-ok').onclick = submit;
    const cancelBtn = $('m-cancel');
    if (cancelBtn) cancelBtn.onclick = () => finish(null);

    activeModalResolve = () => finish(null);   // used by reset
  });

  const promise = modalChain.then(show);
  modalChain = promise.catch(() => {});
  return promise;
}

function closeActiveModal() {
  modalGeneration++;
  if (activeModalResolve) activeModalResolve();
}

// ==========================================
// DOORS & PASSENGER COUNTS
// ==========================================
function openDoors(message) {
  if (state.doorsOpen) return;
  state.doorsOpen = true;
  logEvent(message);
  updateUI();
  promptDoorCounts(state.currentFloor);
}

function closeDoors(message) {
  state.doorsOpen = false;
  logEvent(message);
  updateUI();
}

async function promptDoorCounts(floor) {
  doorPromptOpen = true;
  const waiting = servedWaiting;
  const callDirection = servedDirection;
  servedWaiting = 0;
  servedDirection = null;

  try {
    const r = await openModal({
      title: `Floor ${floorName(floor)}: doors open`,
      body: waiting > 0
        ? `${waiting} person(s) were waiting here. Enter the passenger counts observed while the doors are open.`
        : 'Enter the passenger counts observed while the doors are open.',
      fields: [
        { id: 'out', label: 'People getting out of the lift', value: 0, max: state.load },
        { id: 'in', label: 'People getting into the lift', value: waiting, max: MAX_CAPACITY },
      ],
    });

    const out = r ? Math.min(r.out, state.load) : 0;
    const wantIn = r ? r.in : 0;

    state.load -= out;
    const free = MAX_CAPACITY - state.load;
    const boarded = Math.min(wantIn, free);
    state.load += boarded;

    // People who wanted to board but did not fit (or the pop-up was cancelled)
    const left = r ? wantIn - boarded : waiting;

    logEvent(`Floor ${floorName(floor)}: ${out} out, ${boarded} in. Load ${state.load}/${MAX_CAPACITY}.`);

    if (left > 0) {
      if (callDirection) {
        // They press the button again -> treated as a skipped call with high priority
        requeueSkippedCall(floor, callDirection, left);
        logEvent(`${left} person(s) could not board at ${floorName(floor)} floor. Call kept as SKIPPED.`, 'warning');
      } else {
        logEvent(`${left} person(s) could not board (lift full).`, 'warning');
      }
    }

    if (isFull() && state.destinations.length === 0) {
      logEvent('Lift is full and has no destination. Press a floor button inside the lift.', 'warning');
    }
  } finally {
    doorPromptOpen = false;
    updateUI();
  }
}

function requeueSkippedCall(floor, direction, count) {
  const existing = state.requests.find(r => r.floor === floor && r.direction === direction);
  if (existing) {
    existing.waiting += count;
    existing.skipped = true;
  } else {
    state.requests.push({ seq: ++seqCounter, floor, direction, waiting: count, skipped: true });
  }
}

// ==========================================
// BUTTON HANDLERS
// ==========================================
async function requestFloor(floor, callDirection) {
  const callKey = `${floor}:${callDirection}`;
  if (state.requests.some(r => r.floor === floor && r.direction === callDirection)
    || pendingHallCalls.has(callKey)) return;

  pendingHallCalls.add(callKey);
  try {
    const result = await openModal({
      title: `Outside call: ${floorName(floor)} floor`,
      body: 'Enter the number of people waiting for the lift.',
      fields: [{ id: 'waiting', label: 'People waiting for the lift', value: 1, min: 1 }],
    });
    if (!result) return;   // cancelled -> no call registered

    // The same call may have been queued while the pop-up was open
    if (state.requests.some(r => r.floor === floor && r.direction === callDirection)) return;

    const request = {
      seq: ++seqCounter,
      floor,
      direction: callDirection,
      waiting: result.waiting,
      skipped: false
    };
    state.requests.push(request);   // always queued in the order it arrives
    logEvent(`${callDirection.toUpperCase()} call registered at ${floorName(floor)} floor (${result.waiting} waiting).`);

    handleOppositeCall(request);
    updateUI();
  } finally {
    pendingHallCalls.delete(callKey);
  }
}

function selectDestination(floor) {
  if (floor === state.currentFloor) {
    if (!state.doorsOpen && !state.moving) openDoors(`Doors re-opened at ${floorName(floor)} floor.`);
    return;
  }
  if (hasDest(floor)) return;

  // Passengers inside must always be able to press a button, even when full,
  // otherwise a full lift could never unload.
  state.destinations.push({ seq: ++seqCounter, floor });
  logEvent(`In-lift button pressed for ${floorName(floor)} floor.`);
  updateUI();
}

// ==========================================
// SCHEDULING
// ==========================================
function activeTargets() {
  const targets = state.destinations.map(d => ({ floor: d.floor, priority: d.seq }));
  if (!isFull()) {
    // Skipped calls get a very high priority (much smaller number = served first)
    state.requests.forEach(r =>
      targets.push({ floor: r.floor, priority: r.skipped ? r.seq - 1e9 : r.seq }));
  }
  return targets;
}

function targetsAhead(dir, from = state.currentFloor) {
  return activeTargets().some(t => (t.floor - from) * dir > 0);
}

/**
 * (B) Lift is FULL, moving, and a hall call comes in the OPPOSITE direction.
 *     if (distance to in-lift destination) <= (distance to request floor)
 *         keep serving in-lift destinations
 *     The call is queued normally (already pushed in arrival order).
 */
function handleOppositeCall(request) {
  if (!isFull() || state.direction === 0) return;
  if (request.direction === dirName(state.direction)) return;   // same direction -> not "opposite"

  const destDistances = state.destinations
    .map(d => (d.floor - state.currentFloor) * state.direction)
    .filter(v => v > 0);
  const destDistance = destDistances.length ? Math.min(...destDistances) : Infinity;
  const requestDistance = Math.abs(request.floor - state.currentFloor);

  if (destDistance <= requestDistance) {
    logEvent(`Opposite call at ${floorName(request.floor)}: in-lift destination is nearer. Continuing in-lift stops, call queued in order.`);
  } else {
    logEvent(`Opposite call at ${floorName(request.floor)} queued in order. Lift is full, so in-lift stops still come first.`);
  }
}

/**
 * skip_return_logic - runs on every tick (this is the "while true" loop).
 *
 *  FULL:
 *    - if the lift is reaching a hall-call floor and has no one getting off there,
 *      do NOT stop: mark the call SKIPPED (stays in the queue, high priority).
 *    - in-lift destinations are served first (hall calls are ignored while full).
 *  NOT FULL:
 *    - if the nearest skipped call is within SKIP_RETURN_THRESHOLD floors,
 *      go back and serve it first instead of moving like a normal floor.
 */
function skip_return_logic(reachingFloor = null) {
  if (isFull()) {
    if (state.returnTarget !== null) {
      logEvent('Lift filled up again. Return trip cancelled.', 'warning');
      state.returnTarget = null;
    }

    if (reachingFloor !== null && !hasDest(reachingFloor)) {
      state.requests
        .filter(r => r.floor === reachingFloor && !r.skipped)
        .forEach(r => {
          r.skipped = true;   // marked, NOT removed from the queue
          logEvent(
            `Lift full (${state.load}/${MAX_CAPACITY}). Not stopping at ${floorName(r.floor)} floor. ${r.direction.toUpperCase()} call marked SKIPPED.`,
            'warning');
        });
    }
    return;
  }

  // Not full anymore: decide whether to go back for a skipped call
  const skipped = state.requests.filter(r => r.skipped);
  if (!skipped.length) { state.returnTarget = null; return; }

  // keep the current return target if it is still valid
  if (state.returnTarget !== null && skipped.some(r => r.floor === state.returnTarget)) return;

  const nearest = skipped.reduce((a, b) => {
    const da = Math.abs(a.floor - state.currentFloor);
    const db = Math.abs(b.floor - state.currentFloor);
    return db < da || (db === da && b.seq < a.seq) ? b : a;
  });
  const distance = Math.abs(nearest.floor - state.currentFloor);

  if (distance <= SKIP_RETURN_THRESHOLD) {
    state.returnTarget = nearest.floor;
    logEvent(`Space available. Going back to skipped call at ${floorName(nearest.floor)} floor (${distance} floor(s) away).`, 'system');
  } else {
    state.returnTarget = null;   // too far: it will be served with high priority in the normal sweep
  }
}

/**
 * Called on every floor the lift passes while it is going BACK for a skipped call.
 * Put the "while backing and serving the skipped floors" behaviour here.
 */
function onBackingToSkipped(floor, target) {
  // TODO: your custom loop for backing + serving skipped floors goes here.
  // Available info: floor (where the lift is now), target (skipped floor),
  // state.requests (check r.skipped), state.load, state.destinations.
}

/**
 * Should the lift stop at `floor` when travelling in `direction`?
 */
function shouldStopAt(floor, direction = state.direction) {
  if (hasDest(floor)) return true;                 // somebody wants to get off

  const here = state.requests.filter(r => r.floor === floor);
  if (!here.length) return false;
  if (isFull()) return false;                       // no room: handled as a skip

  if (state.returnTarget === floor) return true;    // going back for this skipped call
  if (direction === 0) return true;
  if (here.some(r => r.direction === dirName(direction))) return true;   // same direction
  return !targetsAhead(direction, floor);           // nothing further ahead -> take it
}

function chooseDirection() {
  const floor = state.currentFloor;

  // Going back for a skipped call has priority over everything else
  if (state.returnTarget !== null && state.returnTarget !== floor) {
    return Math.sign(state.returnTarget - floor);
  }

  const targets = activeTargets();
  if (!targets.length) return 0;

  const dir = state.direction;
  if (dir !== 0) {
    if (targets.some(t => (t.floor - floor) * dir > 0)) return dir;    // keep going
    if (targets.some(t => (t.floor - floor) * dir < 0)) return -dir;   // reverse
    return 0;
  }

  // Idle: first come, first served (skipped calls have the best priority)
  const best = targets.reduce((a, b) => (b.priority < a.priority ? b : a));
  return Math.sign(best.floor - floor);
}

function serveFloor() {
  const floor = state.currentFloor;

  state.destinations = state.destinations.filter(d => d.floor !== floor);

  const here = state.requests.filter(r => r.floor === floor);
  const dir = state.direction;
  let call = null;

  if (state.returnTarget === floor) {
    call = here.find(r => r.skipped) || here[0];
    state.returnTarget = null;
  } else {
    call = here.find(r => dir !== 0 && r.direction === dirName(dir));
    if (!call && here.length && (dir === 0 || !targetsAhead(dir))) call = here[0];
  }

  servedWaiting = 0;
  servedDirection = null;
  if (call) {
    state.direction = call.direction === 'up' ? 1 : -1;
    state.requests = state.requests.filter(r => r !== call);
    servedWaiting = call.waiting;
    servedDirection = call.direction;
    logEvent(`${call.waiting} person(s) were waiting at ${floorName(floor)} floor.`);
  }

  openDoors(`Doors opened at ${floorName(floor)} floor.`);
}

function normal_lift_logic() {
  if (state.moving) return;

  // 1. Doors open -> close them (but wait for the pop-up first)
  if (state.doorsOpen) {
    if (doorPromptOpen) return;
    if (plannedStopFloor === state.currentFloor) plannedStopFloor = null;
    closeDoors(`Doors closed at ${floorName(state.currentFloor)} floor.`);
    return;
  }

  // 2. Run the skip / return logic for the floor we are on
  skip_return_logic();

  // 3. A skipped call is on this very floor and there is room now
  if (state.returnTarget === state.currentFloor) {
    plannedStopFloor = null;
    serveFloor();
    return;
  }

  // 4. We arrived at a planned stop
  if (plannedStopFloor === state.currentFloor) {
    plannedStopFloor = null;
    serveFloor();
    return;
  }

  // 5. Idle on a floor that has something to serve
  if (state.direction === 0 && shouldStopAt(state.currentFloor, 0)) {
    serveFloor();
    return;
  }

  // 6. Pick a direction and move one floor
  const previous = state.direction;
  state.direction = chooseDirection();

  if (state.direction === 0) {
    if (previous !== 0) logEvent(`Lift idle at ${floorName(state.currentFloor)} floor.`, 'system');
    updateUI();
    return;
  }

  const nextFloor = state.currentFloor + state.direction;
  if (nextFloor < 0 || nextFloor > TOTAL_FLOORS) {   // safety net, should not happen
    state.direction = 0;
    updateUI();
    return;
  }

  // Full lift reaching a hall call: mark it skipped instead of stopping
  skip_return_logic(nextFloor);
  plannedStopFloor = shouldStopAt(nextFloor, state.direction) ? nextFloor : null;

  state.currentFloor = nextFloor;
  state.moving = true;
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => { state.moving = false; }, MOVE_MS);
  logEvent(`Lift moved ${state.direction === 1 ? 'up' : 'down'} to ${floorName(state.currentFloor)} floor.`);

  if (state.returnTarget !== null) onBackingToSkipped(state.currentFloor, state.returnTarget);
  updateUI();
}

// ==========================================
// EVENT LISTENERS
// ==========================================
function bindEvents() {
  $('floor-controls')?.addEventListener('click', event => {
    const button = event.target.closest('[data-call]');
    if (button && !button.disabled) requestFloor(Number(button.dataset.floor), button.dataset.call);
  });

  document.body.addEventListener('click', event => {
    const button = event.target.closest('[data-dest-floor]');
    if (button) selectDestination(Number(button.dataset.destFloor));
  });

  $('btn-step')?.addEventListener('click', normal_lift_logic);

  $('btn-run')?.addEventListener('click', () => {
    if (!state.running) {
      state.running = setInterval(normal_lift_logic, TICK_MS);
      updateUI();
      logEvent('Automatic operation started.', 'system');
    }
  });

  $('btn-stop')?.addEventListener('click', () => {
    if (state.running) {
      clearInterval(state.running);
      state.running = null;
      updateUI();
      logEvent('Automatic operation paused.', 'system');
    }
  });

  $('btn-reset')?.addEventListener('click', () => {
    if (state.running) clearInterval(state.running);
    clearTimeout(moveTimer);
    closeActiveModal();

    plannedStopFloor = null;
    doorPromptOpen = false;
    servedWaiting = 0;
    servedDirection = null;
    seqCounter = 0;
    pendingHallCalls.clear();

    Object.assign(state, {
      currentFloor: 0,
      direction: 0,
      load: 0,
      running: null,
      requests: [],
      destinations: [],
      doorsOpen: false,
      moving: false,
      returnTarget: null
    });

    const log = $('event-log');
    if (log) log.innerHTML = '';
    logEvent('Simulation reset to G floor.', 'system');
    updateUI();
  });

  // Manual door controls (not while the car is travelling)
  $('grid5')?.addEventListener('click', () => {
    if (state.moving || state.doorsOpen) return;
    servedWaiting = 0;
    servedDirection = null;
    openDoors(`Doors opened manually at ${floorName(state.currentFloor)} floor.`);
  });

  $('gridclose')?.addEventListener('click', () => {
    if (!state.doorsOpen || doorPromptOpen) return;
    closeDoors(`Doors closed manually at ${floorName(state.currentFloor)} floor.`);
  });
}

// ==========================================
// START
// ==========================================
function init() {
  buildUI();
  bindEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}