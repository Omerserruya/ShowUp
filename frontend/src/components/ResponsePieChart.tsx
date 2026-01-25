import React from 'react';
import { Box, Paper, Typography, useTheme, useMediaQuery } from '@mui/material';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  LabelList,
} from 'recharts';

interface PieChartData {
  name: string;
  value: number;
  color: string;
}

interface ResponsePieChartProps {
  data?: PieChartData[];
  /**
   * Optional override for the total shown in the center of the pie.
   * When provided, this should represent the expected total invitees (import_count sum),
   * rather than the actual responses.
   */
  totalInvited?: number;
}

// Mock data
const defaultData: PieChartData[] = [
  { name: 'אישרו הגעה', value: 24, color: '#4ade80' },
  { name: 'ביטלו השתתפות', value: 8, color: '#f87171' },
  { name: 'טרם אישרו', value: 18, color: '#fb923c' },
];

const ResponsePieChart: React.FC<ResponsePieChartProps> = ({ data = defaultData, totalInvited }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <Box
          sx={{
            bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : '#ffffff',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '8px',
            p: 1.5,
            boxShadow: theme.palette.mode === 'dark' 
              ? '0 4px 6px rgba(0, 0, 0, 0.5)'
              : '0 4px 6px rgba(0, 0, 0, 0.1)',
          }}
        >
          <Typography
            variant="body2"
            sx={{
              color: data.payload.color,
              fontWeight: 500,
              mb: 0.5,
            }}
          >
            {data.name}: {data.value}
          </Typography>
        </Box>
      );
    }
    return null;
  };

  // Filter out zero values so we don't render empty slices / labels with 0
  const filteredData = (data || []).filter((item) => item.value > 0);

  // Calculate total for center display:
  // - Prefer the provided totalInvited (expected invitees / import_count sum)
  // - Fallback to sum of all values (including zero values) if not provided
  const total =
    typeof totalInvited === 'number'
      ? totalInvited
      : (data || []).reduce((sum, item) => sum + item.value, 0);

  // Calculate percentage of confirmed (green) to determine center shadow color
  const confirmedItem = filteredData.find(item => 
    item.name.includes('אישרו הגעה') || item.name.includes('confirmed')
  );
  const confirmedValue = confirmedItem?.value || 0;
  const confirmedPercentage = total > 0 ? (confirmedValue / total) * 100 : 0;
  // If majority (>=50%) confirmed -> green, otherwise purple
  const centerShadowColor = confirmedPercentage >= 50 ? '#a7f3d0' : '#c4b5fd';

  // Vibrant, lively colors
  const getColorForStatus = (name: string): string => {
    if (name.includes('אישרו הגעה') || name.includes('confirmed')) {
      return '#22c55e'; // Vibrant green
    } else if (name.includes('ביטלו') || name.includes('declined')) {
      return '#ef4444'; // Vibrant red
    } else {
      return '#f59e0b'; // Vibrant orange
    }
  };

  // Render labels outside the pie chart
  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value, name }: any) => {
    const RADIAN = Math.PI / 180;
    // Position label outside the pie (beyond outerRadius)
    const labelRadius = outerRadius + 25; // Distance from edge
    const x = cx + labelRadius * Math.cos(-midAngle * RADIAN);
    const y = cy + labelRadius * Math.sin(-midAngle * RADIAN);

    return (
      <g>
        <text
          x={x}
          y={y}
          fill={theme.palette.text.primary}
          textAnchor={x > cx ? 'start' : 'end'}
          dominantBaseline="central"
          fontSize={isMobile ? 13 : 15}
          fontWeight={600}
        >
          {value}
        </text>
      </g>
    );
  };

  return (
    <Paper
      elevation={0}
      sx={{
        pt: { xs: 1.5, md: 2.5 },
        pb: { xs: 1.5, md: 2.5 },
        px: { xs: 2, md: 2.5 },
        bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : '#ffffff',
        borderRadius: '16px',
        border: '1px solid',
        borderColor: 'divider',
        height: { xs: 'auto', md: '100%' },
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Typography
        variant="h5"
        component="h2"
        sx={{
          fontWeight: 600,
          color: 'text.primary',
          mb: { xs: 0.5, md: 0.5 },
          ml: 1,
        }}
      >
        סטטוס תגובות
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
          mb: { xs: 1, md: 1.5 },
          ml: 1,
        }}
      >
        התפלגות תשובות האורחים
      </Typography>

      <Box 
        sx={{ 
          width: '100%', 
          flex: 1, 
          minHeight: { xs: 300, md: 280 }, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            filter: 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))',
          }}
        >
          <ResponsiveContainer width="100%" height={isMobile ? 300 : '100%'}>
            <PieChart>
              <defs>
                {/* Define corner radius effect using filters/clipPath */}
                <filter id="roundedCorners">
                  <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur" />
                  <feOffset in="blur" dx="0" dy="0" result="offsetBlur" />
                  <feFlood floodColor="#000" floodOpacity="0.1" result="offsetColor" />
                  <feComposite in="offsetColor" in2="offsetBlur" operator="in" result="offsetBlur" />
                  <feMerge>
                    <feMergeNode in="offsetBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <Pie
                // Use filteredData so we don't show 0 slices
                data={filteredData}
                cx="50%"
                cy="50%"
                label={renderCustomLabel}
                labelLine={false}
                // Very thin ring - small difference between inner and outer radius
                innerRadius={isMobile ? 80 : 100}
                outerRadius={isMobile ? 95 : 115}
                fill="#8884d8"
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                // Less padding between slices for tighter look
                paddingAngle={0.5}
                cornerRadius={8}
              >
                {filteredData.map((entry, index) => {
                  // Use delicate colors
                  const fillColor = getColorForStatus(entry.name);
                  return (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={fillColor}
                      stroke="none"
                      strokeWidth={0}
                    />
                  );
                })}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          
          {/* Center text - keep original purple color */}
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <Typography
              variant="h4"
              sx={{
                fontWeight: 600,
                color: '#a855f7',
                fontSize: { xs: '1.75rem', sm: '2rem', md: '2.5rem' },
                lineHeight: 1.2,
                textShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                mb: 0.5,
              }}
            >
              {total}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: '#a855f7',
                fontSize: { xs: '0.75rem', sm: '0.875rem', md: '1rem' },
                textShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                fontWeight: 500,
              }}
            >
              סה״כ המוזמנים
            </Typography>
          </Box>
          
          {/* Inner shadow effect - delicate with dynamic color */}
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: { xs: '100px', sm: '120px', md: '140px' },
              height: { xs: '100px', sm: '120px', md: '140px' },
              borderRadius: '50%',
              // Delicate shadow with dynamic color tint
              boxShadow: `inset 0 1px 3px ${centerShadowColor}30, inset 0 0.5px 1px ${centerShadowColor}20`,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        </Box>
      </Box>
    </Paper>
  );
};

export default ResponsePieChart;

