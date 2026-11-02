-- SmileQuest foundation. Adult pathway only; 'pediatric' reserved but blocked by constraint.
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  pathway text not null default 'adult' check (pathway = 'adult'),
  age_band text not null check (age_band in ('18-24','25-34','35-44','45-54','55-64','65+')),
  state_of_residence text not null,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table palsy_conditions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles on delete cascade,
  palsy_type text not null check (palsy_type in ('bells','congenital','moebius','post_surgical','traumatic','infectious','tumor','other','unsure')),
  affected_side text not null check (affected_side in ('left','right','both','unsure')),
  updated_at timestamptz not null default now()
);
create table surgical_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  procedure text not null check (procedure in ('none','free_gracilis','temporalis_tendon','masseteric_nerve','hypoglossal_nerve','cross_facial_graft','other_reconstruction','other_multiple','unsure')),
  surgery_date date,
  notes text,
  created_at timestamptz not null default now()
);
create table rehab_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  goal text not null,
  created_at timestamptz not null default now(),
  unique (user_id, goal)
);
create table consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  kind text not null check (kind in ('terms','privacy','camera_processing','data_export')),
  granted boolean not null,
  policy_version text not null,
  created_at timestamptz not null default now()
);
create table audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null,
  table_name text not null, row_id uuid, action text not null, old_data jsonb, new_data jsonb,
  created_at timestamptz not null default now()
);
create index on surgical_history (user_id);
create index on rehab_goals (user_id);
create index on consent_records (user_id, kind, created_at desc);

-- Row Level Security: owner-only
alter table profiles enable row level security;
alter table palsy_conditions enable row level security;
alter table surgical_history enable row level security;
alter table rehab_goals enable row level security;
alter table consent_records enable row level security;
alter table audit_log enable row level security;
create policy own_profile on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy own_conditions on palsy_conditions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_surgery on surgical_history for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_goals on rehab_goals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_consent_read on consent_records for select using (user_id = auth.uid());
create policy own_consent_add on consent_records for insert with check (user_id = auth.uid()); -- append-only history
create policy own_audit_read on audit_log for select using (user_id = auth.uid());

-- Generic audit trigger (revision history foundation)
create function log_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(user_id, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, coalesce((to_jsonb(new)->>'id')::uuid,(to_jsonb(old)->>'id')::uuid), tg_op,
          case when tg_op<>'INSERT' then to_jsonb(old) end, case when tg_op<>'DELETE' then to_jsonb(new) end);
  return null;
end $$;
create trigger audit_conditions after insert or update or delete on palsy_conditions for each row execute function log_change();
create trigger audit_surgery after insert or update or delete on surgical_history for each row execute function log_change();

-- Account deletion (cascades through all user-owned rows)
create function delete_my_account() returns void language sql security definer set search_path = public, auth as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function delete_my_account() from public; grant execute on function delete_my_account() to authenticated;
