/**
 * The order a replication sweep visits collections in.
 *
 * The sweep is **resumable**: a tick that runs out of budget parks a cursor, and
 * the next tick continues from it rather than starting again at the root. That is
 * only possible if the order is total and if "where was I?" has an answer that
 * is a function of the cursor path and the tree — because the next tick has no
 * memory of the tree beyond the paths it can read.
 *
 * ## The order
 *
 * A **pre-order** over a tree whose children are sorted by name: a collection is
 * visited before the collections inside it, and a collection's whole subtree is
 * visited before its next sibling. Two properties make it the right order, and
 * both are load-bearing rather than aesthetic:
 *
 * 1. The collections visited so far are a **prefix** of the order. A cursor
 *    therefore names exactly what has been covered, and the next tick can carry
 *    on after it without re-deciding anything — or, worse, skipping something.
 * 2. The successor of a collection is derivable from that collection and its
 *    ancestors' listings. A breadth-first order has neither property: its
 *    frontier depends on the entire queue, so a single path cannot describe it,
 *    and a slice that runs out of budget can only restart from the root — which
 *    is why a tree deeper than one slice never finished at all.
 *
 * ## Why the comparison is segment-wise
 *
 * `a/b` sorts before `a/c`, and `a` sorts before `a/b`: an ancestor comes before
 * its descendants, as pre-order requires. Whole-string comparison gets that
 * second case wrong for some names — `a.txt` sorts before `a/b` as strings, but
 * `a` is a *collection* whose subtree must be visited first — so a cursor computed
 * from it would skip a subtree and report the sweep complete.
 */

/**
 * The sweep order on two paths.
 *
 * Segment-wise, with the ancestor first. The comparison is on code units rather
 * than on locale, for the same reason `compareByPath` is: the order only has to
 * be *stable*, and a locale-dependent comparator would order two runs differently
 * under different ICU data.
 */
function sweepOrderCompare(a: string, b: string): number {
  if (a === b) return 0;
  const left = a.split('/');
  const right = b.split('/');
  const shared = Math.min(left.length, right.length);
  for (const [index, leftSegment] of left.entries()) {
    if (index >= shared) break;
    const rightSegment = right[index];
    if (leftSegment === rightSegment) continue;
    return leftSegment < rightSegment ? -1 : 1;
  }
  // One path is a prefix of the other, so the shorter one is the ancestor and
  // comes first.
  return left.length - right.length;
}

/**
 * Sort paths into the sweep order.
 *
 * A copy, not a sort in place: the caller owns the array it passed in, and the
 * frontier this feeds is rebuilt from the result on every resume.
 */
function sweepSort(paths: readonly string[]): string[] {
  return [...paths].sort(sweepOrderCompare);
}

/**
 * The chain from the root down to a path, inclusive.
 *
 * `sweepAncestorChain('a/b/c')` is `['', 'a', 'a/b', 'a/b/c']`. The root is
 * always first because it is the only collection whose listing names every
 * top-level path — and the resume needs each ancestor's listing to find the
 * sibling that follows the cursor.
 */
function sweepAncestorChain(path: string): string[] {
  const chain: string[] = [''];
  if (path === '') return chain;
  let current = '';
  for (const segment of path.split('/')) {
    current = current === '' ? segment : `${current}/${segment}`;
    chain.push(current);
  }
  return chain;
}

export { sweepOrderCompare, sweepSort, sweepAncestorChain };
