/** Template Studio editor panel: identity, header, body + variable chips, footer, buttons. */
import React, { useMemo, useRef } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Btn, Ms } from '../v6/ui';
import { Counter, ErrorLine, Field, IconBtn, inputBase, insertAtCaret, selectBase } from '../flowbuilder/controls';
import type { GroupDef, Issue, TemplateDoc, TplButton, VariablesResponse } from './api';
import { slugify } from './api';

interface Props {
  doc: TemplateDoc;
  onChange: (patch: Partial<TemplateDoc>) => void;
  onGroupChange: (group: string) => void;
  vars: VariablesResponse | null;
  groups: GroupDef[];
  issues: Issue[];
  warnings: Issue[];
  nameLocked: boolean;
  nameTouched: boolean;
  onNameTouched: () => void;
}

const LANGS = [
  { id: 'he', label: 'עברית' }, { id: 'en', label: 'אנגלית' }, { id: 'en_US', label: 'אנגלית (ארה״ב)' },
  { id: 'ar', label: 'ערבית' }, { id: 'ru', label: 'רוסית' }, { id: 'fr', label: 'צרפתית' },
];

const SCOPE_LABEL: Record<string, string> = { guest: 'האורח', event: 'האירוע', subject: 'בעלי השמחה', link: 'קישורים' };
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string; icon?: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '0 12px', borderRadius: 10,
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
            border: `1.5px solid ${on ? C.purple : C.lineApp}`, background: on ? C.tintApp : '#FFFFFF', color: on ? C.purpleDark : C.body,
          }}>
            {o.icon && <Ms size={17}>{o.icon}</Ms>}{o.label}
          </button>
        );
      })}
    </div>
  );
}

const msgs = (list: Issue[], prefix: string) => list.filter((i) => i.field === prefix || i.field.startsWith(`${prefix}[`));

export default function TemplateEditor({ doc, onChange, onGroupChange, vars, groups, issues, warnings, nameLocked, nameTouched, onNameTouched }: Props) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const headRef = useRef<HTMLInputElement>(null);
  const limits = vars?.limits || {};
  const textVars = useMemo(() => (vars?.variables || []).filter((v) => v.in_text), [vars]);
  const byScope = useMemo(() => {
    const out: Record<string, typeof textVars> = {};
    textVars.forEach((v) => { (out[v.scope] = out[v.scope] || []).push(v); });
    return out;
  }, [textVars]);
  const labelOf = (name: string) => textVars.find((v) => v.name === name)?.label_he || name;
  const allowCustom = doc.group === 'flow' || doc.group === 'host';
  const known = new Set((vars?.variables || []).map((v) => v.name));
  const customVars = Array.from(new Set(Array.from(doc.body.matchAll(TOKEN)).map((m) => m[1].trim())))
    .filter((n) => /^[a-z][a-z0-9_]*$/.test(n) && !known.has(n));
  const bodyVars = Array.from(new Set(Array.from(doc.body.matchAll(TOKEN)).map((m) => m[1].trim())));
  const btnKind: 'none' | 'QUICK_REPLY' | 'URL' = doc.buttons.length ? doc.buttons[0].type : 'none';

  const insertBody = (name: string) => {
    const { next, caret } = insertAtCaret(bodyRef.current, doc.body, `{{${name}}}`);
    onChange({ body: next });
    requestAnimationFrame(() => { const el = bodyRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret); } });
  };
  const insertHeader = (name: string) => {
    const cur = doc.header.text || '';
    const { next, caret } = insertAtCaret(headRef.current, cur, `{{${name}}}`);
    onChange({ header: { ...doc.header, text: next } });
    requestAnimationFrame(() => { const el = headRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret); } });
  };

  const setTitle = (title: string) => {
    const patch: Partial<TemplateDoc> = { title };
    if (!nameLocked && !nameTouched) patch.name = slugify(title);
    onChange(patch);
  };

  const setButtons = (buttons: TplButton[]) => onChange({ buttons });
  const setBtn = (i: number, patch: Partial<TplButton>) => setButtons(doc.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const setBtnKind = (kind: 'none' | 'QUICK_REPLY' | 'URL') => {
    if (kind === 'none') setButtons([]);
    else if (kind === 'QUICK_REPLY') setButtons([
      { type: 'QUICK_REPLY', text: 'מגיעים!', action: 'rsvp_accepted' },
      { type: 'QUICK_REPLY', text: 'לא נוכל להגיע', action: 'rsvp_declined' },
    ]);
    else setButtons([{ type: 'URL', text: 'לפרטים ואישור הגעה', url_var: 'invitation_link', url: '' }]);
  };
  const maxBtns = btnKind === 'URL' ? (limits.url_buttons || 2) : (limits.quick_replies || 3);
  const toggleEventType = (key: string) => {
    const has = doc.event_types.includes(key);
    onChange({ event_types: has ? doc.event_types.filter((e) => e !== key) : [...doc.event_types, key] });
  };

  const fieldErr = (f: string) => msgs(issues, f).map((i, n) => <ErrorLine key={`${i.code}-${n}`}>{i.message}</ErrorLine>);
  const fieldWarn = (f: string) => msgs(warnings, f).map((i, n) => (
    <div key={`${i.code}-${n}`} style={{ display: 'flex', gap: 6, color: C.warn, fontSize: 12.5, marginTop: 6, lineHeight: 1.45 }}>
      <Ms size={16}>warning</Ms><span>{i.message}</span>
    </div>
  ));

  return (
    <div>
      <div className="ts-two">
        <Field label="שם התבנית (לתצוגה)" aside={<Counter value={doc.title.length} max={limits.title || 120} />}>
          <input style={inputBase} value={doc.title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: הזמנה חגיגית עם תמונה" />
          {fieldErr('title')}
        </Field>
        <Field label="השם ב-Meta" hint={nameLocked ? 'השם נקבע בשליחה הראשונה ל-Meta ולא ניתן לשנותו.' : 'אותיות אנגליות קטנות, ספרות וקו תחתון. נוצר אוטומטית מהשם באנגלית, אפשר לשנות.'}>
          <input dir="ltr" style={{ ...inputBase, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13.5, background: nameLocked ? C.paperSoft : '#FFFFFF' }}
            value={doc.name} disabled={nameLocked}
            onChange={(e) => { onNameTouched(); onChange({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }); }}
            placeholder="garden_invitation" aria-label="השם ב-Meta" />
          {fieldErr('name')}
        </Field>
      </div>

      <div className="ts-two">
        <Field label="קבוצה" hint="לאן התבנית שייכת: שלב בסבבי האורחים, בונה השיחה או הודעות למארחים.">
          <select style={selectBase} value={doc.group} onChange={(e) => onGroupChange(e.target.value)} aria-label="קבוצה">
            <optgroup label="סבבים לאורחים">
              {groups.filter((g) => g.guest).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </optgroup>
            <optgroup label="אחר">
              {groups.filter((g) => !g.guest).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </optgroup>
          </select>
          {fieldErr('group')}
        </Field>
        <Field label="קטגוריה ב-Meta" hint="שירות - עדכון על אירוע שהאורח מוזמן אליו. שיווקית - כל דבר פרסומי. Meta רשאית לשנות.">
          <Segmented label="קטגוריה" value={doc.category as 'UTILITY' | 'MARKETING'}
            options={[{ id: 'UTILITY', label: 'שירות' }, { id: 'MARKETING', label: 'שיווקית' }]}
            onChange={(v) => onChange({ category: v })} />
          {fieldErr('category')}{fieldWarn('category')}
        </Field>
      </div>

      <div className="ts-two">
        <Field label="שפה">
          <select style={selectBase} value={doc.language} onChange={(e) => onChange({ language: e.target.value })} aria-label="שפה">
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            {!LANGS.some((l) => l.id === doc.language) && <option value={doc.language}>{doc.language}</option>}
          </select>
          {fieldErr('language')}
        </Field>
        <Field label="סוגי אירוע" hint="בלי בחירה - התבנית זמינה לכל סוגי האירועים.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(vars?.event_types || []).map((et) => {
              const on = doc.event_types.includes(et.key);
              return (
                <button key={et.key} type="button" aria-pressed={on} onClick={() => toggleEventType(et.key)} style={{
                  height: 30, padding: '0 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1.5px solid ${on ? C.purple : C.lineApp}`, background: on ? C.tintApp : '#FFFFFF', color: on ? C.purpleDark : C.body,
                }}>{et.name_he}</button>
              );
            })}
          </div>
          {fieldErr('event_types')}
        </Field>
      </div>

      <Field label="כותרת עליונה" hint="לא חובה. כותרת טקסט עד 60 תווים ועם משתנה אחד לכל היותר, או תמונה.">
        <Segmented label="סוג כותרת" value={doc.header.type}
          options={[{ id: 'none', label: 'ללא' }, { id: 'text', label: 'טקסט', icon: 'title' }, { id: 'image', label: 'תמונה', icon: 'image' }]}
          onChange={(t) => onChange({ header: t === 'image' ? { type: 'image', url: doc.header.url || '', source: doc.header.source || 'event' } : t === 'text' ? { type: 'text', text: doc.header.text || '' } : { type: 'none' } })} />
        {doc.header.type === 'text' && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input ref={headRef} style={inputBase} value={doc.header.text || ''} aria-label="טקסט הכותרת"
                onChange={(e) => onChange({ header: { ...doc.header, text: e.target.value } })} placeholder="למשל: {{guest_first_name}}, מוזמנים!" />
              <Counter value={(doc.header.text || '').replace(TOKEN, '{{1}}').length} max={limits.header_text || 60} />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {['guest_first_name', 'guest_name', 'event_name', 'host_display_name'].filter((n) => known.has(n)).map((n) => (
                <VarBtn key={n} label={labelOf(n)} onClick={() => insertHeader(n)} />
              ))}
            </div>
          </div>
        )}
        {doc.header.type === 'image' && (
          <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
            <input dir="ltr" style={inputBase} value={doc.header.url || ''} aria-label="קישור לתמונת דוגמה"
              onChange={(e) => onChange({ header: { ...doc.header, url: e.target.value.trim() } })} placeholder="https://…/sample.jpg" />
            <div style={{ fontSize: 12.5, color: C.muted }}>תמונת הדוגמה נשלחת ל-Meta לאישור (JPG או PNG).</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13.5, color: C.body }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" checked={doc.header.source !== 'fixed'} onChange={() => onChange({ header: { ...doc.header, source: 'event' } })} style={{ accentColor: C.purple }} />
                בשליחה: התמונה של כל אירוע
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" checked={doc.header.source === 'fixed'} onChange={() => onChange({ header: { ...doc.header, source: 'fixed' } })} style={{ accentColor: C.purple }} />
                תמיד התמונה הזו
              </label>
            </div>
          </div>
        )}
        {fieldErr('header')}{fieldWarn('header')}
      </Field>

      <Field label="גוף ההודעה" aside={<Counter value={doc.body.replace(TOKEN, '{{1}}').length} max={limits.body || 1024} />}
        hint="לחיצה על משתנה מוסיפה אותו במקום הסמן. ההודעה לא יכולה להתחיל או להסתיים במשתנה, ואסור ששני משתנים יופיעו צמודים.">
        <textarea ref={bodyRef} rows={8} dir="rtl" style={{ ...inputBase, resize: 'vertical', borderColor: msgs(issues, 'body').length ? C.errBorder : C.field }}
          value={doc.body} onChange={(e) => onChange({ body: e.target.value })} aria-label="גוף ההודעה"
          placeholder={'היי {{guest_name}},\nשמחים להזמין אותך ל{{event_name}} ב{{event_date}}.\nנשמח לדעת אם תגיעו 💜'} />
        {fieldErr('body')}{fieldWarn('body')}
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {Object.entries(byScope).map(([scope, list]) => (
            <div key={scope} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.muted, minWidth: 64 }}>{SCOPE_LABEL[scope] || scope}</span>
              {list.map((v) => <VarBtn key={v.name} label={v.label_he} title={`{{${v.name}}} · ${v.sample}`} active={bodyVars.includes(v.name)} onClick={() => insertBody(v.name)} />)}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>*כוכביות* = מודגש, _קו תחתון_ = נטוי, ~גלים~ = קו חוצה.</div>
        {allowCustom && customVars.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: radius.md, background: C.paperSoft, border: `1px solid ${C.line2}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>דוגמאות למשתנים מותאמים</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>Meta דורשת ערך לדוגמה לכל משתנה. השולח יספק את הערך האמיתי.</div>
            {customVars.map((n) => (
              <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <code dir="ltr" style={{ fontSize: 12.5, minWidth: 110 }}>{`{{${n}}}`}</code>
                <input style={inputBase} value={doc.samples[n] || ''} aria-label={`דוגמה ל-${n}`}
                  onChange={(e) => onChange({ samples: { ...doc.samples, [n]: e.target.value } })} placeholder="ערך לדוגמה" />
              </div>
            ))}
          </div>
        )}
      </Field>

      <Field label="כותרת תחתונה" aside={<Counter value={doc.footer.length} max={limits.footer || 60} />} hint="לא חובה. טקסט קטן ואפור, בלי משתנים.">
        <input style={inputBase} value={doc.footer} onChange={(e) => onChange({ footer: e.target.value })} placeholder="למשל: נשלח באמצעות ShowUp" aria-label="כותרת תחתונה" />
        {fieldErr('footer')}
      </Field>

      <Field label="כפתורים" aside={btnKind !== 'none' ? <span style={{ fontSize: 12, color: doc.buttons.length > maxBtns ? C.err : C.muted }}>{doc.buttons.length}/{maxBtns}</span> : undefined}
        hint="תשובה מהירה - עד 3 כפתורים שהאורח לוחץ ועונה. קישור - עד 2 כפתורים שפותחים דף.">
        <Segmented label="סוג כפתורים" value={btnKind}
          options={[{ id: 'none', label: 'ללא' }, { id: 'QUICK_REPLY', label: 'תשובה מהירה', icon: 'reply' }, { id: 'URL', label: 'קישור', icon: 'link' }]}
          onChange={setBtnKind} />
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          {doc.buttons.map((b, i) => (
            <div key={i} style={{ padding: 10, borderRadius: radius.md, border: `1.5px solid ${msgs(issues, `buttons[${i}]`).length ? C.errBorder : C.line2}`, background: C.paperSoft }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input style={inputBase} value={b.text} onChange={(e) => setBtn(i, { text: e.target.value })} placeholder={`כפתור ${i + 1}`} aria-label={`טקסט כפתור ${i + 1}`} />
                <Counter value={b.text.length} max={limits.button_text || 25} />
                <IconBtn icon="close" label="הסרת כפתור" tone="danger" size={30} onClick={() => setButtons(doc.buttons.filter((_, j) => j !== i))} />
              </div>
              {b.type === 'QUICK_REPLY' && (
                <select style={{ ...selectBase, marginTop: 8 }} value={b.action || ''} onChange={(e) => setBtn(i, { action: e.target.value || undefined })} aria-label="משמעות הכפתור">
                  <option value="">ללא משמעות מיוחדת</option>
                  {(vars?.quick_reply_actions || []).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              )}
              {b.type === 'URL' && (
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                  <select style={selectBase} value={b.url_var || ''} onChange={(e) => setBtn(i, { url_var: e.target.value, url: e.target.value ? '' : b.url })} aria-label="לאן הכפתור מוביל">
                    {(vars?.url_vars || []).map((u) => <option key={u.name} value={u.name}>{u.label_he} (אישי לכל אורח)</option>)}
                    <option value="">קישור קבוע</option>
                  </select>
                  {!b.url_var && (
                    <input dir="ltr" style={inputBase} value={b.url || ''} onChange={(e) => setBtn(i, { url: e.target.value.trim() })} placeholder="https://…" aria-label="קישור" />
                  )}
                </div>
              )}
              {fieldErr(`buttons[${i}]`)}{fieldWarn(`buttons[${i}]`)}
            </div>
          ))}
          {btnKind !== 'none' && doc.buttons.length < maxBtns && (
            <Btn kind="smallGhost" style={{ justifySelf: 'start' }} onClick={() => setButtons([...doc.buttons,
              btnKind === 'URL' ? { type: 'URL', text: '', url_var: '', url: '' } : { type: 'QUICK_REPLY', text: '' }])}>
              <Ms size={18}>add</Ms>הוספת כפתור
            </Btn>
          )}
        </div>
        {fieldErr('buttons')}
      </Field>

      <Field label="הערות פנימיות" hint="רק לצוות - לא נשלח ל-Meta ולא לאורחים.">
        <textarea rows={2} style={{ ...inputBase, resize: 'vertical' }} value={doc.notes} onChange={(e) => onChange({ notes: e.target.value })} aria-label="הערות פנימיות" />
      </Field>
    </div>
  );
}

const VarBtn = ({ label, onClick, title, active }: { label: string; onClick: () => void; title?: string; active?: boolean }) => (
  <button type="button" onClick={onClick} title={title} style={{
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 9px', borderRadius: 8,
    border: `1.5px solid ${active ? C.purple : C.tintBorder}`, background: C.tintApp, color: C.purpleDark, fontSize: 12.5, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  }}>
    <Ms size={14}>add</Ms>{label}
  </button>
);
