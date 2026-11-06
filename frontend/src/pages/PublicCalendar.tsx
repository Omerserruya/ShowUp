import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { color as C } from '../design/tokens';

/**
 * Public "add to calendar" page. Route: /c/:code (no auth - the code comes in
 * the hosts' save-the-date message). Google Calendar opens in the browser /
 * app; everything else (iPhone, Outlook, Samsung) takes the .ics file.
 * Backend: core-service app/routers/public_calendar.py.
 */

type Cal = { title: string; hosts: string; start: string; end: string; venue: string; address: string };

const gcalStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export default function PublicCalendar() {
  const { code = '' } = useParams<{ code: string }>();
  const [data, setData] = useState<Cal | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = 'הוספה ליומן';
    fetch(`/api/public/calendar/${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, [code]);

  const shell = (children: React.ReactNode) => (
    <div dir="rtl" style={{ minHeight: '100vh', background: C.paper, color: C.ink, display: 'flex', justifyContent: 'center', padding: '56px 20px' }}>
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 18, textAlign: 'center' }}>{children}</div>
    </div>
  );
  if (failed) return shell(<p style={{ fontSize: 16, color: C.body }}>הקישור לא נמצא.</p>);
  if (!data) return shell(<p style={{ fontSize: 16, color: C.muted }}>רגע...</p>);

  const where = [data.venue, data.address].filter(Boolean).join(', ');
  const when = new Date(data.start).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  const google = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(data.title)}`
    + `&dates=${gcalStamp(data.start)}/${gcalStamp(data.end)}`
    + `&location=${encodeURIComponent(where)}`
    + (data.hosts ? `&details=${encodeURIComponent('מארחים: ' + data.hosts)}` : '');
  const btn: React.CSSProperties = {
    display: 'block', minHeight: 54, lineHeight: '54px', borderRadius: 14, background: C.lav, color: C.ink,
    fontSize: 17, fontWeight: 600, textDecoration: 'none',
  };

  return shell(
    <>
      <div style={{ fontSize: 44 }} aria-hidden>📅</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>{data.title}</h1>
      <p style={{ fontSize: 16, color: C.body, margin: 0, lineHeight: 1.7 }}>
        {when}
        {where && <><br />{where}</>}
      </p>
      <a href={google} rel="noopener noreferrer" style={btn}>הוספה ליומן גוגל</a>
      <a href={`/api/public/calendar/${encodeURIComponent(code)}.ics`} style={{ ...btn, background: C.tint }}>
        אייפון / אאוטלוק / יומן אחר
      </a>
    </>,
  );
}
