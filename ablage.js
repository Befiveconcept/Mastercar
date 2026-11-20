/* Mastercar Finanzen · Beleg-Ablage
   Jeder Beleg bekommt automatisch den Namen  VE Sport_<Lieferant>_<Art>_<RE-Nummer>_<Datum>.pdf
   und wird – wenn ein Ordner gewählt ist – zusätzlich in diesen Ordner auf dem PC gelegt (z. B. OneDrive/HiDrive).
   Der Ordner wird pro Browser einmal gewählt (Einstellungen → Beleg-Ablage); geht in Chrome und Edge. */

const ablageMoeglich = () => typeof window.showDirectoryPicker === 'function';

// Unerlaubte Zeichen für Windows-Dateinamen entfernen
const nameTeil = (s, max = 60) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, max).trim();
function dateiEndung(name, type) {
  const m = String(name || '').match(/\.([a-z0-9]{2,5})$/i); if (m) return m[1].toLowerCase();
  return /pdf/.test(type || '') ? 'pdf' : /png/.test(type || '') ? 'png' : /jpe?g/.test(type || '') ? 'jpg' : 'pdf';
}
function belegName(r, ext = 'pdf') {
  const teile = ['VE Sport', nameTeil(r.partner) || 'Unbekannt', nameTeil(r.art, 20) || (r.brutto < 0 ? 'Gutschrift' : 'Rechnung'), nameTeil(r.nummer, 40) || 'ohne Nr', r.datum ? r.datum.slice(0, 10).split('-').reverse().join('.') : 'ohne Datum'];   // Datum wie 19.11.2026
  return teile.join('_') + '.' + ext;
}

/* Ordner-Zugriff merken (IndexedDB) */
const ablIdb = () => new Promise((res, rej) => { const q = indexedDB.open('mastercar-ablage', 1); q.onupgradeneeded = () => q.result.createObjectStore('h'); q.onsuccess = () => res(q.result); q.onerror = rej; });
async function ablIdbGet(k) { const d = await ablIdb(); return new Promise((res, rej) => { const q = d.transaction('h').objectStore('h').get(k); q.onsuccess = () => res(q.result); q.onerror = rej; }); }
async function ablIdbPut(k, v) { const d = await ablIdb(); return new Promise((res, rej) => { const tx = d.transaction('h', 'readwrite'); v == null ? tx.objectStore('h').delete(k) : tx.objectStore('h').put(v, k); tx.oncomplete = res; tx.onerror = rej; }); }

let ABLAGE = null;   // gewählter Ordner (FileSystemDirectoryHandle)
async function ablageLaden() { if (!ablageMoeglich()) return null; try { ABLAGE = (await ablIdbGet('ordner')) || null; } catch (e) { ABLAGE = null; } return ABLAGE; }
async function ablageWaehlen() {
  if (!ablageMoeglich()) { toast('Ordner-Ablage geht nur in Chrome oder Edge.'); return null; }
  try { const h = await window.showDirectoryPicker({ id: 'mastercar-belege', mode: 'readwrite' }); ABLAGE = h; await ablIdbPut('ordner', h); toast('Ablage-Ordner: ' + h.name); return h; }
  catch (e) { if (e.name !== 'AbortError') toast('Ordner nicht übernommen: ' + e.message); return null; }
}
ablageLaden().then(h => { if (h && typeof UI !== 'undefined' && UI.view === 'einst') render(); });
async function ablageAus() { ABLAGE = null; await ablIdbPut('ordner', null); }
// Ordner mit Schreibrecht holen. ask=true fragt den Browser nach (nur direkt nach einem Klick/Drop möglich).
async function ablageOrdner(ask = true) {
  const h = ABLAGE || await ablageLaden(); if (!h) return null;
  try {
    let p = await h.queryPermission({ mode: 'readwrite' });
    if (p === 'prompt' && ask) p = await h.requestPermission({ mode: 'readwrite' });
    return p === 'granted' ? h : null;
  } catch (e) { return null; }
}
async function ablageHat(dir, name) { try { await dir.getFileHandle(name); return true; } catch (e) { return false; } }
// Datei schreiben; gibt es den Namen schon, wird „ (2)“, „ (3)“ … angehängt. Gibt den verwendeten Namen zurück.
async function ablageSchreiben(dir, name, blob) {
  let n = name; const m = name.match(/^(.*?)(\.[^.]+)?$/);
  for (let i = 2; await ablageHat(dir, n); i++) n = `${m[1]} (${i})${m[2] || ''}`;
  const fh = await dir.getFileHandle(n, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close();
  return n;
}
async function ablageBlob(r) { const u = await DB.fileUrl(r.datei); if (!u) return null; const res = await fetch(u); return res.ok ? res.blob() : null; }

// Nach dem Bearbeiten: Datei im Ordner auf den neuen Namen bringen (alte Datei wird ersetzt)
async function ablageUmbenennen(r, alt) {
  if (!r.datei) return;
  const neu = belegName(r, dateiEndung(r.datei)); if (neu === alt) return;
  const dir = await ablageOrdner(false);
  let name = neu;
  if (dir) {
    try {
      let blob = null;
      if (alt && await ablageHat(dir, alt)) blob = await (await dir.getFileHandle(alt)).getFile();
      if (!blob) blob = await ablageBlob(r);
      if (blob) { name = await ablageSchreiben(dir, neu, blob); if (alt && alt !== name && await ablageHat(dir, alt)) await dir.removeEntry(alt); }
    } catch (e) { console.warn(e); toast('Beleg im Ordner nicht umbenannt: ' + e.message); }
  }
  await DB.update('rechnungen', r.id, { dateiname: name });
}

// Alle vorhandenen Belege (Rechnungseingang mit Datei) in den Ordner legen, die dort noch fehlen
async function ablageAlle() {
  const dir = await ablageOrdner(true); if (!dir) return toast('Bitte zuerst einen Ablage-Ordner wählen und den Zugriff erlauben.');
  const liste = S.rechnungen.filter(r => r.datei);
  let neu = 0, da = 0, fehl = 0;
  for (let i = 0; i < liste.length; i++) {
    const r = liste[i]; busy(true, `Belege in den Ordner legen: ${i + 1} von ${liste.length}`);
    try {
      const soll = belegName(r, dateiEndung(r.datei));
      if (await ablageHat(dir, soll)) { da++; if (r.dateiname !== soll) await DB.update('rechnungen', r.id, { dateiname: soll }); continue; }
      const blob = await ablageBlob(r); if (!blob) { fehl++; continue; }
      const n = await ablageSchreiben(dir, soll, blob); await DB.update('rechnungen', r.id, { dateiname: n }); neu++;
    } catch (e) { console.warn(e); fehl++; }
  }
  busy(false); render();
  toast(`${neu} Beleg(e) abgelegt${da ? ', ' + da + ' waren schon da' : ''}${fehl ? ', ' + fehl + ' nicht gefunden' : ''}.`);
}
