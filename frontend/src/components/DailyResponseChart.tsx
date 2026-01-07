import React, { useState } from 'react';
import { Box, Paper, Typography, Button, ButtonGroup, useTheme } from '@mui/material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine
} from 'recharts';

interface DailyResponseData {
  date: string;
  dateLabel: string;
  confirmed: number;
  declined: number;
}

interface Milestone {
  date: string;
  dateLabel: string;
  label: string;
}

interface DailyResponseChartProps {
  data?: DailyResponseData[];
  milestones?: Milestone[];
  period: 'week' | 'month';
  onChangePeriod: (period: 'week' | 'month') => void;
}

// Mock data for the last 7 days
const defaultData: DailyResponseData[] = [
  { date: '2024-05-12', dateLabel: 'יום א', confirmed: 5, declined: 2 },
  { date: '2024-05-13', dateLabel: 'יום ב', confirmed: 8, declined: 1 },
  { date: '2024-05-14', dateLabel: 'יום ג', confirmed: 12, declined: 3 },
  { date: '2024-05-15', dateLabel: 'יום ד', confirmed: 6, declined: 2 },
  { date: '2024-05-16', dateLabel: 'יום ה', confirmed: 10, declined: 1 },
  { date: '2024-05-17', dateLabel: 'יום ו', confirmed: 4, declined: 0 },
  { date: '2024-05-18', dateLabel: 'שבת', confirmed: 3, declined: 1 },
];

// Mock milestones
const defaultMilestones: Milestone[] = [
  { date: '2024-05-14', dateLabel: 'יום ג', label: 'שליחת הודעת תזכורת 1' },
  { date: '2024-05-16', dateLabel: 'יום ה', label: 'שליחת הודעת תזכורת 2' },
];

const DailyResponseChart: React.FC<DailyResponseChartProps> = ({ 
  data = defaultData,
  milestones = defaultMilestones,
  period,
  onChangePeriod,
}) => {
  const theme = useTheme();

  // Custom label component for milestones
  const MilestoneLabel = (props: any) => {
    const { viewBox, label } = props;
    if (!viewBox || viewBox.x === undefined) {
      return <g />;
    }
    return (
      <g>
        <rect
          x={viewBox.x - 60}
          y={viewBox.y - 30}
          width={120}
          height={20}
          fill="#6366f1"
          rx={4}
        />
        <text
          x={viewBox.x}
          y={viewBox.y - 15}
          fill="#ffffff"
          fontSize={11}
          fontWeight={500}
          textAnchor="middle"
        >
          {label}
        </text>
      </g>
    );
  };
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
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
          {payload.map((entry: any, index: number) => (
            <Typography
              key={index}
              variant="body2"
              sx={{
                color: entry.color,
                fontWeight: 500,
                mb: 0.5,
              }}
            >
              {entry.name}: {entry.value}
            </Typography>
          ))}
        </Box>
      );
    }
    return null;
  };

  const CustomLegend = (props: any) => {
    const { payload } = props;
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3, mt: 2 }}>
        {payload?.map((entry: any, index: number) => (
          <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: entry.color,
              }}
            />
            <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
              {entry.value}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  };

  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : '#ffffff',
        borderRadius: '16px',
        border: '1px solid',
        borderColor: 'divider',
        height: '100%',
      }}
    >
      <Typography
        variant="h5"
        component="h2"
        sx={{
          fontWeight: 600,
          color: 'text.primary',
          mb: 1,
          ml: 1,
        }}
      >
        התפלגות תשובות
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            ml: 1,
          }}
        >
          אחוזי תגובה
        </Typography>
        <ButtonGroup
          variant="outlined"
          size="small"
          sx={{
            overflow: 'hidden',
            '& .MuiButton-root': {
              minWidth: 72,
              px: 2.5,
              fontSize: '0.875rem',
              borderColor: 'divider',
            },
          }}
        >
          <Button
            onClick={() => onChangePeriod('week')}
            sx={{
              bgcolor: period === 'week' 
                ? (theme.palette.mode === 'dark' ? theme.palette.action.selected : '#f3f4f6')
                : 'transparent',
              color: period === 'week' ? 'text.primary' : 'text.secondary',
              borderColor: 'divider',
              '&:hover': {
                borderColor: 'divider',
                bgcolor: period === 'week' 
                  ? (theme.palette.mode === 'dark' ? theme.palette.action.selected : '#f3f4f6')
                  : (theme.palette.mode === 'dark' ? theme.palette.action.hover : '#f9fafb'),
              },
            }}
          >
            שבוע
          </Button>
          <Button
            onClick={() => onChangePeriod('month')}
            sx={{
              bgcolor: period === 'month' 
                ? (theme.palette.mode === 'dark' ? theme.palette.action.selected : '#f3f4f6')
                : 'transparent',
              color: period === 'month' ? 'text.primary' : 'text.secondary',
              borderColor: 'divider',
              '&:hover': {
                borderColor: 'divider',
                bgcolor: period === 'month' 
                  ? (theme.palette.mode === 'dark' ? theme.palette.action.selected : '#f3f4f6')
                  : (theme.palette.mode === 'dark' ? theme.palette.action.hover : '#f9fafb'),
              },
            }}
          >
            חודש
          </Button>
        </ButtonGroup>
      </Box>

      {/* Scrollable container to allow seeing all days comfortably */}
      <Box sx={{ width: '100%', height: 300, overflowX: 'auto', overflowY: 'hidden' }}>
        <Box
          sx={{
            width: `${Math.max((data?.length || defaultData.length) * 60, 600)}px`,
            height: '100%',
          }}
        >
          {data && data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 40, right: 30, left: 20, bottom: 5 }}
                barSize={32}
                barGap={4}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="rgba(0,0,0,0.04)"
                />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fontSize: 12, fill: '#777' }}
                  axisLine={{ stroke: 'rgba(0,0,0,0.07)' }}
                  tickLine={{ stroke: 'rgba(0,0,0,0.07)' }}
                />
                <YAxis
                  axisLine={{ stroke: 'rgba(0,0,0,0.07)' }}
                  tickLine={{ stroke: 'rgba(0,0,0,0.07)' }}
                  tick={{ fontSize: 12, fill: '#777' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend content={<CustomLegend />} />
                {milestones.map((milestone, index) => (
                  <ReferenceLine
                    key={index}
                    x={milestone.dateLabel}
                    stroke="#6366f1"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    label={(props: any) => <MilestoneLabel {...props} label={milestone.label} />}
                  />
                ))}
                <Bar
                  dataKey="confirmed"
                  name="אישרו הגעה"
                  fill="#4ade80"
                  radius={[4, 4, 0, 0]}
                  stackId="a"
                />
                <Bar
                  dataKey="declined"
                  name="ביטלו השתתפות"
                  fill="#f87171"
                  radius={[4, 4, 0, 0]}
                  stackId="a"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                אין נתונים להצגה
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Paper>
  );
};

export default DailyResponseChart;

