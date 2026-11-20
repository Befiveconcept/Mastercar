/* Mastercar Finanzen · GuV je Monat – automatisch aus Rechnungsausgang, Rechnungseingang (und optional Zahlungen ohne Beleg)
   Gliederung wie im Blatt „GuV“ der Excel-Mappe. Beträge netto; durchlaufende Posten (z. B. TÜV-Gebühren) bleiben außen vor. */
const OHNE = 'nicht zugeordnet';
const nettoA = r => r.netto != null ? +r.netto : r2(((+r.brutto || 0) - (+r.durchlaufend || 0)) / 1.19);
const nettoE = r => r.netto != null ? +r.netto : r2(((+r.brutto || 0) - (+r.durchlaufend || 0)) / 1.19);   // + Ausgabe, − Gutschrift

// Liefert {zeilen: Map(schlüssel → {werte[12], items[]}), jahr}
function guvDaten(jahr, mitOhneBeleg) {
  const Z = new Map();
  const put = (key, m, v, item) => { if (!Z.has(key)) Z.set(key, { w: Array(12).fill(0), items: [] }); const z = Z.get(key); z.w[m] += v; z.items.push({ ...item, v, m }); };
  const inJ = d => d && d.slice(0, 4) === String(jahr), mon = d => +d.slice(5, 7) - 1;
  S.rechnungen.forEach(r => {
    if (!inJ(r.datum)) return;
    if (r.richtung === 'ausgang') { put('Umsatzerlöse', mon(r.datum), nettoA(r), { t: 'r', id: r.id }); return; }
    const k = KOSTENARTEN.includes(r.kostenart) ? r.kostenart : OHNE, u = r.unterkonto && UNTERKONTEN(k).includes(r.unterkonto) ? r.unterkonto : '';
    put(k + (u ? '|' + u : ''), mon(r.datum), -nettoE(r), { t: 'r', id: r.id });
  });
  if (mitOhneBeleg) {
    buildIdx();
    S.bank.forEach(b => { if (!inJ(b.datum) || b.betrag >= 0 || b.art || (IDX.zByB.get(b.id) || []).length) return; put((KOSTENARTEN.includes(b.kostenart) ? b.kostenart : OHNE), mon(b.datum), +b.betrag, { t: 'b', id: b.id }); });
    S.kasse.forEach(k => { if (!inJ(k.datum) || k.betrag >= 0 || (IDX.zByK.get(k.id) || []).length) return; put((KOSTENARTEN.includes(k.kostenart) ? k.kostenart : OHNE), mon(k.datum), +k.betrag, { t: 'k', id: k.id }); });
  }
  return Z;
}
function guvRechnen(jahr, mitOhneBeleg) {
  const Z = guvDaten(jahr, mitOhneBeleg), zero = () => Array(12).fill(0), add = (a, b) => a.map((x, i) => x + b[i]);
  const lines = []; let ertrag = zero(), kosten = zero();
  const grpVal = k => { let w = zero(); for (const [key, z] of Z) if (key === k || key.startsWith(k + '|')) w = add(w, z.w); return w; };
  for (const g of GUV) {
    const w = grpVal(g.k);
    lines.push({ typ: 'grp', label: g.k, konto: g.konto || '', w, key: g.k, sub: g.subs.length > 0 });
    if (g.subs.length) {
      g.subs.forEach(([s, konto]) => lines.push({ typ: 'sub', label: s, konto, w: (Z.get(g.k + '|' + s) || { w: zero() }).w, key: g.k + '|' + s }));
      const rest = (Z.get(g.k) || { w: zero() }).w; if (rest.some(x => Math.abs(x) > 0.005)) lines.push({ typ: 'sub', label: 'ohne Unterposition', konto: '', w: rest, key: g.k, nur: true });
    }
    if (g.typ === 'e') ertrag = add(ertrag, w); else kosten = add(kosten, w);
    if (g.k === 'sonstige betriebliche Erträge') lines.push({ typ: 'sum', label: 'Summe Erträge', w: ertrag });
  }
  const ohne = (Z.get(OHNE) || { w: zero() }).w;
  if (ohne.some(x => Math.abs(x) > 0.005)) { lines.push({ typ: 'grp', label: 'Kosten ohne Kategorie', konto: '', w: ohne, key: OHNE, warn: true }); kosten = add(kosten, ohne); }
  const erg = add(ertrag, kosten), steuer = erg.map(x => x > 0 ? -0.3 * x : 0), jue = add(erg, steuer);
  let kum = 0; const kumW = jue.map(x => (kum += x));
  lines.push({ typ: 'sum', label: 'Summe Kosten', w: kosten }, { typ: 'tot', label: 'Ergebnis vor Steuern', w: erg }, { typ: 'sub2', label: 'Steuern vom Einkommen und Ertrag (30 %, geschätzt)', w: steuer }, { typ: 'tot', label: 'Jahresüberschuss / -fehlbetrag', w: jue }, { typ: 'sub2', label: 'Ergebnis kumuliert', w: kumW, kum: true });
  return { lines, Z };
}
const guvJahre = () => { const s = new Set(S.rechnungen.map(r => (r.datum || '').slice(0, 4)).filter(Boolean)); s.add(todayISO().slice(0, 4)); return [...s].sort().reverse(); };

function viewGuv() {
  const jahre = guvJahre(); UI.guvJahr = UI.guvJahr && jahre.includes(UI.guvJahr) ? UI.guvJahr : (jahre.find(j => S.rechnungen.some(r => (r.datum || '').startsWith(j))) || jahre[0]);
  const { lines } = guvRechnen(UI.guvJahr, !!UI.guvOhne);
  const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const cur = todayISO().slice(0, 4) === UI.guvJahr ? +todayISO().slice(5, 7) : 12;
  const n = v => Math.abs(v) < 0.005 ? '<span class="muted">–</span>' : Math.round(v).toLocaleString('de-DE');
  const tot = w => w.reduce((a, b) => a + b, 0);
  const row = l => {
    const cls = { grp: 'g-grp', sub: 'g-sub', sum: 'g-sum', tot: 'g-tot', sub2: 'g-sub2' }[l.typ] + (l.warn ? ' g-warn' : '');
    const click = l.key && !(l.typ === 'grp' && l.sub) || l.nur;
    const gesamt = l.kum ? l.w[cur - 1] : tot(l.w);
    return `<tr class="${cls}"><th>${esc(l.label)}${l.konto ? `<small>${esc(l.konto)}</small>` : ''}</th>${l.w.map((v, m) => `<td class="num ${v < -0.005 ? 'neg' : ''} ${m >= cur ? 'fut' : ''}" ${click && Math.abs(v) > 0.005 ? `data-act="guvZelle" data-k="${esc(l.key)}" data-m="${m}" data-nur="${l.nur ? 1 : ''}"` : ''}>${n(v)}</td>`).join('')}<td class="num g-ges ${gesamt < -0.005 ? 'neg' : ''}">${n(gesamt)}</td></tr>`;
  };
  return `
  <div class="toolbar"><h1>GuV ${esc(UI.guvJahr)}</h1><span class="sp"></span>
    <select class="inp" data-chg="guvJahr">${jahre.map(j => `<option ${j === UI.guvJahr ? 'selected' : ''}>${j}</option>`).join('')}</select>
    <label class="chk inline"><input type="checkbox" data-chg="guvOhne" ${UI.guvOhne ? 'checked' : ''}> Zahlungen ohne Beleg (Bank/Kasse) mitrechnen</label>
    <button class="btn" data-act="guvCsv">CSV</button></div>
  <p class="small muted">Automatisch aus Rechnungsausgang (netto) und Rechnungseingang (netto, nach Kategorie) nach Rechnungsdatum. Durchlaufende Posten sind nicht enthalten. Zahl anklicken = Belege dahinter. Vorläufige Auswertung – ersetzt nicht die BWA vom Steuerberater.</p>
  <div class="tw guv"><table class="tb gtab"><thead><tr><th>Position</th>${MON.map(m => `<th class="num">${m}</th>`).join('')}<th class="num">Gesamt</th></tr></thead><tbody>${lines.map(row).join('')}</tbody></table></div>`;
}
function guvZelle(key, m, nur) {
  const { Z } = guvRechnen(UI.guvJahr, !!UI.guvOhne);
  let items = []; for (const [k, z] of Z) if (k === key || (!nur && k.startsWith(key + '|'))) items.push(...z.items.filter(i => i.m === m));
  items.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const lbl = i => { if (i.t === 'r') { const r = S.rechnungen.find(x => x.id === i.id); return r ? [r.datum, r.partner, r.nummer || r.art || ''] : []; } const x = (i.t === 'b' ? S.bank : S.kasse).find(y => y.id === i.id); return x ? [x.datum, i.t === 'b' ? x.gegenpartei : 'Kasse', i.t === 'b' ? x.zweck : x.text] : []; };
  openSheet({ title: key.replace('|', ' · ') + ' · ' + MONATE[m] + ' ' + UI.guvJahr, wide: true, noOk: true, html: `<div class="sumline">${items.length} Einträge · ${fmtE(sum(items, i => i.v))}</div>
    <div class="tw"><table class="tb click"><tbody>${items.slice(0, 400).map(i => { const [d, p, x] = lbl(i); return `<tr data-act="${i.t === 'r' ? 'rechnung' : i.t === 'b' ? 'bank' : 'kasseD'}" data-id="${i.id}"><td>${fmtD(d)}</td><td>${esc(p || '')}</td><td class="zweck">${esc(x || '')}</td><td class="num ${i.v < 0 ? 'neg' : ''}">${fmtE(i.v)}</td></tr>`; }).join('')}</tbody></table></div>` });
}
function guvCsv() {
  const { lines } = guvRechnen(UI.guvJahr, !!UI.guvOhne);
  const rows = [['Position', 'Konto', ...MONATE, 'Gesamt']].concat(lines.map(l => [(l.typ === 'sub' ? '  ' : '') + l.label, l.konto || '', ...l.w.map(numDE), numDE(l.kum ? l.w[11] : l.w.reduce((a, b) => a + b, 0))]));
  download(`Mastercar_GuV_${UI.guvJahr}.csv`, rows.map(csvRow).join('\r\n'));
}
