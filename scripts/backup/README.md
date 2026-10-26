# Postgres backups

`pg_backup.sh` dumps the ShowUp database from the running `postgres` compose
service (`pg_dump` runs inside the container, so no host port is needed),
gzips it, verifies the archive, keeps 14 days locally and optionally uploads
to S3. `pg_restore.sh` restores a dump - by default into a scratch database so
a restore drill never touches production.

## Install (cron, nightly 03:15 server time)

```cron
15 3 * * * /home/ocs/ShowUp/scripts/backup/pg_backup.sh >> /home/ocs/ShowUp-backups/backup.log 2>&1
```

Add with `crontab -e` as user `ocs` (must be in the `docker` group). Create
the directory first: `mkdir -p /home/ocs/ShowUp-backups && chmod 700 /home/ocs/ShowUp-backups`.

Optional S3 copy (needs the AWS CLI and credentials with `s3:PutObject` on the
bucket - use a dedicated backup bucket/IAM user, not the media bucket keys):

```cron
15 3 * * * BACKUP_S3_BUCKET=s3://showup-db-backups/pg /home/ocs/ShowUp/scripts/backup/pg_backup.sh >> /home/ocs/ShowUp-backups/backup.log 2>&1
```

Set the S3 retention with a bucket lifecycle rule (e.g. expire after 30 days),
and enable default encryption on the bucket.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | `/home/ocs/ShowUp-backups` | local destination |
| `BACKUP_RETENTION_DAYS` | `14` | local retention |
| `COMPOSE_FILE` | `docker-compose.dev.yml` | compose file the stack runs from |
| `PG_SERVICE` | `postgres` | compose service name |
| `BACKUP_S3_BUCKET` | unset | `s3://bucket/prefix`; unset = local only |
| `BACKUP_S3_STORAGE_CLASS` | `STANDARD_IA` | S3 storage class |

`DB_USER` / `DB_NAME` are read from the repo `.env`; nothing secret is printed.

## Restore drill (do this once now, then monthly)

```bash
scripts/backup/pg_restore.sh /home/ocs/ShowUp-backups/showup_<db>_<stamp>.sql.gz
# -> restores into <DB_NAME>_restore_test and prints users/events/guests counts
```

Restoring over the live DB (disaster recovery only):

```bash
docker compose -f docker-compose.dev.yml stop $(docker compose -f docker-compose.dev.yml config --services | grep -v '^postgres$')
CONFIRM_PRODUCTION_RESTORE=yes scripts/backup/pg_restore.sh <file> <DB_NAME>
docker compose -f docker-compose.dev.yml up -d
```

A backup only exists off-box once S3 upload is on - a local-only copy dies
with the disk.
