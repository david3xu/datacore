# TypeScript Migration Record

> Migrated datacore MCP server from plain JavaScript (.mjs) to TypeScript (.ts)
> Date: March 24, 2026
> Triggered by: jnsgruk research — "make wrong things impossible, not unlikely"

## What changed

### Before
```
src/
  index.mjs          ← plain JS, no types
  bronze-store.mjs   ← plain JS, no types
  client.mjs         ← plain JS, no types
  paths.mjs          ← plain JS, no types
  runtime-deps.mjs   ← plain JS, re-exports
```
No compiler. No lint. No format check. No tests.
Package manager: npm.

### After
```
src/
  index.ts           ← TypeScript (strict mode)
  bronze-store.ts    ← TypeScript, all interfaces exported
  client.ts          ← TypeScript, typed MCP client
  paths.ts           ← TypeScript, return types
  runtime-deps.ts    ← TypeScript, re-exports
  *.mjs              ← kept for backward compat (MCP configs still point here)
dist/
  *.js + *.d.ts      ← compiled output (5 files each)
```
Package manager: pnpm.

## Types added

### bronze-store.ts
```typescript
BronzeRecord       — source, type, content, context, _timestamp, _source, _event_id
AppendEventInput   — source, type, content, context?
AppendEventResult  — bronzeDir, filePath, record
SearchInput        — query, maxResults?, source?, type?
SearchResult       — eventId, timestamp, source, type, snippet, filePath
SearchOutput       — bronzeDir, filesScanned, eventsScanned, parseErrors, totalMatches, results, sourceCounts, typeCounts
TaskInput          — status?, assigned_to?, task_type?, task_id?, limit?
TaskSummary        — 23 typed fields (task_id, status, assigned_to, problem, impact, project, ...)
TaskEvent          — eventId, timestamp, source, type, content, context
```

### client.ts
```typescript
LaunchConfig       — command, args, cwd, env
ClientOptions      — command?, args?, serverPath?, cwd?, env?, bronzeDir?, shared?
DatacoreSession    — client, transport, launch
ToolCallParams     — name, arguments?
```

### index.ts
- `toTextResult()` returns inferred type compatible with MCP SDK's `CallToolResult`
- All tool handlers typed via Zod schema inference (automatic from `server.tool()`)

## Toolchain added (full constraint stack)

| Layer | Tool | Config file | What it catches |
|---|---|---|---|
| Architecture | DESIGN.md + 15 docs | — | Wrong design decisions |
| Schemas | Zod | in index.ts | Invalid MCP tool inputs |
| Formatter | Prettier | .prettierrc | Inconsistent style |
| Tests | Node.js test runner | tests/*.test.mjs | Broken tools, regressions |
| Types | TypeScript 5.8 | tsconfig.json | Wrong types at boundaries |
| Linter | ESLint + typescript-eslint | eslint.config.js | Bad patterns (any, ==, unused) |
| Pre-commit | git hook | .git/hooks/pre-commit | Bad commits blocked |
| CI | GitHub Actions | .github/workflows/ci.yml | Bad pushes blocked |

## tsconfig.json (strict)

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "module": "ESNext",
    "target": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

`strict: true` enables: strictNullChecks, strictFunctionTypes,
strictBindCallApply, strictPropertyInitialization, noImplicitAny,
noImplicitThis, alwaysStrict. Plus three additional flags for
unchecked indexes, unused locals, and unused parameters.

## Gotchas encountered during migration

### 1. MCP SDK expects index signature on return types
`server.tool()` handler must return `{ [x: string]: unknown; content: ... }`.
A custom `interface TextResult` fails because interfaces don't have implicit
index signatures. Fix: let TypeScript infer the return type from a plain
function, use `as const` for the `type: 'text'` literal.

### 2. `ProcessEnv` is not `Record<string, string>`
Node's `process.env` has type `Record<string, string | undefined>`.
Can't assign directly to `Record<string, string>`. Fix: filter out
undefined values explicitly when building launch environment.

### 3. Duplicate content from multiple file appends
Building a file via multiple `write_file(mode: 'append')` calls can
double content if a call is retried. Always verify file content after
multi-append construction.

### 4. Old .mjs files must stay (for now)
All MCP configs (.mcp.json in datacore, Claude Desktop, Antigravity)
point to `src/index.mjs`. Removing .mjs files would break all
existing AI app connections. Migration path: update configs to
`dist/index.js` one app at a time, then remove .mjs files.

### 5. Tests still import from .mjs
Tests use `import { appendEvent } from '../src/bronze-store.mjs'`.
They work because the .mjs files still exist. Future: migrate tests
to import from compiled `.js` or from `.ts` directly via tsx.

## Commands after migration

```bash
pnpm run build          # TypeScript → dist/ (tsc)
pnpm run lint           # ESLint strict checks on src/*.ts
pnpm run format:check   # Prettier check on src/ + tests/
pnpm run format         # Auto-format all files
pnpm run test           # 17 tests (Node.js built-in runner)
pnpm run start          # Run compiled server (dist/index.js)
pnpm run start:dev      # Run original JS server (src/index.mjs)
```

Pre-commit runs: format:check → lint → build → test
CI runs the same on every push.

## Remaining migration work

| Item | Status | When |
|---|---|---|
| .ts source files | DONE | March 24, 2026 |
| tsconfig.json (strict) | DONE | March 24, 2026 |
| ESLint config | DONE | March 24, 2026 |
| Prettier config | DONE | March 24, 2026 |
| Pre-commit hook | DONE | March 24, 2026 |
| CI workflow | DONE | March 24, 2026 |
| CLAUDE.md updated | DONE | March 24, 2026 |
| Tests import from .ts | NOT YET | Before Silver layer |
| MCP configs → dist/index.js | NOT YET | After tests migrated |
| Remove .mjs files | NOT YET | After all configs updated |
| Migrate tests to TypeScript | NOT YET | Optional, low priority |

## Why we did this

From PHILOSOPHY.md principle #2: "Make wrong things impossible, not unlikely."

Plain JavaScript lets you pass a string where a BronzeRecord is expected.
TypeScript makes that a compile error. The compiler catches mistakes before
tests run. Tests catch mistakes before commits. Pre-commit catches mistakes
before push. CI catches mistakes before merge.

Each layer eliminates a class of error the layer below can't see.
