import * as React from 'react';
import { Container, Typography, Box, Link, Divider } from '@mui/material';

const LAST_UPDATED = '10 ביולי 2026';
const PRIVACY_EMAIL = 'privacy@showup-rsvp.com';

type Block =
  | { p: React.ReactNode }
  | { sub: string; items?: string[]; note?: React.ReactNode }
  | { ul: string[] };

type Section = { title: string; blocks: Block[] };

const SECTIONS: Section[] = [
  {
    title: '1. מי אנחנו',
    blocks: [
      {
        p: 'ShowUp היא מערכת לניהול אירועים, שליחת הזמנות דיגיטליות, איסוף אישורי הגעה (RSVP), שליחת תזכורות וניהול תקשורת עם אורחים באמצעות WhatsApp ושירותים דיגיטליים נוספים.',
      },
    ],
  },
  {
    title: '2. איזה מידע אנו אוספים',
    blocks: [
      { p: 'בעת השימוש בשירות אנו עשויים לאסוף:' },
      {
        sub: 'מידע שמסרת לנו',
        items: ['שם מלא', 'כתובת דוא"ל', 'מספר טלפון', 'פרטי האירוע', 'מידע שתבחר להזין במהלך השימוש במערכת'],
      },
      {
        sub: 'מידע על האורחים שלך',
        note: 'כאשר תעלה רשימת מוזמנים או תוסיף אורחים למערכת, יישמר מידע כגון:',
        items: [
          'שם האורח',
          'מספר טלפון',
          'סטטוס אישור הגעה',
          'מספר משתתפים',
          'הערות שהאורח בחר למסור (כגון מגבלות תזונה או מידע נוסף)',
        ],
      },
      { p: 'הנך מצהיר כי יש לך הרשאה להשתמש במידע זה לצורך ניהול האירוע.' },
      {
        sub: 'מידע טכני',
        note: 'בעת השימוש באתר נאסף מידע טכני כגון:',
        items: ['כתובת IP', 'סוג הדפדפן', 'מערכת ההפעלה', 'זמני שימוש', 'עמודים שנצפו', 'נתוני אבחון ותקלות'],
      },
    ],
  },
  {
    title: '3. כיצד אנו משתמשים במידע',
    blocks: [
      { p: 'המידע משמש לצורך:' },
      {
        ul: [
          'הפעלת שירותי ShowUp',
          'שליחת הודעות WhatsApp לאורחים מטעמך',
          'ניהול רשימות מוזמנים',
          'איסוף אישורי הגעה',
          'שליחת תזכורות ועדכונים',
          'מתן תמיכה ושירות לקוחות',
          'שיפור חוויית המשתמש והשירות',
          'אבטחת המערכת ומניעת הונאות או שימוש לרעה',
          'עמידה בדרישות החוק',
        ],
      },
    ],
  },
  {
    title: '4. שימוש ב-WhatsApp ובשירותי Meta',
    blocks: [
      { p: 'ShowUp משתמשת בשירותי WhatsApp Business Platform של Meta לצורך שליחת הודעות.' },
      { p: 'בעת שליחת הודעות:' },
      {
        ul: [
          'מספרי הטלפון של האורחים מועברים ל-Meta לצורך אספקת השירות.',
          'השימוש כפוף גם למדיניות הפרטיות ולתנאי השימוש של Meta.',
          'איננו אחראים למדיניות הפרטיות או לאופן עיבוד המידע על ידי Meta.',
        ],
      },
    ],
  },
  {
    title: '5. ספקי שירות חיצוניים',
    blocks: [
      { p: 'לצורך אספקת השירות אנו עשויים להיעזר בספקי שירות שונים, לרבות:' },
      {
        ul: [
          'ספקי אחסון בענן',
          'ספקי דיוור',
          'ספקי תשלומים',
          'ספקי תקשורת',
          'שירותי אנליטיקה',
          'ספקי אבטחת מידע',
        ],
      },
      { p: 'ספקים אלה רשאים לעבד מידע רק לצורך מתן השירות עבורנו ובהתאם להתחייבויות חוזיות.' },
    ],
  },
  {
    title: '6. שיתוף מידע',
    blocks: [
      { p: 'לא נמכור את המידע האישי שלך.' },
      { p: 'ייתכן שנשתף מידע במקרים הבאים:' },
      {
        ul: [
          'כאשר הדבר נדרש לצורך מתן השירות.',
          'עם ספקי שירות מטעמנו.',
          'אם נידרש לכך על פי חוק או צו שיפוטי.',
          'לצורך הגנה על זכויותינו או על משתמשי המערכת.',
          'במקרה של מיזוג, רכישה או העברת פעילות עסקית.',
        ],
      },
    ],
  },
  {
    title: '7. אבטחת מידע',
    blocks: [
      { p: 'אנו מיישמים אמצעי אבטחה מקובלים בתעשייה, לרבות:' },
      { ul: ['הצפנת תקשורת (HTTPS)', 'בקרות גישה', 'ניטור אבטחתי', 'גיבויים', 'הגבלת הרשאות'] },
      { p: 'עם זאת, אין אפשרות להבטיח אבטחה מוחלטת של מידע המועבר באמצעות האינטרנט.' },
    ],
  },
  {
    title: '8. שמירת מידע',
    blocks: [
      { p: 'נשמור את המידע כל עוד הוא נחוץ לצורך:' },
      { ul: ['מתן השירות', 'ניהול החשבון', 'עמידה בדרישות החוק', 'פתרון מחלוקות', 'אכיפת ההסכמים'] },
      { p: 'באפשרותך לבקש מחיקת החשבון והמידע האישי בכפוף לחובות שמירת מידע לפי דין.' },
    ],
  },
  {
    title: '9. זכויות המשתמש',
    blocks: [
      { p: 'בכפוף לדין החל, באפשרותך:' },
      {
        ul: [
          'לעיין במידע האישי שלך.',
          'לבקש תיקון מידע שגוי.',
          'לבקש מחיקת מידע.',
          'לבקש להגביל את עיבוד המידע.',
          'למשוך הסכמה, ככל שהעיבוד מבוסס עליה.',
        ],
      },
      { p: 'ניתן ליצור עמנו קשר לצורך מימוש זכויות אלו.' },
    ],
  },
  {
    title: '10. Cookies וטכנולוגיות דומות',
    blocks: [
      { p: 'האתר משתמש ב-Cookies ובטכנולוגיות דומות לצורך:' },
      { ul: ['הפעלת האתר', 'שמירת התחברות', 'אבטחה', 'מדידת ביצועים', 'שיפור חוויית המשתמש', 'ניתוח סטטיסטי'] },
      { p: 'באפשרותך לנהל את הגדרות העוגיות באמצעות הדפדפן שלך, אולם חסימתן עשויה לפגוע בחלק מתפקודי האתר.' },
    ],
  },
  {
    title: '11. קטינים',
    blocks: [{ p: 'השירות אינו מיועד לילדים מתחת לגיל המותר לפי הדין ללא הסכמת הורה או אפוטרופוס.' }],
  },
  {
    title: '12. שינויים במדיניות',
    blocks: [
      { p: 'אנו רשאים לעדכן את מדיניות הפרטיות מעת לעת.' },
      { p: 'במקרה של שינוי מהותי נפרסם הודעה באתר או נעדכן את המשתמשים באמצעים המתאימים.' },
    ],
  },
];

function BlockView({ block }: { block: Block }) {
  if ('p' in block) {
    return <Typography paragraph>{block.p}</Typography>;
  }
  if ('ul' in block) {
    return (
      <Typography component="div">
        <ul>
          {block.ul.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </Typography>
    );
  }
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
        {block.sub}
      </Typography>
      {block.note && <Typography paragraph>{block.note}</Typography>}
      {block.items && (
        <Typography component="div">
          <ul>
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Typography>
      )}
    </Box>
  );
}

export default function Privacy() {
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Box sx={{ maxWidth: '800px', margin: '0 auto', padding: '2rem', direction: 'rtl', textAlign: 'right' }}>
        <Typography variant="h3" component="h1" gutterBottom>
          מדיניות פרטיות
        </Typography>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          עודכן לאחרונה: {LAST_UPDATED}
        </Typography>

        <Typography paragraph sx={{ mt: 2 }}>
          ברוכים הבאים ל־<strong>ShowUp</strong>.
        </Typography>
        <Typography paragraph>
          אנו מכבדים את פרטיות המשתמשים שלנו ופועלים לשמירה על המידע האישי בהתאם לדין. מסמך זה מסביר איזה מידע אנו אוספים,
          כיצד אנו משתמשים בו, עם מי הוא עשוי להיות משותף, ומהן הזכויות שלכם.
        </Typography>

        {SECTIONS.map((section) => (
          <Box key={section.title} sx={{ mt: 4 }}>
            <Typography variant="h6" gutterBottom>
              {section.title}
            </Typography>
            {section.blocks.map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
          </Box>
        ))}

        <Divider sx={{ my: 4 }} />

        <Typography variant="h6" gutterBottom>
          13. יצירת קשר
        </Typography>
        <Typography paragraph>
          לכל שאלה בנושא פרטיות ניתן לפנות אלינו:
        </Typography>
        <Typography paragraph>
          📧 <Link href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</Link>
        </Typography>
      </Box>
    </Container>
  );
}
