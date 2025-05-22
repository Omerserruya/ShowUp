import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
  Divider,
  IconButton,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Switch,
  FormControlLabel,
  Alert,
  LinearProgress,
  useTheme,
  useMediaQuery,
  SelectChangeEvent,
} from '@mui/material';
import {
  Send as SendIcon,
  Edit as EditIcon,
  History as HistoryIcon,
  Schedule as ScheduleIcon,
  Refresh as RefreshIcon,
  WhatsApp as WhatsAppIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { MessageTemplate, MessageHistory, mockTemplates, mockHistory } from '../mocks/messageData';

function Messages() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  // State
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [customMessageOpen, setCustomMessageOpen] = useState(false);
  const [placeholderValues, setPlaceholderValues] = useState<{ [key: string]: string }>({});
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [messagePreview, setMessagePreview] = useState('');
  const [isPremium] = useState(true); // Mock premium status

  // Handlers
  const handleSendClick = (template: MessageTemplate) => {
    setSelectedTemplate(template);
    setPlaceholderValues({});
    setSelectedRecipients([]);
    setIsScheduled(false);
    setScheduledDate(null);
    setSendDialogOpen(true);
  };

  const handleEditClick = (template: MessageTemplate) => {
    setSelectedTemplate(template);
    setPlaceholderValues({});
    setSendDialogOpen(true);
  };

  const handlePlaceholderChange = (placeholder: string, value: string) => {
    setPlaceholderValues(prev => ({
      ...prev,
      [placeholder]: value
    }));
  };

  const handleRecipientChange = (event: SelectChangeEvent<string[]>) => {
    setSelectedRecipients(event.target.value as string[]);
  };

  const handleScheduleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsScheduled(event.target.checked);
  };

  const handleScheduledDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setScheduledDate(new Date(event.target.value));
  };

  const handleSendMessage = () => {
    // TODO: Implement actual sending logic
    setSendDialogOpen(false);
  };

  const handleCustomMessageSend = () => {
    // TODO: Implement custom message sending logic
    setCustomMessageOpen(false);
  };

  // Update message preview when placeholders change
  React.useEffect(() => {
    if (selectedTemplate) {
      let preview = selectedTemplate.content;
      Object.entries(placeholderValues).forEach(([key, value]) => {
        preview = preview.replace(new RegExp(`{{${key}}}`, 'g'), value);
      });
      setMessagePreview(preview);
    }
  }, [selectedTemplate, placeholderValues]);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        שליחת הודעות
      </Typography>

      {/* Templates Section */}
      <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
        תבניות הודעות מאושרות
      </Typography>
      <Grid container spacing={3}>
        {mockTemplates.map((template) => (
          <Grid item xs={12} md={6} lg={4} key={template.id}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {template.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {template.description}
                </Typography>
                <Typography variant="body2" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>
                  {template.content}
                </Typography>
              </CardContent>
              <CardActions>
                <Button
                  startIcon={<EditIcon />}
                  onClick={() => handleEditClick(template)}
                >
                  ערוך
                </Button>
                <Button
                  variant="contained"
                  startIcon={<SendIcon />}
                  onClick={() => handleSendClick(template)}
                >
                  שלח
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Custom Message Section (Premium) */}
      {isPremium && (
        <>
          <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
            שליחת הודעה מותאמת אישית
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            שליחת הודעה מותאמת אישית כרוכה בעלות נוספת של ₪0.5 לכל הודעה
          </Alert>
          <Button
            variant="outlined"
            startIcon={<WhatsAppIcon />}
            onClick={() => setCustomMessageOpen(true)}
          >
            צור הודעה מותאמת אישית
          </Button>
        </>
      )}

      {/* Message History */}
      <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
        היסטוריית הודעות
      </Typography>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>תבנית</TableCell>
              <TableCell>נמענים</TableCell>
              <TableCell>סטטוס</TableCell>
              <TableCell>תאריך שליחה</TableCell>
              <TableCell>פעולות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mockHistory.map((message) => (
              <TableRow key={message.id}>
                <TableCell>{message.templateName}</TableCell>
                <TableCell>{message.recipients}</TableCell>
                <TableCell>
                  <Chip
                    label={message.status === 'sent' ? 'נשלח' : 'מתוזמן'}
                    color={message.status === 'sent' ? 'success' : 'warning'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  {message.scheduledDate
                    ? new Date(message.scheduledDate).toLocaleString()
                    : new Date(message.sendDate).toLocaleString()}
                </TableCell>
                <TableCell>
                  <IconButton size="small">
                    <RefreshIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Send Message Dialog */}
      <Dialog
        open={sendDialogOpen}
        onClose={() => setSendDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {selectedTemplate?.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 2 }}>
            {/* Placeholders */}
            {selectedTemplate?.placeholders.map((placeholder) => (
              <TextField
                key={placeholder}
                label={placeholder}
                fullWidth
                value={placeholderValues[placeholder] || ''}
                onChange={(e) => handlePlaceholderChange(placeholder, e.target.value)}
              />
            ))}

            {/* Recipients Selection */}
            <FormControl fullWidth>
              <InputLabel>נמענים</InputLabel>
              <Select
                multiple
                value={selectedRecipients}
                onChange={handleRecipientChange}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((value) => (
                      <Chip key={value} label={value} />
                    ))}
                  </Box>
                )}
              >
                <MenuItem value="confirmed">אישרו הגעה</MenuItem>
                <MenuItem value="pending">ממתינים לאישור</MenuItem>
                <MenuItem value="declined">ביטלו</MenuItem>
                <MenuItem value="bride">צד כלה</MenuItem>
                <MenuItem value="groom">צד חתן</MenuItem>
              </Select>
            </FormControl>

            {/* Schedule Option */}
            <FormControlLabel
              control={
                <Switch
                  checked={isScheduled}
                  onChange={handleScheduleChange}
                />
              }
              label="תזמן לשליחה מאוחרת"
            />
            {isScheduled && (
              <TextField
                type="datetime-local"
                label="תאריך ושעת שליחה"
                value={scheduledDate?.toISOString().slice(0, 16) || ''}
                onChange={handleScheduledDateChange}
                fullWidth
              />
            )}

            {/* Message Preview */}
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                תצוגה מקדימה
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  backgroundColor: 'grey.50',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {messagePreview}
              </Paper>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSendDialogOpen(false)}>
            ביטול
          </Button>
          <Button
            variant="contained"
            onClick={handleSendMessage}
            startIcon={isScheduled ? <ScheduleIcon /> : <SendIcon />}
          >
            {isScheduled ? 'תזמן שליחה' : 'שלח עכשיו'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Custom Message Dialog */}
      <Dialog
        open={customMessageOpen}
        onClose={() => setCustomMessageOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          הודעה מותאמת אישית
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 2 }}>
            <Alert severity="warning">
              שים לב: הודעה מותאמת אישית כרוכה בעלות נוספת של ₪0.5 לכל הודעה
            </Alert>
            <TextField
              label="תוכן ההודעה"
              multiline
              rows={6}
              fullWidth
              helperText="ניתן להשתמש במשתנים: {{name}}, {{eventName}}, {{eventDate}}, {{location}}"
            />
            <FormControl fullWidth>
              <InputLabel>נמענים</InputLabel>
              <Select
                multiple
                value={selectedRecipients}
                onChange={handleRecipientChange}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((value) => (
                      <Chip key={value} label={value} />
                    ))}
                  </Box>
                )}
              >
                <MenuItem value="confirmed">אישרו הגעה</MenuItem>
                <MenuItem value="pending">ממתינים לאישור</MenuItem>
                <MenuItem value="declined">ביטלו</MenuItem>
                <MenuItem value="bride">צד כלה</MenuItem>
                <MenuItem value="groom">צד חתן</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                הערכת עלות
              </Typography>
              <Typography variant="body2" color="text.secondary">
                מספר נמענים: {selectedRecipients.length * 10} (הערכה)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                עלות משוערת: ₪{(selectedRecipients.length * 10 * 0.5).toFixed(2)}
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomMessageOpen(false)}>
            ביטול
          </Button>
          <Button
            variant="contained"
            onClick={handleCustomMessageSend}
            startIcon={<SendIcon />}
          >
            שלח
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Messages; 