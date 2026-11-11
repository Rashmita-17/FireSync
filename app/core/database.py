import os
import logging
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from typing import Generator
from app.core.config import settings

logger = logging.getLogger("nasa_fire_harmonization.database")

def create_db_engine(db_url: str):
    engine_kwargs = {}
    if db_url.startswith("sqlite"):
        db_path = db_url.replace("sqlite:///", "")
        if db_path and db_path != ":memory:":
            Path(os.path.dirname(os.path.abspath(db_path))).mkdir(parents=True, exist_ok=True)
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    else:
        engine_kwargs["pool_pre_ping"] = True
        engine_kwargs["pool_size"] = 10
        engine_kwargs["max_overflow"] = 20
    return create_engine(db_url, **engine_kwargs)

active_db_url = settings.DATABASE_URL
try:
    engine = create_db_engine(active_db_url)
    # Test connection
    with engine.connect() as conn:
        pass
except Exception as exc:
    logger.warning(
        f"Unable to connect to primary database ({active_db_url}): {exc}. "
        "Falling back to local SQLite database at sqlite:///data/nasa_observations.db"
    )
    active_db_url = "sqlite:///data/nasa_observations.db"
    engine = create_db_engine(active_db_url)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Declarative Base
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that provides an isolated SQLAlchemy database session per request.
    Closes automatically after the request finishes.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Initialize database schema (create all tables if they don't exist).
    """
    # Import models here to register them with Base.metadata before creating tables
    import app.models.observation  # noqa: F401
    Base.metadata.create_all(bind=engine)

