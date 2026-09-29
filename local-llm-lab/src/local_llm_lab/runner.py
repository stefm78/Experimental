from __future__ import annotations
import argparse,datetime as dt,hashlib,json,math,statistics,subprocess,tempfile,time,urllib.request
from pathlib import Path
from .contracts import ContractError,file_digest,load_json,validate_cases_file,validate_model_catalog,verify_model_file
from .evaluator import evaluate_case
LAB_ROOT=Path(__file__).resolve().parents[2]; REPO_ROOT=LAB_ROOT.parent
NEUTRAL_SYSTEM_MESSAGE='You are a bounded contract executor. Use only facts and identifiers supplied in the current user message. Do not infer unstated facts. Return only the requested JSON object. Never reveal chain-of-thought; provide final fields only.'
CASE_PROMPT_TEMPLATE_VERSION='r1-case-prompt-v1'
CASE_PROMPT_TEMPLATE='TASK\n{prompt}\n\nALLOWED_IDS\n{allowed_ids}\n\nOUTPUT_CONTRACT\nReturn exactly one JSON object with keys verdict, ids, items. verdict is a string; ids and items are arrays of unique strings. Use only ALLOWED_IDS in ids. Do not add commentary or markdown.'
OUTPUT_SCHEMA={'type':'object','additionalProperties':False,'required':['verdict','ids','items'],'properties':{'verdict':{'type':'string'},'ids':{'type':'array','items':{'type':'string'},'uniqueItems':True},'items':{'type':'array','items':{'type':'string'},'uniqueItems':True}}}
IDENTITY=('model_id','role','source_provider','source_repository','source_revision','source_filename','quantization','expected_or_observed_sha256','file_size_bytes','license_identifier','chat_template_strategy','context_limit_used')
def utcnow(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def _git(*a):
 p=subprocess.run(['git',*a],cwd=LAB_ROOT,capture_output=True,text=True); return p.stdout.strip() if p.returncode==0 else 'unknown'
def git_info(): return {'repository':_git('config','--get','remote.origin.url') or 'unknown','commit':_git('rev-parse','HEAD'),'tracked_tree_clean':_git('status','--porcelain','--untracked-files=no')==''}
def render_case_prompt(c): return CASE_PROMPT_TEMPLATE.format(prompt=c['prompt'],allowed_ids=', '.join(c['allowed_ids']) or '(none)')
def make_request(c,lane,m):
 p={'messages':[{'role':'system','content':NEUTRAL_SYSTEM_MESSAGE},{'role':'user','content':render_case_prompt(c)}],'temperature':0.0,'top_p':1.0,'seed':1,'max_tokens':256,'stream':False}; p.update(m.get('request_overrides',{}))
 if lane=='constrained': p['response_format']={'type':'json_schema','schema':OUTPUT_SCHEMA}
 return p
class HttpAdapter:
 def __init__(self,url): self.url=url.rstrip('/')
 def complete(self,payload,case=None):
  req=urllib.request.Request(self.url+'/v1/chat/completions',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST'); t=time.perf_counter()
  with urllib.request.urlopen(req,timeout=120) as r: body=r.read().decode()
  parsed=json.loads(body); usage=parsed.get('usage') or {}; content=parsed['choices'][0]['message'].get('content') or ''
  return content,{'latency_ms':(time.perf_counter()-t)*1000,'prompt_tokens':usage.get('prompt_tokens'),'completion_tokens':usage.get('completion_tokens')},parsed
class FakeAdapter:
 def __init__(self,malformed_case_id=None,fail_after=None): self.calls=[]; self.malformed_case_id=malformed_case_id; self.fail_after=fail_after
 def complete(self,payload,case=None):
  self.calls.append(payload)
  if self.fail_after is not None and len(self.calls)>self.fail_after: raise RuntimeError('synthetic adapter failure')
  content='{"ok":true}' if case is None else ('{"verdict":' if case['case_id']==self.malformed_case_id else json.dumps(case['expected'],ensure_ascii=False,separators=(',',':')))
  return content,{'latency_ms':0.0,'prompt_tokens':0,'completion_tokens':0},{'fake':True,'choices':[{'message':{'content':content}}]}
def _p95(v):
 if len(v)<2:return None
 v=sorted(v); return v[min(math.ceil(.95*len(v))-1,len(v)-1)]
def summarize_results(results):
 groups=[]
 for keys in [('model_id',),('model_id','lane'),('model_id','lane','family'),('model_id','lane','language'),('model_id','lane','difficulty')]:
  buckets={}
  for r in results:buckets.setdefault(tuple(r.get(k) for k in keys),[]).append(r)
  for key,rows in sorted(buckets.items(),key=lambda x:str(x[0])):
   n=len(rows); lat=[r['latency_ms'] for r in rows if isinstance(r.get('latency_ms'),(int,float))]
   groups.append({'group_by':list(keys),'group':dict(zip(keys,key)),'case_count':n,'semantic_exact_accuracy':sum(bool(r.get('semantic_exact_pass')) for r in rows)/n,'contract_pass_rate':sum(bool(r.get('contract_valid')) for r in rows)/n,'invalid_json_rate':sum(not bool(r.get('parse_valid')) for r in rows)/n,'id_violation_rate':sum(not bool(r.get('closed_world_id_pass')) for r in rows)/n,'runtime_error_rate':sum(r.get('error_code')=='RUNTIME_ERROR' for r in rows)/n,'median_latency_ms':statistics.median(lat) if lat else None,'p95_latency_ms':_p95(lat),'total_prompt_tokens':sum(r.get('prompt_tokens') or 0 for r in rows),'total_completion_tokens':sum(r.get('completion_tokens') or 0 for r in rows)})
 return {'summary_version':'local-llm-lab.summary.v1','generated_at_utc':utcnow(),'groups':groups}
def _results(d):
 p=d/'results.jsonl'; return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
def _digest(p): return file_digest(p) if p.is_file() else None
def _manifest(d,camp,cases):
 p=d/'RUN_MANIFEST.json'
 if p.exists(): return json.loads(p.read_text())
 g=git_info(); m={'manifest_version':'local-llm-lab.run.v1','run_id':d.name,'campaign_id':camp['campaign_id'],'campaign_digest':file_digest(LAB_ROOT/'campaigns/r1-primitives.json'),'fixture_digest':file_digest(cases),'prompt_version':CASE_PROMPT_TEMPLATE_VERSION,'case_prompt_template_sha256':hashlib.sha256(CASE_PROMPT_TEMPLATE.encode()).hexdigest(),'system_message_version':camp['system_message_version'],'system_message_sha256':hashlib.sha256(NEUTRAL_SYSTEM_MESSAGE.encode()).hexdigest(),'git_repository':g['repository'],'git_commit':g['commit'],'tracked_tree_clean':g['tracked_tree_clean'],'runtime_identity_digest':_digest(d/'RUNTIME_IDENTITY.json'),'system_snapshot_digest':_digest(d/'SYSTEM_SNAPSHOT.json'),'model_lock_digest':_digest(d/'MODEL_LOCK.json'),'inference_parameters':camp['inference'],'started_at_utc':utcnow(),'ended_at_utc':None,'status':'IN_PROGRESS','models':[]}; _save(d,m); return m
def _save(d,m): (d/'RUN_MANIFEST.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
def run_model_campaign(run_dir,model,adapter,model_path=None,server_command=None,do_warmup=False):
 cases_path=LAB_ROOT/'fixtures/r1-cases.jsonl'; cases=validate_cases_file(cases_path); camp=load_json(LAB_ROOT/'campaigns/r1-primitives.json'); run_dir.mkdir(parents=True,exist_ok=True); man=_manifest(run_dir,camp,cases_path)
 if not man.get('tracked_tree_clean'): raise ContractError('run manifest refuses dirty tracked tree')
 artifact=verify_model_file(Path(model_path),model,repo_root=REPO_ROOT) if model_path else None; rec={'model_id':model['model_id'],'model_identity':{k:model.get(k) for k in IDENTITY},'artifact':artifact,'server_invocation':server_command,'started_at_utc':utcnow(),'completed_at_utc':None,'status':'IN_PROGRESS','runtime_error_count':0}; man['models'].append(rec); _save(run_dir,man)
 if do_warmup:
  p={'messages':[{'role':'system','content':NEUTRAL_SYSTEM_MESSAGE},{'role':'user','content':'Return only the JSON object {"ok":true}.'}],'temperature':0.0,'top_p':1.0,'seed':1,'max_tokens':16,'stream':False}; p.update(model.get('request_overrides',{})); _,meta,_=adapter.complete(p,None)
  with (run_dir/'benchmark.jsonl').open('a') as f:f.write(json.dumps({'kind':'semantic_warmup','model_id':model['model_id'],'latency_ms':meta.get('latency_ms'),'excluded_from_semantic_metrics':True})+'\n')
 errors=0
 with (run_dir/'results.jsonl').open('a') as out:
  for lane in camp['lanes']:
   for case in sorted(cases,key=lambda c:c['case_id']):
    path=run_dir/'responses'/model['model_id']/lane/(case['case_id']+'.json'); path.parent.mkdir(parents=True,exist_ok=True)
    try: content,meta,full=adapter.complete(make_request(case,lane,model),case); path.write_text(json.dumps(full,ensure_ascii=False,indent=2)+'\n'); ev=evaluate_case(case,content,lane); err=ev['error_code']
    except Exception as exc: errors+=1; content=''; meta={'latency_ms':None,'prompt_tokens':None,'completion_tokens':None}; path.write_text(json.dumps({'error':f'{type(exc).__name__}: {exc}'},indent=2)+'\n'); ev=evaluate_case(case,content,lane); err='RUNTIME_ERROR'
    row={'case_id':case['case_id'],'family':case['family'],'language':case['language'],'difficulty':case['difficulty'],'model_id':model['model_id'],'lane':lane,**ev,'raw_output_preserved':str(path.relative_to(run_dir)),'latency_ms':meta.get('latency_ms'),'prompt_tokens':meta.get('prompt_tokens'),'completion_tokens':meta.get('completion_tokens'),'error_code':err}; out.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n'); out.flush()
 summary=summarize_results(_results(run_dir)); (run_dir/'SUMMARY.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n'); rec.update(completed_at_utc=utcnow(),runtime_error_count=errors,status='COMPLETE' if not errors else 'PARTIAL'); _save(run_dir,man)
 if errors: raise RuntimeError(f"{model['model_id']} recorded {errors} runtime errors; preserved partial results")
 return summary
def _expected():
 cat=load_json(LAB_ROOT/'config/models.json'); camp=load_json(LAB_ROOT/'campaigns/r1-primitives.json'); cases=validate_cases_file(LAB_ROOT/'fixtures/r1-cases.jsonl'); return {(m['model_id'],l,c['case_id']) for m in cat['models'] for l in camp['lanes'] for c in cases}
def finalize(d):
 man=json.loads((d/'RUN_MANIFEST.json').read_text()); rows=_results(d); keys={(r['model_id'],r['lane'],r['case_id']) for r in rows}; models={m.get('model_id') for m in man.get('models',[]) if m.get('status')=='COMPLETE'}; exp_models={m['model_id'] for m in load_json(LAB_ROOT/'config/models.json')['models']}; fail=(d/'FAILURES.jsonl'); has_fail=fail.exists() and bool(fail.read_text().strip()); complete=keys==_expected() and len(keys)==len(rows) and all(r.get('error_code')!='RUNTIME_ERROR' for r in rows) and models==exp_models and not has_fail; man.update(ended_at_utc=utcnow(),status='COMPLETE' if complete else 'PARTIAL'); _save(d,man); return man['status']
def handoff_text(d):
 man=json.loads((d/'RUN_MANIFEST.json').read_text()) if (d/'RUN_MANIFEST.json').exists() else {}; summ=load_json(d/'SUMMARY.json') if (d/'SUMMARY.json').exists() else {'groups':[]}; snap=load_json(d/'SYSTEM_SNAPSHOT.json') if (d/'SYSTEM_SNAPSHOT.json').exists() else {}; runtime=load_json(d/'RUNTIME_IDENTITY.json') if (d/'RUNTIME_IDENTITY.json').exists() else {}; locks=load_json(d/'MODEL_LOCK.json') if (d/'MODEL_LOCK.json').exists() else {}; recs=man.get('models',[]); real=bool(man.get('status')=='COMPLETE' and man.get('runtime_identity_digest') and man.get('system_snapshot_digest') and man.get('model_lock_digest') and recs and all(r.get('status')=='COMPLETE' and r.get('artifact') and r.get('server_invocation') and r['artifact'].get('observed_sha256')==r['artifact'].get('expected_or_observed_sha256') for r in recs)); nuc='PASS' if real else ('PARTIAL' if man.get('status')=='PARTIAL' and any(r.get('artifact') for r in recs) else 'DEFERRED'); server=runtime.get('observed',{}).get('llama_server',{}).get('output') or snap.get('llama_server_version',{}).get('output') or 'unknown'; ml=[g for g in summ.get('groups',[]) if g.get('group_by')==['model_id','lane']]
 lines=['LOCAL LLM LAB HANDOFF',f'run_id={d.name}',f"git_commit={man.get('git_commit','unknown')}",f"tracked_tree_clean={man.get('tracked_tree_clean','unknown')}",f"campaign_id={man.get('campaign_id','unknown')}",f"campaign_digest={man.get('campaign_digest','unknown')}",f"fixture_digest={man.get('fixture_digest','unknown')}",f"runtime_identity_digest={man.get('runtime_identity_digest','unknown')}",f"model_lock_digest={man.get('model_lock_digest','unknown')}",f"run_status={man.get('status','unknown')}",f'nuc_execution={nuc}',f'llama_server={server}','model_lock='+json.dumps(locks,ensure_ascii=False,separators=(',',':')),'summary_model_lane='+json.dumps(ml,ensure_ascii=False,separators=(',',':')),f'details={d}']; fail=d/'FAILURES.jsonl'
 if fail.exists() and fail.read_text().strip(): lines.append('material_failures='+fail.read_text().strip().replace('\n',' | '))
 return '\n'.join(lines)+'\n'
def dry_run():
 cat=load_json(LAB_ROOT/'config/models.json'); validate_model_catalog(cat); validate_cases_file(LAB_ROOT/'fixtures/r1-cases.jsonl')
 with tempfile.TemporaryDirectory(prefix='local-llm-lab-dry-') as td:
  d=Path(td)/'dry-run'
  for m in cat['models']:
   a=FakeAdapter(); run_model_campaign(d,m,a); assert len(a.calls)==48; assert all(len(p['messages'])==2 and p['messages'][0]['content']==NEUTRAL_SYSTEM_MESSAGE for p in a.calls)
  assert finalize(d)=='COMPLETE'; rows=_results(d); assert len(rows)==96 and all(r['semantic_exact_pass'] for r in rows); assert 'run_status=COMPLETE' in handoff_text(d)
 return True
def cli():
 p=argparse.ArgumentParser(); s=p.add_subparsers(dest='cmd',required=True); s.add_parser('validate-fixtures'); s.add_parser('dry-run'); v=s.add_parser('verify-model'); v.add_argument('--model-id',required=True); v.add_argument('--path',required=True); r=s.add_parser('run'); r.add_argument('--model-id',required=True); r.add_argument('--run-dir',required=True); r.add_argument('--server-url',required=True); r.add_argument('--model-path',required=True); r.add_argument('--server-command'); r.add_argument('--warmup',action='store_true'); f=s.add_parser('finalize'); f.add_argument('--run-dir',required=True); h=s.add_parser('handoff'); h.add_argument('--run-dir',required=True); a=p.parse_args(); cat=load_json(LAB_ROOT/'config/models.json'); validate_model_catalog(cat)
 if a.cmd=='validate-fixtures': validate_cases_file(LAB_ROOT/'fixtures/r1-cases.jsonl'); print('R1_CORPUS=PASS')
 elif a.cmd=='dry-run': dry_run(); print('STUB_END_TO_END_DRY_RUN=PASS')
 elif a.cmd=='verify-model':
  m=next((x for x in cat['models'] if x['model_id']==a.model_id),None)
  if not m: raise SystemExit('unknown model_id')
  print(json.dumps(verify_model_file(Path(a.path),m,repo_root=REPO_ROOT),sort_keys=True))
 elif a.cmd=='run':
  m=next((x for x in cat['models'] if x['model_id']==a.model_id),None)
  if not m: raise SystemExit('unknown model_id')
  run_model_campaign(Path(a.run_dir),m,HttpAdapter(a.server_url),a.model_path,a.server_command,a.warmup)
 elif a.cmd=='finalize': print('RUN_STATUS='+finalize(Path(a.run_dir)))
 else: print(handoff_text(Path(a.run_dir)),end='')
if __name__=='__main__': cli()
