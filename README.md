# Feeeesh

Cozy web idle collectible aquarium — Angular + Three.js billboard fish + ASP.NET Core API.

Product decisions: see Project store `docs/fish-tank-game-concept.md`.

## Stack (MVP demo)

| Layer | Choice |
| --- | --- |
| Web | Angular 19 + Three.js (pixel billboards) |
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
- Pearls, daily free roll, Cast (15 Pearls)
- Soft care states + Tend / revive
- Email register/login + vanity slug claim
- Public read-only tank view
- Lobby shell: splash → pixel lobby (View Tank / Summon Fish) → immersive View Tank
- Placeholder AI pixel lobby BG + fish sprites under `src/feeeesh-web/public/assets/` (**preview only** — final shipped art must be human-made per product legal lock)

## Not included yet

- Azure deploy, real email SMTP verification, Redis, SignalR, final human-made pixel atlases

## Security

- Do **not** commit secrets: Production Postgres connection strings, GitHub PATs, SMTP/API keys, JWT signing keys, private certs, or local SQLite DBs with user data.
- Prefer environment variables, Azure Key Vault, or `dotnet user-secrets` for anything sensitive. Local overrides: `appsettings.*.local.json` / `.env` (both gitignored).
- Session cookies and password hashes live only in the local SQLite DB (`*.db` gitignored); never check that file in.
