from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Event, Series, User, utc_now
from .schemas import EventInput, Profile, Rule, WORK_CATEGORIES

DAY = timedelta(days=1)
RULE_ID_PREFIX = "r"
MINUTE = timedelta(minutes=1)


def to_utc(local: datetime, zone: ZoneInfo, *, strict: bool = False) -> datetime:
    aware = local.replace(tzinfo=zone)
    if strict and aware.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != local:
        raise HTTPException(422, "Это местное время пропущено при переводе часов. Выберите другое время.")
    return aware.astimezone(UTC).replace(tzinfo=None)


def in_zone(instant: datetime, zone: ZoneInfo) -> datetime:
    return instant.replace(tzinfo=UTC).astimezone(zone)


def iso_utc(instant: datetime | None) -> str | None:
    return instant.isoformat(timespec="seconds") + "Z" if instant else None


def days_between(first: date, last: date):
    return (first + DAY * offset for offset in range((last - first).days))


def day_start(day: date, zone: ZoneInfo) -> datetime:
    return to_utc(datetime.combine(day, time.min), zone)


def local_interval(day: date, start: time, end: time, zone: ZoneInfo) -> tuple[datetime, datetime]:
    return (
        to_utc(datetime.combine(day, start), zone),
        to_utc(datetime.combine(day + (DAY if end <= start else timedelta()), end), zone),
    )


@dataclass
class CalendarItem:
    id: str
    title: str
    category: str
    start_utc: datetime
    end_utc: datetime
    deadline_utc: datetime | None = None
    deadline_date_only: bool = False
    priority: int = 2
    description: str = ""
    status: str = "pending"
    report: dict | None = None
    recurring: bool = False

    def public(self) -> dict:
        data = asdict(self)
        for key in ("start_utc", "end_utc", "deadline_utc"):
            data[key] = iso_utc(data[key])
        data["minutes"] = round((self.end_utc - self.start_utc) / MINUTE)
        return data


def from_row(row: Event) -> CalendarItem:
    return CalendarItem(
        id=str(row.id), title=row.title, category=row.category, start_utc=row.start_utc,
        end_utc=row.end_utc, deadline_utc=row.deadline_utc,
        deadline_date_only=bool(row.deadline_date_only), priority=row.priority,
        description=row.description, status=row.status, report=row.report,
        recurring=row.series_id is not None,
    )


def from_rule(series: Series, rule: Rule, day: date, zone: ZoneInfo) -> CalendarItem | None:
    start, end = local_interval(day, rule.start, rule.end, zone)
    if end <= start:
        return None
    return CalendarItem(
        f"{RULE_ID_PREFIX}{series.id}.{day.isoformat()}", rule.title, rule.category, start, end,
        description=rule.description, recurring=True,
    )


def calendar_items(db: Session, user: User, zone: ZoneInfo, first: date, last: date) -> list[CalendarItem]:
    low, high = day_start(first, zone), day_start(last, zone)
    rows = db.scalars(select(Event).where(
        Event.user_id == user.id, Event.deleted.is_(False),
        Event.start_utc < high, Event.end_utc > low,
    ))
    items = [from_row(row) for row in rows]
    overrides = set(db.execute(select(Event.series_id, Event.occurrence_date).where(
        Event.user_id == user.id, Event.series_id.is_not(None),
        Event.occurrence_date >= first - DAY, Event.occurrence_date < last,
    )).tuples())
    series = db.scalars(select(Series).where(
        Series.user_id == user.id, Series.starts_on < last,
        (Series.ends_on.is_(None) | (Series.ends_on >= first - DAY)),
    ))
    for schedule in series:
        rule = Rule.model_validate(schedule.rule)
        for day in days_between(max(first - DAY, schedule.starts_on), min(last, (schedule.ends_on or last) + DAY)):
            if day.weekday() in rule.days and (schedule.id, day) not in overrides:
                item = from_rule(schedule, rule, day, zone)
                if item and item.start_utc < high and item.end_utc > low:
                    items.append(item)
    return sorted(items, key=lambda item: (item.start_utc, item.end_utc, item.id))


def event_row(db: Session, user: User, zone: ZoneInfo, event_id: str, *, create: bool = False) -> Event:
    try:
        if not event_id.startswith(RULE_ID_PREFIX):
            row = db.get(Event, int(event_id))
            if row and row.user_id == user.id and not row.deleted:
                return row
            raise ValueError
        key, value = event_id[1:].split(".", 1)
        series = db.get(Series, int(key))
        day = date.fromisoformat(value)
        if not series or series.user_id != user.id or day < series.starts_on or (
            series.ends_on is not None and day > series.ends_on
        ):
            raise ValueError
        rule = Rule.model_validate(series.rule)
        occurrence = from_rule(series, rule, day, zone) if day.weekday() in rule.days else None
        if occurrence is None:
            raise ValueError
        override = db.scalar(select(Event).where(Event.series_id == series.id, Event.occurrence_date == day))
        if override:
            if override.deleted:
                raise ValueError
            return override
        row = Event(
            user_id=user.id, series_id=series.id, occurrence_date=day, title=occurrence.title,
            category=occurrence.category, start_utc=occurrence.start_utc, end_utc=occurrence.end_utc,
            priority=occurrence.priority, description=occurrence.description, status="pending",
        )
        if create:
            db.add(row)
        return row
    except (OverflowError, ValueError):
        raise HTTPException(404, "Событие не найдено.") from None


def event_values(data: EventInput, zone: ZoneInfo) -> dict:
    start = to_utc(data.start, zone, strict=True)
    end = to_utc(data.end, zone, strict=True)
    deadline = data.deadline
    if deadline and data.deadline_date_only:
        deadline = datetime.combine(deadline.date(), time(23, 59, 59))
    deadline_utc = to_utc(deadline, zone, strict=True) if deadline else None
    if end <= start:
        raise HTTPException(422, "Окончание должно быть позже начала.")
    return {
        "title": data.title, "category": data.category, "start_utc": start, "end_utc": end,
        "deadline_utc": deadline_utc, "deadline_date_only": data.deadline_date_only,
        "priority": data.priority, "description": data.description,
        "status": data.status,
    }


def apply_status(user: User, row: Event, status: str) -> None:
    row.status = status
    if status == "pending":
        row.report = None
        row.reported_utc = None
    if status == "completed" and row.category in WORK_CATEGORIES and not row.awarded:
        row.awarded = True
        user.coins += 10


def replace_series(db: Session, user: User, source: str, rules: list[Rule], today: date) -> None:
    previous = list(db.scalars(select(Series).where(
        Series.user_id == user.id, Series.source == source, Series.ends_on.is_(None),
    )))
    remaining = list(rules)
    for series in previous:
        existing = Rule.model_validate(series.rule)
        if existing in remaining:
            remaining.remove(existing)
        else:
            series.ends_on = today - DAY
    starts_on = today - DAY if source == "sleep" and not previous else today
    for rule in remaining:
        db.add(Series(user_id=user.id, source=source, rule=rule.model_dump(mode="json"), starts_on=starts_on))


def get_home(db: Session, user: User, profile: Profile) -> dict:
    zone = ZoneInfo(profile.timezone)
    now = utc_now()
    local = in_zone(now, zone)
    today = local.date()
    items = calendar_items(db, user, zone, today - 7 * DAY, today + 15 * DAY)
    active = [item for item in items if item.start_utc <= now < item.end_utc]
    rank = {"sleep": 0, "study": 1, "task": 1, "university": 1}
    current = min(active, key=lambda item: (rank.get(item.category, 2), item.start_utc), default=None)
    next_item = next((item for item in items if item.start_utc > now), None)
    recent_work = any(
        item.category in WORK_CATEGORIES | {"university"}
        and timedelta() <= now - item.end_utc < timedelta(minutes=15)
        for item in items
    )
    if current and current.category == "sleep":
        state = "sleeping"
    elif current and current.category in WORK_CATEGORIES | {"university"}:
        state = "working"
    elif recent_work and not any(item.category == "break" for item in active):
        state = "tired"
    else:
        state = "idle"
    reports = [
        item.public() for item in reversed(items)
        if item.category in WORK_CATEGORIES and item.status == "pending" and item.end_utc <= now
    ][:5] if profile.reminders in {"both", "reports"} else []
    evening = None
    if profile.reminders in {"both", "evening"} and user.evening_seen != today and local.time() >= profile.evening_time:
        work_today = [item for item in items if item.category in WORK_CATEGORIES and in_zone(item.start_utc, zone).date() == today]
        evening = {
            "completed": sum(item.status == "completed" for item in work_today),
            "open": sum(item.status != "completed" for item in work_today),
        }
    changes = [instant for item in items for instant in (item.start_utc, item.end_utc) if instant > now]
    changes.extend(
        item.end_utc + timedelta(minutes=15) for item in items
        if item.category in WORK_CATEGORIES | {"university"} and item.end_utc <= now < item.end_utc + timedelta(minutes=15)
    )
    if profile.reminders in {"both", "evening"} and user.evening_seen != today:
        evening_at = to_utc(datetime.combine(today, profile.evening_time), zone)
        if evening_at > now:
            changes.append(evening_at)
    refresh = min(changes, default=None)
    return {
        "refresh_in_ms": round((refresh - now).total_seconds() * 1000) if refresh else None,
        "state": state, "current": current.public() if current else None,
        "next": next_item.public() if next_item else None, "reports": reports,
        "coins": user.coins, "evening": evening,
    }
