import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, categories, errorText, isWork, priorities, statuses, type CalendarEvent, type Category, type Draft,
  type Priority, type ReportInput, type ResultStatus, type Status } from './api';
import { addDays, addMonths, dateKey, dateLabel, localValue, monday, todayIn, weekDays } from './time';
import { DraftCard, Empty, EventRow, Feedback, Field, Modal } from './ui';

type Mode = 'day' | 'week' | 'month';
const modes: Record<Mode, string> = { day: 'День', week: 'Неделя', month: 'Месяц' };
const eventCategories = Object.keys(categories) as Category[];
const resultOptions: ResultStatus[] = ['completed', 'partial', 'missed'];

function rangeOf(mode: Mode, selected: string): [string, string] {
  const start = mode === 'day' ? selected : monday(mode === 'week' ? selected : `${selected.slice(0, 7)}-01`);
  return [start, addDays(start, mode === 'day' ? 1 : mode === 'week' ? 7 : 42)];
}

function rangeLabel(mode: Mode, selected: string, first: string) {
  if (mode === 'month') return dateLabel(selected, { month: 'long', year: 'numeric' });
  if (mode === 'day') return dateLabel(selected, { day: 'numeric', month: 'long', year: 'numeric' });
  const last = addDays(first, 6);
  return `${dateLabel(first, { day: 'numeric', ...(first.slice(0, 7) === last.slice(0, 7) ? {} : { month: 'short' }) })} – ${dateLabel(last, { day: 'numeric', month: 'short' })}`;
}

export function Calendar({ zone, revision, onCreate, onEvent }: {
  zone: string; revision: number; onCreate: (day: string) => void; onEvent: (item: CalendarEvent) => void;
}) {
  const [mode, setMode] = useState<Mode>('week');
  const today = todayIn(zone);
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const [request, setRequest] = useState(0);
  const [first, end] = rangeOf(mode, selected);

  useEffect(() => {
    let current = true;
    setBusy(true);
    setNotice('');
    api<CalendarEvent[]>(`/events?start=${first}&end=${end}`).then(result => {
      if (current) setEvents(result);
    }).catch(error => {
      if (current) setNotice(errorText(error));
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [first, end, revision, request, zone]);

  const span = mode === 'day' ? 1 : mode === 'week' ? 7 : 42;
  const byDay = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const start = dateKey(event.start_utc, zone);
      const last = dateKey(new Date(new Date(event.end_utc).getTime() - 1), zone);
      for (let key = start < first ? first : start; key <= last && key < end; key = addDays(key, 1)) {
        const day = grouped.get(key);
        if (day) day.push(event);
        else grouped.set(key, [event]);
      }
    }
    return grouped;
  }, [events, first, end, zone]);

  const shift = (offset: number) => setSelected(previous => mode === 'month' ? addMonths(previous, offset) : addDays(previous, offset * span));

  return <section className="calendar-screen">
    <div className="section-heading"><div><h1>Календарь</h1><p className="muted">{dateLabel(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <button className="primary add-event" onClick={() => onCreate(selected)}><Plus size={20} /> Событие</button></div>
    <div className="segments calendar-segments" aria-label="Вид календаря">
      {(Object.keys(modes) as Mode[]).map(key => <button type="button" className={mode === key ? 'active' : ''}
        aria-pressed={mode === key} key={key} onClick={() => setMode(key)}>{modes[key]}</button>)}
    </div>
    <div className="card calendar-card">
      <div className="calendar-controls">
        <button className="icon-button plain" title="Предыдущий период" aria-label="Предыдущий период" onClick={() => shift(-1)}><ChevronLeft size={21} /></button>
        <strong>{rangeLabel(mode, selected, first)}</strong>
        <button className="icon-button plain" title="Следующий период" aria-label="Следующий период" onClick={() => shift(1)}><ChevronRight size={21} /></button>
        <button className="ghost today-button" onClick={() => setSelected(today)}>Сегодня</button>
      </div>
      {mode !== 'day' && <div className={`date-grid ${mode}`}>
        {weekDays.map(day => <span className="weekday" key={day}>{day}</span>)}
        {Array.from({ length: span }, (_, index) => {
          const key = addDays(first, index);
          const items = byDay.get(key) ?? [];
          const out = mode === 'month' && key.slice(0, 7) !== selected.slice(0, 7);
          return <button className={`date-cell ${out ? 'outside' : ''} ${key === selected ? 'selected' : ''} ${key === today ? 'is-today' : ''}`}
            type="button" aria-label={`${dateLabel(key, { day: 'numeric', month: 'long' })}, событий: ${items.length}`}
            aria-pressed={key === selected} key={key} onClick={() => {
              setSelected(key);
              if (mode === 'week') requestAnimationFrame(() => document.getElementById(`agenda-${key}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
            }}><span>{Number(key.slice(-2))}</span><span className="date-dots" aria-hidden="true">
              {items.slice(0, 3).map(item => <i key={item.id} className={`category-${item.category}`} />)}</span>
          </button>;
        })}
      </div>}
    </div>
    <Feedback text={notice} />
    {notice && <button className="secondary" onClick={() => setRequest(value => value + 1)}>Повторить</button>}
    {busy ? <p className="loading-line" role="status">Загружаем календарь…</p> : !notice &&
      <div className="agenda">
        {(mode === 'week'
          ? Array.from({ length: 7 }, (_, index) => addDays(first, index)).filter(key => byDay.has(key) || key === selected)
          : [selected]).map(key => <section key={key} id={`agenda-${key}`} className="agenda-day">
          <h2>{dateLabel(key, { weekday: 'long', day: 'numeric', month: 'long' })}{key === today && <span>Сегодня</span>}</h2>
          {byDay.get(key)?.map(event => <EventRow zone={zone} event={event} day={key} key={event.id} onClick={() => onEvent(event)} />)
            ?? <Empty>На этот день ничего не запланировано.</Empty>}
        </section>)}
      </div>}
  </section>;
}

function naiveDuration(start: string, end: string) {
  if (!start || !end) return 0;
  return Math.round((new Date(`${end}Z`).getTime() - new Date(`${start}Z`).getTime()) / 60000);
}

function addMinutes(local: string, minutes: number) {
  return new Date(new Date(`${local}Z`).getTime() + minutes * 60000).toISOString().slice(0, 16);
}

function EventEditor({ event, day, zone, onClose, onChange }: {
  event?: CalendarEvent; day: string; zone: string; onClose: () => void; onChange: () => void;
}) {
  const start = event ? localValue(event.start_utc, zone) : `${day}T09:00`;
  const [data, setData] = useState({
    title: event?.title ?? '', category: event?.category ?? 'task' as Category, start,
    end: event ? localValue(event.end_utc, zone) : addMinutes(start, 60),
    deadline: event?.deadline_utc ? localValue(event.deadline_utc, zone) : '',
    deadline_date_only: event?.deadline_date_only ?? false,
    priority: event?.priority ?? 2 as Priority, description: event?.description ?? '',
    status: event?.status ?? 'pending' as Status,
  });
  const set = <K extends keyof typeof data>(key: K, value: typeof data[K]) => setData(previous => ({ ...previous, [key]: value }));
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function mutate(method: 'PUT' | 'POST' | 'DELETE') {
    setBusy(true);
    setNotice('');
    try {
      await api(event ? `/events/${event.id}` : '/events', method, method === 'DELETE' ? undefined : {
        ...data, deadline: data.deadline || null, deadline_date_only: Boolean(data.deadline && data.deadline_date_only),
      });
      onChange();
      onClose();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const minutes = naiveDuration(data.start, data.end);
  return <form className="stack compact" onSubmit={e => { e.preventDefault(); void mutate(event ? 'PUT' : 'POST'); }}>
    <Field label="Название"><input required maxLength={120} value={data.title} onChange={e => set('title', e.target.value)} /></Field>
    <div className="form-grid">
      <Field label="Категория"><select value={data.category} onChange={e => set('category', e.target.value as Category)}>
        {eventCategories.map(key => <option key={key} value={key}>{categories[key]}</option>)}</select></Field>
      <Field label="Приоритет"><select value={data.priority} onChange={e => set('priority', Number(e.target.value) as Priority)}>
        {([1, 2, 3] as const).map(key => <option key={key} value={key}>{priorities[key]}</option>)}</select></Field>
      <Field label="Начало" wide><input type="datetime-local" required value={data.start} onChange={e => {
        const value = e.target.value;
        setData(previous => ({ ...previous, start: value, end: value ? addMinutes(value, Math.max(5, minutes)) : previous.end }));
      }} /></Field>
      <Field label="Окончание" wide><input type="datetime-local" required value={data.end} onChange={e => set('end', e.target.value)} /></Field>
      <Field label="Длительность, мин"><input type="number" min={1} value={minutes > 0 ? minutes : ''}
        onChange={e => { const value = e.target.valueAsNumber; if (data.start) set('end', Number.isFinite(value) && value <= 525600 ? addMinutes(data.start, value) : ''); }} /></Field>
      <Field label="Статус"><select value={data.status} onChange={e => set('status', e.target.value as Status)}>
        {(Object.keys(statuses) as Status[]).map(key => <option key={key} value={key}>{statuses[key]}</option>)}</select></Field>
      <Field label="Дедлайн" wide><input type={data.deadline_date_only ? 'date' : 'datetime-local'}
        value={data.deadline_date_only ? data.deadline.slice(0, 10) : data.deadline} onChange={e => {
          set('deadline', data.deadline_date_only && e.target.value ? `${e.target.value}T00:00` : e.target.value);
        }} /></Field>
      <label className="checkbox-field"><input type="checkbox" checked={data.deadline_date_only} onChange={e => set('deadline_date_only', e.target.checked)} /> Указать только дату</label>
    </div>
    <Field label="Описание"><textarea maxLength={1000} rows={3} value={data.description} onChange={e => set('description', e.target.value)} /></Field>
    {event?.recurring && <p className="muted">Изменения применятся только к этому событию.</p>}
    <Feedback text={notice} />
    <div className="actions">
      <button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      {event && !deleting && <button type="button" className="ghost danger-text" disabled={busy} onClick={() => setDeleting(true)}><Trash2 size={17} /> Удалить</button>}
    </div>
    {deleting && <div className="confirm-delete"><p>Удалить «{event?.title}»?</p><div className="actions">
      <button type="button" className="danger" disabled={busy} onClick={() => void mutate('DELETE')}>Удалить событие</button>
      <button type="button" className="ghost" onClick={() => setDeleting(false)}>Отмена</button>
    </div></div>}
  </form>;
}

function ReportForm({ event, zone, onChange, onClose }: { event: CalendarEvent; zone: string; onChange: () => void; onClose: () => void }) {
  const [data, setData] = useState<ReportInput>(() => event.report ?? ({
    status: event.status === 'pending' ? 'completed' : event.status,
    comment: '', done: '', remaining: '', obstacle: '', remaining_minutes: null,
  }));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const change = <K extends keyof ReportInput>(key: K, value: ReportInput[K]) => setData(previous => ({ ...previous, [key]: value }));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ draft: Draft | null }>(`/events/${event.id}/report`, 'POST', data);
      onChange();
      if (result.draft) setDraft(result.draft);
      else onClose();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: 'accept' | 'cancel') {
    if (!draft) return;
    setBusy(true);
    setNotice('');
    try {
      await api(`/drafts/${draft.id}/${action}`, 'POST');
      onChange();
      onClose();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (draft) return <><p className="muted">Отчёт сохранён.</p><Feedback text={notice} />
    <DraftCard draft={draft} zone={zone} onDecision={decide} busy={busy} onEdit={() => setDraft(null)} /></>;

  return <form className="stack compact" onSubmit={submit}>
    <p className="report-title">{event.title}</p>
    <div className="day-choices">{resultOptions.map(status => <button type="button" key={status} aria-pressed={data.status === status}
      className={data.status === status ? 'chip active' : 'chip'} onClick={() => change('status', status)}>{statuses[status]}</button>)}</div>
    <Field label="Комментарий"><textarea rows={2} maxLength={1000} value={data.comment} onChange={e => change('comment', e.target.value)} /></Field>
    {data.status !== 'completed' && <>
      <Field label="Что уже сделано?"><textarea rows={2} maxLength={1000} value={data.done} onChange={e => change('done', e.target.value)} /></Field>
      <Field label="Что осталось?"><textarea required rows={2} maxLength={1000} value={data.remaining} onChange={e => change('remaining', e.target.value)} /></Field>
      <Field label="Что помешало?"><textarea rows={2} maxLength={1000} value={data.obstacle} onChange={e => change('obstacle', e.target.value)} /></Field>
      <Field label="Сколько ещё нужно минут?"><input type="number" required min={5} max={720} value={data.remaining_minutes ?? ''}
        onChange={e => change('remaining_minutes', e.target.value === '' ? null : e.target.valueAsNumber)} /></Field>
    </>}
    <Feedback text={notice} />
    <button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : data.status === 'completed' ? 'Сохранить отчёт' : 'Сохранить и подобрать время'}</button>
  </form>;
}

export type CalendarOverlay = { mode: 'new'; day: string } | { mode: 'detail' | 'report'; event: CalendarEvent };

export function EventModal({ selection, zone, onClose, onChange }: {
  selection: CalendarOverlay; zone: string; onClose: () => void; onChange: () => void;
}) {
  const [mode, setMode] = useState<'detail' | 'edit' | 'new' | 'report'>(selection.mode);
  const event = selection.mode === 'new' ? undefined : selection.event;
  const day = selection.mode === 'new' ? selection.day : dateKey(selection.event.start_utc, zone);
  const title = { new: 'Новое событие', edit: 'Редактировать событие', detail: 'Событие', report: 'Отчёт о работе' }[mode];
  return <Modal title={title} onClose={onClose}>
    {(mode === 'new' || mode === 'edit') && <EventEditor event={event} day={day} zone={zone} onClose={onClose} onChange={onChange} />}
    {mode === 'report' && event && <ReportForm event={event} zone={zone} onClose={onClose} onChange={onChange} />}
    {mode === 'detail' && event && <div className="stack compact">
      <div className="event-detail"><span className={`category-dot category-${event.category}`} /><span>{categories[event.category]}</span></div>
      <h3 className="detail-title">{event.title}</h3>
      <div className="detail-lines">
        <p><CalendarDays size={16} /> {dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p><Clock3 size={16} /> {localValue(event.start_utc, zone).replace('T', ' ')} — {localValue(event.end_utc, zone).replace('T', ' ')} · {event.minutes} мин</p>
      </div>
      <dl className="detail-table"><dt>Приоритет</dt><dd>{priorities[event.priority]}</dd><dt>Статус</dt><dd>{statuses[event.status]}</dd>
        {event.deadline_utc && <><dt>Дедлайн</dt><dd>{event.deadline_date_only
          ? dateLabel(dateKey(event.deadline_utc, zone), { day: 'numeric', month: 'long', year: 'numeric' })
          : localValue(event.deadline_utc, zone).replace('T', ' ')}</dd></>}</dl>
      {event.description && <p className="description">{event.description}</p>}
      {event.report && Object.entries({ Комментарий: event.report.comment, Сделано: event.report.done, Осталось: event.report.remaining, 'Что помешало': event.report.obstacle })
        .filter(([, text]) => text).map(([label, text]) => <p className="description" key={label}><strong>{label}</strong><br />{text}</p>)}
      <div className="actions">
        <button type="button" className="secondary" onClick={() => setMode('edit')}><Pencil size={17} /> Изменить</button>
        {isWork(event.category) && <button type="button" className="primary" onClick={() => setMode('report')}>Отчёт</button>}
      </div>
    </div>}
  </Modal>;
}
