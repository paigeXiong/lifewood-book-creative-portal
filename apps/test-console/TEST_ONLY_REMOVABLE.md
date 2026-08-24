# TEST ONLY — REMOVABLE

This entire application is a local acceptance tool and may be deleted as one directory.

- It must never be included in the customer-facing production build or deployment.
- The customer application must never import from this directory.
- It only reads data through the local platform API and intentionally provides no workflow-management mutations.
- Removal procedure: delete `apps/test-console`, remove its two root npm scripts, and remove the console process block from `scripts/start-local.ps1`.
