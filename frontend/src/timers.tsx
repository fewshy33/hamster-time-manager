import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Field, Modal } from './ui';

export type TimerMode = 'ordinary' | 'pomodoro';
type Phase = 'focus' | 'break';

interface TimerState {
  ordinaryMinutes: number;
  seconds: number;
  endsAt: number | null;
  phase: Phase;
  cycles: number;
  finished: boolean;
}

const MINUTE = 60;
const defaults = (mode: TimerMode): TimerState => ({
  ordinaryMinutes: 15, seconds: (mode === 'ordinary' ? 15 : 25) * MINUTE,
  endsAt: null, phase: 'focus', cycles: 0, finished: false,
});

function savedTimer(key: string, mode: TimerMode): TimerState {
  try {
    const saved = localStorage.getItem(key);
    return saved ? { ...defaults(mode), ...JSON.parse(saved) } : defaults(mode);
  } catch {
    return defaults(mode);
  }
}

export function timerClock(seconds: number) {
  return [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
}

export function useTimer(userId: number, mode: TimerMode) {
  const key = `hamster-timer-${userId}-${mode}`;
  const [state, setState] = useState(() => savedTimer(key, mode));
  const [now, setNow] = useState(Date.now);
  const seconds = state.endsAt === null ? state.seconds : Math.max(0, Math.ceil((state.endsAt - now) / 1000));

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Storage can be disabled by the client. */ }
  }, [key, state]);

  useEffect(() => {
    if (state.endsAt === null) return;
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 250);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update); };
  }, [state.endsAt]);

  useEffect(() => {
    if (state.endsAt === null || seconds > 0) return;
    setState(previous => {
      if (previous.endsAt === null) return previous;
      if (mode === 'ordinary') return { ...previous, endsAt: null, seconds: 0, finished: true };
      if (previous.phase === 'break') return { ...previous, endsAt: null, phase: 'focus', seconds: 25 * MINUTE, finished: true };
      const cycles = previous.cycles + 1;
      return { ...previous, endsAt: null, phase: 'break', seconds: (cycles % 4 === 0 ? 15 : 5) * MINUTE, cycles, finished: true };
    });
  }, [seconds, state.endsAt, mode]);

  function toggle() {
    const timestamp = Date.now();
    setNow(timestamp);
    setState(previous => {
      if (previous.endsAt !== null) return { ...previous, endsAt: null, seconds: Math.max(1, Math.ceil((previous.endsAt - timestamp) / 1000)) };
      const duration = previous.seconds || previous.ordinaryMinutes * MINUTE;
      return { ...previous, endsAt: timestamp + duration * 1000, seconds: duration, finished: false };
    });
  }

  function reset() {
    setState(previous => ({
      ...defaults(mode), ordinaryMinutes: previous.ordinaryMinutes,
      seconds: (mode === 'ordinary' ? previous.ordinaryMinutes : 25) * MINUTE,
    }));
  }

  function setMinutes(value: number) {
    if (Number.isInteger(value) && value >= 1 && value <= 180) setState(previous => ({
      ...previous, ordinaryMinutes: value, endsAt: null, seconds: value * MINUTE, finished: false,
    }));
  }

  const total = (mode === 'ordinary' ? state.ordinaryMinutes : state.phase === 'focus' ? 25 : state.cycles % 4 === 0 ? 15 : 5) * MINUTE;
  return { ...state, seconds, total, running: state.endsAt !== null, toggle, reset, setMinutes };
}

export function TimerModal({ mode, timer, onClose }: { mode: TimerMode; timer: ReturnType<typeof useTimer>; onClose: () => void }) {
  const [minutes, setMinutes] = useState(String(timer.ordinaryMinutes));
  const label = mode === 'ordinary' ? 'Обычный таймер' : 'Помодоро';
  const progress = 100 * timer.seconds / timer.total;
  return <Modal title={label} onClose={onClose}>
    <div className="timer-panel">
      {mode === 'pomodoro' && <div className="day-choices phase-row"><span className="chip active">{timer.phase === 'focus' ? 'Фокус' : 'Перерыв'}</span><span className="muted">Завершено сессий: {timer.cycles}</span></div>}
      <div className="timer-dial" style={{ background: `conic-gradient(var(--accent) ${progress}%, var(--raised) 0)` }}>
        <div className="timer-dial-inner"><output aria-label="Осталось времени">{timerClock(timer.seconds)}</output></div>
      </div>
      {timer.finished && <p className="timer-finished" role="status">{mode === 'ordinary' ? 'Время вышло.' : timer.phase === 'break' ? 'Рабочая сессия завершена. Можно начать перерыв.' : 'Перерыв завершён. Можно начать новый подход.'}</p>}
      {mode === 'ordinary' && <Field label="Длительность, мин"><input type="number" min={1} max={180} disabled={timer.running}
        value={minutes} onChange={e => {
          setMinutes(e.target.value);
          timer.setMinutes(e.target.valueAsNumber);
        }} /></Field>}
      <div className="actions justify-center">
        <button className="primary" onClick={timer.toggle} disabled={mode === 'ordinary' && (!Number.isInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 180)}>
          {timer.running ? <><Pause size={18} /> Пауза</> : <><Play size={18} /> Старт</>}</button>
        <button className="secondary" onClick={() => { timer.reset(); setMinutes(String(timer.ordinaryMinutes)); }}><RotateCcw size={17} /> Сбросить</button>
      </div>
    </div>
  </Modal>;
}
