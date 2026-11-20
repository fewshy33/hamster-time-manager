import os
from datetime import UTC, date, datetime
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None, microsecond=0)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    profile: Mapped[dict] = mapped_column(JSON, default=dict)
    onboarded: Mapped[bool] = mapped_column(default=False)
    coins: Mapped[int] = mapped_column(default=0)
    revision: Mapped[int] = mapped_column(default=0)
    evening_seen: Mapped[date | None] = mapped_column(Date)


class Series(Base):
    __tablename__ = "series"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(24))
    rule: Mapped[dict] = mapped_column(JSON)
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("series_id", "occurrence_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    start_utc: Mapped[datetime] = mapped_column(DateTime, index=True)
    end_utc: Mapped[datetime] = mapped_column(DateTime)
    deadline_utc: Mapped[datetime | None] = mapped_column(DateTime)
    deadline_date_only: Mapped[bool] = mapped_column(default=False)
    series_id: Mapped[int | None] = mapped_column(ForeignKey("series.id"))
    occurrence_date: Mapped[date | None] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(24))
    priority: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="pending")
    report: Mapped[dict | None] = mapped_column(JSON)
    reported_utc: Mapped[datetime | None] = mapped_column(DateTime)
    awarded: Mapped[bool] = mapped_column(default=False)
    deleted: Mapped[bool] = mapped_column(default=False)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(12))
    text: Mapped[str] = mapped_column(Text)
    created_utc: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    revision: Mapped[int]
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_utc: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


engine = create_engine(
    os.getenv("DATABASE_URL", f"sqlite:///{(ROOT / 'hamster.sqlite3').as_posix()}"),
    connect_args={"check_same_thread": False, "timeout": 10},
)


@event.listens_for(engine, "connect")
def configure_sqlite(connection, _):
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")


def session_dependency():
    with Session(engine) as session:
        yield session


def begin_write(session: Session) -> None:
    # Serialize SQLite read-modify-write operations across requests and processes.
    session.execute(text("BEGIN IMMEDIATE"))
