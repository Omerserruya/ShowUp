import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';
import { MessageStats } from '../mocks/overviewData';

interface MessageData {
  name: string;
  opened: number;
  notOpened: number;
  failed: number;
}

interface MessageStatisticsProps {
  stats: MessageStats;
  maxWidth?: string | number;
}

const MessageStatistics: React.FC<MessageStatisticsProps> = ({ stats, maxWidth = '100%' }) => {
  // Mock data for the message statistics
  const messageStats: MessageData[] = [
    {
      name: 'הודעה ראשונה',
      opened: 35,
      notOpened: 12,
      failed: 3
    },
    {
      name: 'הודעה שניה',
      opened: 30,
      notOpened: 15,
      failed: 3
    },
    {
      name: 'איזכור על האירוע',
      opened: 40,
      notOpened: 6,
      failed: 1
    },
    {
      name: 'הודעת תודה',
      opened: 42,
      notOpened: 7,
      failed: 1
    }
  ];

  // Even more gentle pastel colors for the bars
  const colors = {
    opened: 'rgba(144, 202, 176, 0.85)',    // Soft Mint Green
    notOpened: 'rgba(255, 206, 133, 0.85)', // Soft Peach
    failed: 'rgba(246, 168, 168, 0.85)'     // Soft Pink
  };

  // Custom tooltip content
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <Box
          sx={{
            bgcolor: 'rgba(255, 255, 255, 0.95)',
            p: 1.5,
            border: '1px solid rgba(0, 0, 0, 0.05)',
            borderRadius: '8px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            fontSize: '0.75rem',
            textAlign: 'right',
            direction: 'rtl'
          }}
        >
          <Typography fontWeight="bold" variant="caption" sx={{ display: 'block', mb: 0.5 }}>
            {label}
          </Typography>
          {payload.map((entry: any, index: number) => (
            <Box
              key={`tooltip-item-${index}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                my: 0.25
              }}
            >
              <Box 
                component="span" 
                sx={{ 
                  width: 8, 
                  height: 8, 
                  borderRadius: '50%', 
                  bgcolor: entry.fill 
                }} 
              />
              <Typography variant="caption">
                {entry.name}: {entry.value}
              </Typography>
            </Box>
          ))}
        </Box>
      );
    }
    return null;
  };

  // Custom legend component for better Hebrew support and styling
  const CustomLegend = ({ payload }: any) => {
    const nameMapping: Record<string, string> = {
      opened: 'נפתחו',
      notOpened: 'לא נפתחו',
      failed: 'נכשלו בשליחה'
    };

    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1, flexWrap: 'wrap', gap: 3 }}>
        {payload.map((entry: any, index: number) => (
          <Box key={`legend-${index}`} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box 
              sx={{ 
                width: 12, 
                height: 12, 
                bgcolor: entry.color, 
                borderRadius: '4px' 
              }} 
            />
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              {nameMapping[entry.dataKey] || entry.value}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  };

  return (
    <Box sx={{ width: '100%', maxWidth, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          סה"כ הודעות: {stats.total}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          נשלחו: {stats.sent} | ממתינות: {stats.pending} | נכשלו: {stats.failed}
        </Typography>
      </Box>

      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 2
      }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            סטטוס הודעות
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2">
              נשלחו: {stats.sent}
            </Typography>
            <Typography variant="body2">
              ממתינות: {stats.pending}
            </Typography>
            <Typography variant="body2">
              נכשלו: {stats.failed}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ width: '100%', maxWidth, mx: 'auto' }}>
        <Card sx={{ 
          boxShadow: '0 4px 20px rgba(0,0,0,0.03)', 
          borderRadius: '16px',
          overflow: 'hidden',
          bgcolor: '#FCFCFC'
        }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Typography 
              variant="subtitle1" 
              component="h3" 
              sx={{ 
                mb: 3, 
                fontWeight: 500, 
                textAlign: 'center', 
                color: '#777' 
              }}
            >
              סטטיסטיקת הודעות
            </Typography>
            
            <Box sx={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={messageStats}
                  margin={{ top: 5, right: 30, left: 30, bottom: 40 }}
                  barSize={26}
                  barGap={4}
                >
                  <CartesianGrid 
                    strokeDasharray="3 3" 
                    vertical={true} 
                    horizontal={true} 
                    stroke="rgba(0,0,0,0.04)" 
                  />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 12, fill: '#777' }}
                    axisLine={{ stroke: 'rgba(0,0,0,0.07)' }}
                    tickLine={{ stroke: 'rgba(0,0,0,0.07)' }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={{ stroke: 'rgba(0,0,0,0.07)' }}
                    tickLine={{ stroke: 'rgba(0,0,0,0.07)' }}
                    tick={{ fontSize: 12, fill: '#777' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend 
                    content={<CustomLegend />} 
                    verticalAlign="bottom" 
                    height={50}
                  />
                  <Bar 
                    dataKey="opened" 
                    name="נפתחו" 
                    fill={colors.opened}
                    radius={[5, 5, 0, 0]} 
                    stackId="a"
                  />
                  <Bar 
                    dataKey="notOpened" 
                    name="לא נפתחו" 
                    fill={colors.notOpened}
                    radius={[5, 5, 0, 0]} 
                    stackId="a"
                  />
                  <Bar 
                    dataKey="failed" 
                    name="נכשלו בשליחה" 
                    fill={colors.failed}
                    radius={[5, 5, 0, 0]} 
                    stackId="a"
                  />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

export default MessageStatistics; 