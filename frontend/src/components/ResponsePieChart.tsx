import React from 'react';
import { Box, Paper, Typography, useTheme, useMediaQuery } from '@mui/material';
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
}

// Mock data
const defaultData: PieChartData[] = [
  { name: 'אישרו הגעה', value: 24, color: '#4ade80' },
  { name: 'ביטלו השתתפות', value: 8, color: '#f87171' },
  { name: 'טרם אישרו', value: 18, color: '#fb923c' },
];

const ResponsePieChart: React.FC<ResponsePieChartProps> = ({ data = defaultData }) => {
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

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, name, value }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.65;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <g>
        <text
          x={x}
          y={y - 6}
          fill="#ffffff"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={13}
          fontWeight={700}
          stroke="#1f2937"
          strokeWidth={0.5}
        >
          {name}
        </text>
        <text
          x={x}
          y={y + 13}
          fill="#ffffff"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={15}
          fontWeight={700}
          stroke="#1f2937"
          strokeWidth={0.5}
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
        p: { xs: 3, md: 2.5 },
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
          mb: { xs: 1, md: 0.5 },
          ml: 1,
        }}
      >
        סטטוס תגובות
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
          mb: { xs: 2, md: 1.5 },
          ml: 1,
        }}
      >
        התפלגות תשובות האורחים
      </Typography>

      <Box sx={{ width: '100%', flex: 1, minHeight: { xs: 300, md: 280 }, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ResponsiveContainer width="100%" height={isMobile ? 300 : '100%'}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              label={renderCustomLabel}
              labelLine={false}
              outerRadius={isMobile ? 120 : 130}
              fill="#8884d8"
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
};

export default ResponsePieChart;

