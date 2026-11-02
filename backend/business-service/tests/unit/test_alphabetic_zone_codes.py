import unittest
from app.modules.warehouse.infrastructure.api.location_router import _next_alphabetic_zone_code

class AlphabeticZoneCodeTests(unittest.TestCase):
    def test_first_zone(self):
        self.assertEqual(_next_alphabetic_zone_code([]), "ZONE-A")
    def test_sequence(self):
        self.assertEqual(_next_alphabetic_zone_code(["ZONE-A", "ZONE-B"]), "ZONE-C")
    def test_legacy_codes_continue_sequence(self):
        self.assertEqual(_next_alphabetic_zone_code(["ZONE-001", "ZONE-002"]), "ZONE-C")
    def test_after_z(self):
        self.assertEqual(_next_alphabetic_zone_code(["ZONE-Z"]), "ZONE-AA")
        self.assertEqual(_next_alphabetic_zone_code(["ZONE-AA"]), "ZONE-AB")
