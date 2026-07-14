import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * A section title in the ShowUp voice - warm and a little cheeky. The title reads
 * in the page's own ink; the theme primary lives only in the leading accent bar,
 * with a colorful emoji setting the mood. Subtitle stays calm so the page keeps its rhythm.
 */
export default function SectionHeader({
  emoji, title, subtitle, sx,
}: { emoji?: string; title: string; subtitle?: string; sx?: object }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, mb: { xs: 1.5, sm: 2 }, px: 0.5, ...sx }}>
      <Box sx={{ mt: '5px', width: 4, height: 22, borderRadius: 2, bgcolor: 'primary.main', flexShrink: 0 }} />
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {emoji && <Box component="span" sx={{ fontSize: '1.25rem', lineHeight: 1 }}>{emoji}</Box>}
          <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.2rem', sm: '1.35rem' }, letterSpacing: '-0.02em', lineHeight: 1.2, color: 'text.primary' }}>
            {title}
          </Typography>
        </Box>
        {subtitle && (
          <Typography sx={{ fontSize: '0.88rem', color: 'text.secondary', mt: 0.25, lineHeight: 1.4 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
