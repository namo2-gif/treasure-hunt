-- ============================================================================
-- 009_slot_10.sql
-- Expand questions.slot from max 5 to max 10.
-- Supports 10 slots per run × 2 variants = 20 questions per run (40 total).
-- Each team still gets exactly 4 questions drawn from the 10 available slots.
-- ============================================================================

-- Drop the old check constraint and add a new one
ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_slot_check;

ALTER TABLE questions
  ADD CONSTRAINT questions_slot_check CHECK (slot >= 1 AND slot <= 10);

-- Update the variants_per_question setting to 2 (already default, just make explicit)
UPDATE settings SET value = '2' WHERE key = 'variants_per_question';

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
