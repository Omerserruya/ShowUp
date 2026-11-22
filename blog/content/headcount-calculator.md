---
slug: headcount-calculator
title: "מחשבון מנות לחתונה: כמה אורחים באמת יגיעו"
seo_title: "מחשבון מנות לחתונה: כמה להתחייב לאולם | ShowUp"
description: מחשבון חינמי שמעריך כמה אורחים יגיעו בפועל לפי אישורי ההגעה, ועוזר להחליט כמה מנות להתחייב לאולם. מכניסים מספרים, מקבלים טווח.
category: תקציב ואולם
lead: מכניסים כמה אישרו, כמה אמרו "אולי" וכמה עוד לא ענו, ומקבלים הערכה של כמה יגיעו בפועל ומספר מנות מומלץ לסגור מול האולם.
date: 2026-11-07
related: [venue-guaranteed-headcount, attendance-rate, guests-not-answering]
faq:
  - q: כמה אחוז מהמאשרים מגיעים בפועל?
    a: אין מספר אחד שמתאים לכל אירוע. אצל מי שאישר הגעה, רוב גדול מגיע בדרך כלל, אבל תמיד יש ביטולים של הרגע האחרון. לכן המחשבון מתחיל מהערכה של 90% ונותן לכם לשנות אותה לפי ההיכרות עם האורחים שלכם.
  - q: מה עושים עם מי שלא ענה בכלל?
    a: מי שלא ענה על אף תזכורת מגיע הרבה פחות ממי שאישר. כדאי לנסות להשיג אותו בשיחת טלפון לפני שסוגרים את המספר מול האולם, כי כל תשובה מצמצמת את אי הוודאות.
  - q: כדאי להתחייב על המספר שיצא או על פחות?
    a: בהרבה אולמות מנה שלא נאכלה עולה כמו מנה מלאה, ומנה נוספת מעבר להתחייבות מתומחרת לפי החוזה. לכן כדאי לבדוק בחוזה כמה עולה מנה מעבר להתחייבות, ולהתחייב בדרך כלל על המספר התחתון בטווח.
  - q: מתי ממלאים את המחשבון?
    a: אחרי התזכורת האחרונה, כמה ימים לפני המועד שבו האולם מבקש את המספר הסופי. ככל שיותר אורחים ענו, ההערכה מדויקת יותר.
---

המחשבון לא מחליף את ההיכרות שלכם עם האורחים, אבל הוא נותן נקודת פתיחה מסודרת. ההנחות שלו מופיעות ליד כל שדה, ואפשר לשנות אותן.

::: raw
<style>
.calc{margin:22px 0 30px;padding:22px;border-radius:18px;background:var(--card);border:1px solid var(--tintb)}
.calc .row{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:8px 16px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.calc label{font-weight:600}.calc small{display:block;font-weight:400;color:var(--muted);font-size:13.5px;line-height:1.45}
.calc input{width:100%;font:inherit;font-size:17px;padding:8px 10px;border:1px solid #D8D3C9;border-radius:10px;background:#FBFAF7;color:var(--ink);text-align:center;font-variant-numeric:tabular-nums}
.calc .res{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:18px}
.calc .box{padding:14px 16px;border-radius:14px;background:var(--tint);border:1px solid var(--tintb)}
.calc .box b{display:block;font-size:30px;line-height:1.2;font-variant-numeric:tabular-nums}.calc .box span{font-size:14px;color:var(--body)}
.calc .note{font-size:14.5px;color:var(--body);margin:14px 0 0}
</style>
<div class="calc" id="hc">
  <div class="row"><label for="hc-yes">אישרו הגעה (מספר אנשים)<small>סך האנשים שאישרו, כולל בני זוג וילדים</small></label><input id="hc-yes" type="number" min="0" inputmode="numeric" value="280"></div>
  <div class="row"><label for="hc-maybe">אמרו "אולי" (מספר אנשים)</label><input id="hc-maybe" type="number" min="0" inputmode="numeric" value="30"></div>
  <div class="row"><label for="hc-none">לא ענו (מספר אנשים)<small>לפי מספר המוזמנים הרשום אצלם</small></label><input id="hc-none" type="number" min="0" inputmode="numeric" value="40"></div>
  <div class="row"><label for="hc-ry">מתוך המאשרים יגיעו (%)<small>נקודת פתיחה: 90%</small></label><input id="hc-ry" type="number" min="0" max="100" inputmode="numeric" value="90"></div>
  <div class="row"><label for="hc-rm">מתוך ה"אולי" יגיעו (%)<small>נקודת פתיחה: 50%</small></label><input id="hc-rm" type="number" min="0" max="100" inputmode="numeric" value="50"></div>
  <div class="row"><label for="hc-rn">מתוך מי שלא ענה יגיעו (%)<small>נקודת פתיחה: 30%</small></label><input id="hc-rn" type="number" min="0" max="100" inputmode="numeric" value="30"></div>
  <div class="res" aria-live="polite">
    <div class="box"><b id="hc-mid">-</b><span>הערכה: יגיעו בפועל</span></div>
    <div class="box"><b id="hc-range">-</b><span>טווח סביר</span></div>
    <div class="box"><b id="hc-commit">-</b><span>מנות להתחייבות (הצד הזהיר)</span></div>
  </div>
  <p class="note" id="hc-tip"></p>
</div>
<script>
(function(){
  var ids=["yes","maybe","none","ry","rm","rn"];
  function v(k){var n=parseFloat(document.getElementById("hc-"+k).value);return isFinite(n)&&n>0?n:0}
  function pct(k){return Math.min(100,v(k))/100}
  function run(){
    var y=v("yes"),m=v("maybe"),n=v("none");
    var mid=y*pct("ry")+m*pct("rm")+n*pct("rn");
    var spread=m*0.25+n*0.2+y*0.03;
    var lo=Math.max(0,Math.round(mid-spread)),hi=Math.round(mid+spread);
    document.getElementById("hc-mid").textContent=Math.round(mid);
    document.getElementById("hc-range").textContent=lo+"–"+hi;
    document.getElementById("hc-commit").textContent=lo;
    var unk=m+n,tot=y+m+n;
    document.getElementById("hc-tip").textContent=tot&&unk/tot>0.15
      ? "כ־"+Math.round(unk/tot*100)+"% מהרשימה עוד לא נתנו תשובה ודאית. שווה לנסות להשיג אותם לפני שסוגרים מספר, כי זה מה שמרחיב את הטווח."
      : "רוב הרשימה ענתה, אז הטווח צר יחסית. כדאי לבדוק בחוזה כמה עולה מנה מעבר להתחייבות.";
  }
  ids.forEach(function(k){document.getElementById("hc-"+k).addEventListener("input",run)});
  run();
})();
</script>
:::

## איך המחשבון מגיע למספר

הוא מחלק את הרשימה לשלוש קבוצות, כי לכל קבוצה יש סיכוי שונה להגיע:

| קבוצה | נקודת פתיחה | למה |
|---|---|---|
| אישרו הגעה | 90% | רובם מגיעים, אבל תמיד יש מחלה, תינוק או פקק |
| אמרו "אולי" | 50% | באמת לא יודעים, וזה יכול ללכת לשני הכיוונים |
| לא ענו | 30% | חלק פשוט לא קוראים הודעות, וחלק כבר יודעים שלא יבואו |

את האחוזים האלה כדאי להתאים: אירוע באמצע השבוע, אורחים רבים מחו"ל או ממקום רחוק, או רשימה עם הרבה קולגות מהעבודה מורידים בדרך כלל את אחוז ההגעה. אירוע משפחתי צפוף ומקום קרוב מעלים אותו. על זה יש פירוט במדריך [אחוז הגעה לחתונה](/blog/attendance-rate).

## למה הטווח חשוב יותר מהמספר

ההערכה האמצעית היא רק נקודה. מה שבאמת משנה הוא כמה רחב הטווח, ואת זה קובעים בעיקר מי שאמרו "אולי" ומי שלא ענו. כל אורח שעובר מ"לא ענה" ל"אישר" או ל"לא מגיע" מצמצם את הטווח. לכן הצעד הכי משתלם לפני ההתחייבות הוא לא לנחש טוב יותר, אלא להשיג עוד תשובות: תזכורת אחרונה, ושיחת טלפון למי שלא עונה בוואטסאפ.

::: tip כמה מנות לסגור בפועל
בהרבה אולמות אפשר להוסיף מנות עד מועד מסוים, ולפעמים גם ביום האירוע, במחיר שקבוע בחוזה. לכן הצד הזהיר הוא בדרך כלל להתחייב על הקצה התחתון של הטווח, ולוודא מראש מה המחיר של מנה נוספת. כל הפרטים במדריך [כמה מנות להתחייב לאולם](/blog/venue-guaranteed-headcount).
:::

## איך לקבל מספרים אמינים למחשבון

- **ספרו אנשים, לא הזמנות.** משפחה של חמישה שאישרה היא חמש מנות (ולפעמים מנות ילדים בנפרד).
- **עדכנו אחרי כל סבב.** ההערכה הטובה ביותר היא אחרי התזכורת האחרונה.
- **שימו לב לשינויי דעה.** מי שאישר לפני חודש ואז כתב "בסוף לא נוכל" צריך לרדת מהספירה.

ב־ShowUp הספירה הזו קורית לבד: כל תשובה בוואטסאפ או בשיחת הטלפון נכנסת לרשימה עם מספר האנשים, וגם שינוי דעה מתעדכן. אפשר פשוט לשאול את העוזר "כמה אישרו?" ולהכניס את המספרים למחשבון.
