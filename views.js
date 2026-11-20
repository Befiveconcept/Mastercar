/* Mastercar Finanzen · Ansichten */
const UI = { view: 'start', period: 'jahr', filt: { ausgang: 'alle', eingang: 'alle', bank: 'offen', sumup: 'alle', kasse: 'alle', todos: 'offen' }, q: {}, more: {} };
const NAV = [
  ['start', 'Übersicht', '◧'], ['todos', 'To-Dos', '☑'], ['ausgang', 'Rechnungsausgang', '↗'], ['eingang', 'Rechnungseingang', '↘'],
  ['bank', 'Bank', '⇄'], ['sumup', 'SumUp / EC', '▭'], ['kasse', 'Kassenbuch', '€'], ['hebe', 'Hebebühne', '⇡'],
  ['guv', 'GuV', 'Σ'], ['abgleich', 'Abgleich & Probleme', '⚑'], ['einst', 'Einstellungen', '⚙']
];
const PERIODS = [['monat', 'Dieser Monat'], ['vormonat', 'Letzter Monat'], ['quartal', 'Dieses Quartal'], ['jahr', 'Dieses Jahr'], ['vorjahr', 'Letztes Jahr'], ['12m', 'Letzte 12 Monate'], ['alle', 'Alles']];
function periodRange(p) {
  const t = todayISO(), y = +t.slice(0, 4), m = +t.slice(5, 7), pad = n => String(n).padStart(2, '0');
  const end = (yy, mm) => `${yy}-${pad(mm)}-${pad(new Date(yy, mm, 0).getDate())}`; // letzter Tag des Monats
  switch (p) {
    case 'monat': return [`${y}-${pad(m)}-01`, end(y, m)];
    case 'vormonat': { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return [`${yy}-${pad(mm)}-01`, end(yy, mm)]; }
    case 'quartal': { const q0 = Math.floor((m - 1) / 3) * 3 + 1; return [`${y}-${pad(q0)}-01`, end(y, q0 + 2)]; }
    case 'jahr': return [`${y}-01-01`, `${y}-12-31`];
    case 'vorjahr': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case '12m': { const yy = m === 12 ? y : y - 1, mm = m === 12 ? 1 : m + 1; return [`${yy}-${pad(mm)}-01`, end(y, m)]; }
    default: return ['0000-01-01', '9999-12-31'];
  }
}
const inP = (d, [a, b]) => d && d >= a && d <= b;
const badge = st => `<span class="badge ${st.cls}">${esc(st.label)}</span>${st.hint ? ` <span class="badge ${st.hint[1]} hint">${esc(st.hint[0])}</span>` : ''}`;
// Status direkt in der Liste ändern (wie in der Excel-Spalte)
const stSelect = r => `<select class="st-sel ${ST_CLS(rStatus(r).label)}" data-chg="rstatus" data-id="${r.id}" aria-label="Status">${stListe(r.richtung).map(s => `<option ${s === rStatus(r).label ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
const ZA = { bank: 'Überweisung', sepa: 'SEPA-Lastschrift', ec: 'EC / SumUp', bar: 'Bar' };

/* ---------- Kennzahlen ---------- */
function kennzahlen(range) {
  const aus = S.rechnungen.filter(r => r.richtung === 'ausgang' && inP(r.datum, range));
  const ein = S.rechnungen.filter(r => r.richtung === 'eingang' && inP(r.datum, range));
  const bankKosten = S.bank.filter(b => b.betrag < 0 && inP(b.datum, range) && !['privat', 'intern', 'ignoriert'].includes(b.art) && !(IDX.zByB.get(b.id) || []).length);
  // netto wie in der Excel-Mappe (ohne durchlaufende Posten); Gutschriften mindern die Kosten
  const einnahmen = sum(aus, nettoA), einNetto = einnahmen, einBrutto = sum(aus, r => r.brutto);
  const ausgaben = sum(ein, nettoE), bankOhne = sum(bankKosten, b => -b.betrag);
  const allA = S.rechnungen.filter(r => r.richtung === 'ausgang').map(r => ({ r, st: rStatus(r) }));
  const allE = S.rechnungen.filter(r => r.richtung === 'eingang').map(r => ({ r, st: rStatus(r) }));
  const offenA = allA.filter(x => ['offen', 'ueberfaellig', 'teil'].includes(x.st.key));
  const ueberA = allA.filter(x => x.st.key === 'ueberfaellig');
  const offenE = allE.filter(x => ['offen', 'ueberfaellig', 'teil'].includes(x.st.key));
  const probleme = [...allA, ...allE].filter(x => ['ueber', 'doppelt', 'teil'].includes(x.st.key));
  const bankOffen = S.bank.filter(b => b.betrag > 0 && bStatus(b).key === 'offen');
  const pruefen = S.rechnungen.filter(r => !r.geprueft);
  // Kostenarten
  const ka = {}; ein.forEach(r => { const k = r.kostenart || 'Ohne Kategorie'; ka[k] = (ka[k] || 0) + nettoE(r); });
  // Zahlarten der Ausgangsrechnungen (gefundene Zahlung, sonst Zahlart laut Liste)
  const zaSum = { bank: 0, ec: 0, bar: 0, offen: 0 };
  aus.forEach(r => { if (r.erledigt) return; const st = rStatus(r), zs = st.zahlungen; let rest = sollOf(r);
    zs.forEach(z => { const k = z.kasse_id || z.art === 'bar' ? 'bar' : z.sumup_id ? 'ec' : 'bank'; zaSum[k] += +z.betrag; rest -= +z.betrag; });
    if (st.key === 'extern' && rest > 0.01) { zaSum[r.zahlart === 'bar' ? 'bar' : r.zahlart === 'ec' ? 'ec' : 'bank'] += rest; rest = 0; }
    if (rest > 0.01) zaSum.offen += rest; });
  // Monate (netto) und Umsatz nach Bereich (wie Blatt „Grafik“)
  const mon = {}, mk = d => monthKey(d), um = {};
  aus.forEach(r => { const k = mk(r.datum); (mon[k] = mon[k] || { e: 0, a: 0 }).e += nettoA(r); const u = um[k] = um[k] || { l: 0, t: 0, s: 0 }; const l = +r.lohn || 0, t = +r.teile || 0; u.l += l; u.t += t; u.s += nettoA(r) - l - t; });
  ein.forEach(r => { const k = mk(r.datum); (mon[k] = mon[k] || { e: 0, a: 0 }).a += nettoE(r); });
  // Kontobewegungen (Ist)
  const bankP = S.bank.filter(b => inP(b.datum, range) && !['intern', 'ignoriert'].includes(b.art));
  return { aus, ein, einnahmen, einNetto, einBrutto, ausgaben, bankOhne, bankKosten, um, ergebnis: r2(einnahmen - ausgaben), offenA, ueberA, offenE, probleme, bankOffen, pruefen, ka, zaSum, mon,
    bankIn: sum(bankP.filter(b => b.betrag > 0), b => b.betrag), bankOut: sum(bankP.filter(b => b.betrag < 0), b => -b.betrag) };
}

/* ---------- Diagramme (SVG) ---------- */
function barChart(labels, series, { h = 220 } = {}) {
  if (!labels.length) return '<div class="empty small">Noch keine Daten im Zeitraum.</div>';
  const W = 640, H = h, pl = 56, pb = 28, pt = 12, iw = W - pl - 8, ih = H - pb - pt;
  const max = Math.max(1, ...series.flatMap(s => s.data)), step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
  const y = v => pt + ih - (v / top) * ih, gw = iw / labels.length, bw = Math.min(26, gw * 0.8 / series.length);
  const grid = [0, .5, 1].map(f => `<line x1="${pl}" x2="${W - 8}" y1="${y(top * f)}" y2="${y(top * f)}" class="gl"/><text x="${pl - 6}" y="${y(top * f) + 4}" text-anchor="end" class="ax">${Math.round(top * f).toLocaleString('de-DE')}</text>`).join('');
  const bars = series.map((s, k) => s.data.map((v, i) => { const x = pl + gw * i + (gw - bw * series.length) / 2 + bw * k; return `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, pt + ih - y(v)).toFixed(1)}" rx="3" class="${s.cls}"><title>${esc(labels[i])} · ${esc(s.name)}: ${fmtE(v)}</title></rect>`; }).join('')).join('');
  const xl = labels.map((l, i) => `<text x="${pl + gw * i + gw / 2}" y="${H - 8}" text-anchor="middle" class="ax">${esc(l)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Diagramm">${grid}${bars}${xl}</svg>
    <div class="legend">${series.map(s => `<span><i class="${s.cls}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}
function hbars(items, total) {
  if (!items.length) return '<div class="empty small">Noch keine Ausgaben im Zeitraum.</div>';
  const max = Math.max(...items.map(x => x[1]));
  return `<div class="hb">${items.map(([k, v]) => `<div class="hb-r"><span class="hb-l">${esc(k)}</span><span class="hb-b"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span><span class="hb-v">${fmtE(v)}<small>${total ? Math.round(v / total * 100) + ' %' : ''}</small></span></div>`).join('')}</div>`;
}

/* ---------- Übersicht ---------- */
function viewStart() {
  const range = periodRange(UI.period), K = kennzahlen(range);
  const months = Object.keys(K.mon).sort().slice(-12);
  const kaItems = Object.entries(K.ka).filter(x => x[1] > 0.005).sort((a, b) => b[1] - a[1]);
  const kaTot = sum(kaItems, x => x[1]);
  const za = K.zaSum, zaTot = za.bank + za.ec + za.bar + za.offen;
  const empty = !S.rechnungen.length && !S.bank.length && !S.sumup.length;
  const umM = Object.keys(K.um).sort().slice(-12);
  return `
  ${startHero()}
  <div id="omniSlot"></div>
  ${empty ? `<div class="hero-empty"><h2>Willkommen bei Mastercar Finanzen</h2><p>Zieh einfach Dateien in die Leiste: die ganze <b>Excel-Mappe „Ein- und Ausgaben“</b>, einen <b>SumUp-Export</b>, ein <b>Bank-CSV</b> oder <b>Eingangsrechnungen</b> (PDF, Foto, Outlook-Mail). Die App erkennt selbst, was es ist.</p>
     ${!DB.cloud ? '<button class="btn" data-act="demo">Demo-Daten laden</button>' : ''}</div>` : ''}
  <div class="toolbar sec"><h2>Zahlen</h2><span class="sp"></span>
    <select class="inp" data-chg="period" aria-label="Zeitraum">${PERIODS.map(p => `<option value="${p[0]}" ${UI.period === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></div>
  <section class="kpi">
    <div class="k hi"><div class="kv">${fmtE(K.einnahmen)}</div><div class="kl">Umsatz netto (Rechnungsausgang)</div></div>
    <div class="k"><div class="kv">${fmtE(K.ausgaben)}</div><div class="kl">Kosten netto (Rechnungseingang)</div></div>
    <button class="k" data-act="go" data-v="guv"><div class="kv ${K.ergebnis < 0 ? 'neg' : ''}">${fmtE(K.ergebnis)}</div><div class="kl">Ergebnis netto → GuV</div></button>
    <button class="k" data-act="go" data-v="ausgang" data-f="offen"><div class="kv">${fmtE(sum(K.offenA, x => x.st.offen))}</div><div class="kl">Offene Kundenrechnungen · ${K.offenA.length}</div></button>
    <button class="k ${K.ueberA.length ? 'alarm' : ''}" data-act="go" data-v="ausgang" data-f="ueberfaellig"><div class="kv">${fmtE(sum(K.ueberA, x => x.st.offen))}</div><div class="kl">davon überfällig · ${K.ueberA.length}</div></button>
    <button class="k" data-act="go" data-v="eingang" data-f="offen"><div class="kv">${fmtE(sum(K.offenE, x => x.st.offen))}</div><div class="kl">Offene Lieferantenrechnungen · ${K.offenE.length}</div></button>
  </section>
  ${K.probleme.length || K.bankOffen.length || K.pruefen.length ? `<section class="alerts">
    ${K.probleme.length ? `<button class="alert bad" data-act="go" data-v="abgleich">⚑ <b>${K.probleme.length}</b> Rechnung${K.probleme.length === 1 ? '' : 'en'} mit falschem Betrag (zu viel / zu wenig / doppelt)</button>` : ''}
    ${K.bankOffen.length ? `<button class="alert" data-act="go" data-v="bank" data-f="offen">⇄ <b>${K.bankOffen.length}</b> Zahlungseingänge ohne Rechnung (${fmtE(sum(K.bankOffen, b => b.betrag))})</button>` : ''}
    ${K.pruefen.length ? `<button class="alert ai" data-act="go" data-v="eingang" data-f="pruefen">✔ <b>${K.pruefen.length}</b> Belege noch nicht geprüft</button>` : ''}
  </section>` : ''}
  <div class="grid2">
    <section class="card"><h3>Umsatz und Kosten je Monat (netto)</h3>${barChart(months.map(monthLabel), [{ name: 'Umsatz', cls: 'c1', data: months.map(k => r2(K.mon[k].e)) }, { name: 'Kosten', cls: 'c2', data: months.map(k => r2(K.mon[k].a)) }])}</section>
    <section class="card"><h3>Umsatz nach Bereich (netto)</h3>${barChart(umM.map(monthLabel), [{ name: 'Werkstatt (Lohn)', cls: 'c1', data: umM.map(k => r2(K.um[k].l)) }, { name: 'Ersatzteile', cls: 'c2', data: umM.map(k => r2(K.um[k].t)) }, { name: 'Sonstiges', cls: 'c3', data: umM.map(k => r2(K.um[k].s)) }])}</section>
    <section class="card"><h3>Kosten nach Kategorie (netto)</h3>${hbars(kaItems.slice(0, 12), kaTot)}${K.bankOhne > 0.005 ? `<p class="small muted">Dazu ${fmtE(K.bankOhne)} Bankabgänge ohne Beleg – <a href="#" data-act="go" data-v="bank" data-f="kosten">ansehen</a>.</p>` : ''}</section>
    <section class="card"><h3>Wie bezahlen die Kunden?</h3>${zaTot ? hbars([['Überweisung', za.bank], ['EC / SumUp', za.ec], ['Bar', za.bar], ['Noch offen', za.offen]].filter(x => x[1] > 0.005), zaTot) : '<div class="empty small">Noch keine Ausgangsrechnungen im Zeitraum.</div>'}</section>
    <section class="card"><h3>Kontobewegungen im Zeitraum</h3>
      <div class="kv2"><span>Geldeingang Bank</span><b class="pos">${fmtE(K.bankIn)}</b></div>
      <div class="kv2"><span>Geldausgang Bank</span><b class="neg">${fmtE(K.bankOut ? -K.bankOut : 0)}</b></div>
      <div class="kv2 tot"><span>Saldo</span><b>${fmtE(K.bankIn - K.bankOut)}</b></div>
      <div class="kv2"><span>Umsatz brutto (Ausgang)</span><b>${fmtE(K.einBrutto)}</b></div>
      <div class="kv2"><span>Kassenbestand</span><b>${fmtE(kasseBestand().bestand)}</b></div>
      <p class="small muted">Umbuchungen und als „ignoriert“ markierte Umsätze sind nicht enthalten.</p></section>
  </div>`;
}
// Begrüßung wie im Sonnenplan: Datum, „Guten Tag, Name.“ und was heute ansteht
function startHero() {
  const h = new Date().getHours(), gruss = h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
  const first = (S.meName || '').split(' ')[0];
  const datum = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const meine = S.todos.filter(t => !t.erledigt && (!S.meName || !t.wer || t.wer === S.meName));
  const faellig = meine.filter(t => todoDue(t) && todoDue(t) <= todayISO());
  const ueberA = S.rechnungen.filter(r => r.richtung === 'ausgang' && rStatus(r).key === 'ueberfaellig');
  const lief = S.rechnungen.filter(r => r.richtung === 'eingang' && ['offen', 'ueberfaellig'].includes(rStatus(r).key) && faelligAm(r) && faelligAm(r) <= addDays(todayISO(), 7));
  const probs = S.rechnungen.filter(r => ['ueber', 'doppelt', 'teil'].includes(rStatus(r).key)).length;
  const kw = isoWeek(todayISO()), hebeKW = sum(S.hebebuehne.filter(x => kwKey(x.datum) === kwKey(todayISO())), x => x.stunden);
  const items = [
    faellig.length ? `<button class="hi-i" data-act="go" data-v="todos"><b>${faellig.length}</b> To-Do${faellig.length === 1 ? '' : 's'} fällig</button>` : `<span class="hi-i">${meine.length} offene To-Dos</span>`,
    ueberA.length ? `<button class="hi-i warn" data-act="go" data-v="ausgang" data-f="ueberfaellig"><b>${ueberA.length}</b> Kundenrechnung${ueberA.length === 1 ? '' : 'en'} überfällig · ${fmtE(sum(ueberA, r => rStatus(r).offen))}</button>` : '',
    lief.length ? `<button class="hi-i" data-act="go" data-v="eingang" data-f="offen"><b>${lief.length}</b> Lieferantenrechnung${lief.length === 1 ? '' : 'en'} in den nächsten 7 Tagen fällig</button>` : '',
    probs ? `<button class="hi-i warn" data-act="go" data-v="abgleich"><b>${probs}</b> × falscher Betrag bezahlt</button>` : '',
    S.kasse.length ? `<button class="hi-i" data-act="go" data-v="kasse">Kasse <b>${fmtE(kasseBestand().bestand)}</b></button>` : '',
    S.hebebuehne.length ? `<button class="hi-i" data-act="go" data-v="hebe">Hebebühne KW ${kw.w}: <b>${String(r2(hebeKW)).replace('.', ',')} h</b></button>` : ''
  ].filter(Boolean);
  return `<section class="hero"><div class="hero-ey">${esc(datum)}</div><h1>${gruss}${first ? ', <span>' + esc(first) + '</span>' : ''}.</h1>
    <div class="hero-items">${items.join('')}</div>
    ${faellig.length ? `<div class="hero-td">${faellig.slice(0, 4).map(todoLi).join('')}${faellig.length > 4 ? `<button class="lnk" data-act="go" data-v="todos">+ ${faellig.length - 4} weitere</button>` : ''}</div>` : ''}</section>`;
}

/* ---------- Listen ---------- */
const FILT_R = [['alle', 'Alle'], ['offen', 'Offen'], ['ueberfaellig', 'Überfällig'], ['probleme', 'Zu viel / zu wenig / doppelt'], ['bezahlt', 'Bezahlt'], ['pruefen', 'Zu prüfen']];
function filterR(list, f) {
  if (f === 'alle') return list;
  if (f === 'offen') return list.filter(x => ['offen', 'ueberfaellig', 'teil'].includes(x.st.key));
  if (f === 'probleme') return list.filter(x => ['ueber', 'doppelt', 'teil'].includes(x.st.key));
  if (f === 'bezahlt') return list.filter(x => ['bezahlt', 'erledigt', 'extern', 'storno'].includes(x.st.key));
  if (f === 'pruefen') return list.filter(x => !x.r.geprueft);
  if (String(f).startsWith('s:')) return list.filter(x => x.st.label === f.slice(2));
  return list.filter(x => x.st.key === f);
}
const textOf = r => [r.nummer, r.partner, r.kundennr, r.kennzeichen, r.beschreibung, r.kostenart, r.unterkonto, r.art, r.notiz, r.brutto, fmtE(r.brutto), fmtD(r.datum)].join(' ').toLowerCase();
function chips(view, opts) { return `<div class="chips">${opts.map(([k, l]) => `<button class="chip ${UI.filt[view] === k ? 'on' : ''}" data-act="filt" data-v="${view}" data-f="${k}">${l}</button>`).join('')}</div>`; }
function searchIn(view, ph) { return `<input class="inp search" type="search" placeholder="${ph}" value="${esc(UI.q[view] || '')}" data-q="${view}" aria-label="${ph}">`; }
function moreBtn(view, n, lim) { return n > lim ? `<button class="btn sm more" data-act="more" data-v="${view}">Weitere ${Math.min(300, n - lim)} von ${n - lim} anzeigen</button>` : ''; }

/* ---------- Spaltenkopf wie in Excel: Klick auf die Überschrift = sortieren, darunter Filter je Spalte ----------
   cols: [{ k, l (Überschrift), v: x => Sortierwert, t: x => Filtertext (sonst v), num, sel (Auswahlliste statt Textfeld), nof (kein Filter) }]
   Zahlenspalten verstehen auch „>100“, „<50“, „>=12,5“ oder „=79,99“. */
UI.cs = UI.cs || {};
const colT = (c, x) => { const t = c.t ? c.t(x) : c.v(x); return t == null ? '' : String(t); };
function colMatch(c, x, q) {
  const m = c.num && q.match(/^(>=|<=|>|<|=)\s*(-?[\d.,]+)$/);
  if (m) { const v = Number(c.v(x)), n = parseNum(m[2]); if (c.v(x) == null || !isFinite(v) || n == null || !isFinite(n)) return false;
    return m[1] === '>' ? v > n : m[1] === '<' ? v < n : m[1] === '>=' ? v >= n - 0.005 : m[1] === '<=' ? v <= n + 0.005 : Math.abs(v - n) < 0.005; }
  const t = colT(c, x).toLowerCase(); return q.split(/\s+/).every(w => t.includes(w));
}
function colApply(view, list, cols) {
  const st = UI.cs[view] || {};
  cols.forEach(c => {
    if (c.nof) return;
    if (c.sel) { const f = st.f && st.f[c.k]; if (f != null && f !== '') list = list.filter(x => colT(c, x) === f); return; }
    const q = (UI.q[view + '|' + c.k] || '').toLowerCase().trim(); if (q) list = list.filter(x => colMatch(c, x, q));
  });
  const c = st.k && cols.find(c => c.k === st.k);
  if (c) {
    const d = st.d === 'desc' ? -1 : 1, leer = v => v == null || v === '' || (typeof v === 'number' && !isFinite(v));
    list = list.slice().sort((a, b) => { const va = c.v(a), vb = c.v(b);
      if (leer(va) || leer(vb)) return leer(va) - leer(vb);   // Leere immer ans Ende
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de', { numeric: true })) * d; });
  }
  return list;
}
function colAktiv(view) { const st = UI.cs[view] || {}; return !!(st.k || Object.values(st.f || {}).some(Boolean) || Object.keys(UI.q).some(k => k.startsWith(view + '|') && UI.q[k])); }
// base = Liste vor den Spaltenfiltern (für die Auswahllisten)
function colHead(view, cols, base) {
  const st = UI.cs[view] || {};
  const r1 = cols.map(c => `<th class="srt ${c.num ? 'num' : ''} ${st.k === c.k ? 'on' : ''}" data-act="colSort" data-v="${view}" data-k="${c.k}" title="Sortieren">${c.l}<span class="sa">${st.k === c.k ? (st.d === 'desc' ? '▼' : '▲') : '↕'}</span></th>`).join('');
  const fz = cols.map(c => {
    if (c.nof) return '<th></th>';
    if (c.sel) { const f = (st.f && st.f[c.k]) || '', opts = [...new Set(base.map(x => colT(c, x)))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
      return `<th><select class="cf ${f ? 'on' : ''}" data-chg="colF" data-v="${view}" data-k="${c.k}" aria-label="Filter ${c.l}"><option value="">Alle</option>${opts.map(o => `<option value="${esc(o)}" ${o === f ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></th>`; }
    const v = UI.q[view + '|' + c.k] || '';
    return `<th><input class="cf ${v ? 'on' : ''}" type="search" data-q="${view}|${c.k}" value="${esc(v)}" placeholder="${c.num ? 'z. B. >100' : 'Filter'}" aria-label="Filter ${c.l}"></th>`;
  }).join('');
  return `<thead><tr>${r1}</tr><tr class="frow">${fz}</tr></thead>`;
}
const colTxt = (k, l, f) => ({ k, l, v: x => f(x) || '' });
const colDat = (k, l, f) => ({ k, l, v: x => f(x) || '', t: x => f(x) ? fmtD(f(x)) + ' ' + f(x) : '' });
const colNum = (k, l, f) => ({ k, l, num: true, v: x => { const v = f(x); return v == null || v === '' ? null : Number(v); }, t: x => { const v = f(x); return v == null || v === '' ? '' : fmtE(v) + ' ' + v; } });
const COL = { nr: colTxt('nr', 'Nr.', x => x.r.nummer), datum: colDat('datum', 'Datum', x => x.r.datum) };
const colReset = view => colAktiv(view) ? ` <button class="btn sm" data-act="colReset" data-v="${view}">✕ Spaltenfilter zurücksetzen</button>` : '';

function viewRechnungen(dir) {
  const view = dir, range = periodRange(UI.period);
  let list = S.rechnungen.filter(r => r.richtung === dir && (UI.period === 'alle' || inP(r.datum, range) || !['bezahlt', 'erledigt', 'extern', 'storno'].includes(rStatus(r).key))).map(r => ({ r, st: rStatus(r) }));
  // Filter: „Alle“, „Offen“ (alles nicht Bezahlte), dann jeder Status aus der Liste mit Anzahl, dazu überfällig/Abgleich-Probleme/ungeprüft
  const cnt = {}; list.forEach(x => cnt[x.st.label] = (cnt[x.st.label] || 0) + 1);
  const chipOpts = [['alle', 'Alle'], ['offen', 'Alles Offene']].concat(stListe(dir).filter(s => cnt[s]).map(s => ['s:' + s, s + ' · ' + cnt[s]]),
    [['ueberfaellig', 'überfällig'], ['probleme', 'Abgleich: zu viel / zu wenig / doppelt'], ['pruefen', 'nicht geprüft']]);
  list = filterR(list, UI.filt[view]);
  const q = (UI.q[view] || '').toLowerCase().trim(); if (q) list = list.filter(x => q.split(/\s+/).every(w => textOf(x.r).includes(w)));
  list.sort((a, b) => (b.r.datum || '').localeCompare(a.r.datum || '') || String(b.r.nummer || '').localeCompare(String(a.r.nummer || ''), 'de', { numeric: true }));
  const isA = dir === 'ausgang';
  const cols = isA ? [COL.nr, COL.datum, colTxt('kunde', 'Kunde', x => x.r.partner), colTxt('kz', 'Kennz.', x => x.r.kennzeichen)]
    : [COL.datum, colTxt('lief', 'Lieferant', x => x.r.partner), COL.nr, { k: 'ka', l: 'Kostenart', v: x => x.r.kostenart || '', sel: true }];
  cols.push(colNum('brutto', 'Brutto', x => x.r.brutto), colNum('bez', 'Bezahlt', x => x.st.bezahlt), colNum('offen', 'Offen', x => r2(x.st.offen)),
    isA ? { k: 'za', l: 'Zahlart', v: x => ZA[x.r.zahlart] || '', sel: true } : { k: 'beleg', l: 'Beleg', v: x => x.r.datei ? 'mit Beleg' : 'ohne Beleg', sel: true },
    { k: 'st', l: 'Status', v: x => x.st.label, sel: true });
  const base = list; list = colApply(view, list, cols);
  const lim = UI.more[view] || 300, tot = sum(list, x => x.r.brutto), offen = sum(list, x => Math.max(0, x.st.offen));
  return `
  <div class="toolbar"><h1>${isA ? 'Rechnungsausgang' : 'Rechnungseingang'}</h1><span class="sp"></span>
    ${isA ? `<button class="btn primary" data-act="pick" data-t="ausgang">⬆ Excel importieren</button>` : `<button class="btn primary" data-act="pickBeleg">⬆ Belege hochladen</button>`}
    <button class="btn" data-act="neuR" data-dir="${dir}">＋ Von Hand</button>
    <button class="btn" data-act="csv" data-v="${view}">CSV</button></div>
  ${!isA ? `<div class="dropzone" data-act="pickBeleg" role="button" tabindex="0"><b>Rechnungen hierher ziehen</b><span>PDF, Foto oder die ganze E-Mail aus Outlook – auch mehrere auf einmal. ${DB.aiOn ? 'Die KI liest Lieferant, Nummer, Beträge und Kostenart aus.' : '(Auslesen per KI nur in der Online-Version.)'}</span></div>` : ''}
  <div class="filters">${chips(view, chipOpts)}${searchIn(view, isA ? 'Nr., Kunde, Kennzeichen, Betrag …' : 'Lieferant, Nr., Kostenart, Betrag …')}
    <select class="inp" data-chg="period">${PERIODS.map(p => `<option value="${p[0]}" ${UI.period === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></div>
  <div class="sumline">${list.length} Rechnungen · Summe ${fmtE(tot)} · offen ${fmtE(offen)} <span class="muted small">(offene aus früheren Zeiträumen werden immer angezeigt)</span>${colReset(view)}</div>
  <div class="tw"><table class="tb click">${colHead(view, cols, base)}<tbody>
  ${list.slice(0, lim).map(({ r, st }) => `<tr data-act="rechnung" data-id="${r.id}" class="${r.geprueft ? '' : 'unchecked'}">
    ${isA ? `<td class="mono">${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td>${esc(r.partner || '')}</td><td class="mono">${esc(r.kennzeichen || '')}</td>`
      : `<td>${fmtD(r.datum)}</td><td>${esc(r.partner || '')}</td><td class="mono">${esc(r.nummer || '–')}</td><td>${esc(r.kostenart || '–')}</td>`}
    <td class="num">${fmtE(r.brutto)}</td><td class="num">${st.bezahlt ? fmtE(st.bezahlt) : ''}</td><td class="num ${st.offen > 0.01 ? 'neg' : ''}">${Math.abs(st.offen) > 0.01 ? fmtE(st.offen) : ''}</td>
    <td>${isA ? esc(ZA[r.zahlart] || '') : (r.datei ? '📄' : '')}</td><td class="st-td">${stSelect(r)}${st.hint ? ` <span class="badge ${st.hint[1]} hint">${esc(st.hint[0])}</span>` : ''}${r.geprueft ? '' : ' ' + badge({ cls: 'st-ai', label: 'nicht geprüft' })}</td></tr>`).join('') || `<tr><td colspan="9" class="empty">Keine Rechnungen${UI.filt[view] !== 'alle' || q ? ' für diesen Filter' : ''}.</td></tr>`}
  </tbody></table></div>${moreBtn(view, list.length, lim)}`;
}

const FILT_B = [['offen', 'Nicht zugeordnet'], ['alle', 'Alle'], ['ein', 'Eingänge'], ['aus', 'Ausgänge'], ['sumup', 'SumUp-Auszahlungen'], ['kosten', 'Kosten ohne Beleg']];
function viewBank() {
  const range = periodRange(UI.period);
  let list = S.bank.filter(b => UI.period === 'alle' || inP(b.datum, range)).map(b => ({ b, st: bStatus(b) }));
  const f = UI.filt.bank;
  if (f === 'offen') list = list.filter(x => ['offen', 'teilweise'].includes(x.st.key));
  else if (f === 'ein') list = list.filter(x => x.b.betrag > 0); else if (f === 'aus') list = list.filter(x => x.b.betrag < 0);
  else if (f === 'sumup') list = list.filter(x => x.b.art === 'sumup'); else if (f === 'kosten') list = list.filter(x => x.st.key === 'kosten');
  const q = (UI.q.bank || '').toLowerCase().trim(); if (q) list = list.filter(x => q.split(/\s+/).every(w => [x.b.gegenpartei, x.b.zweck, x.b.kostenart, x.b.iban, fmtE(x.b.betrag), x.b.betrag, fmtD(x.b.datum)].join(' ').toLowerCase().includes(w)));
  list.sort((a, b) => b.b.datum.localeCompare(a.b.datum));
  const bRe = x => x.st.zuordnungen.map(z => S.rechnungen.find(r => r.id === z.rechnung_id)).filter(Boolean).map(r => (r.nummer || '') + ' ' + (r.partner || '')).join(' ') || x.b.kostenart || '';
  const cols = [colDat('datum', 'Datum', x => x.b.datum), colTxt('name', 'Name', x => x.b.gegenpartei), colTxt('zweck', 'Verwendungszweck', x => x.b.zweck),
    colNum('betrag', 'Betrag', x => x.b.betrag), colTxt('re', 'Kostenart / Rechnung', bRe), { k: 'st', l: 'Status', v: x => x.st.label, sel: true }];
  const base = list; list = colApply('bank', list, cols);
  const lim = UI.more.bank || 300;
  return `
  <div class="toolbar"><h1>Bank</h1><span class="sp"></span><button class="btn primary" data-act="pick" data-t="bank">⬆ Kontoauszug (CSV/Excel) importieren</button><button class="btn" data-act="auto">⟳ Automatisch abgleichen</button><button class="btn" data-act="csv" data-v="bank">CSV</button></div>
  <div class="filters">${chips('bank', FILT_B)}${searchIn('bank', 'Name, Verwendungszweck, Betrag …')}
    <select class="inp" data-chg="period">${PERIODS.map(p => `<option value="${p[0]}" ${UI.period === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></div>
  <div class="sumline">${list.length} Umsätze · Eingänge ${fmtE(sum(list.filter(x => x.b.betrag > 0), x => x.b.betrag))} · Ausgänge ${fmtE(sum(list.filter(x => x.b.betrag < 0), x => x.b.betrag))}${colReset('bank')}</div>
  <div class="tw"><table class="tb click">${colHead('bank', cols, base)}<tbody>
  ${list.slice(0, lim).map(({ b, st }) => { const rs = st.zuordnungen.map(z => S.rechnungen.find(r => r.id === z.rechnung_id)).filter(Boolean);
    return `<tr data-act="bank" data-id="${b.id}"><td>${fmtD(b.datum)}</td><td>${esc(b.gegenpartei || '')}</td><td class="zweck">${esc(b.zweck || '')}</td><td class="num ${b.betrag < 0 ? 'neg' : 'pos'}">${fmtE(b.betrag)}</td>
    <td class="small">${rs.length ? rs.map(r => esc((r.nummer || '') + ' ' + (r.partner || ''))).join('<br>') : esc(b.kostenart || '')}</td><td>${badge(st)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Keine Bankumsätze für diesen Filter.</td></tr>'}
  </tbody></table></div>${moreBtn('bank', list.length, lim)}`;
}

const FILT_S = [['alle', 'Alle'], ['offen', 'Keiner Rechnung zugeordnet'], ['zugeordnet', 'Zugeordnet']];
function viewSumup() {
  const range = periodRange(UI.period);
  let list = S.sumup.filter(s => UI.period === 'alle' || inP(s.datum, range)).map(s => ({ s, st: sStatus(s) }));
  if (UI.filt.sumup !== 'alle') list = list.filter(x => x.st.key === UI.filt.sumup);
  const q = (UI.q.sumup || '').toLowerCase().trim(); if (q) list = list.filter(x => q.split(/\s+/).every(w => [x.s.beschreibung, x.s.transaktion, x.s.zahlungsart, fmtE(x.s.betrag), x.s.betrag, fmtD(x.s.datum)].join(' ').toLowerCase().includes(w)));
  list.sort((a, b) => b.s.datum.localeCompare(a.s.datum));
  const sRe = x => x.st.zuordnungen.map(z => S.rechnungen.find(r => r.id === z.rechnung_id)).filter(Boolean).map(r => (r.nummer || '') + ' ' + (r.partner || '')).join(' ');
  const sAus = x => { const bk = x.s.bank_id && S.bank.find(b => b.id === x.s.bank_id); return bk ? bk.datum : x.s.auszahlung_datum || ''; };
  const cols = [colDat('datum', 'Datum', x => x.s.datum), colTxt('beschr', 'Beschreibung', x => x.s.beschreibung), { k: 'karte', l: 'Karte', v: x => x.s.zahlungsart || '', sel: true },
    colNum('betrag', 'Betrag', x => x.s.betrag), colNum('geb', 'Gebühr', x => x.s.gebuehr), colTxt('re', 'Rechnung', sRe), colDat('aus', 'Auszahlung', sAus), { k: 'st', l: 'Status', v: x => x.st.label, sel: true }];
  const base = list; list = colApply('sumup', list, cols);
  const ok = list.filter(x => x.st.key !== 'fehl'), lim = UI.more.sumup || 300;
  return `
  <div class="toolbar"><h1>SumUp / EC-Zahlungen</h1><span class="sp"></span><button class="btn primary" data-act="pick" data-t="sumup">⬆ SumUp-Export importieren</button><button class="btn" data-act="auto">⟳ Automatisch abgleichen</button><button class="btn" data-act="csv" data-v="sumup">CSV</button></div>
  <div class="filters">${chips('sumup', FILT_S)}${searchIn('sumup', 'Beschreibung, Betrag, Transaktion …')}
    <select class="inp" data-chg="period">${PERIODS.map(p => `<option value="${p[0]}" ${UI.period === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></div>
  <div class="sumline">${ok.length} Zahlungen · ${fmtE(sum(ok, x => x.s.betrag))} · Gebühren ${fmtE(sum(ok, x => x.s.gebuehr))}${colReset('sumup')}</div>
  <div class="tw"><table class="tb click">${colHead('sumup', cols, base)}<tbody>
  ${list.slice(0, lim).map(({ s, st }) => { const rs = st.zuordnungen.map(z => S.rechnungen.find(r => r.id === z.rechnung_id)).filter(Boolean); const bk = s.bank_id && S.bank.find(b => b.id === s.bank_id);
    return `<tr data-act="sumup" data-id="${s.id}"><td>${fmtD(s.datum)}</td><td>${esc(s.beschreibung || '')}</td><td>${esc(s.zahlungsart || '')}</td><td class="num">${fmtE(s.betrag)}</td><td class="num">${s.gebuehr != null ? fmtE(s.gebuehr) : ''}</td>
    <td class="small">${rs.map(r => esc((r.nummer || '') + ' ' + (r.partner || ''))).join('<br>')}</td><td class="small">${bk ? '✓ ' + fmtD(bk.datum) : s.auszahlung_datum ? fmtD(s.auszahlung_datum) : ''}</td><td>${badge(st)}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Keine SumUp-Zahlungen.</td></tr>'}
  </tbody></table></div>${moreBtn('sumup', list.length, lim)}`;
}

/* ---------- Abgleich & Probleme ---------- */
function viewAbgleich() {
  const all = S.rechnungen.map(r => ({ r, st: rStatus(r) }));
  const grp = k => all.filter(x => x.st.key === k);
  const rCols = dirCol => [...(dirCol ? [{ k: 'dir', l: '', v: x => x.r.richtung === 'ausgang' ? '↗ Ausgang' : '↘ Eingang', sel: true }] : []), COL.nr, COL.datum, colTxt('partner', 'Partner', x => x.r.partner),
    colNum('brutto', 'Brutto', x => x.r.brutto), colNum('bez', 'Bezahlt', x => x.st.bezahlt), colNum('diff', 'Differenz', x => r2(-x.st.offen))];
  const rows = (l0, dirCol = true, key = 'abg') => { if (!l0.length) return '<div class="empty small">Nichts – alles gut.</div>'; const cols = rCols(dirCol), l = colApply(key, l0, cols);
    return `<div class="tw"><table class="tb click">${colHead(key, cols, l0)}<tbody>
    ${l.map(({ r, st }) => `<tr data-act="rechnung" data-id="${r.id}">${dirCol ? `<td>${r.richtung === 'ausgang' ? '↗' : '↘'}</td>` : ''}<td class="mono">${esc(r.nummer || '–')}</td><td>${fmtD(r.datum)}</td><td>${esc(r.partner || '')}</td><td class="num">${fmtE(r.brutto)}</td><td class="num">${fmtE(st.bezahlt)}</td><td class="num neg">${fmtE(-st.offen)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty small">Nichts für diesen Filter.</td></tr>'}</tbody></table></div>`; };
  const bankOffen = S.bank.filter(b => b.betrag > 0 && ['offen', 'teilweise'].includes(bStatus(b).key)).sort((a, b) => b.datum.localeCompare(a.datum));
  const bankAusOffen = S.bank.filter(b => b.betrag < 0 && bStatus(b).key === 'offen').sort((a, b) => b.datum.localeCompare(a.datum));
  const sumOffen = S.sumup.filter(s => sStatus(s).key === 'offen').sort((a, b) => b.datum.localeCompare(a.datum));
  const ueberf = grp('ueberfaellig').filter(x => x.r.richtung === 'ausgang').sort((a, b) => (a.r.datum || '').localeCompare(b.r.datum || ''));
  const blCols = [colDat('datum', 'Datum', b => b.datum), colTxt('name', 'Name', b => b.gegenpartei), colTxt('zweck', 'Verwendungszweck', b => b.zweck), colNum('betrag', 'Betrag', b => b.betrag)];
  const bl = (l0, key) => { if (!l0.length) return '<div class="empty small">Nichts offen.</div>'; const l = colApply(key, l0, blCols);
    return `<div class="tw"><table class="tb click">${colHead(key, blCols, l0)}<tbody>${l.slice(0, 50).map(b => `<tr data-act="bank" data-id="${b.id}"><td>${fmtD(b.datum)}</td><td>${esc(b.gegenpartei || '')}</td><td class="zweck">${esc(b.zweck || '')}</td><td class="num">${fmtE(b.betrag)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty small">Nichts für diesen Filter.</td></tr>'}</tbody></table></div>${l.length > 50 ? `<p class="small muted">+ ${l.length - 50} weitere unter „Bank“.</p>` : ''}`; };
  const suCols = [colDat('datum', 'Datum', s => s.datum), colTxt('beschr', 'Beschreibung', s => s.beschreibung), colNum('betrag', 'Betrag', s => s.betrag)];
  const sl = (l0, key) => { if (!l0.length) return '<div class="empty small">Nichts offen.</div>'; const l = colApply(key, l0, suCols);
    return `<div class="tw"><table class="tb click">${colHead(key, suCols, l0)}<tbody>${l.slice(0, 50).map(s => `<tr data-act="sumup" data-id="${s.id}"><td>${fmtD(s.datum)}</td><td>${esc(s.beschreibung || '')}</td><td class="num">${fmtE(s.betrag)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty small">Nichts für diesen Filter.</td></tr>'}</tbody></table></div>${l.length > 50 ? `<p class="small muted">+ ${l.length - 50} weitere unter „SumUp“.</p>` : ''}`; };
  return `
  <div class="toolbar"><h1>Abgleich & Probleme</h1><span class="sp"></span><button class="btn primary" data-act="auto">⟳ Automatisch abgleichen</button></div>
  <p class="muted">Der Abgleich ordnet Zahlungen über Rechnungsnummer im Verwendungszweck, Name/IBAN und Betrag zu. Unklare Fälle bleiben hier stehen – anklicken und von Hand zuordnen.</p>
  <div class="grid2">
    <section class="card"><h3>⚠ Doppelt bezahlt <span class="cnt">${grp('doppelt').length}</span></h3>${rows(grp('doppelt'), true, 'abgD')}</section>
    <section class="card"><h3>Zu viel bezahlt <span class="cnt">${grp('ueber').length}</span></h3>${rows(grp('ueber'), true, 'abgU')}</section>
    <section class="card"><h3>Zu wenig bezahlt <span class="cnt">${grp('teil').length}</span></h3>${rows(grp('teil'), true, 'abgT')}</section>
    <section class="card"><h3>Überfällige Kundenrechnungen <span class="cnt">${ueberf.length}</span></h3>${rows(ueberf, false, 'abgF')}</section>
    <section class="card"><h3>Zahlungseingänge ohne Rechnung <span class="cnt">${bankOffen.length}</span></h3>${bl(bankOffen, 'abgB')}</section>
    <section class="card"><h3>EC-Zahlungen (SumUp) ohne Rechnung <span class="cnt">${sumOffen.length}</span></h3>${sl(sumOffen, 'abgS')}</section>
    <section class="card"><h3>Bankabgänge ohne Beleg und ohne Kostenart <span class="cnt">${bankAusOffen.filter(b => !b.kostenart).length}</span></h3>${bl(bankAusOffen.filter(b => !b.kostenart), 'abgK')}</section>
  </div>`;
}

/* ---------- Einstellungen ---------- */
function viewEinst() {
  const imps = [...S.importe].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const ART = { ausgang: 'Rechnungsausgang', sumup: 'SumUp', bank: 'Bank', eingang: 'Eingang' };
  return `
  <div class="toolbar"><h1>Einstellungen</h1></div>
  <div class="grid2">
  <section class="card"><h3>Allgemein</h3>
    <label class="fld"><span>Zahlungsziel für Kundenrechnungen ohne Fälligkeitsdatum (Tage)</span><input class="inp" type="number" min="0" max="120" value="${ZIEL_TAGE()}" data-chg="ziel"></label>
    <p class="small muted">Danach gilt eine Rechnung als überfällig.</p>
    <p class="small">Verbindung: ${DB.cloud ? '● Supabase (online, alle Geräte)' : '○ Demo-Modus – Daten nur in diesem Browser'} · KI: ${DB.aiOn ? 'an' : 'aus'}${S.user ? ' · angemeldet als ' + esc(S.user.email) : ''}</p>
    ${DB.cloud ? '<button class="btn" data-act="pw">Passwort ändern</button> <button class="btn" data-act="logout">Abmelden</button>' : '<button class="btn" data-act="demo">Demo-Daten laden</button> <button class="btn danger" data-act="resetDemo">Demo-Daten löschen</button>'}
  </section>
  <section class="card"><h3>Beleg-Ablage</h3>
    <p class="small">Eingangsrechnungen werden automatisch benannt:<br><span class="mono small">VE Sport_Lieferant_Art_Nummer_Datum.pdf</span><br><span class="muted">z. B. ${esc(belegName({ partner: 'Stahlgruber GmbH', art: 'Rechnung', nummer: '4711-0815', datum: '2026-11-20' }))}</span></p>
    ${ablageMoeglich() ? `<p class="small">Ordner auf diesem PC: ${ABLAGE ? `<b>📁 ${esc(ABLAGE.name)}</b>` : '<span class="muted">noch keiner gewählt</span>'}</p>
    <button class="btn primary" data-act="ablageWahl">${ABLAGE ? 'Anderen Ordner wählen' : '📁 Ordner wählen'}</button>
    ${ABLAGE ? `<button class="btn" data-act="ablageAlle">Vorhandene Belege jetzt ablegen</button> <button class="btn" data-act="ablageAus">Ablage aus</button>` : ''}
    <p class="small muted">Jede reingezogene Rechnung wird zusätzlich in diesen Ordner gelegt (z. B. euer OneDrive- oder HiDrive-Ordner). Ändert ihr Lieferant, Nummer, Art oder Datum, wird die Datei umbenannt. Der Ordner gilt für diesen Browser; der Browser fragt beim ersten Mal nach Erlaubnis.</p>`
    : '<p class="small muted">Die Ablage in einen Ordner auf dem PC geht nur in Chrome oder Edge. Die Belege liegen trotzdem sicher in der App und lassen sich mit dem richtigen Namen herunterladen.</p>'}
  </section>
  <section class="card"><h3>Importe</h3><p class="small muted">Ein falscher Import lässt sich hier komplett rückgängig machen.</p>
    ${imps.length ? `<div class="tw"><table class="tb"><thead><tr><th>Wann</th><th>Art</th><th>Datei</th><th class="num">Neu</th><th class="num">Doppelt</th><th></th></tr></thead><tbody>
    ${imps.slice(0, 60).map(i => `<tr><td>${fmtD((i.created_at || '').slice(0, 10))}</td><td>${ART[i.art] || i.art}</td><td>${esc(i.datei || '')}</td><td class="num">${i.neu ?? ''}</td><td class="num">${i.doppelt ?? ''}</td><td><button class="btn sm danger" data-act="undoImp" data-id="${i.id}">Rückgängig</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty small">Noch keine Importe.</div>'}
  </section></div>`;
}
