import { useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronRight, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api, categories, errorText, type Me, type Profile, type Rule } from './api';
import { weekDays } from './time';
import { Back, Feedback, Field, ScreenHeader, petArt } from './ui';

const scheduleCategories: Rule['category'][] = ['university', 'gym', 'personal', 'event', 'study', 'break', 'travel'];
type Update = <K extends keyof Profile>(key: K, value: Profile[K]) => void;
type AnswerKey = Exclude<keyof Profile, 'wake' | 'study_to' | 'study_days' | 'availability' | 'focus_to' | 'evening_time'>;
type Step = { key: AnswerKey; title: string; question: string; optional?: boolean };

const steps: Step[] = [
  { key: 'timezone', title: 'Часовой пояс', question: 'Часовой пояс устройства подходит для твоего календаря?' },
  { key: 'sleep', title: 'Сон', question: 'Во сколько ты обычно ложишься спать и просыпаешься?' },
  { key: 'university', title: 'Пары', question: 'В какие дни и часы у тебя обычно пары?', optional: true },
  { key: 'travel_minutes', title: 'Дорога', question: 'Сколько минут занимает дорога до университета в одну сторону?', optional: true },
  { key: 'gym', title: 'Спортзал', question: 'Когда ты обычно ходишь в зал или на тренировки?', optional: true },
  { key: 'regular', title: 'Регулярные мероприятия', question: 'Есть ли в твоей неделе другие регулярные мероприятия?', optional: true },
  { key: 'personal', title: 'Личные дела', question: 'Какие регулярные личные дела нужно учесть в расписании?', optional: true },
  { key: 'study_from', title: 'Доступное время', question: 'В какие дни и часы ты можешь заниматься учёбой?' },
  { key: 'desired_hours', title: 'Желаемая нагрузка', question: 'Сколько часов в неделю ты хочешь выделять на самостоятельную учёбу?', optional: true },
  { key: 'realistic_hours', title: 'Доступная нагрузка', question: 'Сколько часов в неделю ты реально можешь выделить на учёбу?', optional: true },
  { key: 'focus_from', title: 'Часы концентрации', question: 'В какие часы тебе обычно легче сосредоточиться?', optional: true },
  { key: 'session_minutes', title: 'Рабочая сессия', question: 'Сколько минут обычно длится один подход к задаче?', optional: true },
  { key: 'procrastination', title: 'Начало работы', question: 'Что ты обычно делаешь, когда наступает время начать сложную задачу?', optional: true },
  { key: 'obstacles', title: 'Что мешает', question: 'Что чаще всего мешает закончить запланированное?', optional: true },
  { key: 'style', title: 'Стиль помощника', question: 'В каком стиле тебе удобнее общаться с помощником?', optional: true },
  { key: 'reminders', title: 'Напоминания', question: 'Какие напоминания показывать в приложении?', optional: true },
];

const reminders = { both: 'Отчёты и сводка', reports: 'Только отчёты', evening: 'Только сводка', off: 'Выключить' } as const;
const styles = { balanced: 'Спокойно', brief: 'Кратко', supportive: 'С поддержкой' } as const;

function guessedZone(fallback: string) {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
}

function Days({ value, change }: { value: number[]; change: (days: number[]) => void }) {
  return <div className="day-choices" aria-label="Дни недели">
    {weekDays.map((day, index) => <button type="button" key={day} className={value.includes(index) ? 'chip active' : 'chip'}
      aria-pressed={value.includes(index)} onClick={() => change(value.includes(index)
        ? value.filter(item => item !== index) : [...value, index].sort())}>{day}</button>)}
  </div>;
}

function Choices<T extends string>({ choices, value, change }: { choices: Record<T, string>; value: T; change: (key: T) => void }) {
  return <div className="day-choices">{(Object.keys(choices) as T[]).map(key => <button type="button" key={key}
    className={value === key ? 'chip active' : 'chip'} aria-pressed={value === key} onClick={() => change(key)}>{choices[key]}</button>)}</div>;
}

function Answer({ answerKey, profile: p, update }: { answerKey: AnswerKey; profile: Profile; update: Update }) {
  switch (answerKey) {
    case 'timezone':
      return <Field label="Часовой пояс IANA"><input required value={p.timezone} placeholder="Europe/Moscow"
        onChange={e => update('timezone', e.target.value)} /></Field>;
    case 'sleep':
      return <div className="form-grid"><Field label="Отбой"><input type="time" required value={p.sleep.slice(0, 5)} onChange={e => update('sleep', e.target.value)} /></Field>
        <Field label="Подъём"><input type="time" required value={p.wake.slice(0, 5)} onChange={e => update('wake', e.target.value)} /></Field></div>;
    case 'study_from':
      return <div className="stack compact">
        <Days value={p.study_days} change={days => update('study_days', days)} />
        <div className="form-grid"><Field label="С"><input type="time" required value={p.study_from.slice(0, 5)} onChange={e => update('study_from', e.target.value)} /></Field>
          <Field label="До"><input type="time" required value={p.study_to.slice(0, 5)} onChange={e => update('study_to', e.target.value)} /></Field></div>
        <Field label="Дополнительные пожелания"><textarea rows={2} maxLength={1000} value={p.availability} onChange={e => update('availability', e.target.value)} /></Field>
      </div>;
    case 'focus_from':
      return <div className="form-grid"><Field label="С"><input type="time" value={p.focus_from?.slice(0, 5) ?? ''} onChange={e => update('focus_from', e.target.value || null)} /></Field>
        <Field label="До"><input type="time" value={p.focus_to?.slice(0, 5) ?? ''} onChange={e => update('focus_to', e.target.value || null)} /></Field></div>;
    case 'style':
      return <Choices choices={styles} value={p.style} change={key => update('style', key)} />;
    case 'reminders':
      return <div className="stack compact"><Choices choices={reminders} value={p.reminders} change={key => update('reminders', key)} />
        {(p.reminders === 'both' || p.reminders === 'evening') && <Field label="Время вечерней сводки">
          <input type="time" required value={p.evening_time.slice(0, 5)} onChange={e => update('evening_time', e.target.value)} /></Field>}
      </div>;
    case 'travel_minutes':
    case 'session_minutes': {
      const session = answerKey === 'session_minutes';
      return <div className="stack compact">
        <Field label="Минуты"><input type="number" min={session ? 15 : 0} max={session ? 180 : 240} required value={p[answerKey]}
          onChange={e => update(answerKey, e.target.valueAsNumber)} /></Field>
        <div className="day-choices">{(session ? [25, 50, 90] : [0, 15, 30, 60]).map(value => <button className={value === p[answerKey] ? 'chip active' : 'chip'}
          type="button" key={value} onClick={() => update(answerKey, value)}>{value} мин</button>)}</div>
      </div>;
    }
    case 'desired_hours':
    case 'realistic_hours':
      return <Field label="Часов в неделю"><input type="number" min={0} max={112} step={0.25} value={p[answerKey] ?? ''}
        onChange={e => update(answerKey, e.target.value === '' ? null : e.target.valueAsNumber)} /></Field>;
    default:
      return <Field label="Твой ответ"><textarea rows={3} maxLength={1000} value={p[answerKey]}
        placeholder={answerKey === 'university' ? 'Понедельник с 09:00 до 15:00, вторник с 10:00 до 17:00' : undefined}
        onChange={e => update(answerKey, e.target.value)} /></Field>;
  }
}

function sourceText(profile: Profile) {
  const labels = { university: 'Пары', gym: 'Спортзал', regular: 'Мероприятия', personal: 'Личные дела' } as const;
  return (Object.keys(labels) as (keyof typeof labels)[]).filter(key => profile[key].trim())
    .map(key => `${labels[key]}: ${profile[key]}`).join('\n');
}

function ScheduleEditor({ rules, setRules, seed, busy, waiting, setWaiting }: { rules: Rule[]; setRules: (rules: Rule[]) => void; seed: string; busy: boolean; waiting: boolean; setWaiting: (waiting: boolean) => void }) {
  const [source, setSource] = useState(seed);
  const [parsed, setParsed] = useState('');
  const [notice, setNotice] = useState('');

  function patch(index: number, value: Partial<Rule>) {
    setRules(rules.map((rule, position) => position === index ? { ...rule, ...value } : rule));
  }

  async function parse() {
    setWaiting(true);
    setNotice('');
    setParsed('');
    try {
      const result = await api<{ reply: string; rules: Rule[] }>('/schedule/parse', 'POST', { text: source.trim() });
      if (result.rules.length) setRules(result.rules);
      setParsed(result.reply || 'Проверь интервалы перед сохранением.');
    } catch (error) {
      setNotice(`${errorText(error)} Постоянное расписание можно заполнить вручную ниже.`);
    } finally {
      setWaiting(false);
    }
  }

  return <div className="stack">
    <Field label="Расписание своими словами"><textarea rows={4} maxLength={4000}
      placeholder="В понедельник пары с 9 до 15, в среду зал с 19 до 21" value={source} onChange={e => setSource(e.target.value)} /></Field>
    <button type="button" className="secondary" disabled={waiting || busy || source.trim().length < 3} onClick={parse}>
      <Sparkles size={17} />{waiting ? 'Распознаём…' : 'Распознать расписание'}</button>
    <Feedback text={notice} />
    {parsed && <p className="bubble">{parsed}</p>}
    {rules.map((rule, index) => <section className="rule-card" key={index} aria-label={`Регулярное событие ${index + 1}`}>
      <div className="rule-heading"><h3>Регулярное событие</h3><button type="button" className="icon-button plain danger-text"
        aria-label="Убрать регулярное событие" onClick={() => setRules(rules.filter((_, position) => position !== index))}><Trash2 size={18} /></button></div>
      <div className="form-grid"><Field label="Название"><input required maxLength={120} value={rule.title} onChange={e => patch(index, { title: e.target.value })} /></Field>
        <Field label="Категория"><select value={rule.category} onChange={e => patch(index, { category: e.target.value as Rule['category'] })}>
          {scheduleCategories.map(key => <option key={key} value={key}>{categories[key]}</option>)}</select></Field>
        <Field label="Начало"><input type="time" required value={rule.start.slice(0, 5)} onChange={e => patch(index, { start: e.target.value })} /></Field>
        <Field label="Окончание"><input type="time" required value={rule.end.slice(0, 5)} onChange={e => patch(index, { end: e.target.value })} /></Field>
      </div>
      <Days value={rule.days} change={days => patch(index, { days })} />
      {rule.description && <p className="muted">{rule.description}</p>}
    </section>)}
    <button className="secondary" type="button" disabled={busy || waiting || rules.length >= 60}
      onClick={() => setRules([...rules, { title: '', category: 'university', days: [0], start: '09:00', end: '10:30', description: '' }])}>
      <Plus size={18} /> Добавить регулярное событие</button>
  </div>;
}

export function ProfileScreen({ me, onSave, onBack }: { me: Me; onSave: (me: Me) => void; onBack: () => void }) {
  const first = !me.onboarded;
  const [profile, setProfile] = useState<Profile>(() => ({ ...me.profile, timezone: first ? guessedZone(me.profile.timezone) : me.profile.timezone }));
  const [rules, setRules] = useState(me.schedule);
  const [index, setIndex] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const step = steps[index];
  const final = first && index === steps.length;
  const update: Update = (key, value) => setProfile(previous => ({ ...previous, [key]: value }));

  function move(next: number) {
    setNotice('');
    setIndex(next);
    window.scrollTo(0, 0);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (waiting || saving) return;
    setNotice('');
    if (first && !final) {
      try {
        if (step.key === 'timezone') new Intl.DateTimeFormat('ru', { timeZone: profile.timezone }).format();
        if (step.key === 'sleep' && profile.sleep.slice(0, 5) === profile.wake.slice(0, 5)) throw new Error('Выбери разное время для отбоя и подъёма.');
        if (step.key === 'study_from' && profile.study_from.slice(0, 5) === profile.study_to.slice(0, 5)) throw new Error('Выбери разное время начала и окончания.');
        if (step.key === 'focus_from' && (Boolean(profile.focus_from) !== Boolean(profile.focus_to) ||
          (profile.focus_from !== null && profile.focus_from.slice(0, 5) === profile.focus_to?.slice(0, 5)))) {
          throw new Error('Укажи оба времени или оставь оба поля пустыми.');
        }
        move(index + 1);
      } catch (error) {
        setNotice(error instanceof RangeError ? 'Укажи часовой пояс IANA, например Europe/Moscow.' : errorText(error));
      }
      return;
    }
    if (rules.some(rule => rule.days.length === 0)) {
      setNotice('Выбери хотя бы один день для каждого регулярного события.');
      return;
    }
    setSaving(true);
    try {
      onSave(await api<Me>('/profile', 'PUT', { profile, schedule: rules }));
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  if (!first) return <main className="subscreen">
    <ScreenHeader title="Настройки" onBack={onBack} />
    <p className="muted profile-name">{me.name} · Telegram</p>
    <form className="stack" onSubmit={save}>
      {steps.map(({ key, title }) => <section className="card form-section" key={key}><h2>{title}</h2><Answer answerKey={key} profile={profile} update={update} /></section>)}
      <section className="card form-section">
        <button className="expand-row" type="button" disabled={waiting} aria-expanded={showSchedule} onClick={() => setShowSchedule(value => !value)}>
          <h2>Постоянное расписание</h2><ChevronRight className={showSchedule ? 'expanded' : ''} size={20} />
        </button>
        {showSchedule && <ScheduleEditor rules={rules} setRules={setRules} seed={sourceText(profile)} busy={saving} waiting={waiting} setWaiting={setWaiting} />}
      </section>
      <Feedback text={notice} />
      <button className="primary" disabled={saving || waiting}>{saving ? 'Сохраняем…' : 'Сохранить изменения'}</button>
    </form>
  </main>;

  let skip: ReactNode = null;
  if (step?.optional) skip = <button className="ghost" type="button" onClick={() => {
    if (step.key === 'focus_from') setProfile(previous => ({ ...previous, focus_from: null, focus_to: null }));
    move(index + 1);
  }}>Пропустить</button>;

  return <main className="subscreen onboarding">
    <header className="onboarding-head">{index > 0 && !waiting && <Back onClick={() => move(index - 1)} />}<h1>Знакомство</h1></header>
    <progress aria-label="Прогресс анкеты" max={steps.length + 1} value={index + 1} />
    <div className="onboarding-message">
      <span className="bot-avatar"><img src={petArt.idle} alt="" /></span>
      <p className="bubble">{index === 0 && <strong>Привет, {me.name}! 🐹<br /></strong>}
        {final ? 'Проверь постоянное расписание. Сохрани его вместе с анкетой или продолжай без регулярных событий.' : step.question}</p>
    </div>
    <form className="stack card onboarding-form" onSubmit={save}>
      {final ? <ScheduleEditor rules={rules} setRules={setRules} seed={sourceText(profile)} busy={saving} waiting={waiting} setWaiting={setWaiting} />
        : <Answer key={step.key} answerKey={step.key} profile={profile} update={update} />}
      <Feedback text={notice} />
      <div className="actions">
        <button className="primary" disabled={saving || waiting}>{saving ? 'Сохраняем…' : final ? <><Check size={18} /> Подтвердить и открыть</> : <>Далее <ChevronRight size={18} /></>}</button>
        {skip}
      </div>
    </form>
  </main>;
}
