/* Mastercar Finanzen · Eigene Regeln („Hinweise“) für den Abgleich
   Ihr schreibt in eigenen Worten, was die App wissen soll – z. B.
   „Einzahlungen von Volksbank Köln Bonn sind die Summe der Barzahlungen von Kunden“ –
   die KI macht daraus eine Regel (Suchbegriffe + was zu tun ist). Die Regeln gelten bei jedem Abgleich.
   Gespeichert in einstellungen.regeln (für alle im Team gleich). */

const REGEL_AKTION = {
  umbuchung: 'Umbuchung Kasse ↔ Bank (keine Kundenzahlung, kein Beleg nötig)',
  privat: 'Privat (gehört nicht zur Firma)',
  ignorieren: 'Ignorieren (kein Beleg nötig)',
  kostenart: 'Kosten ohne Beleg mit Kostenart',
};
const REGEL_QUELLE = { bank: 'Bank', kasse: 'Kassenbuch', sumup: 'SumUp' };
const REGEL_RICHTUNG = { ein: 'Eingänge (+)', aus: 'Ausgänge (−)', beide: 'Ein- und Ausgänge' };

// Voreinstellung: Bareinzahlungen auf das Konto sind Umbuchungen aus der Kasse
const REGELN_START = [
  { id: 'bareinzahlung', text: 'Einzahlungen von Volksbank Köln Bonn sind die Summe der Barzahlungen von Kunden (Bargeld aus der Kasse aufs Konto).', quelle: 'bank', richtung: 'ein', suche: ['volksbank koeln bonn'], oder: ['bareinzahlung', 'einzahlung'], aktion: 'umbuchung' },
  { id: 'bargeld-konto', text: 'Im Kassenbuch ist „Bargeld auf Konto“ die Gegenbuchung zur Bareinzahlung.', quelle: 'kasse', richtung: 'aus', suche: [], oder: ['bargeld auf konto', 'bargeld aufs konto', 'auf konto eingezahlt', 'bank eingezahlt', 'einzahlung bank'], aktion: 'umbuchung' },
];
const regeln = () => Array.isArray(S.einstellungen.regeln) ? S.einstellungen.regeln : REGELN_START;
async function regelnSpeichern(l) { await DB.setSetting('regeln', l); }

const regelText = (q, x) => norm(q === 'bank' ? (x.gegenpartei || '') + ' ' + (x.zweck || '') + ' ' + (x.iban || '') : q === 'kasse' ? (x.text || '') + ' ' + (x.belegnr || '') : (x.beschreibung || ''));
function regelPasst(g, q, x) {
  if (g.quelle !== q) return false;
  if (g.richtung === 'ein' && !(x.betrag > 0)) return false;
  if (g.richtung === 'aus' && !(x.betrag < 0)) return false;
  const t = regelText(q, x), alle = (g.suche || []).map(norm).filter(Boolean), eins = (g.oder || []).map(norm).filter(Boolean);
  if (!alle.length && !eins.length) return false;
  return alle.every(w => t.includes(w)) && (!eins.length || eins.some(w => t.includes(w)) || (alle.length && !g.oderPflicht));
}
// Welche Einträge trifft eine Regel? (für Vorschau und Zähler)
function regelTreffer(g) { const l = g.quelle === 'bank' ? S.bank : g.quelle === 'kasse' ? S.kasse : S.sumup; return l.filter(x => regelPasst(g, g.quelle, x)); }

// Regeln anwenden: nur auf Einträge ohne Zuordnung, die noch nicht von Hand eingeordnet sind
async function regelnAnwenden() {
  buildIdx(); const jobs = []; let n = 0;
  for (const g of regeln()) {
    for (const x of regelTreffer(g)) {
      if (g.quelle === 'bank') {
        if ((IDX.zByB.get(x.id) || []).length || (x.art && x.art !== 'intern' && x.art !== 'privat' && x.art !== 'ignoriert')) continue;
        const art = g.aktion === 'umbuchung' ? 'intern' : g.aktion === 'privat' ? 'privat' : g.aktion === 'ignorieren' ? 'ignoriert' : null;
        const p = {}; if (art && x.art !== art) p.art = art; if (g.aktion === 'kostenart' && g.kostenart && x.kostenart !== g.kostenart) p.kostenart = g.kostenart;
        if (Object.keys(p).length) { jobs.push(() => DB.update('bank', x.id, p)); n++; }
      } else if (g.quelle === 'kasse') {
        if ((IDX.zByK.get(x.id) || []).length) continue;
        const ka = g.aktion === 'kostenart' ? g.kostenart : g.aktion === 'umbuchung' ? 'Umbuchung Kasse/Bank' : g.aktion === 'privat' ? 'Privat' : 'Ignoriert';
        if (ka && x.kostenart !== ka) { jobs.push(() => DB.update('kasse', x.id, { kostenart: ka })); n++; }
      } else if (g.quelle === 'sumup' && (g.aktion === 'ignorieren' || g.aktion === 'privat')) {
        if ((IDX.zByS.get(x.id) || []).length || /ignor/i.test(x.status || '')) continue;
        jobs.push(() => DB.update('sumup', x.id, { status: 'Ignoriert (Regel)' })); n++;
      }
    }
  }
  for (let i = 0; i < jobs.length; i += 10) await Promise.all(jobs.slice(i, i + 10).map(f => f()));
  return n;
}

// Freitext → Regel (KI); ohne KI: einfache Erkennung der Stichworte
async function regelAusText(text) {
  if (DB.aiOn) {
    const j = await DB.aiJson(`Ein Mitarbeiter der Kfz-Werkstatt Mastercar Bornheim beschreibt in eigenen Worten, wie bestimmte Zahlungen im Finanz-Abgleich zu behandeln sind:
"""${text}"""
Mach daraus GENAU EINE Regel als JSON:
{"quelle":"bank|kasse|sumup","richtung":"ein|aus|beide","suche":["Begriffe, die ALLE im Namen/Verwendungszweck/Text vorkommen müssen, kleingeschrieben"],"oder":["alternative Begriffe, von denen einer reicht (optional)"],"aktion":"umbuchung|privat|ignorieren|kostenart","kostenart":"nur bei aktion=kostenart, eine aus: ${KOSTENARTEN.join(', ')}","kurz":"die Regel in einem kurzen Satz"}
Hinweise: Bareinzahlungen/Einzahlungen von Bargeld aufs Konto und „Bargeld auf Konto“ in der Kasse sind aktion=umbuchung. Abbuchungen ohne Rechnung, die feste Kosten sind (Kontoführung, Gebühren, Versicherung …), sind aktion=kostenart.`, { tier: 'quick' });
    return { quelle: REGEL_QUELLE[j.quelle] ? j.quelle : 'bank', richtung: REGEL_RICHTUNG[j.richtung] ? j.richtung : 'beide', suche: (j.suche || []).map(String), oder: (j.oder || []).map(String), aktion: REGEL_AKTION[j.aktion] ? j.aktion : 'ignorieren', kostenart: KOSTENARTEN.includes(j.kostenart) ? j.kostenart : null, kurz: j.kurz || '' };
  }
  const t = norm(text);
  return { quelle: /kasse|kassenbuch/.test(t) ? 'kasse' : /sumup|ec-/.test(t) ? 'sumup' : 'bank', richtung: /einzahl|eingang|gutschrift/.test(t) ? 'ein' : /abbuch|ausgang|lastschrift/.test(t) ? 'aus' : 'beide',
    suche: [], oder: [], aktion: /einzahl|bargeld|umbuch/.test(t) ? 'umbuchung' : /privat/.test(t) ? 'privat' : 'ignorieren', kostenart: null, kurz: '' };
}

/* ---------- Oberfläche (Rubrik auf der Problemseite) ---------- */
function regelnHtml() {
  const l = regeln();
  return `<p class="small muted">Schreib einfach in eigenen Worten, was die App wissen soll. Die Regel gilt dann bei jedem Abgleich – für alle im Team.</p>
    <div class="rg-neu"><textarea class="inp" id="rgText" rows="2" placeholder="z. B. „Einzahlungen von Volksbank Köln Bonn sind die Summe der Barzahlungen von Kunden“ oder „Abbuchungen von der Allianz sind Kfz-Versicherung“"></textarea>
      <button class="btn primary" data-act="regelNeu">＋ Als Regel übernehmen</button></div>
    ${l.length ? `<div class="tw"><table class="tb"><thead><tr><th>Regel</th><th>Wo</th><th>Erkennen an</th><th>Dann</th><th class="num">Treffer</th><th></th></tr></thead><tbody>
      ${l.map((g, i) => `<tr><td>${esc(g.kurz || g.text || '')}</td><td class="small">${REGEL_QUELLE[g.quelle]} · ${REGEL_RICHTUNG[g.richtung] || ''}</td>
        <td class="small">${[...(g.suche || []).map(s => '„' + esc(s) + '“'), (g.oder || []).length ? 'eins von: ' + g.oder.map(s => '„' + esc(s) + '“').join(', ') : ''].filter(Boolean).join(' + ')}</td>
        <td class="small">${esc(REGEL_AKTION[g.aktion] || g.aktion)}${g.kostenart ? ': ' + esc(g.kostenart) : ''}</td><td class="num">${regelTreffer(g).length}</td>
        <td><button class="btn sm" data-act="regelEdit" data-i="${i}">Ändern</button> <button class="icon-btn" data-act="regelDel" data-i="${i}" aria-label="Regel löschen">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Noch keine Regeln.</p>'}`;
}

function regelForm(g, i) {
  const opt = (o, v) => Object.entries(o).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const d = openSheet({
    title: i == null ? 'Neue Regel prüfen' : 'Regel ändern', okLabel: 'Regel speichern', html: `
    ${g.text ? `<p class="note small">„${esc(g.text)}“</p>` : ''}
    <form class="form2">
      <label class="fld full"><span>Kurzbeschreibung</span><input class="inp" name="kurz" value="${esc(g.kurz || g.text || '')}"></label>
      <label class="fld"><span>Wo</span><select class="inp" name="quelle">${opt(REGEL_QUELLE, g.quelle)}</select></label>
      <label class="fld"><span>Richtung</span><select class="inp" name="richtung">${opt(REGEL_RICHTUNG, g.richtung)}</select></label>
      <label class="fld full"><span>Muss ALLES enthalten (Komma getrennt)</span><input class="inp" name="suche" value="${esc((g.suche || []).join(', '))}" placeholder="z. B. volksbank köln bonn"></label>
      <label class="fld full"><span>…oder EINES davon (Komma getrennt, optional)</span><input class="inp" name="oder" value="${esc((g.oder || []).join(', '))}" placeholder="z. B. bareinzahlung, einzahlung"></label>
      <label class="fld"><span>Dann</span><select class="inp" name="aktion">${opt(REGEL_AKTION, g.aktion)}</select></label>
      <label class="fld"><span>Kostenart (bei „Kosten“)</span><select class="inp" name="kostenart"><option value="">–</option>${KOSTENARTEN.map(k => `<option ${g.kostenart === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
    </form>
    <div id="rgVor" class="small"></div>`,
    onOk: async dd => {
      const neu = rgAusForm(dd, g); if (!(neu.suche.length || neu.oder.length)) { toast('Bitte mindestens einen Suchbegriff eintragen.'); return false; }
      const l = regeln().slice(); if (i == null) l.push(neu); else l[i] = neu;
      await regelnSpeichern(l); const n = await regelnAnwenden(); await autoAbgleich().catch(() => { });
      toast(`Regel gespeichert – ${n} Eintr${n === 1 ? 'ag' : 'äge'} eingeordnet.`); render();
    }
  });
  const vor = () => { const x = rgAusForm(d, g), t = regelTreffer(x);
    $('#rgVor', d).innerHTML = `<b>${t.length}</b> Treffer${t.length ? ':' : ''}<ul class="pays">${t.slice(0, 8).map(y => `<li><span>${fmtD(y.datum)} · ${esc(y.gegenpartei || y.text || y.beschreibung || '')} <small class="muted">${esc((y.zweck || '').slice(0, 80))}</small></span><b>${fmtE(y.betrag)}</b></li>`).join('')}</ul>${t.length > 8 ? `<p class="muted">… und ${t.length - 8} weitere</p>` : ''}`; };
  d.addEventListener('input', vor); d.addEventListener('change', vor); vor();
}
/* ---------- Kostenarten je Firma (Einstellungen) ----------
   Je Kostenart die Firmen, deren Eingangsrechnungen und Abbuchungen ohne Beleg aktuell darunter laufen.
   Eine Änderung stellt alle Belege der Firma um und gilt fest auch für neue Belege (einstellungen.firma_kostenart). */
/* Rückzahlung an einen Werkstatt-Kunden (doppelt bezahlt, Erstattung …) ist kein Lieferant und keine Kostenart */
const RUECKZ_RX = /doppelt|erstatt|r(ü|ue)ck(zahl|überw|ueberw)|zur(ü|ue)ck|gutschrift|storno|\bR\d{2}-?\d{3,5}\b/i;
function kundenNurKeys() { const k = new Set(), l = new Set(); S.rechnungen.forEach(r => { const x = firmaKey(r.partner); if (x) (r.richtung === 'ausgang' ? k : l).add(x); }); return new Set([...k].filter(x => !l.has(x))); }
const istKundenRueckzahlung = (b, K) => K.has(firmaKey(b.gegenpartei)) && RUECKZ_RX.test(String(b.zweck || '').replace(/^.*SVWZ\+/, ''));
function firmenKa() {
  const F = new Map(), m = firmaKaMap(), K = kundenNurKeys();
  const add = (name, ka, betrag, typ) => {
    const key = firmaKey(name); if (!key) return;
    let f = F.get(key); if (!f) F.set(key, f = { key, namen: {}, ka: {}, n: 0, nR: 0, nB: 0, summe: 0 });
    f.namen[name] = (f.namen[name] || 0) + 1; f.ka[ka || ''] = (f.ka[ka || ''] || 0) + 1; f.n++; if (typ === 'r') f.nR++; else f.nB++; f.summe += Math.abs(+betrag || 0);
  };
  S.rechnungen.forEach(r => { if (r.richtung === 'eingang' && !DOK_ARTEN.includes(r.art)) add(r.partner, r.kostenart, r.brutto, 'r'); });
  S.bank.forEach(b => { if (b.betrag < 0 && !b.art && !(IDX.zByB.get(b.id) || []).length && !istKundenRueckzahlung(b, K)) add(b.gegenpartei, b.kostenart, b.betrag, 'b'); });
  Object.entries(m).forEach(([key, v]) => { if (!F.has(key)) F.set(key, { key, namen: { [(v && v.name) || key]: 1 }, ka: {}, n: 0, nR: 0, nB: 0, summe: 0 }); });
  return [...F.values()].map(f => {
    const name = Object.entries(f.namen).sort((a, b) => b[1] - a[1])[0][0], fest = m[f.key] && m[f.key].k;
    const haupt = fest || (Object.entries(f.ka).filter(([k]) => k).sort((a, b) => b[1] - a[1])[0] || [''])[0];
    const andere = Object.entries(f.ka).filter(([k]) => k !== haupt);
    if (FA_RX.test(name)) return { ...f, name, fest: false, haupt: '§FA', andere: [], summe: r2(f.summe) };   /* Steuern: eigene Gruppe, keine Kostenart */
    return { ...f, name, fest: !!fest, haupt, andere, summe: r2(f.summe) };
  });
}
// Belege einer Firma (gleicher Schlüssel wie in der Übersicht)
function firmaBelege(key) {
  const K = kundenNurKeys();
  return { r: S.rechnungen.filter(r => r.richtung === 'eingang' && !DOK_ARTEN.includes(r.art) && firmaKey(r.partner) === key),
    b: S.bank.filter(b => b.betrag < 0 && !b.art && !(IDX.zByB.get(b.id) || []).length && firmaKey(b.gegenpartei) === key && !istKundenRueckzahlung(b, K)) };
}
async function firmaKaSetzen(key, name, ka) {
  buildIdx(); const { r, b } = firmaBelege(key), m = { ...firmaKaMap() };
  const rU = r.filter(x => (x.kostenart || null) !== (ka || null)), bU = b.filter(x => (x.kostenart || null) !== (ka || null));
  if ((rU.length || bU.length) && !confirm(`${name}: ${ka ? '„' + ka + '“' : 'keine Kostenart'}\n\n${rU.length} Rechnung(en) und ${bU.length} Abbuchung(en) ohne Beleg werden umgestellt.${ka ? '\nNeue Belege dieser Firma bekommen die Kostenart automatisch.' : ''}`)) { render(); return; }
  busy(true, 'Umstellen …');
  try {
    const jobs = [...rU.map(x => () => DB.update('rechnungen', x.id, { kostenart: ka || null, unterkonto: ka && UNTERKONTEN(ka).includes(x.unterkonto) ? x.unterkonto : null })),
      ...bU.map(x => () => DB.update('bank', x.id, { kostenart: ka || null }))];
    for (let i = 0; i < jobs.length; i += 10) await Promise.all(jobs.slice(i, i + 10).map(f => f()));
    if (ka) m[key] = { k: ka, name }; else delete m[key];
    await DB.setSetting('firma_kostenart', m);
  } finally { busy(false); }
  buildIdx(); render(); toast(`${name}: ${ka || 'keine Kostenart'} – ${rU.length + bU.length} Beleg(e) umgestellt.`);
}
// Fenster: alle Posten einer Firma (Klick auf eine Zeile öffnet Rechnung bzw. Bankumsatz)
function firmaPosten(key) {
  buildIdx(); const f = firmenKa().find(x => x.key === key), { r, b } = firmaBelege(key), name = f ? f.name : key;
  const l = [...r.map(x => ({ t: 'r', d: x.datum || '', x })), ...b.map(x => ({ t: 'b', d: x.datum || '', x }))].sort((a, c) => c.d.localeCompare(a.d));
  const zeile = ({ t, x }) => t === 'r'
    ? `<tr data-act="rechnung" data-id="${x.id}"><td>${fmtD(x.datum)}</td><td>Rechnung ${esc(x.nummer || '')}<div class="small muted">${esc((x.beschreibung || '').slice(0, 70))}</div></td><td class="small">${esc(x.kostenart || '–')}${x.unterkonto ? ' · ' + esc(x.unterkonto) : ''}</td><td class="num">${fmtE(x.brutto)}</td><td>${badge(rStatus(x))}</td></tr>`
    : `<tr data-act="bank" data-id="${x.id}"><td>${fmtD(x.datum)}</td><td>Bank ohne Beleg<div class="small muted">${esc(String(x.zweck || '').replace(/^.*SVWZ\+/, '').slice(0, 70))}</div></td><td class="small">${esc(x.kostenart || '–')}</td><td class="num">${fmtE(x.betrag)}</td><td>${badge(bStatus(x))}</td></tr>`;
  openSheet({ title: name, wide: true, noOk: true, html: `
    <p class="small muted">${r.length} Rechnung${r.length === 1 ? '' : 'en'} · ${b.length} Abbuchung${b.length === 1 ? '' : 'en'} ohne Beleg · zusammen ${fmtE(r2(sum(r, x => Math.abs(+x.brutto || 0)) + sum(b, x => Math.abs(x.betrag))))} brutto${f && f.fest ? ' · fest zugeordnet: <b>' + esc(f.haupt) + '</b>' : ''}. Klick auf eine Zeile öffnet den Posten.</p>
    ${l.length ? `<div class="tw"><table class="tb click"><thead><tr><th>Datum</th><th>Posten</th><th>Kostenart</th><th class="num">Betrag</th><th>Status</th></tr></thead><tbody>${l.map(zeile).join('')}</tbody></table></div>` : '<div class="empty small">Noch keine Posten – die Zuordnung gilt für künftige Belege.</div>'}` });
}
function firmenKaHtml() {
  buildIdx();
  const q = norm(UI.q.fk || ''), alle = firmenKa(), l = alle.filter(f => !q || norm(f.name).includes(q) || norm(f.haupt).includes(q));
  const opt = v => KOSTENARTEN.map(k => `<option ${k === v ? 'selected' : ''}>${esc(k)}</option>`).join('');
  const gruppen = KOSTENARTEN.concat(['', '§FA']).map(k => [k, l.filter(f => f.haupt === k).sort((a, b) => b.summe - a.summe)]).filter(([, x]) => x.length);
  const nameZ = f => `<button type="button" class="lnk" data-act="firmaPosten" data-k="${esc(f.key)}" title="Posten dieser Firma anzeigen">${esc(f.name)}</button>`;
  const zeile = f => f.haupt === '§FA' ? `<tr><td>${nameZ(f)}</td><td class="num small">${[f.nR ? f.nR + ' Rechn.' : '', f.nB ? f.nB + ' Bank' : ''].filter(Boolean).join(' · ')}</td><td class="num">${fmtE(f.summe)}</td>
      <td class="small muted">keine Kostenart – USt läuft durch, Lohnsteuer zählt als Personalkosten</td></tr>` : `<tr><td>${nameZ(f)}${f.fest ? ' <span class="badge st-ok" title="Fest zugeordnet – gilt auch für neue Belege">fest</span>' : ''}
      ${f.andere.length ? `<div class="small muted">teils anders: ${f.andere.map(([k, n]) => n + '× ' + esc(k || 'ohne')).join(', ')}</div>` : ''}</td>
      <td class="num small">${[f.nR ? f.nR + ' Rechn.' : '', f.nB ? f.nB + ' Bank' : ''].filter(Boolean).join(' · ') || '<span class="muted">noch keine</span>'}</td><td class="num">${fmtE(f.summe)}</td>
      <td><select class="inp" data-chg="firmaKa" data-k="${esc(f.key)}" data-n="${esc(f.name)}" aria-label="Kostenart für ${esc(f.name)}"><option value="">– keine –</option>${opt(f.haupt)}</select></td></tr>`;
  return `
  <section class="card"><h3>Neue Zuordnung</h3>
    <p class="small muted">Firma eintippen und Kostenart wählen. Alle vorhandenen Rechnungen und Abbuchungen ohne Beleg dieser Firma werden umgestellt, neue Belege bekommen die Kostenart automatisch.</p>
    <div class="btnrow"><input class="inp" id="fkName" list="fkListe" placeholder="Firma, z. B. Stahlgruber" style="min-width:240px"><datalist id="fkListe">${alle.map(f => `<option value="${esc(f.name)}">`).join('')}</datalist>
      <select class="inp" id="fkKa"><option value="">Kostenart wählen …</option>${opt('')}</select><button class="btn primary" data-act="firmaKaNeu">Zuordnen</button></div>
  </section>
  <div class="toolbar">${searchIn('fk', 'Firma oder Kostenart suchen …')}<span class="sp"></span><span class="small muted">${alle.length} Firmen</span></div>
  ${gruppen.map(([k, x]) => `<details class="card" data-auf="fk:${esc(k)}" ${q || (UI.auf || {})['fk:' + k] ? 'open' : ''}><summary><b>${esc(k === '§FA' ? 'Steuern ans Finanzamt' : k || 'Ohne Kostenart')}</b> · ${x.length} ${x.length === 1 ? 'Firma' : 'Firmen'} · ${fmtE(r2(sum(x, f => f.summe)))}</summary>
    <div class="tw"><table class="tb"><thead><tr><th>Firma</th><th class="num">Belege</th><th class="num">Summe brutto</th><th>Kostenart</th></tr></thead><tbody>${x.map(zeile).join('')}</tbody></table></div></details>`).join('') || '<div class="empty small">Keine Firma gefunden.</div>'}`;
}
function rgAusForm(d, g) {
  const fd = Object.fromEntries(new FormData($('form', d))), sp = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  return { id: g.id || uid(), text: g.text || fd.kurz, kurz: fd.kurz, quelle: fd.quelle, richtung: fd.richtung, suche: sp(fd.suche), oder: sp(fd.oder), aktion: fd.aktion, kostenart: fd.kostenart || null };
}
