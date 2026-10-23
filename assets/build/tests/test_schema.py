import unittest

from helpers import A_KIT_FILE, CONTENT, KIT_FILES, ROLES, SCHEMA
from nsassets import recipes, schema


def check(recipe, name=None):
    return recipes.check_recipe(recipe, name or f"recipes/{recipe.get('id')}.json", SCHEMA, CONTENT, KIT_FILES, ROLES)


def base(**extra):
    r = {"id": "chapel", "kind": "building", "parts": [{"prim": "box", "size": [1.8, 1.8, 0.6], "role": "stone"}]}
    r.update(extra)
    return r


class SchemaTest(unittest.TestCase):
    def test_valid_recipe_passes(self):
        self.assertEqual(check(base()), [])
        kit, rel = A_KIT_FILE
        self.assertEqual(check(base(parts=[{"kit": kit, "file": rel, "roles": {"Atlas/white": "ochre"}, "simplify": {"dissolve": 5}}])), [])

    def test_unknown_field_fails_naming_the_recipe(self):
        errs = check(base(colour="red"))
        self.assertTrue(any("recipes/chapel.json" in e and "unknown field 'colour'" in e for e in errs), errs)
        errs = check(base(parts=[{"prim": "box", "size": [1, 1, 1], "role": "stone", "texture": "x"}]))
        self.assertTrue(any("$.parts[0]" in e and "unknown field 'texture'" in e for e in errs), errs)

    def test_unknown_role_fails_naming_the_part(self):
        errs = check(base(parts=[{"prim": "box", "size": [1.8, 1.8, 0.6], "role": "purple", "name": "nave"}]))
        self.assertEqual(len(errs), 1, errs)
        self.assertIn("recipes/chapel.json", errs[0])
        self.assertIn("'nave'", errs[0])
        self.assertIn("unknown role 'purple'", errs[0])
        # UI and status colours are not material roles.
        errs = check(base(parts=[{"prim": "box", "size": [1, 1, 1], "role": "ink"}]))
        self.assertTrue(any("unknown role 'ink'" in e for e in errs), errs)

    def test_unknown_kit_file_fails_naming_the_part(self):
        errs = check(base(parts=[{"kit": "kaykit_hexagon", "file": "Assets/gltf/Not_A_Piece.gltf"}]))
        self.assertEqual(len(errs), 1, errs)
        self.assertIn("parts[0] (Assets/gltf/Not_A_Piece.gltf)", errs[0])
        self.assertIn("not listed in assets/kits/MANIFEST.json", errs[0])

    def test_wrong_id_fails(self):
        errs = check(base(id="cathedral"), "recipes/cathedral.json")
        self.assertTrue(any("'cathedral' is not a building or ship" in e for e in errs), errs)
        errs = check(base(), "recipes/church.json")
        self.assertTrue(any("file name must be chapel.json" in e for e in errs), errs)
        errs = check(base(id="road_dirt"), "recipes/road_dirt.json")
        self.assertTrue(any("roads have no model" in e for e in errs), errs)

    def test_content_rules(self):
        self.assertTrue(any("kind 'field'" in e for e in check(base(kind="field"))))
        house = {"id": "house_settlers", "kind": "building", "parts": [], "variants": [[], []]}
        self.assertTrue(any("exactly 3 variants" in e for e in check(house)))
        wh = {"id": "warehouse", "kind": "building", "parts": [], "levels": {"1": []}}
        self.assertTrue(any("levels must be ['1', '2']" in e for e in check(wh)))
        self.assertTrue(any("budget_exception is only allowed" in e for e in check({"id": "sawmill", "kind": "building", "parts": [], "budget_exception": {"reason": "a long enough reason"}})))
        ship = {"id": "sloop", "kind": "ship", "parts": []}
        self.assertTrue(any("ships need a ship block" in e for e in check(ship)))
        self.assertTrue(any("cylinder needs at least 3 segments" in e for e in check(base(parts=[{"prim": "cylinder", "radius": 1, "height": 1, "segments": 2, "role": "stone"}]))))
        self.assertTrue(any("primitives need a role" in e for e in check(base(parts=[{"prim": "box", "size": [1, 1, 1]}]))))

    def test_validator_subset(self):
        s = {"type": "object", "required": ["a"], "additionalProperties": False, "properties": {"a": {"oneOf": [{"type": "number"}, {"type": "string", "pattern": "^x"}]}}}
        self.assertEqual(schema.validate({"a": 1}, s), [])
        self.assertEqual(schema.validate({"a": "xy"}, s), [])
        self.assertTrue(schema.validate({"a": "y"}, s))
        self.assertTrue(schema.validate({}, s))
        with self.assertRaises(ValueError):
            schema.check_keywords({"type": "object", "if": {}})


if __name__ == "__main__":
    unittest.main()
