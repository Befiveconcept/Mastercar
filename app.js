/* Mastercar Finanzen · App-Rahmen: Anmeldung, Navigation, Aktionen */
const A = {};
const START_HASH = location.hash;   // vor der Supabase-Anmeldung merken (die Bibliothek leert die Adresse beim Einlösen des Links)
const VIEWS = { start: viewStart, todos: viewTodos, ausgang: () => viewRechnungen('ausgang'), eingang: () => viewRechnungen('eingang'), bank: viewBank, sumup: viewSumup, kasse: viewKasse, hebe: viewHebe, guv: viewGuv, abgleich: viewAbgleich, einst: viewEinst };
let OMNI = null;   // die Suchleiste bleibt dasselbe Element und wird bei jedem Neuzeichnen unter die Überschrift gesetzt

function shell() {
  document.body.innerHTML = `
  <div class="app">
    <aside class="side"><div class="brand"><span class="logo">MASTERCAR</span><span class="sub">Bornheim · Finanzen</span></div>
      <nav id="nav"></nav>
      <div class="side-foot small">VE Sportmanagement UG<br>(haftungsbeschränkt)<br><span class="${DB.cloud ? 'on' : ''}">${DB.cloud ? '● online' : '○ Demo-Modus'}</span></div></aside>
    <div class="mainwrap"><main id="main" tabindex="-1"></main></div>
  </div>
  <div id="omniPark" hidden>${omniHtml()}</div>
  <input type="file" id="anyIn" multiple hidden accept=".xlsx,.xlsm,.xlsb,.xls,.csv,.txt,.pdf,.png,.jpg,.jpeg,.webp,.heic,.eml,.msg">
  <input type="file" id="tblIn" hidden accept=".xlsx,.xlsm,.xlsb,.xls,.csv,.txt">
  <input type="file" id="belegIn" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.eml,.msg">
  <div class="dropveil" id="veil"><div>Loslassen zum Übernehmen<small>Excel, SumUp, Bank-CSV, Rechnungen (PDF/Foto/Mail)</small></div></div>`;
  if (DB.aiOn) { const b = document.createElement('button'); b.id = 'aicFab'; b.className = 'fab'; b.title = 'KI-Assistent'; b.textContent = '✨'; b.onclick = () => aicShow(true); document.body.appendChild(b); }
  OMNI = $('#omni'); omniWire();
  $('#anyIn').onchange = e => { eingangDrop(e.target.files); e.target.value = ''; };
  $('#tblIn').onchange = e => { const f = e.target.files[0]; if (f) importFile(e.target.dataset.t, f); e.target.value = ''; };
  $('#belegIn').onchange = e => { eingangDrop(e.target.files); e.target.value = ''; };
}
function render() {
  buildIdx();
  const probs = S.rechnungen.filter(r => ['ueber', 'doppelt', 'teil'].includes(rStatus(r).key)).length, tdf = todoFaelligAnz();
  const nb = { abgleich: probs, todos: tdf };
  $('#nav').innerHTML = NAV.map(([k, l, ic]) => `<button class="nav ${UI.view === k ? 'on' : ''}" data-act="go" data-v="${k}"><span class="ni">${ic}</span>${l}${nb[k] ? `<span class="nb">${nb[k]}</span>` : ''}</button>`).join('');
  const main = $('#main'), y = window.scrollY, active = document.activeElement, qv = active && active.dataset && active.dataset.q, pos = qv ? active.selectionStart : 0;
  const omniFocus = active && active.id === 'oq';
  if (OMNI) OMNI.remove();   // Leiste vor dem Neuzeichnen herausnehmen (behält Text und Ereignisse)
  main.innerHTML = (VIEWS[UI.view] || viewStart)();
  if (OMNI) {   // Startseite: eigener Platz unter der Begrüßung · sonst direkt unter der Überschriftszeile
    const slot = $('#omniSlot', main), tb = $('.toolbar', main);
    if (slot) slot.replaceWith(OMNI); else if (tb) tb.after(OMNI); else main.prepend(OMNI);
    if (omniFocus) $('#oq').focus();
  }
  if (qv) { const i = $(`[data-q="${qv}"]`); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
  window.scrollTo(0, y);
}

/* ---------- Aktionen (data-act) ---------- */
Object.assign(A, {
  go: d => { UI.view = d.v; if (d.f) UI.filt[d.v] = d.f; render(); window.scrollTo(0, 0); $('#main').focus({ preventScroll: true }); },
  filt: d => { UI.filt[d.v] = d.f; UI.more[d.v] = 0; render(); },
  ablageWahl: async () => { await ablageWaehlen(); render(); },
  ablageAlle: () => ablageAlle(),
  ablageAus: async () => { await ablageAus(); render(); toast('Ordner-Ablage ausgeschaltet.'); },
  more: d => { UI.more[d.v] = (UI.more[d.v] || 300) + 300; render(); },
  // Spaltenkopf: aufsteigend → absteigend → wieder Standard-Sortierung
  colSort: d => { const st = UI.cs[d.v] = UI.cs[d.v] || {}; if (st.k !== d.k) { st.k = d.k; st.d = 'asc'; } else if (st.d === 'asc') st.d = 'desc'; else { st.k = null; st.d = null; } render(); },
  colReset: d => { UI.cs[d.v] = {}; Object.keys(UI.q).forEach(k => { if (k.startsWith(d.v + '|')) delete UI.q[k]; }); UI.more[d.v] = 0; render(); },
  rechnung: d => rechnungDetail(d.id), bank: d => bankDetail(d.id), sumup: d => sumupDetail(d.id), kasseD: d => kasseDetail(d.id),
  todo: d => { const t = S.todos.find(x => x.id === d.id); if (t) todoForm(t); }, todoNeu: () => todoForm(null), todoHaken: d => todoHaken(d.id),
  kasseNeu: d => kasseForm(null, d.a),
  hebeNeu: d => hebeForm(null, { datum: d.d || todayISO(), mitarbeiter: d.ma || '' }), hebeE: d => { const h = S.hebebuehne.find(x => x.id === d.id); if (h) hebeForm(h); },
  hebeKW: d => { const [y, w] = (UI.hebeKW || kwKey(todayISO())).split('-').map(Number); UI.hebeKW = +d.d === 0 ? kwKey(todayISO()) : kwKey(addDays(isoWeekMonday(y, w), 7 * +d.d)); render(); },
  hebeGo: d => { UI.hebeKW = d.k; render(); window.scrollTo(0, 0); },
  guvZelle: d => guvZelle(d.k, +d.m, !!d.nur), guvCsv: () => guvCsv(),
  pick: d => { const i = $('#tblIn'); i.dataset.t = d.t; i.click(); },
  pickBeleg: () => $('#belegIn').click(),
  neuR: d => rechnungForm(d.dir),
  auto: async () => { busy(true, 'Gleiche ab …'); try { const r = await autoAbgleich(); toast(r.n || r.links ? `${r.n} Zahlung(en) zugeordnet${r.links ? ', ' + r.links + ' SumUp-Auszahlungen verknüpft' : ''}.` : 'Nichts Neues eindeutig zuzuordnen.'); } catch (e) { toast('Fehler: ' + e.message); } busy(false); render(); },
  csv: d => exportCsv(d.v),
  undoImp: async d => {
    const imp = S.importe.find(i => i.id === d.id); if (!imp) return;
    const t = imp.art === 'ausgang' || imp.art === 'eingang' ? 'rechnungen' : imp.art, ids = S[t].filter(r => r.import_id === imp.id).map(r => r.id);
    if (!confirm(`Import „${imp.datei}“ rückgängig machen? ${ids.length} Einträge und ihre Zuordnungen werden gelöscht.`)) return;
    busy(true, 'Lösche …'); try { await DB.remove(t, ids); await DB.remove('importe', imp.id); toast('Import rückgängig gemacht.'); } catch (e) { toast('Fehler: ' + e.message); } busy(false); render();
  },
  logout: () => DB.signOut(),
  pw: () => openSheet({ title: 'Passwort ändern', html: '<label class="fld"><span>Neues Passwort (mind. 8 Zeichen)</span><input class="inp" type="password" id="npw" autocomplete="new-password"></label>', onOk: async d => { const p = $('#npw', d).value; if (p.length < 8) { toast('Mindestens 8 Zeichen.'); return false; } await DB.setPw(p); toast('Passwort geändert.'); } }),
  demo: async () => { busy(true, 'Lege Demo-Daten an …'); await demoDaten(); busy(false); UI.period = 'alle'; render(); toast('Demo-Daten geladen – schau dir „Abgleich & Probleme“ an.'); },
  resetDemo: () => { if (confirm('Alle Demo-Daten in diesem Browser löschen?')) { DB.resetLocal(); render(); } },
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (e.target.closest('select, input, textarea') && el.tagName === 'TR') return;   // Auswahlfeld in der Zeile (z. B. Status) öffnet nicht die Rechnung
  // In Fenstern nur Zeilen-Klicks (Rechnung/Bank/SumUp öffnen) global behandeln
  if (el.closest('#sheet') && !['rechnung', 'bank', 'sumup', 'kasseD'].includes(el.dataset.act)) return;
  const f = A[el.dataset.act]; if (f) { e.preventDefault(); f({ ...el.dataset }); }
});
document.addEventListener('change', e => {
  const c = e.target.dataset && e.target.dataset.chg; if (!c) return;
  if (c === 'period') { UI.period = e.target.value; render(); }
  if (c === 'colF') { const d = e.target.dataset, st = UI.cs[d.v] = UI.cs[d.v] || {}; st.f = st.f || {}; st.f[d.k] = e.target.value; UI.more[d.v] = 0; render(); }
  if (c === 'ziel') { DB.setSetting('zahlungsziel', Math.max(0, +e.target.value || 0)).then(render); }
  if (c === 'rstatus') {
    const r = S.rechnungen.find(x => x.id === e.target.dataset.id); if (!r) return;
    const v = e.target.value;
    // „storniert“ schließt die Rechnung; wer von „storniert“ zurückstellt, öffnet sie wieder
    DB.update('rechnungen', r.id, { status_excel: v, erledigt: istStornoLaut(v) ? true : istStornoLaut(r.status_excel) ? false : r.erledigt })
      .then(() => { render(); if ($('#sheet') && e.target.closest('#sheet')) rechnungDetail(r.id); toast('Status: ' + v); }).catch(err => toast('Fehler: ' + err.message));
  }
  if (c === 'guvJahr') { UI.guvJahr = e.target.value; render(); }
  if (c === 'guvOhne') { UI.guvOhne = e.target.checked; render(); }
  if (c === 'todoWer') { UI.todoWer = e.target.value; render(); }
  if (c === 'hebeMa') { UI.hebeMa = e.target.value; render(); }
  if (c === 'stundensatz') { DB.setSetting('stundensatz', Math.max(0, parseNum(e.target.value) || 0)).then(render); }
  if (c === 'kasseAnfang') { DB.setSetting('kasse_anfang', parseNum(e.target.value) || 0).then(render); }
});
let qT; document.addEventListener('input', e => { const v = e.target.dataset && e.target.dataset.q; if (!v) return; UI.q[v] = e.target.value; UI.more[v.split('|')[0]] = 0; clearTimeout(qT); qT = setTimeout(render, 200); });

// Dateien irgendwo ins Fenster ziehen
let dragN = 0;
document.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragN++; $('#veil')?.classList.add('on'); } });
document.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#veil')?.classList.remove('on'); } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#veil')?.classList.remove('on'); if (e.dataTransfer.files.length && S.user) eingangDrop(e.dataTransfer.files); });

/* ---------- CSV-Export (für Steuerberater / Excel) ---------- */
function exportCsv(v) {
  buildIdx(); let rows, name;
  if (v === 'ausgang' || v === 'eingang') {
    rows = [['Richtung', 'Rechnungsnr', 'Datum', 'Fällig', v === 'ausgang' ? 'Kunde' : 'Lieferant', 'Kennzeichen', 'Kostenart', 'Netto', 'MwSt', 'Brutto', 'Bezahlt', 'Offen', 'Zahlart', 'Status', 'Beschreibung', 'Notiz']];
    S.rechnungen.filter(r => r.richtung === v).sort((a, b) => (a.datum || '').localeCompare(b.datum || '')).forEach(r => { const st = rStatus(r); rows.push([v, r.nummer, fmtD(r.datum), fmtD(faelligAm(r)), r.partner, r.kennzeichen, r.kostenart, numDE(r.netto), numDE(r.mwst), numDE(r.brutto), numDE(st.bezahlt), numDE(st.offen), ZA[r.zahlart] || '', st.label, r.beschreibung, r.notiz]); });
    name = `Mastercar_${v}_${todayISO()}.csv`;
  } else if (v === 'bank') {
    rows = [['Datum', 'Betrag', 'Name', 'IBAN', 'Verwendungszweck', 'Kostenart', 'Status', 'Rechnungen']];
    [...S.bank].sort((a, b) => a.datum.localeCompare(b.datum)).forEach(b => { const st = bStatus(b); rows.push([fmtD(b.datum), numDE(b.betrag), b.gegenpartei, b.iban, b.zweck, b.kostenart, st.label, st.zuordnungen.map(z => S.rechnungen.find(r => r.id === z.rechnung_id)?.nummer).filter(Boolean).join(', ')]); });
    name = `Mastercar_Bank_${todayISO()}.csv`;
  } else if (v === 'kasse') {
    const B = kasseBestand();
    rows = [['Datum', 'Beleg-Nr.', 'Text', 'Einnahme', 'Ausgabe', 'Bestand', 'Kostenart', 'Rechnung'], ['', '', 'Anfangsbestand', '', '', numDE(kasseAnfang()), '', '']];
    [...S.kasse].sort(kasseSort).forEach(k => rows.push([fmtD(k.datum), k.belegnr, k.text, k.betrag > 0 ? numDE(k.betrag) : '', k.betrag < 0 ? numDE(-k.betrag) : '', numDE(B.map.get(k.id)), k.kostenart, kStatus(k).zuordnungen.map(z => S.rechnungen.find(r => r.id === z.rechnung_id)?.nummer).filter(Boolean).join(', ')]));
    name = `Mastercar_Kassenbuch_${todayISO()}.csv`;
  } else {
    rows = [['Datum', 'Betrag', 'Gebühr', 'Beschreibung', 'Karte', 'Transaktion', 'Status', 'Rechnung']];
    [...S.sumup].sort((a, b) => a.datum.localeCompare(b.datum)).forEach(s => { const st = sStatus(s); rows.push([fmtD(s.datum), numDE(s.betrag), numDE(s.gebuehr), s.beschreibung, s.zahlungsart, s.transaktion, st.label, st.zuordnungen.map(z => S.rechnungen.find(r => r.id === z.rechnung_id)?.nummer).filter(Boolean).join(', ')]); });
    name = `Mastercar_SumUp_${todayISO()}.csv`;
  }
  download(name, rows.map(csvRow).join('\r\n'));
}

/* ---------- Anmeldung ---------- */
function loginScreen(msg = '') {
  document.body.innerHTML = `<div class="login"><form class="login-card" id="lf">
    <div class="brand big"><span class="logo">MASTERCAR</span><span class="sub">Bornheim · Finanzen</span></div>
    ${msg ? `<div class="warn">${esc(msg)}</div>` : ''}
    <label class="fld"><span>E-Mail</span><input class="inp" type="email" id="le" autocomplete="username" required></label>
    <label class="fld"><span>Passwort</span><input class="inp" type="password" id="lp" autocomplete="current-password" required></label>
    <button class="btn primary">Anmelden</button>
    <button type="button" class="lnk" id="lfg">Passwort vergessen?</button>
    <p class="small muted">VE Sportmanagement UG (haftungsbeschränkt)</p></form></div>`;
  $('#lf').onsubmit = async e => { e.preventDefault(); const b = $('#lf .btn'); b.disabled = true; try { await DB.signIn($('#le').value.trim(), $('#lp').value); start(); } catch (err) { loginScreen(err.message); } };
  $('#lfg').onclick = async () => { const em = $('#le').value.trim(); if (!em) return toast('Bitte erst die E-Mail eintragen.'); try { await DB.resetPw(em); toast('Link zum Zurücksetzen wurde gesendet.'); } catch (e) { toast(e.message); } };
}
async function start() {
  try {
    const u = S.user || await DB.init();
    if (!u) return loginScreen();
    if (!(await DB.isStaff())) return loginScreen('Diese E-Mail ist noch nicht freigeschaltet. Bitte in Supabase in der Tabelle „team“ eintragen.');
    busy(true, 'Lade Daten …'); await DB.loadAll(); busy(false);
    shell(); render();
    if (S._fehlt) setTimeout(() => toast('Bitte in Supabase noch „02_erweiterung.sql“ ausführen – sonst fehlen Kassenbuch, To-Dos und Hebebühne.', 9000), 600);
    // Einladungs- oder Passwort-vergessen-Link: gleich ein eigenes Passwort setzen lassen
    if (DB.cloud && /type=(recovery|invite|signup|magiclink)/.test(START_HASH)) { A.pw(); history.replaceState(null, '', location.pathname); }
  } catch (e) { busy(false); console.error(e); document.body.innerHTML = `<div class="login"><div class="login-card"><h2>Verbindung fehlgeschlagen</h2><p>${esc(e.message || e)}</p><p class="small muted">Prüfe in config.js die Supabase-Adresse und ob 01_einrichtung.sql ausgeführt wurde.</p><button class="btn primary" onclick="location.reload()">Nochmal</button></div></div>`; }
}

/* ---------- Demo-Daten (nur Demo-Modus) ---------- */
async function demoDaten() {
  const kunden = ['Müller, Thomas', 'Schmitz GmbH', 'Weber, Anna', 'Becker Logistik', 'Hoffmann, Jens', 'Klein, Sabine', 'Wagner Bau GmbH', 'Schulz, Peter', 'Fischer, Maria', 'Koch & Söhne'];
  const lief = [['Stahlgruber GmbH', 'Ersatzteile & Material'], ['WM SE', 'Ersatzteile & Material'], ['Reifen Göggel', 'Reifen'], ['Liqui Moly Vertrieb', 'Öl & Schmierstoffe'], ['Würth', 'Werkzeug & Ausstattung'], ['Stadtwerke Bornheim', 'Energie (Strom, Gas, Wasser)']];
  const t = todayISO(), A0 = [], E0 = [], B0 = [], S0 = [];
  let nr = 2400;
  for (let i = 0; i < 36; i++) {
    const d = addDays(t, -110 + i * 3), k = kunden[i % kunden.length], br = r2(80 + ((i * 137) % 900) + (i % 3) * 0.5), za = i % 4 === 0 ? 'ec' : i % 9 === 0 ? 'bar' : 'bank';
    A0.push({ richtung: 'ausgang', nummer: 'RE-' + (++nr), datum: d, partner: k, kennzeichen: 'SU-MC ' + (100 + i), netto: r2(br / 1.19), mwst: r2(br - br / 1.19), brutto: br, zahlart: za, quelle: 'demo', geprueft: true, schluessel: 'A:RE' + nr });
  }
  const aus = await DB.insert('rechnungen', A0);
  for (const r of aus) {
    const i = aus.indexOf(r);
    if (r.zahlart === 'bar') { await DB.insert('zuordnungen', [{ rechnung_id: r.id, betrag: r.brutto, art: 'bar', datum: r.datum }]); continue; }
    if (r.zahlart === 'ec') { S0.push({ transaktion: 'TX' + r.nummer, datum: r.datum, betrag: r.brutto, gebuehr: r2(r.brutto * 0.0139), auszahlung: r2(r.brutto * 0.9861), auszahlung_datum: addDays(r.datum, 2), beschreibung: i % 8 === 0 ? r.nummer : '', zahlungsart: 'girocard', status: 'Erfolgreich' }); continue; }
    if (i >= 30) continue; // die neuesten noch offen
    let betrag = r.brutto, zweck = 'Rechnung ' + r.nummer + ' ' + r.kennzeichen;
    if (i === 5) betrag = r2(r.brutto - 50);              // zu wenig
    if (i === 10) betrag = r2(r.brutto + 20);             // zu viel
    if (i === 14) zweck = 'Danke fuer die Reparatur';     // nur Name + Betrag
    B0.push({ datum: addDays(r.datum, 6 + (i % 10)), betrag, gegenpartei: r.partner.toUpperCase(), iban: 'DE8937040044053201' + String(1000 + i), zweck, schluessel: 'Bdemo' + i });
    if (i === 17) B0.push({ datum: addDays(r.datum, 20), betrag: r.brutto, gegenpartei: r.partner.toUpperCase(), zweck: 'RE ' + r.nummer.slice(3), schluessel: 'Bdemo-d' + i }); // doppelt
  }
  for (let i = 0; i < 14; i++) {
    const [n, ka] = lief[i % lief.length], d = addDays(t, -100 + i * 7), br = r2(120 + (i * 211) % 1400), num = 'L' + (50000 + i * 13);
    E0.push({ richtung: 'eingang', nummer: num, datum: d, faellig: addDays(d, 14), partner: n, kostenart: ka, netto: r2(br / 1.19), mwst: r2(br - br / 1.19), brutto: br, quelle: 'demo', geprueft: i !== 13, schluessel: 'E:' + num });
    if (i < 11) B0.push({ datum: addDays(d, 10), betrag: -br, gegenpartei: n, zweck: 'Rechnung ' + num, schluessel: 'Bdemo-e' + i });
  }
  await DB.insert('rechnungen', E0);
  B0.push({ datum: addDays(t, -40), betrag: -1850, gegenpartei: 'Grundbesitz Bornheim KG', zweck: 'Miete Werkstatt', schluessel: 'Bdemo-m1', kostenart: 'Miete & Nebenkosten' });
  B0.push({ datum: addDays(t, -10), betrag: -1850, gegenpartei: 'Grundbesitz Bornheim KG', zweck: 'Miete Werkstatt', schluessel: 'Bdemo-m2', kostenart: 'Miete & Nebenkosten' });
  B0.push({ datum: addDays(t, -25), betrag: 345.5, gegenpartei: 'Unbekannt Zahler', zweck: 'Zahlung', schluessel: 'Bdemo-u1' });
  S0.push({ transaktion: 'TX-OHNE', datum: addDays(t, -15), betrag: 59.9, gebuehr: 0.83, auszahlung: 59.07, auszahlung_datum: addDays(t, -13), beschreibung: 'Ölwechsel', zahlungsart: 'Visa', status: 'Erfolgreich' });
  const sus = await DB.insert('sumup', S0);
  const byDay = {}; sus.forEach(s => (byDay[s.auszahlung_datum] = byDay[s.auszahlung_datum] || []).push(s));
  Object.entries(byDay).forEach(([d, l], i) => B0.push({ datum: d, betrag: sum(l, s => s.auszahlung), gegenpartei: 'SumUp Payments Limited', zweck: 'SumUp Auszahlung', schluessel: 'Bdemo-s' + i }));
  markBankArten(B0);
  await DB.insert('bank', B0);
  await autoAbgleich();
}

start();
