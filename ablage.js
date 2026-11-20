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

/* Beleg speichern: Cloud-Speicher + (nur Eingangsrechnungen) Ablage-Ordner. Gibt {datei, dateiname} zurück. */
async function belegSpeichern(r, file) {
  const name = belegName(r, dateiEndung(file.name, file.type)), dir = r.richtung === 'ausgang' ? 'ausgang' : 'eingang';
  const datei = `${dir}/${(r.datum || todayISO()).slice(0, 4)}/${uid()}-${safeName(name)}`;
  await DB.upload(datei, file);
  let dateiname = name, _ordner = false, _grund = '';
  if (dir === 'eingang') {
    const ord = await ablageOrdner(false);
    if (!ord) _grund = !ablageMoeglich() ? 'Browser kann keine Ordner (Chrome/Edge nehmen)' : !ABLAGE ? 'kein Ordner gewählt' : 'kein Zugriff auf den Ordner erlaubt';
    else { try { dateiname = await ablageSchreiben(ord, name, file); _ordner = true; } catch (e) { console.warn(e); _grund = 'Schreiben fehlgeschlagen: ' + (e.message || e.name); } }
    ABLAGE_LOG.push({ name: dateiname, ok: _ordner, grund: _grund });
  }
  return { datei, dateiname, _ordner, _grund };   // Felder mit _ werden nicht gespeichert
}
const ABLAGE_LOG = [];   // was wurde (nicht) in den Ordner gelegt – für die Rückmeldung
function ablageMeldung(log) {
  if (!log.length) return '';
  const ok = log.filter(l => l.ok), nein = log.filter(l => !l.ok);
  return `<div class="${nein.length ? 'warn' : 'note'} small">${ok.length ? `📁 ${ok.length} Datei${ok.length === 1 ? '' : 'en'} im Ordner „${esc(ABLAGE ? ABLAGE.name : '')}“ gespeichert.` : ''}
    ${nein.length ? `⚠ ${nein.length} Datei${nein.length === 1 ? '' : 'en'} <b>nicht</b> im Ordner gespeichert – ${esc([...new Set(nein.map(l => l.grund))].join('; '))}. Unter Einstellungen → Beleg-Ablage den Ordner wählen bzw. „Vorhandene Belege jetzt ablegen“ klicken.` : ''}</div>`;
}
// Datei (PDF, Foto oder Mail) an eine bestimmte Rechnung hängen – Mail: erster PDF-Anhang, sonst Mailtext als PDF
async function belegZuRechnung(id, file) {
  const r = S.rechnungen.find(x => x.id === id); if (!r || !file) return;
  if (r.richtung !== 'ausgang') await ablageOrdner(true);   // direkt nach Klick/Drop um Ordner-Erlaubnis bitten
  busy(true, 'PDF wird gespeichert …');
  try {
    const bs = await fileToBelege(file); let b = bs.find(x => /pdf/.test(x.type)) || bs[0]; if (!b) return toast('Keine PDF gefunden.');
    let f = b.file; if (b.type === 'message/rfc822' && b.mail) f = new File([textPdf(b.mail.subject || 'E-Mail', `Von: ${b.mail.from}\n\n${b.mail.text}`)], 'Mail.pdf', { type: 'application/pdf' });
    const p = await belegAnhaengen(r, f);
    toast('PDF hinterlegt: ' + p.dateiname + (r.richtung === 'ausgang' ? '' : p._ordner ? ' · 📁 im Ordner gespeichert' : ' · ⚠ NICHT im Ordner (' + p._grund + ')'));
  } catch (e) { console.error(e); toast('PDF nicht gespeichert: ' + (e.message || e)); }
  finally { busy(false); }
  render(); rechnungDetail(id);
}
async function belegAnhaengen(r, file) { const p = await belegSpeichern(r, file); await DB.update('rechnungen', r.id, p); return p; }

/* Mail ohne PDF-Anhang → einfache PDF aus Betreff, Absender und Mailtext (damit jede Buchung eine PDF hat) */
function textPdf(titel, zeilenText) {
  const lat = s => String(s || '').normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, '-').replace(/€/g, 'EUR').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, ' ');
  const wrap = (s, n) => s.split('\n').flatMap(l => { const out = []; l = l.replace(/\s+$/, ''); while (l.length > n) { let i = l.lastIndexOf(' ', n); if (i < 20) i = n; out.push(l.slice(0, i)); l = l.slice(i).replace(/^ /, ''); } out.push(l); return out; });
  const lines = [...wrap(lat(titel), 70).map(l => ['B', l]), ['', ''], ...wrap(lat(zeilenText).replace(/\n{3,}/g, '\n\n'), 95).map(l => ['', l])];
  const esc2 = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const pages = []; for (let i = 0; i < lines.length; i += 62) pages.push(lines.slice(i, i + 62));
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  pages.forEach(pg => {
    let y = 800; const c = ['BT'];
    pg.forEach(([f, t]) => { c.push(`/${f === 'B' ? 'F2 12' : 'F1 9.5'} Tf 1 0 0 1 40 ${y} Tm (${esc2(t)}) Tj`); y -= 12.5; });
    c.push('ET'); const s = c.join('\n');
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(objs.length + ' 0 R');
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length); for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 255;
  return new Blob([bytes], { type: 'application/pdf' });
}

/* Eigene Rechnungsnummer (R26-0491, r26/491 …) in Dateiname oder Text finden → Ausgangsrechnung der App */
function ausgangAusText(s) {
  const re = /\bR\s?(\d{2})\s?[-_/ .]?\s?(\d{1,4})\b/gi; let m;
  while ((m = re.exec(String(s || '')))) { const nr = `R${m[1]}-${m[2].padStart(4, '0')}`, r = S.rechnungen.find(x => x.richtung === 'ausgang' && normNr(x.nummer || '') === normNr(nr)); if (r) return r; }
  return null;
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
