#!/bin/bash
# Builds TriOS MAX — the "replace Windows" edition: real per-account
# exFAT drives (readable directly on Windows/Mac, no container file),
# a full dev/creative toolset, and support for the .triupdate
# drag-and-drop full-system updater. Thin wrapper around build-iso.sh:
# same chroot-setup.sh, with extra packages and a flag file.
#   sudo ./build/build-iso-max.sh
#   FAST=1 sudo ./build/build-iso-max.sh     quick build for testing
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

export VOLID="TRIOSMAX"
export ISONAME="TriOS-MAX"
export MAX_FLAG=1
export EXTRA_APT="${EXTRA_APT:-audacity openshot-qt nmap python3-full python3-pip python3-venv build-essential gdb cmake git nodejs npm curl jq ffmpeg gimp inkscape vim docker.io openssh-server wireshark}"
export WORK="${WORK:-/var/tmp/trios-max-build}"

exec "$HERE/build/build-iso.sh"
