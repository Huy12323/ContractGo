# Production Database Seed Instructions

Instructions for a Claude instance with production database access. Run as `service_role` (bypasses RLS).

---

## Prerequisites

- Access to the production Supabase instance (SQL execution or `supabase db query --linked`)
- The organization **WorldCraft Logistics** must already exist
- Run the pending migration first: `supabase db push --linked` (applies `contract_templates_unique_name_per_entity`)
- Deploy edge functions: `supabase functions deploy employee-onboarding_approve-content --linked` and `supabase functions deploy employee-onboarding_approve-contract --linked`

---

## Step 1: Discover existing state

Before creating anything, query to understand what exists:

```sql
-- Find the WCL organization
SELECT id, name, owner_id FROM organizations WHERE name ILIKE '%wcl%' OR name ILIKE '%worldcraft%';

-- List existing entities for this org
SELECT id, name, timezone, locale FROM entities WHERE organization_id = '<ORG_ID>';

-- List existing employees per entity
SELECT e.entity_id, ent.name as entity_name, count(*) as employee_count
FROM employees e
JOIN entities ent ON ent.id = e.entity_id
WHERE e.organization_id = '<ORG_ID>'
GROUP BY e.entity_id, ent.name;

-- Check dynamic tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'ent_%__employees';

-- Check employee_columns for this org's entities
SELECT ec.id, ec.label, ec.type, ec.entity_id
FROM employee_columns ec
JOIN entities ent ON ent.id = ec.entity_id
WHERE ent.organization_id = '<ORG_ID>';
```

**Expected:** A Vietnamese entity (WCL VN) should exist. WCL US may not exist yet.

---

## Step 2: Create WCL US entity (if not exists)

```sql
-- Create the US entity (trigger auto-provisions ent_<id>__employees table)
INSERT INTO entities (organization_id, name, timezone, locale)
VALUES ('<ORG_ID>', 'WCL US', 'America/New_York', 'en-US')
RETURNING id;
```

Save the returned `id` — you'll need it as `<US_ENTITY_ID>`.

**Verify** the dynamic table was auto-provisioned:

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = '<US_ENTITY_ID>__employees';
```

---

## Step 3: Create profiles + employees (1000 per entity)

### Architecture

Each employee needs:

1. A row in `auth.users` (auth identity)
2. A row in `profiles` (auto-created by trigger on auth.users insert)
3. A row in `employees` (links user to entity, has first_name/last_name)
4. A row in `<entity_id>__employees` (dynamic column data — can be empty initially)

### Naming conventions

- **WCL VN employees:** Vietnamese names (first_name: Vietnamese given name, last_name: Vietnamese family name)
    - Examples: `Nguyễn Văn An`, `Trần Thị Bích`, `Phạm Minh Đức`, `Lê Hoàng Ấn`
    - Use realistic Vietnamese names with diacritics (ă, â, đ, ê, ô, ơ, ư, and tone marks)
    - Family names: Nguyễn, Trần, Lê, Phạm, Hoàng, Huỳnh, Phan, Vũ, Võ, Đặng, Bùi, Đỗ, Hồ, Ngô, Dương, Lý
    - Middle names common: Văn, Thị, Minh, Hoàng, Thanh, Quốc, Đức

- **WCL US employees:** English names (first_name: English given name, last_name: English surname)
    - Examples: `John Smith`, `Sarah Johnson`, `Michael Williams`

### Creating auth users for seeding

Since you can't easily create 2000 `auth.users` entries via SQL, use one of these approaches:

**Option A: Direct auth.users insert (service_role required)**

```sql
-- Template for one user (repeat in a loop with generate_series)
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'seed-vn-' || n || '@wcltest.local',
  crypt('SeedPassword123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  'authenticated',
  'authenticated',
  now(),
  now()
FROM generate_series(1, 1000) AS n;
```

The `handle_new_user()` trigger auto-creates `profiles` rows.

**Option B: Insert profiles directly (skip auth.users)**
If timeclock seed doesn't need real auth sessions, you can insert profiles with random UUIDs and skip auth.users. Employees can reference these profiles via `user_id`.

### Employee insert pattern

```sql
-- Vietnamese entity employees
WITH new_users AS (
  SELECT p.id as user_id, p.email,
         row_number() OVER (ORDER BY p.created_at) as rn
  FROM profiles p
  WHERE p.email LIKE 'seed-vn-%@wcltest.local'
)
INSERT INTO employees (entity_id, user_id, email, first_name, last_name, birthday)
SELECT
  '<VN_ENTITY_ID>',
  u.user_id,
  u.email,
  -- Vietnamese first names (cycle through a list)
  (ARRAY['An','Bình','Cường','Dũng','Đức','Giang','Hải','Hiếu','Hùng','Khoa',
         'Linh','Minh','Nam','Phong','Quang','Sơn','Thắng','Tiến','Tuấn','Vinh',
         'Anh','Bích','Chi','Diễm','Hà','Hương','Lan','Mai','Ngọc','Phương',
         'Quỳnh','Tâm','Thanh','Thảo','Thu','Trang','Trinh','Uyên','Vân','Yến'])[((u.rn - 1) % 40) + 1],
  -- Vietnamese last names
  (ARRAY['Nguyễn','Trần','Lê','Phạm','Hoàng','Huỳnh','Phan','Vũ','Võ','Đặng',
         'Bùi','Đỗ','Hồ','Ngô','Dương','Lý','Trịnh','Đinh','Lưu','Tạ'])[((u.rn - 1) % 20) + 1],
  '1985-01-01'::date + ((u.rn * 7) % 10000 || ' days')::interval
FROM new_users u
RETURNING id;
```

Repeat the same pattern for US entity with English names.

### Dynamic table rows

After inserting into `employees`, insert matching rows into the entity's dynamic table:

```sql
INSERT INTO public."<VN_ENTITY_ID>__employees" (employee_id)
SELECT id FROM employees WHERE entity_id = '<VN_ENTITY_ID>';
```

The dynamic table starts with just `employee_id` (PK). If `employee_columns` exist for this entity, the corresponding `col_XXXX` columns will already be on the table (added by the RPC when columns were created). You can populate them later or leave NULL.

---

## Step 4: Seed timeclock sessions (3 months)

### Data model

The timeclock uses a **layered session model**:

- **`work` session:** The full shift (clock_in → clock_out). One per shift.
- **`break` session:** Overlays within a work session (lunch_start → lunch_end). Nested inside the work session's time range.

Sessions are stored in `timeclock_sessions`. Each row has:

- `type`: `'work'` or `'break'`
- `start_at` / `end_at`: UTC timestamps
- `duration_ms`: `EXTRACT(EPOCH FROM (end_at - start_at))::BIGINT * 1000`
- `start_by` / `end_by`: `'employee'` for normal, `'system'` for midnight-split sessions

### Critical constraints

1. **Break sessions MUST fall within a work session's time range.** A break's `start_at` must be >= the parent work session's `start_at`, and `end_at` must be <= the parent work session's `end_at`.

2. **Midnight boundary splitting.** Sessions that cross local midnight MUST be split into per-day segments. The cron job `timeclock_process_midnight()` does this for live data, but seed data must be pre-split.

3. **Timezone awareness.** "Midnight" is determined by the entity's `timezone` column (IANA format). WCL VN uses `Asia/Ho_Chi_Minh` (UTC+7), WCL US uses `America/New_York` (UTC-4/-5).

4. **All timestamps are stored in UTC.** Convert local times to UTC before inserting.

### Use the built-in split helper

The database has a helper function that handles midnight splitting automatically:

```sql
SELECT public._backfill_split_session(
  p_employee_id := '<EMPLOYEE_ID>',
  p_entity_id   := '<ENTITY_ID>',
  p_tz          := 'Asia/Ho_Chi_Minh',  -- entity timezone
  p_type        := 'work',               -- or 'break'
  p_start       := '2026-02-12 08:00:00+07'::timestamptz,
  p_end         := '2026-02-12 17:00:00+07'::timestamptz,
  p_start_by    := 'employee',
  p_end_by      := 'employee'
);
```

This function automatically splits sessions at timezone midnight boundaries. **Always use this for overnight sessions** — it creates the correct multi-day segments with `start_by='system'` / `end_by='system'` on the intermediate segments, matching what the midnight cron would produce.

### Shift patterns (3 months: 2026-02-12 to 2026-05-12)

Generate ~65 working days per employee (Mon-Fri, skip weekends). For each working day, create:

**Standard day shift (90% of days):**

```
Work:  08:00 → 17:00 local time (9 hours)
Break: 12:00 → 13:00 local time (1 hour lunch)
Net:   8 hours worked
```

**Variation — early shift (5% of days):**

```
Work:  06:00 → 15:00 local time
Break: 11:00 → 11:45 local time (45 min lunch)
```

**Variation — late shift (3% of days):**

```
Work:  14:00 → 23:00 local time
Break: 18:00 → 18:45 local time
```

**Anomaly — overnight shift (2% of days, ~1-2 per month):**

```
Work:  22:00 → 06:00+1 local time (crosses midnight!)
Break: 01:00+1 → 01:30+1 local time
```

**IMPORTANT for overnight shifts:** Use `_backfill_split_session()` — it splits at midnight automatically. The work session becomes two rows:

- Day 1: 22:00 → 00:00 (start_by='employee', end_by='system')
- Day 2: 00:00 → 06:00 (start_by='system', end_by='employee')

The break session also splits if it crosses midnight (unlikely for a 30-min break at 01:00, but the helper handles it correctly).

### Randomization

Add realistic variance:

- **Start time jitter:** ±15 minutes from the standard start (e.g., 07:48, 08:12)
- **End time jitter:** ±30 minutes from the standard end
- **Lunch time jitter:** ±15 minutes start, 30-60 minute duration
- **Occasional absences:** Skip ~5% of working days randomly (employee was off)
- **Occasional half-days:** ~3% of days, employee leaves at lunch (no break session, work ends at 12:30)

### Batch insert strategy

For 2000 employees × 65 days = 130,000 work sessions + 130,000 break sessions = ~260,000 rows.

Use a PL/pgSQL function for the seed:

```sql
CREATE OR REPLACE FUNCTION seed_timeclock_data(
  p_entity_id TEXT,
  p_tz TEXT,
  p_start_date DATE,
  p_end_date DATE
) RETURNS void AS $$
DECLARE
  v_emp RECORD;
  v_date DATE;
  v_rand DOUBLE PRECISION;
  v_work_start TIMESTAMPTZ;
  v_work_end TIMESTAMPTZ;
  v_break_start TIMESTAMPTZ;
  v_break_end TIMESTAMPTZ;
  v_start_hour INT;
  v_start_min INT;
BEGIN
  FOR v_emp IN
    SELECT id FROM employees WHERE entity_id = p_entity_id
  LOOP
    v_date := p_start_date;
    WHILE v_date <= p_end_date LOOP
      -- Skip weekends
      IF EXTRACT(DOW FROM v_date) IN (0, 6) THEN
        v_date := v_date + 1;
        CONTINUE;
      END IF;

      v_rand := random();

      -- Skip ~5% of days (absent)
      IF v_rand < 0.05 THEN
        v_date := v_date + 1;
        CONTINUE;
      END IF;

      -- Determine shift type
      IF v_rand < 0.07 THEN
        -- Overnight: 22:00 → 06:00+1
        v_start_hour := 22;
        v_start_min := (random() * 15)::int;
        v_work_start := ((v_date::timestamp + make_interval(hours := v_start_hour, mins := v_start_min)) AT TIME ZONE p_tz);
        v_work_end := (((v_date + 1)::timestamp + make_interval(hours := 6, mins := (random() * 30)::int)) AT TIME ZONE p_tz);

        PERFORM public._backfill_split_session(v_emp.id, p_entity_id, p_tz, 'work', v_work_start, v_work_end, 'employee', 'employee');

        -- Break at ~01:00+1
        v_break_start := (((v_date + 1)::timestamp + make_interval(hours := 1, mins := (random() * 15)::int)) AT TIME ZONE p_tz);
        v_break_end := v_break_start + make_interval(mins := 30);
        PERFORM public._backfill_split_session(v_emp.id, p_entity_id, p_tz, 'break', v_break_start, v_break_end, 'employee', 'employee');

      ELSIF v_rand < 0.12 THEN
        -- Early: 06:00 → 15:00
        v_start_min := (random() * 15)::int;
        v_work_start := ((v_date::timestamp + make_interval(hours := 6, mins := v_start_min)) AT TIME ZONE p_tz);
        v_work_end := ((v_date::timestamp + make_interval(hours := 15, mins := (random() * 30)::int)) AT TIME ZONE p_tz);

        PERFORM public._backfill_split_session(v_emp.id, p_entity_id, p_tz, 'work', v_work_start, v_work_end, 'employee', 'employee');

        v_break_start := ((v_date::timestamp + make_interval(hours := 11, mins := (random() * 15)::int)) AT TIME ZONE p_tz);
        v_break_end := v_break_start + make_interval(mins := 45);
        PERFORM public._backfill_split_session(v_emp.id, p_entity_id, p_tz, 'break', v_break_start, v_break_end, 'employee', 'employee');

      ELSIF v_rand < 0.15 THEN
        -- Late: 14:00 → 23:00
        v_start_min := (random() * 15)::int;
        v_work_start := ((v_date::timestamp + make_interval(hours := 14, mins := v_start_min)) AT TIME ZONE p_tz);
        v_work_end := ((v_date::timestamp + make_interval(hours := 23, mins := (random() * 15)::int)) AT TIME ZONE p_tz);

        PERFORM public._backfill_split_session(v_emp.id, p_entity_id, p_tz, 'work', v_work_start, v_work_end, 'employee', 'employee');

        v_break_start := ((v_date::timestamp + make_interval(hours := 18, mins := (random() * 15)::int)) AT TIME ZONE p_tz);
        v_break_end := v_break_start + make_interval(mins := 45);
        PERFORM public._backfill_split_session(v_emp.id, p_entity_id, p_tz, 'break', v_break_start, v_break_end, 'employee', 'employee');

      ELSIF v_rand < 0.18 THEN
        -- Half-day: 08:00 → 12:30 (no break)
        v_start_min := (random() * 15)::int;
        v_work_start := ((v_date::timestamp + make_interval(hours := 8, mins := v_start_min)) AT TIME ZONE p_tz);
        v_work_end := ((v_date::timestamp + make_interval(hours := 12, mins := 30 + (random() * 15)::int)) AT TIME ZONE p_tz);

        PERFORM public._backfill_split_session(v_emp.id, p_entity_id, p_tz, 'work', v_work_start, v_work_end, 'employee', 'employee');

      ELSE
        -- Standard: 08:00 → 17:00
        v_start_min := -15 + (random() * 30)::int;
        v_work_start := ((v_date::timestamp + make_interval(hours := 8, mins := v_start_min)) AT TIME ZONE p_tz);
        v_work_end := ((v_date::timestamp + make_interval(hours := 17, mins := -15 + (random() * 30)::int)) AT TIME ZONE p_tz);

        PERFORM public._backfill_split_session(v_emp.id, p_entity_id, p_tz, 'work', v_work_start, v_work_end, 'employee', 'employee');

        v_break_start := ((v_date::timestamp + make_interval(hours := 12, mins := (random() * 15)::int)) AT TIME ZONE p_tz);
        v_break_end := v_break_start + make_interval(mins := 30 + (random() * 30)::int);
        PERFORM public._backfill_split_session(v_emp.id, p_entity_id, p_tz, 'break', v_break_start, v_break_end, 'employee', 'employee');
      END IF;

      v_date := v_date + 1;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

### Run the seed

```sql
-- VN entity (adjust entity_id and timezone)
SELECT seed_timeclock_data('<VN_ENTITY_ID>', 'Asia/Ho_Chi_Minh', '2026-02-12', '2026-05-12');

-- US entity
SELECT seed_timeclock_data('<US_ENTITY_ID>', 'America/New_York', '2026-02-12', '2026-05-12');

-- Clean up the function after seeding
DROP FUNCTION IF EXISTS seed_timeclock_data;
```

**Warning:** This generates ~260,000 rows total. Each `_backfill_split_session` call may produce multiple rows for overnight shifts. Expect the seed to take 5-15 minutes.

---

## Step 5: Verification queries

```sql
-- Employee counts per entity
SELECT ent.name, count(*) FROM employees e
JOIN entities ent ON ent.id = e.entity_id
WHERE e.organization_id = '<ORG_ID>'
GROUP BY ent.name;


-- Session counts per entity
SELECT ent.name, s.type, count(*) FROM timeclock_sessions s
JOIN entities ent ON ent.id = s.entity_id
WHERE s.organization_id = '<ORG_ID>'
GROUP BY ent.name, s.type
ORDER BY ent.name, s.type;

-- Overnight sessions (system-split)
SELECT count(*) FROM timeclock_sessions
WHERE organization_id = '<ORG_ID>' AND start_by = 'system';

-- Verify breaks are within work sessions (should return 0 violations)
SELECT count(*) FROM timeclock_sessions brk
WHERE brk.type = 'break'
  AND brk.organization_id = '<ORG_ID>'
  AND NOT EXISTS (
    SELECT 1 FROM timeclock_sessions wrk
    WHERE wrk.type = 'work'
      AND wrk.employee_id = brk.employee_id
      AND wrk.entity_id = brk.entity_id
      AND wrk.start_at <= brk.start_at
      AND (wrk.end_at >= brk.end_at OR wrk.end_at IS NULL)
  );

-- Sample timesheet grid for one employee
SELECT * FROM get_timesheet_grid(
  '<VN_ENTITY_ID>',
  '2026-04-01T00:00:00+07',
  '2026-04-30T23:59:59+07',
  'Asia/Ho_Chi_Minh',
  ARRAY(SELECT id FROM employees WHERE entity_id = '<VN_ENTITY_ID>' LIMIT 1)
);

-- Dynamic table has rows
SELECT count(*) FROM "<VN_ENTITY_ID>__employees";
SELECT count(*) FROM "<US_ENTITY_ID>__employees";
```

---

## Execution order checklist

1. [ ] Run pending migration (`supabase db push --linked`)
2. [ ] Deploy edge functions (`supabase functions deploy ...`)
3. [ ] Discover existing org/entity state (Step 1)
4. [ ] Create WCL US entity if missing (Step 2)
5. [ ] Create 1000 auth users + profiles for VN (Step 3)
6. [ ] Create 1000 auth users + profiles for US (Step 3)
7. [ ] Insert 1000 employees for VN entity (Step 3)
8. [ ] Insert 1000 employees for US entity (Step 3)
9. [ ] Insert dynamic table rows for both entities (Step 3)
10. [ ] Create seed_timeclock_data function (Step 4)
11. [ ] Run seed for VN entity (Step 4) — ~5-10 min
12. [ ] Run seed for US entity (Step 4) — ~5-10 min
13. [ ] Drop seed function (Step 4)
14. [ ] Run verification queries (Step 5)
