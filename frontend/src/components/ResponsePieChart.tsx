import React from 'react';
import { Box, Paper, Typography, useTheme, useMediaQuery, alpha } from '@mui/material';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

interface PieChartData {
  name: string;
  value: number;
  color: string;
}

interface ResponsePieChartProps {
  data?: PieChartData[];
  totalInvited?: number;
}

const defaultData: PieChartData[] = [
  { name: 'אישרו הגעה', value: 24, color: '#4ade80' },
  { name: 'ביטלו השתתפות', value: 8, color: '#f87171' },
  { name: 'טרם אישרו', value: 18, color: '#fb923c' },
];

const ResponsePieChart: React.FC<ResponsePieChartProps> = ({ data = defaultData, totalInvited }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <Box
          sx={{
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            p: 1.5,
            boxShadow: isDark
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

  // Filter out zero values
  const filteredData = (data || []).filter((item) => item.value > 0);

  const total =
    typeof totalInvited === 'number'
      ? totalInvited
      : (data || []).reduce((sum, item) => sum + item.value, 0);

  // Vibrant colors
  const getColorForStatus = (name: string): string => {
    if (name.includes('אישרו הגעה') || name.includes('confirmed')) {
      return '#22c55e';
    } else if (name.includes('ביטלו') || name.includes('declined')) {
      return '#ef4444';
    } else {
      return '#f59e0b';
    }
  };

  // Render labels outside the pie chart
  const renderCustomLabel = ({ cx, cy, midAngle, outerRadius, value }: any) => {
    const RADIAN = Math.PI / 180;
    const labelRadius = outerRadius + 25;
    const x = cx + labelRadius * Math.cos(-midAngle * RADIAN);
    const y = cy + labelRadius * Math.sin(-midAngle * RADIAN);

    return (
      <g>
        <text
          x={x}
          y={y}
          fill={isDark ? theme.palette.text.primary : theme.palette.text.primary}
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
        bgcolor: 'background.paper',
        borderRadius: 3,
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
            filter: isDark ? 'none' : 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))',
          }}
        >
          <ResponsiveContainer width="100%" height={isMobile ? 300 : '100%'}>
            <PieChart>
              <Pie
                data={filteredData}
                cx="50%"
                cy="50%"
                label={renderCustomLabel}
                labelLine={false}
                innerRadius={isMobile ? 80 : 100}
                outerRadius={isMobile ? 95 : 115}
                fill="#8884d8"
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                paddingAngle={0.5}
                cornerRadius={8}
              >
                {filteredData.map((entry, index) => {
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

          {/* Center text */}
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
                color: isDark ? theme.palette.primary.light : theme.palette.primary.main,
                fontSize: { xs: '1.75rem', sm: '2rem', md: '2.5rem' },
                lineHeight: 1.2,
                mb: 0.5,
              }}
            >
              {total}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: isDark ? theme.palette.primary.light : theme.palette.primary.main,
                fontSize: { xs: '0.75rem', sm: '0.875rem', md: '1rem' },
                fontWeight: 500,
              }}
            >
              סה״כ המוזמנים
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
};

export default ResponsePieChart;