# Smuggler — Web UI

React 19 + TypeScript + Vite frontend for [Smuggler](../README.md), built on
Mantine with a Dockview panel workbench. This is the only UI; there is no
desktop client.

## Running it

In the stack, nginx serves the built assets — `./start.sh build` from the repo
root, then <http://localhost:8887>.

For frontend work, run Vite against a live API:

```bash
./start.sh debug   # from the repo root: Flask + Vite, both with hot reload
```

`vite.config.ts` proxies `/api` to `http://localhost:55555`, so requests are
same-origin in dev and no CORS configuration is needed. The proxy also reads
`SMG_API_TOKEN` from the repo-root `.env` and injects `X-Smuggler-Token`
server-side, matching what nginx does in production — without it every request
401s on a machine that has run `setup.sh`. The token never reaches the bundle.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (expects the API on `:55555`) |
| `npm run build` | `tsc -b` then a production build |
| `npm run lint` | ESLint over the package |
| `npm run test` | Vitest in watch mode |
| `npm run test:run` | Vitest once — what CI runs |

Run `./node_modules/.bin/eslint .` directly rather than through a shell wrapper
when checking before a push; some wrappers mask a non-zero exit code.

## Layout

```
src/
  api/         axios client + shared response types
  components/  reusable pieces (modals, rows, cards, footer)
  context/     theme, notifications, deployments, shell actions
  hooks/       hash routing, keyboard shortcuts, modal a11y
  lib/         pure logic — list filter/sort, routing target, setup chain
  pages/       one component per top-level tab
  test/        render helper, Mantine/jsdom shims, fixtures
  workbench/   Dockview layout
  theme.ts     Mantine theme (brand ramp, neutral dark palette)
```

Tests sit beside their source. Two vitest projects: `*.test.ts` runs in node,
`*.test.tsx` in jsdom with Testing Library and `renderWithProviders`.

The `lib/` split exists so decisions stay testable without a DOM. Prefer moving
a decision there over driving a Mantine dropdown in jsdom — Combobox needs
layout jsdom does not provide, so a UI-level test of it asserts Mantine rather
than Smuggler. `resolveRoutingTarget` is the worked example.

## Conventions worth knowing

- **"Mule", never "worker"** — in code, copy and tests alike.
- **Status colours go through the semantic variables** in `index.css`
  (`--smg-ok`, `--smg-info`, `--smg-warn`, `--smg-attention`, `--smg-bad`), not
  a numbered shade. `c="teal.4"` is tuned for the dark surface and drops to
  roughly 2:1 on the light one; the variables keep the hue and move the
  lightness per colour scheme. Write `c="var(--smg-ok)"`.
- **Styling lives in Mantine** — `theme.ts` for tokens, component props for
  layout. `index.css` carries only what Mantine cannot express: root sizing,
  keyframes, the semantic colour variables and the Dockview bridge.
- **No third-party network calls from the browser.** Everything goes through
  `/api`. Peer geolocation was removed for this reason — see the note in
  `components/TorrentRow.tsx`.
