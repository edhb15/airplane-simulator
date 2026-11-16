// Save slots in localStorage, plus file export/import.
const PREFIX = 'wd-save:';
const INDEX = 'wd-saves';

export function serialize(s) {
  return JSON.stringify(s, (k, v) => (k.startsWith('_') ? undefined : v));
}
export function deserialize(json) {
  const s = JSON.parse(json);
  if (!s || s.version !== 1 || !s.nations || !s.terr) throw new Error('Not a WORLD DOMINATION save');
  return s;
}

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX) || '[]'); } catch { return []; }
}
function writeIndex(list) {
  try { localStorage.setItem(INDEX, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

export function listSaves() {
  return readIndex().sort((a, b) => b.time - a.time);
}

export function saveGame(s, slot, label) {
  const data = serialize(s);
  try {
    localStorage.setItem(PREFIX + slot, data);
  } catch (e) {
    return { ok: false, msg: 'Browser storage is full or unavailable — export to a file instead.' };
  }
  const P = s.nations[s.player];
  const list = readIndex().filter((x) => x.slot !== slot);
  list.push({ slot, label: label || slot, time: Date.now(), nation: P.name, flag: P.flag, day: s.day, startYear: s.startYear, difficulty: s.difficulty, size: data.length });
  writeIndex(list);
  return { ok: true, msg: 'Game saved' };
}

export function loadGame(slot) {
  const data = localStorage.getItem(PREFIX + slot);
  if (!data) throw new Error('Save not found');
  return deserialize(data);
}

export function deleteSave(slot) {
  try { localStorage.removeItem(PREFIX + slot); } catch { /* ignore */ }
  writeIndex(readIndex().filter((x) => x.slot !== slot));
}

export function exportFile(s) {
  const blob = new Blob([serialize(s)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `world-domination-${s.nations[s.player].name.replace(/\W+/g, '-')}-${s.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Hall of fame for finished campaigns
const HOF = 'wd-hall-of-fame';
export function hallOfFame() {
  try { return JSON.parse(localStorage.getItem(HOF) || '[]'); } catch { return []; }
}
export function recordResult(entry) {
  const list = hallOfFame();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  try { localStorage.setItem(HOF, JSON.stringify(list.slice(0, 50))); } catch { /* ignore */ }
}
