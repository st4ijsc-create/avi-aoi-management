-- doc 34 P3 (D6): add the engineer role. ADD VALUE must be its own auto-commit statement.
ALTER TYPE "roleenum" ADD VALUE IF NOT EXISTS 'engineer';
