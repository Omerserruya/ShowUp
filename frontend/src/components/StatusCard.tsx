import React from 'react';
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
  color: string; // Can be any color format: hex, rgb, rgba, named color, etc.
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
    height: '180px', // Fixed height
    width: '100%',
    position: 'relative', // For absolute positioning of number and button
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

  // Helper function to check if color is a gradient
  const isGradient = (color: string): boolean => {
    return color.trim().startsWith('linear-gradient') || color.trim().startsWith('radial-gradient');
  };

  // Helper function to extract base color from gradient for text/icon
  const getBaseColorFromGradient = (gradient: string): string => {
    // Try to extract the first color from gradient
    // linear-gradient(135deg, #22c55e 0%, #16a34a 100%) -> #22c55e
    const match = gradient.match(/#[0-9a-fA-F]{6}|rgb\([^)]+\)|rgba\([^)]+\)/);
    if (match) {
      return match[0];
    }
    // Fallback to a default color
    return '#000000';
  };

  // Helper function to convert color to rgba for background with opacity
  const getBackgroundColor = (color: string, opacity: number = 0.04): string => {
    // If it's a gradient, return it as-is (gradients don't support opacity directly)
    if (isGradient(color)) {
      return color;
    }
    
    // If color is in format "r, g, b" (RGB values without rgb() wrapper)
    if (/^\d+,\s*\d+,\s*\d+$/.test(color)) {
      return `rgba(${color}, ${opacity})`;
    }
    // If color is hex, convert to rgba
    if (color.startsWith('#')) {
      const hex = color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    // If already rgba or rgb, extract RGB values and apply opacity
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbaMatch) {
      return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${opacity})`;
    }
    // For named colors or other formats, use as-is with opacity via theme
    return color;
  };

  // Helper function to get solid color for text/icon
  const getSolidColor = (color: string): string => {
    // If it's a gradient, extract base color
    if (isGradient(color)) {
      return getBaseColorFromGradient(color);
    }
    
    // If color is in format "r, g, b" (RGB values without rgb() wrapper)
    if (/^\d+,\s*\d+,\s*\d+$/.test(color)) {
      return `rgb(${color})`;
    }
    // For hex, rgb, rgba, or named colors, use as-is
    return color;
  };

  const backgroundColor = getBackgroundColor(color, 0.04);
  const isGradientColor = isGradient(color);
  
  return (
    <Card 
      sx={{ 
        ...cardStyle,
        ...(isGradientColor 
          ? { background: backgroundColor }
          : { bgcolor: backgroundColor }
        ), 
      }}
    >
      <CardContent sx={{ p: 2, pl: 1, height: '100%', position: 'relative' }}>
        <Stack direction="row" spacing={5} sx={{ mb: 0 }}>
          <Box 
            sx={{ 
              ...iconStyle,
              bgcolor: 'rgba(255, 255, 255, 0.2)', // White background with 20% opacity
              color: '#ffffff', // White icon color
            }}
          >
            {icon}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 500, mr: 0.75, mb: 0.5, color: '#ffffff' }}>
              {title}
            </Typography>
            <Typography variant="body2" sx={{ mr: 0.75, color: 'rgba(255, 255, 255, 0.8)' }}>
              {description}
            </Typography>
          </Box>
        </Stack>
        
        {/* Fixed position for number and button */}
        <Box sx={{ 
          position: 'absolute',
          bottom: 16,
          left: 16,
          right: 16,
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'flex-end'
        }}>
          <Typography variant="h3" component="div" sx={{ fontWeight: 700, color: '#ffffff' }}>
            {count}
          </Typography>
          
          <Button 
            size="small" 
            endIcon={<ArrowBackIcon sx={{ fontSize: 18, color: '#ffffff' }} />}
            sx={{ 
              color: '#ffffff', 
              fontWeight: 500,
              opacity: 0.9,
              p: '6px 12px',
              borderRadius: '8px',
              '&:hover': { 
                bgcolor: getBackgroundColor(color, 0.1),
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