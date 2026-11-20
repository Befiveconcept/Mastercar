/* Mastercar Finanzen · Detailfenster und Formulare */
const payLabel = z => {
  if (z.bank_id) { const b = S.bank.find(x => x.id === z.bank_id); return b ? `Bank ${fmtD(b.datum)} · ${esc(b.gegenpartei || '')}` : 'Bank'; }
  if (z.sumup_id) { const s = S.sumup.find(x => x.id === z.sumup_id); return s ? `SumUp/EC ${fmtD(s.datum)}${s.beschreibung ? ' · ' + esc(s.beschreibung) : ''}` : 'SumUp'; }
  if (z.kasse_id) { const k = S.kasse.find(x => x.id === z.kasse_id); return k ? `Kasse ${fmtD(k.datum)}${k.belegnr ? ' · Beleg ' + esc(k.belegnr) : ''}${k.text ? ' · ' + esc(k.text) : ''}` : 'Kasse'; }
  return `Bar ${fmtD(z.datum)}`;
};

async function rechnungDetail(id) {
  buildIdx();
  const r = S.rechnungen.find(x => x.id === id); if (!r) return;
  const st = rStatus(r), isA = r.richtung === 'ausgang';
  const d = openSheet({
    title: (isA ? 'Kundenrechnung ' : 'Lieferantenrechnung ') + (r.nummer || ''), wide: true, noOk: true, html: `
    <div class="det ${r.datei ? 'with-doc' : ''}">
      <div>
        <div class="det-head"><label class="small muted">Status</label> ${stSelect(r)}${st.hint ? ` <span class="badge ${st.hint[1]} hint">${esc(st.hint[0])}</span>` : ''}${r.geprueft ? '' : ' ' + badge({ cls: 'st-ai', label: r.quelle === 'ki' ? 'von KI gelesen – bitte prüfen' : 'nicht geprüft' })}</div>
        <dl class="dl">
          <dt>${isA ? 'Kunde' : 'Lieferant'}</dt><dd>${esc(r.partner || '–')}</dd>
          <dt>Rechnungsnr.</dt><dd class="mono">${esc(r.nummer || '–')}</dd>
          <dt>Datum</dt><dd>${fmtD(r.datum)}</dd><dt>Fällig</dt><dd>${fmtD(faelligAm(r))}</dd>
          ${isA ? `${r.kundennr ? `<dt>Kd.-Nr.</dt><dd class="mono">${esc(r.kundennr)}</dd>` : ''}<dt>Kennzeichen</dt><dd class="mono">${esc(r.kennzeichen || '–')}</dd><dt>Zahlart</dt><dd>${esc(ZA[r.zahlart] || '–')}</dd>
            ${r.lohn != null || r.teile != null ? `<dt>Aufteilung netto</dt><dd>Werkstatt ${fmtE(r.lohn || 0)} · Ersatzteile ${fmtE(r.teile || 0)}${r.sonstiges ? ' · Sonstiges ' + fmtE(r.sonstiges) : ''}${r.altteile ? ' · Altteile ' + fmtE(r.altteile) : ''}</dd>` : ''}`
            : `<dt>Kategorie (GuV)</dt><dd>${esc(r.kostenart || '–')}${r.unterkonto ? ' · ' + esc(r.unterkonto) : ''}${r.fix != null ? ' · ' + (r.fix ? 'Fixkosten' : 'variabel') : ''}</dd><dt>Art</dt><dd>${esc(r.art || '–')}</dd><dt>Zahlart</dt><dd>${esc(ZA[r.zahlart] || '–')}</dd><dt>IBAN</dt><dd class="mono">${esc(r.iban || '–')}</dd>`}
          ${r.skonto ? `<dt>Skonto</dt><dd>${fmtE(r.skonto)} → zu zahlen ${fmtE(sollOf(r))}</dd>` : ''}
          ${r.durchlaufend ? `<dt>Durchlaufender Posten</dt><dd>${fmtE(r.durchlaufend)}</dd>` : ''}
          ${r.beschreibung ? `<dt>Beschreibung</dt><dd>${esc(r.beschreibung)}</dd>` : ''}
          ${r.notiz ? `<dt>Notiz</dt><dd>${esc(r.notiz)}</dd>` : ''}
          <dt>Netto / MwSt.</dt><dd>${fmtE(r.netto)} / ${fmtE(r.mwst)}</dd>
          <dt>Brutto</dt><dd><b>${fmtE(r.brutto)}</b></dd>
          <dt>Bezahlt</dt><dd>${fmtE(st.bezahlt)}</dd>
          <dt>${st.offen < -0.01 ? 'Zu viel bezahlt' : 'Offen'}</dt><dd class="${Math.abs(st.offen) > 0.01 ? 'neg' : ''}"><b>${fmtE(Math.abs(st.offen))}</b></dd>
        </dl>
        ${isA ? '' : `<details class="xl"><summary>Alle Spalten wie in der Excel „Ein- und Ausgaben“</summary><dl class="dl">${eingangExcel(r).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '–')}</dd>`).join('')}</dl></details>`}
        ${(() => { const o = st.bezug, gs = st.gutschriften || [], av = typeof avisZu === 'function' ? avisZu(r.id) : []; if (!o && !gs.length && !av.length) return '';
          return `<h4>Verknüpft</h4><ul class="pays">${o ? `<li data-act="rechnung" data-id="${o.id}" style="cursor:pointer"><span>↔ gehört zu Rechnung <b>${esc(o.nummer || '')}</b> · ${esc(o.partner || '')} · ${fmtD(o.datum)}</span><b>${fmtE(o.brutto)}</b></li>` : ''}
            ${gs.map(g => `<li data-act="rechnung" data-id="${g.id}" style="cursor:pointer"><span>↔ ${esc(g.art || 'Gutschrift')} <b>${esc(g.nummer || '')}</b> · ${fmtD(g.datum)} <small class="muted">· verrechnet</small></span><b>${fmtE(g.brutto)}</b></li>`).join('')}
            ${av.map(a => `<li data-act="avisD" data-id="${a.id}" style="cursor:pointer"><span>📨 Zahlungsavis ${esc(a.nummer || '')} · ${fmtD(a.datum)} · ${a.bank_id ? 'abgebucht' : 'Abbuchung offen'}</span><b>${a.betrag != null ? fmtE(a.betrag) : ''}</b></li>`).join('')}</ul>`; })()}
        <h4>Zahlungen</h4>
        ${st.zahlungen.length ? `<ul class="pays">${st.zahlungen.map(z => `<li><span>${payLabel(z)}${z.art === 'auto' ? ' <small class="muted">· automatisch' + (z.notiz ? ': ' + esc(z.notiz) : '') + '</small>' : z.notiz ? ' <small class="muted">· ' + esc(z.notiz) + '</small>' : ''}</span><b>${fmtE(z.betrag)}</b><button class="icon-btn" data-delz="${z.id}" title="Zuordnung lösen">✕</button></li>`).join('')}</ul>` : '<p class="muted small">Noch keine Zahlung zugeordnet.</p>'}
        <div class="btnrow">
          <button class="btn primary" data-a="pay">Zahlung zuordnen</button>
          ${isA ? '<button class="btn" data-a="bar">Bar bezahlt</button>' : ''}
          <button class="btn" data-a="erl">${r.erledigt ? 'Wieder öffnen' : 'Als erledigt markieren'}</button>
          <button class="btn" data-a="edit">Bearbeiten</button>
          ${(+r.brutto || 0) < 0 || ['Gutschrift', 'Korrektur', 'Storno'].includes(r.art) ? `<button class="btn" data-a="bezug">↔ ${r.bezug_id ? 'Andere Rechnung' : 'Mit Rechnung verknüpfen'}</button>${r.bezug_id ? '<button class="btn" data-a="bezugWeg">Verknüpfung lösen</button>' : ''}` : ''}
          <button class="btn ${r.datei ? '' : 'primary'}" data-a="beleg" title="PDF auswählen oder einfach in dieses Fenster ziehen">📎 ${r.datei ? 'PDF ersetzen' : 'PDF anhängen'}</button>
          <button class="btn" data-a="todo">☑ To-Do anlegen</button>
          ${r.geprueft ? '' : '<button class="btn" data-a="ok">✓ Geprüft</button>'}
          <button class="btn danger" data-a="del">Löschen</button>
        </div>
      </div>
      ${r.datei ? `<div class="doc" id="docPrev"><div class="muted small">Beleg wird geladen …</div></div>` : ''}
    </div>`
  });
  d.dataset.rid = r.id;   // PDF ins offene Fenster ziehen = an diese Rechnung hängen
  if (!r.datei) $('.sheet-body', d).insertAdjacentHTML('afterbegin', '<div class="note small">Zu dieser Rechnung ist noch keine PDF hinterlegt – einfach die PDF in dieses Fenster ziehen oder „📎 PDF anhängen“.</div>');
  if (r.datei) DB.fileUrl(r.datei).then(u => { const p = $('#docPrev', d); if (!p) return; p.innerHTML = !u ? 'Beleg nicht gefunden.' : /\.(png|jpe?g|webp|gif)$/i.test(r.datei) ? `<img src="${u}" alt="Beleg">` : `<iframe src="${u}" title="Beleg"></iframe><a class="small" href="${u}" target="_blank" rel="noopener">In neuem Fenster öffnen</a>`;
    p.insertAdjacentHTML('beforeend', ` <a class="small" href="#" id="docDl">⬇ ${esc(r.dateiname || 'Herunterladen')}</a>`);
    $('#docDl', d).onclick = async e => { e.preventDefault(); try { const b = await ablageBlob(r); if (!b) return toast('Beleg nicht gefunden.'); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = r.dateiname || belegName(r, dateiEndung(r.datei)); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); } catch (er) { toast('Download fehlgeschlagen.'); } };
  }).catch(() => { });
  const again = () => { render(); rechnungDetail(id); };
  d.addEventListener('click', async e => {
    const dz = e.target.closest('[data-delz]'); if (dz) { await zuordnungLoeschen(dz.dataset.delz); return again(); }
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'pay') return zahlungPicker(r);
    if (a === 'bar') { const rest = rStatus(r).offen; if (rest <= 0.005) return toast('Nichts offen.'); await zuordnen(r, null, 'bar', rest, 'Bar bezahlt'); return again(); }
    if (a === 'erl') { await DB.update('rechnungen', r.id, { erledigt: !r.erledigt }); return again(); }
    if (a === 'ok') { await DB.update('rechnungen', r.id, { geprueft: true }); return again(); }
    if (a === 'edit') return rechnungForm(r.richtung, r);
    if (a === 'bezugWeg') { await DB.update('rechnungen', r.id, { bezug_id: null }); return again(); }
    if (a === 'bezug') {
      const vs = bezugFinden(null, r.partner, r), n = prompt('Nummer der Rechnung, zu der diese ' + (r.art || 'Gutschrift') + ' gehört:', vs ? vs.nummer : ''); if (!n) return;
      const o = bezugFinden(n.trim(), r.partner, r) || S.rechnungen.find(x => x.richtung === r.richtung && x.nummer && normNr(x.nummer) === normNr(n) && x.id !== r.id);
      if (!o) return toast('Rechnung ' + n + ' nicht gefunden.');
      await DB.update('rechnungen', r.id, { bezug_id: o.id }); toast(`Verknüpft mit ${o.nummer} – wird dort verrechnet.`); return again();
    }
    if (a === 'beleg') { const i = document.createElement('input'); i.type = 'file'; i.accept = '.pdf,image/*,.eml,.msg'; i.onchange = () => i.files[0] && belegZuRechnung(r.id, i.files[0]); i.click(); return; }
    if (a === 'todo') { const o = rStatus(r).offen; return todoForm(null, { rechnung_id: r.id, prio: st.key === 'ueberfaellig' || st.key === 'doppelt' ? 'hoch' : 'normal', faellig: addDays(todayISO(), 2),
      titel: isA ? (st.key === 'ueber' || st.key === 'doppelt' ? `${r.partner}: zu viel gezahlte ${fmtE(-o)} erstatten (${r.nummer || ''})` : `${r.partner} wegen offener Rechnung ${r.nummer || ''} (${fmtE(o)}) kontaktieren`) : `Rechnung ${r.nummer || ''} von ${r.partner} klären`, extern: r.partner }); }
    if (a === 'del') { if (!confirm('Rechnung ' + (r.nummer || '') + ' wirklich löschen? Zugeordnete Zahlungen werden wieder frei.')) return; await DB.remove('rechnungen', r.id); closeSheet(); buildIdx(); render(); toast('Gelöscht.'); }
  });
}

function rechnungForm(dir, r = null) {
  const isA = dir === 'ausgang', v = r || { richtung: dir, datum: todayISO() };
  const f = (k, label, type = 'text', extra = '') => `<label class="fld"><span>${label}</span><input class="inp" name="${k}" type="${type}" ${type === 'number' ? 'step="0.01"' : ''} value="${esc(v[k] ?? '')}" ${extra}></label>`;
  const d = openSheet({
    title: r ? 'Rechnung bearbeiten' : (isA ? 'Neue Kundenrechnung' : 'Neue Lieferantenrechnung'), html: `<form class="form2">
    ${f('partner', isA ? 'Kunde' : 'Lieferant', 'text', 'required')}${f('nummer', 'Rechnungsnummer')}
    ${f('datum', 'Datum', 'date')}${f('faellig', 'Fällig am', 'date')}
    ${f('netto', 'Netto', 'number')}${f('mwst', 'MwSt.', 'number')}${f('brutto', 'Brutto *', 'number', 'required')}
    ${isA ? f('kennzeichen', 'Kennzeichen') + `<label class="fld"><span>Zahlart</span><select class="inp" name="zahlart"><option value="">–</option>${Object.entries(ZA).map(([k, l]) => `<option value="${k}" ${v.zahlart === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
      : `<label class="fld"><span>Kategorie (GuV)</span><select class="inp" name="kostenart"><option value="">–</option>${KOSTENARTEN.map(k => `<option ${v.kostenart === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
         <label class="fld"><span>Unterposition</span><select class="inp" name="unterkonto"><option value="">–</option>${UNTERKONTEN(v.kostenart).map(k => `<option ${v.unterkonto === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
         <label class="fld"><span>Art</span><select class="inp" name="art">${['Rechnung', 'Gutschrift', 'Korrektur', 'Vertrag', 'Beleg', 'Storno', 'Zahlungsavis'].map(k => `<option ${(v.art || 'Rechnung') === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
         <label class="fld"><span>Fix / variabel</span><select class="inp" name="fix"><option value="">–</option><option value="1" ${v.fix === true ? 'selected' : ''}>Fixkosten</option><option value="0" ${v.fix === false ? 'selected' : ''}>variabel</option></select></label>
         <label class="fld"><span>Zahlart</span><select class="inp" name="zahlart"><option value="">–</option>${Object.entries(ZA).map(([k, l]) => `<option value="${k}" ${v.zahlart === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
         ${f('skonto', 'Skonto (€)', 'number')}${f('durchlaufend', 'Durchlaufender Posten (€)', 'number')}
         <label class="fld"><span>Mwst.?</span><select class="inp" name="mwst_pflicht"><option value="">–</option><option value="1" ${v.mwst_pflicht === true ? 'selected' : ''}>Ja</option><option value="0" ${v.mwst_pflicht === false ? 'selected' : ''}>Nein</option></select></label>
         ${f('bankabgleich', 'Bankabgleich')}` + f('iban', 'IBAN Lieferant')}
    <label class="fld full"><span>Beschreibung</span><input class="inp" name="beschreibung" value="${esc(v.beschreibung || '')}"></label>
    <label class="fld full"><span>Notiz</span><input class="inp" name="notiz" value="${esc(v.notiz || '')}"></label>
    <label class="fld full"><span>📎 PDF der Rechnung ${v.datei ? '(ersetzt die vorhandene)' : ''}</span><input class="inp" name="beleg" type="file" accept=".pdf,image/*,.eml,.msg"></label></form>
    <p class="small muted">Tipp: Netto + MwSt. eintragen und Brutto leer lassen – wird ausgerechnet.</p>`,
    onOk: async dd => {
      const fd = Object.fromEntries(new FormData($('form', dd)));
      const n = k => parseNum(fd[k]);
      let brutto = n('brutto'); if (brutto == null && n('netto') != null) brutto = r2(n('netto') + (n('mwst') || 0));
      if (brutto == null) { toast('Bitte Brutto (oder Netto) eintragen.'); return false; }
      if (!fd.partner.trim()) { toast(isA ? 'Bitte Kunde eintragen.' : 'Bitte Lieferant eintragen.'); return false; }
      const row = { partner: fd.partner.trim(), nummer: fd.nummer.trim() || null, datum: fd.datum || null, faellig: fd.faellig || null, netto: n('netto'), mwst: n('mwst'), brutto: r2(brutto),
        beschreibung: fd.beschreibung || null, notiz: fd.notiz || null, geprueft: true };
      if (isA) Object.assign(row, { kennzeichen: (fd.kennzeichen || '').toUpperCase() || null, zahlart: fd.zahlart || null });
      else Object.assign(row, { kostenart: fd.kostenart || null, unterkonto: fd.unterkonto || null, art: fd.art || null, fix: fd.fix === '' ? null : fd.fix === '1', zahlart: fd.zahlart || null, skonto: n('skonto'),
        durchlaufend: n('durchlaufend'), mwst_pflicht: fd.mwst_pflicht === '' ? null : fd.mwst_pflicht === '1', bankabgleich: (fd.bankabgleich || '').trim() || null, nach_dlp: null, mit_skonto: null,   // werden aus Brutto/Skonto/durchl. Posten neu hergeleitet
        iban: (fd.iban || '').replace(/\s/g, '').toUpperCase() || null });
      // Gutschrift/Storno vom Lieferanten mindert Kosten: negativ speichern
      if (!isA && ['Gutschrift', 'Storno'].includes(fd.art) && row.brutto > 0) { row.brutto = -row.brutto; if (row.netto) row.netto = -Math.abs(row.netto); if (row.mwst) row.mwst = -Math.abs(row.mwst); }
      const key = row.nummer ? (isA ? 'A:' + normNr(row.nummer) : 'E:' + (nameTokens(row.partner)[0] || '') + ':' + normNr(row.nummer)) : null;
      if (r) {
        if (key && key !== r.schluessel && S.rechnungen.some(x => x.schluessel === key && x.id !== r.id)) { toast('Diese Rechnungsnummer gibt es schon.'); return false; }
        if (key) row.schluessel = key;
        const altName = r.dateiname;
        await DB.update('rechnungen', r.id, row);
        if (r.datei) await ablageUmbenennen(S.rechnungen.find(x => x.id === r.id) || r, altName);   // Beleg-Datei an neue Angaben anpassen
      } else {
        row.schluessel = key || (isA ? 'A#' : 'E#') + uid(); row.richtung = dir; row.quelle = 'manuell';
        row.status_excel = row.zahlart === 'bar' ? 'Bezahlt' : row.zahlart === 'sepa' ? 'Abbuchung offen' : 'Offen';
        if (S.rechnungen.some(x => x.schluessel === row.schluessel)) { toast('Diese Rechnungsnummer gibt es schon.'); return false; }
        const [nr] = await DB.insert('rechnungen', [row]);
        if (isA && row.zahlart === 'bar' && nr) await zuordnen(nr, null, 'bar', nr.brutto, 'Bar bezahlt');
        if (nr && fd.beleg && fd.beleg.size) setTimeout(() => belegZuRechnung(nr.id, fd.beleg), 0);
        else if (nr) toast('Gespeichert – PDF fehlt noch (im Rechnungsfenster „📎 PDF anhängen“).');
      }
      buildIdx(); render();
      if (r && fd.beleg && fd.beleg.size) setTimeout(() => belegZuRechnung(r.id, fd.beleg), 0);
      else if (r) setTimeout(() => rechnungDetail(r.id), 0);
    }
  });
  // Brutto automatisch aus Netto + MwSt.
  const nIn = $('[name=netto]', d), mIn = $('[name=mwst]', d), bIn = $('[name=brutto]', d);
  const calc = () => { const n = parseNum(nIn.value), m = parseNum(mIn.value); if (n != null && !bIn.dataset.touched) bIn.value = r2(n + (m ?? n * 0.19)); if (n != null && mIn.value === '') mIn.placeholder = r2(n * 0.19); };
  nIn.addEventListener('input', calc); mIn.addEventListener('input', calc); bIn.addEventListener('input', () => bIn.dataset.touched = 1);
  // Unterpositionen passend zur Kategorie
  const ka = $('[name=kostenart]', d), uk = $('[name=unterkonto]', d);
  if (ka && uk) ka.onchange = () => { uk.innerHTML = '<option value="">–</option>' + UNTERKONTEN(ka.value).map(k => `<option>${esc(k)}</option>`).join(''); };
  // beim Bearbeiten Beträge positiv zeigen (Gutschriften sind intern negativ gespeichert)
  if (r && r.brutto < 0) ['netto', 'mwst', 'brutto'].forEach(k => { const i = $(`[name=${k}]`, d); if (i && i.value) i.value = Math.abs(parseNum(i.value)); });
}

// Für eine Rechnung eine offene Zahlung (Bank oder SumUp) aussuchen
function zahlungPicker(r) {
  buildIdx();
  const st = rStatus(r), isA = r.richtung === 'ausgang';
  const pays = [
    ...S.bank.filter(b => (isA ? b.betrag > 0 : b.betrag < 0) && !b.art).map(b => ({ kind: 'bank', p: b, rest: bStatus(b).rest })),
    ...(isA ? S.sumup.filter(sumOk).map(s => ({ kind: 'sumup', p: { ...s, zweck: s.beschreibung }, rest: sStatus(s).rest })) : []),
    ...S.kasse.filter(k => (isA ? k.betrag > 0 : k.betrag < 0)).map(k => ({ kind: 'kasse', p: { ...k, zweck: k.text, gegenpartei: 'Kasse' }, rest: kStatus(k).rest }))
  ].filter(x => x.rest > 0.005).map(x => ({ ...x, ...score(x.p, r, x.rest, st.offen) })).sort((a, b) => b.s - a.s || b.p.datum.localeCompare(a.p.datum));
  const rowsHtml = q => {
    const ql = q.toLowerCase().trim(), l = ql ? pays.filter(x => [x.p.gegenpartei, x.p.zweck, fmtE(x.p.betrag), x.p.betrag, fmtD(x.p.datum)].join(' ').toLowerCase().includes(ql)) : pays;
    return l.slice(0, 40).map((x, i) => `<tr><td>${x.kind === 'bank' ? 'Bank' : x.kind === 'kasse' ? 'Kasse' : 'EC'}</td><td>${fmtD(x.p.datum)}</td><td>${esc(x.p.gegenpartei || '')}<div class="zweck small">${esc(x.p.zweck || '')}</div></td><td class="num">${fmtE(x.rest)}</td>
      <td class="small">${x.s >= 50 ? '<b class="pos">passt gut</b><br>' : ''}${esc(x.why.join(', '))}</td><td><button class="btn sm primary" data-pick="${pays.indexOf(x)}">Zuordnen</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Keine offenen Zahlungen gefunden.</td></tr>';
  };
  const d = openSheet({
    title: 'Zahlung zuordnen · ' + (r.nummer || r.partner), wide: true, noOk: true, html: `
    <p class="small">Offen: <b>${fmtE(st.offen)}</b> von ${fmtE(r.brutto)}. Die passendsten Zahlungen stehen oben.</p>
    <input class="inp search" type="search" placeholder="Name, Verwendungszweck, Betrag …" id="pq">
    <label class="fld inline"><span>Betrag zuordnen</span><input class="inp" id="pb" type="number" step="0.01" placeholder="ganze offene Zahlung"></label>
    <div class="tw"><table class="tb"><tbody id="pl">${rowsHtml('')}</tbody></table></div>`
  });
  $('#pq', d).addEventListener('input', e => $('#pl', d).innerHTML = rowsHtml(e.target.value));
  d.addEventListener('click', async e => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const x = pays[+b.dataset.pick], amt = parseNum($('#pb', d).value) ?? x.rest;
    await zuordnen(r, x.p, x.kind, amt); closeSheet(); render(); rechnungDetail(r.id); toast('Zugeordnet.');
  });
}

async function bankDetail(id) {
  buildIdx();
  const b = S.bank.find(x => x.id === id); if (!b) return;
  const st = bStatus(b), vs = vorschlaege(b, 'bank'), inc = b.betrag > 0;
  const d = openSheet({
    title: 'Bankumsatz ' + fmtD(b.datum), wide: true, noOk: true, html: `
    <div class="det-head">${badge(st)} <b class="${inc ? 'pos' : 'neg'} big">${fmtE(b.betrag)}</b></div>
    <dl class="dl"><dt>Name</dt><dd>${esc(b.gegenpartei || '–')}</dd><dt>IBAN</dt><dd class="mono">${esc(b.iban || '–')}</dd><dt>Verwendungszweck</dt><dd>${esc(b.zweck || '–')}</dd>${b.valuta ? `<dt>Valuta</dt><dd>${fmtD(b.valuta)}</dd>` : ''}${b.konto ? `<dt>Konto</dt><dd>${esc(b.konto)}</dd>` : ''}</dl>
    <div class="form2">
      <label class="fld"><span>Art</span><select class="inp" id="bArt"><option value="">Normale Zahlung</option>${[['sumup', 'SumUp-Auszahlung'], ['privat', 'Privat'], ['intern', 'Umbuchung (eigenes Konto)'], ['ignoriert', 'Ignorieren']].map(([k, l]) => `<option value="${k}" ${b.art === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${!inc ? `<label class="fld"><span>Kostenart (wenn es keine Rechnung gibt)</span><select class="inp" id="bKa"><option value="">–</option>${KOSTENARTEN.map(k => `<option ${b.kostenart === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>` : ''}
    </div>
    <h4>Zugeordnete Rechnungen</h4>
    ${st.zuordnungen.length ? `<ul class="pays">${st.zuordnungen.map(z => { const r = S.rechnungen.find(x => x.id === z.rechnung_id); return `<li><span><a href="#" data-r="${z.rechnung_id}">${esc((r?.nummer || '') + ' · ' + (r?.partner || ''))}</a>${z.notiz ? ' <small class="muted">· ' + esc(z.notiz) + '</small>' : ''}</span><b>${fmtE(z.betrag)}</b><button class="icon-btn" data-delz="${z.id}" title="Lösen">✕</button></li>`; }).join('')}</ul>` : '<p class="muted small">Noch keine.</p>'}
    ${st.rest > 0.005 && !b.art ? `<h4>Passende Rechnungen ${st.zuordnungen.length ? '(Rest ' + fmtE(st.rest) + ')' : ''}</h4>
      ${vs.length ? `<div class="tw"><table class="tb"><tbody>${vs.map((x, i) => `<tr><td class="mono">${esc(x.r.nummer || '–')}</td><td>${fmtD(x.r.datum)}</td><td>${esc(x.r.partner || '')}</td><td class="num">${fmtE(x.r.brutto)}</td><td>${badge(x.st)}</td><td class="small">${esc(x.why.join(', '))}</td><td><button class="btn sm primary" data-v="${i}">Zuordnen</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Kein klarer Treffer. Rechnung suchen:</p>'}
      <input class="inp search" type="search" id="rq" placeholder="Rechnung suchen: Nr., Name, Betrag …"><div class="tw"><table class="tb"><tbody id="rl"></tbody></table></div>` : ''}
    ${!inc && DB.aiOn && !b.kostenart && !st.zuordnungen.length ? '<button class="btn sm" data-a="kika">✨ Kostenart von der KI vorschlagen</button>' : ''}`
  });
  const again = () => { render(); bankDetail(id); };
  const pick = async (r, amt) => { await zuordnen(r, b, 'bank', Math.min(st.rest, amt ?? st.rest) || st.rest); again(); toast('Zugeordnet.'); };
  $('#bArt', d).onchange = async e => { await DB.update('bank', id, { art: e.target.value || null }); again(); };
  const ka = $('#bKa', d); if (ka) ka.onchange = async e => { await DB.update('bank', id, { kostenart: e.target.value || null }); render(); toast('Gespeichert.'); };
  const rq = $('#rq', d); if (rq) rq.addEventListener('input', () => {
    const q = rq.value.toLowerCase().trim(); if (q.length < 2) return $('#rl', d).innerHTML = '';
    const l = S.rechnungen.filter(r => r.richtung === (inc ? 'ausgang' : 'eingang') && q.split(/\s+/).every(w => textOf(r).includes(w))).slice(0, 20);
    $('#rl', d).innerHTML = l.map(r => `<tr><td class="mono">${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td>${esc(r.partner || '')}</td><td class="num">${fmtE(r.brutto)}</td><td>${badge(rStatus(r))}</td><td><button class="btn sm primary" data-rid="${r.id}">Zuordnen</button></td></tr>`).join('') || '<tr><td class="empty">Nichts gefunden.</td></tr>';
  });
  d.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-delz]')) { await zuordnungLoeschen(t.closest('[data-delz]').dataset.delz); return again(); }
    if (t.closest('[data-r]')) { e.preventDefault(); return rechnungDetail(t.closest('[data-r]').dataset.r); }
    if (t.closest('[data-v]')) { const x = vs[+t.closest('[data-v]').dataset.v]; return pick(x.r, st.rest); }
    if (t.closest('[data-rid]')) { const r = S.rechnungen.find(x => x.id === t.closest('[data-rid]').dataset.rid); return pick(r, st.rest); }
    if (t.closest('[data-a=kika]')) {
      t.disabled = true; t.textContent = '✨ KI überlegt …';
      try { const x = await DB.aiJson(`Ordne diesen Bankabgang einer Kfz-Werkstatt einer Kostenart zu. Name: ${b.gegenpartei}. Verwendungszweck: ${b.zweck}. Betrag: ${b.betrag} EUR.
Kostenarten: ${KOSTENARTEN.join(', ')}. Antworte nur mit JSON {"kostenart":"…","grund":"kurz"}`, { tier: 'quick' });
        if (KOSTENARTEN.includes(x.kostenart)) { await DB.update('bank', id, { kostenart: x.kostenart }); toast('KI: ' + x.kostenart + ' – ' + (x.grund || '')); again(); } else toast('Keine eindeutige Kostenart.');
      } catch (err) { toast(aiErr(err)); t.disabled = false; }
    }
  });
}

async function sumupDetail(id) {
  buildIdx();
  const s = S.sumup.find(x => x.id === id); if (!s) return;
  const st = sStatus(s), vs = sumOk(s) ? vorschlaege({ ...s, zweck: s.beschreibung }, 'sumup') : [], bk = s.bank_id && S.bank.find(b => b.id === s.bank_id);
  const d = openSheet({
    title: 'EC-Zahlung (SumUp) ' + fmtD(s.datum), wide: true, noOk: true, html: `
    <div class="det-head">${badge(st)} <b class="big">${fmtE(s.betrag)}</b></div>
    <dl class="dl"><dt>Beschreibung</dt><dd>${esc(s.beschreibung || '–')}</dd><dt>Karte</dt><dd>${esc(s.zahlungsart || '–')}</dd><dt>Transaktion</dt><dd class="mono">${esc(s.transaktion || '–')}</dd>
      <dt>Gebühr</dt><dd>${fmtE(s.gebuehr)}</dd><dt>Auszahlung</dt><dd>${s.auszahlung != null ? fmtE(s.auszahlung) : '–'} ${s.auszahlung_datum ? 'am ' + fmtD(s.auszahlung_datum) : ''}${bk ? ' · ✓ auf dem Konto am ' + fmtD(bk.datum) : ''}</dd></dl>
    <h4>Rechnung</h4>
    ${st.zuordnungen.length ? `<ul class="pays">${st.zuordnungen.map(z => { const r = S.rechnungen.find(x => x.id === z.rechnung_id); return `<li><span><a href="#" data-r="${z.rechnung_id}">${esc((r?.nummer || '') + ' · ' + (r?.partner || ''))}</a></span><b>${fmtE(z.betrag)}</b><button class="icon-btn" data-delz="${z.id}">✕</button></li>`; }).join('')}</ul>` : ''}
    ${st.rest > 0.005 ? `${vs.length ? `<div class="tw"><table class="tb"><tbody>${vs.map((x, i) => `<tr><td class="mono">${esc(x.r.nummer || '–')}</td><td>${fmtD(x.r.datum)}</td><td>${esc(x.r.partner || '')}</td><td class="num">${fmtE(x.r.brutto)}</td><td>${badge(x.st)}</td><td><button class="btn sm primary" data-v="${i}">Zuordnen</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Kein klarer Treffer.</p>'}
      <input class="inp search" type="search" id="rq" placeholder="Rechnung suchen: Nr., Kunde, Betrag …"><div class="tw"><table class="tb"><tbody id="rl"></tbody></table></div>` : ''}`
  });
  const again = () => { render(); sumupDetail(id); };
  const rq = $('#rq', d); if (rq) rq.addEventListener('input', () => {
    const q = rq.value.toLowerCase().trim(); if (q.length < 2) return $('#rl', d).innerHTML = '';
    const l = S.rechnungen.filter(r => r.richtung === 'ausgang' && q.split(/\s+/).every(w => textOf(r).includes(w))).slice(0, 20);
    $('#rl', d).innerHTML = l.map(r => `<tr><td class="mono">${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td>${esc(r.partner || '')}</td><td class="num">${fmtE(r.brutto)}</td><td><button class="btn sm primary" data-rid="${r.id}">Zuordnen</button></td></tr>`).join('');
  });
  d.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-delz]')) { await zuordnungLoeschen(t.closest('[data-delz]').dataset.delz); return again(); }
    if (t.closest('[data-r]')) { e.preventDefault(); return rechnungDetail(t.closest('[data-r]').dataset.r); }
    const r = t.closest('[data-v]') ? vs[+t.closest('[data-v]').dataset.v].r : t.closest('[data-rid]') ? S.rechnungen.find(x => x.id === t.closest('[data-rid]').dataset.rid) : null;
    if (r) { await zuordnen(r, s, 'sumup', st.rest); again(); toast('Zugeordnet.'); }
  });
}
