# Code-Level Discipline Plan

> Extending "design first, rules first" from architecture to code.
> Each phase adds ONE constraint layer. Don't skip phases.
> Created: March 24, 2026

## Current state

| Layer | Status |
|---|---|
| Architecture docs | STRONG — DESIGN.md, MEMORY-ARCHITECTURE.md, DATA-ARCHITECTURE.md |
| Schemas (Zod) | HAVE — tool inputs validated at runtime |
| CLAUDE.md | STARTED — 72 lines, will grow |
| Types (TypeScript) | DONE — strict mode, 5 .ts files, compiles clean |
| Lints (ESLint) | DONE — strict rules, no-any, eqeqeq, prefer-const |
| Formatter (Prettier) | DONE — .prettierrc, format:check script |
| Tests | DONE — 17 tests, 3 suites (log-event, search, get-tasks) |
| Pre-commit hooks | DONE — runs format:check + test before every commit |
| CI (GitHub Actions) | DONE — runs on every push |

## Phase sequence

Each phase makes one new class of mistake impossible.
Don't jump ahead. Each builds on the previous.

### Phase 1 — Formatter (makes inconsistent style impossible)

What: Prettier auto-formats on save. No style arguments ever again.
Why FIRST: cheapest to add, zero learning curve, instant consistency.
One command standardises the entire codebase.

```bash
# Install
cd mcp-server && npm install --save-dev prettier

# Config (one file)
echo '{ "semi": true, "singleQuote": true, "trailingComma": "all" }' > .prettierrc

# Add script
# package.json: "format": "prettier --write src/",
#               "format:check": "prettier --check src/"
```

What it catches: inconsistent quotes, missing semicolons, messy indentation.
What it CAN'T catch: wrong logic, missing types, bad names.

### Phase 2 — Tests (makes broken tools invisible)

What: Node.js built-in test runner. Zero dependencies.
Why SECOND: tests prove the system works. Without them, every change
is a guess. Tests also give the agent something to run after changes.

Three tests, one per MCP tool:
```
mcp-server/tests/
  log-event.test.mjs    ← writes event, reads file, verifies content
  search.test.mjs       ← logs events, searches, verifies matches
  get-tasks.test.mjs    ← logs task events, queries, verifies status
```

```bash
# No install needed — Node 22 has built-in test runner
# package.json: "test": "node --test tests/"
```

What it catches: broken tools, regression when editing bronze-store.
What it CAN'T catch: type errors at boundaries, style issues.

### Phase 3 — TypeScript (makes type errors impossible)

What: Rename .mjs → .ts. Add tsconfig.json. Compiler catches mismatches.
Why THIRD: after tests exist, TypeScript prevents the class of errors
that tests alone can't catch — passing wrong types between functions,
missing fields, undefined access.

```bash
# Install
npm install --save-dev typescript @types/node

# tsconfig.json (strict mode)
{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "target": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}

# Rename: index.mjs → index.ts, bronze-store.mjs → bronze-store.ts
# Fix type errors the compiler finds
# package.json: "build": "tsc", "start": "node dist/index.js"
```

What it catches: wrong argument types, missing fields, null access.
What it CAN'T catch: logic errors, missing test coverage.

Key migration decision: ALL MCP configs (.mcp.json) currently point to
src/index.mjs. After migration, update them to point to dist/index.js
(compiled output) or use ts-node/tsx for development.

### Phase 4 — Linter (makes bad patterns impossible)

What: ESLint with strict rules. Catches patterns that compile but are wrong.
Why FOURTH: after types, lints catch the NEXT layer — unused variables,
unreachable code, functions too long, missing error handling.

```bash
# Install
npm install --save-dev eslint @eslint/js typescript-eslint

# eslint.config.js with strict rules:
# - no-unused-vars (error)
# - no-console (warn — use proper logging)
# - max-lines-per-function (50 lines — forces decomposition)
# - eqeqeq (error — no == ever)
```

What it catches: unused code, sloppy comparisons, oversized functions.
What it CAN'T catch: tests not written, deployment not done.

### Phase 5 — Pre-commit hook (makes committing broken code impossible)

What: Run format + lint + test before every commit. Blocks bad commits.
Why FIFTH: after all checks exist, automate them. The agent (and you)
can never commit code that fails any check.

This is jnsgruk's "contract" pattern: the hook is a contract between
you and every agent that touches the codebase.

```bash
# Simple git hook (no extra dependencies)
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
cd mcp-server
npm run format:check && npm run lint && npm test
EOF
chmod +x .git/hooks/pre-commit
```

What it catches: any commit that would break format, lint, or tests.
What it CAN'T catch: design problems, missing features.

### Phase 6 — CI (makes merging broken code impossible)

What: GitHub Actions runs the same checks on every push.
Why LAST: after pre-commit works locally, CI catches anything
that slips through (different Node version, missing dependency).

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cd mcp-server && npm install
      - run: cd mcp-server && npm run format:check
      - run: cd mcp-server && npm run lint
      - run: cd mcp-server && npm test
```

What it catches: environment-specific failures, dependency drift.
This is the final gate. Nothing merges without passing.

## The constraint stack (when complete)

```
CI (GitHub Actions)           ← can't merge broken code          ✅ format+lint+build+test
  Pre-commit hook             ← can't commit broken code         ✅ format+lint+build+test
    Linter (ESLint)           ← can't write bad patterns         ✅ strict, no-any, eqeqeq
      Types (TypeScript)      ← can't pass wrong types           ✅ strict mode
        Tests (Node test)     ← can't break existing tools       ✅ 17 tests
          Formatter (Prettier)← can't have inconsistent style    ✅ configured
            Schemas (Zod)     ← can't send invalid MCP input     ✅ 3 tools
              Architecture    ← can't build wrong thing           ✅ DESIGN.md
```

Each layer catches what the layer below can't.
By the time code runs in production, it has passed through 8 filters.

## When to do each phase

| Phase | When | Effort | Status |
|---|---|---|---|
| 1. Formatter | Before pushing datacore to GitHub | 10 min | DONE |
| 2. Tests | Before Lakestone application | 30 min | DONE — 17 tests |
| 3. TypeScript | Before Silver layer work | 2-3 hours | DONE |
| 4. Linter | After TypeScript migration | 20 min | DONE |
| 5. Pre-commit | After linter | 5 min | DONE |
| 6. CI | After repo is on GitHub | 15 min | DONE |

Phases 1-2 are immediate. They're cheap and high impact.
Phase 3 is the biggest investment but the biggest payoff.
Phases 4-6 are quick once the foundation exists.

## CLAUDE.md grows alongside

Every phase will surface new gotchas. Add them to CLAUDE.md.
Phase 2 (tests): "always run npm test before declaring done"
Phase 3 (TypeScript): "never use `any` — find the real type"
Phase 4 (linter): specific rules that agents violate

The CLAUDE.md should reference this plan:
"See CODE-DISCIPLINE.md for the constraint stack."
