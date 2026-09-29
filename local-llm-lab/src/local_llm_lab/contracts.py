from __future__ import annotations
import hashlib, json
from collections import Counter
from pathlib import Path
from typing import Iterable
FAMILIES = {'FACT_VS_INFERENCE', 'CONTRADICTION_DETECTION', 'CLOSED_WORLD_ID_FIDELITY', 'EVIDENCE_COVERAGE', 'FALSE_PASS_CHALLENGE', 'OPTION_DISCRIMINATION'}
LANGUAGES = {'en', 'fr'}
DIFFICULTIES = {'simple', 'adversarial'}
MODEL_WEIGHT_SUFFIXES = {'.gguf', '.safetensors', '.onnx'}

class ContractError(ValueError):
    pass

def load_json(path: Path):
    with path.open('r', encoding='utf-8') as fh:
        return json.load(fh)

def sha256_file(path: Path):
    h = hashlib.sha256()
    with path.open('rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def file_digest(path: Path):
    return 'sha256:' + sha256_file(path)

def load_cases(path: Path):
    out = []
    with path.open('r', encoding='utf-8') as fh:
        for n, line in enumerate(fh, 1):
            if not line.strip():
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ContractError(f'invalid JSONL at line {n}: {exc}') from exc
    return out

def _strings(v, label):
    if not isinstance(v, list) or any((not isinstance(x, str) or not x for x in v)):
        raise ContractError(f'{label} must be non-empty strings')
    if len(v) != len(set(v)):
        raise ContractError(f'{label} must be unique')

def validate_case(c):
    req = {'case_id', 'family', 'language', 'difficulty', 'prompt', 'allowed_ids', 'closed_world_ids', 'expected', 'forbidden_items'}
    if set(c) != req:
        raise ContractError(f"{c.get('case_id', '?')}: case keys differ from closed contract")
    if not isinstance(c['case_id'], str) or not c['case_id'].startswith('r1-'):
        raise ContractError('case_id must start r1-')
    if c['family'] not in FAMILIES or c['language'] not in LANGUAGES or c['difficulty'] not in DIFFICULTIES:
        raise ContractError(f"{c['case_id']}: invalid classification")
    if not isinstance(c['prompt'], str) or not c['prompt'].strip() or (not isinstance(c['closed_world_ids'], bool)):
        raise ContractError(f"{c['case_id']}: invalid prompt/closed flag")
    _strings(c['allowed_ids'], c['case_id'] + '.allowed_ids')
    _strings(c['forbidden_items'], c['case_id'] + '.forbidden_items')
    e = c['expected']
    if not isinstance(e, dict) or set(e) != {'verdict', 'ids', 'items'} or (not isinstance(e['verdict'], str)):
        raise ContractError(f"{c['case_id']}: invalid expected")
    _strings(e['ids'], c['case_id'] + '.expected.ids')
    _strings(e['items'], c['case_id'] + '.expected.items')
    if c['closed_world_ids'] and (not set(e['ids']).issubset(c['allowed_ids'])):
        raise ContractError(f"{c['case_id']}: expected id outside closed set")

def validate_cases(cases):
    if len(cases) != 24:
        raise ContractError(f'R1 requires exactly 24 cases, got {len(cases)}')
    if len({c.get('case_id') for c in cases}) != 24:
        raise ContractError('duplicate case_id')
    for c in cases:
        validate_case(c)
    counts = Counter(((c['family'], c['language'], c['difficulty']) for c in cases))
    expected = {(f, l, d) for f in FAMILIES for l in LANGUAGES for d in DIFFICULTIES}
    if set(counts) != expected or any((v != 1 for v in counts.values())):
        raise ContractError(f'unbalanced matrix: {counts}')
    return True

def validate_cases_file(path: Path):
    c = load_cases(path)
    validate_cases(c)
    return c

def validate_model_catalog(catalog):
    if catalog.get('schema_version') != 'local-llm-lab.models.v1':
        raise ContractError('bad model catalog schema')
    models = catalog.get('models')
    if not isinstance(models, list) or len(models) != 2 or {m.get('role') for m in models} != {'probe', 'control'}:
        raise ContractError('R1 requires probe + control')
    required = {'model_id', 'role', 'source_provider', 'source_repository', 'source_revision', 'source_filename', 'quantization', 'expected_or_observed_sha256', 'file_size_bytes', 'license_identifier', 'chat_template_strategy', 'context_limit_used', 'request_overrides'}
    for m in models:
        if required - set(m):
            raise ContractError(f"{m.get('model_id')}: missing fields")
        h = m['expected_or_observed_sha256']
        if len(h) != 64 or any((ch not in '0123456789abcdef' for ch in h)):
            raise ContractError(f"{m['model_id']}: invalid sha256")
        if m['context_limit_used'] != 2048:
            raise ContractError('R1 common context must be 2048')
    q = next((m for m in models if m['role'] == 'control'))
    if q['request_overrides'].get('chat_template_kwargs', {}).get('enable_thinking') is not False or q['request_overrides'].get('reasoning_effort') != 'none':
        raise ContractError('Qwen direct-answer controls missing')
    return True

def verify_model_file(path: Path, model: dict, repo_root: Path | None=None):
    if not path.is_file():
        raise ContractError(f'model file missing: {path}')
    resolved = path.resolve()
    if repo_root is not None:
        try:
            resolved.relative_to(repo_root.resolve())
        except ValueError:
            pass
        else:
            raise ContractError(f'model file must be outside repository: {resolved}')
    size = resolved.stat().st_size
    if model.get('file_size_bytes') is not None and size != model['file_size_bytes']:
        raise ContractError(f"model size mismatch for {model['model_id']}: {size} != {model['file_size_bytes']}")
    sha = sha256_file(resolved)
    exp = model.get('expected_or_observed_sha256')
    if exp and sha != exp:
        raise ContractError(f"model sha256 mismatch for {model['model_id']}: {sha} != {exp}")
    identity_keys = ('model_id', 'role', 'source_provider', 'source_repository', 'source_revision', 'source_filename', 'quantization', 'expected_or_observed_sha256', 'file_size_bytes', 'license_identifier', 'chat_template_strategy', 'context_limit_used')
    return {**{k: model.get(k) for k in identity_keys}, 'path': str(resolved), 'observed_sha256': sha, 'observed_file_size_bytes': size}

def find_forbidden_tracked_paths(paths: Iterable[str]):
    bad = []
    for raw in paths:
        low = raw.replace('\\', '/').lower()
        if low.startswith('local-llm-lab/runs/') or '/runs/' in low or Path(low).suffix in MODEL_WEIGHT_SUFFIXES or ('/.cache/' in low) or low.startswith('local-llm-lab/.state/'):
            bad.append(raw)
    return bad
