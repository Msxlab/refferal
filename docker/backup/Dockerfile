# Yedekleme imaji: postgres (pg_dump) + rclone (Google Drive offsite) + age (sifreleme) + bash.
FROM postgres:17
RUN apt-get update \
 && apt-get install -y --no-install-recommends rclone age ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY docker/backup/backup.sh /backup.sh
COPY docker/backup/restore-test.sh /restore-test.sh
ENTRYPOINT ["bash", "/backup.sh"]
