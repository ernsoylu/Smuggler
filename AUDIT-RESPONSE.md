# Audit Response — Evaluation of External Critiques & Remediation Plan

Three external critiques (C#1, C#2, C#3) were evaluated against the codebase at
commit `a8607b7`. Every claim was verified against actual source. This document
records which claims survived verification, which did not, what the critiques
missed, and the plan to fix what's real.

**Headline:** C#3 is accurate and worth acting on. C#2 is mostly accurate but
contains one "5-minute P0" that would break the application and several
"missing" features that already exist. C#1 is largely inapplicable — it audits a
product Smuggler isn't.

## Status

| Phase | State | Commit |
|---|---|---|
| 0 — Fail closed | **Done**, verified against a real WireGuard tunnel | `939c7e8` |
| 1 — Correctness bugs | **Done** | `8beced4` (backend), `62785d1` (frontend) |
| 8 — Docs & hygiene | **Done** | `8beced4` |
| 2 — Crypto hardening | **Done** — scrypt + MultiFernet rotation | `0d46579` |
| 3 — Container/network | **Done** (3.1 networking, 3.2 socket proxy, 3.3 least-privilege, 3.4 image hygiene) | `ed6fc40`, `cff21d5`, `HEAD` |
| 4 — Truthful deploy state | **Done** — async deploy + real mule-reported phases | `HEAD` |
| 5 — Supply chain & CI | **Done** — scanners, SBOM, Dependabot, action pinning | `HEAD` |
| 6 — UX gaps | **Done** — one deliberate deviation: SSE not built, see note below | `66b7c97`, `HEAD` |
| 7 — Decisions | Open | |

**Phase 6 deviation — SSE.** The plan called for replacing the 2-second polling
with server-sent events. Not done, deliberately. TanStack Query already gates
`refetchInterval` on window focus (`queryObserver.js:215`:
`refetchIntervalInBackground || focusManager.isFocused()`), so polling stops
whenever the tab is not focused — the waste the critique identified is largely
already absent. Against that, SSE on the current `gunicorn --workers 1
--threads 8` would hold one thread per open tab for the life of the connection,
so a handful of tabs could starve the pool that serves ordinary requests. That
is a real regression risk traded for latency nobody can perceive on localhost.
Revisit only alongside an async worker class.

Phase 0 was verified with a real WireGuard config: the mule's exit IP
differs from the host's, the dual probe matches, kill-switch and RPC-ingress
rules install with the real endpoint, RPC is reachable from the host but times
out from a bridge-peer container, and tearing down `wg0` drops egress instead of
leaking. Running that drill surfaced two further defects, both fixed: a
kill-switch teardown exited `0` and overwrote its own recorded reason, and
`--rpc-listen-all=false` (a critique "5-minute P0") would have broken every mule.

The OpenVPN path was later verified end-to-end with real OpenVPN credentials
(since purged): a mule deployed through the socket-proxied API reached a Finland exit node, the kill-switch armed against the pinned endpoint, the
credential file was gone from disk after connect, and killing OpenVPN **restored
the clear-net default route** — the exact F1 failure mode — yet egress was
dropped rather than leaked and the mule was torn down with exit 1.

Two further defects were found by running these drills and are fixed: the
mule-hardening `PUID` defaulted to `os.getuid()`, which is root inside the API
container and silently skipped the privilege drop (now derived from the
downloads directory's owner); and `cap_drop: ALL` with only `NET_ADMIN` broke
config reads, `setpriv` and the monitor's ability to kill a non-root aria2.

---

## Part 1 — Evaluation

### 1.1 Critique calibration

| Critique | Verdict | Notes |
|---|---|---|
| **C#3** | **Trustworthy** | Nearly every claim verified. Correctly identifies the kill-switch fail-open path, the fake deploy stages, and the api→cli coupling. Two feature-table errors (below). |
| **C#2** | **Mostly trustworthy** | Security section solid. Feature/UX section contains four false negatives and one actively harmful P0 recommendation. |
| **C#1** | **Largely inapplicable** | Premised on a product that doesn't exist. See 1.2. |

### 1.2 Why C#1 does not apply

C#1 describes Smuggler as "a Dockerized VPN backend, a local Flask API, and a
JavaFX desktop frontend" and evaluates it against **Markdown viewers**
(Obsidian, Typora, VS Code). Both premises are wrong:

- **It ignores the primary UI entirely.** The React web app under `web/` is the
  main frontend. `desktop/` is a secondary JavaFX client (29 files, 2,972 LOC)
  that explicitly mirrors it — `ApiClient.java:32` says *"Mirrors
  web/src/api/client.ts"*.
- **The comparison category is wrong.** Smuggler is a magnet-only torrent
  downloader. C#1's central recommendation — embedding a Markdown/NFO rendering
  engine with ligature-free monospace fonts for ASCII-art fidelity — solves a
  problem this product does not have.
- **Its concurrency risk is misdiagnosed.** C#1 warns that JavaFX and Flask both
  writing SQLite will cause `database is locked`. The desktop client never
  touches SQLite; it is a pure HTTP client (`ApiClient.java:39`,
  `http://127.0.0.1:55555`). Its prescribed fixes — API owns the DB, enable WAL
  — are already the implemented design (`api/database.py:64`).
- **Its headline architecture suggestion is a regression.** C#1 proposes the
  gluetun pattern: one `vpn-gateway` container with downloaders joined via
  `network_mode: "service:vpn-gateway"`. Smuggler's mule *already* runs the VPN
  and aria2 in a single network namespace — identical isolation, fewer moving
  parts — and a shared gateway would destroy per-mule tunnel isolation, which is
  the project's entire differentiator.
- **Its master-detail UI recommendation is already implemented.**
  `TorrentRow.tsx:46` defines a five-tab expandable detail pane
  (`status | details | files | peers | options`).

**Salvageable from C#1** (folded into the plan): PUID/PGID for downloaded-file
ownership, WM_CLASS / desktop-integration hints, DBus notifications, a UNIX
domain socket option for the API, and a command palette.

### 1.3 Claims that are WRONG — do not implement

| Claim | Source | Reality |
|---|---|---|
| **`--rpc-listen-all=false` — "5 min P0 fix"** | C#2 §S5/C6 | **Would break the application.** Docker port publishing DNATs to the *container's* IP, so aria2 must accept on the container interface. aria2 has no bind-address option — only this boolean. Setting `false` makes every mule unreachable. The comment at `worker_image/startup.sh:8` is misleading; the flag is required. Real fix is INPUT filtering (Phase 0.3). |
| "No selective file download" | C#2 §U8 + table | **Exists.** `TorrentRow.tsx:250` Normal/Skip toggle → `api/torrents.py:484` `change_option(gid, {"select-file": ...})`. |
| "No per-torrent progress visualization" | C#2 §U9 | **Exists.** Per-file progress bars, `TorrentRow.tsx:238-247`. |
| "No per-torrent speed limit" | C#3 table | **Exists.** `TorrentRow.tsx:412-434` → `api/torrents.py:451` `max-download-limit`. |
| "Neither UI nor CLI exposes aria2's torrent-creation capability" | C#3 | **False premise.** aria2 has no torrent-creation capability. This needs a new dependency (`torf`), not an exposed flag. |
| "No multi-architecture (ARM) support" | C#2 §7 | **Non-issue as architected.** All images are built locally from source (`docker-compose.yml` `build:`); architecture follows the host. Nothing is published to a registry, so multi-arch manifests are meaningless today. Becomes real only if images are ever published. |
| "500 handler leaks exception detail" | implied C#2 §S-list | **False.** `api/app.py:125` returns a fixed `{"error": "Internal server error"}`. |
| "No CSRF protection" | implied C#1 | **False.** Origin allow-list on all mutating methods, `api/app.py:96-101`. |
| "Watchdog dies silently on gunicorn recycle" | C#2 §C10 | **Latent, not live.** No `max_requests` is configured, so the worker never recycles. Real risk only appears if recycling is added later. |

### 1.4 Confirmed findings, re-ranked by actual severity

Severity reflects *this* project's threat model (single-user, self-hosted,
loopback-bound), not a generic checklist.

**Critical — the product's core promise fails**

| ID | Finding | Evidence |
|---|---|---|
| **F1** | **OpenVPN kill-switch fails open.** When the endpoint IP can't be resolved, the DROP rule is never installed and startup continues. `--redirect-gateway def1` means the tunnel works fine without the pin, so this goes unnoticed — until `tun0` dies, OpenVPN restores the eth0 default route, and aria2 egresses clear-net for `KILL_SWITCH_INTERVAL` (5s) plus curl timeout before the monitor reacts. `SECURITY.md:52` calls this firewall the **"primary no-leak guarantee."** | `worker_image_ovpn/startup.sh:165` |
| **F2** | Same fail-open branch in the WireGuard image. Lower severity — the hard connectivity gate at `worker_image/startup.sh:198-209` aborts startup — but the behaviour is inconsistent and relies on a side effect. | `worker_image/startup.sh:140` |
| **F3** | **aria2 RPC secret has a `changeme` fallback.** If `ARIA2_SECRET` is ever unset, the RPC token is a published constant. | `worker_image/startup.sh:15` |
| **F4** | **RPC ingress is never filtered.** The kill-switch only writes `OUTPUT` rules. With `--rpc-listen-all=true`, aria2 accepts on the mule's docker-bridge IP, reachable by any container sharing that bridge. F3 + F4 compose into unauthenticated download control. | `worker_image/startup.sh:130-141` |
| **F5** | **Encryption silently degrades to plaintext.** With `SMG_SECRET_KEY` unset, `encrypt()` logs one warning and writes WireGuard private keys and OpenVPN passwords to SQLite in cleartext. | `api/crypto.py:68-77`, `:128-137` |

**High — fails open by default, or breaks under normal conditions**

| ID | Finding | Evidence |
|---|---|---|
| **F6** | **API token generated but written commented-out.** `setup.sh` runs `gen_secret_key` inside an unquoted heredoc — a real token is produced, then disabled. A Docker-socket-holding control plane serves unauthenticated by default. | `setup.sh:286` |
| **F7** | **Deploy depends on a single third party.** `wait_for_vpn` gates every deployment on `curl https://ipinfo.io/json`; on rate-limit or outage it raises and the deploy fails. The watchdog already does this correctly with a fallback chain — that resilience was never applied here. *(C#3 called this "cosmetic"; it isn't.)* | `cli/docker_client.py:235,258` vs `:487-491` |
| **F8** | **No SQLite `busy_timeout`.** WAL is on, but with `--threads 8` plus the watchdog thread, concurrent writers get an immediate `SQLITE_BUSY` instead of waiting. | `api/database.py:62-64` |
| **F9** | **`start_watchdog()` docstring promises a guard that doesn't exist.** Harmless at `--workers 1`; raising worker count silently spawns N sweepers racing on `evacuate_mule()`. | `api/watchdog.py:209` vs `:212` |
| **F10** | **Magnet `dn` path traversal.** `dn.replace('/', '_')` doesn't neutralise `..`, so `dn=".."` yields `/downloads/..` → container root. Container-scoped, but can clobber the mule's own `/etc/resolv.conf` (which is the DNS pin). | `api/torrents.py:183` |
| **F11** | **Unsalted SHA-256 KDF.** Brute-forceable at raw hash speed against any captured `fernet:` row. Mitigated in practice because `setup.sh` generates a 32-byte random key — but nothing enforces that. | `api/crypto.py:43-44` |

**Medium — real hardening gaps**

| ID | Finding | Evidence |
|---|---|---|
| F12 | Docker socket mounted read-write, no proxy | `docker-compose.yml:24` |
| F13 | `network_mode: host` on both services | `docker-compose.yml:10,36` |
| F14 | Mules run as root; no PUID/PGID; downloads land root-owned on the host | no `USER` in any Dockerfile |
| F15 | No `cap_drop`, `no-new-privileges`, seccomp, `read_only`, or resource limits on mules | `cli/docker_client.py:159-176` |
| F16 | No `HEALTHCHECK` in any of the 4 Dockerfiles | — |
| F17 | No dependency/CVE scanning or SBOM in CI; no Dependabot | `.github/workflows/` |
| F18 | Base images tag-pinned, not digest-pinned | all Dockerfiles |
| F19 | No API rate limiting | no `flask-limiter` |
| F20 | `--rpc-allow-origin-all=true` unnecessary (API proxies server-side) | `worker_image/startup.sh:230` |
| F21 | `/api/health` auth exemption uses `startswith`, not an exact match | `api/app.py:84` |
| F22 | Anonymous `VOLUME` declarations in mule Dockerfiles | `worker_image/Dockerfile:21` |

**Medium — correctness / honesty of the UI**

| ID | Finding | Evidence |
|---|---|---|
| **F23** | **Deploy stages are fabricated.** Stage is derived purely from `Date.now() - startedAt` against hardcoded 3000/8000 ms thresholds. A 40-second deploy shows "Establishing VPN connection…" from second 8 with the bar pinned at 3/4. The backend already knows the truth — `GET /api/mules/<name>/health` exists and `getMuleHealth` is exported in `client.ts:122` **with zero call sites**. | `ConfigsPage.tsx:37`, `MulesPage.tsx:22-25` |
| **F24** | **Cache-key mismatch.** Deploys invalidate `['workers']` while `MulesPage` reads `['mules']` (and vice versa across files) — the UI can show stale mule state after a deploy. Also violates CLAUDE.md rule 2 (`App.tsx` uses `page === 'workers'`, `WorkersPage`). | `MulesPage.tsx:159`, `ConfigsPage.tsx:227` |
| F25 | "Click or **drag** a .torrent file here" — no drop handler exists anywhere in `web/src` | `AddTorrentModal.tsx:119` |
| F26 | Dead code: `StatsBar.tsx` (94 LOC, never imported); `getMuleHealth` (never called) | — |
| F27 | Dead debug guard: `app.py:131` reads `app.debug` before `app.run()` sets it; `run.py:28` passes `use_reloader=False` anyway | `api/app.py:131` |

**Low — docs, DX, hygiene**

| ID | Finding | Evidence |
|---|---|---|
| F28 | Personal path leaked in README | `README.md:40` `/home/eren/.local/bin/uv run pytest` |
| F29 | No `.env.example`; `.gitignore:44-45` ignores `.env.*`, so one needs an explicit negation | — |
| F30 | `desktop/` missing from CLAUDE.md Directory Structure **and** Tech Stack, though `start.sh:24`, `setup.sh:117`, and `desktop-ci.yml` all reference it | `CLAUDE.md:26-33` |
| F31 | Legacy pre-rebrand `DVD_LOGGING` / `DVD_LOG_LEVEL` written by setup.sh | `setup.sh:276-277` |
| F32 | `SMG_API_URL`, `SMG_CORS_ORIGINS`, `SMG_DEBUG` undocumented outside code | — |
| F33 | No OpenAPI spec, though two clients (CLI + JavaFX) consume the API | — |
| F34 | api→cli coupling with no `core/`/`services/` layer; all 9 api modules import cli | — |
| F35 | Raw aria2 errors forwarded to clients, including internal URLs | `api/torrents.py:159` et al., `cli/aria2_client.py:44` |

### 1.5 Findings the critiques MISSED

Verification surfaced these; none appear in any of the three critiques:

**F3** `changeme` RPC secret fallback · **F4** RPC ingress unfiltered ·
**F5** silent plaintext fallback · **F7** deploy gated on a single third party
(C#3 explicitly mis-classified this as cosmetic) · **F8** missing `busy_timeout`
· **F10** magnet `dn` traversal · **F21** `/api/health` prefix-match exemption ·
**F24** cache-key mismatch · **F26/F27** dead code · **F30** desktop/ absent from
CLAUDE.md.

### 1.6 Credit where due (verified, keep as-is)

Dual-probe leak detection (tunnel-bound exit IP vs default-route exit IP);
DNS pinning with `127.0.0.11` REJECT; conditional IPv6 DROP with link-local
exception; magnet-only `addUri`; **doubled** downloads-root containment checks
(`api/torrents.py:264` and `:291`); `hmac.compare_digest` token comparison;
CSRF Origin allow-list; non-leaking 500 handler; 192-bit per-mule RPC secrets;
`NET_ADMIN` without `SYS_MODULE`; credential temp-file with `trap cleanup_creds
EXIT`; SHA-pinned third-party CI actions; 294 tests. nginx proxy timeouts are
already tuned to 180s to match gunicorn — a detail all three critiques missed
while speculating about deploy timeouts.

---

## Part 2 — Remediation Plan

Sequenced by risk, not by effort. Every phase ends green on
`uv run pytest tests/` + ruff + `tsc`, per the SKILLS.md Git & Quality Workflow.
Phases 0–2 are one PR each; later phases can be split.

### Phase 0 — Fail closed (P0)

Everything here converts a silent degradation into a loud refusal.

| # | Change | Files |
|---|---|---|
| 0.1 | **Arm the kill-switch before the tunnel, not after.** Install `OUTPUT -o $ORIG_DEV -j DROP` *first*, then punch holes for the resolved endpoint + RPC. If the endpoint cannot be resolved: `write_health "dead"` and `exit 1` — never start aria2. Removes the `else warn` branch in both images. | `worker_image_ovpn/startup.sh:160-168` (F1, primary), `worker_image/startup.sh:134-142` (F2) |
| 0.2 | **Refuse the `changeme` fallback.** `exit 1` if `ARIA2_SECRET` is unset or equals `changeme`. | both `startup.sh:15` (F3) |
| 0.3 | **Filter RPC ingress.** `INPUT -p tcp --dport 6800` ACCEPT from the docker gateway only, DROP otherwise. *(This is the correct fix for what C#2 wrongly proposed as `--rpc-listen-all=false`.)* Set `--rpc-allow-origin-all=false` (F20) — safe, the API proxies server-side. Correct the misleading "bound to 127.0.0.1" comments at `:8` and `:223`. | both `startup.sh` (F4, F20) |
| 0.4 | **Never store secrets in plaintext.** Raise instead of falling through when `SMG_SECRET_KEY` is unset and a secret is being written. Keep read-path tolerance for legacy rows. Gate the raise behind an explicit `SMG_ALLOW_PLAINTEXT_SECRETS=1` escape hatch for tests. | `api/crypto.py:68-77,128-137` (F5) |
| 0.5 | **Enable the API token by default.** Uncomment `SMG_API_TOKEN` in the generated `.env`; print the value once during setup. Add an explicit opt-out path. | `setup.sh:286` (F6) |
| 0.6 | **Multi-source VPN probe.** Replace the single ipinfo.io call in `wait_for_vpn` with the watchdog's existing fallback chain (icanhazip → ipinfo). Extract one shared helper rather than duplicating. | `cli/docker_client.py:235` (F7) |
| 0.7 | Exact-match the `/api/health` auth exemption. | `api/app.py:84` (F21) |

**Verification for 0.1 is mandatory and manual** — this is the leak guarantee.
Run the `SECURITY.md` leak drill for both VPN types, plus a new case: deploy with
a deliberately unresolvable endpoint hostname and confirm the mule refuses to
start rather than starting unprotected.

### Phase 1 — Correctness bugs (P0/P1)

| # | Change | Files |
|---|---|---|
| 1.1 | `PRAGMA busy_timeout=5000` in `_get_conn()` | `api/database.py:62` (F8) |
| 1.2 | Real double-start guard: module-level thread handle + `is_alive()` check | `api/watchdog.py:209-212` (F9) |
| 1.3 | Sanitise magnet `dn` — allowlist charset, strip `.`/`..`, reject empty | `api/torrents.py:183` (F10) |
| 1.4 | Unify the query key on `['mules']` everywhere; rename `WorkersPage`→`MulesPage`, `page === 'workers'`→`'mules'` (CLAUDE.md rule 2). Update tests per the branding rule. | `web/src/**` (F24) |
| 1.5 | Map `Aria2Error` to stable client-facing codes; log the raw error server-side only | `api/torrents.py`, `cli/aria2_client.py:44` (F35) |
| 1.6 | Delete `StatsBar.tsx`; delete or wire up `getMuleHealth` (1.6 is subsumed by Phase 4 — wire it); remove the dead debug guard | `web/src/`, `api/app.py:131` (F26, F27) |

### Phase 2 — Crypto hardening (P1)

Data migration — needs its own PR and a rollback note.

- Replace SHA-256 with **scrypt** (`cryptography`'s KDF; no new dependency) plus
  a per-deployment salt persisted alongside the DB.
- Decrypt through `MultiFernet([new, legacy_sha256])` so existing rows keep
  working; encrypt with the new key only. Re-encrypt in place on startup, then
  drop the legacy key after one release.
- Cache the derived key (`functools.lru_cache` keyed on the env value) — scrypt
  is deliberately expensive, so per-call derivation is no longer acceptable.
- Enforce a minimum key length/entropy at startup; warn loudly below threshold.

*(F11. Note this is genuinely lower-urgency than the critiques imply, since
`setup.sh` already generates a high-entropy key — the fix removes the footgun,
it doesn't patch a live hole.)*

### Phase 3 — Container & network hardening (P1)

**3.1 — Drop host networking (F13).** Design, since the critiques hand-waved it:

- Create two networks: `smuggler-net` (bridge, for api↔ui) and `smuggler-rpc`
  (**`internal: true`** — no route off-host).
- Attach mules to `smuggler-rpc` as a *second* interface. Because the network is
  internal, it cannot become an egress path, so it does not weaken the
  kill-switch. Keep eth0 as the VPN transport, still DROP-ed by 0.1.
- **Stop publishing RPC ports to the host entirely.** The API dials
  `http://<mule-container>:6800/jsonrpc` over `smuggler-rpc`. This is *stronger*
  than what the critiques asked for — it removes host-exposed RPC surface rather
  than relocating it — and it deletes the `_find_free_port()` TOCTOU probe
  (`cli/docker_client.py:67-73`), which is meaningless off host networking.
- Coordinated edits: `cli/docker_client.py:116,152,168` (drop port allocation,
  join network), `MuleInfo.rpc_url` and both `Aria2Client(host="localhost", …)`
  call sites (`api/torrents.py:26`, `cli/docker_client.py:49`) must derive the
  host from the mule, and `docker/nginx.conf.template:21` → `http://smuggler-api:55555`.
- UI publishes `127.0.0.1:8887:80` explicitly.

**3.2 — Docker socket proxy (F12).** Front the socket with a filtered proxy
exposing only `/containers` and `/exec`; mount `:ro` in the meantime. Depends on
3.1 (needs a network to sit on).

**3.3 — Mule least-privilege (F14, F15).** `cap_drop: ALL` + `cap_add:
NET_ADMIN`; `no-new-privileges`; `pids_limit` and memory cap; `read_only` rootfs
with `tmpfs` for `/tmp` and `/etc` (note: startup.sh writes `/etc/resolv.conf`,
so `/etc` must be writable or moved to a tmpfs overlay — verify before
enabling). Run aria2 as an unprivileged UID via PUID/PGID so `/downloads` files
are host-user-owned; keep `NET_ADMIN` for the setup phase and drop privileges
before exec'ing aria2.

**3.4 — Image hygiene (F16, F18, F22).** `HEALTHCHECK` in all four Dockerfiles;
digest-pin base images; replace anonymous `VOLUME`s with documented bind mounts.

### Phase 4 — Truthful deploy state (P1) — F23

The backend already knows the real phase; the UI invents one.

- Mules already write `/tmp/vpn_health.json` (`worker_image/startup.sh:33`). Add
  `GET /api/mules/<name>/phase` that reads it (cheap) instead of re-running a
  live check like `/health` does.
- Make deploy **asynchronous**: `POST /configs/<id>/deploy` returns `202` with a
  job id immediately, and a poll endpoint reports the real phase. This also
  frees one of eight gunicorn threads currently blocked for up to 90s per
  deploy.
  *Cheaper interim:* have the client supply the `name` (the endpoint already
  accepts an override, `api/configs.py:166`) and poll `/phase` during the
  blocking POST. Lower effort, no job store — but keep the async job as the
  target design.
- Delete `STAGE_TIMINGS` and the `elapsed >= 8000` logic from **both**
  `ConfigsPage.tsx` and `MulesPage.tsx`, and de-duplicate the two copies of the
  deploy-notification state machine.

### Phase 5 — Supply chain & CI (P1) — F17, F18

Add `pip-audit` and `npm audit`/`osv-scanner` to CI; `trivy image` on built
images; SBOM via Syft (CycloneDX) as a release artifact; enable Dependabot;
SHA-pin first-party actions for consistency. Keep SonarCloud as-is — it runs in
Automatic Analysis mode and ignores coverage, so no gate changes are needed.

### Phase 6 — UX gaps that are real (P2)

Ordered by impact-to-effort, and scoped to what verification confirmed missing:

1. Global drag-and-drop for `.torrent` (F25 — the UI already *claims* it) plus
   magnet paste, with auto-select of the least-loaded mule.
2. Name search + sortable columns; raise `PAGE_SIZE` from 8 to a configurable
   25/50/100 (`TorrentsPage.tsx:39`).
3. Per-mule VPN health indicator in the torrents view (reuse Phase 4's endpoint).
4. Bulk operations: multi-select, pause-all, delete-completed.
5. React error boundary; skeleton loaders replacing the 16 `animate-spin` sites.
6. Modal a11y: `role="dialog"`, `aria-modal`, focus trap, initial focus,
   Escape-to-close — none of the four modals have any of these today.
7. URL routing (deep links, working back button).
8. Categories/tags; sequential + first/last-piece priority (aria2 supports
   `bt-prioritize-piece`; pure plumbing).
9. Theme toggle; command palette (`Ctrl+K`); keyboard shortcuts.
10. SSE for torrent progress — replaces three 2s polls on the torrents screen.
    Prefer SSE over WebSockets: one-directional, works through the existing
    nginx proxy, no new dependency.

### Phase 7 — Decisions to make (not yet actionable)

These are strategy calls, not defects. Recorded with a recommendation.

- **`desktop/`'s future.** 2,972 LOC of JavaFX that mirrors the React UI
  page-for-page and is *already drifting* — no notification bell, no watchdog
  panel, no deploy staging. Every feature in Phase 6 must otherwise be built
  twice. **Recommendation:** either commit to replacing it with a Tauri shell
  around the existing React build (deletes ~3k LOC, gains auto-update and native
  notifications), or explicitly re-scope it as a deliberately minimal "lite"
  client and document that. The status quo — an undocumented near-clone — is the
  worst of both. Either way, fix F30 first (add `desktop/` to CLAUDE.md).
  If JavaFX stays: add WM_CLASS, a window icon, tray, and DBus notifications
  (C#1's one genuinely useful cluster).
- **`core/` extraction (F34).** Real coupling, but the current split isn't
  hurting anything yet. Do it *if and when* you want to ship `smg` as a
  standalone wheel without Flask.
- **OpenAPI spec (F33).** Highest value if the desktop client survives — two
  hand-written clients against docstring-only contracts is the actual cost.
- **RSS automation / \*arr-compatible API.** The largest genuine competitive
  gaps. Both are net-new subsystems; neither is a fix.
- **Rate limiting (F19).** Low value while loopback-bound and token-gated.
  Revisit only alongside any remote-access story.

### Phase 8 — Docs & hygiene (trivial, bundle into any PR)

F28 (README path), F29 (`.env.example` + `!.env.example` negation in
`.gitignore`), F30 (`desktop/` in CLAUDE.md), F31 (drop `DVD_*`), F32 (document
the three undocumented `SMG_*` vars). Update `SECURITY.md` once Phase 0 lands —
its "primary no-leak guarantee" claim only becomes true after 0.1.

---

## Suggested execution order

1. **Phase 0** — one PR, manual leak drill required before merge.
2. **Phase 1 + Phase 8** — one PR, low risk.
3. **Phase 2** — one PR, migration + rollback note.
4. **Phase 3** — split: 3.1 (networking) alone, then 3.2–3.4.
5. **Phase 4**, then **Phase 5**.
6. **Phase 6** incrementally; **Phase 7** decided before any further desktop work.
