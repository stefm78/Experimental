import json
import tempfile
import unittest
from pathlib import Path

from local_llm_lab.contracts import load_json
from local_llm_lab.runner import FakeAdapter, LAB_ROOT, dry_run, finalize, run_model_campaign


class DryRunTests(unittest.TestCase):
    def test_full_dry_run(self):
        self.assertTrue(dry_run())

    def test_stub_handoff_never_claims_nuc_pass(self):
        models = load_json(LAB_ROOT / "config/models.json")["models"]
        with tempfile.TemporaryDirectory() as temp_dir:
            run_dir = Path(temp_dir) / "run"
            for model in models:
                run_model_campaign(run_dir, model, FakeAdapter())
            self.assertEqual(finalize(run_dir), "COMPLETE")
            from local_llm_lab.runner import handoff_text
            handoff = handoff_text(run_dir)
            self.assertIn("nuc_execution=DEFERRED", handoff)
            self.assertNotIn("nuc_execution=PASS", handoff)

    def test_partial_first_model_preserved_if_second_fails(self):
        models = load_json(LAB_ROOT / "config/models.json")["models"]
        with tempfile.TemporaryDirectory() as temp_dir:
            run_dir = Path(temp_dir) / "run"
            run_model_campaign(run_dir, models[0], FakeAdapter())
            before = (run_dir / "results.jsonl").read_text()
            with self.assertRaises(RuntimeError):
                run_model_campaign(run_dir, models[1], FakeAdapter(fail_after=0))
            after = (run_dir / "results.jsonl").read_text()
            self.assertTrue(after.startswith(before))
            self.assertGreater(len(after), len(before))
            self.assertIn("RUNTIME_ERROR", after)
            self.assertEqual(finalize(run_dir), "PARTIAL")
            manifest = json.loads((run_dir / "RUN_MANIFEST.json").read_text())
            second = next(m for m in manifest["models"] if m["model_id"] == models[1]["model_id"])
            self.assertEqual(second["status"], "PARTIAL")
            self.assertGreater(second["runtime_error_count"], 0)

    def test_unconstrained_malformed_is_not_repaired(self):
        model = load_json(LAB_ROOT / "config/models.json")["models"][0]
        with tempfile.TemporaryDirectory() as temp_dir:
            run_dir = Path(temp_dir) / "run"
            run_model_campaign(
                run_dir,
                model,
                FakeAdapter(malformed_case_id="r1-cd-en-adversarial"),
            )
            rows = [
                json.loads(line)
                for line in (run_dir / "results.jsonl").read_text().splitlines()
            ]
            row = next(
                result
                for result in rows
                if result["case_id"] == "r1-cd-en-adversarial"
                and result["lane"] == "unconstrained"
            )
            self.assertFalse(row["parse_valid"])
            self.assertEqual(row["error_code"], "INVALID_JSON")

    def test_incomplete_result_matrix_cannot_finalize_complete(self):
        models = load_json(LAB_ROOT / "config/models.json")["models"]
        with tempfile.TemporaryDirectory() as temp_dir:
            run_dir = Path(temp_dir) / "run"
            run_model_campaign(run_dir, models[0], FakeAdapter())
            self.assertEqual(finalize(run_dir), "PARTIAL")
