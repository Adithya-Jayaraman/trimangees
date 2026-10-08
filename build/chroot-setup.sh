#!/bin/bash
# Runs INSIDE the new system (chroot) to install and configure everything.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive LC_ALL=C LANG=C
export APT_LISTCHANGES_FRONTEND=none

say() { echo; echo "######## $*"; }
APT="apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold"

say "apt sources"
dpkg --add-architecture i386
cat > /etc/apt/sources.list <<SRC
deb ${MIRROR} noble main universe multiverse restricted
deb ${MIRROR} noble-updates main universe multiverse restricted
deb http://security.ubuntu.com/ubuntu noble-security main universe multiverse restricted
SRC
rm -f /etc/apt/sources.list.d/*.sources 2>/dev/null || true
# no snaps, no auto-upgrades, no docs
cat > /etc/apt/apt.conf.d/99trimangees <<'APTC'
APT::Install-Recommends "false";
APT::Install-Suggests "false";
Acquire::Languages "none";
APTC
cat > /etc/dpkg/dpkg.cfg.d/99trimangees <<'DPKGC'
path-exclude=/usr/share/doc/*
path-exclude=/usr/share/man/*
path-exclude=/usr/share/info/*
path-include=/usr/share/doc/*/copyright
DPKGC
# make sure policy-rc.d does not start services inside the chroot
printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; chmod +x /usr/sbin/policy-rc.d

$APT update
$APT install ca-certificates curl wget gnupg

say "base system"
$APT install systemd-sysv systemd-resolved udev dbus dbus-user-session sudo kmod initramfs-tools \
     locales tzdata bash-completion nano less file unzip zip p7zip-full xz-utils procps psmisc lsof \
     iproute2 iputils-ping pciutils usbutils htop rsync cpio

say "live-boot (boots from the ISO) + kernel"
$APT install live-boot live-boot-initramfs-tools
$APT install linux-image-generic linux-modules-extra-$(ls /lib/modules | head -1 2>/dev/null || echo generic) 2>/dev/null \
  || $APT install linux-image-generic
$APT install linux-firmware

say "disks and filesystems (TriFS)"
$APT install e2fsprogs ntfs-3g exfatprogs dosfstools parted gdisk util-linux jq fuse3 libfuse2t64

say "graphics, input, window manager"
$APT install xserver-xorg-core xserver-xorg-input-libinput xserver-xorg-video-all xserver-xorg-video-vmware \
     xinit xauth x11-xserver-utils x11-utils xkb-data x11-xkb-utils xdotool wmctrl openbox \
     libgl1-mesa-dri mesa-vulkan-drivers libvulkan1 libglx-mesa0 xdg-utils

say "libraries the Electron desktop needs"
$APT install libgtk-3-0t64 libnss3 libxss1 libasound2t64 libgbm1 libxtst6 libatk-bridge2.0-0t64 libatk1.0-0t64 \
     libcups2t64 libdrm2 libxkbcommon0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 \
     libpango-1.0-0 libcairo2 libnotify4 libsecret-1-0 libdbus-1-3 libglib2.0-0t64 libexpat1

say "sound"
$APT install pulseaudio pulseaudio-utils alsa-utils libasound2-plugins

say "fonts"
$APT install fonts-inter fonts-jetbrains-mono fonts-dejavu-core fonts-liberation2 fonts-noto-core fonts-noto-color-emoji
$APT install xterm x11-utils

say "extra tools: Flatpak app store, boot screen, archive tools"
$APT install flatpak zstd zip unzip p7zip-full plymouth plymouth-label xvfb || echo "WARNING: some extra tools did not install"
mkdir -p /etc/sysctl.d
printf 'kernel.apparmor_restrict_unprivileged_userns=0\nkernel.unprivileged_userns_clone=1\n' > /etc/sysctl.d/99-trimangees.conf

say "network"
$APT install network-manager network-manager-gnome- 2>/dev/null || $APT install network-manager

say "VirtualBox guest tools (mouse, resize, clipboard)"
$APT install virtualbox-guest-utils virtualbox-guest-x11 || echo "WARNING: VirtualBox guest tools did not install"

say "Wine: Windows programs (64-bit + 32-bit)"
$APT install wine wine64 wine32:i386 libwine libwine:i386 fonts-wine cabextract winetricks \
     libgl1:i386 libgl1-mesa-dri:i386 libpulse0:i386 libasound2-plugins:i386 libgnutls30t64:i386 \
     libvulkan1:i386 mesa-vulkan-drivers:i386 libxrandr2:i386 libxcomposite1:i386 libxi6:i386 libfreetype6:i386

say "Wine add-ons (.NET replacement + web engine) so installers do not stop to ask"
fetch() { curl -fL --retry 3 --connect-timeout 20 -o "$2" "$1" && echo "got $(basename "$2")" || { echo "WARNING: could not download $1"; rm -f "$2"; }; }
mkdir -p /usr/share/wine/mono /usr/share/wine/gecko
fetch https://dl.winehq.org/wine/wine-mono/9.0.0/wine-mono-9.0.0-x86.msi      /usr/share/wine/mono/wine-mono-9.0.0-x86.msi
fetch https://dl.winehq.org/wine/wine-gecko/2.47.4/wine-gecko-2.47.4-x86.msi    /usr/share/wine/gecko/wine-gecko-2.47.4-x86.msi
fetch https://dl.winehq.org/wine/wine-gecko/2.47.4/wine-gecko-2.47.4-x86_64.msi /usr/share/wine/gecko/wine-gecko-2.47.4-x86_64.msi

say "Google Chrome (real browser, Google sign-in works)"
if curl -fL --retry 3 --connect-timeout 20 -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb; then
  $APT install /tmp/chrome.deb || echo "WARNING: Chrome did not install"
  rm -f /tmp/chrome.deb /etc/apt/sources.list.d/google-chrome* /etc/default/google-chrome
else
  echo "WARNING: could not download Chrome (the Trimangees Browser still works)"
fi

say "Windows environment template (copied for each user, so the first .exe starts fast)"
TPL=/opt/trimangees/wineprefix-template
mkdir -p /opt/trimangees
id trimangees >/dev/null 2>&1 || useradd -u 1000 -U -d /var/lib/trimangees -m -s /bin/bash trimangees
mkdir -p "$TPL"; chown -R trimangees:trimangees "$TPL" /var/lib/trimangees
timeout 600 su trimangees -c "export HOME=/var/lib/trimangees WINEPREFIX=$TPL WINEARCH=win64 WINEDEBUG=-all WINEDLLOVERRIDES='winemenubuilder.exe=d'; xvfb-run -a wineboot -i" >/tmp/wineprefix.log 2>&1 \
  && echo "wine prefix template ready" || { echo "WARNING: wine prefix template not built"; tail -5 /tmp/wineprefix.log; }
chown -R root:root "$TPL" 2>/dev/null; chmod -R a+rX "$TPL" 2>/dev/null
rm -f /tmp/wineprefix.log

say "the desktop user"
getent group vboxsf >/dev/null || groupadd -r vboxsf
for g in audio video plugdev netdev input render fuse; do getent group $g >/dev/null || groupadd -r $g; done
id trimangees >/dev/null 2>&1 || useradd -u 1000 -U -d /var/lib/trimangees -m -s /bin/bash \
    -G audio,video,plugdev,netdev,input,render,vboxsf trimangees
echo 'trimangees:trimangees' | chpasswd          # for the emergency console (Ctrl+Alt+F2)
mkdir -p /home/Adithya /home/Tarun /home/Arjun /trifs/home /trifs/Applications /trifs/shared /trifs/system /mnt/host /var/log/trimangees
chown trimangees:trimangees /home/Adithya /home/Tarun /home/Arjun /var/log/trimangees /var/lib/trimangees
chown trimangees:trimangees /trifs /trifs/home /trifs/Applications /trifs/shared /trifs/system
chmod 0440 /etc/sudoers.d/trimangees 2>/dev/null || true

say "locale, time zone, hostname"
sed -i 's/^# *\(en_US.UTF-8\)/\1/; s/^# *\(en_IN\)/\1/' /etc/locale.gen
grep -q '^en_US.UTF-8' /etc/locale.gen || echo 'en_US.UTF-8 UTF-8' >> /etc/locale.gen
grep -q '^en_IN' /etc/locale.gen || echo 'en_IN UTF-8' >> /etc/locale.gen
locale-gen
update-locale LANG=en_IN.UTF-8
ln -sf /usr/share/zoneinfo/Asia/Kolkata /etc/localtime
echo Asia/Kolkata > /etc/timezone
echo trimangees > /etc/hostname
printf '127.0.0.1 localhost\n127.0.1.1 trimangees\n' > /etc/hosts
[ -f /etc/os-release.trimangees ] && mv /etc/os-release.trimangees /usr/lib/os-release.trimangees

say "services"
systemctl set-default graphical.target
systemctl enable trifs-mount.service trimangees-session.service NetworkManager.service systemd-resolved.service || true
systemctl disable NetworkManager-wait-online.service systemd-networkd-wait-online.service 2>/dev/null || true
systemctl mask NetworkManager-wait-online.service systemd-networkd-wait-online.service plymouth-read-write.service 2>/dev/null || true
systemctl mask apt-daily.timer apt-daily-upgrade.timer motd-news.timer e2scrub_all.timer fstrim.timer \
    ModemManager.service snapd.service snapd.socket cloud-init.service 2>/dev/null || true
systemctl enable virtualbox-guest-utils.service 2>/dev/null || true
# the emergency console on tty2 (Ctrl+Alt+F2) stays available
systemctl enable getty@tty2.service 2>/dev/null || true
rm -f /etc/resolv.conf; ln -s /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf 2>/dev/null || true

say "initramfs (with live-boot)"
update-initramfs -c -k all

say "clean up"
rm -f /usr/sbin/policy-rc.d
apt-get clean
rm -rf /var/lib/apt/lists/* /var/cache/apt/* /tmp/* /var/tmp/* /root/.cache
find /var/log -type f -exec truncate -s 0 {} \;
: > /etc/machine-id
rm -f /var/lib/dbus/machine-id
echo "chroot setup finished OK"
