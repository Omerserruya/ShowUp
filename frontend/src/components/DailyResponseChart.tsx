import React, { useState } from 'react';
import { Box, Paper, Typography, Button, ButtonGroup } from '@mui/material';
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
  confirmed: number;
  declined: number;
}

interface Milestone {
  date: string;
  label: string;
}

interface DailyResponseChartProps {
  data?: DailyResponseData[];
  milestones?: Milestone[];
}

// Mock data for the last 7 days
const defaultData: DailyResponseData[] = [
  { date: 'יום א', confirmed: 5, declined: 2 },
  { date: 'יום ב', confirmed: 8, declined: 1 },
  { date: 'יום ג', confirmed: 12, declined: 3 },
  { date: 'יום ד', confirmed: 6, declined: 2 },
  { date: 'יום ה', confirmed: 10, declined: 1 },
  { date: 'יום ו', confirmed: 4, declined: 0 },
  { date: 'שבת', confirmed: 3, declined: 1 },
];

// Mock milestones
const defaultMilestones: Milestone[] = [
  { date: 'יום ג', label: 'שליחת הודעת תזכורת 1' },
  { date: 'יום ה', label: 'שליחת הודעת תזכורת 2' },
];

const DailyResponseChart: React.FC<DailyResponseChartProps> = ({ 
  data = defaultData,
  milestones = defaultMilestones 
}) => {
  const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'year'>('week');

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
            bgcolor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            p: 1.5,
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
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
            <Typography variant="body2" sx={{ color: '#666', fontSize: '0.875rem' }}>
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
        bgcolor: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #e5e7eb',
        height: '100%',
      }}
    >
      <Typography
        variant="h5"
        component="h2"
        sx={{
          fontWeight: 600,
          color: '#424242',
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
        <ButtonGroup variant="outlined" size="small">
          <Button
            onClick={() => setTimeFilter('week')}
            sx={{
              bgcolor: timeFilter === 'week' ? '#f3f4f6' : 'transparent',
              color: timeFilter === 'week' ? '#424242' : '#666',
              borderColor: '#e5e7eb',
              '&:hover': {
                borderColor: '#d1d5db',
                bgcolor: timeFilter === 'week' ? '#f3f4f6' : '#f9fafb',
              },
            }}
          >
            שבוע
          </Button>
          <Button
            onClick={() => setTimeFilter('month')}
            sx={{
              bgcolor: timeFilter === 'month' ? '#f3f4f6' : 'transparent',
              color: timeFilter === 'month' ? '#424242' : '#666',
              borderColor: '#e5e7eb',
              '&:hover': {
                borderColor: '#d1d5db',
                bgcolor: timeFilter === 'month' ? '#f3f4f6' : '#f9fafb',
              },
            }}
          >
            חודש
          </Button>
          <Button
            onClick={() => setTimeFilter('year')}
            sx={{
              bgcolor: timeFilter === 'year' ? '#f3f4f6' : 'transparent',
              color: timeFilter === 'year' ? '#424242' : '#666',
              borderColor: '#e5e7eb',
              '&:hover': {
                borderColor: '#d1d5db',
                bgcolor: timeFilter === 'year' ? '#f3f4f6' : '#f9fafb',
              },
            }}
          >
            שנה
          </Button>
        </ButtonGroup>
      </Box>

      <Box sx={{ width: '100%', height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 40, right: 30, left: 20, bottom: 5 }}
            barSize={40}
            barGap={2}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="rgba(0,0,0,0.04)"
            />
            <XAxis
              dataKey="date"
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
                x={milestone.date}
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
      </Box>
    </Paper>
  );
};

export default DailyResponseChart;

