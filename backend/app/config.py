"""Configuración leída del entorno o de ~/.mayrit/.env (fuera de OneDrive)."""
import os
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV = os.path.join(os.path.expanduser("~"), ".mayrit", ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV, env_file_encoding="utf-8", extra="ignore")

    pg_host: str = ""
    pg_port: int = 5432
    pg_database: str = "mayrit"
    pg_user: str = ""
    pg_password: str = ""
    pg_sslmode: str = "require"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.pg_user}:{self.pg_password}"
            f"@{self.pg_host}:{self.pg_port}/{self.pg_database}?sslmode={self.pg_sslmode}"
        )


settings = Settings()
