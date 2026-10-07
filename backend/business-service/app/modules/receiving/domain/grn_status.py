from enum import Enum


class GrnStatus(str, Enum):
    GRN_DRAFT = "GRN_DRAFT"
    GRN_POSTED = "GRN_POSTED"
    CONFIRMED = "CONFIRMED"
    UNDER_INSPECTION = "UNDER_INSPECTION"
    PUT_AWAY = "PUT_AWAY"
    REJECTED = "REJECTED"
