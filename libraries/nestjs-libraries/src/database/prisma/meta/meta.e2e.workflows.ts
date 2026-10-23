/**
 * Workflow bundle entry for the Temporal E2E spec.
 *
 * The orchestrator registers `require.resolve('./workflows')` — the index, which
 * exports every workflow. The test cannot use that entry directly: bundling it
 * pulls in the post and integration workflows, which import modules webpack
 * cannot resolve inside the workflow sandbox, and the bundle fails.
 *
 * Pointing the test at a single compiled workflow file instead was what hid a
 * gap: the bundle held `metaDeletionWorkflow` only, so starting the reconciler
 * failed with "no such function is exported by the workflow bundle" and the
 * reconcile workflow was never actually executed by any test.
 *
 * This re-exports both Meta workflows from source, so the bundle matches what
 * the orchestrator loads for this feature and cannot drift from a stale
 * `dist/`. Imports are relative on purpose — the `@gitroom/*` aliases are a
 * tsconfig concern and webpack does not read them.
 */
export { metaDeletionWorkflow } from '../../../../../../apps/orchestrator/src/workflows/meta.deletion.workflow';
export { metaDeletionReconcileWorkflow } from '../../../../../../apps/orchestrator/src/workflows/meta.reconcile.workflow';
