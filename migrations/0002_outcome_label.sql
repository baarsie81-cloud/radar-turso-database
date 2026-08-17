-- Radar 2.4 learning loop: post-close outcome labels.
-- Decision engine is unchanged. Outcomes are independent of decision_status.
-- Only CLOSED cases may carry an outcome label. Incomplete closes stay NULL.

ALTER TABLE token_cases ADD COLUMN outcome_label TEXT
  CHECK (
    outcome_label IS NULL
    OR outcome_label IN ('NO_RESULT', 'SMALL_WIN', 'RUNNER')
  );

ALTER TABLE token_cases ADD COLUMN outcome_labeled_at INTEGER;

ALTER TABLE token_cases ADD COLUMN outcome_inputs_json TEXT;

CREATE TRIGGER token_cases_outcome_closed_insert
BEFORE INSERT ON token_cases
BEGIN
  SELECT CASE
    WHEN NEW.outcome_label IS NOT NULL AND NEW.case_status != 'CLOSED'
    THEN RAISE(ABORT, 'outcome_label requires case_status CLOSED')
  END;
END;

CREATE TRIGGER token_cases_outcome_closed_update
BEFORE UPDATE ON token_cases
BEGIN
  SELECT CASE
    WHEN NEW.outcome_label IS NOT NULL AND NEW.case_status != 'CLOSED'
    THEN RAISE(ABORT, 'outcome_label requires case_status CLOSED')
  END;
END;
