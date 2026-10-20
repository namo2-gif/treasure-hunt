import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
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

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateStudentCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    const idx = crypto.randomInt(0, CODE_CHARS.length);
    code += CODE_CHARS[idx];
  }
  return code;
}

async function main() {
  console.log('Starting seed process...');

  // 1. Clean existing test data (respecting foreign keys)
  console.log('Cleaning existing seed data...');
  await supabase.from('attempts').delete().neq('id', 0);
  await supabase.from('score_adjustments').delete().neq('id', 0);
  await supabase.from('registrations').delete().neq('id', 0);
  await supabase.from('piece_assignments').delete().neq('run', 0);
  await supabase.from('team_questions').delete().neq('run', 0);
  await supabase.from('team_run').delete().neq('run', 0);
  await supabase.from('r3_boxes').delete().neq('box', 0);
  await supabase.from('r3_result').delete().neq('id', 0);
  await supabase.from('r3_team').delete().neq('team_id', '');
  await supabase.from('questions').delete().neq('id', 0);
  await supabase.from('teaser_puzzles').delete().neq('id', 0);
  await supabase.from('riddles').delete().neq('id', 0);
  await supabase.from('students').delete().neq('id', '');
  await supabase.from('teams').delete().neq('id', '');
  await supabase.from('qr_locations').delete().neq('id', 0);

  // 2. Insert 12 QR Locations
  console.log('Inserting 12 QR locations...');
  const qrRows = [];
  for (let i = 1; i <= 12; i++) {
    qrRows.push({
      name: `[PLACEHOLDER] QR Location ${i}`,
      token: crypto.randomBytes(16).toString('base64url'),
      capacity: 12,
      active: true,
    });
  }
  const { data: insertedQrs, error: qrErr } = await supabase
    .from('qr_locations')
    .insert(qrRows)
    .select('id, name');

  if (qrErr || !insertedQrs) {
    throw new Error(`Failed to insert QR locations: ${qrErr?.message}`);
  }
  console.log(`Inserted ${insertedQrs.length} QR locations.`);

  // 3. Insert 30 Teams with 3-5 members each
  console.log('Inserting 30 teams and students...');
  const teamRows = [];
  const studentRows = [];
  const csvRecords: string[] = ['student_id,name,team_id,code'];

  // Hash cache for duplicate generated codes if any, or compute per student
  const salt = await bcrypt.genSalt(10);

  for (let t = 1; t <= 30; t++) {
    const teamId = `T${String(t).padStart(2, '0')}`;
    const memberCount = (3 + ((t - 1) % 3)) as 3 | 4 | 5; // cycles 3, 4, 5
    teamRows.push({
      id: teamId,
      name: `[PLACEHOLDER] Team ${String(t).padStart(2, '0')}`,
      n: memberCount,
      withdrawn: false,
      qualified: false,
      r3_eligible: false,
    });

    for (let m = 1; m <= memberCount; m++) {
      const studentId = `S${String(t).padStart(2, '0')}${String(m).padStart(2, '0')}`;
      const isCaptain = m === 1;
      const code = generateStudentCode();
      const codeHash = await bcrypt.hash(code.toUpperCase(), salt);

      studentRows.push({
        id: studentId,
        name: `[PLACEHOLDER] Student ${studentId}`,
        team_id: teamId,
        is_captain: isCaptain,
        absent: false,
        code_hash: codeHash,
        failed_logins: 0,
        locked_until: null,
      });

      csvRecords.push(`${studentId},[PLACEHOLDER] Student ${studentId},${teamId},${code}`);
    }
  }

  const { error: teamErr } = await supabase.from('teams').insert(teamRows);
  if (teamErr) throw new Error(`Failed to insert teams: ${teamErr.message}`);

  const { error: studentErr } = await supabase.from('students').insert(studentRows);
  if (studentErr) throw new Error(`Failed to insert students: ${studentErr.message}`);

  fs.writeFileSync(path.join(process.cwd(), 'codes.csv'), csvRecords.join('\n'), 'utf-8');
  console.log(`Inserted ${teamRows.length} teams and ${studentRows.length} students. Generated codes.csv.`);

  // 4. Insert 12 Riddles with 8 options each
  console.log('Inserting 12 riddles...');
  const riddleRows = [];
  const optionLetters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (let r = 1; r <= 12; r++) {
    const options = optionLetters.map((l) => ({
      id: l,
      text: `[PLACEHOLDER] Riddle ${r} Option ${l.toUpperCase()}`,
    }));
    riddleRows.push({
      position: r,
      text: `[PLACEHOLDER] Riddle ${r}: What is the mystery clue for stage ${r}?`,
      options,
      correct_option_id: 'a',
    });
  }
  const { error: riddleErr } = await supabase.from('riddles').insert(riddleRows);
  if (riddleErr) throw new Error(`Failed to insert riddles: ${riddleErr.message}`);
  console.log(`Inserted ${riddleRows.length} riddles.`);

  // 5. Insert Teaser Puzzles (runs 1 and 2, sizes 3, 4, 5)
  console.log('Inserting teaser puzzles...');
  const teaserRows = [];
  for (const run of [1, 2] as const) {
    for (const size of [3, 4, 5] as const) {
      const pieces = [];
      for (let p = 1; p <= size; p++) {
        pieces.push(`[PLACEHOLDER] Run ${run} Piece ${p} of ${size}`);
      }
      teaserRows.push({
        run,
        size,
        pieces,
        answer_norm: `placeholder answer r${run} s${size}`,
      });
    }
  }
  const { error: teaserErr } = await supabase.from('teaser_puzzles').insert(teaserRows);
  if (teaserErr) throw new Error(`Failed to insert teaser puzzles: ${teaserErr.message}`);
  console.log(`Inserted ${teaserRows.length} teaser puzzles.`);

  // 6. Insert 20 Questions (5 slots x 2 runs x 2 variants) linked to QRs
  console.log('Inserting 20 questions...');
  const questionRows = [];
  let qrIndex = 0;
  for (const run of [1, 2] as const) {
    for (let slot = 1; slot <= 5; slot++) {
      for (const variant of [1, 2] as const) {
        const qr = insertedQrs[qrIndex % insertedQrs.length];
        qrIndex++;
        const options = optionLetters.map((l) => ({
          id: l,
          text: `[PLACEHOLDER] R${run} S${slot} V${variant} Option ${l.toUpperCase()}`,
        }));
        questionRows.push({
          run,
          slot,
          variant,
          qr_id: qr.id,
          stem: `[PLACEHOLDER] Run ${run} Slot ${slot} Variant ${variant}: Poster Question at ${qr.name}`,
          options,
          correct_option_id: 'a',
        });
      }
    }
  }
  const { error: questionErr } = await supabase.from('questions').insert(questionRows);
  if (questionErr) throw new Error(`Failed to insert questions: ${questionErr.message}`);
  console.log(`Inserted ${questionRows.length} questions.`);

  // 7. Update Round 3 (config, 5 zones, 20 riddles)
  console.log('Seeding Round 3 configuration, zones, and riddles...');
  const { error: r3CfgErr } = await supabase
    .from('r3_config')
    .upsert({
      id: 1,
      code: '1DAI',
      hint_text: '[PLACEHOLDER] Shift cipher hint',
    });
  if (r3CfgErr) throw new Error(`Failed to update Round 3 config: ${r3CfgErr.message}`);

  for (let z = 1; z <= 5; z++) {
    const { error: zErr } = await supabase.from('r3_zones').upsert({
      id: z,
      name: `[PLACEHOLDER] Zone ${z}`,
      token: crypto.randomBytes(16).toString('base64url'),
      find_riddle: `[PLACEHOLDER] Zone ${z} start riddle pointing to start QR`,
    });
    if (zErr) throw new Error(`Failed to update zone ${z}: ${zErr.message}`);
  }

  const r3RiddleRows = [];
  for (let z = 1; z <= 5; z++) {
    for (let b = 1; b <= 4; b++) {
      r3RiddleRows.push({
        zone: z,
        box: b,
        text: `[PLACEHOLDER] Zone ${z} box ${b} riddle`,
      });
    }
  }
  const { error: riddlesErr } = await supabase.from('r3_riddles').upsert(r3RiddleRows);
  if (riddlesErr) throw new Error(`Failed to update Round 3 riddles: ${riddlesErr.message}`);

  console.log('Updated Round 3 data.');

  console.log('Seed completed successfully!');
}

main().catch((err) => {
  console.error('Fatal error during seed:', err);
  process.exit(1);
});
