import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, CalendarDays, Check, CircleAlert, CircleHelp, Clock3, X } from 'lucide-react';
import { categories, statuses, type CalendarEvent, type Draft } from './api';
import { dateKey, dateLabel, eventTime } from './time';

export const petArt = {
  idle: '/art/hamster-idle.webp', working: '/art/hamster-working.webp',
  tired: '/art/hamster-tired.webp', sleeping: '/art/hamster-sleeping.webp',
  wardrobe: '/art/wardrobe.webp',
};

export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>;
}

export function Feedback({ text }: { text: string }) {
  return text ? <div className="notice" role="alert"><CircleAlert size={18} /><span>{text}</span></div> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><CalendarDays size={24} /><p>{children}</p></div>;
}

export function Back({ onClick }: { onClick: () => void }) {
  return <button className="icon-button" type="button" aria-label="Назад" onClick={onClick}><ArrowLeft size={20} /></button>;
}

export function ScreenHeader({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  return <header className="screen-header"><Back onClick={onBack} /><h1>{title}</h1>{children}</header>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button plain" type="button" aria-label="Закрыть" onClick={onClose}><X size={21} /></button></div>
    {children}
  </dialog>;
}

export function EventRow({ event, zone, day, onClick, withDate = false }: { event: CalendarEvent; zone: string; day?: string; onClick?: () => void; withDate?: boolean }) {
  const title = <><span className={`category-dot category-${event.category}`} />
    <span className="event-main"><strong>{event.title}</strong>
      <small>{withDate && `${dateLabel(dateKey(event.start_utc, zone), { day: 'numeric', month: 'short' })} · `}
        {eventTime(event.start_utc, event.end_utc, zone, day)} · {categories[event.category]}</small></span>
    {event.status !== 'pending' && <span className={`event-result ${event.status}`}>{event.status === 'completed' ? <Check size={17} aria-label={statuses.completed} /> : statuses[event.status]}</span>}</>;
  return onClick
    ? <button type="button" className="event-row" onClick={onClick}>{title}</button>
    : <div className="event-row">{title}</div>;
}

export function DraftCard({ draft, zone, onDecision, onEdit, busy }: {
  draft: Draft; zone: string; onDecision: (action: 'accept' | 'cancel') => void;
  onEdit?: () => void; busy: boolean;
}) {
  return <section className="draft card">
    <h2><Clock3 size={19} />{draft.kind === 'report' ? 'Время для продолжения' : 'Предварительный план'}</h2>
    {draft.events.map(event => <EventRow key={event.id} event={event} zone={zone} withDate />)}
    {draft.warnings.length > 0 && <div className="draft-warnings">
      <h3><CircleHelp size={17} /> На всё может не хватить времени</h3>
      <ul>{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      <ul>{draft.alternatives.map(text => <li key={text}>{text}</li>)}</ul>
    </div>}
    <div className="actions">
      <button className="primary" type="button" disabled={busy || draft.events.length === 0} onClick={() => onDecision('accept')}>Принять</button>
      {onEdit && <button className="secondary" type="button" disabled={busy} onClick={onEdit}>Изменить</button>}
      <button className="ghost" type="button" disabled={busy} onClick={() => onDecision('cancel')}>Отменить</button>
    </div>
  </section>;
}
