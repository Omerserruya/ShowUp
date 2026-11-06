import React from 'react';
import { Chip, Stack, TextField } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { EventSubjects, ROLES, SUBJECT_FIELDS } from '../config/eventSubjects';

/** The per-event-type host fields (couple / parents / honoree / company) for
 *  the short create forms: gift link, admin and venue "new event". */
export default function SubjectFields({ eventType, subjects, onChange, disabled, accent = '#5A3DA6' }: {
  eventType: string;
  subjects: EventSubjects;
  onChange: (patch: Partial<EventSubjects>) => void;
  disabled?: boolean;
  accent?: string;
}) {
  return (
    <>
      {(SUBJECT_FIELDS[eventType] || []).map((f) => (
        <Stack key={f.key} spacing={0.75}>
          <TextField size="small" label={f.label} value={subjects[f.key] as string} fullWidth disabled={disabled}
            onChange={(e) => onChange({ [f.key]: e.target.value } as Partial<EventSubjects>)} inputProps={{ maxLength: 40 }} />
          {f.role && (
            <Stack direction="row" spacing={1} role="radiogroup" aria-label={f.label}>
              {ROLES.map((r) => {
                const on = subjects[f.role!] === r.v;
                return (
                  <Chip key={r.v} label={r.t} role="radio" aria-checked={on} clickable disabled={disabled}
                    onClick={() => onChange({ [f.role!]: r.v } as Partial<EventSubjects>)}
                    sx={{ fontWeight: on ? 700 : 500, bgcolor: on ? alpha(accent, 0.12) : 'transparent', border: '1px solid', borderColor: on ? accent : 'divider', color: on ? accent : 'text.primary' }} />
                );
              })}
            </Stack>
          )}
        </Stack>
      ))}
    </>
  );
}
