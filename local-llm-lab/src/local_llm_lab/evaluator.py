from __future__ import annotations
import hashlib
import json
OUTPUT_KEYS = {'verdict', 'ids', 'items'}

def _norm(output: dict) -> dict:
    return {'verdict': output['verdict'], 'ids': sorted(output['ids']), 'items': sorted(output['items'])}

def _shape_valid(output: object) -> bool:
    if not isinstance(output, dict) or set(output) != OUTPUT_KEYS:
        return False
    if not isinstance(output.get('verdict'), str) or not output['verdict']:
        return False
    for key in ('ids', 'items'):
        value = output.get(key)
        if not isinstance(value, list):
            return False
        if any((not isinstance(item, str) or not item for item in value)):
            return False
        if len(value) != len(set(value)):
            return False
    return True

def evaluate_case(case: dict, raw_output: str, lane: str) -> dict:
    raw_sha256 = hashlib.sha256(raw_output.encode('utf-8')).hexdigest()
    try:
        parsed = json.loads(raw_output)
        parse_valid = True
    except json.JSONDecodeError:
        parsed = None
        parse_valid = False
    contract_valid = bool(parse_valid and _shape_valid(parsed))
    schema_valid = contract_valid if lane == 'constrained' else None
    if contract_valid:
        ids = parsed['ids']
        items = parsed['items']
        closed_world_id_pass = not case['closed_world_ids'] or set(ids).issubset(case['allowed_ids'])
        required_items_covered = set(case['expected']['items']).issubset(items)
        forbidden_items_absent = set(case['forbidden_items']).isdisjoint(set(ids) | set(items))
        semantic_exact_pass = _norm(parsed) == _norm(case['expected']) and closed_world_id_pass and required_items_covered and forbidden_items_absent
    else:
        closed_world_id_pass = not case['closed_world_ids']
        required_items_covered = False
        forbidden_items_absent = False
        semantic_exact_pass = False
    if not parse_valid:
        error_code = 'INVALID_JSON'
    elif not contract_valid:
        error_code = 'CONTRACT_INVALID'
    else:
        error_code = None
    return {'parse_valid': parse_valid, 'schema_valid': schema_valid, 'contract_valid': contract_valid, 'semantic_exact_pass': bool(semantic_exact_pass), 'closed_world_id_pass': closed_world_id_pass, 'required_items_covered': required_items_covered, 'forbidden_items_absent': forbidden_items_absent, 'raw_output_sha256': raw_sha256, 'error_code': error_code}
