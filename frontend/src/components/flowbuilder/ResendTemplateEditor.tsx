/**
 * Template node: which approved WhatsApp template to (re)send when the
 * conversation enters this node (`resend_template: {name, language, params}`).
 * Offers a picker of Template Studio templates approved on Meta (flow group
 * first) that fills the name, language and one input per positional variable;
 * manual entry stays possible for catalog/legacy templates.
 */
import React, { useEffect, useState } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Ms } from '../v6/ui';
import { Field, Toggle, inputBase, selectBase } from './controls';
import { templatesApi, type ApprovedTemplate } from '../templates/api';
import type { ResendTemplate } from './types';

interface Props {
  value: ResendTemplate | null | undefined;
  onChange: (v: ResendTemplate | null) => void;
  variables: { key: string; label: string }[];
}

let cache: ApprovedTemplate[] | null = null;

export default function ResendTemplateEditor({ value, onChange, variables }: Props) {
  const [list, setList] = useState<ApprovedTemplate[] | null>(cache);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    templatesApi.approved().then((r) => {
      cache = r.templates;
      if (alive) setList(r.templates);
    }).catch(() => { if (alive) { setFailed(true); setList([]); } });
    return () => { alive = false; };
  }, []);

  const on = !!value;
  const picked = list?.find((t) => t.name === value?.name) || null;
  const params = value?.params || [];

  const pick = (name: string) => {
    const t = list?.find((x) => x.name === name);
    if (!t) return;
    onChange({ name: t.name, language: t.language, params: t.params.map((p) => p.suggested || '') });
  };
  const setParam = (i: number, v: string) => {
    if (!value) return;
    const next = [...params];
    next[i] = v;
    onChange({ ...value, params: next });
  };
  const count = picked ? picked.params.length : params.length;

  return (
    <Field label="שליחת תבנית בכניסה לצומת"
      hint="כשהשיחה מגיעה לצומת הזה נשלחת שוב תבנית מאושרת. ערכי המשתנים יכולים לכלול משתני שיחה כמו {guest_name}."
      aside={<Toggle checked={on} label="שליחת תבנית" onChange={(v) => onChange(v ? { name: '', language: 'he', params: [] } : null)} />}>
      {on && value && (
        <div style={{ display: 'grid', gap: 10 }}>
          <select style={selectBase} value={picked ? picked.name : ''} onChange={(e) => pick(e.target.value)} aria-label="בחירת תבנית מאושרת">
            <option value="">{list === null ? 'טוען תבניות…' : list.length ? 'בחירה מתבניות מאושרות…' : 'אין עדיין תבניות מאושרות'}</option>
            {list && ['flow', 'other'].map((bucket) => {
              const items = list.filter((t) => (bucket === 'flow' ? t.group === 'flow' : t.group !== 'flow'));
              if (!items.length) return null;
              return (
                <optgroup key={bucket} label={bucket === 'flow' ? 'בונה השיחה' : 'תבניות מאושרות אחרות'}>
                  {items.map((t) => <option key={t.key} value={t.name}>{t.title}{t.body_params_only ? '' : ' (עם תמונה/קישור)'}</option>)}
                </optgroup>
              );
            })}
          </select>
          {failed && <div style={{ fontSize: 12.5, color: C.muted }}>לא הצלחנו לטעון את רשימת התבניות - אפשר להזין ידנית.</div>}
          {picked && !picked.body_params_only && (
            <div style={{ display: 'flex', gap: 6, fontSize: 12.5, color: C.warn, lineHeight: 1.45 }}>
              <Ms size={16}>warning</Ms>
              <span>לתבנית יש כותרת עם משתנה, תמונה או קישור אישי - בשליחה מהשיחה נשלחים רק משתני הגוף, ולכן Meta עלולה לדחות אותה.</span>
            </div>
          )}
          {picked && (
            <div style={{ fontSize: 12.5, color: C.body, background: C.paperSoft, border: `1px solid ${C.line2}`, borderRadius: radius.md, padding: '8px 10px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {picked.body}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: 8 }}>
            <input dir="ltr" style={{ ...inputBase, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }} value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value.trim() })} placeholder="שם התבנית ב-Meta" aria-label="שם התבנית ב-Meta" />
            <input dir="ltr" style={inputBase} value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value.trim() })}
              placeholder="he" aria-label="שפה" />
          </div>
          {Array.from({ length: count }).map((_, i) => {
            const hint = picked?.params[i];
            return (
              <div key={i}>
                <div style={{ fontSize: 12.5, color: C.body, marginBottom: 4 }}>
                  <code dir="ltr">{`{{${i + 1}}}`}</code> {hint ? `${hint.label_he} · לדוגמה: ${hint.sample}` : `משתנה ${i + 1}`}
                </div>
                <input style={inputBase} value={params[i] || ''} onChange={(e) => setParam(i, e.target.value)}
                  placeholder={hint?.suggested || 'טקסט או {guest_name}'} aria-label={`ערך למשתנה ${i + 1}`} />
              </div>
            );
          })}
          {!picked && (
            <button type="button" onClick={() => onChange({ ...value, params: [...params, ''] })}
              style={{ justifySelf: 'start', background: 'none', border: 0, color: C.purple, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              + הוספת משתנה
            </button>
          )}
          {!!variables.length && (
            <div style={{ fontSize: 12, color: C.muted }}>
              משתני שיחה: {variables.map((v) => `{${v.key}} ${v.label}`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}
