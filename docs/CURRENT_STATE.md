# Current state — 5 October 2026

- **Objective:** a railway scene you want to build in and watch. One authored riverside region; town, mill, yard, passenger stations, two services, shared bottleneck and neighbourhood growth. Target 15–20 minutes, awaiting playtests.
- **Preview:** http://127.0.0.1:41719/ — choose **Play Brookford** for the new authored region. Production build; local/offline assets.
- **Recovery:** commit `7f5f34f`, tag `codex/pre-riverside-reset-2026-10-05`. Ignored logs/builds remain on disk; original owning checkout remains untouched.
- **Playable now:** illustrated terrain/riverbanks, overhead trees, recognisable industry yards, detailed fleets/platforms, quiet track artwork and one company bar/inspector. £65,000 starting cash, two services and an optional £45,218 northern relief line. Housing adds buildings and 25% passenger demand. Company → Save and return to menu works on touch; Escape opens Company when not drawing.
- **Latest evidence:** integrated fast check 17 suites / 287 tests in 38.0s; final critical/UI/config check 11 suites / 235 tests in 26.9s, without coverage. Three browser smoke cases passed in 1.2 minutes: construction/cancel/charges, service blockage, housing, save/reopen, relief purchase and landscape touch/menu navigation. Build and whitespace checks pass. Screenshots: `riverside/evidence/`.
- **Trade-off evidence:** over 600 deterministic seconds the base produces 511.1 combined seconds of service waiting; the relief line produces zero in that specific scenario. Housing completes at 505s versus 342s. These are fixture results, not player-enjoyment or performance claims.
- **Unresolved:** the long legacy regional freight journey has not passed. Its latest run was deliberately stopped; previous braking/notification failures and logs are retained. No further long rerun is planned during this milestone.
- **Current milestone:** first playable presentation pass delivered; visual refinement and enjoyment remain active. Native packaging, migrations and additional architecture remain frozen.
- **Blocker:** none for implementation. Human enjoyment and physical-device testing remain unverified.
- **Next action:** observe a few 15–20-minute human sessions. Improve first-service clarity, stoppage diagnosis, construction choice and visual feedback before adding content. No release-quality, physical-phone or enjoyment gate has been claimed.

`docs/full-game/IMPLEMENTATION.md` records historical work; it is not the active completion plan.
