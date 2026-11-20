"""Fast, offline policy tests for Play release promotion (no Play credentials)."""
import importlib.util
import pathlib
import unittest

script = pathlib.Path(__file__).with_name("promote_android.py")
spec = importlib.util.spec_from_file_location("promote_android", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

SOURCE = {"track": "qa", "releases": [
    {"name": "1.0.12", "versionCodes": ["22"], "status": "completed",
     "releaseNotes": [{"language": "en-US", "text": "Fixed bugs"}]}
]}

class PromotionTests(unittest.TestCase):
    def test_production_is_staged_and_does_not_rebuild(self):
        result = module.prepare_promotion([SOURCE], "22", "production", 10)
        self.assertEqual(result["track"], "production")
        self.assertEqual(result["releases"], [{
            "versionCodes": ["22"], "name": "1.0.12",
            "releaseNotes": [{"language": "en-US", "text": "Fixed bugs"}],
            "status": "inProgress", "userFraction": 0.1
        }])

    def test_beta_reuses_exact_same_version(self):
        result = module.prepare_promotion(
            [SOURCE, {"track": "beta", "releases": []}], "22", "beta", 10)
        self.assertEqual(result["releases"][0]["versionCodes"], ["22"])
        self.assertEqual(result["releases"][0]["status"], "completed")

    def test_unverified_version_fails(self):
        with self.assertRaisesRegex(ValueError, "not one completed internal release"):
            module.prepare_promotion([SOURCE], "23", "production", 10)

    def test_duplicate_version_fails(self):
        with self.assertRaisesRegex(ValueError, "already exists"):
            module.prepare_promotion([SOURCE, {"track": "production", "releases": [
                {"versionCodes": ["22"], "status": "completed"}
            ]}], "22", "production", 10)

    def test_downgrade_fails(self):
        with self.assertRaisesRegex(ValueError, "newer"):
            module.prepare_promotion([SOURCE, {"track": "production", "releases": [
                {"versionCodes": ["23"], "status": "completed"}
            ]}], "22", "production", 10)

    def test_staged_rollout_clash_fails(self):
        with self.assertRaisesRegex(ValueError, "active staged"):
            module.prepare_promotion([SOURCE, {"track": "production", "releases": [
                {"versionCodes": ["21"], "status": "inProgress", "userFraction": 0.05}
            ]}], "22", "production", 10)

    def test_production_100_percent_fails(self):
        with self.assertRaisesRegex(ValueError, "rollout_percent"):
            module.prepare_promotion([SOURCE], "22", "production", 100)

    def test_unknown_closed_testing_track_fails(self):
        with self.assertRaisesRegex(ValueError, "does not exist"):
            module.prepare_promotion([SOURCE], "22", "alpha", 10)

    def test_draft_internal_fails(self):
        with self.assertRaisesRegex(ValueError, "not one completed internal release"):
            module.prepare_promotion([
                {"track": "qa", "releases": [
                    {"versionCodes": ["22"], "status": "draft"}
                ]}
            ], "22", "production", 10)

if __name__ == "__main__":
    unittest.main()
