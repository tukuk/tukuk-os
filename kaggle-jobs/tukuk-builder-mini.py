# ==============================================================================
# tukuk-builder-mini.py — train OUR OWN coding model on a free Kaggle GPU and
# publish it to the Hugging Face hub.
#
#   From the server:  KAGGLE_ID=tukuk bash scripts/kaggle-gpu-burst.sh tukuk-builder-mini
#   Or one shot:      bash scripts/kaggle-train-model.sh
#
# What this kernel does (all inside Kaggle — no private data leaves the box):
#   [1] QLoRA/LoRA fine-tune of Qwen2.5-Coder-1.5B-Instruct on a PUBLIC,
#       permissively licensed instruction dataset pulled from the HF hub.
#   [2] Merge the adapter, export GGUF (f16) and quantise to Q4_K_M with llama.cpp.
#   [3] Push <user>/tukuk-builder-mini to Hugging Face: GGUF + model card +
#       metrics.json with the REAL loss / wall-clock / sha256 of this run.
#
# SECRETS: add HF_TOKEN in Kaggle → Add-ons → Secrets (write-scoped token) and
# enable it for this notebook. Without it the kernel still trains and leaves the
# GGUF in /kaggle/working; the burst script then downloads it for a manual upload
# (scripts/publish-model-hf.sh). Nothing is ever faked: when a number is unknown
# (e.g. no eval split) it is written as null, not invented.
# ==============================================================================
import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone

# ── Knobs (env overrides, all optional) ──────────────────────────────────────
BASE_MODEL = os.environ.get("BASE_MODEL", "Qwen/Qwen2.5-Coder-1.5B-Instruct")
HF_REPO = os.environ.get("HF_REPO", "tukuk/tukuk-builder-mini")
GGUF_NAME = os.environ.get("GGUF_NAME", "tukuk-builder-mini-q4_k_m.gguf")
DATASET = os.environ.get("SFT_DATASET", "iamtarun/python_code_instructions_18k_alpaca")
MAX_ROWS = int(os.environ.get("MAX_ROWS", "6000"))
EPOCHS = float(os.environ.get("EPOCHS", "2"))
MAX_SEQ = int(os.environ.get("MAX_SEQ", "1024"))
LORA_R = int(os.environ.get("LORA_R", "16"))
LORA_ALPHA = int(os.environ.get("LORA_ALPHA", "32"))
LR = float(os.environ.get("LR", "2e-4"))
BATCH = int(os.environ.get("BATCH", "2"))
GRAD_ACC = int(os.environ.get("GRAD_ACC", "8"))
SEED = int(os.environ.get("SEED", "42"))
EVAL_ROWS = int(os.environ.get("EVAL_ROWS", "200"))
QUANT = os.environ.get("QUANT", "Q4_K_M")

WORK = "/kaggle/working"
MERGED_DIR = os.path.join(WORK, "merged")
GGUF_F16 = os.path.join(WORK, "model-f16.gguf")
GGUF_OUT = os.path.join(WORK, GGUF_NAME)


def log(msg):
    print(f"[tukuk] {msg}", flush=True)


def hf_token():
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_KEY") or ""
    if tok:
        return tok.strip()
    try:  # Kaggle secret store (Add-ons → Secrets → HF_TOKEN)
        from kaggle_secrets import UserSecretsClient

        return (UserSecretsClient().get_secret("HF_TOKEN") or "").strip()
    except Exception:
        return ""


def sha256(path, chunk=8 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def gpu_name():
    try:
        import torch

        return torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    except Exception:
        return "unknown"


def run(cmd, cwd=None, env=None, check=True):
    log("$ " + " ".join(cmd) if isinstance(cmd, list) else str(cmd))
    merged = dict(os.environ, **(env or {}))
    proc = subprocess.run(cmd, cwd=cwd, env=merged, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    tail = "\n".join(proc.stdout.strip().splitlines()[-25:])
    if tail:
        print(tail, flush=True)
    if check and proc.returncode != 0:
        raise RuntimeError(f"command failed ({proc.returncode}): {cmd}")
    return proc


# ── [0] Environment ──────────────────────────────────────────────────────────
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")

run([sys.executable, "-m", "pip", "install", "-q", "--upgrade",
     "transformers>=4.44", "peft>=0.12", "datasets>=2.20", "accelerate>=0.33",
     "huggingface_hub>=0.24", "sentencepiece", "protobuf"])

import torch  # noqa: E402
from datasets import load_dataset  # noqa: E402
from peft import LoraConfig, TaskType, get_peft_model  # noqa: E402
from transformers import (AutoModelForCausalLM, AutoTokenizer, DataCollatorForLanguageModeling,
                          Trainer, TrainingArguments)  # noqa: E402

random.seed(SEED)
torch.manual_seed(SEED)
started = time.time()
log(f"gpu={gpu_name()} torch={torch.__version__} cuda={torch.cuda.is_available()}")
if not torch.cuda.is_available():
    log("WARNING: no GPU — this job will be extremely slow (the burst script should prevent this).")

# ── [1a] Dataset (PUBLIC only) ───────────────────────────────────────────────
# Licensing note: the private Tukuk-OS corpus is NEVER uploaded to Kaggle. This job
# trains only on a public, permissively licensed instruction set pulled from the hub.
log(f"dataset={DATASET}")
if DATASET.endswith(".json") or DATASET.endswith(".jsonl"):
    raw = load_dataset("json", data_files=DATASET, split="train")
else:
    raw = load_dataset(DATASET, split="train")
raw = raw.shuffle(seed=SEED)
train_rows = raw.select(range(min(MAX_ROWS, len(raw))))
eval_rows = None
if EVAL_ROWS > 0 and len(raw) > MAX_ROWS + EVAL_ROWS:
    eval_rows = raw.select(range(MAX_ROWS, MAX_ROWS + EVAL_ROWS))
log(f"rows: train={len(train_rows)} eval={0 if eval_rows is None else len(eval_rows)}")


def to_text(rec):
    """Normalise a record into one chat-templated string."""
    instruction = rec.get("instruction") or rec.get("prompt") or rec.get("question") or ""
    context = rec.get("input") or rec.get("context") or ""
    answer = rec.get("output") or rec.get("response") or rec.get("answer") or ""
    user = instruction.strip()
    if context.strip():
        user = f"{user}\n\n{context.strip()}"
    return [{"role": "user", "content": user},
            {"role": "assistant", "content": str(answer).strip()}]


tok = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
if tok.pad_token is None:
    tok.pad_token = tok.eos_token


def encode(rec):
    msgs = to_text(rec)
    if hasattr(tok, "apply_chat_template"):
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
    else:  # pragma: no cover - every modern base has a chat template
        text = f"User: {msgs[0]['content']}\nAssistant: {msgs[1]['content']}"
    ids = tok(text, truncation=True, max_length=MAX_SEQ)
    ids["labels"] = list(ids["input_ids"])
    return ids


train_ds = train_rows.map(encode, remove_columns=train_rows.column_names)
eval_ds = eval_rows.map(encode, remove_columns=eval_rows.column_names) if eval_rows else None

# ── [1b] LoRA fine-tune ──────────────────────────────────────────────────────
log(f"loading {BASE_MODEL}")
model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    device_map="auto" if torch.cuda.is_available() else None,
    trust_remote_code=True,
)
model.config.use_cache = False
lora = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=LORA_R,
    lora_alpha=LORA_ALPHA,
    lora_dropout=0.05,
    bias="none",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
)
model = get_peft_model(model, lora)
model.print_trainable_parameters()

args = TrainingArguments(
    output_dir=os.path.join(WORK, "checkpoints"),
    num_train_epochs=EPOCHS,
    per_device_train_batch_size=BATCH,
    gradient_accumulation_steps=GRAD_ACC,
    learning_rate=LR,
    lr_scheduler_type="cosine",
    warmup_ratio=0.03,
    logging_steps=20,
    save_strategy="no",
    eval_strategy="no",
    fp16=bool(torch.cuda.is_available()),
    optim="adamw_torch",
    report_to=[],
    seed=SEED,
    dataloader_num_workers=2,
)
trainer = Trainer(
    model=model,
    args=args,
    train_dataset=train_ds,
    eval_dataset=eval_ds,
    data_collator=DataCollatorForLanguageModeling(tokenizer=tok, mlm=False),
)
log("training…")
train_result = trainer.train()
train_loss = float(train_result.training_loss)
train_seconds = float(train_result.metrics.get("train_runtime") or (time.time() - started))
log(f"train_loss={train_loss:.4f} in {train_seconds/60:.1f} min")

eval_loss = None
if eval_ds is not None:
    try:
        metrics = trainer.evaluate()
        eval_loss = float(metrics.get("eval_loss"))
        log(f"eval_loss={eval_loss:.4f}")
    except Exception as exc:  # never fake it
        log(f"eval failed: {exc}")

# ── [2a] Merge the adapter ───────────────────────────────────────────────────
log("merging adapter")
merged = model.merge_and_unload()
merged.save_pretrained(MERGED_DIR, safe_serialization=True)
tok.save_pretrained(MERGED_DIR)

# A few REAL generations so the card shows what the model actually says.
probe_prompts = [
    "Write a Python function that retries an HTTP request with exponential backoff.",
    "Explain the difference between git merge and git rebase in 3 sentences.",
]
samples = []
try:
    merged.eval()
    probe_tok = AutoTokenizer.from_pretrained(MERGED_DIR)
    for prompt in probe_prompts:
        ids = probe_tok.apply_chat_template([{"role": "user", "content": prompt}],
                                            return_tensors="pt", add_generation_prompt=True).to(merged.device)
        with torch.no_grad():
            out = merged.generate(ids, max_new_tokens=160, do_sample=False, temperature=None, top_p=None)
        text = probe_tok.decode(out[0][ids.shape[-1]:], skip_special_tokens=True)
        samples.append({"prompt": prompt, "output": text.strip()})
        log(f"sample ok ({len(text)} chars)")
except Exception as exc:
    log(f"sample generation skipped: {exc}")
del merged, model, trainer
if torch.cuda.is_available():
    torch.cuda.empty_cache()

# ── [2b] GGUF export + Q4_K_M quantisation ──────────────────────────────────
LLAMA = os.path.join(WORK, "llama.cpp")
log("cloning llama.cpp (GGUF converter + quantiser)")
run(["git", "clone", "--depth", "1", "https://github.com/ggml-org/llama.cpp", LLAMA])
run([sys.executable, "-m", "pip", "install", "-q", "-r", os.path.join(LLAMA, "requirements.txt")], check=False)
run([sys.executable, os.path.join(LLAMA, "convert_hf_to_gguf.py"), MERGED_DIR,
     "--outtype", "f16", "--outfile", GGUF_F16])

build = os.path.join(LLAMA, "build")
run(["cmake", "-S", LLAMA, "-B", build, "-DGGML_NATIVE=OFF", "-DLLAMA_CURL=OFF",
     "-DLLAMA_BUILD_TESTS=OFF", "-DLLAMA_BUILD_EXAMPLES=OFF", "-DLLAMA_BUILD_SERVER=OFF"])
run(["cmake", "--build", build, "--config", "Release", "-j", "4", "--target", "llama-quantize"])
quant_bin = None
for cand in ("llama-quantize", "quantize"):
    hit = shutil.which(cand) or next(
        (p for p in [os.path.join(build, "bin", cand), os.path.join(build, cand)] if os.path.exists(p)), None)
    if hit:
        quant_bin = hit
        break
if not quant_bin:
    raise RuntimeError("llama-quantize binary not found after the build")
run([quant_bin, GGUF_F16, GGUF_OUT, QUANT])
log(f"gguf={GGUF_OUT} {os.path.getsize(GGUF_OUT)/1e6:.0f} MB")

# ── [3] Publish to Hugging Face ─────────────────────────────────────────────
metrics = {
    "model": HF_REPO,
    "base_model": BASE_MODEL,
    "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "hardware": {"gpu": gpu_name(), "cuda": bool(torch.cuda.is_available())},
    "dataset": {"name": DATASET, "train_rows": len(train_rows),
                "eval_rows": 0 if eval_rows is None else len(eval_rows), "license_note": "public dataset only"},
    "lora": {"r": LORA_R, "alpha": LORA_ALPHA, "dropout": 0.05, "targets": "all attention + MLP projections"},
    "train": {"epochs": EPOCHS, "max_seq": MAX_SEQ, "batch": BATCH, "grad_accum": GRAD_ACC,
              "lr": LR, "seed": SEED, "loss": round(train_loss, 6), "seconds": round(train_seconds, 1)},
    "eval": {"loss": None if eval_loss is None else round(eval_loss, 6)},
    "gguf": {"file": GGUF_NAME, "quant": QUANT, "sha256": sha256(GGUF_OUT),
             "size_bytes": os.path.getsize(GGUF_OUT)},
    "samples": samples,
}
with open(os.path.join(WORK, "metrics.json"), "w", encoding="utf-8") as fh:
    json.dump(metrics, fh, indent=2)
log("metrics.json written")

# Pre-computed strings keep the f-string below readable (and safe on Python 3.11).
eval_verdict = "n/a (no holdout split)" if eval_loss is None else format(eval_loss, ".4f")
gguf_sha = metrics["gguf"]["sha256"]
gguf_mb = os.path.getsize(GGUF_OUT) / 1e6

card = f"""---
license: apache-2.0
base_model: {BASE_MODEL}
library_name: gguf
language:
  - en
tags:
  - gguf
  - tukuk
  - coding
---

# {HF_REPO.split('/')[-1]}

LoRA fine-tune of **{BASE_MODEL}** produced by the Tukuk-OS training pipeline
(Kaggle GPU job `kaggle-jobs/tukuk-builder-mini.py`), exported to **{QUANT}** GGUF
for CPU inference on a small server.

## This build (measured, not estimated)

| field | value |
|---|---|
| train loss | {train_loss:.4f} |
| eval loss | {eval_verdict} |
| train rows | {len(train_rows)} ({DATASET}) |
| wall clock | {train_seconds/60:.1f} min |
| GPU | {gpu_name()} |
| GGUF size | {gguf_mb:.0f} MB |
| GGUF sha256 | `{gguf_sha}` |

Full numbers, including sample generations, are in [metrics.json](metrics.json).

## Use

```bash
# Ollama
curl -L -o {GGUF_NAME} https://huggingface.co/{HF_REPO}/resolve/main/{GGUF_NAME}
printf 'FROM ./{GGUF_NAME}\\n' > Modelfile && ollama create tukuk-builder-mini:q4 -f Modelfile
ollama run tukuk-builder-mini:q4 "write a python retry decorator"
```

## Limitations

A 1.5B model quantised to 4 bits: good for short, well-specified coding tasks; it
will be confidently wrong on long multi-file reasoning. Base-model licence applies.
"""
with open(os.path.join(WORK, "README.md"), "w", encoding="utf-8") as fh:
    fh.write(card)

token = hf_token()
if not token:
    log("HOLD: no HF_TOKEN — artifacts stay in /kaggle/working.")
    log("  Next: download them (kaggle kernels output <slug>) then publish with")
    log(f"  HF_TOKEN=hf_... bash scripts/publish-model-hf.sh {GGUF_OUT} {HF_REPO}")
    log("DONE (local artifacts only)")
    raise SystemExit(0)

try:
    from huggingface_hub import HfApi

    api = HfApi(token=token)
    api.create_repo(repo_id=HF_REPO, repo_type="model", exist_ok=True)
    api.upload_file(path_or_fileobj=os.path.join(WORK, "README.md"), path_in_repo="README.md",
                    repo_id=HF_REPO, commit_message="model card")
    api.upload_file(path_or_fileobj=os.path.join(WORK, "metrics.json"), path_in_repo="metrics.json",
                    repo_id=HF_REPO, commit_message="metrics from the Kaggle run")
    api.upload_file(path_or_fileobj=GGUF_OUT, path_in_repo=GGUF_NAME, repo_id=HF_REPO,
                    commit_message=f"GGUF {QUANT} from Kaggle kernel")
    log(f"PUBLISHED https://huggingface.co/{HF_REPO}")
    log("install on the server: sudo bash scripts/hf-model-pull.sh tukuk-builder-mini")
except Exception:
    traceback.print_exc()
    log("HOLD: upload failed — artifacts remain in /kaggle/working for a manual push.")
    raise

log(f"DONE in {(time.time()-started)/60:.1f} min")
