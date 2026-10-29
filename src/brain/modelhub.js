/**
 * modelhub.js — inventory of OUR OWN published models.
 *
 * Pipeline it describes: Kaggle GPU training job → Hugging Face hub → this server
 * (scripts/hf-model-pull.sh installs the GGUF and registers an Ollama tag).
 *
 * DESIGN RULES
 *  - Read-only. The registry (ai-models/registry.json) is the source of truth and is
 *    committed to git; the server never rewrites it at request time.
 *  - No network calls. /api/models is polled by the admin panel, so every field here
 *    comes from the JSON file or a statSync of the model directory. A missing file is
 *    reported as not installed — never as an error.
 *  - 'installed' is DERIVED, not stored: a model is installed only when hfFile exists
 *    in models.localDir. This keeps git clean and makes a broken pull obvious.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const REGISTRY_PATH = config.models.registryPath;

function readRegistry() {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed && parsed.models) ? parsed.models : [];
  } catch {
    // No registry / bad JSON is a normal state on a fresh install, not a crash.
    return [];
  }
}

function fileInfo(filePath) {
  try {
    const st = fs.statSync(filePath);
    return {
      path: filePath,
      sizeMb: Math.round(st.size / (1024 * 1024)),
      modifiedAt: st.mtime.toISOString()
    };
  } catch {
    return null;
  }
}

function describe(model) {
  const local = model.hfFile ? fileInfo(path.join(config.models.localDir, model.hfFile)) : null;
  return {
    id: model.id,
    name: model.name,
    role: model.role,
    kind: model.kind,
    base: model.base,
    tuning: model.tuning,
    quant: model.quant,
    hfRepo: model.hfRepo,
    hfUrl: model.hfRepo ? `https://huggingface.co/${model.hfRepo}` : null,
    hfFile: model.hfFile,
    ollamaTag: model.ollamaTag,
    license: model.license,
    trainedOn: model.trainedOn,
    job: model.job,
    installed: Boolean(local),
    local,
    // Where the honest numbers live (loss, sha256, wall-clock) — produced by the
    // training kernel, never typed by hand.
    metricsUrl: model.hfRepo ? `https://huggingface.co/${model.hfRepo}/blob/main/metrics.json` : null,
    notes: model.notes
  };
}

/** Every registered model with its live install state. */
function inventory() {
  const models = readRegistry().map(describe);
  return {
    registry: REGISTRY_PATH,
    localDir: config.models.localDir,
    models,
    installed: models.filter((m) => m.installed).length,
    // What is missing is stated plainly so "the model is not on /ask" is explainable.
    note: models.length
      ? `${models.length} published model(s) registered, ${models.filter((m) => m.installed).length} installed here. Install with: sudo bash scripts/hf-model-pull.sh <id>.`
      : 'No published models registered yet — train one with: bash scripts/kaggle-train-model.sh'
  };
}

module.exports = { inventory, readRegistry, REGISTRY_PATH };
