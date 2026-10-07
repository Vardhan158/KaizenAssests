from enum import Enum


class ReturnReason(str, Enum):
    DAMAGED = "DAMAGED"
    WRONG_ITEM = "WRONG_ITEM"
    QUALITY_ISSUE = "QUALITY_ISSUE"
    NO_LONGER_NEEDED = "NO_LONGER_NEEDED"
