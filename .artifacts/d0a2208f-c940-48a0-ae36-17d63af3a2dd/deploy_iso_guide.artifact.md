# Tukuk-OS Server ISO & Lightweight Infrastructure Guide

This guide covers the **Tukuk-OS Server ISO** build pipeline, optimized specifically for low-RAM servers (such as 2GB RAM instances), along with integration strategies for Unity Cloud games and Kaggle CLI workflows.

---

## 1. Building the Tukuk-OS Server ISO

The repository includes an automated autoinstall script for Ubuntu 24.04 LTS Server that provisions a fully working Tukuk-OS node with zero user intervention during installation.

### Prerequisites (Build Machine / Laptop)
- Linux environment with `sudo` privileges
- Packages: `xorriso`, `p7zip-full`, `isolinux`, `wget`, `curl`

### Build Command
Run the build script to generate the bootable ISO:
```bash
sudo ./deploy/build-iso.sh
```

**Output:** `/tmp/tukuk-os-server-24.04.iso`

### Flashing & Installing
1. Write the ISO to a USB flash drive using Rufus (Windows) or BalenaEtcher / `dd` (Linux/Mac):
   ```bash
   sudo dd if=/tmp/tukuk-os-server-24.04.iso of=/dev/sdX bs=4M status=progress && sync
   ```
2. Boot any server or old PC from the USB. The Ubuntu autoinstall will automatically format the disk, install the system, configure ZRAM, install Node.js 22, clone Tukuk-OS to `/opt/tukuk-os`, and start it as a systemd service on port `3000`.

---

## 2. 2GB RAM Optimization (ZRAM & Node.js Tuning)

On a 2GB RAM server, memory management is critical to prevent OOM (Out Of Memory) crashes:
- **ZRAM Swap:** Compresses RAM into a fast in-memory swap partition (`ALGO=zstd`, `PERCENT=75`), effectively giving you ~3.5GB–4GB of virtual RAM.
- **Node.js Memory Limit:** Set in `tukuk-os.service` via `NODE_OPTIONS="--max-old-space-size=768"`, capping the Node process to 768MB so the Linux kernel and disk cache always have plenty of headroom.

---

## 3. Future Roadmap & Integrations

### A. 1 App / Feature per Day
- Easily publish new modules by adding routes in `src/server.js` or static pages in `public/`.
- Use the built-in Admin GUI (`/admin`) to manage blog posts, crawl new sites, configure ads, and run server diagnostics.

### B. Unity Cloud Game Integration
- Host Unity WebGL builds in `public/games/` or stream them via **Unity Cloud Content Delivery (CCD)**.
- Embed games seamlessly inside Tukuk-OS interactive modals or dedicated game tabs.

### C. Kaggle CLI for Heavy AI / Data Workloads
- If your local laptop RAM is limited, use the **Kaggle CLI** (`kaggle kernels push`, `kaggle datasets download`) to offload heavy data processing, scraping datasets, or model training to Kaggle's free cloud GPUs/TPUs, then pull results back into Tukuk-OS.
- Example Kaggle CLI workflow:
  ```bash
  pip install kaggle
  kaggle datasets list -s "search-index"
  ```
