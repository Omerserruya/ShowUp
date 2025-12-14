import * as React from 'react';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import EventIcon from '@mui/icons-material/Event';
import Menu from '@mui/material/Menu';
import Divider from '@mui/material/Divider';
import { styled } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Paper from '@mui/material/Paper';
import { useEvent } from '../../contexts/EventContext';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

const EventCard = styled(Paper)(({ theme }) => ({
  background: 'linear-gradient(135deg, rgba(250, 245, 255, 1) 0%, rgba(239, 246, 255, 1) 100%)',
  border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(193, 186, 222, 0.3)' : 'rgba(201, 192, 237, 0.5)'}`,
  borderRadius: theme.shape.borderRadius * 3,
  padding: theme.spacing(3),
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  width: '100%',
  boxShadow: 'none',
  '&:hover': {
    boxShadow: 'none',
  },

}));

export default function SelectContent() {
  const { selectedEvent, setSelectedEvent, events, loading, fetchEvents } = useEvent();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  // Fetch events on component mount
  React.useEffect(() => {
    fetchEvents();
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelectEvent = (eventId: string) => {
    const selectedEventObj = events.find(evt => evt.id === eventId);
    if (selectedEventObj) {
      setSelectedEvent(selectedEventObj);
    }
    handleClose();
  };

  const handleCreateNew = () => {
    handleClose();
    navigate('/wizard');
  };

  const formatEventDate = (dateString: string) => {
    try {
      const date = dayjs(dateString);
      // Format in Hebrew: "15 ביוני 2024"
      const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
      const day = date.date();
      const month = months[date.month()];
      const year = date.year();
      return `${day} ב${month} ${year}`;
    } catch {
      return dateString;
    }
  };

  return (
    <Box 
      width="100%" 
      px={1}
      sx={{ mb: 2, mt: 3 }}
    >
      <EventCard onClick={handleClick} elevation={0}>
        <Box 
          display="flex" 
          alignItems="center" 
          justifyContent="space-between" 
          mb={1.5}
        >
          <Typography 
            variant="caption" 
            sx={{ 
              fontWeight: 500, 
              color: 'text.secondary',
              fontSize: '0.875rem'
            }}
          >
            אירוע נוכחי
          </Typography>
          <IconButton 
            size="small" 
            sx={{ 
              color: 'text.secondary',
              p: 0.5,
              '&:hover': {
                backgroundColor: 'transparent',
              }
            }}
          >
            <ExpandMoreIcon sx={{ fontSize: '0.875rem' }} />
          </IconButton>
        </Box>
        
        {selectedEvent ? (
          <>
            <Typography 
              variant="h6" 
              sx={{ 
                fontWeight: 700, 
                color: 'text.primary',
                mb: 1,
                fontSize: '1.25rem',
                lineHeight: 1.3
              }}
            >
              {selectedEvent.name}
            </Typography>
            {selectedEvent.date && (
              <Typography 
                variant="caption" 
                sx={{ 
                  color: 'text.secondary',
                  fontSize: '0.875rem'
                }}
              >
                {formatEventDate(selectedEvent.date)}
              </Typography>
            )}
          </>
        ) : (
          <Typography 
            variant="body2" 
            sx={{ 
              color: 'text.secondary',
              fontStyle: 'italic',
              fontSize: '1rem'
            }}
          >
            בחר אירוע
          </Typography>
        )}
      </EventCard>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: {
            mt: 1,
            minWidth: 280,
            maxHeight: 400,
            direction: 'rtl',
            borderRadius: 2,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
            border: '1px solid',
            borderColor: 'divider',
            overflow: 'hidden',
          }
        }}
      >
        <Box 
          sx={{ 
            px: 2, 
            py: 1.5,
            background: 'linear-gradient(135deg, rgba(250, 245, 255, 0.5) 0%, rgba(239, 246, 255, 0.5) 100%)',
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.875rem' }}>
            אירועים
          </Typography>
        </Box>
        <Divider />
        
        {loading ? (
          <Box display="flex" alignItems="center" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        ) : events.length > 0 ? (
          events.map((event) => (
            <MenuItem 
              key={event.id} 
              onClick={() => handleSelectEvent(event.id)}
              selected={selectedEvent?.id === event.id}
              dir="rtl"
              sx={{
                py: 1.5,
                '&.Mui-selected': {
                  backgroundColor: 'rgba(196, 181, 253, 0.1)',
                  '&:hover': {
                    backgroundColor: 'rgba(196, 181, 253, 0.15)',
                  },
                },
                '&:hover': {
                  backgroundColor: 'rgba(0, 0, 0, 0.04)',
                },
              }}
            >
              <ListItemIcon>
                <EventIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText 
                primary={event.name}
                secondary={event.date ? formatEventDate(event.date) : ''}
                sx={{ 
                  textAlign: 'right',
                  '& .MuiListItemText-primary': {
                    fontSize: '0.9375rem',
                    fontWeight: selectedEvent?.id === event.id ? 600 : 400,
                  },
                  '& .MuiListItemText-secondary': {
                    fontSize: '0.8125rem',
                  },
                }}
              />
            </MenuItem>
          ))
        ) : (
          <MenuItem disabled dir="rtl">
            <ListItemText 
              primary="לא נמצאו אירועים" 
              sx={{ textAlign: 'right' }} 
            />
          </MenuItem>
        )}

        <Divider />
        <MenuItem 
          onClick={handleCreateNew} 
          dir="rtl"
          sx={{
            py: 1.5,
            '&:hover': {
              backgroundColor: 'rgba(196, 181, 253, 0.1)',
            },
          }}
        >
          <ListItemIcon>
            <AddRoundedIcon />
          </ListItemIcon>
          <ListItemText 
            primary="צור אירוע חדש" 
            secondary="אירוע חדש" 
            sx={{ 
              textAlign: 'right',
              '& .MuiListItemText-primary': {
                fontSize: '0.9375rem',
                fontWeight: 500,
              },
              '& .MuiListItemText-secondary': {
                fontSize: '0.8125rem',
              },
            }} 
          />
        </MenuItem>
      </Menu>
    </Box>
  );
}
