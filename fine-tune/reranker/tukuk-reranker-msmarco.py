# ─────────────────────────────────────────────────────────────────────────────
# Tukuk-OS Reranker — FINE-TUNE FULLY OFFLINE (tiada internet) di Kaggle GPU.
#
# Guna libreri PRA-INSTALL imej Kaggle (torch, transformers, datasets — tiada pip).
# Input dimount sebagai sumber Kaggle (tiada muat turun HF diperlukan):
#   • Model asas : johnsonhk88/cross-encoderms-marco-minilm-l-6-v2 (v1/Transformers)
#   • Dataset    : parthplc/ms-marco-dataset → train.csv [answers,query,finalpassage]
#
# Latihan: cross-encoder BINARI (query+passage relevan = 1 ; query+passage rawak = 0),
# BCEWithLogitsLoss. Eksport ONNX guna torch.onnx (bkn optimum) + salin fail tokenizer
# supaya Node (@huggingface/transformers AutoModelForSequenceClassification) boleh muat.
#
# Keluaran (/kaggle/working/tukuk-reranker/):
#   config.json tokenizer.json tokenizer_config.json special_tokens_map.json vocab.txt
#   onnx/model.onnx  (fp32 — input names: input_ids, attention_mask, token_type_ids)
#
# Nota: MAX_ROWS rendah (=2000) untuk VALIDASI SALURAN (jalankan ~1 min). Naikkan ke
# ~120000 untuk model sebenar selepas eksport ONNX disahkan boleh dimuat di Node.
#
# ── Nota GPU: jika akaun Kaggle belum menerima "GPU rules", kernel senyap jatuh
# ke CPU (device=cpu). Untuk run penuh, pastikan GPU aktif di UI Kaggle atau
# hadkan MAX_ROWS (~40k) supaya muat dalam had masa sesi CPU.
# ─────────────────────────────────────────────────────────────────────────────
import os
import csv
import glob
import random

import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForSequenceClassification

MAX_ROWS = int(os.environ.get("MAX_ROWS", "2000"))   # ← VALIDASI=2000; penuh=120000
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
    raise SystemExit("[tukuk] fail: direktori model asas tidak ditemui dalam /kaggle/input")


def find_train_csv():
    for p in glob.glob("/kaggle/input/**/train.csv", recursive=True):
        return p
    raise SystemExit("[tukuk] fail: train.csv tidak ditemui dalam /kaggle/input")


MODEL_DIR = find_model_dir()
TRAIN_CSV = find_train_csv()
print(f"[tukuk] model_dir = {MODEL_DIR}", flush=True)
print(f"[tukuk] train_csv = {TRAIN_CSV}", flush=True)

tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)

# ── Baca (query, passage relevan) lalu jana pasangan binari dengan negatif rawak ──
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
    raise SystemExit(f"[tukuk] fail: terlalu sedikit pasangan ({len(pos)})")
print(f"[tukuk] {len(pos)} pasangan POSITIF dibaca", flush=True)

samples = []
for i, (q, p) in enumerate(pos):  # positif label 1
    samples.append((q, p, 1.0))
passages = [p for _, p in pos]
for q, _ in pos:                   # negatif label 0: passage rawak lain
    other = passages[random.randrange(len(passages))]
    samples.append((q, other, 0.0))
random.shuffle(samples)
print(f"[tukuk] {len(samples)} pasangan latihan (pos+neg)", flush=True)


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

# ── Sanity: adakah model membezakan positif vs negatif? ──
model.eval()
with torch.no_grad():
    probe = samples[:256]
    e = tokenizer([a for a, _, _ in probe], [b for _, b, _ in probe], padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt").to(DEVICE)
    sc = model(**e).logits.view(-1).cpu().numpy()
    ys = np.array([c for _, _, c in probe])
    acc = float(np.mean((sc > 0.0) == (ys > 0.5)))
    print(f"[tukuk] sanity accuracy = {acc:.3f} (jangka > 0.7 selepas latihan)", flush=True)


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
print(f"[tukuk] ONNX ditulis → {onnx_path} ({os.path.getsize(onnx_path)} bytes)", flush=True)

# ── Salin fail tokenizer/config supaya Node boleh muat model ini ──
import shutil
for fname in ["config.json", "tokenizer.json", "tokenizer_config.json",
              "special_tokens_map.json", "vocab.txt", "merges.txt"]:
    src = os.path.join(MODEL_DIR, fname)
    if os.path.exists(src):
        shutil.copy(src, os.path.join(OUT_DIR, fname))

for root, _dirs, files in os.walk(OUT_DIR):
    for f in files:
        p = os.path.join(root, f)
        print(f"[tukuk] keluaran: {os.path.relpath(p, OUT_DIR)} ({os.path.getsize(p)} bytes)", flush=True)

print("[tukuk] SELESAI — fail ONNX kini di output kernel.", flush=True)
