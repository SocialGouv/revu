/**
 * lint-staged config is kept in a separate CJS file (instead of `package.json`)
 * so we can use function-form tasks.
 *
 * Function tasks are required for TypeScript typechecking so lint-staged does
 * NOT append individual filenames to `tsc` (avoids TS5042 and ensures tsconfig
 * is always respected).
 */

/** @type {import('lint-staged').Config} */
module.exports = {
  '*.{ts,tsx,js,jsx}': ['eslint --fix'],
  '*.{json,yaml,yml,md}': ['prettier --write'],

  // Run a single `tsc` invocation when any TS/TSX file is staged.
  // lint-staged stashes unstaged changes, so `tsc` checks the staged snapshot.
  // Note: lint-staged does not run tasks in a shell by default, so shell
  // operators like `&&` are not interpreted. Use an array of commands instead.
  '**/*.{ts,tsx}': () => [
    "node -e \"require('fs').mkdirSync('.tsbuildinfo', { recursive: true })\"",
    'tsc -p tsconfig.build.json --noEmit --pretty false --incremental --tsBuildInfoFile .tsbuildinfo/typecheck.tsbuildinfo',
  ],
}
