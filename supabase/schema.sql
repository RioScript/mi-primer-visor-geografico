-- 1) TABLA: canchas
create table if not exists public.canchas (
  id          bigint generated always as identity primary key,
  osm_id      text unique,
  leisure     text,
  sport       text,
  surface     text,
  lit         text,
  access      text,
  geometry    jsonb not null,
  created_at  timestamptz not null default now()
);

-- Columnas nuevas para la ficha de la cancha
alter table public.canchas add column if not exists nombre text;
alter table public.canchas add column if not exists horario text;
alter table public.canchas add column if not exists imagen_url text;

comment on table public.canchas is 'Canchas deportivas de Sabaneta (OpenStreetMap + info adicional).';

alter table public.canchas enable row level security;

drop policy if exists "Lectura publica de canchas" on public.canchas;
create policy "Lectura publica de canchas"
  on public.canchas for select
  to anon
  using (true);

-- 2) TABLA: evidencias
--    Reportes fotograficos que sube el publico sobre el
--    estado de una cancha (ej. cancha dañada, sin luz, etc.)
create table if not exists public.evidencias (
  id          bigint generated always as identity primary key,
  cancha_id   bigint not null references public.canchas(id) on delete cascade,
  descripcion text,
  imagen_url  text not null,
  created_at  timestamptz not null default now()
);

comment on table public.evidencias is 'Evidencias fotograficas subidas por el publico sobre el estado de una cancha.';

create index if not exists idx_evidencias_cancha_id on public.evidencias(cancha_id);

alter table public.evidencias enable row level security;

-- Cualquiera puede leer evidencias (son publicas, no incluyen datos de usuario)
drop policy if exists "Lectura publica de evidencias" on public.evidencias;
create policy "Lectura publica de evidencias"
  on public.evidencias for select
  to anon
  using (true);

-- Cualquiera puede REPORTAR (insertar) una evidencia nueva
drop policy if exists "Insercion publica de evidencias" on public.evidencias;
create policy "Insercion publica de evidencias"
  on public.evidencias for insert
  to anon
  with check (true);

-- 3) STORAGE: bucket para las fotos de evidencia
insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', true)
on conflict (id) do nothing;
drop policy if exists "Lectura publica bucket evidencias" on storage.objects;
create policy "Lectura publica bucket evidencias"
  on storage.objects for select
  to anon
  using (bucket_id = 'evidencias');

-- Cualquiera puede SUBIR fotos a este bucket especifico
drop policy if exists "Subida publica bucket evidencias" on storage.objects;
create policy "Subida publica bucket evidencias"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'evidencias');

-- 4) DATOS: canchas (no se duplican gracias a "on conflict")
insert into public.canchas (osm_id, leisure, sport, surface, lit, access, geometry)
values
  ('way/303549243', 'pitch', 'soccer', NULL, 'yes', NULL, '{"type": "Polygon", "coordinates": [[[-75.6215393, 6.1489437], [-75.6209319, 6.1495582], [-75.62132, 6.1499374], [-75.6219274, 6.1493228], [-75.6215393, 6.1489437]]]}'::jsonb),
  ('way/343473495', 'pitch', 'soccer', 'grass', NULL, 'private', '{"type": "Polygon", "coordinates": [[[-75.6099875, 6.1526229], [-75.6099903, 6.1526861], [-75.6100177, 6.1527361], [-75.6100718, 6.1527929], [-75.6101288, 6.1528465], [-75.6101586, 6.1528722], [-75.6101893, 6.152876], [-75.6102249, 6.1528596], [-75.6107062, 6.152444], [-75.610761, 6.1523821], [-75.6107528, 6.1523404], [-75.610723, 6.1522953], [-75.6106288, 6.1521973], [-75.6105687, 6.1521532], [-75.6105352, 6.1521407], [-75.6105045, 6.1521311], [-75.6104727, 6.152141], [-75.6100154, 6.152581], [-75.6099875, 6.1526229]]]}'::jsonb),
  ('way/431976895', 'pitch', 'soccer', NULL, NULL, NULL, '{"type": "Polygon", "coordinates": [[[-75.6311969, 6.1412299], [-75.6308849, 6.141091], [-75.6305919, 6.1417415], [-75.6309039, 6.1418804], [-75.6311969, 6.1412299]]]}'::jsonb),
  ('way/432403509', 'pitch', 'soccer', NULL, NULL, NULL, '{"type": "Polygon", "coordinates": [[[-75.6111061, 6.1577264], [-75.6107258, 6.1579278], [-75.6111257, 6.1586746], [-75.6115061, 6.1584733], [-75.6111061, 6.1577264]]]}'::jsonb),
  ('way/455882250', 'pitch', 'soccer', 'concrete', 'yes', NULL, '{"type": "Polygon", "coordinates": [[[-75.6057097, 6.1548184], [-75.6058588, 6.1550175], [-75.6059845, 6.1549245], [-75.6058353, 6.1547254], [-75.6057097, 6.1548184]]]}'::jsonb),
  ('way/518001999', 'pitch', 'soccer', NULL, NULL, NULL, '{"type": "Polygon", "coordinates": [[[-75.5995997, 6.1485131], [-75.5991901, 6.1489465], [-75.5994294, 6.14917], [-75.5998389, 6.1487365], [-75.5995997, 6.1485131]]]}'::jsonb),
  ('way/777348906', 'pitch', 'soccer', NULL, NULL, NULL, '{"type": "Polygon", "coordinates": [[[-75.6018084, 6.1512147], [-75.6018731, 6.1506337], [-75.6016809, 6.1506941], [-75.6016338, 6.1512245], [-75.6018084, 6.1512147]]]}'::jsonb)
on conflict (osm_id) do nothing;