import json,tempfile,unittest
from pathlib import Path
from local_llm_lab.contracts import ContractError,find_forbidden_tracked_paths,load_json,validate_cases_file,validate_model_catalog,verify_model_file
from local_llm_lab.runner import CASE_PROMPT_TEMPLATE,LAB_ROOT,NEUTRAL_SYSTEM_MESSAGE,make_request,render_case_prompt
class ContractTests(unittest.TestCase):
 def test_corpus_balanced(self): self.assertEqual(len(validate_cases_file(LAB_ROOT/'fixtures/r1-cases.jsonl')),24)
 def test_models_locked_and_qwen_direct(self): self.assertTrue(validate_model_catalog(load_json(LAB_ROOT/'config/models.json')))
 def test_corrupt_jsonl_fails(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'bad.jsonl'; p.write_text('{bad\n');
   with self.assertRaises(ContractError): validate_cases_file(p)
 def test_hygiene_detector(self): self.assertTrue(find_forbidden_tracked_paths(['local-llm-lab/models/fake.gguf'])); self.assertTrue(find_forbidden_tracked_paths(['local-llm-lab/runs/x/SUMMARY.json'])); self.assertFalse(find_forbidden_tracked_paths(['local-llm-lab/config/models.json']))
 def test_hash_mismatch_refuses(self):
  model=dict(load_json(LAB_ROOT/'config/models.json')['models'][0]); model['file_size_bytes']=3; model['expected_or_observed_sha256']='0'*64
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'x.gguf'; p.write_bytes(b'abc')
   with self.assertRaises(ContractError): verify_model_file(p,model)
 def test_prompt_never_serializes_expected_object(self):
  c=validate_cases_file(LAB_ROOT/'fixtures/r1-cases.jsonl')[0]; self.assertNotIn(json.dumps(c['expected'],ensure_ascii=False,separators=(',',':')),render_case_prompt(c)); self.assertNotIn('expected',CASE_PROMPT_TEMPLATE.lower())
 def test_same_neutral_system_message(self):
  c=validate_cases_file(LAB_ROOT/'fixtures/r1-cases.jsonl')[0]
  for m in load_json(LAB_ROOT/'config/models.json')['models']:
   req=make_request(c,'unconstrained',m); self.assertEqual(req['messages'][0]['content'],NEUTRAL_SYSTEM_MESSAGE); self.assertEqual(len(req['messages']),2)
