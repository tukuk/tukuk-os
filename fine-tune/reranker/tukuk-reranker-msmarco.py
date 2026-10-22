# ─────────────────────────────────────────────────────────────────────────────
# Tukuk-OS Reranker — FULLY OFFLINE fine-tune (no internet) on a Kaggle GPU.
#
# Use the PRE-INSTALLED libraries in the Kaggle image (torch, transformers,
# datasets — no pip). Inputs are mounted as Kaggle sources (no HF download needed):
#   • Base model : johnsonhk88/cross-encoderms-marco-minilm-l-6-v2 (v1/Transformers)
#   • Dataset    : parthplc/ms-marco-dataset → train.csv [answers,query,finalpassage]
#
# Training: a BINARY cross-encoder (query+relevant passage = 1 ; query+random passage = 0),
# BCEWithLogitsLoss. Export ONNX via torch.onnx (not optimum) + copy the tokenizer files
# so Node (@huggingface/transformers AutoModelForSequenceClassification) can load them.
#
# Output (/kaggle/working/tukuk-reranker/):
#   config.json tokenizer.json tokenizer_config.json special_tokens_map.json vocab.txt
#   onnx/model.onnx  (fp32 — input names: input_ids, attention_mask, token_type_ids)
#
# Note: MAX_ROWS is low (=2000) for PIPELINE VALIDATION (runs ~1 min). Raise it to
# ~120000 for the real model once the ONNX export is confirmed loadable in Node.
#
# ── GPU note: if the Kaggle account has not accepted the "GPU rules", the kernel
# silently falls to CPU (device=cpu). For a full run, make sure GPU is active in the
# Kaggle UI or cap MAX_ROWS (~40k) so it fits within the CPU session time limit.
# ─────────────────────────────────────────────────────────────────────────────
import os
import csv
import glob
import random

import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForSequenceClassification

MAX_ROWS = int(os.environ.get("MAX_ROWS", "2000"))   # ← VALIDATION=2000; full=120000
EPOCHS = int(os.environ.get("EPOCHS", "1"))
BATCH = int(os.environ.get("BATCH_SIZE", "32"))
LR = float(os.environ.get("LEARNING_RATE", "2e-5"))
MAX_LEN = int(os.environ.get("MAX_LENGTH", "256"))
OPSET = 17
SEED = 42
OUT_DIR = "/kaggle/working/tukuk-reranker"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
print(f"[tukuk] device={DEVICE} MAX_ROWS={MAX_ROWS} epochs={EPOCHS} batch={BATCH}", flush=True)


def find_model_dir():
    for cfg in glob.glob("/kaggle/input/**/config.json", recursive=True):
        d = os.path.dirname(cfg)
        if os.path.exists(os.path.join(d, "tokenizer.json")) or os.path.exists(os.path.join(d, "vocab.txt")):
            return d
    raise SystemExit("[tukuk] fail: base model directory not found under /kaggle/input")


def find_train_csv():
    for p in glob.glob("/kaggle/input/**/train.csv", recursive=True):
        return p
    raise SystemExit("[tukuk] fail: train.csv not found under /kaggle/input")


MODEL_DIR = find_model_dir()
TRAIN_CSV = find_train_csv()
print(f"[tukuk] model_dir = {MODEL_DIR}", flush=True)
print(f"[tukuk] train_csv = {TRAIN_CSV}", flush=True)

tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)

# ── Read (query, relevant passage) then generate binary pairs with random negatives ──
pos = []  # (query, passage)
with open(TRAIN_CSV, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if len(pos) >= MAX_ROWS:
            break
        q = (row.get("query") or "").strip()
        p = (row.get("finalpassage") or "").strip()
        if not q or len(p) < 20:
            continue
        pos.append((q, p))
if len(pos) < 50:
    raise SystemExit(f"[tukuk] fail: too few pairs ({len(pos)})")
print(f"[tukuk] read {len(pos)} POSITIVE pairs", flush=True)

samples = []
for i, (q, p) in enumerate(pos):  # positive label 1
    samples.append((q, p, 1.0))
passages = [p for _, p in pos]
for q, _ in pos:                   # negative label 0: another random passage
    other = passages[random.randrange(len(passages))]
    samples.append((q, other, 0.0))
random.shuffle(samples)
print(f"[tukuk] {len(samples)} training pairs (pos+neg)", flush=True)


class PairDS(Dataset):
    def __init__(self, data):
        self.data = data

    def __len__(self):
        return len(self.data)

    def __getitem__(self, i):
        q, p, y = self.data[i]
        return {"q": q, "p": p, "y": y}


def collate(batch):
    enc = tokenizer(
        [b["q"] for b in batch], [b["p"] for b in batch],
        padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt"
    )
    enc["labels"] = torch.tensor([b["y"] for b in batch], dtype=torch.float32)
    return enc


model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR, num_labels=1)
model.to(DEVICE)
loss_fn = torch.nn.BCEWithLogitsLoss()
opt = torch.optim.AdamW(model.parameters(), lr=LR)
loader = DataLoader(PairDS(samples), batch_size=BATCH, shuffle=True, collate_fn=collate)

model.train()
step = 0
running = 0.0
for batch in loader:
    batch = {k: v.to(DEVICE) for k, v in batch.items()}
    labels = batch.pop("labels")
    logits = model(**batch).logits.view(-1)
    loss = loss_fn(logits, labels)
    opt.zero_grad(); loss.backward(); opt.step()
    running += float(loss.item()); step += 1
    if step % 25 == 0 or step == len(loader):
        print(f"[tukuk] step {step}/{len(loader)} loss={running/step:.4f}", flush=True)

# ── Sanity: does the model distinguish positive vs negative? ──
model.eval()
with torch.no_grad():
    probe = samples[:256]
    e = tokenizer([a for a, _, _ in probe], [b for _, b, _ in probe], padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt").to(DEVICE)
    sc = model(**e).logits.view(-1).cpu().numpy()
    ys = np.array([c for _, _, c in probe])
    acc = float(np.mean((sc > 0.0) == (ys > 0.5)))
    print(f"[tukuk] sanity accuracy = {acc:.3f} (expect > 0.7 after training)", flush=True)


class ForONNX(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, input_ids, attention_mask, token_type_ids):
        return self.m(input_ids=input_ids, attention_mask=attention_mask, token_type_ids=token_type_ids).logits


os.makedirs(os.path.join(OUT_DIR, "onnx"), exist_ok=True)
wrapper = ForONNX(model).eval()
dummy = tokenizer(["how are you"], ["i am fine"], padding="max_length", truncation=True, max_length=32, return_tensors="pt")
onnx_path = os.path.join(OUT_DIR, "onnx", "model.onnx")
torch.onnx.export(
    wrapper,
    (dummy["input_ids"], dummy["attention_mask"], dummy.get("token_type_ids", torch.zeros_like(dummy["input_ids"]))),
    onnx_path,
    dynamo=False,          # torch 2.9+ defaults to the new (dynamo) exporter which
                           # needs `onnxscript` — NOT in the offline Kaggle image.
                           # The legacy TorchScript exporter needs no extra dep.
    opset_version=OPSET,
    input_names=["input_ids", "attention_mask", "token_type_ids"],
    output_names=["logits"],
    dynamic_axes={
        "input_ids": {0: "batch", 1: "sequence"},
        "attention_mask": {0: "batch", 1: "sequence"},
        "token_type_ids": {0: "batch", 1: "sequence"},
        "logits": {0: "batch"},
    },
)
print(f"[tukuk] ONNX written → {onnx_path} ({os.path.getsize(onnx_path)} bytes)", flush=True)

# ── Copy tokenizer/config files so Node can load this model ──
import shutil
for fname in ["config.json", "tokenizer.json", "tokenizer_config.json",
              "special_tokens_map.json", "vocab.txt", "merges.txt"]:
    src = os.path.join(MODEL_DIR, fname)
    if os.path.exists(src):
        shutil.copy(src, os.path.join(OUT_DIR, fname))

for root, _dirs, files in os.walk(OUT_DIR):
    for f in files:
        p = os.path.join(root, f)
        print(f"[tukuk] output: {os.path.relpath(p, OUT_DIR)} ({os.path.getsize(p)} bytes)", flush=True)

print("[tukuk] DONE — the ONNX files are now in the kernel output.", flush=True)
