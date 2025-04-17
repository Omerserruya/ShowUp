import * as React from 'react';
import { Container, Typography, Box } from '@mui/material';

export default function Privacy() {
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Box sx={{ maxWidth: '800px', margin: '0 auto', padding: '2rem', direction: 'rtl', textAlign: 'right' }}>
        <Typography variant="h3" component="h1" gutterBottom>
          מדיניות פרטיות
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
          עוד לא הגיעו האישורים? מדיניות פרטיות
        </Typography>
        
        <Typography paragraph>
          הפרטיות שלך חשובה לנו. במסמך זה נפרט מה המידע שאנחנו אוספים, למה, ואיך הוא נשמר.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          איזה מידע אנחנו אוספים?
        </Typography>
        <Typography component="div">
          <ul>
            <li>מידע שנמסר על ידך (כגון: שם, אימייל, טלפון).</li>
            <li>מידע טכני על שימושך באתר (כמו כתובת IP, סוג דפדפן).</li>
            <li>רשימות אנשי קשר שתעלה – רק לצורך ניהול האירוע שלך.</li>
          </ul>
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          איך אנחנו משתמשים במידע?
        </Typography>
        <Typography component="div">
          <ul>
            <li>להפעלת המערכת והצגת נתוני אירוע.</li>
            <li>ליצירת קשר איתך.</li>
            <li>לשיפור השירות.</li>
          </ul>
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          שיתוף מידע
        </Typography>
        <Typography component="div">
          <ul>
            <li>איננו משתפים את המידע עם צדדים שלישיים, למעט אם נדרש על פי חוק.</li>
            <li>מידע של אנשי קשר לא יועבר, ימכר או ישותף עם גורם אחר.</li>
          </ul>
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          אבטחת מידע
        </Typography>
        <Typography paragraph>
          המערכת פועלת באמצעים טכנולוגיים לשמירה על המידע, אך איננו יכולים להתחייב להגנה מוחלטת.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          שמירת מידע
        </Typography>
        <Typography paragraph>
          המידע נשמר כל עוד יש לך חשבון פעיל. ניתן לבקש מחיקה מלאה בכל שלב.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          עוגיות (Cookies)
        </Typography>
        <Typography paragraph>
          האתר משתמש בעוגיות לצורכי הפעלה, סטטיסטיקה ושיפור השירות.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          צור קשר
        </Typography>
        <Typography paragraph>
          שאלות? כתוב לנו ל: privacy@odlohigia.com
        </Typography>
      </Box>
    </Container>
  );
} 