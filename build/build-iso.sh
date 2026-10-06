#!/bin/bash
# Builds TrimangeesOS.iso. Run as root on Ubuntu 22.04/24.04.
#   sudo ./build/build-iso.sh            full build (xz, smallest)
#   FAST=1 sudo ./build/build-iso.sh     quick build (zstd) for testing
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-/var/tmp/trios-build}"
OUT="${OUT:-$HERE/out}"
MIRROR="${MIRROR:-http://archive.ubuntu.com/ubuntu}"
ELECTRON_VERSION="${ELECTRON_VERSION:-33.4.11}"
VOLID="TRIMANGEESOS"
ROOT="$WORK/rootfs"
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }

cleanup() {
  set +e
  for m in dev/pts dev proc sys run; do umount -lf "$ROOT/$m" 2>/dev/null; done
}
trap cleanup EXIT

mkdir -p "$WORK" "$OUT"
if [ ! -f "$ROOT/.bootstrapped" ]; then
  echo "### debootstrap"
  rm -rf "$ROOT"; mkdir -p "$ROOT"
  debootstrap --variant=minbase --arch=amd64 \
    --include=ca-certificates,gnupg noble "$ROOT" "$MIRROR"
  touch "$ROOT/.bootstrapped"
fi

for m in proc sys dev dev/pts run; do mountpoint -q "$ROOT/$m" || mount --bind "/$m" "$ROOT/$m"; done
cp /etc/resolv.conf "$ROOT/etc/resolv.conf" 2>/dev/null || true
# pass proxy settings through if present (not needed on GitHub runners)
cp "$HERE/build/chroot-setup.sh" "$ROOT/root/chroot-setup.sh"
if [ ! -f "$ROOT/.setup-done" ]; then
  echo "### chroot setup (this is the long part)"
  chroot "$ROOT" env MIRROR="$MIRROR" bash /root/chroot-setup.sh
  touch "$ROOT/.setup-done"
fi

echo "### electron $ELECTRON_VERSION"
EL="$WORK/electron-$ELECTRON_VERSION"
if [ ! -d "$EL/dist" ]; then
  mkdir -p "$EL"; ( cd "$EL" && npm init -y >/dev/null && npm i --no-audit --no-fund "electron@$ELECTRON_VERSION" )
  mkdir -p "$EL/dist"; cp -a "$EL/node_modules/electron/dist/." "$EL/dist/"
fi
rm -rf "$ROOT/opt/trimangees"; mkdir -p "$ROOT/opt/trimangees"
cp -a "$EL/dist" "$ROOT/opt/trimangees/electron"
rsync -a --chown=0:0 --exclude node_modules --exclude 'test*' "$HERE/shell/" "$ROOT/opt/trimangees/shell/"

echo "### system overlay"
rsync -a --chown=0:0 "$HERE/system/" "$ROOT/"
chown -R 0:0 "$ROOT/etc/sudoers.d" "$ROOT/usr/local" "$ROOT/opt/trimangees"
chmod 755 "$ROOT"/usr/local/bin/trimangees-* "$ROOT/usr/local/sbin/trifs"
chmod 440 "$ROOT/etc/sudoers.d/trimangees"
chmod 4755 "$ROOT/opt/trimangees/electron/chrome-sandbox" 2>/dev/null || true
chroot "$ROOT" bash -c 'systemctl enable trifs-mount.service trimangees-session.service NetworkManager 2>&1 | tail -3; systemctl set-default graphical.target; hostname >/dev/null' || true
chroot "$ROOT" update-initramfs -u -k all

echo "### clean"
chroot "$ROOT" apt-get clean
rm -rf "$ROOT"/var/lib/apt/lists/* "$ROOT"/tmp/* "$ROOT"/root/chroot-setup.sh "$ROOT"/var/cache/apt/*.bin
: > "$ROOT/etc/machine-id"

echo "### iso tree"
ISO="$WORK/iso"; rm -rf "$ISO"; mkdir -p "$ISO/live" "$ISO/boot/grub"
KERNEL=$(ls "$ROOT"/boot/vmlinuz-* | sort -V | tail -1)
INITRD=$(ls "$ROOT"/boot/initrd.img-* | sort -V | tail -1)
cp "$KERNEL" "$ISO/live/vmlinuz"; cp "$INITRD" "$ISO/live/initrd.img"
cp "$HERE/build/grub.cfg" "$ISO/boot/grub/grub.cfg"

echo "### squashfs"
if [ "${FAST:-0}" = 1 ]; then COMP="-comp zstd -Xcompression-level 3"; else COMP="-comp xz -Xbcj x86 -b 1M"; fi
cleanup
mksquashfs "$ROOT" "$ISO/live/filesystem.squashfs" $COMP -noappend -no-progress \
  -e boot/vmlinuz* boot/initrd.img* .bootstrapped .setup-done

echo "### grub-mkrescue"
ISOFILE="$OUT/TrimangeesOS.iso"
grub-mkrescue -o "$ISOFILE" "$ISO" -volid "$VOLID" 2>&1 | tail -5
( cd "$OUT" && sha256sum TrimangeesOS.iso > TrimangeesOS.iso.sha256 )
SIZE=$(stat -c %s "$ISOFILE")
echo "ISO size: $((SIZE/1024/1024)) MB"
if [ "$SIZE" -gt 1900000000 ]; then
  echo "### splitting (over 1.9 GB)"; split -b 1900000000 -d -a 2 "$ISOFILE" "$ISOFILE.part"; rm "$ISOFILE"
fi
echo "DONE"
