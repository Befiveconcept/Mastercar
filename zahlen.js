/* Mastercar Finanzen · „Bezahlen“: alle offenen Eingangsrechnungen, die überwiesen werden müssen
   (nicht „Abbuchung offen“ / SEPA – die laufen per Lastschrift). Je Rechnung: PDF ansehen, Empfänger, IBAN, Betrag,
   Verwendungszweck zum Kopieren und ein GiroCode (QR) zum Scannen mit der Banking-App. */

function zuZahlen() {
  buildIdx();
  return S.rechnungen.filter(r => r.richtung === 'eingang' && !DOK_ARTEN.includes(r.art) && (+r.brutto || 0) > 0)
    .map(r => ({ r, st: rStatus(r) }))
    .filter(x => ['offen', 'ueberfaellig', 'teil'].includes(x.st.key) && x.st.offen > 0.005 && !istAbbuchung(x.r))
    .map(x => ({ ...x, faellig: faelligAm(x.r) }))
    .sort((a, b) => (a.faellig || '9999').localeCompare(b.faellig || '9999') || (a.r.partner || '').localeCompare(b.r.partner || ''));
}
// IBAN: aus der Rechnung, sonst die zuletzt an diesen Empfänger verwendete IBAN aus der Bank
function ibanVorschlag(r) {
  if (r.iban) return { iban: r.iban, quelle: 'Rechnung' };
  const tok = nameTokens(r.partner || '')[0]; if (!tok) return null;
  const b = S.bank.filter(b => b.betrag < 0 && b.iban && norm(b.gegenpartei || '').includes(tok)).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))[0];
  return b ? { iban: b.iban, quelle: 'letzte Überweisung ' + fmtD(b.datum) } : null;
}
const ibanSchoen = s => String(s || '').replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
const zweckVon = r => [r.nummer ? 'Rechnung ' + r.nummer : 'Rechnung vom ' + fmtD(r.datum), r.kundennr ? 'Kd-Nr. ' + r.kundennr : ''].filter(Boolean).join(' ').slice(0, 140);
/* Sammelüberweisung: Verwendungszweck mit allen Rechnungsnummern (max. 140 Zeichen, sonst gekürzt) */
function zweckSammel(rs) {
  if (rs.length === 1) return zweckVon(rs[0]);
  const nrn = rs.map(r => r.nummer || 'vom ' + fmtD(r.datum)), kd = rs.find(r => r.kundennr), ende = kd ? ' Kd-Nr. ' + kd.kundennr : '';
  let t = 'Rechnungen ' + nrn.join(', ');
  if ((t + ende).length > 140) { t = 'Rg. ' + nrn.join(' '); if ((t + ende).length > 140) t = t.slice(0, 140 - ende.length - 2) + ' …'; }
  return (t + ende).slice(0, 140);
}
// gehören zwei Rechnungen zum selben Empfänger? (gleiche IBAN oder gleiches erstes Namenswort)
const gleicherEmpf = (a, b) => { const ia = ibanVorschlag(a), ib = ibanVorschlag(b); if (ia && ib) return ia.iban.replace(/\s/g, '') === ib.iban.replace(/\s/g, ''); return (nameTokens(a.partner || '')[0] || 'a') === (nameTokens(b.partner || '')[0] || 'b'); };
// EPC-QR (GiroCode) – wird von fast allen deutschen Banking-Apps gelesen
const girocode = (name, iban, betrag, zweck) => ['BCD', '002', '1', 'SCT', '', String(name).slice(0, 70), String(iban).replace(/\s/g, ''), 'EUR' + Number(betrag).toFixed(2), '', '', String(zweck).slice(0, 140)].join('\n');

let QR_LIB = null;
function qrLaden() {
  if (window.QRCode) return Promise.resolve();
  return QR_LIB || (QR_LIB = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }));
}

async function kopieren(text, was) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast((was || 'Text') + ' kopiert');
}

function bezahlenAnsicht() {
  const list = zuZahlen(), heute = todayISO();
  const feld = (label, wert, was, mono) => `<div class="pz-f"><span>${label}</span><button class="pz-c ${mono ? 'mono' : ''}" data-copy="${esc(wert)}" data-was="${esc(was)}" title="Klicken zum Kopieren">${esc(wert) || '<i class="muted">fehlt</i>'}<b>⧉</b></button></div>`;
  /* Sammelüberweisungen: Gruppen von Rechnungs-IDs (eine Karte je Gruppe). Karte auf eine andere Karte derselben Firma ziehen = zusammenfassen */
  let gruppen = [];
  const gruppenAktuell = sel => { const ids = new Set(sel.map(x => x.r.id)); gruppen = gruppen.map(g => g.filter(id => ids.has(id))).filter(g => g.length);
    const drin = new Set(gruppen.flat()); sel.forEach(x => { if (!drin.has(x.r.id)) gruppen.push([x.r.id]); }); return gruppen; };
  const gx = g => g.map(id => list.find(x => x.r.id === id)).filter(Boolean);
  const daten = g => { const xs = gx(g), rs = xs.map(x => x.r), r = rs[0], ib = ibanVorschlag(r);
    return { xs, rs, r, ib, betrag: r2(sum(xs, x => x.st.offen)), zweck: zweckSammel(rs), faellig: xs.map(x => x.faellig).filter(Boolean).sort()[0] || null,
      ibanAnders: rs.some(y => { const i = ibanVorschlag(y); return i && ib && i.iban.replace(/\s/g, '') !== ib.iban.replace(/\s/g, ''); }) }; };
  const karte = (g, gi) => {
    const { xs, rs, r, ib, betrag, zweck, faellig, ibanAnders } = daten(g), spaet = faellig && faellig < heute, sammel = rs.length > 1;
    const mehr = list.filter(x => !g.includes(x.r.id) && gruppen.some(h => h.includes(x.r.id)) && gleicherEmpf(x.r, r)).length;
    return `<article class="pz ${spaet ? 'spaet' : ''}" data-gi="${gi}" data-rid="${r.id}" draggable="true" title="Auf eine andere Rechnung derselben Firma ziehen = zu einer Überweisung zusammenfassen">
      <header><div><span class="muted" aria-hidden="true">⠿</span> <b>${esc(r.partner || '–')}</b> <span class="muted small">· ${sammel ? `<b>Sammelüberweisung</b> · ${rs.length} Rechnungen` : `${esc(r.art || 'Rechnung')} ${esc(r.nummer || '')} vom ${fmtD(r.datum)}`}</span></div>
        <span class="sp"></span>${badge({ cls: spaet ? 'st-late' : 'st-open', label: faellig ? (spaet ? 'fällig seit ' : 'fällig ') + fmtD(faellig) : 'ohne Fälligkeit' })} ${rs.some(y => /mahn/i.test(y.status_excel || '')) ? badge({ cls: 'st-bad', label: 'Mahnung' }) : ''}</header>
      ${sammel ? `<ul class="pays small">${xs.map(x => `<li><span>${esc(x.r.nummer || '–')} vom ${fmtD(x.r.datum)}${x.r.skonto ? ` <span class="muted">(Skonto ${fmtE(x.r.skonto)})</span>` : ''}</span><b>${fmtE(x.st.offen)}</b><button class="icon-btn" data-loes="${x.r.id}" title="Aus der Sammelüberweisung lösen">✕</button></li>`).join('')}</ul>` : ''}
      ${ibanAnders ? '<p class="warn small">Achtung: die Rechnungen haben unterschiedliche IBANs – bitte prüfen.</p>' : ''}
      <div class="pz-g">
        ${feld('Empfänger', r.partner || '', 'Empfänger')}
        ${feld('IBAN' + (ib && ib.quelle !== 'Rechnung' ? ` <small class="muted">(${esc(ib.quelle)})</small>` : ''), ib ? ibanSchoen(ib.iban) : '', 'IBAN', true)}
        ${feld('Betrag' + (sammel ? ` <small class="muted">(Summe ${rs.length} Rechnungen)</small>` : r.skonto ? ` <small class="muted">(mit Skonto ${fmtE(r.skonto)})</small>` : xs[0].st.key === 'teil' ? ' <small class="muted">(Rest)</small>' : ''), betrag.toFixed(2).replace('.', ','), 'Betrag', true)}
        ${feld('Verwendungszweck', zweck, 'Verwendungszweck')}
      </div>
      <div class="btnrow">
        ${!sammel ? (r.datei ? `<button class="btn sm" data-pdf="${r.id}">📄 PDF ansehen</button>` : '<span class="small muted">keine PDF</span>') : ''}
        ${ib ? `<button class="btn sm" data-qr="${gi}">▦ GiroCode</button>` : r.datei && DB.aiOn ? `<button class="btn sm" data-ibanki="${r.id}">🔎 IBAN aus PDF lesen</button>` : ''}
        ${!ib ? `<button class="btn sm" data-ibanhand="${r.id}">IBAN eintragen</button>` : ''}
        <button class="btn sm" data-copy="${esc(`Empfänger: ${r.partner || ''}\nIBAN: ${ib ? ibanSchoen(ib.iban) : ''}\nBetrag: ${fmtE(betrag)}\nVerwendungszweck: ${zweck}`)}" data-was="Überweisungsdaten">⧉ Alles kopieren</button>
        ${mehr ? `<button class="btn sm" data-buendel="${gi}" title="Alle ausgewählten Rechnungen dieser Firma in eine Überweisung">⇉ Alle ${mehr + rs.length} von dieser Firma zusammenfassen</button>` : ''}
        ${!sammel ? `<button class="btn sm" data-a="detail" data-id="${r.id}">Rechnung öffnen</button>` : ''}
        <span class="sp"></span><button class="btn sm primary" data-ueberw="${gi}">✓ Überwiesen</button>
      </div>
      <div class="pz-qr" hidden></div>
    </article>`;
  };
  /* Sortierung in Schritt 1 (Klick auf die Spaltenüberschrift; nochmal = umgekehrt) */
  let sortK = 'faellig', sortAuf = true;
  const SORT = { datum: x => x.r.datum || '', firma: x => norm(x.r.partner || ''), faellig: x => x.faellig || '9999', betrag: x => x.st.offen };
  const sortieren = () => { const f = SORT[sortK]; list.sort((a, b) => { const va = f(a), vb = f(b); const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb)); return (sortAuf ? c : -c) || (a.faellig || '9999').localeCompare(b.faellig || '9999') || (a.r.datum || '').localeCompare(b.r.datum || ''); }); };
  const th = (k, l, cls) => `<th class="${cls || ''}" data-sort="${k}" style="cursor:pointer" title="Sortieren">${l} ${sortK === k ? (sortAuf ? '▲' : '▼') : '<span class="muted">↕</span>'}</th>`;
  // Schritt 1: Übersicht wie in der Excel (Blatt „Ein- und Ausgaben“) – auswählen, was überwiesen werden soll
  const wahl = new Set(list.map(x => x.r.id));
  const tabelle = () => {
    sortieren(); const sel = list.filter(x => wahl.has(x.r.id));
    const zeile = ({ r, st, faellig }) => {
      const spaet = faellig && faellig < heute, ib = ibanVorschlag(r);
      return `<tr data-zeile="${r.id}" class="${wahl.has(r.id) ? '' : 'pz-aus'}">
        <td class="c-chk"><input type="checkbox" data-wahl="${r.id}" ${wahl.has(r.id) ? 'checked' : ''} aria-label="auswählen"></td>
        <td class="c-datum">${fmtD(r.datum)}</td><td class="c-lief">${esc(r.partner || '')}</td>
        <td class="c-art ${(+r.brutto || 0) < 0 ? 'x-art-g' : 'x-art-r'}">${esc(r.art || 'Rechnung')}</td><td class="c-nr">${esc(r.nummer || '')}</td>
        <td class="c-ka">${esc(r.kostenart || '')}</td><td class="c-za">${esc(ZA[r.zahlart] || '')}</td>
        <td class="c-brutto num">${fmtE(r.brutto)}</td><td class="c-skonto num">${r.skonto ? fmtE(r.skonto) : ''}</td>
        <td class="num"><b>${fmtE(st.offen)}</b></td>
        <td class="${spaet ? 'neg' : ''}">${faellig ? fmtD(faellig) : ''}</td>
        <td class="${ST_CLS(st.label)}">${esc(st.label)}</td>
        <td>${ib ? '✓' : '<span class="muted">fehlt</span>'}</td>
        <td>${r.datei ? `<button class="btn xs" data-pdf="${r.id}" title="PDF ansehen">📄</button>` : ''}</td></tr>`;
    };
    return `
    <div class="pz-step"><b>Schritt 1 von 2</b> · Offene Rechnungen auswählen <span class="muted small">(ohne „Abbuchung offen“ / SEPA – die werden abgebucht)</span></div>
    <input class="inp search" type="search" id="pzQ" placeholder="Suchen: Lieferant, Nummer, Betrag …">
    <div class="tw scroll" data-view="eingang"><table class="tb pz-tab"><thead><tr>
      <th><input type="checkbox" id="pzAlle" ${sel.length === list.length ? 'checked' : ''} aria-label="alle"></th>
      ${th('datum', 'Rechnungsdatum')}${th('firma', 'Firma')}<th>Art</th><th>Rechnungsnr.</th><th>Kategorie</th><th>Zahlart</th><th class="num">Preis gesamt brutto</th><th class="num">Skonto</th>${th('betrag', 'Zu zahlen', 'num')}${th('faellig', 'Fällig')}<th>Erledigt?</th><th>IBAN</th><th>PDF</th></tr></thead>
      <tbody>${list.map(zeile).join('')}</tbody></table></div>
    <div class="btnrow"><span class="sumline" style="margin:0"><b>${sel.length}</b> von ${list.length} ausgewählt · davon überfällig ${sel.filter(x => x.faellig && x.faellig < heute).length} · zusammen <b>${fmtE(sum(sel, x => x.st.offen))}</b></span><span class="sp"></span><button class="btn primary" data-weiter ${sel.length ? '' : 'disabled'}>Weiter: ${sel.length} überweisen →</button></div>`;
  };
  // Schritt 2: die Überweisungsdaten je ausgewählter Rechnung
  const karten = () => {
    const sel = list.filter(x => wahl.has(x.r.id)), G = gruppenAktuell(sel);
    return `<div class="pz-step"><button class="btn sm" data-zurueck>← Zurück zur Übersicht</button> <b>Schritt 2 von 2</b> · Überweisen
      <span class="sp"></span><span><b>${G.length}</b> Überweisung${G.length === 1 ? '' : 'en'} für ${sel.length} Rechnung${sel.length === 1 ? '' : 'en'} · zusammen <b>${fmtE(sum(sel, x => x.st.offen))}</b></span></div>
      <p class="small muted">Mehrere Rechnungen einer Firma in einer Überweisung: Karte mit der Maus auf eine andere Karte derselben Firma ziehen – Betrag und Verwendungszweck passen sich an.</p>
      <div id="pzL">${G.map(karte).join('') || '<div class="empty">Alles überwiesen. 🎉</div>'}</div>`;
  };
  const schritt2 = () => { const y = body().scrollTop; body().innerHTML = karten(); body().scrollTop = y; };
  const zusammen = (von, nach) => { if (von === nach || !gruppen[von] || !gruppen[nach]) return;
    const a = S.rechnungen.find(x => x.id === gruppen[von][0]), b = S.rechnungen.find(x => x.id === gruppen[nach][0]);
    if (!gleicherEmpf(a, b)) { toast('Nur Rechnungen derselben Firma (gleiche IBAN) lassen sich zusammenfassen.'); return; }
    gruppen[nach] = gruppen[nach].concat(gruppen[von]); gruppen.splice(von, 1); schritt2(); toast('Zu einer Überweisung zusammengefasst.'); };
  if (!list.length) return openSheet({ title: '💸 Bezahlen', noOk: true, html: '<div class="empty">Nichts zu überweisen – alles bezahlt oder per Lastschrift. 🎉</div>' });
  const d = openSheet({ title: '💸 Bezahlen', wide: true, noOk: true, html: `<div id="pzBody">${tabelle()}</div>` });
  const body = () => $('#pzBody', d);
  const schritt1 = () => { body().innerHTML = tabelle(); body().scrollTop = 0; };
  const nurSumme = () => { const q = $('#pzQ', d) && $('#pzQ', d).value; schritt1(); if (q) { $('#pzQ', d).value = q; filtern(q); } };
  const filtern = v => { const q = norm(v); $$('tr[data-zeile]', d).forEach(t => t.hidden = q && !norm(t.innerText).includes(q)); $$('.pz', d).forEach(a => a.hidden = q && !norm(a.innerText).includes(q)); };
  d.addEventListener('input', e => { if (e.target.id === 'pzQ') filtern(e.target.value); });
  d.addEventListener('change', e => {
    if (e.target.id === 'pzAlle') { list.forEach(x => e.target.checked ? wahl.add(x.r.id) : wahl.delete(x.r.id)); return nurSumme(); }
    const w = e.target.closest('[data-wahl]'); if (w) { w.checked ? wahl.add(w.dataset.wahl) : wahl.delete(w.dataset.wahl); nurSumme(); }
  });
  /* Drag & Drop: Karte auf Karte derselben Firma = Sammelüberweisung */
  let ziehGi = null;
  d.addEventListener('dragstart', e => { const a = e.target.closest && e.target.closest('.pz[data-gi]'); if (!a) return; ziehGi = +a.dataset.gi; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(ziehGi)); } catch (er) { } a.style.opacity = '.5'; });
  d.addEventListener('dragend', e => { const a = e.target.closest && e.target.closest('.pz'); if (a) a.style.opacity = ''; $$('.pz', d).forEach(x => x.style.outline = ''); });
  d.addEventListener('dragover', e => { const a = e.target.closest && e.target.closest('.pz[data-gi]'); if (!a || ziehGi == null || +a.dataset.gi === ziehGi) return; e.preventDefault(); $$('.pz', d).forEach(x => x.style.outline = ''); a.style.outline = '2px dashed var(--accent, #f5e400)'; });
  d.addEventListener('drop', e => { const a = e.target.closest && e.target.closest('.pz[data-gi]'); if (!a || ziehGi == null) return; e.preventDefault(); const von = ziehGi; ziehGi = null; zusammen(von, +a.dataset.gi); });
  d.addEventListener('click', async e => {
    if (e.target.closest('[data-weiter]')) { body().innerHTML = karten(); body().scrollTop = 0; return; }
    if (e.target.closest('[data-zurueck]')) return schritt1();
    const so = e.target.closest('[data-sort]'); if (so) { const k = so.dataset.sort; if (sortK === k) sortAuf = !sortAuf; else { sortK = k; sortAuf = k !== 'betrag'; } return nurSumme(); }
    const lo = e.target.closest('[data-loes]'); if (lo) { const id = lo.dataset.loes; gruppen = gruppen.map(g => g.filter(x => x !== id)).filter(g => g.length); gruppen.push([id]); return schritt2(); }
    const bu = e.target.closest('[data-buendel]'); if (bu) { const gi = +bu.dataset.buendel, r0 = S.rechnungen.find(x => x.id === gruppen[gi][0]);
      const rest = gruppen.filter((g, i) => i !== gi && gleicherEmpf(S.rechnungen.find(x => x.id === g[0]), r0)); gruppen[gi] = gruppen[gi].concat(rest.flat()); gruppen = gruppen.filter(g => !rest.includes(g)); toast('Zu einer Überweisung zusammengefasst.'); return schritt2(); }
    // Klick in die Zeile (nicht auf Knöpfe) = an-/abwählen
    const tr = e.target.closest('tr[data-zeile]');
    if (tr && !e.target.closest('button, input')) { const id = tr.dataset.zeile; wahl.has(id) ? wahl.delete(id) : wahl.add(id); return nurSumme(); }
    const c = e.target.closest('[data-copy]'); if (c) return kopieren(c.dataset.copy, c.dataset.was);
    const p = e.target.closest('[data-pdf]');
    if (p) { const r = S.rechnungen.find(x => x.id === p.dataset.pdf), w = window.open('', '_blank'); try { const u = await DB.fileUrl(r.datei); if (w) w.location = u; else window.open(u, '_blank'); } catch (er) { if (w) w.close(); toast('PDF nicht gefunden.'); } return; }
    const q = e.target.closest('[data-qr]');
    if (q) {
      const art = q.closest('.pz'), box = $('.pz-qr', art); if (!box.hidden) { box.hidden = true; return; }
      const { r, ib, betrag, zweck } = daten(gruppen[+q.dataset.qr]);
      try { await qrLaden(); box.innerHTML = '<div class="pz-qrc"></div><p class="small muted">Mit der Banking-App scannen (Foto-Überweisung / GiroCode) – Empfänger, IBAN, Betrag und Verwendungszweck sind schon ausgefüllt.</p>';
        new QRCode($('.pz-qrc', box), { text: girocode(r.partner || '', ib.iban, betrag, zweck), width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M }); box.hidden = false; }
      catch (er) { toast('QR-Code konnte nicht geladen werden.'); }
      return;
    }
    const ik = e.target.closest('[data-ibanki], [data-ibanhand]');
    if (ik) {
      const r = S.rechnungen.find(x => x.id === (ik.dataset.ibanki || ik.dataset.ibanhand)); let iban = '';
      if (ik.dataset.ibanki) {
        busy(true, 'KI liest die Bankverbindung …');
        try { const b = await ablageBlob(r); const j = await DB.aiJson('Lies aus dieser Rechnung die Bankverbindung des RECHNUNGSSTELLERS (wohin überwiesen werden soll). Nur JSON: {"iban":"","bic":"","kontoinhaber":""}',
          { files: [{ type: b.type && /image/.test(b.type) ? b.type : 'application/pdf', data: await fileToB64(b) }], tier: 'quick' }); iban = String(j.iban || '').replace(/\s/g, '').toUpperCase(); }
        catch (er) { toast(aiErr(er)); } finally { busy(false); }
        if (!iban) { toast('Keine IBAN in der PDF gefunden – bitte von Hand eintragen.'); return; }
      } else { iban = String(prompt('IBAN für ' + (r.partner || '') + ':', '') || '').replace(/\s/g, '').toUpperCase(); if (!iban) return; }
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) { toast('Das sieht nicht nach einer IBAN aus: ' + iban); return; }
      await DB.update('rechnungen', r.id, { iban }); toast('IBAN gespeichert');
      // Karte an Ort und Stelle neu zeichnen (in Schritt 2 bleiben)
      const x = list.find(y => y.r.id === r.id); if (x) x.r = S.rechnungen.find(y => y.id === r.id) || x.r;
      return schritt2();
    }
    const u = e.target.closest('[data-ueberw]');
    if (u) {
      const gi = +u.dataset.ueberw, { rs, zweck } = daten(gruppen[gi]), sammel = rs.length > 1;
      for (const r of rs) await DB.update('rechnungen', r.id, { status_excel: 'Bezahlt', bezahlt_extern: true, notiz: [r.notiz, 'überwiesen am ' + fmtD(todayISO()) + (sammel ? ' (Sammelüberweisung: ' + zweck + ')' : '')].filter(Boolean).join(' · ') });
      rs.forEach(r => { wahl.delete(r.id); const i = list.findIndex(x => x.r.id === r.id); if (i >= 0) list.splice(i, 1); });   // auch aus der Übersicht (Schritt 1) nehmen
      gruppen.splice(gi, 1);
      const art = u.closest('.pz'); art.classList.add('fertig'); setTimeout(() => schritt2(), 400);
      toast((sammel ? rs.length + ' Rechnungen' : 'Rechnung') + ' als überwiesen markiert – die Bank-Buchung wird später automatisch zugeordnet.'); render(); return;
    }
    const det = e.target.closest('[data-a="detail"]'); if (det) rechnungDetail(det.dataset.id);
  });
}
