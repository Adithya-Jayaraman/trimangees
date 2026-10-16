#!/bin/bash
# Builds TrimangeesOS Lite — a stripped-down, pre-loaded edition that never
# reads apps out of TriFS/storage at runtime. Thin wrapper around
# build-iso.sh: same chroot-setup.sh, with extra packages and a flag file.
#   sudo ./build/build-iso-lite.sh
#   FAST=1 sudo ./build/build-iso-lite.sh     quick build for testing
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

export VOLID="TRIMANGEESLITE"
export ISONAME="TrimangeesOS-Lite"
export LITE_FLAG=1
export EXTRA_APT="${EXTRA_APT:-audacity openshot-qt nmap python3-full python3-pip python3-venv build-essential gdb git nodejs npm curl jq ffmpeg gimp vim}"
export WORK="${WORK:-/var/tmp/trios-lite-build}"

exec "$HERE/build/build-iso.sh"
