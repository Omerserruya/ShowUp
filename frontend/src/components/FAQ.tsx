import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const faqs = [
  {
    q: 'ההודעות באמת מגיעות בוואטסאפ?',
    a: 'כן, וזה כל הסיפור. אנחנו עובדים על וואטסאפ הרשמי (WhatsApp Business), אז ההזמנות והתזכורות נוחתות ישר בצ׳אט של האורח. מוכר, מיידי, ובלי שאף אחד צריך לחפש איפה זה.',
  },
  {
    q: 'האורחים צריכים להתקין משהו?',
    a: 'כלום. מקבלים הודעה רגילה בוואטסאפ, לוחצים, וזהו. בלי אפליקציה, בלי לינק מוזר, בלי הרשמה. גם הדודה שמתקשרת לשאול איך פותחים PDF תסתדר לבד.',
  },
  {
    q: 'אני אפס בטכנולוגיה. זה מסובך?',
    a: 'ממש לא. ממלאים כמה פרטים, ואנחנו כבר מכינים מראש את כל ההודעות והתזמונים. אתם רק מאשרים, ויוצאים לדרך. זה הכי קרוב שיש ל"לחיצת כפתור".',
  },
  {
    q: 'כמה הודעות כל אורח מקבל?',
    a: 'בדרך כלל שלוש: הזמנה, תזכורת, ותזכורת אחרונה. ועוד תודה חמה אחרי האירוע. אפשר לשנות הכול, התזמון מסתדר לבד לפי כמה זמן נשאר, ואפשר גם באנגלית, רוסית, ערבית ועוד.',
  },
  {
    q: 'אפשר לעדכן את רשימת האורחים תוך כדי?',
    a: 'כמובן. מוסיפים, מורידים ומעדכנים בכל רגע. כל אורח חדש יקבל בדיוק מה שצריך, וזה שכבר אישר לא ייפגז בהודעות מיותרות.',
  },
  {
    q: 'המידע שלי ושל האורחים בטוח?',
    a: 'לגמרי. הכול שמור היטב ומשמש רק לאירוע שלכם. פרטי אשראי לא נשמרים אצלנו בכלל. התשלום עובר בעמוד סליקה מאובטח בתקן PCI.',
  },
  {
    q: 'ואם אסתבך באמצע?',
    a: 'אנחנו פה. בוואטסאפ, בצ׳אט, ובחבילות המתאימות גם בטלפון. מול האירוע שלכם אתם אף פעם לא לבד.',
  },
  {
    q: 'אפשר לבטל? יש החזר?',
    a: 'בטח. משלמים פעם אחת, בלי התחייבות, ויש החזר מלא תוך 14 יום. אפשר לנסות בלב שקט.',
  },
];

export default function FAQ() {
  const [expanded, setExpanded] = React.useState<string[]>([]);

  const handleChange =
    (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
      setExpanded(
        isExpanded ? [...expanded, panel] : expanded.filter((item) => item !== panel),
      );
    };

  return (
    <Container
      id="faq"
      sx={{
        pt: { xs: 4, sm: 12 },
        pb: { xs: 8, sm: 16 },
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: { xs: 3, sm: 5 },
      }}
    >
      <Box sx={{ textAlign: 'center', maxWidth: 640, mx: 'auto', direction: 'rtl' }}>
        <Typography component="h2" variant="h4" sx={{ color: 'text.primary', fontWeight: 800 }}>
          שאלות נפוצות
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mt: 1.5 }}>
          כל מה ששאלתם, ועוד כמה דברים שלא הספקתם. לא מצאתם? אנחנו במרחק הודעה אחת.
        </Typography>
      </Box>
      <Box sx={{ width: '100%', maxWidth: 820, direction: 'rtl' }}>
        {faqs.map((item, i) => {
          const panel = `panel${i + 1}`;
          return (
            <Accordion
              key={panel}
              expanded={expanded.includes(panel)}
              onChange={handleChange(panel)}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls={`${panel}d-content`}
                id={`${panel}d-header`}
              >
                <Typography component="span" variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {item.q}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.8 }}>
                  {item.a}
                </Typography>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Box>
    </Container>
  );
}
