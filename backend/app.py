from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from .ai import PARSE_SCHEDULE, PLAN_CHAT, Provider, get_provider
from .auth import Identity, identify
from .calendar import (
    DAY, CalendarItem, apply_status, calendar_items, event_row, event_values,
    from_row, get_home, in_zone, iso_utc, replace_series,
)
from .db import ROOT, Base, Draft, Event, Message, Series, User, begin_write, engine, session_dependency, utc_now
from .planner import make_plan
from .schemas import (
    REPORT_LABELS, ChatInput, ChatReply, EventInput, Profile, ProfileSave,
    ReportInput, Rule, ScheduleReply, ScheduleText, Task, WORK_CATEGORIES,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Hamster Time Manager", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
Database = Annotated[Session, Depends(session_dependency)]
Actor = Annotated[Identity, Depends(identify)]
AI = Annotated[Provider, Depends(get_provider)]
DIST = ROOT / "frontend" / "dist"


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, exc: RequestValidationError):
    errors = exc.errors()
    messages = [
        str(error.get("ctx", {}).get("error", ""))
        for error in errors if error.get("ctx", {}).get("error")
    ]
    detail = messages[0] if messages else "Проверьте заполненные поля и формат даты, времени или числа."
    return JSONResponse(status_code=422, content={"detail": detail})


def user_for(db: Session, actor: Identity, *, onboarded: bool = True) -> User:
    user = db.get(User, actor.id)
    if not user:
        raise HTTPException(409, "Откройте главный экран приложения.")
    if onboarded and not user.onboarded:
        raise HTTPException(409, "Сначала завершите анкету.")
    return user


def profile_for(user: User) -> Profile:
    return Profile.model_validate(user.profile)


def zone_for(user: User) -> ZoneInfo:
    return ZoneInfo(profile_for(user).timezone)


def user_response(db: Session, user: User) -> dict:
    rules = db.scalars(select(Series).where(
        Series.user_id == user.id, Series.source == "profile", Series.ends_on.is_(None),
    ))
    return {
        "id": user.id, "name": user.name, "onboarded": user.onboarded,
        "profile": profile_for(user).model_dump(mode="json"),
        "schedule": [rule.rule for rule in rules],
    }


@app.get("/api/me")
def me(db: Database, actor: Actor):
    user = db.get(User, actor.id)
    if not user or user.name != actor.name:
        db.rollback()
        begin_write(db)
        user = db.get(User, actor.id)
        if not user:
            user = User(id=actor.id, name=actor.name)
            db.add(user)
        else:
            user.name = actor.name
        db.flush()
        result = user_response(db, user)
        db.commit()
        return result
    return user_response(db, user)


@app.put("/api/profile")
def save_profile(data: ProfileSave, db: Database, actor: Actor):
    begin_write(db)
    user = user_for(db, actor, onboarded=False)
    profile = data.profile
    today = in_zone(utc_now(), ZoneInfo(profile.timezone)).date()
    sleep_rule = Rule(title="Сон", category="sleep", days=list(range(7)), start=profile.sleep, end=profile.wake)
    replace_series(db, user, "sleep", [sleep_rule], today)
    if data.schedule is not None:
        replace_series(db, user, "profile", data.schedule, today)
    user.profile = profile.model_dump(mode="json")
    user.onboarded = True
    user.revision += 1
    db.flush()
    result = user_response(db, user)
    db.commit()
    return result


@app.post("/api/schedule/parse")
def parse_schedule(data: ScheduleText, db: Database, actor: Actor, provider: AI):
    user_for(db, actor, onboarded=False)
    db.rollback()
    return provider.generate(PARSE_SCHEDULE, {"текст": data.text}, ScheduleReply)


@app.get("/api/home")
def home(db: Database, actor: Actor):
    user = user_for(db, actor)
    return get_home(db, user, profile_for(user))


@app.post("/api/evening")
def seen_evening(db: Database, actor: Actor):
    begin_write(db)
    user = user_for(db, actor)
    user.evening_seen = in_zone(utc_now(), zone_for(user)).date()
    db.commit()
    return {"ok": True}


@app.get("/api/events")
def list_events(start: date, end: date, db: Database, actor: Actor):
    if not 1 <= (end - start).days <= 45 or not 1901 <= start.year <= end.year <= 9998:
        raise HTTPException(422, "Выберите диапазон от одного до 45 дней.")
    user = user_for(db, actor)
    return [item.public() for item in calendar_items(db, user, zone_for(user), start, end)]


@app.post("/api/events", status_code=201)
def create_event(data: EventInput, db: Database, actor: Actor):
    begin_write(db)
    user = user_for(db, actor)
    row = Event(user_id=user.id, **event_values(data, zone_for(user)))
    db.add(row)
    apply_status(user, row, data.status)
    user.revision += 1
    db.flush()
    result = from_row(row).public()
    db.commit()
    return result


@app.get("/api/events/{event_id}")
def read_event(event_id: str, db: Database, actor: Actor):
    user = user_for(db, actor)
    row = event_row(db, user, zone_for(user), event_id)
    item = from_row(row)
    if row.id is None:
        item.id = event_id
    return item.public()


@app.put("/api/events/{event_id}")
def update_event(event_id: str, data: EventInput, db: Database, actor: Actor):
    begin_write(db)
    user = user_for(db, actor)
    zone = zone_for(user)
    row = event_row(db, user, zone, event_id, create=True)
    values = event_values(data, zone)
    if row.status != data.status:
        row.report = None
        row.reported_utc = None
    for key, value in values.items():
        setattr(row, key, value)
    apply_status(user, row, data.status)
    user.revision += 1
    db.flush()
    result = from_row(row).public()
    db.commit()
    return result


@app.delete("/api/events/{event_id}")
def delete_event(event_id: str, db: Database, actor: Actor):
    begin_write(db)
    user = user_for(db, actor)
    row = event_row(db, user, zone_for(user), event_id, create=True)
    row.deleted = True
    user.revision += 1
    db.commit()
    return {"ok": True}


def pending_draft(db: Session, user: User, draft_id: int) -> Draft:
    draft = db.get(Draft, draft_id)
    if not draft or draft.user_id != user.id:
        raise HTTPException(404, "Черновик не найден.")
    return draft


def message_public(message: Message) -> dict:
    return {"id": message.id, "role": message.role, "text": message.text, "at": iso_utc(message.created_utc)}


def messages_for(db: Session, user: User, limit: int) -> list[dict]:
    messages = db.scalars(select(Message).where(Message.user_id == user.id).order_by(Message.id.desc()).limit(limit))
    return [message_public(message) for message in reversed(list(messages))]


def draft_public(draft: Draft) -> dict:
    return {"id": draft.id, "kind": draft.kind, **{
        key: draft.payload[key] for key in ("events", "warnings", "alternatives", "start_date")
    }}


@app.get("/api/chat")
def chat_history(db: Database, actor: Actor):
    user = user_for(db, actor)
    draft = db.scalar(select(Draft).where(
        Draft.user_id == user.id, Draft.kind == "chat", Draft.status == "pending", Draft.revision == user.revision,
    ).order_by(Draft.id.desc()).limit(1))
    return {"messages": messages_for(db, user, 60), "draft": draft_public(draft) if draft else None}


def deadline_context(item: CalendarItem, zone: ZoneInfo) -> str | None:
    if item.deadline_utc is None:
        return None
    deadline = in_zone(item.deadline_utc, zone)
    return deadline.date().isoformat() if item.deadline_date_only else deadline.isoformat()


def ai_calendar(item: CalendarItem, zone: ZoneInfo) -> dict:
    return {
        "название": item.title, "категория": item.category,
        "начало": in_zone(item.start_utc, zone).isoformat(),
        "окончание": in_zone(item.end_utc, zone).isoformat(),
        "дедлайн": deadline_context(item, zone),
        "приоритет": item.priority, "статус": item.status,
    }


@app.post("/api/chat")
def chat(data: ChatInput, db: Database, actor: Actor, provider: AI):
    begin_write(db)
    user = user_for(db, actor)
    profile = profile_for(user)
    zone = ZoneInfo(profile.timezone)
    now = utc_now()
    today = in_zone(now, zone).date()
    if not today <= data.start_date <= today + 365 * DAY:
        raise HTTPException(422, "Выберите начало недели в пределах ближайшего года.")
    end = data.start_date + 7 * DAY
    revision = user.revision
    previous = None
    if data.draft_id is not None:
        draft = pending_draft(db, user, data.draft_id)
        if draft.kind != "chat" or draft.status != "pending" or draft.revision != revision:
            raise HTTPException(409, "Черновик уже изменился. Откройте актуальный план.")
        previous = draft.payload.get("request")
    existing = calendar_items(db, user, zone, data.start_date - DAY, end + DAY)
    reports = list(db.scalars(select(Event).where(
        Event.user_id == user.id, Event.category.in_(WORK_CATEGORIES), Event.status.in_(REPORT_LABELS),
        Event.deleted.is_(False), Event.end_utc <= now,
    ).order_by(Event.end_utc.desc()).limit(20)))
    rate = sum(event.status == "completed" for event in reports) / len(reports) if reports else None
    context = {
        "сегодня": today.isoformat(), "сейчас": in_zone(now, zone).isoformat(),
        "план_с": data.start_date.isoformat(), "план_по": (end - DAY).isoformat(),
        "анкета": user.profile, "календарь": [ai_calendar(item, zone) for item in existing[:120]],
        "итоги_выполнения": [{"название": event.title, "итог": event.status} for event in reports[:15]],
        "история": messages_for(db, user, 18), "изменяемый_черновик": previous, "сообщение": data.text,
    }
    user_message = Message(user_id=user.id, role="user", text=data.text)
    db.add(user_message)
    db.flush()
    sent_id = user_message.id
    db.commit()

    answer = provider.generate(PLAN_CHAT, context, ChatReply)

    begin_write(db)
    user = user_for(db, actor)
    latest_user_message = db.scalar(select(Message.id).where(
        Message.user_id == user.id, Message.role == "user",
    ).order_by(Message.id.desc()).limit(1))
    if user.revision != revision or latest_user_message != sent_id:
        raise HTTPException(409, "Пока ИИ отвечал, данные изменились. Отправьте запрос ещё раз.")
    feedback = answer.reply or "Уточните, что вы хотите запланировать."
    new_draft = None
    if not answer.needs_clarification and (answer.tasks or answer.events):
        result = make_plan(answer.tasks, answer.events, data.start_date, utc_now(), profile, existing, rate)
        result["start_date"] = data.start_date.isoformat()
        result["request"] = answer.model_dump(mode="json")
        for old in db.scalars(select(Draft).where(
            Draft.user_id == user.id, Draft.kind == "chat", Draft.status == "pending",
        )):
            old.status = "cancelled"
        if result["warnings"]:
            feedback += "\n\nЧасть работы не помещается в доступное время. Что для вас сейчас важнее?"
        new_draft = Draft(user_id=user.id, kind="chat", revision=revision, payload=result)
        db.add(new_draft)
    reply = Message(user_id=user.id, role="assistant", text=feedback)
    db.add(reply)
    db.flush()
    response = {"message": message_public(reply), "draft": draft_public(new_draft) if new_draft else None}
    db.commit()
    return response


@app.post("/api/events/{event_id}/report")
def report(event_id: str, data: ReportInput, db: Database, actor: Actor):
    begin_write(db)
    user = user_for(db, actor)
    profile = profile_for(user)
    zone = ZoneInfo(profile.timezone)
    row = event_row(db, user, zone, event_id, create=True)
    if row.category not in WORK_CATEGORIES:
        raise HTTPException(422, "Отчёты доступны для учебных задач и сессий.")
    apply_status(user, row, data.status)
    row.report = data.model_dump(mode="json")
    now = utc_now()
    row.reported_utc = now
    user.revision += 1
    db.flush()
    proposal = None
    if data.remaining_minutes is not None and data.status != "completed":
        today = in_zone(now, zone).date()
        end = today + 7 * DAY
        existing = calendar_items(db, user, zone, today - DAY, end + DAY)
        deadline = in_zone(row.deadline_utc, zone) if row.deadline_utc else None
        task = Task(
            title=row.title, description=data.remaining, category=row.category, minutes=data.remaining_minutes,
            priority=row.priority, difficulty=2, deadline=deadline.date() if deadline else None,
            deadline_time=deadline.time() if deadline and not row.deadline_date_only else None,
        )
        result = make_plan([task], [], today, now, profile, existing, None)
        result["start_date"] = today.isoformat()
        proposal = Draft(user_id=user.id, kind="report", revision=user.revision, payload=result)
        db.add(proposal)
        db.flush()
    result = {"event": from_row(row).public(), "coins": user.coins, "draft": draft_public(proposal) if proposal else None}
    db.commit()
    return result


@app.post("/api/drafts/{draft_id}/{action}")
def decide_draft(draft_id: int, action: Literal["accept", "cancel"], db: Database, actor: Actor):
    begin_write(db)
    user = user_for(db, actor)
    draft = pending_draft(db, user, draft_id)
    desired = "accepted" if action == "accept" else "cancelled"
    if draft.status == desired:
        return {"status": desired}
    if draft.status != "pending":
        raise HTTPException(409, "Этот черновик уже закрыт.")
    if action == "accept":
        if draft.revision != user.revision:
            raise HTTPException(409, "Календарь изменился после расчёта. Запросите новый план.")
        events = draft.payload["events"]
        if not events:
            raise HTTPException(422, "В черновике нет интервалов для сохранения.")
        now = utc_now()
        for item in events:
            start = datetime.fromisoformat(item["start_utc"]).replace(tzinfo=None)
            if start < now:
                raise HTTPException(409, "Часть черновика уже в прошлом. Запросите новый план.")
            db.add(Event(
                user_id=user.id, title=item["title"], category=item["category"],
                start_utc=start, end_utc=datetime.fromisoformat(item["end_utc"]).replace(tzinfo=None),
                priority=item["priority"], description=item["description"],
                deadline_date_only=item["deadline_date_only"], deadline_utc=datetime.fromisoformat(item["deadline_utc"]).replace(tzinfo=None) if item["deadline_utc"] else None,
            ))
        user.revision += 1
    draft.status = desired
    if draft.kind == "chat":
        db.add(Message(user_id=user.id, role="assistant", text="План добавлен в календарь." if action == "accept" else "Черновик отменён."))
    db.commit()
    return {"status": desired}


@app.get("/", include_in_schema=False)
def frontend():
    if not (DIST / "index.html").is_file():
        raise HTTPException(503, "Сначала соберите интерфейс командой npm run build в папке frontend.")
    return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})


app.mount("/assets", StaticFiles(directory=DIST / "assets", check_dir=False), name="assets")
app.mount("/art", StaticFiles(directory=DIST / "art", check_dir=False), name="art")
