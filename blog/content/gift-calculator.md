---
slug: gift-calculator
title: "מחשבון מתנה לחתונה: כמה לשים בצ'ק"
seo_title: "מחשבון מתנה לחתונה 2026: כמה לשים בצ'ק | ShowUp"
description: מחשבון מתנה לחתונה שנותן טווח סכום לפי הקרבה לזוג, אם באים לבד או בזוג, סוג המקום ויום האירוע. בלי הרשמה, ועם הסבר איך כל דבר משפיע.
category: תקציב ואולם
lead: בוחרים מה הקשר שלכם לזוג, אם אתם מגיעים לבד או בזוג, ואיפה ומתי האירוע, ומקבלים טווח סכום שמקובל לתת. זו הערכה ולא חוק, וההחלטה תמיד שלכם.
date: 2026-11-07
related: [wedding-gift-amount, wedding-gift-bit-paybox, wedding-budget]
faq:
  - q: האם המחשבון אומר כמה "חייבים" לתת?
    a: לא. אין סכום מחייב. המחשבון מבוסס על טווחים שנחשבים מקובלים בישראל ומשתנים בין אנשים, משפחות וקהילות. אם הסכום לא מתאים לכם, תנו מה שנוח לכם.
  - q: כמה נותנים אם לא מגיעים לחתונה?
    a: רבים נותנים מתנה גם כשלא מגיעים, בדרך כלל סכום נמוך יותר, כי אין עלות מנה. במחשבון אפשר לבחור "לא מגיעים" ולראות טווח מותאם.
  - q: האם צריך לכסות את מחיר המנה?
    a: יש מי שחושבים כך, אבל זה לא כלל. מחיר המנה משתנה מאוד בין מקומות, והאורחים בדרך כלל לא יודעים אותו. הקרבה לזוג חשובה יותר מהמנה.
  - q: מה עדיף, צ'ק, מזומן או ביט?
    a: כל הדרכים מקובלות היום. מה שחשוב הוא שהזוג ידע ממי המתנה, אז כותבים שם מלא על המעטפה או בהערה של ההעברה.
---

::: raw
<style>
.calc{margin:22px 0 30px;padding:22px;border-radius:18px;background:var(--card);border:1px solid var(--tintb)}
.calc fieldset{border:0;margin:0;padding:12px 0;border-bottom:1px solid var(--line)}
.calc legend{font-weight:700;padding:0;margin-bottom:8px}
.calc .opts{display:flex;flex-wrap:wrap;gap:8px}
.calc .opts label{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid #D8D3C9;border-radius:999px;cursor:pointer;font-size:15.5px;background:#FBFAF7}
.calc .opts input{accent-color:var(--purple)}
.calc .opts label:has(input:checked){border-color:var(--purple);background:var(--tint);color:var(--purpled);font-weight:600}
.calc .out{margin-top:18px;padding:18px;border-radius:14px;background:var(--tint);border:1px solid var(--tintb)}
.calc .out b{display:block;font-size:34px;line-height:1.2;font-variant-numeric:tabular-nums}
.calc .out span{font-size:14.5px;color:var(--body)}
</style>
<form class="calc" id="gc" onsubmit="return false">
  <fieldset><legend>מה הקשר שלכם לזוג?</legend><div class="opts">
    <label><input type="radio" name="rel" value="250" checked>מכרים, עבודה, שכנים</label>
    <label><input type="radio" name="rel" value="350">חברים</label>
    <label><input type="radio" name="rel" value="500">חברים קרובים</label>
    <label><input type="radio" name="rel" value="400">משפחה מורחבת</label>
    <label><input type="radio" name="rel" value="650">משפחה קרובה</label>
  </div></fieldset>
  <fieldset><legend>מי מגיע?</legend><div class="opts">
    <label><input type="radio" name="who" value="1" checked>אני לבד</label>
    <label><input type="radio" name="who" value="2">זוג</label>
    <label><input type="radio" name="who" value="0.5">לא מגיעים, שולחים מתנה</label>
  </div></fieldset>
  <fieldset><legend>איזה אירוע?</legend><div class="opts">
    <label><input type="radio" name="venue" value="1" checked>אולם או גן רגיל</label>
    <label><input type="radio" name="venue" value="1.15">מקום יוקרתי</label>
    <label><input type="radio" name="venue" value="0.85">אירוע קטן או בצהריים</label>
  </div></fieldset>
  <fieldset><legend>מתי?</legend><div class="opts">
    <label><input type="radio" name="day" value="1" checked>באמצע השבוע</label>
    <label><input type="radio" name="day" value="1">חמישי או מוצאי שבת</label>
    <label><input type="radio" name="day" value="0.95">שישי בצהריים</label>
  </div></fieldset>
  <div class="out" aria-live="polite"><b id="gc-range">-</b><span id="gc-note"></span></div>
</form>
<script>
(function(){
  var f=document.getElementById("gc");
  function val(n){var e=f.querySelector('input[name="'+n+'"]:checked');return e?parseFloat(e.value):1}
  function r50(x){return Math.round(x/50)*50}
  function run(){
    var mid=val("rel")*val("who")*val("venue")*val("day");
    var lo=Math.max(100,r50(mid*0.85)),hi=r50(mid*1.2);
    document.getElementById("gc-range").textContent=lo.toLocaleString("he-IL")+"–"+hi.toLocaleString("he-IL")+" ₪";
    document.getElementById("gc-note").textContent=val("who")<1
      ? "כשלא מגיעים נהוג לתת פחות. גם סכום קטן עם ברכה אישית יתקבל בשמחה."
      : "טווח מקובל, לא חובה. סכום עגול (למשל 360 או 500) נפוץ מאוד.";
  }
  f.addEventListener("change",run);run();
})();
</script>
:::

## איך המחשבון מחשב

הנקודה שממנה המחשבון מתחיל היא הקרבה שלכם לזוג, לפי הטווחים המקובלים שמפורטים במדריך [כמה לשים בצ'ק לחתונה](/blog/wedding-gift-amount). אחר כך הוא מתאים את הסכום:

| מה בחרתם | ההשפעה |
|---|---|
| זוג במקום אדם אחד | בערך פי שניים |
| לא מגיעים | בערך חצי מהסכום לאדם אחד |
| מקום יוקרתי | קצת יותר, בערך 15% |
| אירוע קטן או בצהריים | קצת פחות, בערך 15% |
| שישי בצהריים | מעט פחות |

התוצאה היא טווח, כי אין מספר אחד נכון. מה שבאמת משנה הוא מה מתאים לכם ולקשר שלכם עם הזוג.

## כמה דברים שכדאי לזכור

- **הקרבה חשובה יותר מהמקום.** חבר קרוב בחתונה צנועה נותן בדרך כלל יותר ממכר באולם יוקרתי.
- **הדדיות.** אם הזוג נתן לכם מתנה בחתונה שלכם, הרבה אנשים מחזירים סכום דומה או מעט גבוה יותר, בגלל השנים שעברו.
- **מתנה משותפת** מכמה חברים יכולה להיות נוחה, אבל חשוב שהזוג ידע ממי היא.
- **רושמים שם.** על המעטפה, בצ'ק או בהערה של ההעברה בביט ובפייבוקס.

## איך נותנים את המתנה

צ'ק ומזומן עדיין נפוצים, אבל יותר ויותר זוגות שולחים קישור למתנה. במדריך [מתנה לחתונה בביט או בפייבוקס](/blog/wedding-gift-bit-paybox) יש פירוט מלא. זוגות שמנהלים את אישורי ההגעה ב־ShowUp יכולים להוסיף להודעת התזכורת או התודה כפתור "למתנה", שמוביל לביט, לפייבוקס או לקישור מתנה באשראי. הכסף עובר ישר לזוג.
