# Mastercar Bornheim · Finanzen

Finanz-Software der Werkstatt **Mastercar Bornheim** (VE Sportmanagement UG (haftungsbeschränkt)).
Läuft im Browser (Laptop, Tablet, Handy), Daten liegen in **Supabase**, Code auf **GitHub**, die Seite selbst auf **GitHub Pages**.

## Was sie kann

| Bereich | So geht's |
|---|---|
| **KI-Suchleiste** (oben, wie im Sonnenplan) | Tippen = sofort suchen (Rechnungsnr., Kunde, Kennzeichen, Betrag …). Enter mit einer Frage = KI-Assistent antwortet aus den echten Daten, auch mit Tabelle oder Diagramm. 🎙 = sprechen. Dateien in die Leiste ziehen = importieren. |
| **Rechnungsausgang aus Excel** | Excel-Datei reinziehen. Spalten werden automatisch erkannt (auch mit Titelzeilen darüber), im Fenster geprüft und für den nächsten Import gemerkt. Doppelte Rechnungsnummern werden erkannt. „Bar“ bezahlte Rechnungen gelten sofort als bezahlt. |
| **Rechnungseingang per Drag & Drop** | PDF, Foto oder die ganze Mail aus Outlook (.msg/.eml) reinziehen – auch mehrere. Die KI liest Lieferant, Nummer, Datum, Netto/MwSt./Brutto, IBAN und Kostenart aus, der Beleg wird gespeichert. Gleiche Rechnung zweimal → wird erkannt. |
| **SumUp (EC-Zahlungen)** | SumUp-Export reinziehen. Kartenzahlungen werden den Kundenrechnungen zugeordnet (Rechnungsnr. in der Beschreibung, sonst Betrag + Datum). Die SumUp-Sammelauszahlung auf dem Konto wird mit den Einzelzahlungen verknüpft. |
| **Bankabgleich** | Kontoauszug als CSV/Excel reinziehen (z. B. Sparkasse CSV-CAMT). Zahlungen werden über Rechnungsnummer im Verwendungszweck, Name/IBAN und Betrag zugeordnet – auch Sammelzahlungen. |
| **Status je Rechnung** | Offen · Überfällig · Bezahlt · **Zu wenig** · **Zu viel** · **Doppelt bezahlt** · Erledigt. Alles Auffällige steht unter „Abgleich & Probleme“. |
| **Übersicht** | Umsatz, Ausgaben, Ergebnis, offene Forderungen/Verbindlichkeiten, Einnahmen/Ausgaben je Monat, Ausgaben nach Kostenart, Zahlarten (Überweisung/EC/Bar), Kontobewegungen. Zeitraum wählbar. |
| **Export** | Jede Liste als CSV (für Excel oder den Steuerberater). Jeder Import lässt sich unter „Einstellungen“ komplett rückgängig machen. |

| **Excel-Mappe „Ein- und Ausgaben“** | Ganze Mappe (.xlsb/.xlsx) reinziehen: *Ein- und Ausgaben* → Rechnungseingang (mit GuV-Kategorie, Art, Fix/Variabel, Skonto, durchlaufende Posten), *Werkstatt Journal* → Rechnungsausgang (Lohn/Teile/Sonstiges/Altteile), *Kassenbuch*, *Actions* → To-Dos, *Hebebühne*. Bereits Vorhandenes wird übersprungen – die Mappe kann immer wieder eingelesen werden. |
| **GuV** | Automatisch je Monat in der Gliederung des Blatts „GuV“ (SKR03-Konten), netto, ohne durchlaufende Posten. Zahl anklicken = Belege dahinter. CSV-Export. |
| **Kassenbuch** | Bar-Einnahmen/-Ausgaben mit laufendem Bestand, Warnung bei negativem Bestand und bei doppelt aussehenden Einträgen, automatische Zuordnung zu Bar-Rechnungen (z. B. Text „R26-0048“). |
| **Hebebühne** | Stunden je Tag/Mitarbeiter mit bis zu 3 Aufträgen; je KW „Auf Rechnung“ (Werkstatt-Lohn netto) gegen „Tatsächlich“ (Stunden × Stundensatz, Standard 105 €). |
| **To-Dos** | Wie im Sonnenplan: Zuständig, Fällig, Wiedervorlage, „liegt extern bei“, Dringlichkeit, Updates mit Datum, Folge-To-Do; aus Rechnungen heraus anlegen; die KI kann To-Dos vorbereiten. |

**Ausprobieren ohne Einrichtung:** `…/index.html?demo` öffnet den Demo-Modus (Daten nur im Browser). Ohne Supabase-Daten in `config.js` startet ebenfalls der `web/index.html` über einen Webserver öffnen – ohne Supabase-Daten in `config.js` startet der **Demo-Modus** (Daten nur im Browser, „Demo-Daten laden“). Die KI geht nur online.

## Einrichtung (einmalig, ca. 20 Minuten)

### 1. Supabase-Projekt
1. Auf [supabase.com](https://supabase.com) ein **neues Projekt** anlegen (eigenes Projekt für Mastercar, nicht das vom Sonnenplan). Region: Frankfurt (eu-central-1).
2. **SQL Editor → New query** → Inhalt von `supabase/01_einrichtung.sql` einfügen → **Run**.
   Danach ebenso `supabase/02_erweiterung.sql` (Kassenbuch, To-Dos, Hebebühne, GuV-Felder).
3. Ganz unten im SQL die Zeile `insert into public.team …` mit der eigenen E-Mail ausführen – nur Adressen in der Tabelle `team` kommen an die Daten.
4. **Authentication → Users → Add user**: für jede Person ein Konto (E-Mail + Passwort) anlegen.
5. **Authentication → Sign In / Providers → Email**: „Allow new users to sign up“ **ausschalten**.
6. **Project Settings → API**: „Project URL“ und „Publishable key“ (bzw. „anon public“) in `web/config.js` eintragen.

### 2. KI (Claude)
1. **Edge Functions → Deploy a new function → Via Editor**, Name: `claude`, Inhalt von `supabase/functions/claude/index.ts` einfügen → Deploy.
2. **Edge Functions → Secrets**: `ANTHROPIC_API_KEY` = API-Schlüssel von [console.anthropic.com](https://console.anthropic.com).
   Der Schlüssel liegt nur in Supabase, nie im Browser. Modell: Claude Opus 5.5; bei einer Sicherheits-Ablehnung springt automatisch ein Ersatzmodell ein (server-side fallback).

### 3. GitHub
1. Auf github.com ein neues Repository anlegen, z. B. `mastercar-finanzen` – **privat**.
2. Alle Dateien aus diesem Ordner hochladen („Add file → Upload files“, Ordner reinziehen) – oder mit GitHub Desktop.
3. **Settings → Pages → Source: GitHub Actions**. Die Datei `.github/workflows/pages.yml` veröffentlicht dann den Ordner `web` bei jedem Hochladen automatisch.
   Hinweis: Pages bei **privaten** Repositories braucht GitHub Pro/Team. Alternativ öffentlich lassen – es stehen keine Geheimnisse im Code (der Publishable Key ist öffentlich gedacht, die Daten schützt die Anmeldung + Tabelle `team`), oder den Ordner `web` bei Netlify/Cloudflare Pages hochladen.
4. In Supabase unter **Authentication → URL Configuration** die Pages-Adresse als „Site URL“ eintragen (für „Passwort vergessen“).

## Dateien

```
web/                     die App (statisch, kein Build nötig)
  index.html             Seite + Design (Mastercar-CI: #1F1F21 / #FFFE0F, Oswald + Figtree)
  config.js              Supabase-Verbindung
  js/util.js             Hilfsfunktionen (Zahlen/Datum deutsch, Fenster)
  js/db.js               Supabase bzw. Demo-Speicher, KI-Aufruf
  js/importer.js         Excel/CSV lesen, Spalten erkennen, Import; Kostenarten-Regeln
  js/mail.js             Outlook-.msg/.eml lesen (aus dem Sonnenplan übernommen)
  js/eingang.js          Rechnungseingang per Drag & Drop + KI-Auslesen
  js/abgleich.js         Status und automatischer Abgleich
  js/views.js            Übersicht und Listen
  js/detail.js           Detailfenster, manuelles Zuordnen
  js/ki.js               Suchleiste + KI-Assistent
  js/app.js              Rahmen, Anmeldung, Aktionen, Demo-Daten
supabase/01_einrichtung.sql       Tabellen, Zugriffsschutz, Belege-Speicher
supabase/functions/claude/index.ts KI-Function (Anthropic-Schlüssel nur hier)
```

## Gut zu wissen
- Kennzahlen sind **brutto und vereinfacht** – kein Ersatz für Buchhaltung/BWA vom Steuerberater.
- Kostenarten der Bankabgänge werden nach Stichworten vorgeschlagen (Stahlgruber → Ersatzteile, Stadtwerke → Energie …) und lassen sich je Umsatz ändern. Die Liste steht in `js/importer.js` (`KOSTENARTEN`, `KOSTEN_REGELN`).
- Echte Kontoauszüge/Exporte nie ins Repository legen – `.gitignore` verhindert das für xlsx/csv/pdf.
