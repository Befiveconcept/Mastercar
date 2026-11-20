-- Mastercar Bornheim · Finanz-Software · Supabase-Einrichtung
-- VE Sportmanagement UG (haftungsbeschränkt)
-- In Supabase: links "SQL Editor" → "New query" → diesen ganzen Text einfügen → "Run".
-- Kann gefahrlos mehrfach ausgeführt werden.

create extension if not exists pgcrypto;

-- 0) Wer darf rein? Nur E-Mail-Adressen, die hier stehen (zusätzlich zur Anmeldung).
--    So kann niemand Fremdes Daten sehen, selbst wenn er sich ein Konto anlegt.
create table if not exists public.team (
  email   text primary key,
  name    text,
  rolle   text not null default 'mitarbeiter' check (rolle in ('admin','mitarbeiter')),
  angelegt timestamptz not null default now()
);
alter table public.team enable row level security;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team t where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.is_staff() to authenticated;

drop policy if exists team_read on public.team;
create policy team_read on public.team for select to authenticated using (public.is_staff());

-- 1) Rechnungen (Ausgang = an Kunden, Eingang = von Lieferanten)
create table if not exists public.rechnungen (
  id          uuid primary key default gen_random_uuid(),
  richtung    text not null check (richtung in ('ausgang','eingang')),
  nummer      text,
  datum       date,
  faellig     date,
  partner     text,              -- Kunde bzw. Lieferant
  kennzeichen text,              -- KFZ-Kennzeichen (Ausgang)
  beschreibung text,
  netto       numeric(12,2),
  mwst        numeric(12,2),
  brutto      numeric(12,2) not null default 0,
  kostenart   text,
  zahlart     text,              -- bank | ec | bar | (leer = unbekannt)
  iban        text,
  datei       text,              -- Pfad im Speicher "belege"
  dateiname   text,
  quelle      text,              -- excel | ki | manuell
  schluessel  text unique,       -- erkennt doppelte Importe
  geprueft    boolean not null default true,
  erledigt    boolean not null default false, -- von Hand als erledigt markiert (z. B. Skonto, Ausbuchung)
  notiz       text,
  import_id   uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists rechnungen_richtung_idx on public.rechnungen (richtung, datum);

-- 2) Bankumsätze (aus CSV/Excel der Bank)
create table if not exists public.bank (
  id          uuid primary key default gen_random_uuid(),
  konto       text,
  datum       date not null,
  valuta      date,
  betrag      numeric(12,2) not null,   -- + Eingang, − Ausgang
  gegenpartei text,
  iban        text,
  zweck       text,
  art         text,                     -- leer | sumup | privat | intern | ignoriert
  kostenart   text,
  schluessel  text unique,
  notiz       text,
  import_id   uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists bank_datum_idx on public.bank (datum);

-- 3) SumUp-Umsätze (EC-/Kartenzahlungen aus dem SumUp-Export)
create table if not exists public.sumup (
  id          uuid primary key default gen_random_uuid(),
  transaktion text unique,
  datum       date not null,
  betrag      numeric(12,2) not null,
  gebuehr     numeric(12,2),
  auszahlung  numeric(12,2),
  auszahlung_datum date,
  beschreibung text,
  zahlungsart text,
  status      text,
  bank_id     uuid references public.bank(id) on delete set null,  -- Auszahlung auf dem Bankkonto
  import_id   uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists sumup_datum_idx on public.sumup (datum);

-- 4) Zuordnungen: welche Zahlung gehört zu welcher Rechnung (auch Teilbeträge)
create table if not exists public.zuordnungen (
  id          uuid primary key default gen_random_uuid(),
  rechnung_id uuid not null references public.rechnungen(id) on delete cascade,
  bank_id     uuid references public.bank(id) on delete cascade,
  sumup_id    uuid references public.sumup(id) on delete cascade,
  betrag      numeric(12,2) not null,
  art         text not null default 'manuell' check (art in ('auto','manuell','bar')),
  datum       date,
  notiz       text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists zuordnungen_r_idx on public.zuordnungen (rechnung_id);
create index if not exists zuordnungen_b_idx on public.zuordnungen (bank_id);
create index if not exists zuordnungen_s_idx on public.zuordnungen (sumup_id);

-- 5) Importe (Protokoll) und Einstellungen (z. B. gemerkte Spaltenzuordnung)
create table if not exists public.importe (
  id          uuid primary key default gen_random_uuid(),
  art         text not null,   -- ausgang | sumup | bank | eingang
  datei       text,
  zeilen      integer,
  neu         integer,
  doppelt     integer,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create table if not exists public.einstellungen (
  schluessel  text primary key,
  wert        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 6) Zugriff: nur Team-Mitglieder (Tabelle "team")
do $$
declare t text;
begin
  foreach t in array array['rechnungen','bank','sumup','zuordnungen','importe','einstellungen'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_team', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t || '_team', t);
  end loop;
end $$;

-- 6b) Rechte nur für angemeldete Nutzer (neuere Projekte vergeben sie nicht automatisch); "anon" bekommt nichts
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.rechnungen, public.bank, public.sumup, public.zuordnungen, public.importe, public.einstellungen to authenticated;
grant select on public.team to authenticated;
revoke all on public.rechnungen, public.bank, public.sumup, public.zuordnungen, public.importe, public.einstellungen, public.team from anon;

-- 7) Belege (PDFs, Fotos, Mails): privater Speicher, nur für das Team
insert into storage.buckets (id, name, public)
values ('belege', 'belege', false)
on conflict (id) do nothing;

drop policy if exists belege_read   on storage.objects;
drop policy if exists belege_write  on storage.objects;
drop policy if exists belege_delete on storage.objects;
create policy belege_read   on storage.objects for select to authenticated using      (bucket_id = 'belege' and public.is_staff());
create policy belege_write  on storage.objects for insert to authenticated with check (bucket_id = 'belege' and public.is_staff());
create policy belege_delete on storage.objects for delete to authenticated using      (bucket_id = 'belege' and public.is_staff());

-- 8) Ersten Zugang freischalten – E-Mail anpassen und die Zeile ausführen (für jede Person einmal):
-- insert into public.team (email, name, rolle) values ('name@beispiel.de', 'Vorname Nachname', 'admin') on conflict do nothing;

-- Fertig. Kontrolle: Im "Table Editor" erscheinen rechnungen, bank, sumup, zuordnungen, importe, einstellungen, team.
