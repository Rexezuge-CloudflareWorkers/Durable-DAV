/**
 * Pure `UPDATE ... SET` clause builder (Specification pattern).
 *
 * `RepositoryDAO.update` and `ProjectDAO.updateProject` duplicated the same
 * `sets: string[]` / `values: unknown[]` juggling around a dynamic
 * `` `UPDATE <table> SET ${sets.join(', ')} ...` `` template. Callers build
 * the (already-validated, literal-column) assignment list with their own
 * conditionals — including boolean-to-`1`/`0` mapping — and this helper owns
 * the single string-join + value-ordering rule so both DAOs share one
 * implementation. Columns must be code literals, never user input.
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
