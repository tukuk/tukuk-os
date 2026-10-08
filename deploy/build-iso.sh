#!/usr/bin/env bash
# ==============================================================================
# Script to build bootable Tukuk-OS Server ISO (Ubuntu 24.04 LTS Autoinstall)
# ==============================================================================

set -euo pipefail

ISO_NAME="tukuk-os-server-24.04.iso"
SRC_URL="https://releases.ubuntu.com/24.04/ubuntu-24.04.1-live-server-amd64.iso"
WORK_DIR="/tmp/tukuk-iso-builder"

echo "=== Tukuk-OS ISO Image Builder ==="

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root or with sudo to build the ISO."
  exit 1
fi

echo "Installing ISO mastering tools (xorriso, p7zip-full, isolinux)..."
apt-get update -y
apt-get install -y xorriso p7zip-full isolinux wget curl

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

if [[ ! -f "ubuntu-base.iso" ]]; then
  echo "Downloading base Ubuntu 24.04 server ISO..."
  wget -O ubuntu-base.iso "$SRC_URL"
fi

echo "Extracting base ISO..."
rm -rf iso-extract
7z x ubuntu-base.iso -oiso-extract

echo "Injecting Tukuk-OS Autoinstall configurations..."
mkdir -p iso-extract/nocloud
cp "$(dirname "$0")/autoinstall/user-data" iso-extract/nocloud/user-data
cp "$(dirname "$0")/autoinstall/meta-data" iso-extract/nocloud/meta-data

# Update grub menu to boot automatically into Tukuk-OS autoinstall
if [[ -f "iso-extract/boot/grub/grub.cfg" ]]; then
  sed -i 's|set timeout=30|set timeout=5|g' iso-extract/boot/grub/grub.cfg
  sed -i 's|---$| autoinstall ds=nocloud\\;s=/cdrom/nocloud/ ---|g' iso-extract/boot/grub/grub.cfg
fi

echo "Repackaging into bootable ISO: $ISO_NAME..."
xorriso -as mkisofs -r \
  -V "TUKUK_OS_SERVER" \
  -o "/tmp/$ISO_NAME" \
  -J -l -b isolinux/isolinux.bin -c isolinux/boot.cat \
  -no-emul-boot -boot-load-size 4 -boot-info-table \
  -eltorito-alt-boot -e boot/grub/efi.img -no-emul-boot \
  -isohybrid-gpt-basdat \
  iso-extract

echo ""
echo "================================================================"
echo "✓ Success! Bootable ISO created: /tmp/$ISO_NAME"
echo "You can now write this image to a USB stick using Rufus or BalenaEtcher:"
echo "dd if=/tmp/$ISO_NAME of=/dev/sdX bs=4M status=progress && sync"
echo "================================================================"
