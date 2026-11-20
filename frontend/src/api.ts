export interface TelegramApp {
  initData: string;
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  HapticFeedback?: { impactOccurred(style: 'light'): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramApp };
  }
}

export const telegram = () => window.Telegram?.WebApp;

export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const initData = telegram()?.initData;
  if (!initData) throw new Error('Откройте приложение кнопкой в личном чате с ботом.');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: { Authorization: `tma ${initData}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new Error('Не удалось связаться с сервером. Проверьте соединение и повторите.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.detail || 'Не удалось выполнить запрос. Попробуйте ещё раз.');
  return payload as T;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Что-то пошло не так. Попробуйте ещё раз.';
}

export const categories = {
  university: 'Пары', gym: 'Спортзал', personal: 'Личное', event: 'Мероприятие',
  sleep: 'Сон', study: 'Учёба', task: 'Задача', deadline: 'Дедлайн', break: 'Перерыв', travel: 'Дорога',
} as const;

export const statuses = { pending: 'Запланировано', completed: 'Выполнено', partial: 'Частично', missed: 'Не выполнено' } as const;
export const priorities = { 1: 'Низкий', 2: 'Обычный', 3: 'Высокий' } as const;
export type Category = keyof typeof categories;
export type Status = keyof typeof statuses;
export type ResultStatus = Exclude<Status, 'pending'>;
export type Priority = keyof typeof priorities;
export type PetState = 'sleeping' | 'working' | 'tired' | 'idle';

export interface Profile {
  timezone: string;
  sleep: string;
  wake: string;
  university: string;
  travel_minutes: number;
  gym: string;
  regular: string;
  personal: string;
  study_from: string;
  study_to: string;
  study_days: number[];
  availability: string;
  desired_hours: number | null;
  realistic_hours: number | null;
  focus_from: string | null;
  focus_to: string | null;
  session_minutes: number;
  procrastination: string;
  obstacles: string;
  style: 'balanced' | 'brief' | 'supportive';
  reminders: 'off' | 'reports' | 'evening' | 'both';
  evening_time: string;
}

export interface Rule {
  title: string;
  category: Exclude<Category, 'task' | 'deadline'>;
  days: number[];
  start: string;
  end: string;
  description: string;
}

export interface Me {
  id: number;
  name: string;
  onboarded: boolean;
  profile: Profile;
  schedule: Rule[];
}

export interface ReportInput {
  status: ResultStatus;
  comment: string;
  done: string;
  remaining: string;
  obstacle: string;
  remaining_minutes: number | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  category: Category;
  start_utc: string;
  end_utc: string;
  deadline_utc: string | null;
  deadline_date_only: boolean;
  priority: Priority;
  description: string;
  status: Status;
  minutes: number;
  recurring: boolean;
  report: ReportInput | null;
}

export interface Home {
  refresh_in_ms: number | null;
  state: PetState;
  current: CalendarEvent | null;
  next: CalendarEvent | null;
  reports: CalendarEvent[];
  coins: number;
  evening: { completed: number; open: number } | null;
}

export interface Draft {
  id: number;
  kind: 'chat' | 'report';
  events: CalendarEvent[];
  warnings: string[];
  alternatives: string[];
  start_date: string;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export const isWork = (category: Category) => category === 'study' || category === 'task';
