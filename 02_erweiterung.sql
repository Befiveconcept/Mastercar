-- Mastercar Finanzen · Erweiterung: GuV-Felder, Kassenbuch, To-Dos, Hebebühne
-- Nach 01_einrichtung.sql im SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

-- 1) Zusätzliche Felder an Rechnungen (aus der Excel-Mappe)
alter table public.rechnungen add column if not exists unterkonto   text;          -- Unterposition der GuV (z. B. Mietkosten)
alter table public.rechnungen add column if not exists fix          boolean;       -- Fixkosten ja/nein
alter table public.rechnungen add column if not exists art          text;          -- Rechnung | Gutschrift | Vertrag | Beleg | Storno
alter table public.rechnungen add column if not exists skonto       numeric(12,2);
alter table public.rechnungen add column if not exists durchlaufend numeric(12,2); -- durchlaufende Posten (z. B. TÜV-Gebühr)
alter table public.rechnungen add column if not exists kundennr     text;
alter table public.rechnungen add column if not exists lohn         numeric(12,2); -- Werkstatt (Arbeitslohn) netto
alter table public.rechnungen add column if not exists teile        numeric(12,2); -- Ersatzteile netto
alter table public.rechnungen add column if not exists sonstiges    numeric(12,2);
alter table public.rechnungen add column if not exists altteile     numeric(12,2);
alter table public.rechnungen add column if not exists status_excel text;          -- Status wie in der Excel-Liste
alter table public.rechnungen add column if not exists bezahlt_extern boolean not null default false; -- laut Excel bezahlt

-- SumUp: Auszahlungs-ID (z. B. „SUMUP PID1066911 PAYOUT 060126“) – verbindet Kartenzahlungen mit der Gutschrift auf dem Konto
alter table public.sumup add column if not exists auszahlung_ref text;
create index if not exists sumup_ref_idx on public.sumup (auszahlung_ref);

-- 2) Kassenbuch
create table if not exists public.kasse (
  id          uuid primary key default gen_random_uuid(),
  datum       date not null,
  betrag      numeric(12,2) not null,   -- + Einnahme, − Ausgabe
  belegnr     text,
  konto       text,
  gegenkonto  text,
  text        text,
  kostenart   text,
  schluessel  text unique,
  notiz       text,
  import_id   uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists kasse_datum_idx on public.kasse (datum);
alter table public.zuordnungen add column if not exists kasse_id uuid references public.kasse(id) on delete cascade;
create index if not exists zuordnungen_k_idx on public.zuordnungen (kasse_id);

-- 3) To-Dos (wie im Sonnenplan)
create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  titel       text not null,
  details     text,
  thema       text,
  wer         text,
  faellig     date,
  wv          date,          -- Wiedervorlage
  wv_notiz    text,
  extern      text,          -- liegt extern bei
  prio        text not null default 'normal' check (prio in ('dringend','hoch','normal','niedrig')),
  status      text,          -- z. B. ongoing, wartet
  erledigt    boolean not null default false,
  erledigt_am date,
  rechnung_id uuid references public.rechnungen(id) on delete set null,
  updates     jsonb not null default '[]'::jsonb,  -- [{d, wer, text}]
  schluessel  text unique,
  import_id   uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

-- 4) Hebebühne: Stunden je Tag und Mitarbeiter, bis zu 3 Aufträge
create table if not exists public.hebebuehne (
  id          uuid primary key default gen_random_uuid(),
  datum       date not null,
  mitarbeiter text not null,
  stunden     numeric(6,2),
  abwesend    text,          -- krank, Urlaub …
  auftraege   jsonb not null default '[]'::jsonb,  -- [{name, kdnr, auftrag}]
  notiz       text,
  schluessel  text unique,
  import_id   uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists hebebuehne_datum_idx on public.hebebuehne (datum);

-- 5) Zugriff nur für das Team
do $$
declare t text;
begin
  foreach t in array array['kasse','todos','hebebuehne'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_team', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t || '_team', t);
  end loop;
end $$;
grant select, insert, update, delete on public.kasse, public.todos, public.hebebuehne to authenticated;
revoke all on public.kasse, public.todos, public.hebebuehne from anon;
