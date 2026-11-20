import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, CircleDollarSign, PawPrint, Plus, Settings } from 'lucide-react';
import '@fontsource-variable/manrope';
import './styles.css';
import { api, errorText, telegram, type CalendarEvent, type Home, type Me } from './api';
import { Calendar, EventModal, type CalendarOverlay } from './calendar';
import { Chat } from './chat';
import { Dashboard, Shop } from './dashboard';
import { ProfileScreen } from './profile';
import { Feedback, petArt } from './ui';

type Tab = 'hamster' | 'calendar';
type Screen = 'main' | 'settings' | 'shop' | 'chat';

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [home, setHome] = useState<Home | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [homeNotice, setHomeNotice] = useState('');
  const [screen, setScreen] = useState<Screen>('main');
  const [tab, setTab] = useState<Tab>('hamster');
  const [selection, setSelection] = useState<CalendarOverlay | null>(null);
  const [revision, setRevision] = useState(0);
  const [eveningBusy, setEveningBusy] = useState(false);

  const authenticate = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      setMe(await api<Me>('/me'));
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const app = telegram();
    app?.ready();
    app?.expand();
    app?.setHeaderColor?.('#17191D');
    app?.setBackgroundColor?.('#17191D');
    void authenticate();
  }, [authenticate]);

  useEffect(() => {
    if (!me?.onboarded) return;
    let alive = true;
    let generation = 0;
    let boundary: number | undefined;
    const load = async () => {
      const request = ++generation;
      try {
        const result = await api<Home>('/home');
        if (alive && generation === request) {
          setHome(result);
          setHomeNotice('');
          window.clearTimeout(boundary);
          const delay = result.refresh_in_ms ?? Infinity;
          if (delay < 15000) boundary = window.setTimeout(load, Math.max(delay + 300, 1000));
        }
      } catch (error) {
        if (alive && generation === request) setHomeNotice(errorText(error));
      }
    };
    void load();
    const interval = window.setInterval(load, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.clearTimeout(boundary);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [me, revision]);

  const changed = () => setRevision(value => value + 1);

  function open(next: Screen) {
    setScreen(next);
    window.scrollTo(0, 0);
  }

  function switchTab(next: Tab) {
    setTab(next);
    window.scrollTo(0, 0);
  }

  function openEvent(event: CalendarEvent) {
    setSelection({ mode: 'detail', event });
  }

  function saveProfile(value: Me) {
    setMe(value);
    if (!me?.onboarded) setTab('hamster');
    open('main');
    changed();
  }

  async function acknowledgeEvening() {
    setEveningBusy(true);
    try {
      await api('/evening', 'POST');
      setHome(previous => previous ? { ...previous, evening: null } : previous);
      changed();
    } catch (error) {
      setHomeNotice(errorText(error));
    } finally {
      setEveningBusy(false);
    }
  }

  if (loading || !me) return <main className="startup">
    <img src={petArt.idle} alt="" /><h1>Hamster Time Manager</h1>
    {loading ? <p className="muted" role="status">Открываем приложение…</p> : <><Feedback text={notice} />
      {telegram()?.initData && <button className="secondary" onClick={authenticate}>Повторить</button>}</>}
  </main>;

  if (!me.onboarded || screen === 'settings') return <ProfileScreen me={me} onSave={saveProfile} onBack={() => open('main')} />;
  if (screen === 'shop') return <Shop onBack={() => open('main')} />;
  if (screen === 'chat') return <Chat zone={me.profile.timezone} onBack={() => open('main')} onChange={changed} />;
  return <div className="app-frame">
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><PawPrint size={22} strokeWidth={2.3} /></span><span>Hamster Time<br className="brand-break" /> Manager</span></div>
      <div className="header-actions">
        <span className="coins" aria-label={home ? `${home.coins} койнов` : 'Загружаем койны'}><CircleDollarSign size={20} />{home?.coins ?? '…'}</span>
        <button className="icon-button app-settings" aria-label="Настройки" title="Настройки" onClick={() => open('settings')}><Settings size={20} /></button>
        {tab === 'hamster' && <button className="icon-button header-add" aria-label="Открыть ИИ-планировщик" title="ИИ-планировщик" onClick={() => open('chat')}><Plus size={25} /></button>}
      </div>
    </header>
    <main className="main-content">
      <Feedback text={homeNotice} />
      {tab === 'hamster' ? (home ? <Dashboard home={home} zone={me.profile.timezone} userId={me.id}
        onShop={() => open('shop')} onEvent={openEvent}
        onReport={event => setSelection({ mode: 'report', event })}
        onEvening={acknowledgeEvening} eveningBusy={eveningBusy} />
        : !homeNotice && <p className="loading-line" role="status">Загружаем расписание…</p>)
        : <Calendar zone={me.profile.timezone} revision={revision} onCreate={day => setSelection({ mode: 'new', day })} onEvent={openEvent} />}
    </main>
    <footer className="nav-shell">
      <nav className="bottom-nav" aria-label="Разделы">
        <button type="button" className={tab === 'hamster' ? 'active' : ''} aria-current={tab === 'hamster' ? 'page' : undefined}
          onClick={() => switchTab('hamster')}><PawPrint size={21} /> Хомяк</button>
        <button type="button" className={tab === 'calendar' ? 'active' : ''} aria-current={tab === 'calendar' ? 'page' : undefined}
          onClick={() => switchTab('calendar')}><CalendarDays size={21} /> Календарь</button>
      </nav>
    </footer>
    {selection && <EventModal selection={selection} zone={me.profile.timezone} onClose={() => setSelection(null)} onChange={changed} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
