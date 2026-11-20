import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, Send, Sparkles } from 'lucide-react';
import { api, errorText, type Draft, type Message } from './api';
import { addDays, todayIn } from './time';
import { DraftCard, Feedback, petArt, ScreenHeader } from './ui';

type History = { messages: Message[]; draft: Draft | null };

export function Chat({ zone, onBack, onChange }: { zone: string; onBack: () => void; onChange: () => void }) {
  const today = todayIn(zone);
  const [start, setStart] = useState(today);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api<History>('/chat').then(history => {
      if (!active) return;
      setMessages(history.messages);
      setDraft(history.draft);
      if (history.draft && history.draft.start_date >= today) setStart(history.draft.start_date);
    }).catch(error => { if (active) setNotice(errorText(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [today]);

  useEffect(() => {
    if (messages.length || draft) bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, draft?.id]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setNotice('');
    setText('');
    const temporary: Message = { id: -Date.now(), role: 'user', text: content, at: new Date().toISOString() };
    setMessages(history => [...history, temporary]);
    try {
      const result = await api<{ message: Message; draft: Draft | null }>('/chat', 'POST', {
        text: content, start_date: start, draft_id: editing ? draft?.id : null,
      });
      setMessages(history => [...history, result.message]);
      if (result.draft) {
        setDraft(result.draft);
        setEditing(false);
      }
      const history = await api<History>('/chat').catch(() => null);
      if (history) {
        setMessages(history.messages);
        setDraft(history.draft);
      }
    } catch (error) {
      const history = await api<History>('/chat').catch(() => null);
      if (history) {
        setMessages(history.messages);
        setDraft(history.draft);
        if (!history.draft) setEditing(false);
      }
      if (!history || history.messages.at(-1)?.text !== content) setText(content);
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: 'accept' | 'cancel') {
    if (!draft || busy) return;
    setBusy(true);
    setNotice('');
    try {
      await api(`/drafts/${draft.id}/${action}`, 'POST');
      setDraft(null);
      setEditing(false);
      if (action === 'accept') onChange();
      const history = await api<History>('/chat').catch(() => null);
      if (history) setMessages(history.messages);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return <main className="subscreen chat">
    <ScreenHeader title="ИИ-планировщик" onBack={onBack}><span className="chat-icon"><Sparkles size={21} /></span></ScreenHeader>
    <div className="chat-date card"><label><CalendarDays size={18} /><span>Начало 7-дневного плана</span>
      <input aria-label="Начало 7-дневного плана" type="date" min={today} max={addDays(today, 365)} value={start}
        disabled={busy} required form="chat-message" onChange={e => setStart(e.target.value)} /></label></div>
    <div className="chat-messages" aria-label="История сообщений">
      {loading ? <p className="muted" role="status">Загружаем историю…</p> : <>
        {messages.length === 0 && <div className="chat-message assistant"><span className="bot-avatar"><img src={petArt.idle} alt="" /></span>
          <p className="bubble">Расскажи, какие задачи и события нужно разместить. Подготовлю черновик, который можно проверить.</p></div>}
        {messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}>
          {message.role === 'assistant' && <span className="bot-avatar"><img src={petArt.idle} alt="" /></span>}
          <p className="bubble">{message.text}</p>
        </div>)}
        {busy && <p className="muted" role="status">Обрабатываем запрос…</p>}
      </>}
      <div ref={bottom} />
    </div>
    {draft && <DraftCard draft={draft} zone={zone} busy={busy} onDecision={decide}
      onEdit={() => { setEditing(true); input.current?.focus(); }} />}
    <Feedback text={notice} />
    <form className="composer" id="chat-message" onSubmit={submit}>
      <textarea ref={input} aria-label={editing ? 'Что изменить в черновике' : 'Сообщение для ИИ'} maxLength={3000}
        placeholder={editing ? 'Что изменить в черновике?' : 'Напиши, что нужно запланировать…'}
        rows={2} value={text} onChange={e => setText(e.target.value)} />
      <button type="submit" className="primary" aria-label="Отправить" disabled={loading || busy || !text.trim()}><Send size={20} /></button>
    </form>
  </main>;
}
