# Feeeesh

Cozy web idle collectible aquarium — Angular + Three.js free-fly tank (glTF fish) + ASP.NET Core API.

Product decisions: Project store `docs/fish-tank-game-concept.md` · free-fly plan: `docs/feeeesh-3d-view-tank-plan.md`.

## Stack (MVP demo)

| Layer | Choice |
| --- | --- |
| Web | Angular 19 + Three.js (PointerLock free-fly + glTF voxel fish) |
| API | ASP.NET Core 9 |
| DB (local demo) | SQLite (`feeeesh.dev.db`) |
| Prod target | Azure + PostgreSQL (swap connection string later) |

## Run locally (Cloud Agent / your machine)

```bash
# API
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$PATH:$DOTNET_ROOT"
cd src/Feeeesh.Api
dotnet run --launch-profile http
# → http://localhost:5071

# Web (another terminal)
cd src/feeeesh-web
npm start
# → http://localhost:4200  (proxies /api → :5071)
```

## MVP features in this scaffold

- Guest session + 2 starter commons + random public slug `/t/{slug}`
- Pearls, daily free roll first, then Cast for Pearls
- Soft care states + Tend / revive
- Email register/login + vanity slug claim
- Splash 2B (coral→purple pinstripes, pearl orb, Loading Feeeesh...)
- Lobby 3A (View Tank + Summon Fish glossy heroes on strong pixel BG)
- View Tank free-fly: WASD look-swim (pitch + W/S for vertical; no Space/Ctrl) + pointer-lock; larger tank; denser voxel glTF fish; lobby pixel BG stays on lobby only
- Public `/t/{slug}` uses the same free camera
- 3 AI-backed denser glTF fish under `src/feeeesh-web/public/assets/fish/*.glb` (non-monetized; no Pokémon IP)

## Not included yet

- Azure deploy, real email SMTP verification, Redis, SignalR, mobile free-fly controls

## Security

- Do **not** commit secrets: Production Postgres connection strings, GitHub PATs, SMTP/API keys, JWT signing keys, private certs, or local SQLite DBs with user data.
- Prefer environment variables, Azure Key Vault, or `dotnet user-secrets` for anything sensitive. Local overrides: `appsettings.*.local.json` / `.env` (both gitignored).
- Session cookies and password hashes live only in the local SQLite DB (`*.db` gitignored); never check that file in.
