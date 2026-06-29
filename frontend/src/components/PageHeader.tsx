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
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        mb: 3,
      }}
    >
      <Box
        sx={{
          px: { xs: 2.5, sm: 4 },
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
            color: 'text.primary',
          }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography
            variant="subtitle1"
            sx={{
              mt: 0.5,
              color: 'text.secondary',
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


