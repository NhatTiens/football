# Verification — lineup v1.2.0

Executed in the build environment:

- `npm run typecheck`: PASS for all workspaces
- `npm test`: PASS, 9/9 tests
- `npm run lint`: PASS
- `npm run build`: PASS, Next.js production build

Prisma schema changes are included in `schema.prisma` and migration `0003_lineups`.
Run `npm run db:generate` and `npm run db:push` on the target machine before starting the worker.
