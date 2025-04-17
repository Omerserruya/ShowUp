import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import MuiChip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { styled, Theme } from '@mui/material/styles';
import Grid from '@mui/material/Grid';

import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import EdgesensorHighRoundedIcon from '@mui/icons-material/EdgesensorHighRounded';
import ViewQuiltRoundedIcon from '@mui/icons-material/ViewQuiltRounded';
import PeopleIcon from '@mui/icons-material/People';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AssessmentIcon from '@mui/icons-material/Assessment';
import SecurityIcon from '@mui/icons-material/Security';
import SupportIcon from '@mui/icons-material/Support';

const items = [
  {
    icon: <ViewQuiltRoundedIcon />,
    title: 'Dashboard',
    description:
      'This item could provide a snapshot of the most important metrics or data points related to the product.',
    imageLight: `url("${process.env.TEMPLATE_IMAGE_URL || 'https://mui.com'}/static/images/templates/templates-images/dash-light.png")`,
    imageDark: `url("${process.env.TEMPLATE_IMAGE_URL || 'https://mui.com'}/static/images/templates/templates-images/dash-dark.png")`,
  },
  {
    icon: <EdgesensorHighRoundedIcon />,
    title: 'Mobile integration',
    description:
      'This item could provide information about the mobile app version of the product.',
    imageLight: `url("${process.env.TEMPLATE_IMAGE_URL || 'https://mui.com'}/static/images/templates/templates-images/mobile-light.png")`,
    imageDark: `url("${process.env.TEMPLATE_IMAGE_URL || 'https://mui.com'}/static/images/templates/templates-images/mobile-dark.png")`,
  },
  {
    icon: <DevicesRoundedIcon />,
    title: 'Available on all platforms',
    description:
      'This item could let users know the product is available on all platforms, such as web, mobile, and desktop.',
    imageLight: `url("${process.env.TEMPLATE_IMAGE_URL || 'https://mui.com'}/static/images/templates/templates-images/devices-light.png")`,
    imageDark: `url("${process.env.TEMPLATE_IMAGE_URL || 'https://mui.com'}/static/images/templates/templates-images/devices-dark.png")`,
  },
];

interface ChipProps {
  selected?: boolean;
}

const Chip = styled(MuiChip)<ChipProps>(({ theme }: { theme: Theme & { vars?: any } }) => ({
  variants: [
    {
      props: { selected: true },
      style: {
        background: 'linear-gradient(to bottom right, hsl(210, 98%, 48%), hsl(210, 98%, 35%))',
        color: 'hsl(0, 0%, 100%)',
        borderColor: (theme.vars || theme).palette.primary.light,
        '& .MuiChip-label': {
          color: 'hsl(0, 0%, 100%)',
        },
        ...theme.applyStyles('dark', {
          borderColor: (theme.vars || theme).palette.primary.dark,
        }),
      },
    },
  ],
}));

interface MobileLayoutProps {
  selectedItemIndex: number;
  handleItemClick: (index: number) => void;
  selectedFeature: (typeof items)[0];
}

export function MobileLayout({
  selectedItemIndex,
  handleItemClick,
  selectedFeature,
}: MobileLayoutProps) {
  if (!items[selectedItemIndex]) {
    return null;
  }

  return (
    <Box
      sx={{
        display: { xs: 'flex', sm: 'none' },
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', gap: 2, overflow: 'auto' }}>
        {items.map(({ title }, index) => (
          <Chip
            size="medium"
            key={index}
            label={title}
            onClick={() => handleItemClick(index)}
            selected={selectedItemIndex === index}
          />
        ))}
      </Box>
      <Card variant="outlined">
        <Box
          sx={(theme) => ({
            mb: 2,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            minHeight: 280,
            backgroundImage: 'var(--items-imageLight)',
            ...theme.applyStyles('dark', {
              backgroundImage: 'var(--items-imageDark)',
            }),
          })}
          style={
            items[selectedItemIndex]
              ? ({
                  '--items-imageLight': items[selectedItemIndex].imageLight,
                  '--items-imageDark': items[selectedItemIndex].imageDark,
                } as any)
              : {}
          }
        />
        <Box sx={{ px: 2, pb: 2 }}>
          <Typography
            gutterBottom
            sx={{ color: 'text.primary', fontWeight: 'medium' }}
          >
            {selectedFeature.title}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
            {selectedFeature.description}
          </Typography>
        </Box>
      </Card>
    </Box>
  );
}

const features = [
  {
    title: 'ניהול לקוחות',
    description: 'מערכת ניהול לקוחות מתקדמת המאפשרת מעקב אחר לקוחות, היסטוריית רכישות וניתוח התנהגות.',
    icon: <PeopleIcon />,
  },
  {
    title: 'ניתוח נתונים',
    description: 'כלי ניתוח מתקדמים המספקים תובנות עמוקות על ביצועי העסק והתנהגות הלקוחות.',
    icon: <AnalyticsIcon />,
  },
  {
    title: 'אוטומציה',
    description: 'מערכת אוטומציה חכמה המפשטת תהליכים עסקיים ומשפרת את היעילות התפעולית.',
    icon: <AutoAwesomeIcon />,
  },
  {
    title: 'דוחות מותאמים',
    description: 'יצירת דוחות מותאמים אישית עם אפשרויות התאמה מתקדמות ונראות ויזואלית.',
    icon: <AssessmentIcon />,
  },
  {
    title: 'אבטחת מידע',
    description: 'מערכת אבטחה מתקדמת המגנה על המידע העסקי שלך ומבטיחה סודיות מלאה.',
    icon: <SecurityIcon />,
  },
  {
    title: 'תמיכה טכנית',
    description: 'צוות תמיכה טכנית זמין 24/7 לעזרה בכל בעיה או שאלה שעולה.',
    icon: <SupportIcon />,
  },
];

export default function Features() {
  const [selectedItemIndex, setSelectedItemIndex] = React.useState(0);

  const handleItemClick = (index: number) => {
    setSelectedItemIndex(index);
  };

  const selectedFeature = items[selectedItemIndex];

  return (
    <Container id="features" sx={{ py: { xs: 8, sm: 16 } }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          '& > *': {
            flex: '1 1 300px',
            maxWidth: '100%',
          },
        }}
      >
        {features.map((feature, index) => (
          <Card
            key={index}
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              p: 2,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                mb: 2,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  mr: 2,
                }}
              >
                {feature.icon}
              </Box>
              <Typography variant="h6" component="h3">
                {feature.title}
              </Typography>
            </Box>
            <Typography color="text.secondary">
              {feature.description}
            </Typography>
          </Card>
        ))}
      </Box>
    </Container>
  );
}
