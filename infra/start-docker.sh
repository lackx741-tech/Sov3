#!/usr/bin/env bash
# Start the Docker daemon (runs dockerd as root in the background) and wait until ready.
sudo -n dockerd > /tmp/dockerd.log 2>&1 &
for i in $(seq 1 20); do
  if docker info >/dev/null 2>&1; then
    echo "docker daemon is up"
    exit 0
  fi
  sleep 1
done
echo "docker daemon did not start; recent log:"
tail -20 /tmp/dockerd.log
exit 1