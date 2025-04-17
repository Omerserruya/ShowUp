import * as React from 'react';
import { Container, Typography, Box } from '@mui/material';

export default function Terms() {
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Box sx={{ maxWidth: '800px', margin: '0 auto', padding: '2rem', direction: 'rtl', textAlign: 'right' }}>
        <Typography variant="h3" component="h1" gutterBottom>
          תנאי שימוש
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
          עוד לא הגיעו האישורים? תנאי שימוש
        </Typography>
        
        <Typography paragraph>
          ברוכים הבאים למערכת "עוד לא הגיעו האישורים" (להלן: "המערכת"). השימוש באתר ובשירותים שלנו מהווה הסכמה לתנאים המפורטים להלן:
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          השירות
        </Typography>
        <Typography paragraph>
          המערכת מספקת כלי לניהול אישורי הגעה לאירועים, הכוללת שליחת הודעות בוואטסאפ, מעקב אחר סטטוסי אישור, וייבוא רשימות מוזמנים.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          הרשמה וחשבון משתמש
        </Typography>
        <Typography component="div">
          <ul>
            <li>שימוש בשירות מצריך הרשמה עם דוא"ל וסיסמה.</li>
            <li>עליך לשמור על סודיות פרטי ההתחברות שלך.</li>
            <li>חל איסור להשתמש בפרטים מזויפים.</li>
          </ul>
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          שימוש הוגן
        </Typography>
        <Typography paragraph>
          אין לשלוח הודעות ספאם או להשתמש בפלטפורמה לצרכים בלתי חוקיים. אנחנו שומרים את הזכות לחסום משתמש שיחרוג מהשימוש ההוגן.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          קניין רוחני
        </Typography>
        <Typography paragraph>
          כל התכנים, הקוד, העיצוב והטכנולוגיה שייכים למפעילי המערכת. אין להעתיק, לשכפל או להשתמש בהם ללא אישור מראש.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          שינויים בשירות
        </Typography>
        <Typography paragraph>
          אנו שומרים לעצמנו את הזכות לשנות או להפסיק את השירות (כולו או חלקו), עם או בלי הודעה מראש.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          הגבלת אחריות
        </Typography>
        <Typography paragraph>
          השירות ניתן "כמות שהוא". איננו אחראים לנזקים שייגרמו עקב שימוש במערכת, תקלה טכנית או טעות בשירות.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
          יצירת קשר
        </Typography>
        <Typography paragraph>
          בכל שאלה ניתן לפנות אלינו במייל: contact@odlohigia.com
        </Typography>
      </Box>
    </Container>
  );
} 