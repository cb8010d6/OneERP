# OneERP Quickstart Deployment

This guide is for a single-machine deployment suitable for internal trial use,
pilot teams, and production rehearsals. It runs PostgreSQL, Redis, MinIO, API,
Web, migration, and production initialization through Docker Compose.

## Prerequisites

- Docker Desktop on Windows, or Docker Engine + Compose on Linux.
- At least 4 CPU cores, 8 GB RAM, and 30 GB free disk.
- A backup location outside the server if using real business data.

## One Command Start

### Windows PowerShell

```powershell
.\scripts\quickstart.ps1 -Rebuild
```

### Linux/macOS

```bash
sh scripts/quickstart.sh --rebuild
```

The script creates `.env` with generated secrets if it does not exist.

Default URLs:

- Web: http://localhost:3000
- API docs: http://localhost:8000/api/docs
- MinIO console: http://localhost:9001

Default admin:

- Email: `admin@oneerp.local`
- Password: read `INIT_ADMIN_PASSWORD` in `.env`

Change the admin password after first login.

## Daily Operations

Start:

```bash
docker compose -f docker-compose.easy.yml up -d
```

Stop:

```bash
docker compose -f docker-compose.easy.yml down
```

Status:

```bash
docker compose -f docker-compose.easy.yml ps
```

Logs:

```bash
docker compose -f docker-compose.easy.yml logs -f api web
```

Upgrade after pulling new code:

```bash
docker compose -f docker-compose.easy.yml up -d --build
```

The `migrate` service runs `prisma migrate deploy` and idempotent production
initialization before the API starts.

## Backup

Windows:

```powershell
.\scripts\backup.ps1
```

Linux/macOS:

```bash
sh scripts/backup.sh
```

Backups are written to `backups/YYYYMMDD-HHMMSS/` and include:

- `postgres.sql`
- `minio-data.tgz`
- `.env.copy`

Move backups off the application server.

## Restore

Stop write traffic before restore.

Windows:

```powershell
.\scripts\restore.ps1 -BackupDir .\backups\YYYYMMDD-HHMMSS
```

Linux/macOS:

```bash
sh scripts/restore.sh backups/YYYYMMDD-HHMMSS
```

## Internet Deployment Notes

For public internet access:

1. Put a reverse proxy in front of Web/API, such as Caddy, Nginx, or a cloud load balancer.
2. Enable HTTPS.
3. Set `CORS_ORIGINS` to your real Web origin.
4. Keep `NEXT_PUBLIC_API_BASE_URL=/api/proxy` if Web and API share one domain.
5. Use strong secrets in `.env`.
6. Do not expose PostgreSQL, Redis, or MinIO API ports to the public internet.

## Production Readiness Gate

Before using real inventory or finance data, complete
[`docs/PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md).
