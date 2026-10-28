from __future__ import annotations

import pytest

from app.modules.assistant.application.data_retriever import AssistantDataRetriever, relative_date_filter
from app.modules.assistant.application.role_policy import (
    allowed_categories,
    can_access_category,
    canonical_roles,
)
from app.modules.assistant.application.service import AssistantService, normalize_query
from app.modules.assistant.domain.schemas import AssistantChatRequest, ChatMessage
from app.security.dependencies import CurrentUser


def user(role: str) -> CurrentUser:
    return CurrentUser(
        subject="test-user", username="test-user", roles=[role],
        permissions=[], raw_claims={},
    )


def test_role_aliases_and_category_boundaries() -> None:
    assert canonical_roles(["assembly manager"]) == {"ASSEMBLY"}
    assert allowed_categories(["GATE_SECURITY"]) == {"gate_entries", "docks", "dispatch"}
    assert can_access_category(["ASSEMBLY_MANAGER"], "assembly")
    assert not can_access_category(["ASSEMBLY_MANAGER"], "purchase_orders")
    assert can_access_category(["ADMIN"], "purchase_orders")


@pytest.mark.parametrize(
    ("query", "category"),
    [
        ("show GRNs waiting for unloading", "gate_entries"),
        ("list stock ageing and expiry", "inventory"),
        ("show pick waves ready to ship", "dispatch"),
        ("show bill of materials for production", "assembly"),
        ("show received stock placement", "putaway"),
        ("show warehouse space utilization", "locations"),
        ("show supplier quotations", "purchase_orders"),
    ],
)
def test_expanded_operational_patterns(query: str, category: str) -> None:
    assert AssistantDataRetriever().detect_category(query) == category


def test_common_spelling_variants_are_normalized() -> None:
    assert normalize_query("availble inventry in the warehosue") == "available inventory in the warehouse"
    assert normalize_query("quarentine quanity") == "quarantine quantity"


def test_plural_asn_and_relative_week_are_understood() -> None:
    assert AssistantDataRetriever().detect_category("ASNs in last one week") == "gate_entries"
    start, end, label = relative_date_filter("ASNs in last one week")
    assert start is not None and end is not None
    assert 6.99 <= (end - start).total_seconds() / 86400 <= 7.01
    assert label == "the last 7 days"


@pytest.mark.asyncio
async def test_help_is_specific_to_logged_in_role() -> None:
    response = await AssistantService().generate_reply(
        AssistantChatRequest(message="What can you do?"), user("GATE_SECURITY")
    )
    assert "Gate Security" in response.reply
    assert "gate entries" in response.reply
    assert "assembly" not in response.reply.lower()


@pytest.mark.asyncio
async def test_cross_role_lookup_is_denied_before_database_access() -> None:
    response = await AssistantService().generate_reply(
        AssistantChatRequest(message="Show active assembly orders"), user("GATE_SECURITY")
    )
    assert "not permitted" in response.reply


@pytest.mark.asyncio
async def test_admin_topics_are_hidden_from_operational_roles() -> None:
    response = await AssistantService().generate_reply(
        AssistantChatRequest(message="Show audit logs"), user("ASSEMBLY_MANAGER")
    )
    assert "administration-only" in response.reply


def test_short_follow_up_reuses_previous_operational_topic() -> None:
    service = AssistantService()
    request = AssistantChatRequest(
        message="What about pending ones?",
        history=[ChatMessage(role="user", content="Show dispatch orders")],
    )
    resolved = service._resolve_contextual_query(request, request.message)
    assert service.data_retriever.detect_category(resolved) == "dispatch"
