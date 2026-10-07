from enum import Enum


class ReturnStatus(str, Enum):
    REQUESTED = "REQUESTED"
    APPROVED = "APPROVED"
    RECEIVED = "RECEIVED"
    DISPOSITIONED = "DISPOSITIONED"
