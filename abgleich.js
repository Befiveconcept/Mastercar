/* Mastercar Finanzen · Abgleich: Rechnungen ↔ Bank ↔ SumUp
   Status je Rechnung: offen, überfällig, bezahlt, zu wenig (teilbezahlt), zu viel (überzahlt), doppelt bezahlt, erledigt */
const ZIEL_TAGE = () => +(S.einstellungen.zahlungsziel ?? 14);
let IDX = { zByR: new Map(), zByB: new Map(), zByS: new Map(), zByK: new Map() };
function buildIdx() {
  const m = () => new Map(); IDX = { zByR: m(), zByB: m(), zByS: m(), zByK: m(), gsByR: m() };
  const push = (map, k, z) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(z); };
  S.zuordnungen.forEach(z => { push(IDX.zByR, z.rechnung_id, z); push(IDX.zByB, z.bank_id, z); push(IDX.zByS, z.sumup_id, z); push(IDX.zByK, z.kasse_id, z); });
  S.rechnungen.forEach(r => { if (r.bezug_id && r.bezug_id !== r.id) push(IDX.gsByR, r.bezug_id, r); });   // Gutschriften/Korrekturen je Rechnung
}
// Zu zahlender Betrag (Skonto abgezogen)
const sollOf = r => r2((+r.brutto || 0) - (+r.skonto || 0));
const isStorno = r => /storn/i.test((r.status_excel || '') + ' ' + (r.art || '') + ' ' + (r.zahlart || ''));
const sum = (a, f = x => x) => r2(a.reduce((s, x) => s + (+f(x) || 0), 0));
const sumOk = s => !/fehl|failed|storn|abgebrochen|cancel|declin|abgelehnt|ignor/i.test(s.status || '');

const R_ST = {
  offen: ['Offen', 'st-open'], ueberfaellig: ['Überfällig', 'st-late'], bezahlt: ['Bezahlt', 'st-ok'], teil: ['Zu wenig bezahlt', 'st-warn'],
  ueber: ['Zu viel bezahlt', 'st-warn'], doppelt: ['Doppelt bezahlt', 'st-bad'], erledigt: ['Erledigt', 'st-ok'], pruefen: ['KI – prüfen', 'st-ai'],
  extern: ['Bezahlt (laut Liste)', 'st-ok'], storno: ['Storniert', 'st-info']
};
function faelligAm(r) { return r.faellig || (r.datum ? addDays(r.datum, ZIEL_TAGE()) : null); }
// Status genau wie in der Excel-Mappe (Spalte „Erledigt?“ bzw. „Bezahlt?“)
const ST_LISTE = {
  eingang: ['Offen', 'Abbuchung offen', 'Mahnung', '2. Mahnung', '3. Mahnung', 'Beleg fehlt aber bez.', 'Bezahlt'],
  ausgang: ['Offen', 'Mahnung', '2. Mahnung', '3. Mahnung', 'Zu viel bez.', 'Bezahlt', 'storniert']
};
// eigene Schreibweisen aus der Excel übernehmen (z. B. „3. Mahnung“), sonst die feste Liste
const stListe = dir => { const s = new Set(ST_LISTE[dir]); S.rechnungen.forEach(r => { if (r.richtung === dir && r.status_excel) s.add(r.status_excel); }); return [...s]; };
const stNorm = (v, dir) => { const t = String(v || '').trim(); if (!t) return null; const hit = ST_LISTE[dir || 'eingang'].concat(ST_LISTE.ausgang).find(x => x.toLowerCase() === t.toLowerCase()); return hit || t; };
const istBezahltLaut = s => /^(bezahlt|beleg fehlt|zu viel)/i.test(String(s || '').trim());
const istStornoLaut = s => /^storn/i.test(String(s || '').trim());
const ST_CLS = s => istBezahltLaut(s) ? (/zu viel/i.test(s) ? 'st-warn' : 'st-ok') : /^[23]\.\s*mahn/i.test(s) ? 'st-bad' : /mahn/i.test(s) ? 'st-late' : istStornoLaut(s) ? 'st-info' : /abbuchung/i.test(s) ? 'st-info' : 'st-open';
function rStatus(r) {
  // Gutschrift/Korrektur, die mit einer Rechnung verknüpft ist: wird dort verrechnet, ist selbst nichts mehr offen
  const orig = r.bezug_id && (+r.brutto || 0) < 0 ? S.rechnungen.find(x => x.id === r.bezug_id) : null;
  if (orig) return { key: 'verrechnet', label: 'Verrechnet', cls: 'st-ok', hint: ['mit ' + (orig.nummer || 'Rechnung') + ' verrechnet', 'st-ok'], bezahlt: 0, offen: 0, zahlungen: [], gutschriften: [], bezug: orig };
  const gs = (IDX.gsByR && IDX.gsByR.get(r.id) || []).filter(g => (+g.brutto || 0) < 0), gut = sum(gs, g => Math.abs(sollOf(g)));
  const zs = IDX.zByR.get(r.id) || [], paid = r2(sum(zs, z => z.betrag) + gut), brutto = sollOf(r), diff = r2(brutto - paid), hatZ = zs.length || gs.length;
  const stx = r.status_excel || '', laut = istBezahltLaut(stx) || (!stx && r.bezahlt_extern);
  let key, erkl = null;   // erkl = Abweichung ist erklärt (Cent-Differenz, Notiz, Liste) → kein Problem
  if (r.erledigt || istStornoLaut(stx)) key = isStorno(r) || istStornoLaut(stx) ? 'storno' : 'erledigt';
  else if (!hatZ && laut) key = 'extern';   // laut Liste bezahlt, Zahlung (noch) nicht gefunden
  else if (!hatZ) { const f = faelligAm(r); key = f && f < todayISO() ? 'ueberfaellig' : 'offen'; }
  else if (!zs.length && diff > 0.01) { const f = faelligAm(r); key = f && f < todayISO() ? 'ueberfaellig' : 'offen'; }   // nur teilweise gutgeschrieben, Rest offen
  else if (Math.abs(diff) <= 0.01) key = 'bezahlt';
  else if (Math.abs(diff) <= CENT_TOLERANZ) { key = 'bezahlt'; erkl = ['Cent-Differenz ' + fmtE(-diff), 'st-info']; }
  else if (diff > 0) { key = 'teil'; if (laut) erkl = ['Rest ' + fmtE(diff) + ' laut Liste bezahlt (Zahlung noch nicht gefunden)', 'st-info']; }
  else {
    key = zs.length >= 2 && (zs.filter(z => eq(z.betrag, brutto)).length >= 2 || eq(paid, 2 * brutto)) ? 'doppelt' : 'ueber';
    if (NOTIZ_RUECK.test(r.notiz || '')) erkl = ['Rückzahlung laut Notiz', 'st-info'];
  }
  if (erkl) key = 'bezahlt';
  // Anzeige: der Status aus der Liste; ohne Eintrag ein passender Begriff aus derselben Liste
  const label = stx || ({ bezahlt: 'Bezahlt', extern: 'Bezahlt', erledigt: 'Bezahlt', storno: 'storniert', ueber: 'Zu viel bez.' }[key] || 'Offen');
  // Zusatzhinweis aus dem Abgleich, wenn er etwas anderes sagt als der Status
  let hint = null;
  if (erkl) hint = erkl;
  else if (['ueber', 'doppelt', 'teil'].includes(key) && !(key === 'ueber' && /zu viel/i.test(label))) hint = R_ST[key];
  else if (key === 'ueberfaellig' && !/mahn/i.test(label)) hint = ['überfällig', 'st-late'];
  else if (key === 'bezahlt' && !istBezahltLaut(label)) hint = ['Zahlung gefunden', 'st-ok'];
  if (!hint && gut > 0.005) hint = ['Gutschrift ' + fmtE(gut) + ' verrechnet', 'st-info'];
  return { key, label, cls: ST_CLS(label), hint, erklaert: !!erkl, bezahlt: key === 'extern' ? brutto : paid, offen: key === 'erledigt' || key === 'storno' || key === 'extern' || erkl ? 0 : diff, zahlungen: zs, gutschriften: gs };
}
// Rechnungen mit Nachbarnummer (R26-0764 → R26-0762 … R26-0766)
function nachbarn(r, pool) {
  const m = String(r.nummer || '').match(/^(.*?)(\d+)$/); if (!m) return [];
  const n = +m[2], w = m[2].length, ok = new Set([-2, -1, 1, 2].map(d => normNr(m[1] + String(n + d).padStart(w, '0'))));
  return pool.filter(x => x.id !== r.id && x.nummer && ok.has(normNr(x.nummer)));
}
const CENT_TOLERANZ = 0.10;   // Rundungs-/Cent-Differenzen bis 10 Cent gelten als bezahlt
const NOTIZ_RUECK = /zur(ü|ue)ck|erstatt|r(ü|ue)ck(ü|ue)berw|r(ü|ue)ckzahl|gutgeschrieben|verrechnet/i;   // „Doppelte Bezahlung, also 79,99 € zurück“
// Nach einem Zahlungsfund den Status nachziehen: vollständig bezahlt → „Bezahlt“.
// „Zu viel / zu wenig / doppelt“ bleibt nur ein Hinweis – das entscheidet ihr selbst (oft sind es Tippfehler in der Beschreibung).
async function statusNachziehen(ids) {
  buildIdx(); const jobs = [];
  for (const id of new Set(ids)) {
    const r = S.rechnungen.find(x => x.id === id); if (!r || r.erledigt || istStornoLaut(r.status_excel)) continue;
    const st = rStatus(r); let neu = null;
    if (st.key === 'bezahlt' && !istBezahltLaut(r.status_excel)) neu = 'Bezahlt';
    if (neu) jobs.push(() => DB.update('rechnungen', r.id, { status_excel: neu }));
  }
  for (let i = 0; i < jobs.length; i += 10) await Promise.all(jobs.slice(i, i + 10).map(f => f()));
  return jobs.length;
}
const B_ST = {
  offen: ['Nicht zugeordnet', 'st-open'], zugeordnet: ['Zugeordnet', 'st-ok'], teilweise: ['Teilweise zugeordnet', 'st-warn'], sumup: ['SumUp-Auszahlung', 'st-info'],
  privat: ['Privat', 'st-info'], intern: ['Umbuchung', 'st-info'], ignoriert: ['Ignoriert', 'st-info'], kosten: ['Kosten ohne Beleg', 'st-info']
};
function bStatus(b) {
  const zs = IDX.zByB.get(b.id) || [], used = sum(zs, z => z.betrag), rest = r2(Math.abs(b.betrag) - used);
  let key;
  if (b.art && B_ST[b.art] && !zs.length) key = b.art;
  else if (!zs.length) key = b.betrag < 0 && b.kostenart ? 'kosten' : 'offen';
  else key = rest <= 0.01 ? 'zugeordnet' : 'teilweise';
  return { key, label: B_ST[key][0], cls: B_ST[key][1], rest: Math.max(0, rest), zuordnungen: zs };
}
function sStatus(s) {
  if (!sumOk(s)) return { key: 'fehl', label: s.status || 'Fehlgeschlagen', cls: 'st-info', rest: 0, zuordnungen: [] };
  const zs = IDX.zByS.get(s.id) || [], used = sum(zs, z => z.betrag), rest = r2(Math.abs(s.betrag) - used);
  if (!zs.length) return { key: 'offen', label: 'Keiner Rechnung zugeordnet', cls: 'st-open', rest, zuordnungen: zs };
  return rest <= 0.01 ? { key: 'zugeordnet', label: 'Zugeordnet', cls: 'st-ok', rest: 0, zuordnungen: zs } : { key: 'teilweise', label: 'Teilweise zugeordnet', cls: 'st-warn', rest, zuordnungen: zs };
}

function kStatus(k) {
  const zs = IDX.zByK.get(k.id) || [], used = sum(zs, z => z.betrag), rest = r2(Math.abs(k.betrag) - used);
  if (!zs.length && k.betrag > 0 && /^\s*R\s?25\s?[-\/]/i.test(k.text || '')) return { key: 'intern', label: 'Zahlung zu Rechnung aus 2025', cls: 'st-info', rest: 0, zuordnungen: zs };   // Vorjahr – nicht Teil dieser Software
  if (!zs.length && /umbuchung|privat|ignor/i.test(k.kostenart || '')) return { key: 'intern', label: /umbuchung/i.test(k.kostenart) ? 'Umbuchung Kasse → Bank' : k.kostenart, cls: 'st-info', rest: 0, zuordnungen: zs };   // per Regel eingeordnet
  if (!zs.length) return { key: 'offen', label: k.betrag < 0 && k.kostenart ? 'Kosten ohne Beleg' : 'Ohne Beleg', cls: k.betrag < 0 && k.kostenart ? 'st-info' : 'st-open', rest, zuordnungen: zs };
  return rest <= 0.01 ? { key: 'zugeordnet', label: 'Zugeordnet', cls: 'st-ok', rest: 0, zuordnungen: zs } : { key: 'teilweise', label: 'Teilweise', cls: 'st-warn', rest, zuordnungen: zs };
}

/* ---------- Trefferbewertung: passt Zahlung (Text, Name, IBAN, Betrag, Datum) zu Rechnung? ---------- */
// Text einmal vorbereiten (schneller bei tausenden Rechnungen)
const prepText = text => { const T = String(text || '').toUpperCase(); return { flat: T.replace(/[^A-Z0-9]/g, ''), toks: new Set(T.split(/[^A-Z0-9]+/).filter(Boolean)), raw: text }; };
const NT_CACHE = new Map();
const nameTok = s => { s = s || ''; let v = NT_CACHE.get(s); if (!v) { v = nameTokens(s); NT_CACHE.set(s, v); } return v; };
// Kurzformen ausschreiben: „r26/0491 0490“ → R26-0491 R26-0490 · „r26-1143-1131-1102“ → drei Nummern · „r26/0625+0619“ → zwei
function expandNr(text) {
  const t = String(text || ''), add = [], re = /[a-z]?\s*(\d{2})\s*[\/\-.]\s*(\d{3,5})((?:\s*[+,&\/\-\s]\s*\d{3,4}\b)*)/gi; let m;
  // dreistellig („r26/114“) → vierstellig (R26-0114); fünfstellig bleibt (ist dann ein Tippfehler und passt zu nichts)
  while ((m = re.exec(t))) { add.push('R' + m[1] + '-' + m[2].padStart(4, '0')); (m[3].match(/\d{3,4}/g) || []).forEach(n => add.push('R' + m[1] + '-' + n.padStart(4, '0'))); }
  return add.length ? t + ' · ' + add.join(' · ') : t;
}
const siehtWieNummerAus = text => /\b[a-z]?\s*\d{2}\s*[\/\-.]\s*\d{3,5}\b/i.test(String(text || ''));
// Tippfehler im Jahr/Kürzel („r25/0505“, „r27/1064“, „d26/1642“): nur die laufende Nummer vergleichen – zugeordnet wird nur bei exakt gleichem Betrag
const laufNr = text => new Set([...String(text || '').matchAll(/\d{2}\s*[\/\-.]\s*(\d{3,4})\b/g)].map(m => m[1].padStart(4, '0')));
const nrEnde = nummer => { const m = String(nummer || '').match(/(\d{3,4})\s*$/); return m ? m[1].padStart(4, '0') : null; };
// enthält – aber nicht als Teil einer längeren Zahl („R26-00865“ ist nicht R26-0086)
function hatGrenze(hay, s, auchVorne) {
  for (let i = hay.indexOf(s); i >= 0; i = hay.indexOf(s, i + 1)) {
    const a = hay[i - 1], b = hay[i + s.length];
    if (!(b && /\d/.test(b)) && !(auchVorne && a && /\d/.test(a))) return true;
  }
  return false;
}
function nrHit(nummer, text) {
  const nr = normNr(nummer); if (!nr || nr.length < 3) return false;
  const P = typeof text === 'object' && text ? text : prepText(expandNr(text)), flat = P.flat, toks = P.toks;
  if (toks.has(nr)) return true;
  if (nr.length >= 5 && hatGrenze(flat, nr, false)) return true;
  const dig = String(nummer).replace(/\D/g, '');
  if (dig.length >= 5 && hatGrenze(flat, dig, true) && !/^0+$/.test(dig)) return true;
  if (dig.length === 4 && toks.has(dig) && /[A-Z]/.test(nr)) return true; // „RE-1234“ → „Rechnung 1234“
  return false;
}
function nameHit(partner, text) {
  const a = nameTok(partner); if (!a.length) return false;
  const b = text instanceof Set ? text : new Set(nameTok(text)); return a.some(w => b.has(w));
}
// Bewertet eine Zahlung (Bank/SumUp) gegen eine Rechnung; höher = besser
function score(pay, r, restPay, restR) {
  const text = (pay.zweck || pay.beschreibung || pay.text || '') + ' ' + (pay.gegenpartei || '');
  let s = 0; const why = [];
  if (r.nummer && nrHit(r.nummer, text)) { s += 60; why.push('Rechnungsnr. im Text'); }
  if (r.kennzeichen && normNr(text).includes(normNr(r.kennzeichen)) && normNr(r.kennzeichen).length >= 4) { s += 20; why.push('Kennzeichen'); }
  if (nameHit(r.partner, text)) { s += 25; why.push('Name'); }
  if (r.iban && pay.iban && normNr(r.iban) === normNr(pay.iban)) { s += 30; why.push('IBAN'); }
  if (eq(restPay, restR) && restR > 0.005) { s += 30; why.push('Betrag = offener Betrag'); }
  else if (eq(restPay, r.brutto)) { s += 20; why.push('Betrag = Rechnungsbetrag'); }
  if (r.datum && pay.datum) { const d = daysBetween(r.datum, pay.datum); if (d < -5) s -= 30; else if (d <= 45) s += 5; else if (d > 200) s -= 15; }
  return { s, why };
}
// Vorschläge für eine Zahlung (für das manuelle Zuordnen)
function vorschlaege(pay, kind) {
  buildIdx();
  const richtung = kind === 'sumup' ? 'ausgang' : (pay.betrag >= 0 ? 'ausgang' : 'eingang');
  const restPay = kind === 'bank' ? bStatus(pay).rest : kind === 'kasse' ? kStatus(pay).rest : sStatus(pay).rest;
  return S.rechnungen.filter(r => r.richtung === richtung).map(r => { const st = rStatus(r); const sc = score(pay, r, restPay, st.offen); return { r, st, ...sc }; })
    .filter(x => x.s >= 25).sort((a, b) => b.s - a.s).slice(0, 8);
}

/* ---------- Automatischer Abgleich ---------- */
async function autoAbgleich() {
  if (typeof regelnAnwenden === 'function') await regelnAnwenden().catch(e => console.warn(e));   // eigene Regeln zuerst (z. B. Bareinzahlungen = Umbuchung)
  buildIdx();
  const newZ = [], extraR = new Map(), extraP = new Map();
  // offener Betrag nur aus echten Zahlungen (auch „laut Liste bezahlt“ darf noch seine Zahlung finden)
  const paidR = new Map(); S.zuordnungen.forEach(z => paidR.set(z.rechnung_id, (paidR.get(z.rechnung_id) || 0) + (+z.betrag || 0)));
  const restR = r => r2(sollOf(r) - (paidR.get(r.id) || 0) - (extraR.get(r.id) || 0));
  const add = (r, pay, kind, betrag, why) => {
    betrag = r2(betrag); if (betrag <= 0.005) return;
    newZ.push({ rechnung_id: r.id, bank_id: kind === 'bank' ? pay.id : null, sumup_id: kind === 'sumup' ? pay.id : null, kasse_id: kind === 'kasse' ? pay.id : null, betrag, art: 'auto', datum: pay.datum, notiz: why });
    extraR.set(r.id, (extraR.get(r.id) || 0) + betrag); extraP.set(pay.id, (extraP.get(pay.id) || 0) + betrag);
  };
  const restP = (id, rest) => r2(rest - (extraP.get(id) || 0));   // was von einer Zahlung in diesem Lauf noch übrig ist
  const ausg = S.rechnungen.filter(r => r.richtung === 'ausgang' && !r.erledigt && sollOf(r) > 0);
  const eing = S.rechnungen.filter(r => r.richtung === 'eingang' && !r.erledigt && sollOf(r) > 0);

  // 0) Hinweise aus der Spalte „Notizen“ zuerst: „bezahlt unter 0325“, „falsch auf Nr 26-0062“, „08.01.2026 um 16:27 bezahlt“
  //    Zugeordnet wird nur, wenn der Betrag genau passt.
  const zahlungen = () => [
    ...S.bank.filter(b => !b.art && b.betrag > 0).map(b => ({ p: b, kind: 'bank', text: b.zweck || '', rest: restP(b.id, bStatus(b).rest) })),
    ...S.sumup.filter(s => sumOk(s) && s.betrag > 0).map(s => ({ p: s, kind: 'sumup', text: s.beschreibung || '', rest: restP(s.id, sStatus(s).rest) })),
    ...S.kasse.filter(k => k.betrag > 0).map(k => ({ p: k, kind: 'kasse', text: k.text || '', rest: restP(k.id, kStatus(k).rest) }))
  ].filter(x => x.rest > 0.005);
  const nrSchluessel = text => { const s = new Set(), t = expandNr(text);
    (t.match(/R(\d{2})-(\d{3,5})/g) || []).forEach(x => { const [, yy, n] = x.match(/R(\d{2})-(\d{3,5})/); s.add(yy + n.padStart(4, '0')); s.add(n.padStart(4, '0')); });
    (String(text).match(/\b\d{3,5}\b/g) || []).forEach(n => s.add(n.padStart(4, '0')));
    return s; };
  const mitNotiz = ausg.filter(r => r.notiz && restR(r) > 0.005);
  if (mitNotiz.length) {
    const Z = zahlungen().map(x => ({ ...x, keys: nrSchluessel(x.text) }));
    for (const r of mitNotiz) {
      const n = String(r.notiz);
      // a) andere Nummer: „unter / als / auf / mit (Nr.) 26-0062 | 0325 | 288“
      const alias = [...n.matchAll(/(?:unter|als|auf|mit)\s+(?:der\s+)?(?:re\.?|rg\.?|rechnung)?\s*(?:nr\.?|nummer)?\s*([a-z]?\s*\d{2}\s*[\/\-.]\s*\d{3,5}|\d{3,5})\b/gi)].map(m => {
        const a = m[1].match(/(\d{2})\s*[\/\-.]\s*(\d{3,5})/); return a ? a[1] + a[2].padStart(4, '0') : m[1].replace(/\D/g, '').padStart(4, '0'); });
      let hit = null;
      if (alias.length) { const c = Z.filter(x => x.rest > 0.005 && alias.some(a => x.keys.has(a)) && eq(x.rest, restR(r))); if (c.length === 1) hit = [c[0], 'Notiz: „' + n.slice(0, 40) + '“']; }
      // b) Zahltag: „bezahlt am 21.01.2026“, „08.01.2026 um 16:27 bezahlt“
      if (!hit && /bezahlt|gezahlt|überwiesen|ueberwiesen/i.test(n)) {
        const d = n.match(/(\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2}(?!:))?/);   // „11.04“, „11.04.“, „11.04.2026“ (nicht die Uhrzeit „14:56“)
        if (d) {
          let y = d[3] ? +d[3] : +(r.datum || todayISO()).slice(0, 4); if (y < 100) y += 2000;
          const tag = `${y}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`, fenster = r.zahlart === 'ec' ? 0 : 3;
          const c = Z.filter(x => x.rest > 0.005 && eq(x.rest, restR(r)) && Math.abs(daysBetween(x.p.datum, tag)) <= fenster && (r.zahlart !== 'ec' || x.kind === 'sumup'));
          if (c.length === 1) hit = [c[0], 'Notiz: „' + n.slice(0, 40) + '“'];
        }
      }
      if (hit) { add(r, hit[0].p, hit[0].kind, hit[0].rest, hit[1]); hit[0].rest = 0; }
    }
  }

  function matchPay(pay, kind, pool, restPay, amountOnlyOk = false) {
    const text = (pay.zweck || pay.beschreibung || pay.text || '') + ' ' + (pay.gegenpartei || '');
    const P = prepText(expandNr(text)), NS = new Set(nameTok(text));
    // 1) Rechnungsnummer(n) im Verwendungszweck – auch wenn schon bezahlt (→ doppelt/überzahlt wird sichtbar)
    const byNr = pool.filter(r => r.nummer && nrHit(r.nummer, P));
    if (byNr.length === 1) {
      // Betrag passt nicht, aber die Nachbarnummer (±1/±2) hat genau diesen Betrag offen und ein ähnliches Datum → Zahlendreher/Vertipper
      const r0 = byNr[0];
      if (!eq(restR(r0), restPay)) {
        const nb = nachbarn(r0, pool).filter(r => eq(restR(r), restPay) && (!r.datum || !pay.datum || Math.abs(daysBetween(r.datum, pay.datum)) <= 7));
        if (nb.length === 1) { add(nb[0], pay, kind, restPay, `Nummer vertippt (${r0.nummer} statt ${nb[0].nummer}), Betrag passt`); return true; }
      }
      add(r0, pay, kind, restPay, 'Rechnungsnummer im Text'); return true;
    }
    if (byNr.length > 1) {
      // mehrere Nummern-Treffer: zuerst der, bei dem auch Name bzw. Betrag passt (zufällige Ziffernfolgen, z. B. in Mandats-IDs, aussortieren)
      const nb = byNr.filter(r => nameHit(r.partner, NS) && eq(restR(r), restPay));
      if (nb.length === 1) { add(nb[0], pay, kind, restPay, 'Rechnungsnummer, Name und Betrag'); return true; }
      const nn = byNr.filter(r => nameHit(r.partner, NS));
      if (nn.length === 1 && restR(nn[0]) > 0.005) { add(nn[0], pay, kind, restPay, 'Rechnungsnummer und Name'); return true; }
      const open = byNr.filter(r => restR(r) > 0.005), tot = sum(open, restR);
      if (open.length && eq(tot, restPay)) { open.forEach(r => add(r, pay, kind, restR(r), 'Sammelzahlung (mehrere Rechnungsnummern)')); return true; }
      return false; // unklar → von Hand
    }
    const openPool = pool.filter(r => restR(r) > 0.005 && !(r.datum && pay.datum && daysBetween(r.datum, pay.datum) < -5));
    // 2) Name/IBAN + genau der offene Betrag
    const named = openPool.filter(r => nameHit(r.partner, NS) || (r.iban && pay.iban && normNr(r.iban) === normNr(pay.iban)));
    const nAmt = named.filter(r => eq(restR(r), restPay));
    if (nAmt.length === 1) { add(nAmt[0], pay, kind, restPay, 'Name/IBAN und Betrag'); return true; }
    if (nAmt.length > 1) { nAmt.sort((a, b) => (a.datum || '').localeCompare(b.datum || '')); add(nAmt[0], pay, kind, restPay, 'Name/IBAN und Betrag (älteste offene)'); return true; }
    // 3) Name + Summe aller offenen Rechnungen dieses Partners
    if (named.length > 1 && eq(sum(named, restR), restPay)) { named.forEach(r => add(r, pay, kind, restR(r), 'Sammelzahlung (Name, Summe)')); return true; }
    // 4) Nur Betrag – nur wenn eindeutig (genau eine offene Rechnung mit diesem Betrag)
    const amt = openPool.filter(r => eq(restR(r), restPay) && (!r.datum || !pay.datum || daysBetween(r.datum, pay.datum) <= 90));
    if (amt.length === 1 && amountOnlyOk) { add(amt[0], pay, kind, restPay, 'Nur Betrag (eindeutig) – bitte prüfen'); return true; }
    return false;
  }

  // Bank: Eingänge → Ausgangsrechnungen, Abgänge → Eingangsrechnungen
  const bankOpen = S.bank.filter(b => !b.art).map(b => ({ b, rest: restP(b.id, bStatus(b).rest) })).filter(x => x.rest > 0.005).sort((a, b) => a.b.datum.localeCompare(b.b.datum));
  // Nur-Betrag-Treffer nur, wenn auch der Betrag bei den Bankumsätzen eindeutig ist
  const amtCount = {}; bankOpen.forEach(x => { const k = Math.sign(x.b.betrag) + ':' + x.rest.toFixed(2); amtCount[k] = (amtCount[k] || 0) + 1; });
  for (const { b, rest } of bankOpen) {
    matchPay(b, 'bank', b.betrag > 0 ? ausg : eing, rest, amtCount[Math.sign(b.betrag) + ':' + rest.toFixed(2)] === 1);
  }
  // SumUp: Kartenzahlungen → Ausgangsrechnungen (Nummer in Beschreibung, sonst Betrag ±7 Tage, EC bevorzugt)
  for (const s of S.sumup.filter(sumOk)) {
    const rest = restP(s.id, sStatus(s).rest); if (rest <= 0.005 || s.betrag <= 0) continue;
    if (matchPay({ ...s, zweck: s.beschreibung }, 'sumup', ausg, rest)) continue;
    if (siehtWieNummerAus(s.beschreibung)) {   // Nummer angegeben, aber keine passende Rechnung → Tippfehler im Jahr? sonst lieber von Hand
      const ln = laufNr(s.beschreibung), c = ausg.filter(r => ln.has(nrEnde(r.nummer)) && eq(restR(r), rest));
      if (c.length === 1) add(c[0], s, 'sumup', rest, 'Nummer mit Tippfehler, Betrag passt');
      continue;
    }
    const c = ausg.filter(r => restR(r) > 0.005 && eq(restR(r), rest) && r.zahlart !== 'bar' && r.zahlart !== 'bank' && (!r.datum || Math.abs(daysBetween(r.datum, s.datum)) <= 7));
    const ec = c.filter(r => r.zahlart === 'ec'), pick = ec.length === 1 ? ec[0] : c.length === 1 ? c[0] : (c.filter(r => r.datum === s.datum).length === 1 ? c.find(r => r.datum === s.datum) : null);
    if (pick) add(pick, s, 'sumup', rest, 'SumUp: Betrag und Datum');
  }
  // Kassenbuch: Bar-Einnahmen → Kundenrechnungen (Rechnungsnr. im Text, z. B. „R26-0048“), Bar-Ausgaben → Eingangsbelege
  // Doppelte Kassenzeilen (gleiches Datum, Betrag, Beleg-Nr. und Text – z. B. der doppelte Januar-Block) zählen nur einmal als Zahlung
  const kSig = k => [k.datum, r2(k.betrag), k.belegnr || '', norm(k.text || '')].join('|');
  const kSigBelegt = new Set(S.kasse.filter(k => (IDX.zByK.get(k.id) || []).length).map(kSig));
  for (const k of S.kasse) {
    const rest = restP(k.id, kStatus(k).rest); if (rest <= 0.005) continue;
    if (kSigBelegt.has(kSig(k))) continue;
    const pool = k.betrag > 0 ? ausg : eing;
    const vorher = newZ.length;
    if (matchPay(k, 'kasse', pool, rest)) { if (newZ.length > vorher) kSigBelegt.add(kSig(k)); continue; }
    if (siehtWieNummerAus(k.text)) {   // z. B. „R25-0010“: nur dieselbe laufende Nummer mit exakt gleichem Betrag, nie eine fremde Rechnung
      const ln = laufNr(k.text), c = pool.filter(r => ln.has(nrEnde(r.nummer)) && eq(restR(r), rest));
      if (c.length === 1) { add(c[0], k, 'kasse', rest, 'Nummer mit Tippfehler, Betrag passt'); kSigBelegt.add(kSig(k)); }
      continue;
    }
    // Bar-Beleg gleichen Betrags ±3 Tage (bevorzugt Zahlart bar)
    const c = pool.filter(r => restR(r) > 0.005 && eq(restR(r), rest) && r.datum && Math.abs(daysBetween(r.datum, k.datum)) <= 3);
    const bar = c.filter(r => r.zahlart === 'bar'), pick = bar.length === 1 ? bar[0] : c.length === 1 ? c[0] : null;
    if (pick) { add(pick, k, 'kasse', rest, 'Kasse: Betrag und Datum'); kSigBelegt.add(kSig(k)); }
  }
  if (newZ.length) { await DB.insert('zuordnungen', newZ); await statusNachziehen(newZ.map(z => z.rechnung_id)); }

  // SumUp-Auszahlungen auf dem Bankkonto ↔ einzelne SumUp-Umsätze
  let links = 0;
  for (const b of S.bank.filter(b => b.art === 'sumup' && !S.sumup.some(s => s.bank_id === b.id))) {
    const netto = s => s.auszahlung != null ? s.auszahlung : s.betrag - (s.gebuehr || 0);
    // 1) sicher: Auszahlungs-ID („PID1066911“) steht im Verwendungszweck der Bankgutschrift
    const pid = String(b.zweck || '').toUpperCase().match(/PID\s*(\d{4,})/);
    if (pid) {
      const c = S.sumup.filter(s => !s.bank_id && s.auszahlung_ref && new RegExp('PID\\s*' + pid[1] + '\\b', 'i').test(s.auszahlung_ref));
      if (c.length) { for (const s of c) { await DB.update('sumup', s.id, { bank_id: b.id }); links++; } continue; }
    }
    // 2) sonst über Auszahlungsdatum und Summe
    // erst gleicher Tag, dann schrittweise ±1 … ±3 Tage (Bank bucht oft 1–2 Tage später)
    for (let w = 0; w <= 3; w++) {
      const c = S.sumup.filter(s => !s.bank_id && sumOk(s) && s.auszahlung_datum && Math.abs(daysBetween(s.auszahlung_datum, b.datum)) <= w);
      if (c.length && Math.abs(sum(c, netto) - b.betrag) <= 0.05) { for (const s of c) { await DB.update('sumup', s.id, { bank_id: b.id }); links++; } break; }
      // auch einzelne Auszahlungstage im Fenster prüfen
      const days = [...new Set(c.map(s => s.auszahlung_datum))], hit = days.find(d => Math.abs(sum(c.filter(s => s.auszahlung_datum === d), netto) - b.betrag) <= 0.05);
      if (hit) { for (const s of c.filter(s => s.auszahlung_datum === hit)) { await DB.update('sumup', s.id, { bank_id: b.id }); links++; } break; }
    }
  }
  buildIdx();
  if (typeof avisAbgleich === 'function') await avisAbgleich().catch(e => console.warn(e));   // Zahlungsavise mit Abbuchungen verbinden
  return { n: newZ.length, links };
}

/* ---------- Manuelles Zuordnen ---------- */
async function zuordnen(r, pay, kind, betrag, notiz) {
  await DB.insert('zuordnungen', [{ rechnung_id: r.id, bank_id: kind === 'bank' ? pay.id : null, sumup_id: kind === 'sumup' ? pay.id : null, kasse_id: kind === 'kasse' ? pay.id : null, betrag: r2(betrag), art: kind === 'bar' ? 'bar' : 'manuell', datum: pay ? pay.datum : todayISO(), notiz: notiz || null }]);
  await statusNachziehen([r.id]);
}
async function zuordnungLoeschen(zid) { await DB.remove('zuordnungen', zid); buildIdx(); }
