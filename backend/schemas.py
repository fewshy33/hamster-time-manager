from datetime import date, datetime, time
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

Category = Literal["university", "gym", "personal", "event", "sleep", "study", "task", "deadline", "break", "travel"]
Status = Literal["pending", "completed", "partial", "missed"]
WorkStatus = Literal["completed", "partial", "missed"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
WORK_CATEGORIES = {"study", "task"}
REPORT_LABELS = {"completed": "Выполнено", "partial": "Частично", "missed": "Не выполнено"}


class Profile(BaseModel):
    timezone: str = Field(default="Europe/Moscow", max_length=100)
    sleep: time = time(23)
    wake: time = time(7)
    university: ShortText = ""
    travel_minutes: int = Field(default=0, ge=0, le=240)
    gym: ShortText = ""
    regular: ShortText = ""
    personal: ShortText = ""
    study_from: time = time(8)
    study_to: time = time(22)
    study_days: list[Annotated[int, Field(ge=0, le=6)]] = Field(default_factory=lambda: list(range(7)), max_length=7)
    availability: ShortText = ""
    desired_hours: float | None = Field(default=None, ge=0, le=112, allow_inf_nan=False)
    realistic_hours: float | None = Field(default=None, ge=0, le=112, allow_inf_nan=False)
    focus_from: time | None = None
    focus_to: time | None = None
    session_minutes: int = Field(default=50, ge=15, le=180)
    procrastination: ShortText = ""
    obstacles: ShortText = ""
    style: Literal["balanced", "brief", "supportive"] = "balanced"
    reminders: Literal["off", "reports", "evening", "both"] = "both"
    evening_time: time = time(20)

    @field_validator("timezone")
    @classmethod
    def check_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError("Введите часовой пояс IANA, например Europe/Moscow.") from None
        return value

    @field_validator("sleep", "wake", "study_from", "study_to", "focus_from", "focus_to", "evening_time")
    @classmethod
    def local_time(cls, value: time | None) -> time | None:
        if value is not None and value.tzinfo is not None:
            raise ValueError("Укажите местное время без смещения.")
        return value

    @model_validator(mode="after")
    def check_times(self):
        if self.sleep == self.wake or self.study_from == self.study_to:
            raise ValueError("Начало и конец интервала должны различаться.")
        if bool(self.focus_from) != bool(self.focus_to) or (
            self.focus_from is not None and self.focus_from == self.focus_to
        ):
            raise ValueError("Укажите начало и конец часов концентрации или оставьте оба поля пустыми.")
        return self


class Rule(BaseModel):
    title: Title
    category: Literal["university", "gym", "personal", "event", "sleep", "study", "break", "travel"]
    days: list[Annotated[int, Field(ge=0, le=6)]] = Field(min_length=1, max_length=7)
    start: time
    end: time
    description: ShortText = ""

    @model_validator(mode="after")
    def valid_interval(self):
        if self.start == self.end or self.start.tzinfo is not None or self.end.tzinfo is not None:
            raise ValueError("Укажите разные начало и конец по местному времени.")
        self.days = sorted(set(self.days))
        return self


class ProfileSave(BaseModel):
    profile: Profile
    schedule: list[Rule] | None = Field(default=None, max_length=60)


class ScheduleText(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=4000)]


class ScheduleReply(BaseModel):
    reply: str = Field(max_length=2000)
    rules: list[Rule] = Field(max_length=60)


class EventInput(BaseModel):
    title: Title
    category: Category
    start: datetime
    end: datetime
    deadline: datetime | None = None
    deadline_date_only: bool = False
    priority: int = Field(default=2, ge=1, le=3)
    description: ShortText = ""
    status: Status = "pending"

    @model_validator(mode="after")
    def check_local_times(self):
        dates = [value for value in (self.start, self.end, self.deadline) if value is not None]
        if any(value.tzinfo is not None for value in dates):
            raise ValueError("Укажите дату и время без смещения часового пояса.")
        if any(not 1901 <= value.year <= 9998 for value in dates):
            raise ValueError("Год события должен быть в пределах от 1901 до 9998.")
        if self.end <= self.start:
            raise ValueError("Окончание должно быть позже начала.")
        if self.deadline_date_only and self.deadline is None:
            raise ValueError("Для дедлайна укажите дату.")
        return self


class ChatInput(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=3000)]
    start_date: date
    draft_id: int | None = None


class Task(BaseModel):
    title: Title
    description: ShortText = ""
    category: Literal["study", "task"] = "study"
    minutes: int = Field(ge=5, le=2400)
    deadline: date | None
    deadline_time: time | None = None
    priority: int = Field(ge=1, le=3)
    difficulty: int = Field(ge=1, le=3)

    @model_validator(mode="after")
    def valid_deadline(self):
        if self.deadline is not None and not 1901 <= self.deadline.year <= 9998:
            raise ValueError("Недопустимый год дедлайна.")
        if self.deadline_time is not None and (self.deadline is None or self.deadline_time.tzinfo is not None):
            raise ValueError("Время дедлайна требует даты и указывается по местному времени.")
        return self


class FixedEvent(BaseModel):
    title: Title
    category: Category
    day: date
    start: time
    end: time
    priority: int = Field(default=2, ge=1, le=3)
    description: ShortText = ""

    @model_validator(mode="after")
    def valid_interval(self):
        if not 1901 <= self.day.year <= 9998:
            raise ValueError("Недопустимый год события.")
        if self.start == self.end or self.start.tzinfo is not None or self.end.tzinfo is not None:
            raise ValueError("Укажите разные начало и конец по местному времени.")
        return self


class ChatReply(BaseModel):
    reply: str = Field(max_length=3000)
    needs_clarification: bool
    tasks: list[Task] = Field(max_length=30)
    events: list[FixedEvent] = Field(max_length=30)


class ReportInput(BaseModel):
    status: WorkStatus
    comment: ShortText = ""
    done: ShortText = ""
    remaining: ShortText = ""
    obstacle: ShortText = ""
    remaining_minutes: int | None = Field(default=None, ge=5, le=720)

    @model_validator(mode="after")
    def check_remaining(self):
        if self.status != "completed" and (not self.remaining or not self.remaining_minutes):
            raise ValueError("Укажите, что осталось сделать и сколько минут понадобится.")
        return self
