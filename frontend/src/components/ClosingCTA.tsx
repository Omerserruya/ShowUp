import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { useNavigate } from 'react-router-dom';

export default function ClosingCTA() {
  const navigate = useNavigate();
  return (
    <Container sx={{ py: { xs: 6, sm: 10 } }}>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 5,
          px: { xs: 3, sm: 8 },
          py: { xs: 6, sm: 9 },
          textAlign: 'center',
          color: '#fff',
          backgroundImage: 'linear-gradient(120deg, #6f74e0 0%, #888cee 55%, #aab0f4 100%)',
          boxShadow: '0 24px 60px rgba(136, 140, 238, 0.35)',
        }}
      >
        <Typography variant="h3" sx={{ fontWeight: 800, mb: 1.5 }}>
          מעכשיו, זה עלינו.
        </Typography>
        <Typography
          variant="h6"
          sx={{ fontWeight: 400, opacity: 0.92, maxWidth: 560, mx: 'auto', mb: 4 }}
        >
          מקימים בשתי דקות, וכל השאר קורה לבד. שלחו הזמנה אחת, ותראו איך האישורים מתחילים להיכנס.
        </Typography>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          justifyContent="center"
          alignItems="center"
        >
          <Button
            variant="contained"
            size="large"
            endIcon={<ArrowBackRoundedIcon />}
            onClick={() => navigate('/wizard')}
            sx={{
              bgcolor: '#fff',
              color: '#7378e4',
              fontWeight: 700,
              px: 4,
              py: 1.25,
              borderRadius: 999,
              boxShadow: 'none',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.92)', boxShadow: 'none' },
            }}
          >
            מתחילים עכשיו, בחינם
          </Button>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ opacity: 0.9 }}>
            <LockRoundedIcon sx={{ fontSize: 18 }} />
            <Typography variant="body2">מתחילים בחינם · בלי כרטיס אשראי</Typography>
          </Stack>
        </Stack>
      </Box>
    </Container>
  );
}
