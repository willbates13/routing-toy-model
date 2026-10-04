-- Honour-system leaderboard for the static GitHub Pages site.
-- Run once in a Supabase project's SQL editor, then copy the project URL and
-- publishable key into web/leaderboard-config.js. Never expose a secret key.

create table if not exists public.leaderboard_scores (
  id bigint generated always as identity primary key,
  username text not null check (
    char_length(username) between 2 and 24
    and username ~ '^[^[:cntrl:]<>][^[:cntrl:]<>]{1,23}$'
  ),
  score double precision not null check (score >= 0 and score < 10),
  mean_gap double precision not null check (mean_gap >= 0 and mean_gap < 10),
  max_gap double precision not null check (max_gap >= 0 and max_gap < 10),
  scenario_version text not null check (scenario_version = 'live-50-highs-1.15.3-v1'),
  solver_version text not null check (solver_version = 'highs-1.15.3'),
  created_at timestamptz not null default now()
);

alter table public.leaderboard_scores enable row level security;

revoke all on table public.leaderboard_scores from anon, authenticated;
grant select, insert on table public.leaderboard_scores to anon, authenticated;
grant usage, select on sequence public.leaderboard_scores_id_seq to anon, authenticated;

drop policy if exists "Public leaderboard is readable" on public.leaderboard_scores;
create policy "Public leaderboard is readable"
on public.leaderboard_scores for select
to anon, authenticated
using (true);

drop policy if exists "Honour-system scores can be submitted" on public.leaderboard_scores;
create policy "Honour-system scores can be submitted"
on public.leaderboard_scores for insert
to anon, authenticated
with check (
  score >= 0
  and score < 0.0013304126135491707
  and scenario_version = 'live-50-highs-1.15.3-v1'
  and solver_version = 'highs-1.15.3'
);
