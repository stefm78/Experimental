from __future__ import annotations
import hashlib,json
OUTPUT_KEYS={'verdict','ids','items'}
def _norm(o): return {'verdict':o['verdict'],'ids':sorted(o['ids']),'items':sorted(o['items'])}
def _shape(o):
    if not isinstance(o,dict) or set(o)!=OUTPUT_KEYS or not isinstance(o.get('verdict'),str) or not o['verdict']: return False
    for k in ('ids','items'):
        if not isinstance(o.get(k),list) or any(not isinstance(x,str) or not x for x in o[k]) or len(o[k])!=len(set(o[k])): return False
    return True
def evaluate_case(case,raw_output,lane):
    sha=hashlib.sha256(raw_output.encode()).hexdigest()
    try: parsed=json.loads(raw_output); parse=True
    except json.JSONDecodeError: parsed=None; parse=False
    shape=parse and _shape(parsed); schema=shape if lane=='constrained' else None
    if shape:
        ids=parsed['ids']; items=parsed['items']; closed=(not case['closed_world_ids']) or set(ids).issubset(case['allowed_ids']); coverage=set(case['expected']['items']).issubset(items); forbidden=set(case['forbidden_items']).isdisjoint(set(ids)|set(items)); semantic=_norm(parsed)==_norm(case['expected']) and closed and coverage and forbidden
    else: closed=not case['closed_world_ids']; coverage=False; forbidden=False; semantic=False
    return {'parse_valid':parse,'schema_valid':schema,'semantic_exact_pass':bool(semantic),'closed_world_id_pass':closed,'required_items_covered':coverage,'forbidden_items_absent':forbidden,'raw_output_sha256':sha,'error_code':None if parse else 'INVALID_JSON'}
