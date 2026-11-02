"""
Schemas and domain definitions for the Kaizen AMS Assistant.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal
from pydantic import BaseModel, Field, field_validator


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"] = Field(
        ..., description="Role of the message author: 'user', 'assistant', or 'system'"
    )
    content: str = Field(..., min_length=1, max_length=8000, description="Message text content")

    @field_validator("content")
    @classmethod
    def content_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Message content cannot be empty or whitespace only")
        return v.strip()


class AssistantChatRequest(BaseModel):
    message: str = Field(
        ...,
        min_length=1,
        max_length=4000,
        description="User question or prompt for the assistant",
    )
    history: List[ChatMessage] = Field(
        default_factory=list,
        max_length=50,
        description="Optional list of prior conversation messages",
    )

    @field_validator("message")
    @classmethod
    def message_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Query message cannot be empty or whitespace only")
        return v.strip()


class AssistantChatResponse(BaseModel):
    reply: str = Field(..., description="Assistant response text")
    model: str = Field(..., description="Assistant response engine")
    role: Literal["assistant"] = "assistant"
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp of response",
    )

