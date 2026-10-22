# ─────────────────────────────────────────────────────────────────────────────
# PROBE (no internet, no GPU): report what ALREADY exists in the Kaggle
# image offline, so we know whether an offline-viable recipe works.
# ─────────────────────────────────────────────────────────────────────────────
import importlib
import os
import socket

print("=== python ===", os.sys.version.split()[0], flush=True)

mods = [
    "numpy", "torch", "transformers", "tokenizers", "datasets",
    "sentence_transformers", "optimum", "onnx", "onnxruntime",
    "sklearn", "scipy",
]
for m in mods:
    try:
        mod = importlib.import_module(m)
        print(f"OK   {m} == {getattr(mod, '__version__', '?')}", flush=True)
    except Exception as e:
        print(f"MISS {m}: {type(e).__name__}: {str(e)[:80]}", flush=True)

# Is an HF model cache (offline) already present?
for base in ["/root/.cache/huggingface", os.path.expanduser("~/.cache/huggingface")]:
    if os.path.isdir(base):
        for kind in ("hub", "datasets"):
            d = os.path.join(base, kind)
            if os.path.isdir(d):
                print(f"CACHE {d}: {sorted(os.listdir(d))[:15]}", flush=True)

# Quick DNS test (expected to FAIL when the internet is off).
try:
    socket.getaddrinfo("pypi.org", 443)
    print("DNS   pypi.org: OK (internet present)", flush=True)
except Exception as e:
    print(f"DNS   pypi.org: FAIL ({e})", flush=True)

print("=== probe done ===", flush=True)
