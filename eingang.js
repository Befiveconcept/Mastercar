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
{"ist_rechnung":true,"kontoauszug":false,"eigene_rechnung":false,"lieferant":"","nummer":"","datum":"","faellig":"","netto":0,"mwst":0,"brutto":0,"iban":"","kostenart":"","unterkonto":"","art":"Rechnung|Gutschrift|Korrektur|Vertrag|Beleg|Zahlungsavis","avis_betrag":0,"avis_rechnungen":[],"mahnung":0,"mahnung_rechnungen":[],"bezug_rechnung":"","kennzeichen":"","kundennr":"","zahlart":"bar|ec|ueberweisung|","lohn":0,"teile":0,"beschreibung":"kurz: was wurde geliefert/geleistet","bezahlung":"offen|lastschrift|bereits_bezahlt","gutschrift":false}
ist_rechnung=false, wenn es keine Rechnung/Gutschrift ist (z. B. AGB, Lieferschein, Werbung).
kontoauszug=true (und sonst nichts ausfüllen), wenn es ein Kontoauszug / eine Umsatzliste einer Bank ist.
Zahlungsavis (Zahlungsankündigung, Lastschrift-Vorabinformation, Zahlungsbestätigung/Überweisungsavis eines Kunden oder Lieferanten): ist_rechnung=true, art="Zahlungsavis", lieferant = wer das Avis geschickt hat, nummer = die Nummer des Avis (steht als Avis-Nr., Zahlungsavis-Nr., Zahlungsnummer, Belegnummer, Referenz oder Dokumentnummer – unbedingt angeben, nie leer lassen, wenn irgendeine solche Nummer vorkommt), datum = Datum des Avis, brutto=0, netto=0, mwst=0, avis_betrag = genannte Zahlungssumme, avis_rechnungen = alle genannten Rechnungsnummern (z. B. ["R26-0491","4711"]).
bezug_rechnung: bei Gutschrift, Korrektur oder Storno die Nummer der ursprünglichen Rechnung, auf die sie sich bezieht (steht meist als „zu Rechnung …“, „Bezug“, „Originalrechnung“), sonst "". Gutschriften und Korrekturen, die den Betrag mindern, mit gutschrift=true.
mahnung: 0 = keine Mahnung. 1 = Zahlungserinnerung, 1. Mahnung oder Mail/Schreiben, dass eine Rechnung „noch offen“ ist. 2 = 2. Mahnung. 3 = 3./letzte Mahnung, Inkasso-Androhung. Gilt auch, wenn die Rechnung selbst nur angehängt ist und Mail oder Schreiben auf die offene Zahlung hinweist; dann die Felder der angehängten Rechnung trotzdem ausfüllen. mahnung_rechnungen = alle angemahnten Rechnungsnummern.
eigene_rechnung=true, wenn Mastercar Bornheim / VE Sportmanagement selbst die Rechnung AUSGESTELLT hat (Kundenrechnung der Werkstatt, Nummer wie R26-0491); dann bei "lieferant" den KUNDEN eintragen, dazu kennzeichen, kundennr, zahlart (falls angegeben: bar, ec/Karte, Überweisung), lohn = Arbeitslohn netto, teile = Ersatzteile netto.`, { files, tier: 'quick' });
}

/* ---------- Kontoauszug als PDF (oder Foto): KI liest alle Buchungen → Bank, gleicher Schlüssel wie beim CSV/Excel-Import,
   damit dieselbe Buchung aus PDF und Excel nicht doppelt entsteht. Danach automatischer Abgleich mit Ein- und Ausgaben. */
const istAuszugName = n => /konto.?auszug|kontoauszug|\bauszug\b|bank.?statement|ums(a|ä)tze|statement/i.test(n || '');
async function kontoauszugLesen(b) {
  const data = await fileToB64(b.file);
  return DB.aiJson(`Das ist ein Kontoauszug der Firma VE Sportmanagement UG / Mastercar Bornheim. Lies ALLE Buchungen vollständig ab (keine auslassen, keine Summenzeilen).
Antworte nur mit JSON:
{"konto":"IBAN oder Kontonummer des Kontos","bank":"","von":"JJJJ-MM-TT","bis":"JJJJ-MM-TT","anfangssaldo":0,"endsaldo":0,
 "buchungen":[{"datum":"JJJJ-MM-TT (Buchungstag)","valuta":"JJJJ-MM-TT","betrag":-12.34,"gegenpartei":"Name des Zahlungsempfängers bzw. Auftraggebers","iban":"","buchungstext":"z. B. Lastschrift, Überweisung, Gutschrift, Kartenzahlung, Entgelt","zweck":"Verwendungszweck vollständig, inkl. Rechnungs-/Mandatsnummern"}]}
Betrag: Abbuchung/Belastung NEGATIV, Gutschrift/Eingang POSITIV. Datum immer mit Jahr.`, { files: [{ type: /pdf/.test(b.type) ? 'application/pdf' : b.type, data }], tier: 'default' });
}
function auszugZeilen(j) {
  const seen = {}, out = [];
  (j.buchungen || []).forEach(x => {
    const datum = parseDate(x.datum), betrag = parseNum(x.betrag); if (!datum || betrag == null) return;
    const zw = String(x.zweck || '').replace(/\s+/g, ' ').trim(), gp = String(x.gegenpartei || '').trim(), bt = String(x.buchungstext || '').trim();
    const k = [datum, r2(betrag), normNr(zw).slice(0, 60), normNr(gp).slice(0, 30)].join('|'); seen[k] = (seen[k] || 0) + 1;   // wie importer.js
    out.push({ konto: String(j.konto || '').replace(/\s/g, '') || null, datum, valuta: parseDate(x.valuta), betrag: r2(betrag), gegenpartei: gp || null,
      iban: String(x.iban || '').replace(/\s/g, '').toUpperCase() || null, zweck: [bt, zw].filter(Boolean).join(': ') || null, schluessel: 'B' + hashStr(k + '|' + seen[k]) });
  });
  return out;
}
async function kontoauszugImport(b) {
  const j = await kontoauszugLesen(b), rows = auszugZeilen(j);
  if (!rows.length) throw new Error('keine Buchungen erkannt');
  // Saldo-Probe: Anfangssaldo + Buchungen = Endsaldo?
  const a = parseNum(j.anfangssaldo), e = parseNum(j.endsaldo), summe = sum(rows, r => r.betrag);
  const probe = a != null && e != null ? (eq(r2(a + summe), e) ? 'ok' : `Saldo passt nicht: ${fmtE(a)} + ${fmtE(summe)} ≠ ${fmtE(e)} – evtl. fehlt eine Buchung`) : null;
  const [imp] = await DB.insert('importe', [{ art: 'bank', datei: b.name, zeilen: rows.length }]);
  const mit = rows.map(r => ({ ...r, import_id: imp.id })); markBankArten(mit);
  const added = await DB.insert('bank', mit);
  DB.update('importe', imp.id, { neu: added.length, doppelt: rows.length - added.length }).catch(() => { });
  return { name: b.name, n: rows.length, neu: added.length, von: parseDate(j.von), bis: parseDate(j.bis), probe, summe };
}

// Ursprüngliche Rechnung zu einer Gutschrift/Korrektur finden: Nummer laut Beleg (gleicher Lieferant bevorzugt),
// sonst eindeutig: gleicher Lieferant, Rechnung mit genau dem Betrag der Gutschrift in den 120 Tagen davor
function bezugFinden(nr, partner, g) {
  const tok = nameTokens(partner || '')[0] || '', gleich = r => tok && (nameTokens(r.partner || '')[0] || '') === tok;
  const kand = S.rechnungen.filter(r => r.richtung === (g.richtung || 'eingang') && r.id !== g.id && (+r.brutto || 0) > 0);
  if (nr) { const k = kand.filter(r => r.nummer && normNr(r.nummer) === normNr(nr)); const t = k.find(gleich) || (k.length === 1 ? k[0] : null); if (t) return t; }
  if (!tok || !g.brutto) return null;
  const k = kand.filter(r => gleich(r) && eq(+r.brutto, Math.abs(+g.brutto)) && (!g.datum || !r.datum || (r.datum <= g.datum && r.datum >= addDays(g.datum, -120))));
  return k.length === 1 ? k[0] : null;
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
      : `<div class="warn small">Noch kein OneDrive-Ordner gewählt – die Belege würden nur in der App liegen. <button class="btn sm" data-act="ablageWahl" data-art="eingang">📁 Ordner wählen</button></div>`) : ''}
    ${ablageMoeglich() ? (ABLAGE_A ? `<p class="small">📁 Ausgangsrechnungen (Originalname) kommen in: <b>${esc(ABLAGE_A.name)}</b></p>`
      : `<div class="note small">Für eure eigenen Ausgangsrechnungen ist noch kein Ordner gewählt. <button class="btn sm" data-act="ablageWahl" data-art="ausgang">📁 Ordner Rechnungsausgang</button></div>`) : ''}
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
  const ablage = await ablageOrdner(true), ablageA = await ablageOrdner(true, 'ausgang'), logStart = ABLAGE_LOG.length;   // gleich beim Reinziehen fragen – nur dann darf der Browser um Erlaubnis bitten
  busy(true, 'Lese Belege …');
  const belege = []; for (const f of docs) { try { belege.push(...await fileToBelege(f)); } catch (e) { console.warn(e); } }
  if (!belege.length) { busy(false); return toast('Kein Beleg (PDF/Bild) gefunden.'); }
  const neu = [], doppelt = [], fehler = [], keine = [], ergaenzt = [], avise = [], mahnungen = [], mahnGesehen = new Set(), verknuepft = [], auszuege = [], ausgangNeu = [];
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
  const avisAnlegen = async (x, b) => { const res = await avisSpeichern(x, b); if (!res) { doppelt.push(b.name); return; } avise.push(res); };
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
      // Kontoauszug (am Dateinamen erkannt) → alle Buchungen in die Bank
      if (istAuszugName(b.name) && DB.aiOn) { auszuege.push(await kontoauszugImport(b)); return; }
      let x = null;
      if (DB.aiOn) { try { x = await kiBelegLesen(b); } catch (e) { fehler.push(b.name + ': ' + aiErr(e)); } }
      if (x && x.kontoauszug) { auszuege.push(await kontoauszugImport(b)); return; }   // KI hat einen Kontoauszug erkannt
      if (x && +x.mahnung > 0 && await mahnungVerarbeiten(x, b)) return;
      if (x && x.ist_rechnung === false) { keine.push(b.name); return; }
      x = x || {};
      if (x.art === 'Zahlungsavis') return avisAnlegen(x, b);
      if (x.eigene_rechnung) {
        const r = ausgangAusText(x.nummer) || ausgangAusText(b.name); if (r) return anhaengen(r, b);
        // Noch nicht im Werkstatt Journal: Ausgangsrechnung aus der PDF anlegen (Originalname, Ordner „Rechnungsausgang“)
        const nummer = String(x.nummer || '').trim(), datum = parseDate(x.datum) || todayISO();
        if (!nummer) { fehler.push(`${b.name}: eigene Rechnung ohne erkennbare Nummer – bitte von Hand anlegen`); return; }
        const za = /bar/i.test(x.zahlart) ? 'bar' : /ec|karte/i.test(x.zahlart) ? 'ec' : /ueberw|überw|bank/i.test(x.zahlart) ? 'bank' : null;
        const brutto = parseNum(x.brutto), netto = parseNum(x.netto);
        const row = { richtung: 'ausgang', nummer, datum, faellig: parseDate(x.faellig), partner: String(x.lieferant || '').trim() || 'Kunde', kennzeichen: String(x.kennzeichen || '').toUpperCase().trim() || null,
          kundennr: String(x.kundennr || '').trim() || null, brutto: r2(brutto || 0), netto, mwst: parseNum(x.mwst), lohn: parseNum(x.lohn), teile: parseNum(x.teile), zahlart: za,
          status_excel: za === 'bar' || za === 'ec' ? 'Bezahlt' : 'Offen', quelle: 'ki', geprueft: false, schluessel: 'A:' + normNr(nummer), dateiname: b.name };
        Object.assign(row, await belegSpeichern(row, b.file));
        const [neuA] = await DB.insert('rechnungen', [row]); if (!neuA) { doppelt.push(b.name); return; }
        if (za === 'bar') await DB.insert('zuordnungen', [{ rechnung_id: neuA.id, betrag: neuA.brutto, art: 'bar', datum, notiz: 'Laut Rechnung bar bezahlt' }]);
        ausgangNeu.push(neuA); return;
      }
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
      const da = nummer && S.rechnungen.find(r => r.richtung === 'eingang' && r.nummer && normNr(r.nummer) === normNr(nummer) && !(brutto && (+r.brutto || 0) * brutto < 0) &&   // Gutschrift ≠ Rechnung
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
      // Gutschrift / Korrektur / Storno zu einer Rechnung → direkt verknüpfen (wird dort verrechnet)
      if (x.art === 'Korrektur' || x.art === 'Storno') row.art = x.art;
      const orig = (['Gutschrift', 'Korrektur', 'Storno'].includes(row.art) || row.brutto < 0) ? bezugFinden(x.bezug_rechnung, partner, row) : null;
      if (orig) { row.bezug_id = orig.id; row.notiz = [row.notiz, `Gehört zu Rechnung ${orig.nummer || ''}`].filter(Boolean).join(' · '); }
      Object.assign(row, await belegSpeichern(row, b.file));
      const added = await DB.insert('rechnungen', [row]);
      if (orig && added.length) verknuepft.push({ g: added[0], r: orig });
      if (added.length) neu.push(added[0]); else doppelt.push(b.name);
    } catch (e) { console.error(e); fehler.push(b.name + ': ' + (e.message || e)); }
    finally { fertig++; busy(true, `Belege: ${fertig} von ${belege.length} fertig` + (DB.aiOn ? ' – KI liest …' : ' …')); }
  };
  const warte = belege.slice();
  await Promise.all([0, 1, 2].map(async () => { while (warte.length) await eins(warte.shift()); }));
  busy(true, 'Gleiche mit Bank ab …');
  const res = await autoAbgleich().catch(() => ({ n: 0 }));
  const nurAusgang = (ausgangNeu.length || ergaenzt.some(r => r.richtung === 'ausgang')) && !neu.length && !avise.length && !ergaenzt.some(r => r.richtung === 'eingang');
  busy(false); UI.view = auszuege.length && !neu.length && !ergaenzt.length && !avise.length && !ausgangNeu.length ? 'bank' : nurAusgang ? 'ausgang' : 'eingang'; render();
  openSheet({
    title: 'Belege übernommen', noOk: true, wide: true, html: `
    ${neu.length ? `<p><b>${neu.length}</b> Eingangsrechnung${neu.length === 1 ? '' : 'en'} angelegt${DB.aiOn ? ' – von der KI ausgelesen, bitte kurz prüfen' : ' – bitte Beträge eintragen (KI nur online)'}.${res.n ? ' ' + res.n + ' Zahlung(en) automatisch zugeordnet.' : ''}</p>
    ${ablageMeldung(ABLAGE_LOG.slice(logStart))}<p class="small muted">Dateiname: VE Sport_Firma_Art_Nummer_Datum</p>
    <div class="tw"><table class="tb click"><thead><tr><th>Lieferant</th><th>Nr.</th><th>Datum</th><th class="num">Brutto</th><th>Kostenart</th></tr></thead><tbody>
    ${neu.map(r => `<tr data-act="rechnung" data-id="${r.id}"><td>${esc(r.partner)}</td><td>${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td class="num">${fmtE(r.brutto)}</td><td>${esc(r.kostenart || '–')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${ergaenzt.length ? `<p><b>${ergaenzt.length}</b> PDF${ergaenzt.length === 1 ? '' : 's'} an vorhandene Rechnungen gehängt:</p><div class="tw"><table class="tb click"><tbody>${ergaenzt.map(r => `<tr data-act="rechnung" data-id="${r.id}"><td>${r.richtung === 'ausgang' ? '↗ Ausgang' : '↘ Eingang'}</td><td>${esc(r.partner || '')}</td><td class="mono">${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td class="num">${fmtE(r.brutto)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${ausgangNeu.length ? `<p><b>${ausgangNeu.length}</b> Ausgangsrechnung${ausgangNeu.length === 1 ? '' : 'en'} aus der PDF angelegt (Dateiname bleibt wie er ist) – bitte kurz prüfen:</p><div class="tw"><table class="tb click"><tbody>${ausgangNeu.map(r => `<tr data-act="rechnung" data-id="${r.id}"><td class="mono">${esc(r.nummer)}</td><td>${esc(r.partner || '')}</td><td>${fmtD(r.datum)}</td><td class="num">${fmtE(r.brutto)}</td><td class="small">${esc(r.dateiname || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${auszuege.length ? `<p><b>${auszuege.length}</b> ${auszuege.length === 1 ? 'Kontoauszug' : 'Kontoauszüge'} eingelesen und mit den Ein- und Ausgaben abgeglichen${res.n ? ` – <b>${res.n}</b> Zahlung${res.n === 1 ? '' : 'en'} automatisch zugeordnet` : ''}:</p><div class="tw"><table class="tb click"><tbody>${auszuege.map(x => `<tr><td>🏦 ${esc(x.name)}</td><td>${x.von ? fmtD(x.von) + ' – ' + fmtD(x.bis) : ''}</td><td class="num">${x.n} Buchungen</td><td>${x.neu} neu${x.n - x.neu ? ', ' + (x.n - x.neu) + ' schon da' : ''}</td><td>${x.probe === 'ok' ? badge({ cls: 'st-ok', label: '✓ Saldo stimmt' }) : x.probe ? badge({ cls: 'st-warn', label: x.probe }) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${verknuepft.length ? `<p><b>${verknuepft.length}</b> Gutschrift${verknuepft.length === 1 ? '' : 'en'}/Korrektur${verknuepft.length === 1 ? '' : 'en'} direkt mit der Rechnung verknüpft:</p><div class="tw"><table class="tb click"><tbody>${verknuepft.map(({ g, r }) => `<tr data-act="rechnung" data-id="${r.id}"><td>${esc(g.art || 'Gutschrift')} ${esc(g.nummer || '')}</td><td class="num">${fmtE(g.brutto)}</td><td>→ ${esc(r.nummer || '')} ${esc(r.partner || '')}</td><td class="num">${fmtE(r.brutto)}</td><td>noch offen ${fmtE(Math.max(0, rStatus(r).offen))}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${mahnungen.length ? `<p><b>${mahnungen.length}</b> Mahnung${mahnungen.length === 1 ? '' : 'en'} erkannt:</p><div class="tw"><table class="tb click"><tbody>${mahnungen.map(m => m.ziele.length ? m.ziele.map(r => `<tr data-act="rechnung" data-id="${r.id}"><td>${esc(m.label)}</td><td>${esc(r.partner || '')}</td><td class="mono">${esc(r.nummer || '')}</td><td class="num">${fmtE(r.brutto)}</td><td>→ Status jetzt <b>${esc(r.status_excel)}</b></td></tr>`).join('')
      : `<tr><td>${esc(m.label)}</td><td>${esc(m.partner)}</td><td class="mono">${esc(m.nrn.join(', '))}</td><td></td><td class="muted">Rechnung war noch nicht in der App${neu.some(r => m.nrn.some(n => normNr(n) === normNr(r.nummer || ''))) ? ' – jetzt mit Mahnstatus angelegt' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${avise.length ? `<p><b>${avise.length}</b> Zahlungsavis abgelegt (unter „Zahlungsavis“, nicht im Rechnungseingang):</p><div class="tw"><table class="tb click"><tbody>${avise.map(({ a, bezug }) => `<tr data-act="avisD" data-id="${a.id}"><td>📨 ${esc(a.partner || '')}</td><td>${fmtD(a.datum)}</td><td class="num">${a.betrag != null ? fmtE(a.betrag) : ''}</td><td class="small">${bezug.length ? '→ ' + bezug.map(x => esc(x.nummer || '') + ' (' + esc(x.status_excel || '') + ')').join(', ') : '<span class="muted">keine passende Rechnung gefunden</span>'}</td><td>${a.bank_id ? badge({ cls: 'st-ok', label: '✓ in Bank' }) : badge({ cls: 'st-warn', label: 'Abbuchung offen' })}</td></tr>`).join('')}</tbody></table></div>` : ''}
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
