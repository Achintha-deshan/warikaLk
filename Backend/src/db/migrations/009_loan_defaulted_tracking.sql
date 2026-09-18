-- defaulted_at is deliberately separate from start_date. A loan can start
-- in January and only be recognized as defaulted in June — attributing the
-- capital loss to the loan's start_date would misassign it to the wrong
-- reporting period. Standard write-off accounting recognizes a loss in the
-- period it's RECOGNIZED, not backdated to when the underlying loan
-- originated. Reports (Task 3) filter defaulted loans by defaulted_at, not
-- start_date, for exactly this reason.
ALTER TABLE loans ADD COLUMN defaulted_at TIMESTAMPTZ;
ALTER TABLE loans ADD COLUMN default_reason TEXT;
