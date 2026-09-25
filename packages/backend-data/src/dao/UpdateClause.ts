/**
 * Pure `UPDATE ... SET` clause builder (Specification pattern).
 *
 * Callers build the (already-validated, literal-column) assignment list
 * with their own conditionals — including boolean-to-`1`/`0` mapping — and
 * this helper owns the single string-join + value-ordering rule.
 * Columns must be code literals, never user input.
 */
interface SetAssignment {
  column: string;
  value: unknown;
}

interface SetClause {
  clause: string;
  values: unknown[];
}

function buildSetClause(assignments: SetAssignment[]): SetClause {
  return {
    clause: assignments.map((a) => `${a.column} = ?`).join(', '),
    values: assignments.map((a) => a.value),
  };
}

export { buildSetClause };
export type { SetAssignment, SetClause };
