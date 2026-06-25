# Refearn Ops Timers

These files are examples for a Linux host where the repo is deployed at `/opt/refearn`.

## Docker Cache Maintenance

The maintenance script prunes build cache and old unused images. It does not prune Docker volumes, so `pgdata` and `backups` are not touched.

Install:

```bash
sudo cp docker/ops/refearn-docker-maintenance.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now refearn-docker-maintenance.timer
```

Optional retention windows:

```bash
sudo systemctl edit refearn-docker-maintenance.service
```

```ini
[Service]
Environment=DOCKER_BUILDER_PRUNE_UNTIL=168h
Environment=DOCKER_IMAGE_PRUNE_UNTIL=240h
```

## Restore Drill

The restore drill loads the newest backup into an isolated temporary database and checks that core tables are not empty.

Install:

```bash
sudo cp docker/ops/refearn-restore-test.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now refearn-restore-test.timer
```

For encrypted backups, the backup container must have `AGE_IDENTITY_FILE` mounted and readable.

## Safety Notes

- Do not run `docker system prune --volumes` on this host.
- Do not run `docker volume prune` unless `pgdata` and `backups` have been moved and verified elsewhere.
- Keep Google Drive credentials and age private keys out of the repository.
