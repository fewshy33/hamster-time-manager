from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .calendar import DAY, MINUTE, CalendarItem, day_start, days_between, in_zone, local_interval, to_utc
from .schemas import FixedEvent, Profile, Task, WORK_CATEGORIES

REST = 10 * MINUTE


@dataclass
class Slot:
    start: datetime
    end: datetime
    day: date


@dataclass
class Work:
    task: Task
    deadline: datetime | None
    left: int
    score: float


def conflicts(start: datetime, end: datetime, busy: list[CalendarItem]) -> bool:
    return any(item.start_utc < end and item.end_utc > start for item in busy)


def with_commute(items: list[CalendarItem], zone: ZoneInfo, minutes: int) -> list[CalendarItem]:
    if not minutes:
        return items.copy()
    busy = items.copy()
    classes: dict[date, list[CalendarItem]] = {}
    for item in items:
        if item.category == "university":
            classes.setdefault(in_zone(item.start_utc, zone).date(), []).append(item)
    for day, events in classes.items():
        arrival = min(event.start_utc for event in events)
        departure = max(event.end_utc for event in events)
        duration = minutes * MINUTE
        busy.extend([
            CalendarItem(f"travel-{day}-in", "Дорога до университета", "travel", arrival - duration, arrival),
            CalendarItem(f"travel-{day}-out", "Дорога из университета", "travel", departure, departure + duration),
        ])
    return busy


def free_slots(first: date, last: date, now: datetime, profile: Profile, zone: ZoneInfo, busy: list[CalendarItem]) -> list[Slot]:
    result = []
    for day in days_between(first - DAY, last):
        if day.weekday() not in profile.study_days:
            continue
        start, end = local_interval(day, profile.study_from, profile.study_to, zone)
        available = max(start, day_start(first, zone), now.replace(second=0, microsecond=0) + MINUTE)
        end = min(end, day_start(last, zone))
        if available >= end:
            continue
        for item in sorted(busy, key=lambda item: item.start_utc):
            buffer = REST if item.category in WORK_CATEGORIES else timedelta()
            low, high = item.start_utc - buffer, item.end_utc + buffer
            if high <= available:
                continue
            if low >= end:
                break
            if low > available:
                result.append(Slot(available, low, day))
            available = max(available, high)
        if available < end:
            result.append(Slot(available, end, day))
    return result


def make_plan(
    tasks: list[Task], fixed: list[FixedEvent], first: date, now: datetime,
    profile: Profile, existing: list[CalendarItem], completion_rate: float | None,
) -> dict:
    zone = ZoneInfo(profile.timezone)
    last = first + 7 * DAY
    planned: list[CalendarItem] = []
    warnings = []
    for proposal in sorted(fixed, key=lambda event: (event.day, event.start)):
        start, end = local_interval(proposal.day, proposal.start, proposal.end, zone)
        candidate = CalendarItem(
            f"draft-{len(planned)}", proposal.title, proposal.category, start, end,
            priority=proposal.priority, description=proposal.description,
        )
        confirmed = existing + planned
        with_candidate = confirmed + [candidate] if proposal.category == "university" else confirmed
        busy = [item for item in with_commute(with_candidate, zone, profile.travel_minutes) if item is not candidate]
        if not first <= proposal.day < last or end > day_start(last, zone) or start < now or end <= start:
            warnings.append(f"«{proposal.title}» не помещается в выбранную неделю.")
        elif conflicts(start, end, busy):
            warnings.append(f"«{proposal.title}» пересекается с занятым временем.")
        elif proposal.category == "university" and proposed_commute_conflicts(candidate, confirmed, profile, zone):
            warnings.append(f"Для «{proposal.title}» не хватает времени на дорогу.")
        else:
            planned.append(candidate)
    busy = with_commute(existing + planned, zone, profile.travel_minutes)
    slots = free_slots(first, last, now, profile, zone, busy)

    limits = [value for value in (profile.desired_hours, profile.realistic_hours) if value is not None]
    cap = int(min(limits) * 60) if limits else 7 * 24 * 60
    limits_start = day_start(first, zone)
    limits_end = day_start(last, zone)
    scheduled_minutes = sum(
        max(0, int((min(item.end_utc, limits_end) - max(item.start_utc, limits_start)) / MINUTE))
        for item in busy if item.category in WORK_CATEGORIES
    )
    budget = max(0, cap - scheduled_minutes)
    work = []
    for task in tasks:
        deadline = None
        if task.deadline:
            date_and_time = (
                datetime.combine(task.deadline, task.deadline_time)
                if task.deadline_time is not None
                else datetime.combine(task.deadline, time(23, 59, 59))
            )
            deadline = to_utc(date_and_time, zone)
        days_left = max(0.0, (deadline - now) / DAY) if deadline else 14.0
        urgency = 8 / (1 + days_left)
        experience = (1 - completion_rate) * task.difficulty if completion_rate is not None else 0
        score = task.priority * 3 + urgency + task.difficulty + min(2, task.minutes / 240) + experience
        work.append(Work(task, deadline, task.minutes, score))

    for part in sorted(work, key=lambda value: (-value.score, value.deadline or datetime.max)):
        while part.left and budget:
            size = min(part.left, profile.session_minutes, budget)
            placement = best_placement(slots, part, size, zone, profile, work)
            if placement is None:
                break
            slot, start, minutes = placement
            end = start + minutes * MINUTE
            slots.remove(slot)
            if slot.start < start - REST:
                slots.append(Slot(slot.start, start - REST, slot.day))
            if end + REST < slot.end:
                slots.append(Slot(end + REST, slot.end, slot.day))
            planned.append(CalendarItem(
                f"draft-{len(planned)}", part.task.title, part.task.category, start, end,
                deadline_utc=part.deadline, deadline_date_only=bool(part.task.deadline and not part.task.deadline_time),
                priority=part.task.priority, description=part.task.description,
            ))
            budget -= minutes
            part.left -= minutes
        if part.left:
            warnings.append(f"Для «{part.task.title}» осталось разместить {part.left} мин.")
    alternatives = [
        "Уточнить, какие задачи важнее, и запланировать их первыми.",
        "Разбить оставшуюся работу на меньшие части или сократить объём по согласованию.",
        "Если сроки позволяют, выбрать другую неделю или изменить доступные часы в настройках.",
    ] if warnings else []
    return {
        "events": [item.public() for item in sorted(planned, key=lambda item: item.start_utc)],
        "warnings": warnings, "alternatives": alternatives,
    }


def proposed_commute_conflicts(candidate: CalendarItem, items: list[CalendarItem], profile: Profile, zone: ZoneInfo) -> bool:
    if not profile.travel_minutes:
        return False
    old = with_commute(items, zone, profile.travel_minutes)
    original = {(item.id, item.start_utc, item.end_utc) for item in old if item.id.startswith("travel-")}
    updated = with_commute(items + [candidate], zone, profile.travel_minutes)
    return any(
        item.id.startswith("travel-")
        and (item.id, item.start_utc, item.end_utc) not in original
        and conflicts(item.start_utc, item.end_utc, items)
        for item in updated
    )


def best_placement(slots: list[Slot], part: Work, size: int, zone: ZoneInfo, profile: Profile, work: list[Work]):
    candidates = []
    other_deadlines = [value.deadline for value in work if value is not part and value.left and value.deadline]
    reserve_before = min(other_deadlines, default=None)
    for slot in slots:
        limit = min(slot.end, part.deadline) if part.deadline else slot.end
        options = [(slot.start, limit, False)]
        if profile.focus_from and profile.focus_to:
            for day in (slot.day - DAY, slot.day, slot.day + DAY):
                focus_start, focus_end = local_interval(day, profile.focus_from, profile.focus_to, zone)
                options.append((max(slot.start, focus_start), min(limit, focus_end), True))
        for start, end, focused in options:
            if reserve_before and (part.deadline is None or part.deadline > reserve_before) and end > reserve_before:
                options_after = max(start, reserve_before)
                length_after = min(size, int((end - options_after) / MINUTE))
                if length_after >= min(15, size):
                    candidates.append((slot, options_after, length_after, focused))
            minutes = min(size, int((end - start) / MINUTE))
            if minutes >= min(15, size):
                candidates.append((slot, start, minutes, focused))
    if not candidates:
        return None
    slot, start, minutes, _ = min(candidates, key=lambda value: (
        value[2] != size,
        bool(reserve_before and (part.deadline is None or part.deadline > reserve_before) and value[1] < reserve_before),
        not value[3], value[1],
    ))
    return slot, start, minutes
