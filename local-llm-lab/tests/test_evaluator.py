import json
import unittest

from local_llm_lab.contracts import validate_cases_file
from local_llm_lab.evaluator import evaluate_case
from local_llm_lab.runner import LAB_ROOT, summarize_results


class EvaluatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = validate_cases_file(LAB_ROOT / "fixtures/r1-cases.jsonl")

    def pick(self, family):
        return next(case for case in self.cases if case["family"] == family)

    def test_correct_exact_passes_deterministically(self):
        case = self.cases[0]
        raw = json.dumps(case["expected"], separators=(",", ":"))
        first = evaluate_case(case, raw, "unconstrained")
        self.assertEqual(first, evaluate_case(case, raw, "unconstrained"))
        self.assertTrue(first["semantic_exact_pass"])
        self.assertTrue(first["contract_valid"])

    def test_wrong_semantic_fails(self):
        result = evaluate_case(
            self.cases[0],
            json.dumps({"verdict": "WRONG", "ids": [], "items": []}),
            "constrained",
        )
        self.assertFalse(result["semantic_exact_pass"])

    def test_invented_id_fails(self):
        case = self.pick("CLOSED_WORLD_ID_FIDELITY")
        output = dict(case["expected"])
        output["ids"] = list(output["ids"]) + ["INVENTED-999"]
        result = evaluate_case(case, json.dumps(output), "unconstrained")
        self.assertFalse(result["closed_world_id_pass"])
        self.assertFalse(result["semantic_exact_pass"])

    def test_omitted_required_item_fails(self):
        case = next(case for case in self.cases if case["expected"]["items"])
        output = dict(case["expected"])
        output["items"] = []
        result = evaluate_case(case, json.dumps(output), "constrained")
        self.assertFalse(result["required_items_covered"])

    def test_forbidden_item_fails(self):
        case = next(case for case in self.cases if case["forbidden_items"])
        output = dict(case["expected"])
        output["items"] = list(output["items"]) + [case["forbidden_items"][0]]
        result = evaluate_case(case, json.dumps(output), "constrained")
        self.assertFalse(result["forbidden_items_absent"])

    def test_malformed_json_fails(self):
        result = evaluate_case(self.cases[0], "{bad", "unconstrained")
        self.assertFalse(result["parse_valid"])
        self.assertFalse(result["contract_valid"])
        self.assertEqual(result["error_code"], "INVALID_JSON")

    def test_parse_valid_wrong_shape_fails_contract_rate(self):
        case = self.cases[0]
        result = {
            "case_id": case["case_id"],
            "family": case["family"],
            "language": case["language"],
            "difficulty": case["difficulty"],
            "model_id": "probe",
            "lane": "unconstrained",
            **evaluate_case(case, '{"verdict":"FACT"}', "unconstrained"),
            "latency_ms": 1.0,
            "prompt_tokens": 1,
            "completion_tokens": 1,
        }
        summary = summarize_results([result])
        lane = next(
            group
            for group in summary["groups"]
            if group["group_by"] == ["model_id", "lane"]
        )
        self.assertEqual(lane["contract_pass_rate"], 0.0)
        self.assertEqual(result["error_code"], "CONTRACT_INVALID")
