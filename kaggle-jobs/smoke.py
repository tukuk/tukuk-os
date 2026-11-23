# smoke.py — proof-of-work job for kaggle-gpu-burst.sh: is a GPU actually
# granted and the environment ready? Small output only (a concise file).
# Runs on Kaggle (not our server) via: kaggle kernels push.
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

out_dir = "/kaggle/working"
info = {
    "waktu": datetime.now(timezone.utc).isoformat(),
    "python": sys.version.split()[0],
    "cuda_smi": None,
    "torch": None,
}

try:
    smi = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
        capture_output=True, text=True, timeout=30,
    )
    info["cuda_smi"] = smi.stdout.strip() or smi.stderr.strip()[:200]
except Exception as e:  # noqa: BLE001
    info["cuda_smi"] = "nvidia-smi failed: %s" % e

try:
    import torch
    info["torch"] = {
        "versi": torch.__version__,
        "cuda_sedia": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }
    # real GPU work so the burst is proven to work end to end
    import time
    x = torch.rand(1024, 1024, device="cuda" if torch.cuda.is_available() else "cpu")
    t0 = time.perf_counter()
    _ = (x @ x).sum().item()
    torch.cuda.synchronize() if torch.cuda.is_available() else None
    info["matriks_1024_ms"] = round((time.perf_counter() - t0) * 1000, 1)
except Exception as e:  # noqa: BLE001
    info["torch"] = "none/error: %s" % e

with open(os.path.join(out_dir, "smoke.json"), "w", encoding="utf-8") as f:
    json.dump(info, f, ensure_ascii=False, indent=2)
print(json.dumps(info, ensure_ascii=False))
