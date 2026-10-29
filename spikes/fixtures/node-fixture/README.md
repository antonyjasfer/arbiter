# arbiter-spike-fixture

A tiny Node project used by the Arbiter Phase 1 runner spike. It has one dependency (`ms`) so `npm ci` must reach the npm registry.

Branches:

- `pass`: `npm test` exits 0.
- `fail`: one assertion is deliberately false, `npm test` exits non-zero.
- `probe`: as `pass`, plus `test/no-secrets.test.js`, which fails if the test process can see a credential-shaped environment variable. It prints variable names only, never values.

Safe to clone. Contains no secrets.
