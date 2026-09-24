import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { splitSql } from './integration/helpers/migrations';

describe('splitSql', () => {
  it('splits simple statements and ignores semicolons in strings and comments', () => {
    const stmts = splitSql(`CREATE TABLE a (x TEXT);
-- a comment; with semicolon
INSERT INTO a VALUES ('it''s; quoted'); /* block; comment */
SELECT 1;`);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toContain('CREATE TABLE a');
    expect(stmts[1]).toContain(`'it''s; quoted'`);
    // A trailing block comment attaches to the following statement; the
    // semicolon inside it still does not split.
    expect(stmts[2]).toContain('SELECT 1');
  });

  it('keeps CREATE TRIGGER bodies with inner semicolons as one statement', () => {
    const sql = `CREATE TABLE IF NOT EXISTS code_index (repo_id TEXT);
CREATE TRIGGER IF NOT EXISTS trg_code_fts_ai AFTER INSERT ON code_index BEGIN
  INSERT INTO code_fts(repo_id, path, content) VALUES (NEW.repo_id, NEW.path, NEW.content);
END;
INSERT INTO code_fts(repo_id, path, content) SELECT repo_id, path, content FROM code_index;`;
    const stmts = splitSql(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[1]).toContain('CREATE TRIGGER');
    expect(stmts[1]).toContain('NEW.content);');
    expect(stmts[1].trimEnd().endsWith('END')).toBe(true);
    expect(stmts[2]).toContain('SELECT repo_id');
  });

  it('handles lowercase triggers and multiple triggers in sequence', () => {
    const sql = `create trigger trg_a after insert on t begin
  delete from f where id = old.id;
  insert into f(id) values (new.id);
end;
create trigger trg_b after delete on t begin
  delete from f where id = old.id;
end;
select 1;`;
    const stmts = splitSql(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toContain('trg_a');
    expect(stmts[0]).toContain('new.id);');
    expect(stmts[1]).toContain('trg_b');
    expect(stmts[2]).toBe('select 1');
  });

  it('does not treat a table named trigger as a trigger body', () => {
    const stmts = splitSql(`CREATE TABLE trigger (id TEXT);
INSERT INTO trigger VALUES ('x');`);
    expect(stmts).toHaveLength(2);
  });

  it('splits the squashed schema (0021) with whole trigger bodies', () => {
    const url = new URL('../migrations/0021_squash.sql', import.meta.url);
    const sql = readFileSync(fileURLToPath(url), 'utf8');
    const stmts = splitSql(sql);
    // 3 FTS sync triggers each for repo/issue/code/pull/discussion/snippet.
    const triggers = stmts.filter((s) => s.toUpperCase().includes('CREATE TRIGGER'));
    expect(triggers).toHaveLength(18);
    for (const trigger of triggers) expect(trigger.trimEnd().toUpperCase().endsWith('END')).toBe(true);
    // Rowid-linked code maintenance survived the squash; the one-time
    // staging-table rebuild from 0018 did not.
    expect(stmts.filter((s) => s.includes('WHERE rowid = OLD.rowid'))).toHaveLength(2);
    expect(sql).not.toContain('code_fts_new');
  });
});
