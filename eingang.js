/* Mastercar Finanzen · Rechnungseingang: PDFs, Fotos oder ganze Mails (Outlook .msg / .eml) reinziehen.
   Die KI liest Lieferant, Nummer, Datum, Beträge, IBAN und Kostenart aus; der Beleg wird im Speicher abgelegt. */
const safeName = n => String(n || 'beleg').normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80);
async function fileHash(file) {
  try { const b = await file.slice(0, 2e6).arrayBuffer(); const h = await crypto.subtle.digest('SHA-256', b); return [...new Uint8Array(h)].slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join('') + '-' + file.size; }
  catch (e) { return hashStr(file.name + file.size); }
}
const isTable = f => /\.(xlsx|xlsm|xlsb|xls|csv)$/i.test(f.name || '');

async function kiBelegLesen(b) {
  const files = [];
  if (/pdf|image\//.test(b.type) && b.file.size < 15e6) files.push({ type: b.type === 'image/jpg' ? 'image/jpeg' : b.type, data: await fileToB64(b.file) });
  const mail = b.mail ? `\nDie Rechnung kam per E-Mail. Betreff: ${b.mail.subject}\nVon: ${b.mail.from}\nMailtext (Auszug): """${b.mail.text.slice(0, 3000)}"""\n` : '';
  if (!files.length && !mail) return null;
  return DB.aiJson(`Du liest eine Eingangsrechnung für die Kfz-Werkstatt „Mastercar Bornheim“ (Rechnungsempfänger: VE Sportmanagement UG (haftungsbeschränkt)).${mail}
Lies den Beleg genau. Beträge als Zahl (Punkt als Dezimaltrenner), Datum als JJJJ-MM-TT. Wenn ein Zahlungsziel in Tagen steht, das Fälligkeitsdatum ausrechnen.
Kostenart (GuV-Kategorie) genau eine aus: ${KOSTENARTEN.join(', ')}. Unterposition nur wenn passend, aus: ${GUV.filter(g => g.subs.length).map(g => g.k + ' → ' + g.subs.map(s => s[0]).join(' / ')).join('; ')}.
Antworte nur mit JSON:
{"ist_rechnung":true,"eigene_rechnung":false,"lieferant":"","nummer":"","datum":"","faellig":"","netto":0,"mwst":0,"brutto":0,"iban":"","kostenart":"","unterkonto":"","art":"Rechnung|Gutschrift|Korrektur|Vertrag|Beleg|Zahlungsavis","avis_betrag":0,"avis_rechnungen":[],"mahnung":0,"mahnung_rechnungen":[],"beschreibung":"kurz: was wurde geliefert/geleistet","bezahlung":"offen|lastschrift|bereits_bezahlt","gutschrift":false}
ist_rechnung=false, wenn es keine Rechnung/Gutschrift ist (z. B. AGB, Lieferschein, Werbung).
Zahlungsavis (Zahlungsankündigung, Lastschrift-Vorabinformation, Zahlungsbestätigung/Überweisungsavis eines Kunden oder Lieferanten): ist_rechnung=true, art="Zahlungsavis", lieferant = wer das Avis geschickt hat, nummer = Avis-/Belegnummer, datum = Datum des Avis, brutto=0, netto=0, mwst=0, avis_betrag = genannte Zahlungssumme, avis_rechnungen = alle genannten Rechnungsnummern (z. B. ["R26-0491","4711"]).
mahnung: 0 = keine Mahnung. 1 = Zahlungserinnerung, 1. Mahnung oder Mail/Schreiben, dass eine Rechnung „noch offen“ ist. 2 = 2. Mahnung. 3 = 3./letzte Mahnung, Inkasso-Androhung. Gilt auch, wenn die Rechnung selbst nur angehängt ist und Mail oder Schreiben auf die offene Zahlung hinweist; dann die Felder der angehängten Rechnung trotzdem ausfüllen. mahnung_rechnungen = alle angemahnten Rechnungsnummern.
eigene_rechnung=true, wenn Mastercar Bornheim / VE Sportmanagement selbst die Rechnung AUSGESTELLT hat (Kundenrechnung der Werkstatt, Nummer wie R26-0491); dann bei "lieferant" den Kunden eintragen.`, { files, tier: 'quick' });
}

const MLABEL = ['Mahnung', '2. Mahnung', '3. Mahnung'];
const MSTUFE = { 'Mahnung': 1, '2. Mahnung': 2, '3. Mahnung': 3 };

/* ---------- Sammelkorb: Dateien erst sammeln (mehrmals reinziehen/auswählen), dann mit einem Klick verarbeiten ---------- */
const KORB = [];
const kb = n => n > 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const korbIcon = f => isTable(f) ? '📊' : /\.(eml|msg)$/i.test(f.name) ? '✉️' : /^image\//.test(f.type) ? '🖼' : '📄';
function korbAdd(files) {
  let neu = 0;
  [...files].forEach(f => { if (!KORB.some(k => k.name === f.name && k.size === f.size && k.lastModified === f.lastModified)) { KORB.push(f); neu++; } });
  korbRender(true); if (neu) toast(`${neu} Datei${neu === 1 ? '' : 'en'} im Stapel – weitere dazu oder „Verarbeiten“.`);
}
function korbRender(auf) {
  let el = $('#korb'); if (!KORB.length) { el?.remove(); return; }
  if (!el) { el = document.createElement('section'); el.id = 'korb'; el.className = 'korb'; el.setAttribute('aria-label', 'Stapel zum Verarbeiten'); document.body.appendChild(el); }
  if (auf) el.classList.remove('zu');
  const tab = KORB.filter(isTable).length, doc = KORB.length - tab;
  el.innerHTML = `<header data-act="korbZu"><b>📥 Stapel: ${KORB.length} Datei${KORB.length === 1 ? '' : 'en'}</b><span class="small muted">${[doc ? doc + ' Beleg' + (doc === 1 ? '' : 'e') : '', tab ? tab + ' Excel/CSV' : ''].filter(Boolean).join(' · ')}</span><span class="sp"></span><span class="kz">▾</span></header>
    <ul>${KORB.map((f, i) => `<li><span>${korbIcon(f)}</span><span class="kn" title="${esc(f.name)}">${esc(f.name)}</span><small class="muted">${kb(f.size)}</small><button class="icon-btn" data-act="korbDel" data-i="${i}" aria-label="${esc(f.name)} entfernen">✕</button></li>`).join('')}</ul>
    <p class="small muted">Weitere Dateien einfach ins Fenster ziehen – sie kommen dazu.</p>
    ${ablageMoeglich() ? (ABLAGE ? `<p class="small">📁 Umbenannte Belege kommen in: <b>${esc(ABLAGE.name)}</b></p>`
      : `<div class="warn small">Noch kein OneDrive-Ordner gewählt – die Belege würden nur in der App liegen. <button class="btn sm" data-act="ablageWahl">📁 Ordner wählen</button></div>`) : ''}
    <div class="btnrow"><button class="btn primary" data-act="korbGo">✓ Alle ${KORB.length} verarbeiten</button><button class="btn" data-act="korbPick">＋ Dateien</button><button class="btn" data-act="korbLeer">Leeren</button></div>`;
}
async function korbVerarbeiten() {
  const fs = KORB.splice(0); korbRender();
  if (fs.length) await eingangDrop(fs);
}

async function eingangDrop(fileList) {
  const files = [...fileList];
  const tables = files.filter(isTable);
  if (tables.length) { tables.forEach(f => importAuto(f)); }
  const docs = files.filter(f => !isTable(f)); if (!docs.length) return;
  const ablage = await ablageOrdner(true), logStart = ABLAGE_LOG.length;   // gleich beim Reinziehen fragen – nur dann darf der Browser um Erlaubnis bitten
  busy(true, 'Lese Belege …');
  const belege = []; for (const f of docs) { try { belege.push(...await fileToBelege(f)); } catch (e) { console.warn(e); } }
  if (!belege.length) { busy(false); return toast('Kein Beleg (PDF/Bild) gefunden.'); }
  const neu = [], doppelt = [], fehler = [], keine = [], ergaenzt = [], avise = [], mahnungen = [], mahnGesehen = new Set();
  buildIdx();
  // Viele PDFs: immer 3 gleichzeitig von der KI lesen lassen
  let fertig = 0;
  busy(true, `${belege.length} Beleg${belege.length === 1 ? '' : 'e'}` + (DB.aiOn ? ' – KI liest …' : ' …'));
  // PDF an eine schon vorhandene Rechnung (z. B. aus der Excel) hängen statt sie doppelt anzulegen
  const anhaengen = async (r, b) => {
    if (r.datei) { doppelt.push(b.name + (r.nummer ? ' (Nr. ' + r.nummer + ', hat schon eine PDF)' : '')); return; }
    await belegAnhaengen(r, b.file); ergaenzt.push(r);
  };
  // Zahlungsavis: eigener Eintrag (Art „Zahlungsavis“, Betrag 0 → zählt nicht in GuV/Offene Posten), PDF benannt und abgelegt,
  // bei den genannten Rechnungen wird ein Hinweis in die Notiz geschrieben
  const avisAnlegen = async (x, b) => {
    const fh = await fileHash(b.file);
    if (S.rechnungen.some(r => r.schluessel === 'AV:' + fh)) { doppelt.push(b.name); return; }
    const partner = String(x.lieferant || '').trim() || (b.mail && b.mail.from ? b.mail.from.replace(/<.*>/, '').trim() : b.name);
    const datum = parseDate(x.datum) || todayISO(), betrag = parseNum(x.avis_betrag);
    const nrn = (Array.isArray(x.avis_rechnungen) ? x.avis_rechnungen : []).map(n => String(n).trim()).filter(Boolean);
    const bezug = nrn.map(n => ausgangAusText(n) || S.rechnungen.find(r => r.nummer && normNr(r.nummer) === normNr(n))).filter(Boolean);
    const row = { richtung: 'eingang', art: 'Zahlungsavis', partner, nummer: String(x.nummer || '').trim() || null, datum, brutto: 0, netto: 0, mwst: 0,
      beschreibung: `Zahlungsavis${betrag != null ? ' über ' + fmtE(betrag) : ''}${nrn.length ? ' für ' + nrn.join(', ') : ''}`, erledigt: true, status_excel: 'Bezahlt',
      quelle: DB.aiOn ? 'ki' : 'manuell', geprueft: false, schluessel: 'AV:' + fh,
      notiz: bezug.length ? 'Betrifft: ' + bezug.map(r => (r.nummer || '') + ' ' + (r.partner || '')).join(', ') : null };
    Object.assign(row, await belegSpeichern(row, b.file));
    const [n] = await DB.insert('rechnungen', [row]); if (!n) { doppelt.push(b.name); return; }
    avise.push({ r: n, bezug });
    for (const r of bezug) { const z = `Zahlungsavis vom ${fmtD(datum)}${betrag != null ? ' (' + fmtE(betrag) + ')' : ''} liegt vor`; if (!(r.notiz || '').includes(z)) await DB.update('rechnungen', r.id, { notiz: [r.notiz, z].filter(Boolean).join(' · ') }); }
  };
  // Mahnung / Zahlungserinnerung: angemahnte Rechnung(en) suchen, Status hochsetzen (Mahnung → 2. → 3. Mahnung),
  // fehlende Rechnungs-PDF ergänzen; das Mahnschreiben selbst wird als eigener Eintrag (Art „Mahnung“) mit PDF abgelegt.
  // Gibt true zurück, wenn nichts weiter zu tun ist; false = Rechnung noch nicht da → normal anlegen (mit Mahnstatus).
  const mahnungVerarbeiten = async (x, b) => {
    const stufe = Math.min(3, Math.max(1, parseInt(x.mahnung) || 1));
    const nrn = [...new Set([...(Array.isArray(x.mahnung_rechnungen) ? x.mahnung_rechnungen : []), x.nummer].map(n => String(n || '').trim()).filter(Boolean))];
    const ziele = S.rechnungen.filter(r => r.richtung === 'eingang' && r.art !== 'Mahnung' && r.art !== 'Zahlungsavis' && r.nummer && nrn.some(n => normNr(n) === normNr(r.nummer)));
    const mailKey = b.mail || b;   // eine Mail mit mehreren Anhängen nur einmal als Mahnung zählen
    const ersteMal = !mahnGesehen.has(mailKey); mahnGesehen.add(mailKey);
    const datum = parseDate(b.mail && b.mail.date) || todayISO();
    if (ersteMal) {
      for (const r of ziele) {
        const cur = MSTUFE[r.status_excel] || 0, neu = Math.min(3, Math.max(stufe, cur + 1)), label = MLABEL[neu - 1];
        const bezahlt = istBezahltLaut(r.status_excel) || (IDX.zByR.get(r.id) || []).length;
        const z = `${label} am ${fmtD(datum)} erhalten${bezahlt ? ' – war als bezahlt markiert, bitte prüfen' : ''}`;
        await DB.update('rechnungen', r.id, { status_excel: label, bezahlt_extern: false, notiz: [r.notiz, z].filter(Boolean).join(' · ') });
      }
      // Mahnschreiben ablegen: bei Mail der Mailtext als PDF, sonst die Datei selbst (wenn sie keine Rechnung ist)
      const doc = b.mail ? new File([textPdf(b.mail.subject || 'Mahnung', `Von: ${b.mail.from}\n\n${b.mail.text}`)], 'Mahnung.pdf', { type: 'application/pdf' }) : (!x.ist_rechnung || !x.brutto ? b.file : null);
      const ziel = ziele[0];
      const row = { richtung: 'eingang', art: 'Mahnung', partner: (ziel && ziel.partner) || String(x.lieferant || '').trim() || b.name, nummer: (ziel && ziel.nummer) || nrn[0] || null, datum, brutto: 0, netto: 0, mwst: 0,
        beschreibung: `${MLABEL[stufe - 1]}${nrn.length ? ' für ' + nrn.join(', ') : ''}`, erledigt: true, status_excel: 'Bezahlt', quelle: DB.aiOn ? 'ki' : 'manuell', geprueft: false,
        schluessel: 'MA:' + (await fileHash(doc || b.file)), notiz: ziele.length ? 'Betrifft: ' + ziele.map(r => (r.nummer || '') + ' ' + (r.partner || '')).join(', ') : 'Angemahnte Rechnung ist noch nicht in der App' };
      if (doc && !S.rechnungen.some(r => r.schluessel === row.schluessel)) { Object.assign(row, await belegSpeichern(row, doc)); await DB.insert('rechnungen', [row]); }
      mahnungen.push({ label: MLABEL[stufe - 1], partner: row.partner, nrn, ziele: ziele.map(r => S.rechnungen.find(y => y.id === r.id)) });
    }
    // Angehängte Rechnung: PDF an die vorhandene hängen – oder (noch nicht da) gleich als Rechnung mit Mahnstatus anlegen
    if (x.ist_rechnung !== false && x.brutto && x.nummer) {
      const r = ziele.find(r => normNr(r.nummer) === normNr(x.nummer));
      if (r) { if (!r.datei) { await belegAnhaengen(r, b.file); ergaenzt.push(r); } return true; }
      x._mahnStatus = MLABEL[stufe - 1]; return false;
    }
    return true;
  };
  const eins = async b => {
    try {
      // Mail ohne PDF-Anhang: aus dem Mailtext eine PDF machen, damit jede Buchung eine PDF hat
      if (b.type === 'message/rfc822' && b.mail) { b.file = new File([textPdf(b.mail.subject || 'E-Mail', `Von: ${b.mail.from}\n\n${b.mail.text}`)], (b.mail.subject || 'Mail') + '.pdf', { type: 'application/pdf' }); b.type = 'application/pdf'; b.name = b.file.name; }
      // Eigene Kundenrechnung (R26-…) am Dateinamen erkannt → PDF direkt an die Ausgangsrechnung, ohne KI
      const eigen = ausgangAusText(b.name); if (eigen) return anhaengen(eigen, b);
      let x = null;
      if (DB.aiOn) { try { x = await kiBelegLesen(b); } catch (e) { fehler.push(b.name + ': ' + aiErr(e)); } }
      if (x && +x.mahnung > 0 && await mahnungVerarbeiten(x, b)) return;
      if (x && x.ist_rechnung === false) { keine.push(b.name); return; }
      x = x || {};
      if (x.art === 'Zahlungsavis') return avisAnlegen(x, b);
      if (x.eigene_rechnung) { const r = ausgangAusText(x.nummer); if (r) return anhaengen(r, b); fehler.push(`${b.name}: eigene Rechnung ${x.nummer || ''} – nicht in der App gefunden (erst das Werkstatt Journal importieren)`); return; }
      const fh = await fileHash(b.file);
      let brutto = parseNum(x.brutto), netto = parseNum(x.netto), mwst = parseNum(x.mwst);
      if (brutto == null && netto != null) brutto = r2(netto + (mwst || 0));
      if (x.gutschrift && brutto > 0) { brutto = -brutto; if (netto) netto = -netto; if (mwst) mwst = -mwst; }
      const partner = String(x.lieferant || '').trim() || (b.mail && b.mail.from ? b.mail.from.replace(/<.*>/, '').trim() : '');
      const nummer = String(x.nummer || '').trim();
      const schluessel = nummer ? 'E:' + (nameTokens(partner)[0] || '') + ':' + normNr(nummer) : 'F:' + fh;
      if (S.rechnungen.some(r => r.schluessel === 'F:' + fh)) { doppelt.push(b.name); return; }
      // Gleiche Rechnung schon da (auch aus der Excel, dort hat der Schlüssel noch „:R“/„:G“) → nur die PDF ergänzen
      const tok = nameTokens(partner)[0] || '';
      const da = nummer && S.rechnungen.find(r => r.richtung === 'eingang' && r.nummer && normNr(r.nummer) === normNr(nummer) &&
        (r.schluessel === schluessel || (tok && (nameTokens(r.partner || '')[0] || '') === tok) || (brutto != null && eq(Math.abs(r.brutto || 0), Math.abs(brutto)))));
      if (da) return anhaengen(da, b);
      const datum = parseDate(x.datum) || todayISO();
      const row = { richtung: 'eingang', nummer: nummer || null, datum, faellig: parseDate(x.faellig), partner: partner || b.name, netto, mwst, brutto: r2(brutto || 0),
        kostenart: KOSTENARTEN.includes(x.kostenart) ? x.kostenart : kostenartVorschlag('', partner),
        unterkonto: UNTERKONTEN(x.kostenart).includes(x.unterkonto) ? x.unterkonto : null, art: x.gutschrift ? 'Gutschrift' : (['Rechnung', 'Korrektur', 'Vertrag', 'Beleg'].includes(x.art) ? x.art : 'Rechnung'), iban: String(x.iban || '').replace(/\s/g, '').toUpperCase() || null,
        beschreibung: String(x.beschreibung || '').trim() || (b.mail ? b.mail.subject : null), zahlart: x.bezahlung === 'lastschrift' ? 'bank' : null,
        datei: null, dateiname: b.name, quelle: DB.aiOn && x.brutto != null ? 'ki' : 'manuell', geprueft: false, schluessel,
        status_excel: x._mahnStatus ? x._mahnStatus : x.bezahlung === 'lastschrift' ? 'Abbuchung offen' : x.bezahlung === 'bereits_bezahlt' ? 'Bezahlt' : 'Offen',
        notiz: x.bezahlung === 'lastschrift' ? 'Laut Beleg per Lastschrift' : x.bezahlung === 'bereits_bezahlt' ? 'Laut Beleg bereits bezahlt' : null };
      // Datei nach Schema benennen: VE Sport_Lieferant_Art_Nummer_Datum.pdf – in der Cloud und (falls gewählt) im Ablage-Ordner
      Object.assign(row, await belegSpeichern(row, b.file));
      const added = await DB.insert('rechnungen', [row]);
      if (added.length) neu.push(added[0]); else doppelt.push(b.name);
    } catch (e) { console.error(e); fehler.push(b.name + ': ' + (e.message || e)); }
    finally { fertig++; busy(true, `Belege: ${fertig} von ${belege.length} fertig` + (DB.aiOn ? ' – KI liest …' : ' …')); }
  };
  const warte = belege.slice();
  await Promise.all([0, 1, 2].map(async () => { while (warte.length) await eins(warte.shift()); }));
  busy(true, 'Gleiche mit Bank ab …');
  const res = await autoAbgleich().catch(() => ({ n: 0 }));
  busy(false); UI.view = 'eingang'; render();
  openSheet({
    title: 'Belege übernommen', noOk: true, wide: true, html: `
    ${neu.length ? `<p><b>${neu.length}</b> Eingangsrechnung${neu.length === 1 ? '' : 'en'} angelegt${DB.aiOn ? ' – von der KI ausgelesen, bitte kurz prüfen' : ' – bitte Beträge eintragen (KI nur online)'}.${res.n ? ' ' + res.n + ' Zahlung(en) automatisch zugeordnet.' : ''}</p>
    ${ablageMeldung(ABLAGE_LOG.slice(logStart))}<p class="small muted">Dateiname: VE Sport_Firma_Art_Nummer_Datum</p>
    <div class="tw"><table class="tb click"><thead><tr><th>Lieferant</th><th>Nr.</th><th>Datum</th><th class="num">Brutto</th><th>Kostenart</th></tr></thead><tbody>
    ${neu.map(r => `<tr data-act="rechnung" data-id="${r.id}"><td>${esc(r.partner)}</td><td>${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td class="num">${fmtE(r.brutto)}</td><td>${esc(r.kostenart || '–')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${ergaenzt.length ? `<p><b>${ergaenzt.length}</b> PDF${ergaenzt.length === 1 ? '' : 's'} an vorhandene Rechnungen gehängt:</p><div class="tw"><table class="tb click"><tbody>${ergaenzt.map(r => `<tr data-act="rechnung" data-id="${r.id}"><td>${r.richtung === 'ausgang' ? '↗ Ausgang' : '↘ Eingang'}</td><td>${esc(r.partner || '')}</td><td class="mono">${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td class="num">${fmtE(r.brutto)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${mahnungen.length ? `<p><b>${mahnungen.length}</b> Mahnung${mahnungen.length === 1 ? '' : 'en'} erkannt:</p><div class="tw"><table class="tb click"><tbody>${mahnungen.map(m => m.ziele.length ? m.ziele.map(r => `<tr data-act="rechnung" data-id="${r.id}"><td>${esc(m.label)}</td><td>${esc(r.partner || '')}</td><td class="mono">${esc(r.nummer || '')}</td><td class="num">${fmtE(r.brutto)}</td><td>→ Status jetzt <b>${esc(r.status_excel)}</b></td></tr>`).join('')
      : `<tr><td>${esc(m.label)}</td><td>${esc(m.partner)}</td><td class="mono">${esc(m.nrn.join(', '))}</td><td></td><td class="muted">Rechnung war noch nicht in der App${neu.some(r => m.nrn.some(n => normNr(n) === normNr(r.nummer || ''))) ? ' – jetzt mit Mahnstatus angelegt' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${avise.length ? `<p><b>${avise.length}</b> Zahlungsavis abgelegt:</p><div class="tw"><table class="tb click"><tbody>${avise.map(({ r, bezug }) => `<tr data-act="rechnung" data-id="${r.id}"><td>${esc(r.partner || '')}</td><td>${fmtD(r.datum)}</td><td>${esc(r.beschreibung || '')}</td><td class="small">${bezug.length ? '→ ' + bezug.map(x => esc(x.nummer || '')).join(', ') : '<span class="muted">keine passende Rechnung gefunden</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${doppelt.length ? `<div class="warn">Schon vorhanden, nicht nochmal angelegt: ${doppelt.map(esc).join(', ')}</div>` : ''}
    ${keine.length ? `<div class="note">Keine Rechnung (übersprungen): ${keine.map(esc).join(', ')}</div>` : ''}
    ${fehler.length ? `<div class="warn">Probleme: ${fehler.map(esc).join('<br>')}</div>` : ''}`
  });
}

// Excel/CSV erkannt: anhand der Spalten raten, welcher Import gemeint ist
async function importAuto(file) {
  try {
    const t = await readTable(file);
    if (Object.keys(mappeBlaetter(t)).length) return importMappe(file, t);   // Arbeitsmappe, Werkstatt Journal oder Barkasse (am Namen oder an den Überschriften erkannt)
    const rows = t.sheets[0]?.rows || [];
    const type = detectType(rows);
    toast('Erkannt: ' + IMP[type].label);
    importFile(type, file);
  } catch (e) { toast('Datei nicht lesbar: ' + e.message); }
}
