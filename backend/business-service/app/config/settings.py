"""
Central application configuration.

All values are overridable via environment variables (12-factor style).
See .env.example at the service root for the full list.
"""
from functools import lru_cache
from typing import List

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "business-service/.env", "../business-service/.env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # --- Service identity -------------------------------------------------
    service_name: str = "business-service"
    environment: str = Field(default="local")  # local | dev | staging | prod
    api_prefix: str = "/api"
    log_level: str = "INFO"
    log_json: bool = Field(default=False)

    # --- Database -----------------------------------------------------------
    database_url: str = Field(
        default="postgresql+asyncpg://ams_business:ams_business@localhost:5432/ams_business",
        description="Async SQLAlchemy URL for the business database (one DB per deployable unit).",
    )
    database_pool_size: int = 10
    database_max_overflow: int = 20
    database_echo: bool = False
    startup_schema_compatibility: bool = False

    # --- Auth / JWT (validated locally, never call the Java service per-request) ---
    auth_service_base_url: str = Field(default="http://auth-service:8080")
    jwt_jwks_url: str = Field(
        default="http://auth-service:8080/.well-known/jwks.json",
        description="JWKS endpoint on the Java auth-service; fetched and cached, not called per-request.",
    )
    jwt_issuer: str = Field(default="ams-auth-service")
    jwt_audience: str = Field(default="ams-business-service")
    jwt_algorithm: str = Field(default="RS256")
    jwks_cache_ttl_seconds: int = Field(default=300)
    local_session_lifetime_minutes: int = Field(default=60, ge=5, le=1440)
    login_max_failures: int = Field(default=5, ge=3, le=20)
    login_lockout_minutes: int = Field(default=15, ge=1, le=1440)

    # --- Kafka ---------------------------------------------------------------
    kafka_bootstrap_servers: str = Field(default="localhost:9092")
    kafka_client_id: str = Field(default="business-service")
    kafka_topic_prefix: str = Field(default="ams")
    kafka_consumer_group: str = Field(default="business-service-notification")
    kafka_security_protocol: str = Field(default="PLAINTEXT")

    # --- Redis (caching, rate limiting, idempotency keys) ---------------------
    redis_url: str = Field(default="redis://localhost:6379/0")

    # --- Outbox relay ----------------------------------------------------------
    outbox_poll_interval_seconds: int = Field(default=2)
    outbox_batch_size: int = Field(default=100)

    # --- Gemini document extraction ------------------------------------------
    gemini_api_key: str = Field(default="")
    gemini_model: str = Field(default="gemini-3.1-flash-lite-preview")

    # --- CORS ------------------------------------------------------------------
    cors_allow_origins: List[str] = Field(default_factory=lambda: ["http://localhost:8080", "http://127.0.0.1:8080"])
    trusted_hosts: List[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1"])
    force_https: bool = Field(default=False)
    enable_api_docs: bool = Field(default=True, description="Enable OpenAPI docs and Swagger UI. Should be disabled in production.")

    # --- Observability -----------------------------------------------------------
    otel_exporter_otlp_endpoint: str = Field(default="http://otel-collector:4317")
    otel_enabled: bool = Field(default=False)
    prometheus_enabled: bool = Field(default=True)

    # --- Role Credentials ---------------------------------------------------------
    warehouse_username: str = Field(default="warehouse")
    warehouse_password: str = Field(default="")
    manager_username: str = Field(default="manager")
    manager_password: str = Field(default="", description="Manager login secret.")
    assembly_manager_username: str = Field(default="assembly_manager")
    assembly_manager_password: str = Field(default="")
    gate_security_username: str = Field(default="gate_entry")
    gate_security_password: str = Field(default="")
    gate_entry_username: str = Field(default="gate_entry")
    gate_entry_password: str = Field(default="")
    supplier_username: str = Field(default="supplier")
    supplier_password: str = Field(default="")
    grn_username: str = Field(default="grn")
    grn_password: str = Field(default="")
    magic_link_secret: str = Field(default="")

    # --- Email SMTP Settings ----------------------------------------------------
    email_host: str = Field(default="smtp.gmail.com")
    email_port: int = Field(default=587)
    email_timeout_seconds: int = Field(default=8, ge=1, le=60)
    email_host_user: str = Field(default="")
    email_host_password: str = Field(default="")
    email_from_name: str = Field(default="KaizenAssests")

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.environment.lower() not in {"prod", "production"}:
            return self
        unsafe_origins = {
            origin
            for origin in self.cors_allow_origins
            if "localhost" in origin or "127.0.0.1" in origin or origin == "*"
        }
        if not self.cors_allow_origins or unsafe_origins:
            raise ValueError("Production CORS origins must be explicit non-local HTTPS origins")
        if any(host in {"*", "localhost", "127.0.0.1"} for host in self.trusted_hosts):
            raise ValueError("Production trusted hosts must contain only deployed hostnames")
        if not self.force_https:
            raise ValueError("FORCE_HTTPS must be enabled in production")
        if self.enable_api_docs:
            raise ValueError("API documentation must be disabled in production")
        if self.startup_schema_compatibility:
            raise ValueError("Runtime schema compatibility must be disabled in production")
        database_url = self.database_url.lower()
        if "sslmode=verify-full" not in database_url and "ssl=verify-full" not in database_url:
            raise ValueError("Production database connections must enforce certificate verification")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()

