# Contributing

Standard pnpm workflow:

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
pnpm build       # tsdown (ESM + CJS + d.ts)
```

CI runs all of the above plus `publint` and `@arethetypeswrong/cli` on every PR.
