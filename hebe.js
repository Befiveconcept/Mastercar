/* Mastercar Finanzen · Hebebühne: Stunden je Tag und Mitarbeiter, Aufträge, Vergleich je KW
   „Auf Rechnung“ = Werkstatt-Lohn netto aus dem Rechnungsausgang · „Tatsächlich“ = Stunden × Stundensatz */
const STUNDENSATZ = () => +(S.einstellungen.stundensatz ?? 105);
const kwKey = d => { const k = isoWeek(d); return k.y + '-' + String(k.w).padStart(2, '0'); };
function hebeWochen(jahr) {
  const W = {};
  const get = k => W[k] = W[k] || { std: 0, lohn: 0, n: 0 };
  S.hebebuehne.forEach(h => { const k = kwKey(h.datum); if (!k.startsWith(jahr)) return; const w = get(k); w.std += +h.stunden || 0; w.n++; });
  // alle Ausgangsrechnungen inkl. Stornos (Storno-Gegenbuchung gleicht sich aus) – wie in der Excel-Mappe
  S.rechnungen.forEach(r => { if (r.richtung !== 'ausgang' || !r.datum) return; const k = kwKey(r.datum); if (!k.startsWith(jahr)) return; get(k).lohn += +r.lohn || 0; });
  return W;
}
/* ---------- Kennzeichen der Hebebühne ↔ Ausgangsrechnungen ---------- */
const kzN = s => String(s || '').toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/[^A-Z0-9]/g, '');
const istKz = k => k.length >= 4 && k.length <= 10 && /^[A-Z]{1,5}\d{1,4}[EH]?$/.test(k);
const hStd = x => String(r2(x || 0)).replace('.', ',') + ' h';
/* Jeder Auftrag an der Bühne wird der Ausgangsrechnung mit gleichem Kennzeichen zugeordnet, deren Datum am nächsten
   nach dem Arbeitstag liegt (bis 60 Tage danach, notfalls bis 7 Tage davor). Stehen an einem Tag mehrere Aufträge,
   werden die Stunden des Tages gleichmäßig aufgeteilt (die Excel hat keine Stunden je Auftrag). */
function hebeZuordnung() {
  const byKz = new Map(), byKd = new Map();
  S.rechnungen.forEach(r => {
    if (r.richtung !== 'ausgang' || !r.datum || r.art === 'Storno' || r.art === 'Mahnung' || istStornoLaut(r.status_excel)) return;
    const k = kzN(r.kennzeichen); if (istKz(k)) (byKz.get(k) || byKz.set(k, []).get(k)).push(r);
    const kd = kzN(r.kundennr); if (kd.length >= 3) (byKd.get(kd) || byKd.set(kd, []).get(kd)).push(r);
  });
  const naechste = (rs, d) => { let best = null, bs = 1e9;
    (rs || []).forEach(r => { const t = daysBetween(d, r.datum), s = t >= 0 ? (t <= 60 ? t : 1e9) : (t >= -7 ? -t * 3 + 1 : 1e9); if (s < bs) { bs = s; best = r; } });
    return best; };
  const jobs = [], proR = new Map();
  S.hebebuehne.forEach(h => {
    if (h.abwesend) return;
    const js = (h.auftraege || []).filter(j => j.name || j.kdnr || j.auftrag);
    if (!js.length) { if (h.stunden) jobs.push({ h, j: {}, kz: '', std: +h.stunden || 0, r: null, ohne: true }); return; }
    js.forEach(j => {
      const kz = kzN(j.auftrag), std = (+h.stunden || 0) / js.length;
      const r = (istKz(kz) && naechste(byKz.get(kz), h.datum)) || (kzN(j.kdnr).length >= 3 && naechste(byKd.get(kzN(j.kdnr)), h.datum)) || null;
      const x = { h, j, kz: istKz(kz) ? kz : '', std, r }; jobs.push(x);
      if (r) { const p = proR.get(r.id) || proR.set(r.id, { r, std: 0, jobs: [] }).get(r.id); p.std += std; p.jobs.push(x); }
    });
  });
  return { jobs, proR };
}
/* Feiertage NRW (Bornheim) – an diesen Tagen fehlt nichts */
function feiertageNRW(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
    hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451),
    mon = Math.floor((hh + l - 7 * m + 114) / 31), tag = ((hh + l - 7 * m + 114) % 31) + 1;
  const ostern = `${y}-${String(mon).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
  return new Set([`${y}-01-01`, `${y}-05-01`, `${y}-10-03`, `${y}-11-01`, `${y}-12-25`, `${y}-12-26`, ...[-2, 1, 39, 50, 60].map(n => addDays(ostern, n))]);
}
/* Fehlende Bühnen-Daten: Werktage (Mo–Fr, ohne Feiertage) ohne jeden Eintrag; dazu Mitarbeiter, die in einer Woche
   Einträge haben, an einzelnen Tagen aber nicht (und nicht als abwesend eingetragen sind) */
function hebeLuecken(jahr) {
  const ein = S.hebebuehne.filter(h => h.datum && h.datum.startsWith(jahr)); if (!ein.length) return {};
  const ft = feiertageNRW(+jahr), start = ein.reduce((m, h) => h.datum < m ? h.datum : m, ein[0].datum);
  const gestern = addDays(todayISO(), -1), ende = gestern.startsWith(jahr) ? gestern : jahr + '-12-31';
  const proTag = new Map(); ein.forEach(h => (proTag.get(h.datum) || proTag.set(h.datum, []).get(h.datum)).push(h));
  const out = {};
  for (let d = isoWeekMonday(+jahr, isoWeek(start).w); d <= ende; d = addDays(d, 1)) {
    const wd = (new Date(d + 'T12:00:00').getDay() + 6) % 7; if (wd > 4 || ft.has(d) || d < start) continue;
    const k = kwKey(d), w = out[k] = out[k] || { leer: [], ma: {} };
    if (!proTag.has(d)) { w.leer.push(d); continue; }
    const mon = isoWeekMonday(+k.slice(0, 4), +k.slice(5)), so = addDays(mon, 6);
    const aktiv = [...new Set(ein.filter(h => h.datum >= mon && h.datum <= so).map(h => h.mitarbeiter))];
    aktiv.forEach(m => { if (!proTag.get(d).some(h => h.mitarbeiter === m)) (w.ma[m] = w.ma[m] || []).push(d); });
  }
  Object.keys(out).forEach(k => { const w = out[k]; w.n = w.leer.length + Object.values(w.ma).reduce((s, a) => s + a.length, 0); if (!w.n) delete out[k]; });
  return out;
}
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], wtag = d => WT[new Date(d + 'T12:00:00').getDay()] + ' ' + fmtD(d).slice(0, 6);
/* Bühnenstunden zu einer Ausgangsrechnung (für die Rechnungsansicht) */
function hebeZuRechnung(id) { return S.hebebuehne && S.hebebuehne.length ? hebeZuordnung().proR.get(id) || null : null; }

function viewHebe() {
  const satz = STUNDENSATZ();
  const all = [...new Set(S.hebebuehne.map(h => kwKey(h.datum)))].sort();
  if (!UI.hebeKW) { const cur = kwKey(todayISO()); UI.hebeKW = all.includes(cur) || !all.length ? cur : all[all.length - 1]; }
  const [y, w] = UI.hebeKW.split('-').map(Number), mon = isoWeekMonday(y, w), days = [0, 1, 2, 3, 4, 5].map(i => addDays(mon, i));
  const W = hebeWochen(String(y)), cw = W[UI.hebeKW] || { std: 0, lohn: 0 };
  const maAlle = [...new Set(S.hebebuehne.map(h => h.mitarbeiter))].sort((a, b) => a.localeCompare(b, 'de'));
  // nur Mitarbeiter zeigen, die um diese Woche herum (±60 Tage) Einträge haben
  const ma = UI.hebeMa ? [UI.hebeMa] : maAlle.filter(m => S.hebebuehne.some(h => h.mitarbeiter === m && h.datum >= addDays(mon, -60) && h.datum <= addDays(mon, 60)));
  const zelle = (d, m) => {
    const es = S.hebebuehne.filter(h => h.datum === d && h.mitarbeiter === m);
    const std = sum(es, h => h.stunden);
    return `<td class="hb-c ${es.some(h => h.abwesend) ? 'abw' : ''}" data-act="hebeNeu" data-d="${d}" data-ma="${esc(m)}">${es.length ? `${std ? `<b>${String(std).replace('.', ',')} h</b>` : ''}${es.map(h => h.abwesend ? `<div class="small">${esc(h.abwesend)}</div>` : (h.auftraege || []).map(j => `<div class="hb-j" data-act="hebeE" data-id="${h.id}">${esc([j.name, j.auftrag].filter(Boolean).join(' · ') || j.kdnr)}</div>`).join('') || (h.stunden ? `<div class="hb-j" data-act="hebeE" data-id="${h.id}">ohne Auftrag</div>` : '')).join('')}` : '<span class="muted">＋</span>'}</td>`;
  };
  const kws = [...new Set([...Object.keys(W), ...Object.keys(hebeLuecken(String(y)))])].sort().filter(k => W[k] || k <= kwKey(todayISO())), last16 = kws.filter(k => k <= UI.hebeKW).slice(-16);
  kws.forEach(k => { W[k] = W[k] || { std: 0, lohn: 0, n: 0 }; });
  const jahrSum = { std: sum(Object.values(W), x => x.std), lohn: sum(Object.values(W), x => x.lohn) };
  const L = hebeLuecken(String(y)), Z = hebeZuordnung();
  const cwStdR = cw.lohn / satz, dh = cwStdR - cw.std;
  return `
  <div class="toolbar"><h1>Hebebühne</h1><span class="sp"></span>
    <button class="btn" data-act="hebeKW" data-d="-1">‹</button><b class="kw-l">KW ${w} / ${y}<small>${fmtD(mon)} – ${fmtD(days[5])}</small></b><button class="btn" data-act="hebeKW" data-d="1">›</button><button class="btn" data-act="hebeKW" data-d="0">Heute</button>
    <button class="btn primary" data-act="hebeNeu">＋ Eintrag</button></div>
  <section class="kpi">
    <div class="k hi"><div class="kv">${hStd(cw.std)}</div><div class="kl">An der Hebebühne in KW ${w}</div></div>
    <div class="k"><div class="kv">${hStd(cwStdR)}</div><div class="kl">Auf Rechnungen der KW ${w} (${fmtE(cw.lohn)} Lohn ÷ ${fmtE(satz)})</div></div>
    <div class="k ${dh < -0.01 ? 'alarm' : ''}"><div class="kv ${dh < -0.01 ? 'neg' : ''}">${dh > 0 ? '+' : ''}${hStd(dh)}</div><div class="kl">Differenz Stunden (Rechnung − Bühne)</div></div>
    <div class="k ${cw.lohn - cw.std * satz < -0.005 ? 'alarm' : ''}"><div class="kv ${cw.lohn - cw.std * satz < -0.005 ? 'neg' : ''}">${fmtE(cw.lohn - cw.std * satz)}</div><div class="kl">Differenz € (Lohn auf Rechnung − Bühne × ${fmtE(satz)})</div></div>
  </section>
  ${L[UI.hebeKW] ? `<div class="warn" style="margin-bottom:12px">⚠ In KW ${w} fehlen Bühnen-Daten: ${hebeLueckeText(L[UI.hebeKW])}</div>` : ''}
  <div class="filters"><select class="inp" data-chg="hebeMa"><option value="">Alle Mitarbeiter</option>${maAlle.map(m => `<option ${m === UI.hebeMa ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
    <label class="small">Stundensatz € <input class="inp num-in" type="number" step="1" value="${satz}" data-chg="stundensatz"></label></div>
  <div class="tw"><table class="tb hb-t"><thead><tr><th>Mitarbeiter</th>${days.map(d => `<th>${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][days.indexOf(d)]} ${fmtD(d).slice(0, 6)}</th>`).join('')}<th class="num">Summe</th></tr></thead><tbody>
    ${(ma.length ? ma : maAlle).map(m => `<tr><th>${esc(m)}</th>${days.map(d => zelle(d, m)).join('')}<td class="num"><b>${String(r2(sum(S.hebebuehne.filter(h => h.mitarbeiter === m && h.datum >= mon && h.datum <= days[5]), h => h.stunden))).replace('.', ',')} h</b></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Noch keine Einträge – „＋ Eintrag“ oder die Excel-Mappe reinziehen.</td></tr>'}
  </tbody></table></div>
  ${hebeAuftraegeHtml(Z, mon, days[5], satz, w)}
  <div class="grid2" style="margin-top:16px">
    <section class="card"><h3>Stunden auf Rechnung vs. an der Bühne (letzte 16 Wochen)</h3>${barChart(last16.map(k => 'KW' + +k.slice(5)), [{ name: 'Auf Rechnung (h)', cls: 'c1', data: last16.map(k => r2(W[k].lohn / satz)) }, { name: 'Hebebühne (h)', cls: 'c2', data: last16.map(k => r2(W[k].std)) }])}</section>
    <section class="card"><h3>Fehlende Bühnen-Daten ${y}</h3><p class="small muted">Werktage Mo–Fr ohne Feiertage (NRW), bis gestern. „Ganzer Tag“ = niemand eingetragen; Namen = an diesem Tag fehlt der Eintrag, obwohl die Person in der Woche gearbeitet hat und nicht als abwesend steht.</p>
      ${Object.keys(L).length ? `<div class="tw" style="max-height:340px;overflow:auto"><table class="tb click"><thead><tr><th>KW</th><th>Was fehlt</th></tr></thead><tbody>
      ${Object.keys(L).sort().reverse().map(k => `<tr data-act="hebeGo" data-k="${k}" class="${k === UI.hebeKW ? 'sel' : ''}"><td>KW ${+k.slice(5)}</td><td class="small">${hebeLueckeText(L[k])}</td></tr>`).join('')}</tbody></table></div>` : '<p class="ok">✓ Keine Lücken gefunden.</p>'}</section>
  </div>
  <section class="card" style="margin-top:16px"><h3>Kalenderwochen ${y}: Stunden auf Rechnung und an der Hebebühne</h3>
    <p class="small muted">Gesamt: Bühne ${hStd(jahrSum.std)} · auf Rechnung ${hStd(jahrSum.lohn / satz)} (${fmtE(jahrSum.lohn)} Lohn netto ÷ ${fmtE(satz)}) · Differenz ${hStd(jahrSum.lohn / satz - jahrSum.std)} bzw. ${fmtE(jahrSum.lohn - jahrSum.std * satz)}. Rechnungen zählen in der KW ihres Rechnungsdatums.</p>
    <div class="tw" style="max-height:420px;overflow:auto"><table class="tb click"><thead><tr><th>KW</th><th class="num">Hebebühne</th><th class="num">Auf Rechnung</th><th class="num">Differenz h</th><th class="num">Lohn netto</th><th class="num">Bühne × Satz</th><th class="num">Differenz €</th><th>Daten fehlen</th></tr></thead><tbody>
    ${kws.slice().reverse().map(k => { const x = W[k], sr = x.lohn / satz, d = sr - x.std, de = x.lohn - x.std * satz, l = L[k];
      return `<tr data-act="hebeGo" data-k="${k}" class="${k === UI.hebeKW ? 'sel' : ''}"><td>KW ${+k.slice(5)}</td><td class="num">${hStd(x.std)}</td><td class="num">${hStd(sr)}</td><td class="num ${d < -0.01 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${hStd(d)}</td><td class="num">${fmtE(x.lohn)}</td><td class="num">${fmtE(x.std * satz)}</td><td class="num ${de < 0 ? 'neg' : 'pos'}">${fmtE(de)}</td><td class="small">${l ? `<span style="color:#e5484d">⚠ ${l.leer.length ? l.leer.length + ' Tag' + (l.leer.length > 1 ? 'e' : '') + ' leer' : ''}${l.leer.length && Object.keys(l.ma).length ? ' · ' : ''}${Object.keys(l.ma).length ? Object.keys(l.ma).length + ' Mitarb. lückenhaft' : ''}</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div></section>`;
}
function hebeLueckeText(l) {
  const teile = [];
  if (l.leer.length === 5) teile.push('<b>ganze Woche</b>');
  else if (l.leer.length) teile.push('<b>ganzer Tag:</b> ' + l.leer.map(wtag).join(', '));
  Object.entries(l.ma).forEach(([m, ds]) => teile.push(`<b>${esc(m)}:</b> ${ds.map(wtag).join(', ')}`));
  return teile.join(' · ');
}
/* Aufträge der Woche je Rechnung: Bühnenstunden (alle Tage, auch aus anderen Wochen) vs. Lohn und Stunden auf der Rechnung */
function hebeAuftraegeHtml(Z, von, bis, satz, w) {
  const woche = Z.jobs.filter(x => x.h.datum >= von && x.h.datum <= bis); if (!woche.length) return '';
  const rIds = [...new Set(woche.filter(x => x.r).map(x => x.r.id))], ohne = woche.filter(x => !x.r);
  const tage = jobs => jobs.slice().sort((a, b) => a.h.datum.localeCompare(b.h.datum)).map(x => `${wtag(x.h.datum)} ${esc(x.h.mitarbeiter)} ${hStd(x.std)}`).join('<br>');
  const zeilen = rIds.map(id => Z.proR.get(id)).sort((a, b) => (a.jobs[0].h.datum).localeCompare(b.jobs[0].h.datum)).map(p => {
    const r = p.r, lohn = +r.lohn || 0, sr = lohn / satz, d = sr - p.std, proStd = p.std ? lohn / p.std : 0;
    return `<tr data-act="rechnung" data-id="${r.id}"><td class="mono">${esc(r.kennzeichen || '')}</td><td>${esc(r.partner || '')}</td><td class="small">${tage(p.jobs)}</td><td class="num"><b>${hStd(p.std)}</b></td>
      <td><b>${esc(r.nummer || '')}</b><div class="small muted">${fmtD(r.datum)}</div></td><td class="num">${fmtE(lohn)}</td><td class="num">${hStd(sr)}</td><td class="num ${d < -0.01 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${hStd(d)}</td><td class="num ${p.std && proStd < satz - 0.005 ? 'neg' : ''}">${p.std ? fmtE(proStd) : '–'}</td></tr>`; });
  const zOhne = ohne.map(x => `<tr data-act="hebeE" data-id="${x.h.id}"><td class="mono">${esc(x.j.auftrag || '')}</td><td>${esc(x.j.name || (x.ohne ? 'ohne Auftrag' : ''))}</td><td class="small">${wtag(x.h.datum)} ${esc(x.h.mitarbeiter)} ${hStd(x.std)}</td><td class="num">${hStd(x.std)}</td>
      <td colspan="5" class="small" style="color:#e5484d">${x.ohne ? 'Kein Auftrag eingetragen' : !x.kz ? 'Kein gültiges Kennzeichen eingetragen' : 'Keine Ausgangsrechnung mit diesem Kennzeichen gefunden (noch nicht geschrieben?)'}</td></tr>`);
  return `<section class="card" style="margin-top:16px"><h3>Aufträge KW ${w} ↔ Ausgangsrechnungen</h3>
    <p class="small muted">Über das Kennzeichen zugeordnet (Rechnung mit gleichem Kennzeichen, die am nächsten nach dem Arbeitstag liegt). Stunden „Hebebühne“ = alle Tage zu dieser Rechnung, auch aus anderen Wochen; mehrere Aufträge am selben Tag teilen sich die Stunden. „Auf Rechnung“ = Werkstatt-Lohn netto ÷ ${fmtE(satz)}.</p>
    <div class="tw"><table class="tb click"><thead><tr><th>Kennzeichen</th><th>Kunde</th><th>Arbeitstage</th><th class="num">Hebebühne</th><th>Rechnung</th><th class="num">Lohn netto</th><th class="num">Auf Rechnung</th><th class="num">Differenz</th><th class="num">€ je Bühnen-h</th></tr></thead><tbody>
    ${zeilen.join('')}${zOhne.join('')}</tbody></table></div></section>`;
}
function hebeForm(h, pre) {
  const neu = !h; h = h || { datum: todayISO(), auftraege: [], ...(pre || {}) };
  const jobs = [0, 1, 2].map(i => h.auftraege?.[i] || {});
  openSheet({
    title: neu ? 'Hebebühne – neuer Eintrag' : 'Hebebühne – Eintrag', html: `<form class="form2">
    <label class="fld"><span>Datum</span><input class="inp" type="date" name="datum" value="${esc(h.datum)}" required></label>
    <label class="fld"><span>Mitarbeiter</span><input class="inp" name="mitarbeiter" list="maList2" value="${esc(h.mitarbeiter || '')}" required><datalist id="maList2">${mitarbeiter().map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
    <label class="fld"><span>Stunden an der Hebebühne</span><input class="inp" type="number" step="0.25" min="0" name="stunden" value="${h.stunden ?? ''}"></label>
    <label class="fld"><span>Abwesend (krank, Urlaub …)</span><input class="inp" name="abwesend" value="${esc(h.abwesend || '')}"></label>
    ${jobs.map((j, i) => `<div class="fld full hb-jobrow"><span>${i + 1}. Auftrag</span><div class="hb-job3"><input class="inp" name="n${i}" placeholder="Firma / Name" value="${esc(j.name || '')}"><input class="inp" name="k${i}" placeholder="Auftrags-/Kd.-Nr. (w26-…)" value="${esc(j.kdnr || '')}"><input class="inp" name="a${i}" placeholder="Kennzeichen" value="${esc(j.auftrag || '')}"></div></div>`).join('')}
    <label class="fld full"><span>Notiz</span><input class="inp" name="notiz" value="${esc(h.notiz || '')}"></label></form>
    ${neu ? '' : '<button type="button" class="btn danger" id="hbDel">Eintrag löschen</button>'}`,
    onOk: async d => {
      const fd = Object.fromEntries(new FormData($('form', d)));
      if (!fd.datum || !fd.mitarbeiter.trim()) { toast('Bitte Datum und Mitarbeiter eintragen.'); return false; }
      const row = { datum: fd.datum, mitarbeiter: fd.mitarbeiter.trim(), stunden: parseNum(fd.stunden), abwesend: fd.abwesend || null, notiz: fd.notiz || null,
        auftraege: [0, 1, 2].map(i => ({ name: fd['n' + i].trim(), kdnr: fd['k' + i].trim(), auftrag: fd['a' + i].trim().toUpperCase() })).filter(j => j.name || j.kdnr || j.auftrag) };
      if (neu) await DB.insert('hebebuehne', [{ ...row, schluessel: 'HM' + uid() }]); else await DB.update('hebebuehne', h.id, row);
      UI.hebeKW = kwKey(row.datum); render(); toast('Gespeichert.');
    }
  });
  const del = $('#hbDel'); if (del) del.onclick = async () => { if (confirm('Eintrag löschen?')) { await DB.remove('hebebuehne', h.id); closeSheet(); render(); } };
}
