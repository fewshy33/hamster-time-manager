import { useState } from 'react';
import { ArrowUpRight, CalendarClock, ChevronRight, CircleCheck, Clock3, Coffee, Laptop, Moon, Sparkles,
  Sunrise, Timer, type LucideIcon } from 'lucide-react';
import { categories, telegram, type CalendarEvent, type Home, type PetState } from './api';
import { dateKey, dateLabel, eventTime, todayIn } from './time';
import { petArt, ScreenHeader } from './ui';
import { timerClock, TimerModal, useTimer, type TimerMode } from './timers';

const states: Record<PetState, { text: string; icon: LucideIcon }> = {
  idle: { text: 'Отдыхает', icon: Coffee },
  working: { text: 'Занят делом', icon: Laptop },
  tired: { text: 'Устал', icon: Sunrise },
  sleeping: { text: 'Спит', icon: Moon },
};

function ScheduleCard({ title, item, zone, upNext, onEvent }: {
  title: string; item: CalendarEvent | null; zone: string; upNext?: boolean; onEvent: (event: CalendarEvent) => void;
}) {
  const Icon = upNext ? CalendarClock : Clock3;
  const date = item ? dateKey(item.start_utc, zone) : '';
  const summary = <>
    <span className={`activity-icon ${upNext ? 'next' : 'current'}`}><Icon size={19} strokeWidth={1.8} /></span>
    <span className="activity-text"><small>{title}</small><strong>{item?.title ?? (upNext ? 'Пока ничего' : 'Свободное время')}</strong>
      {item && <span>{date !== todayIn(zone) ? `${dateLabel(date, { day: 'numeric', month: 'short' })} · ` : ''}
        {eventTime(item.start_utc, item.end_utc, zone)}</span>}</span>
    {item && <ChevronRight className="activity-chevron" size={16} />}
  </>;
  return item ? <button className="card activity" type="button" onClick={() => onEvent(item)}>{summary}</button>
    : <div className="card activity">{summary}</div>;
}

function TimerTile({ title, detail, icon: Icon, tone, onClick }: {
  title: string; detail: string; icon: LucideIcon; tone: string; onClick: () => void;
}) {
  return <button type="button" className="card timer-tile" onClick={onClick}>
    <span className={`timer-icon ${tone}`}><Icon size={22} strokeWidth={1.75} /></span>
    <ArrowUpRight className="tile-arrow" size={17} />
    <strong>{title}</strong><small>{detail}</small>
  </button>;
}

export function Dashboard({ home, zone, userId, onShop, onEvent, onReport, onEvening, eveningBusy }: {
  home: Home | null; zone: string; userId: number; onShop: () => void;
  onEvent: (item: CalendarEvent) => void; onReport: (item: CalendarEvent) => void;
  onEvening: () => void; eveningBusy: boolean;
}) {
  const [jump, setJump] = useState(0);
  const [mode, setMode] = useState<TimerMode | null>(null);
  const ordinary = useTimer(userId, 'ordinary');
  const pomodoro = useTimer(userId, 'pomodoro');
  const state = home?.state ?? 'idle';
  const { icon: StateIcon, text } = states[state];
  const current = home?.current ?? null;
  return <section className="dashboard" aria-label="Хомяк">
    <div className="pet-room">
      <div className="room-floor" aria-hidden="true" />
      <Sparkles className="room-sparkle a" size={18} aria-hidden="true" />
      <Sparkles className="room-sparkle b" size={14} aria-hidden="true" />
      <span className="room-dot a" aria-hidden="true" /><span className="room-dot b" aria-hidden="true" />
      <div className="room-status"><span className={`state-icon ${state}`}><StateIcon size={14} /></span>{text}</div>
      <button className="wardrobe" type="button" onClick={onShop} aria-label="Шкаф · магазин">
        <img src={petArt.wardrobe} alt="" /><span>Шкаф</span>
      </button>
      <button className="hamster" type="button" aria-label="Погладить хомяка" onClick={() => {
        setJump(value => value + 1);
        telegram()?.HapticFeedback?.impactOccurred('light');
      }}>
        <img key={jump} className={jump ? 'hop' : ''} src={petArt[state]} alt="" draggable={false} />
      </button>
      {state === 'sleeping' && <span aria-hidden="true" className="room-symbols">z Z</span>}
      {state === 'working' && current && <span className="room-category">{categories[current.category]}</span>}
    </div>
    <div className="schedule-grid">
      <ScheduleCard title="Сейчас" item={current} zone={zone} onEvent={onEvent} />
      <ScheduleCard title="Дальше" item={home?.next ?? null} zone={zone} upNext onEvent={onEvent} />
    </div>
    <div className="timer-section">
      <h2>Таймеры</h2>
      <div className="schedule-grid timer-grid">
        <TimerTile title="Таймер" detail={ordinary.running || ordinary.finished || ordinary.seconds !== ordinary.total ? timerClock(ordinary.seconds) : 'Обратный отсчёт'} icon={Timer} tone="lilac" onClick={() => setMode('ordinary')} />
        <TimerTile title="Помодоро" detail={pomodoro.running || pomodoro.finished || pomodoro.seconds !== pomodoro.total || pomodoro.phase === 'break' ? timerClock(pomodoro.seconds) : '25 мин фокуса · 5 мин отдыха'} icon={Coffee} tone="amber" onClick={() => setMode('pomodoro')} />
      </div>
    </div>
    {!!home?.reports.length && <section className="card dashboard-report">
      <h2><CircleCheck size={20} /> Как прошла работа?</h2>
      {home.reports.map(item => <button className="expand-row" key={item.id} type="button" onClick={() => onReport(item)}>
        <span>{item.title}</span><ChevronRight size={18} /></button>)}
    </section>}
    {home?.evening && <section className="card dashboard-report">
      <h2><Moon size={20} /> Вечерняя сводка</h2>
      <p>Выполнено: {home.evening.completed} · Осталось: {home.evening.open}</p>
      <button className="secondary" type="button" disabled={eveningBusy} onClick={onEvening}>Понятно</button>
    </section>}
    {mode && <TimerModal mode={mode} timer={mode === 'ordinary' ? ordinary : pomodoro} onClose={() => setMode(null)} />}
  </section>;
}

export function Shop({ onBack }: { onBack: () => void }) {
  return <main className="subscreen">
    <ScreenHeader title="Магазин" onBack={onBack} />
    <div className="card shop-card"><img src={petArt.wardrobe} alt="" />
      <p>Скоро здесь появятся новые вещи! 🐹</p>
      <button className="secondary" type="button" onClick={onBack}>Назад</button>
    </div>
  </main>;
}
