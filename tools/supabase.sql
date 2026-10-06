-- One More Floor: multiplayer database. Run in Supabase → SQL Editor (safe to run again after updates).
-- Ranked play and friends need a Google account; casual play and rooms with a code work without one.
-- Nobody writes tables directly: everything goes through the functions below (security definer).

-- ---------- profiles & ranking ----------
create table if not exists public.pvp_players (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  rating int not null default 1000,
  wins int not null default 0,
  losses int not null default 0,
  kills int not null default 0,
  deaths int not null default 0,
  flags int not null default 0,        -- times other players' clients caught impossible play
  updated_at timestamptz default now()
);
alter table public.pvp_players add column if not exists flags int not null default 0;
create unique index if not exists pvp_players_name on public.pvp_players (lower(name));
alter table public.pvp_players enable row level security;
drop policy if exists "read all" on public.pvp_players;
create policy "read all" on public.pvp_players for select using (true);

create table if not exists public.pvp_friends (
  a uuid not null references public.pvp_players on delete cascade,  -- who asked
  b uuid not null references public.pvp_players on delete cascade,  -- who was asked
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz default now(),
  primary key (a, b),
  check (a <> b)
);
alter table public.pvp_friends enable row level security;
drop policy if exists "own rows" on public.pvp_friends;
create policy "own rows" on public.pvp_friends for select using (a = auth.uid() or b = auth.uid());

-- a ranked match: every player registers at the start, reports the winner at the end;
-- the result counts only when both teams agree (or, 5 minutes later, when only one side reported and nobody disagreed)
create table if not exists public.pvp_matches (
  id text primary key,
  players uuid[] not null,
  teams int[] not null,
  created_at timestamptz default now(),
  settled boolean not null default false,
  winner int
);
create table if not exists public.pvp_reports (
  match_id text not null references public.pvp_matches on delete cascade,
  player uuid not null references public.pvp_players on delete cascade,
  winner int,
  kills int not null default 0,
  deaths int not null default 0,
  created_at timestamptz default now(),
  primary key (match_id, player)
);
alter table public.pvp_matches enable row level security;
alter table public.pvp_reports enable row level security;

-- ---------- helpers ----------
create or replace function public.pvp_google() returns boolean language sql stable as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false
$$;

create or replace function public.pvp_settle(p_match text, p_old boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m pvp_matches; nw int; nt int; w int; ra float; rb float; i int; pid uuid; t int; myr int; ex float; delta int; k int; d int;
begin
  select * into m from pvp_matches where id = p_match for update;
  if m.id is null or m.settled then return; end if;
  select count(distinct winner) into nw from pvp_reports where match_id = p_match and winner is not null;
  if nw = 0 then if p_old then update pvp_matches set settled = true where id = p_match; end if; return; end if;
  if nw > 1 then update pvp_matches set settled = true, winner = null where id = p_match; return; end if; -- reports disagree: void
  select winner into w from pvp_reports where match_id = p_match and winner is not null limit 1;
  select count(distinct m.teams[array_position(m.players, r.player)]) into nt from pvp_reports r where r.match_id = p_match and r.winner is not null;
  if nt < 2 and not p_old then return; end if;
  select coalesce(avg(p.rating), 1000) into ra from pvp_players p, unnest(m.players, m.teams) as u(id, team) where p.id = u.id and u.team = 0;
  select coalesce(avg(p.rating), 1000) into rb from pvp_players p, unnest(m.players, m.teams) as u(id, team) where p.id = u.id and u.team = 1;
  for i in 1 .. array_length(m.players, 1) loop
    pid := m.players[i]; t := m.teams[i];
    select rating into myr from pvp_players where id = pid;
    if myr is null then continue; end if;
    ex := 1 / (1 + power(10, ((case when t = 0 then rb else ra end) - myr) / 400.0));
    delta := round(32 * ((case when t = w then 1 else 0 end) - ex));
    select kills, deaths into k, d from pvp_reports where match_id = p_match and player = pid;
    update pvp_players set
      rating = greatest(0, rating + delta),
      wins = wins + (case when t = w then 1 else 0 end),
      losses = losses + (case when t = w then 0 else 1 end),
      kills = kills + coalesce(k, 0),
      deaths = deaths + coalesce(d, 0),
      updated_at = now()
    where id = pid;
  end loop;
  update pvp_matches set settled = true, winner = w where id = p_match;
end $$;

create or replace function public.pvp_settle_old() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from pvp_matches where not settled and created_at < now() - interval '5 minutes' order by created_at limit 20 loop
    perform pvp_settle(r.id, true);
  end loop;
end $$;

-- ---------- profile ----------
create or replace function public.pvp_me() returns public.pvp_players
language plpgsql security definer set search_path = public as $$
declare me pvp_players;
begin
  perform pvp_settle_old();
  select * into me from pvp_players where id = auth.uid();
  return me;
end $$;

create or replace function public.pvp_set_name(p_name text) returns public.pvp_players
language plpgsql security definer set search_path = public as $$
declare me pvp_players;
begin
  if not pvp_google() then raise exception 'sign in with Google'; end if;
  p_name := trim(p_name);
  if p_name !~ '^[A-Za-z0-9_]{3,14}$' then raise exception '3-14 letters, digits or _'; end if;
  if exists (select 1 from pvp_players where lower(name) = lower(p_name) and id <> auth.uid()) then raise exception 'name taken'; end if;
  insert into pvp_players (id, name) values (auth.uid(), p_name)
    on conflict (id) do update set name = excluded.name, updated_at = now()
    returning * into me;
  return me;
end $$;

-- ---------- friends ----------
create or replace function public.friend_add(p_name text default null, p_id uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare t uuid; st text;
begin
  if not pvp_google() then raise exception 'sign in with Google'; end if;
  if not exists (select 1 from pvp_players where id = auth.uid()) then raise exception 'pick a name first'; end if;
  if p_id is not null then select id into t from pvp_players where id = p_id;
  else select id into t from pvp_players where lower(name) = lower(trim(p_name)); end if;
  if t is null then raise exception 'no such pilot'; end if;
  if t = auth.uid() then raise exception 'that is you'; end if;
  if exists (select 1 from pvp_friends where a = t and b = auth.uid()) then
    update pvp_friends set status = 'accepted' where a = t and b = auth.uid();
    return 'accepted';
  end if;
  if (select count(*) from pvp_friends where a = auth.uid() and status = 'pending') >= 50 then raise exception 'too many open requests'; end if;
  insert into pvp_friends (a, b) values (auth.uid(), t) on conflict do nothing;
  select status into st from pvp_friends where a = auth.uid() and b = t;
  return st;
end $$;

create or replace function public.friend_respond(p_id uuid, p_accept boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not pvp_google() then raise exception 'sign in with Google'; end if;
  if p_accept then update pvp_friends set status = 'accepted' where a = p_id and b = auth.uid();
  else delete from pvp_friends where a = p_id and b = auth.uid() and status = 'pending'; end if;
  return found;
end $$;

create or replace function public.friend_remove(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not pvp_google() then raise exception 'sign in with Google'; end if;
  delete from pvp_friends where (a = auth.uid() and b = p_id) or (a = p_id and b = auth.uid());
  return found;
end $$;

create or replace function public.friend_list() returns table (id uuid, name text, rating int, status text, incoming boolean)
language sql security definer set search_path = public stable as $$
  select p.id, p.name, p.rating, f.status, f.b = auth.uid()
  from pvp_friends f join pvp_players p on p.id = case when f.a = auth.uid() then f.b else f.a end
  where pvp_google() and (f.a = auth.uid() or f.b = auth.uid())
$$;

-- ---------- ranked matches ----------
create or replace function public.pvp_start(p_match text, p_players uuid[], p_teams int[]) returns boolean
language plpgsql security definer set search_path = public as $$
declare m pvp_matches; n int := coalesce(array_length(p_players, 1), 0);
begin
  if not pvp_google() then raise exception 'sign in with Google'; end if;
  if p_match !~ '^[A-Za-z0-9-]{8,40}$' then raise exception 'bad match id'; end if;
  if n not between 2 and 6 or coalesce(array_length(p_teams, 1), 0) <> n then raise exception 'bad match'; end if;
  if not (auth.uid() = any (p_players)) then raise exception 'not in this match'; end if;
  if (select count(distinct x) from unnest(p_players) x) <> n then raise exception 'bad match'; end if;
  if exists (select 1 from unnest(p_teams) x where x not in (0, 1)) then raise exception 'bad teams'; end if;
  if (select count(*) from pvp_players where id = any (p_players)) <> n then raise exception 'every player needs a Google account'; end if;
  if (select count(*) from pvp_reports where player = auth.uid() and created_at > now() - interval '1 hour') >= 40 then raise exception 'too many matches, take a break'; end if;
  insert into pvp_matches (id, players, teams) values (p_match, p_players, p_teams) on conflict (id) do nothing;
  select * into m from pvp_matches where id = p_match;
  if m.players <> p_players or m.teams <> p_teams or m.created_at < now() - interval '10 minutes' then raise exception 'match mismatch'; end if;
  insert into pvp_reports (match_id, player) values (p_match, auth.uid()) on conflict do nothing;
  return true;
end $$;

create or replace function public.pvp_report(p_match text, p_winner int, p_kills int, p_deaths int, p_flagged uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare m pvp_matches;
begin
  if not pvp_google() then raise exception 'sign in with Google'; end if;
  update pvp_reports set winner = p_winner,
    kills = least(greatest(coalesce(p_kills, 0), 0), 30),
    deaths = least(greatest(coalesce(p_deaths, 0), 0), 30)
  where match_id = p_match and player = auth.uid() and winner is null;
  if not found then raise exception 'no such match'; end if;
  select * into m from pvp_matches where id = p_match;
  update pvp_players set flags = flags + 1 where id = any (coalesce(p_flagged, '{}')) and id = any (m.players) and id <> auth.uid();
  perform pvp_settle(p_match, false);
  perform pvp_settle_old();
  return jsonb_build_object('rating', (select rating from pvp_players where id = auth.uid()), 'settled', (select settled from pvp_matches where id = p_match));
end $$;

-- ---------- who may call what ----------
revoke all on function public.pvp_settle(text, boolean) from public, anon, authenticated;
revoke all on function public.pvp_settle_old() from public, anon, authenticated;
revoke all on function public.pvp_me() from public, anon;
revoke all on function public.pvp_set_name(text) from public, anon;
revoke all on function public.friend_add(text, uuid) from public, anon;
revoke all on function public.friend_respond(uuid, boolean) from public, anon;
revoke all on function public.friend_remove(uuid) from public, anon;
revoke all on function public.friend_list() from public, anon;
revoke all on function public.pvp_start(text, uuid[], int[]) from public, anon;
revoke all on function public.pvp_report(text, int, int, int, uuid[]) from public, anon;
grant execute on function public.pvp_me() to authenticated;
grant execute on function public.pvp_set_name(text) to authenticated;
grant execute on function public.friend_add(text, uuid) to authenticated;
grant execute on function public.friend_respond(uuid, boolean) to authenticated;
grant execute on function public.friend_remove(uuid) to authenticated;
grant execute on function public.friend_list() to authenticated;
grant execute on function public.pvp_start(text, uuid[], int[]) to authenticated;
grant execute on function public.pvp_report(text, int, int, int, uuid[]) to authenticated;

-- the first version of this file had pvp_report(text, boolean, int, int, int, boolean): remove it
drop function if exists public.pvp_report(text, boolean, int, int, int, boolean);
