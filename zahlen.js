/* Mastercar Finanzen · „Bezahlen“: alle offenen Eingangsrechnungen, die überwiesen werden müssen
   (nicht „Abbuchung offen“ / SEPA – die laufen per Lastschrift). Je Rechnung: PDF ansehen, Empfänger, IBAN, Betrag,
   Verwendungszweck zum Kopieren und ein GiroCode (QR) zum Scannen mit der Banking-App. */

function zuZahlen() {
  buildIdx();
  return S.rechnungen.filter(r => r.richtung === 'eingang' && !DOK_ARTEN.includes(r.art) && (+r.brutto || 0) > 0)
    .map(r => ({ r, st: rStatus(r) }))
    .filter(x => ['offen', 'ueberfaellig', 'teil'].includes(x.st.key) && x.st.offen > 0.005 && !/^abbuchung/i.test(x.r.status_excel || '') && x.r.zahlart !== 'sepa')
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
  const karte = ({ r, st, faellig }) => {
    const ib = ibanVorschlag(r), betrag = r2(st.offen), zweck = zweckVon(r), spaet = faellig && faellig < heute;
    return `<article class="pz ${spaet ? 'spaet' : ''}" data-rid="${r.id}">
      <header><div><b>${esc(r.partner || '–')}</b> <span class="muted small">· ${esc(r.art || 'Rechnung')} ${esc(r.nummer || '')} vom ${fmtD(r.datum)}</span></div>
        <span class="sp"></span>${badge({ cls: spaet ? 'st-late' : 'st-open', label: faellig ? (spaet ? 'fällig seit ' : 'fällig ') + fmtD(faellig) : 'ohne Fälligkeit' })} ${/mahn/i.test(r.status_excel || '') ? badge({ cls: 'st-bad', label: r.status_excel }) : ''}</header>
      <div class="pz-g">
        ${feld('Empfänger', r.partner || '', 'Empfänger')}
        ${feld('IBAN' + (ib && ib.quelle !== 'Rechnung' ? ` <small class="muted">(${esc(ib.quelle)})</small>` : ''), ib ? ibanSchoen(ib.iban) : '', 'IBAN', true)}
        ${feld('Betrag' + (r.skonto ? ` <small class="muted">(mit Skonto ${fmtE(r.skonto)})</small>` : st.key === 'teil' ? ' <small class="muted">(Rest)</small>' : ''), betrag.toFixed(2).replace('.', ','), 'Betrag', true)}
        ${feld('Verwendungszweck', zweck, 'Verwendungszweck')}
      </div>
      <div class="btnrow">
        ${r.datei ? `<button class="btn sm" data-pdf="${r.id}">📄 PDF ansehen</button>` : '<span class="small muted">keine PDF</span>'}
        ${ib ? `<button class="btn sm" data-qr="${r.id}">▦ GiroCode</button>` : r.datei && DB.aiOn ? `<button class="btn sm" data-ibanki="${r.id}">🔎 IBAN aus PDF lesen</button>` : ''}
        ${!ib ? `<button class="btn sm" data-ibanhand="${r.id}">IBAN eintragen</button>` : ''}
        <button class="btn sm" data-copy="${esc(`Empfänger: ${r.partner || ''}\nIBAN: ${ib ? ibanSchoen(ib.iban) : ''}\nBetrag: ${fmtE(betrag)}\nVerwendungszweck: ${zweck}`)}" data-was="Überweisungsdaten">⧉ Alles kopieren</button>
        <button class="btn sm" data-a="detail" data-id="${r.id}">Rechnung öffnen</button>
        <span class="sp"></span><button class="btn sm primary" data-ueberw="${r.id}">✓ Überwiesen</button>
      </div>
      <div class="pz-qr" hidden></div>
    </article>`;
  };
  const d = openSheet({
    title: '💸 Bezahlen', wide: true, noOk: true, html: `
    <div class="sumline"><b>${list.length}</b> offene Rechnung${list.length === 1 ? '' : 'en'} zum Überweisen · zusammen <b>${fmtE(sum(list, x => x.st.offen))}</b>
      · davon überfällig ${list.filter(x => x.faellig && x.faellig < heute).length} <span class="muted">(ohne „Abbuchung offen“ / SEPA – die werden abgebucht)</span></div>
    <input class="inp search" type="search" id="pzQ" placeholder="Suchen: Lieferant, Nummer, Betrag …">
    <div id="pzL">${list.map(karte).join('') || '<div class="empty">Nichts zu überweisen – alles bezahlt oder per Lastschrift. 🎉</div>'}</div>` });
  d.addEventListener('input', e => { if (e.target.id !== 'pzQ') return; const q = norm(e.target.value); $$('.pz', d).forEach(a => a.hidden = q && !norm(a.innerText).includes(q)); });
  d.addEventListener('click', async e => {
    const c = e.target.closest('[data-copy]'); if (c) return kopieren(c.dataset.copy, c.dataset.was);
    const p = e.target.closest('[data-pdf]');
    if (p) { const r = S.rechnungen.find(x => x.id === p.dataset.pdf), w = window.open('', '_blank'); try { const u = await DB.fileUrl(r.datei); if (w) w.location = u; else window.open(u, '_blank'); } catch (er) { if (w) w.close(); toast('PDF nicht gefunden.'); } return; }
    const q = e.target.closest('[data-qr]');
    if (q) {
      const art = q.closest('.pz'), box = $('.pz-qr', art); if (!box.hidden) { box.hidden = true; return; }
      const r = S.rechnungen.find(x => x.id === q.dataset.qr), ib = ibanVorschlag(r);
      try { await qrLaden(); box.innerHTML = '<div class="pz-qrc"></div><p class="small muted">Mit der Banking-App scannen (Foto-Überweisung / GiroCode) – Empfänger, IBAN, Betrag und Verwendungszweck sind schon ausgefüllt.</p>';
        new QRCode($('.pz-qrc', box), { text: girocode(r.partner || '', ib.iban, r2(rStatus(r).offen), zweckVon(r)), width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M }); box.hidden = false; }
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
      await DB.update('rechnungen', r.id, { iban }); toast('IBAN gespeichert'); closeSheet(); bezahlenAnsicht();
      setTimeout(() => $(`#sheet .pz[data-rid="${r.id}"]`)?.scrollIntoView({ block: 'center' }), 50); return;
    }
    const u = e.target.closest('[data-ueberw]');
    if (u) {
      const r = S.rechnungen.find(x => x.id === u.dataset.ueberw);
      await DB.update('rechnungen', r.id, { status_excel: 'Bezahlt', bezahlt_extern: true, notiz: [r.notiz, 'überwiesen am ' + fmtD(todayISO())].filter(Boolean).join(' · ') });
      const art = u.closest('.pz'); art.classList.add('fertig'); setTimeout(() => art.remove(), 400);
      toast('Als überwiesen markiert – die Bank-Buchung wird später automatisch zugeordnet.'); render(); return;
    }
    const det = e.target.closest('[data-a="detail"]'); if (det) rechnungDetail(det.dataset.id);
  });
}
