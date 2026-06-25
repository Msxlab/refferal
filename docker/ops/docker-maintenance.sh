#!/usr/bin/env bash
# Safe Docker host maintenance for Refearn.
# Prunes build cache and old unused images only. It never prunes Docker volumes.
set -euo pipefail

BUILDER_UNTIL="${DOCKER_BUILDER_PRUNE_UNTIL:-168h}"
IMAGE_UNTIL="${DOCKER_IMAGE_PRUNE_UNTIL:-240h}"

echo "[docker-maintenance] before"
docker system df || true

echo "[docker-maintenance] prune builder cache older than ${BUILDER_UNTIL}"
docker builder prune -af --filter "until=${BUILDER_UNTIL}"

echo "[docker-maintenance] prune unused images older than ${IMAGE_UNTIL}"
docker image prune -af --filter "until=${IMAGE_UNTIL}"

echo "[docker-maintenance] after"
docker system df || true

echo "[docker-maintenance] done; Docker volumes were not pruned"
