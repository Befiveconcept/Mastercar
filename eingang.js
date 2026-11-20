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
{"ist_rechnung":true,"eigene_rechnung":false,"lieferant":"","nummer":"","datum":"","faellig":"","netto":0,"mwst":0,"brutto":0,"iban":"","kostenart":"","unterkonto":"","art":"Rechnung|Gutschrift|Korrektur|Vertrag|Beleg","beschreibung":"kurz: was wurde geliefert/geleistet","bezahlung":"offen|lastschrift|bereits_bezahlt","gutschrift":false}
ist_rechnung=false, wenn es keine Rechnung/Gutschrift ist (z. B. AGB, Lieferschein, Werbung).
eigene_rechnung=true, wenn Mastercar Bornheim / VE Sportmanagement selbst die Rechnung AUSGESTELLT hat (Kundenrechnung der Werkstatt, Nummer wie R26-0491); dann bei "lieferant" den Kunden eintragen.`, { files, tier: 'quick' });
}

async function eingangDrop(fileList) {
  const files = [...fileList];
  const tables = files.filter(isTable);
  if (tables.length) { tables.forEach(f => importAuto(f)); }
  const docs = files.filter(f => !isTable(f)); if (!docs.length) return;
  const ablage = await ablageOrdner(true); let abgelegt = 0;   // gleich beim Reinziehen fragen – nur dann darf der Browser um Erlaubnis bitten
  busy(true, 'Lese Belege …');
  const belege = []; for (const f of docs) { try { belege.push(...await fileToBelege(f)); } catch (e) { console.warn(e); } }
  if (!belege.length) { busy(false); return toast('Kein Beleg (PDF/Bild) gefunden.'); }
  const neu = [], doppelt = [], fehler = [], keine = [], ergaenzt = [];
  // Viele PDFs: immer 3 gleichzeitig von der KI lesen lassen
  let fertig = 0;
  busy(true, `${belege.length} Beleg${belege.length === 1 ? '' : 'e'}` + (DB.aiOn ? ' – KI liest …' : ' …'));
  // PDF an eine schon vorhandene Rechnung (z. B. aus der Excel) hängen statt sie doppelt anzulegen
  const anhaengen = async (r, b) => {
    if (r.datei) { doppelt.push(b.name + (r.nummer ? ' (Nr. ' + r.nummer + ', hat schon eine PDF)' : '')); return; }
    await belegAnhaengen(r, b.file); if (r.richtung === 'eingang' && ablage) abgelegt++; ergaenzt.push(r);
  };
  const eins = async b => {
    try {
      // Mail ohne PDF-Anhang: aus dem Mailtext eine PDF machen, damit jede Buchung eine PDF hat
      if (b.type === 'message/rfc822' && b.mail) { b.file = new File([textPdf(b.mail.subject || 'E-Mail', `Von: ${b.mail.from}\n\n${b.mail.text}`)], (b.mail.subject || 'Mail') + '.pdf', { type: 'application/pdf' }); b.type = 'application/pdf'; b.name = b.file.name; }
      // Eigene Kundenrechnung (R26-…) am Dateinamen erkannt → PDF direkt an die Ausgangsrechnung, ohne KI
      const eigen = ausgangAusText(b.name); if (eigen) return anhaengen(eigen, b);
      let x = null;
      if (DB.aiOn) { try { x = await kiBelegLesen(b); } catch (e) { fehler.push(b.name + ': ' + aiErr(e)); } }
      if (x && x.ist_rechnung === false) { keine.push(b.name); return; }
      x = x || {};
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
        status_excel: x.bezahlung === 'lastschrift' ? 'Abbuchung offen' : x.bezahlung === 'bereits_bezahlt' ? 'Bezahlt' : 'Offen',
        notiz: x.bezahlung === 'lastschrift' ? 'Laut Beleg per Lastschrift' : x.bezahlung === 'bereits_bezahlt' ? 'Laut Beleg bereits bezahlt' : null };
      // Datei nach Schema benennen: VE Sport_Lieferant_Art_Nummer_Datum.pdf – in der Cloud und (falls gewählt) im Ablage-Ordner
      Object.assign(row, await belegSpeichern(row, b.file)); if (ablage) abgelegt++;
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
    <p class="small muted">${abgelegt ? `${abgelegt} Datei(en) im Ordner „${esc(ablage.name)}“ abgelegt` : ABLAGE ? 'Ablage-Ordner ohne Zugriff – unter Einstellungen erneut erlauben' : 'Kein Ablage-Ordner gewählt (Einstellungen → Beleg-Ablage)'} · Name: VE Sport_Lieferant_Art_Nummer_Datum</p>
    <div class="tw"><table class="tb click"><thead><tr><th>Lieferant</th><th>Nr.</th><th>Datum</th><th class="num">Brutto</th><th>Kostenart</th></tr></thead><tbody>
    ${neu.map(r => `<tr data-act="rechnung" data-id="${r.id}"><td>${esc(r.partner)}</td><td>${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td class="num">${fmtE(r.brutto)}</td><td>${esc(r.kostenart || '–')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${ergaenzt.length ? `<p><b>${ergaenzt.length}</b> PDF${ergaenzt.length === 1 ? '' : 's'} an vorhandene Rechnungen gehängt:</p><div class="tw"><table class="tb click"><tbody>${ergaenzt.map(r => `<tr data-act="rechnung" data-id="${r.id}"><td>${r.richtung === 'ausgang' ? '↗ Ausgang' : '↘ Eingang'}</td><td>${esc(r.partner || '')}</td><td class="mono">${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td class="num">${fmtE(r.brutto)}</td></tr>`).join('')}</tbody></table></div>` : ''}
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
