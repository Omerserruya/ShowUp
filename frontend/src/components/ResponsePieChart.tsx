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

  // Map status names to colors (matching StatusCard colors)
  const getColorForStatus = (name: string): string => {
    if (name.includes('אישרו הגעה') || name.includes('confirmed')) {
      return 'url(#gradientGreen)'; // Green for approved
    } else if (name.includes('ביטלו') || name.includes('declined')) {
      return 'url(#gradientRed)'; // Red for declined
    } else {
      return 'url(#gradientOrange)'; // Orange for pending
    }
  };

  // Render labels with values (not percentages)
  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill="#ffffff"
        textAnchor="middle"
        dominantBaseline="central"
        // Make the numbers on the pie more prominent
        fontSize={isMobile ? 14 : 18}
        fontWeight={700}
      >
        {value}
      </text>
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
                {/* Gradient definitions matching StatusCard colors with 135deg angle */}
                {/* Green for approved - linear-gradient(135deg, #22c55e 0%,#18cd5a 100%) */}
                <linearGradient id="gradientGreen" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={1} />
                  <stop offset="100%" stopColor="#18cd5a" stopOpacity={1} />
                </linearGradient>
                {/* Red for declined - linear-gradient(135deg,#d97171 0%, #dc2626 100%) */}
                <linearGradient id="gradientRed" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                  <stop offset="100%" stopColor="#dc2626" stopOpacity={1} />
                </linearGradient>
                {/* Orange for pending - linear-gradient(135deg,#efab35 0%, #d97706 100%) */}
                <linearGradient id="gradientOrange" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                  <stop offset="100%" stopColor="#efab35" stopOpacity={1} />
                </linearGradient>
              </defs>
              <Pie
                // Use filteredData so we don't show 0 slices
                data={filteredData}
                cx="50%"
                cy="50%"
                label={renderCustomLabel}
                labelLine={false}
                innerRadius={isMobile ? 50 : 70}
                outerRadius={isMobile ? 100 : 130}
                fill="#8884d8"
                dataKey="value"
                startAngle={90}
                endAngle={-270}
              >
                {filteredData.map((entry, index) => {
                  // Use color based on status name
                  const fillColor = getColorForStatus(entry.name);
                  return (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={fillColor}
                      stroke="none"
                    />
                  );
                })}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          
          {/* Center text with inner shadow effect */}
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
          
          {/* Inner shadow effect - matching image style with different sizes */}
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: { xs: '100px', sm: '120px', md: '140px' },
              height: { xs: '100px', sm: '120px', md: '140px' },
              borderRadius: '50%',
              boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.15), inset 0 1px 2px rgba(0, 0, 0, 0.2)',
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

