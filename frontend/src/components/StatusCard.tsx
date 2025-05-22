import { 
  Box, 
  Typography, 
  Card, 
  CardContent, 
  Button,
  Stack
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

interface StatusCardProps {
  title: string;
  description: string;
  count: number;
  color: string;
  icon: React.ReactNode;
}

const StatusCard: React.FC<StatusCardProps> = ({
  title,
  description,
  count,
  color,
  icon
}) => {
  // Card styles for a modern, gentle appearance
  const cardStyle = {
    borderRadius: '20px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
    transition: 'all 0.3s ease',
    height: '100%',
    minHeight: '160px', // Reduced height
    maxHeight: '180px', // Maximum height constraint
    width: '100%',
    '&:hover': {
      transform: 'translateY(-4px)',
      boxShadow: '0 10px 40px rgba(0,0,0,0.08)',
    }
  };

  // Icon style for more gentle, modern look
  const iconStyle = {
    fontSize: 32,
    p: 0.8,
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '52px',
    height: '52px'
  };

  return (
    <Card 
      sx={{ 
        ...cardStyle,
        bgcolor: `rgba(${color}, 0.04)`, 
      }}
    >
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" spacing={3} sx={{ mb: 2.5 }}>
          <Box 
            sx={{ 
              ...iconStyle,
              bgcolor: `rgba(${color}, 0.08)`,
            }}
          >
            {icon}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 500, mb: 0.5 }}>
              {title}
            </Typography>
            <Typography variant="body2" sx={{ color: 'rgba(0, 0, 0, 0.6)' }}>
              {description}
            </Typography>
          </Box>
        </Stack>
        
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mt: 2 }}>
          <Typography variant="h3" component="div" sx={{ fontWeight: 700, color: `rgb(${color})`, mb: 0.5 }}>
            {count}
          </Typography>
          
          <Button 
            size="small" 
            endIcon={<ArrowBackIcon sx={{ fontSize: 18 }} />}
            sx={{ 
              color: `rgb(${color})`, 
              fontWeight: 500,
              opacity: 0.9,
              p: '6px 12px',
              borderRadius: '8px',
              '&:hover': { 
                bgcolor: `rgba(${color}, 0.1)`,
                opacity: 1 
              } 
            }}
          >
            לצפייה נוספת
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};

export default StatusCard; 