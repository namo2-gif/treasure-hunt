import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

interface StudentRecord {
  student_id: string;
  name: string;
  team_id: string;
  code: string;
}

async function main() {
  const codesPath = path.join(process.cwd(), 'codes.csv');
  if (!fs.existsSync(codesPath)) {
    console.error('Error: codes.csv not found at root directory.');
    process.exit(1);
  }

  const fileContent = fs.readFileSync(codesPath, 'utf-8').trim();
  const lines = fileContent.split('\n').map((l) => l.trim()).filter(Boolean);

  if (lines.length <= 1) {
    console.error('Error: codes.csv is empty or only has a header.');
    process.exit(1);
  }

  // Parse header
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const sidIdx = header.indexOf('student_id');
  const nameIdx = header.indexOf('name');
  const tidIdx = header.indexOf('team_id');
  const codeIdx = header.indexOf('code');

  if (sidIdx === -1 || nameIdx === -1 || tidIdx === -1 || codeIdx === -1) {
    console.error('Error: codes.csv header must contain student_id, name, team_id, code.');
    process.exit(1);
  }

  const teamsMap = new Map<string, StudentRecord[]>();
  const seenStudents = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map((p) => p.trim());
    if (parts.length < 4) continue;

    const student_id = parts[sidIdx];
    const name = parts[nameIdx];
    const team_id = parts[tidIdx];
    const code = parts[codeIdx];

    if (!student_id || !name || !team_id || !code) {
      console.error(`Line ${i + 1}: Missing values.`, parts);
      process.exit(1);
    }

    if (seenStudents.has(student_id)) {
      console.error(`Line ${i + 1}: Duplicate student_id ${student_id}.`);
      process.exit(1);
    }
    seenStudents.add(student_id);

    if (!teamsMap.has(team_id)) {
      teamsMap.set(team_id, []);
    }
    teamsMap.get(team_id)!.push({ student_id, name, team_id, code });
  }

  console.log(`Parsed ${seenStudents.size} students across ${teamsMap.size} teams from codes.csv.`);

  // Validation
  for (const [tid, members] of teamsMap.entries()) {
    if (members.length < 3 || members.length > 5) {
      console.error(`Error: Team ${tid} has ${members.length} members (must be 3-5).`);
      process.exit(1);
    }
  }

  // Check event phase
  const { data: eventState, error: stateErr } = await supabase
    .from('event_state')
    .select('phase')
    .eq('id', 1)
    .single();

  if (stateErr || !eventState) {
    console.error('Error: Could not retrieve event_state from database.', stateErr?.message);
    process.exit(1);
  }

  console.log(`Current event phase: ${eventState.phase}`);

  // Step 1: Clear old captain flags to prevent 'one_captain_per_team' conflict
  console.log('Resetting captain flags on existing students to avoid conflicts...');
  const { error: resetCaptainErr } = await supabase
    .from('students')
    .update({ is_captain: false })
    .neq('id', '');

  if (resetCaptainErr) {
    console.warn('Notice while resetting captain flags:', resetCaptainErr.message);
  }

  // Step 2: Delete old placeholder students (e.g. S0101) not in the new CSV
  const { error: delErr } = await supabase
    .from('students')
    .delete()
    .not('id', 'in', `(${Array.from(seenStudents).join(',')})`);

  if (delErr) {
    console.log('Note on deleting old students:', delErr.message);
  } else {
    console.log('Cleaned up old placeholder students.');
  }

  const salt = await bcrypt.genSalt(10);
  const teamRows = [];
  const studentRows = [];

  for (const [tid, members] of teamsMap.entries()) {
    teamRows.push({
      id: tid,
      name: `Team ${tid}`,
      n: members.length,
      withdrawn: false,
      qualified: false,
      r3_eligible: false,
    });

    for (let m = 0; m < members.length; m++) {
      const member = members[m];
      const isCaptain = m === 0; // First member in team list is captain
      const codeHash = await bcrypt.hash(member.code.toUpperCase(), salt);

      studentRows.push({
        id: member.student_id,
        name: member.name,
        team_id: tid,
        is_captain: isCaptain,
        absent: false,
        code_hash: codeHash,
        failed_logins: 0,
        locked_until: null,
      });
    }
  }

  console.log('Upserting 74 teams...');
  for (let i = 0; i < teamRows.length; i += 50) {
    const batch = teamRows.slice(i, i + 50);
    const { error: tErr } = await supabase.from('teams').upsert(batch, { onConflict: 'id' });
    if (tErr) {
      console.error('Error inserting teams batch:', tErr.message);
      process.exit(1);
    }
  }
  console.log(`Successfully upserted ${teamRows.length} teams.`);

  console.log('Upserting 307 students...');
  for (let i = 0; i < studentRows.length; i += 50) {
    const batch = studentRows.slice(i, i + 50);
    const { error: sErr } = await supabase.from('students').upsert(batch, { onConflict: 'id' });
    if (sErr) {
      console.error('Error inserting students batch:', sErr.message);
      process.exit(1);
    }
  }
  console.log(`Successfully upserted ${studentRows.length} students.`);
  console.log('✓ codes.csv successfully imported into database!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
