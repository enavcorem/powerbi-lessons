/* התנהגות משותפת לדפי השיעורים בתבנית החדשה (body.v2).
   בלי מודולים, כדי שהדף ייפתח גם מ־file://.
   - וי לכל צעד (ol.do > li) ולרשימת "איך אדע שהצלחתי", נשמר בדפדפן
   - פס שלבים: מסמן את השלב שבו נמצאות
   - מצב הצגה למיט: גופן גדול, "איך עושים" והבדיקות מקופלים
   localStorage עטוף ב־try/catch: בלעדיו הדף עובד, רק לא זוכר. */
(function () {
  var body = document.body;
  var lesson = body.getAttribute('data-lesson') || location.pathname;
  var prefix = 'pbi:' + lesson + ':';

  function load(key) {
    try { return localStorage.getItem(prefix + key); } catch (e) { return null; }
  }
  function save(key, value) {
    try {
      if (value === null) localStorage.removeItem(prefix + key);
      else localStorage.setItem(prefix + key, value);
    } catch (e) { /* מצב פרטי או אחסון חסום — ממשיכות בלי לזכור */ }
  }

  // ---------- וי לכל צעד ----------
  // המפתח: מזהה הסקשן + מספר הרשימה בתוכו + מספר הצעד
  document.querySelectorAll('section[id]').forEach(function (sec) {
    sec.querySelectorAll('ol.do').forEach(function (ol, oi) {
      Array.prototype.forEach.call(ol.children, function (li, si) {
        if (li.tagName !== 'LI') return;
        var key = 'step:' + sec.id + ':' + oi + ':' + si;
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'tick';
        box.setAttribute('aria-label', 'עשיתי את צעד ' + (si + 1));
        box.checked = load(key) === '1';
        li.classList.toggle('done', box.checked);
        box.addEventListener('change', function () {
          li.classList.toggle('done', box.checked);
          save(key, box.checked ? '1' : null);
        });
        li.appendChild(box);
      });
    });
  });

  // רשימת "איך אדע שהצלחתי" — התיבות כבר ב־HTML, רק זוכרות אותן
  document.querySelectorAll('.check input[type=checkbox]').forEach(function (box, i) {
    var key = 'check:' + i;
    box.checked = load(key) === '1';
    box.addEventListener('change', function () { save(key, box.checked ? '1' : null); });
  });

  // ---------- פס השלבים ----------
  var links = Array.prototype.slice.call(document.querySelectorAll('.stages a[href^="#"]'));
  var targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });

  function mark() {
    // השלב הנוכחי: האחרון שהכותרת שלו כבר עברה את ראש המסך (מתחת לפס)
    var line = 90, current = -1;
    targets.forEach(function (t, i) {
      if (t && t.getBoundingClientRect().top <= line) current = i;
    });
    links.forEach(function (a, i) {
      a.classList.toggle('here', i === current);
      a.classList.toggle('seen', i < current);
      if (i === current) a.setAttribute('aria-current', 'step');
      else a.removeAttribute('aria-current');
    });
    // בטלפון הפס נגלל לצדדים: מוודאות שהשלב הנוכחי נראה
    var here = links[current];
    if (here && here.parentNode.parentNode.scrollWidth > here.parentNode.parentNode.clientWidth) {
      here.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  if (links.length) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { mark(); ticking = false; });
    }, { passive: true });
    window.addEventListener('resize', mark);
    mark();
  }

  // ---------- מצב הצגה ----------
  var btn = document.querySelector('.present-btn');
  function setPresent(on) {
    body.classList.toggle('present', on);
    document.querySelectorAll('details.how').forEach(function (d) { d.open = !on; });
    // הבדיקות סגורות תמיד בכניסה למצב הצגה: המורה פותחת מול הכיתה
    if (on) document.querySelectorAll('details.ok').forEach(function (d) { d.open = false; });
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if (btn) {
    btn.addEventListener('click', function () {
      var on = !body.classList.contains('present');
      setPresent(on);
      save('present', on ? '1' : null);
    });
  }
  if (load('present') === '1') setPresent(true);
})();
