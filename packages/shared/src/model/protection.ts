export interface BranchProtectionRuleMetadata {
  id: string;
  repositoryId: string;
  pattern: string;
  requirePr: boolean;
  requiredApprovals: number;
  blockForcePush: boolean;
  blockDeletion: boolean;
  /*
   * Required status check contexts (e.g. `secret-scan`). Enforced at PR merge
   * time by CheckService: every listed context must report success (neutral /
   * skipped count as passing) on the merge head SHA, otherwise merge 409s.
   * Direct pushes are unaffected (merge-gate only).
   */
  requireStatusChecks: string[];
  createdBy: string;
  createdAt: number;
}
