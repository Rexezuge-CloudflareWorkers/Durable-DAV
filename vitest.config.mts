import { defineRepoVitestConfig } from '@rexezuge/tooling/vitest-repo';

// A tool config *is* an executable module: the aliases resolve and the coverage
// floor is read at import time, which is the only time there is.
export default defineRepoVitestConfig({
  scope: '@durable-dav',
  root: new URL('.', import.meta.url).href,
  // One enforced global floor, raised 28/23/36/30 (pre-hardening) → 35/31/41/36 →
  // 43/39/50/44 → 46/41/52/47 → 59/55/61/60 → the current 60/57/61/61, set a hair
  // under the measured 61.06/58.81/61.51/62.45 so an unrelated deletion of a few
  // uncovered lines cannot fail CI, but not so far below that a real regression
  // passes. (The measurement moved up when the kit's canonical exclude set
  // replaced this repo's shorter one: barrels, model records, generated files and
  // type-only modules carry no logic to exercise.) Vitest applies glob-scoped
  // thresholds per *file* rather than per directory aggregate, so a per-area floor
  // here would compare every individual module against it. Never lower to make CI
  // pass.
  thresholds: { statements: 60, branches: 57, functions: 61, lines: 61 },
});
