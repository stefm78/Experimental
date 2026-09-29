import json,tempfile,unittest
from pathlib import Path
from local_llm_lab.contracts import load_json
from local_llm_lab.runner import FakeAdapter,LAB_ROOT,dry_run,run_model_campaign
class DryRunTests(unittest.TestCase):
 def test_full_dry_run(self): self.assertTrue(dry_run())
 def test_partial_first_model_preserved_if_second_fails(self):
  models=load_json(LAB_ROOT/'config/models.json')['models']
  with tempfile.TemporaryDirectory() as td:
   d=Path(td)/'run'; run_model_campaign(d,models[0],FakeAdapter()); before=(d/'results.jsonl').read_text(); run_model_campaign(d,models[1],FakeAdapter(fail_after=0)); after=(d/'results.jsonl').read_text(); self.assertTrue(after.startswith(before)); self.assertGreater(len(after),len(before)); self.assertIn('RUNTIME_ERROR',after)
 def test_unconstrained_malformed_is_not_repaired(self):
  model=load_json(LAB_ROOT/'config/models.json')['models'][0]
  with tempfile.TemporaryDirectory() as td:
   d=Path(td)/'run'; run_model_campaign(d,model,FakeAdapter(malformed_case_id='r1-cd-en-adversarial')); rows=[json.loads(x) for x in (d/'results.jsonl').read_text().splitlines()]; row=next(r for r in rows if r['case_id']=='r1-cd-en-adversarial' and r['lane']=='unconstrained'); self.assertFalse(row['parse_valid']); self.assertEqual(row['error_code'],'INVALID_JSON')
