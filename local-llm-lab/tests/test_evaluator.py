import json,unittest
from local_llm_lab.contracts import validate_cases_file
from local_llm_lab.evaluator import evaluate_case
from local_llm_lab.runner import LAB_ROOT
class EvaluatorTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls): cls.cases=validate_cases_file(LAB_ROOT/'fixtures/r1-cases.jsonl')
 def pick(self,f): return next(c for c in self.cases if c['family']==f)
 def test_correct_exact_passes_deterministically(self):
  c=self.cases[0]; raw=json.dumps(c['expected'],separators=(',',':')); a=evaluate_case(c,raw,'unconstrained'); self.assertEqual(a,evaluate_case(c,raw,'unconstrained')); self.assertTrue(a['semantic_exact_pass'])
 def test_wrong_semantic_fails(self): self.assertFalse(evaluate_case(self.cases[0],json.dumps({'verdict':'WRONG','ids':[],'items':[]}),'constrained')['semantic_exact_pass'])
 def test_invented_id_fails(self):
  c=self.pick('CLOSED_WORLD_ID_FIDELITY'); o=dict(c['expected']); o['ids']=list(o['ids'])+['INVENTED-999']; r=evaluate_case(c,json.dumps(o),'unconstrained'); self.assertFalse(r['closed_world_id_pass']); self.assertFalse(r['semantic_exact_pass'])
 def test_omitted_required_item_fails(self):
  c=next(x for x in self.cases if x['expected']['items']); o=dict(c['expected']); o['items']=[]; self.assertFalse(evaluate_case(c,json.dumps(o),'constrained')['required_items_covered'])
 def test_forbidden_item_fails(self):
  c=next(x for x in self.cases if x['forbidden_items']); o=dict(c['expected']); o['items']=list(o['items'])+[c['forbidden_items'][0]]; self.assertFalse(evaluate_case(c,json.dumps(o),'constrained')['forbidden_items_absent'])
 def test_malformed_json_fails(self): self.assertFalse(evaluate_case(self.cases[0],'{bad','unconstrained')['parse_valid'])
