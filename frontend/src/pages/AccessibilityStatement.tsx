import * as React from 'react';
import { Container, Typography, Box, Paper, Divider } from '@mui/material';

export default function AccessibilityStatement() {
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Paper sx={{ p: 4, direction: 'rtl' }}>
        <Typography variant="h3" component="h1" gutterBottom align="center">
          הצהרת נגישות
        </Typography>
        
        <Divider sx={{ my: 3 }} />
        
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" gutterBottom>
            מחויבות לנגישות
          </Typography>
          <Typography paragraph>
            אנו באתר ShowUp מאמינים שהאינטרנט צריך להיות נגיש לכלל האוכלוסייה, כולל אנשים עם מוגבלויות.
            אנו שואפים לעמוד בתקנות הנגישות בהתאם לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות),
            התשע"ג-2013, והתקן הישראלי לנגישות אתרי אינטרנט (ת"י 5568) המבוסס על הנחיות WCAG 2.0 ברמה AA.
          </Typography>
        </Box>
        
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" gutterBottom>
            אמצעי נגישות באתר
          </Typography>
          <Typography component="div">
            <ul>
              <li>אתר מותאם לניווט באמצעות מקלדת</li>
              <li>אפשרות להגדלת הטקסט באתר</li>
              <li>אפשרות להפעלת מצב ניגודיות גבוהה</li>
              <li>אפשרות להדגשת קישורים</li>
              <li>תמיכה בסמן גדול לשיפור הנראות</li>
              <li>תמיכה בתוכנות הקראה (Screen Readers)</li>
              <li>שימוש בפונט קריא</li>
              <li>תגיות alt לתמונות</li>
              <li>כותרות ומבנה סמנטי לדפים</li>
            </ul>
          </Typography>
        </Box>
        
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" gutterBottom>
            כיצד להשתמש באפשרויות הנגישות
          </Typography>
          <Typography paragraph>
            בפינה הימנית התחתונה של האתר, תוכלו למצוא את כפתור הנגישות (סמל של אדם עם זרועות פתוחות).
            לחיצה על כפתור זה תפתח את תפריט הנגישות, שם תוכלו להתאים את האתר לצרכים שלכם.
          </Typography>
        </Box>
        
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" gutterBottom>
            דפדפנים נתמכים
          </Typography>
          <Typography paragraph>
            אמצעי הנגישות באתר תומכים בדפדפנים המודרניים: Google Chrome, Mozilla Firefox, Safari, Microsoft Edge בגרסאותיהם העדכניות.
          </Typography>
        </Box>
        
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" gutterBottom>
            מגבלות וחלקים שעדיין בתהליך הנגשה
          </Typography>
          <Typography paragraph>
            למרות מאמצינו, ייתכן כי חלקים מסוימים באתר עדיין אינם נגישים באופן מלא.
            אנו פועלים באופן מתמיד לשיפור הנגישות ולעמידה בסטנדרטים העדכניים ביותר.
          </Typography>
        </Box>
        
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" gutterBottom>
            פנייה בנושא נגישות
          </Typography>
          <Typography paragraph>
            אם נתקלתם בבעיית נגישות באתר, או שיש לכם הצעות לשיפור, אנא צרו עמנו קשר:
          </Typography>
          <Typography component="div">
            <ul>
              <li>דואר אלקטרוני: accessibility@showup.co.il</li>
              <li>טלפון: 03-1234567</li>
              <li>שעות מענה: ימי א'-ה', בין השעות 9:00-17:00</li>
            </ul>
          </Typography>
          <Typography paragraph>
            אנו מתחייבים לטפל בפניות בנושא נגישות תוך 48 שעות ממועד קבלת הפנייה.
          </Typography>
        </Box>
        
        <Box>
          <Typography variant="h5" gutterBottom>
            עדכון אחרון של הצהרת הנגישות
          </Typography>
          <Typography paragraph>
            הצהרת נגישות זו עודכנה לאחרונה בתאריך 1 בספטמבר 2023.
          </Typography>
          <Typography paragraph>
            אנו ממשיכים לבדוק ולשפר את הנגישות באתר באופן קבוע בהתאם לתקנות ולטכנולוגיות המתפתחות.
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
} 