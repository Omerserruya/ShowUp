import React, { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { alpha } from '@mui/material/styles';
import { TemplateVarGroup, ContentBlock, validateTemplateBodyMeta } from '../config/templates';

const BRAND = '#888cee';

interface CustomMessageEditorProps {
  value: string; // canonical message text using {{key}} placeholders
  onChange: (value: string) => void;
  title: string;
  onTitleChange: (value: string) => void;
  groups: TemplateVarGroup[];
  blocks: ContentBlock[];
  /** Resolved sample values keyed by placeholder, for hover previews. */
  variables: Record<string, string>;
  /** Reports whether the message satisfies WhatsApp/Meta template rules. */
  onValidityChange?: (valid: boolean) => void;
}

const PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/;

/**
 * Token-based message builder (Mailchimp/HubSpot-style), kept simple. Variables
 * render as removable inline BADGES inside the text — never raw {{ }}. You insert
 * by click or by dragging onto the exact spot in the sentence, remove with the ×
 * (or Backspace), and typing/pasting a raw {{key}} auto-converts into a badge.
 * Internally it always serializes back to {{key}} so the preview + send pipeline
 * is unchanged.
 */
export default function CustomMessageEditor({
  value,
  onChange,
  title,
  onTitleChange,
  groups,
  blocks,
  variables,
  onValidityChange,
}: CustomMessageEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastSerialized = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pulse, setPulse] = useState(false);

  // Live WhatsApp/Meta template validation (no var at start/end, no adjacent vars…).
  const issues = useMemo(() => validateTemplateBodyMeta(value), [value]);
  useEffect(() => {
    onValidityChange?.(issues.length === 0);
  }, [issues, onValidityChange]);

  const keyToLabel = useMemo(() => {
    const m: Record<string, string> = {};
    groups.forEach((g) => g.items.forEach((it) => { m[it.key] = it.label; }));
    return m;
  }, [groups]);
  // Keep a ref so DOM helpers (built outside React render) read fresh labels.
  const labelRef = useRef(keyToLabel);
  labelRef.current = keyToLabel;

  // --- DOM <-> string helpers ------------------------------------------------
  const makeChip = (key: string): HTMLElement => {
    const span = document.createElement('span');
    span.className = 'su-chip';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-var', key);
    const text = document.createElement('span');
    text.className = 'su-chip-text';
    text.textContent = labelRef.current[key] || key;
    const x = document.createElement('span');
    x.className = 'su-chip-x';
    x.setAttribute('data-x', '1');
    x.textContent = '×';
    span.appendChild(text);
    span.appendChild(x);
    return span;
  };

  const buildInto = (el: HTMLElement, text: string) => {
    el.innerHTML = '';
    const parts = text.split(/(\{\{\s*[^}]+?\s*\}\})/g);
    parts.forEach((part) => {
      const m = part.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
      if (m) {
        el.appendChild(makeChip(m[1].trim()));
      } else if (part) {
        el.appendChild(document.createTextNode(part));
      }
    });
  };

  const serializeNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.dataset && el.dataset.var) return `{{${el.dataset.var}}}`;
      if (el.tagName === 'BR') return '\n';
      let s = '';
      el.childNodes.forEach((c) => { s += serializeNode(c); });
      if (el.tagName === 'DIV') s = '\n' + s; // block boundary
      return s;
    }
    return '';
  };

  const serialize = (el: HTMLElement): string => {
    let s = '';
    el.childNodes.forEach((c) => { s += serializeNode(c); });
    return s.replace(/^\n/, '');
  };

  // Convert any fully-typed/pasted {{key}} text into a badge, keeping the caret.
  const convertPlaceholders = (el: HTMLElement) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    for (const tn of textNodes) {
      const text = tn.textContent || '';
      const m = text.match(PLACEHOLDER_RE);
      if (m && m.index !== undefined) {
        const parent = tn.parentNode;
        if (!parent) continue;
        const before = document.createTextNode(text.slice(0, m.index));
        const chip = makeChip(m[1].trim());
        const after = document.createTextNode(text.slice(m.index + m[0].length));
        parent.insertBefore(before, tn);
        parent.insertBefore(chip, tn);
        parent.insertBefore(after, tn);
        parent.removeChild(tn);
        placeCaret(after, 0);
        convertPlaceholders(el); // handle multiple placeholders
        return;
      }
    }
  };

  const placeCaret = (node: Node, offset: number) => {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    try {
      r.setStart(node, offset);
    } catch {
      r.selectNodeContents(editorRef.current as Node);
      r.collapse(false);
    }
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  };

  const emit = () => {
    const el = editorRef.current;
    if (!el) return;
    const s = serialize(el);
    lastSerialized.current = s;
    onChange(s);
  };

  // --- external value sync (mount + when the parent changes value) -----------
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastSerialized.current) return; // our own edit; don't rebuild
    buildInto(el, value);
    lastSerialized.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const saveSelection = () => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (el && sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (el.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange();
    }
  };

  const editorRange = (): Range => {
    const el = editorRef.current as HTMLElement;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (el.contains(r.commonAncestorContainer)) return r.cloneRange();
    }
    if (savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
      return savedRange.current.cloneRange();
    }
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    return r;
  };

  const caretRangeFromPoint = (x: number, y: number): Range | null => {
    const doc = document as any;
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos) {
        const r = document.createRange();
        r.setStart(pos.offsetNode, pos.offset);
        r.collapse(true);
        return r;
      }
    }
    return null;
  };

  // Insert raw text (may contain {{key}} / newlines) at a range, then convert.
  const insertRawAt = (text: string, range: Range) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    const sel = window.getSelection();
    if (sel) {
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    convertPlaceholders(el);
    setPulse(true);
    window.setTimeout(() => setPulse(false), 450);
    emit();
  };

  // --- event handlers --------------------------------------------------------
  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;
    convertPlaceholders(el);
    emit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertRawAt('\n', editorRange());
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) insertRawAt(text, editorRange());
  };

  const handleClickEditor = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.su-chip-x')) {
      const chip = target.closest('.su-chip');
      if (chip && chip.parentNode) {
        chip.parentNode.removeChild(chip);
        emit();
      }
    } else {
      saveSelection();
    }
  };

  const handleDragStart = (text: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const text = e.dataTransfer.getData('text/plain');
    if (!text) return;
    const range = caretRangeFromPoint(e.clientX, e.clientY) || editorRange();
    insertRawAt(text, range);
  };

  const chipBaseSx = {
    fontWeight: 600,
    cursor: 'grab',
    bgcolor: 'background.paper',
    border: `1px solid ${alpha(BRAND, 0.3)}`,
    color: 'text.primary',
    transition: 'transform .12s ease, background-color .15s ease, box-shadow .15s ease',
    '& .MuiChip-icon': { color: BRAND, ml: '4px', mr: '-2px' },
    '&:hover': { bgcolor: alpha(BRAND, 0.1), borderColor: BRAND, transform: 'translateY(-1px)', boxShadow: `0 4px 12px ${alpha(BRAND, 0.2)}` },
    '&:active': { cursor: 'grabbing', transform: 'scale(0.97)' },
  };

  return (
    <Box sx={{ direction: 'rtl' }}>
      {/* Template title — editable, part of the template */}
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.75 }}>
        כותרת ההודעה (לזיהוי שלכם)
      </Typography>
      <TextField
        fullWidth
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="למשל: ההזמנה הרשמית"
        inputProps={{ style: { direction: 'rtl', textAlign: 'right', fontWeight: 700 } }}
        sx={{ mb: 2.5, '& .MuiOutlinedInput-root': { borderRadius: 2, '&.Mui-focused fieldset': { borderColor: BRAND, borderWidth: 2 } } }}
      />

      {/* Variable + block picker */}
      <Box
        sx={{
          p: 1.75,
          mb: 1.5,
          borderRadius: 2,
          bgcolor: (theme) => (theme.palette.mode === 'dark' ? alpha('#fff', 0.04) : alpha(BRAND, 0.05)),
          border: (theme) => `1px solid ${alpha(BRAND, theme.palette.mode === 'dark' ? 0.25 : 0.18)}`,
        }}
      >
        <Typography variant="caption" sx={{ display: 'block', mb: 1.25, color: 'text.secondary', fontWeight: 600 }}>
          לחצו או גררו שדה למקום המדויק בהודעה. נחליף אותו אוטומטית לכל אורח 👇
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {groups.map((group) => (
            <Box key={group.category}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'text.secondary', mb: 0.75 }}>
                {group.category}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {group.items.map((item) => {
                  const token = `{{${item.key}}}`;
                  const sample = variables[item.key];
                  return (
                    <Tooltip
                      key={item.key}
                      arrow
                      title={
                        <Box sx={{ textAlign: 'right', direction: 'rtl', py: 0.25 }}>
                          <Typography sx={{ fontFamily: 'monospace', direction: 'ltr', fontSize: 12, opacity: 0.85 }}>{token}</Typography>
                          {sample && (
                            <Typography sx={{ fontSize: 12, mt: 0.25 }}>
                              לדוגמה: <b>{sample}</b>
                            </Typography>
                          )}
                        </Box>
                      }
                    >
                      <Chip
                        label={item.label}
                        icon={<AddRoundedIcon sx={{ fontSize: 16 }} />}
                        size="small"
                        draggable
                        onDragStart={handleDragStart(token)}
                        onClick={() => insertRawAt(token, editorRange())}
                        sx={chipBaseSx}
                      />
                    </Tooltip>
                  );
                })}
              </Box>
            </Box>
          ))}

          {blocks.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'text.secondary', mb: 0.75 }}>🧩 קטעים מוכנים</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {blocks.map((block) => (
                  <Tooltip
                    key={block.key}
                    arrow
                    title={
                      <Typography sx={{ whiteSpace: 'pre-line', textAlign: 'right', direction: 'rtl', fontSize: 12, py: 0.25 }}>{block.text}</Typography>
                    }
                  >
                    <Chip
                      label={`${block.emoji} ${block.label}`}
                      size="small"
                      draggable
                      onDragStart={handleDragStart(block.text)}
                      onClick={() => insertRawAt(block.text, editorRange())}
                      sx={{ ...chipBaseSx, bgcolor: (theme) => (theme.palette.mode === 'dark' ? alpha('#fff', 0.06) : '#fff'), borderStyle: 'dashed' }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* The message body — a token editor + drop target */}
      <Box
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dragOver) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        sx={{ position: 'relative', transition: 'box-shadow .2s ease', borderRadius: 2, ...(dragOver && { boxShadow: `0 0 0 2px ${BRAND}, 0 0 0 6px ${alpha(BRAND, 0.18)}` }) }}
      >
        <Box
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          dir="rtl"
          data-placeholder="כתבו כאן את ההודעה, או גררו שדות לתוכה…"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onClick={handleClickEditor}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onBlur={saveSelection}
          sx={{
            minHeight: 130,
            p: 1.75,
            borderRadius: 2,
            border: (theme) => `1px solid ${alpha(theme.palette.text.primary, 0.23)}`,
            bgcolor: 'background.paper',
            fontSize: '0.98rem',
            lineHeight: 1.9,
            textAlign: 'right',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            outline: 'none',
            transition: 'border-color .2s ease, box-shadow .2s ease',
            ...(pulse && { boxShadow: `0 0 0 3px ${alpha(BRAND, 0.25)}` }),
            '&:focus': { borderColor: BRAND, boxShadow: `0 0 0 2px ${alpha(BRAND, 0.18)}` },
            '&:empty:before': { content: 'attr(data-placeholder)', color: 'text.disabled' },
            // inline variable badges
            '& .su-chip': {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              mx: '2px',
              px: '8px',
              py: '1px',
              borderRadius: '8px',
              bgcolor: alpha(BRAND, 0.14),
              border: `1px solid ${alpha(BRAND, 0.4)}`,
              color: '#5b5fc7',
              fontWeight: 700,
              fontSize: '0.86em',
              userSelect: 'none',
              verticalAlign: 'middle',
              lineHeight: 1.6,
            },
            '& .su-chip-x': {
              cursor: 'pointer',
              fontWeight: 800,
              opacity: 0.65,
              px: '2px',
              '&:hover': { opacity: 1 },
            },
          }}
        />
        {dragOver && (
          <Box sx={{ position: 'absolute', inset: 0, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(BRAND, 0.06), pointerEvents: 'none' }}>
            <Typography sx={{ fontWeight: 700, color: BRAND }}>שחררו כאן כדי להוסיף</Typography>
          </Box>
        )}
      </Box>
      {issues.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1.5, textAlign: 'right', direction: 'rtl', borderRadius: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: issues.length > 1 ? 0.5 : 0 }}>
            כדי שוואטסאפ יאשרו את ההודעה, צריך לתקן:
          </Typography>
          {issues.map((issue) => (
            <Typography key={issue} variant="body2" sx={{ lineHeight: 1.6 }}>
              • {issue}
            </Typography>
          ))}
        </Alert>
      )}

      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary', textAlign: 'right' }}>
        השדות הצבעוניים יתמלאו אוטומטית לכל אורח. אפשר להסיר שדה עם ה־× או במחיקה.
      </Typography>
    </Box>
  );
}
