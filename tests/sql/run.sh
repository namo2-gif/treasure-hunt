#!/usr/bin/env bash
# Runs the SQL tests against a throwaway local Postgres database (created and dropped here).
# Usage: tests/sql/run.sh   (needs psql; env PGHOST/PGPORT/PGUSER as usual)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=th_test_$$
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "create database $DB"
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
$P -d $DB -c "do \$\$ begin create role anon nologin; exception when duplicate_object then null; end \$\$; do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$; do \$\$ begin create role service_role nologin; exception when duplicate_object then null; end \$\$;"
for f in supabase/migrations/001_schema.sql supabase/migrations/002_functions.sql supabase/migrations/003_phase4.sql supabase/migrations/005_phase10_fixes.sql supabase/migrations/006_round3.sql tests/sql/fixture.sql tests/sql/phase4.sql tests/sql/phase10_round3.sql; do
  echo "== $f"; $P -d $DB -f $f
done
