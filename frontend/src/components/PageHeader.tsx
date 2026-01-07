import React from 'react';
import { Box, Typography } from '@mui/material';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  stickyOffset?: number;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  stickyOffset = 0,
}) => {
  return (
    <Box
      sx={{
        position: 'sticky',
        top: stickyOffset,
        zIndex: (theme) => theme.zIndex.appBar,
        bgcolor: '#ffffff',
        borderBottom: '1px solid #e5e7eb',
        mb: 3,
      }}
    >
      <Box
        sx={{
          px: 4,
          py: 2.5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          textAlign: 'right',
        }}
      >
        <Typography
          variant="h4"
          component="h1"
          sx={{
            fontWeight: 700,
            color: '#0f172a',
          }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography
            variant="subtitle1"
            sx={{
              mt: 1,
              color: '#6b7280',
            }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

export default PageHeader;


