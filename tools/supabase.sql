-- One More Floor: PvP ranking. Run once in Supabase → SQL Editor.
create table if not exists public.pvp_players (
  id uuid primary key references auth.users on delete cascade,
  name text not null default 'Pilot',
  rating int not null default 1000,
  wins int not null default 0,
  losses int not null default 0,
  kills int not null default 0,
  deaths int not null default 0,
  updated_at timestamptz default now()
);
alter table public.pvp_players enable row level security;
drop policy if exists "read all" on public.pvp_players;
create policy "read all" on public.pvp_players for select using (true);
-- no insert/update policies: writes only go through pvp_report below

create or replace function public.pvp_report(p_name text, p_won boolean, p_kills int, p_deaths int, p_opp_rating int, p_ranked boolean)
returns public.pvp_players language plpgsql security definer set search_path = public as $$
declare me public.pvp_players; ex float; delta int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into pvp_players(id, name) values (auth.uid(), left(coalesce(p_name, 'Pilot'), 16)) on conflict (id) do nothing;
  select * into me from pvp_players where id = auth.uid() for update;
  ex := 1 / (1 + power(10, (least(greatest(coalesce(p_opp_rating, 1000), 0), 4000) - me.rating) / 400.0));
  delta := case when p_ranked then round(32 * ((case when p_won then 1 else 0 end) - ex)) else 0 end;
  update pvp_players set
    name = left(coalesce(p_name, name), 16),
    rating = greatest(0, rating + delta),
    wins = wins + (case when p_won then 1 else 0 end),
    losses = losses + (case when p_won then 0 else 1 end),
    kills = kills + least(greatest(coalesce(p_kills, 0), 0), 30),
    deaths = deaths + least(greatest(coalesce(p_deaths, 0), 0), 30),
    updated_at = now()
  where id = auth.uid() returning * into me;
  return me;
end $$;
revoke execute on function public.pvp_report(text, boolean, int, int, int, boolean) from public, anon;
grant execute on function public.pvp_report(text, boolean, int, int, int, boolean) to authenticated;
