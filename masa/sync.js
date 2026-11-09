/* שמירה בגוגל שיטס. מודול נפרד מהמנוע, כדי שאפשר יהיה להחליף אותו בעתיד.
   המנוע קורא פעם אחת ל-MasaSync.start(...), ואחרי כל שמירה מקומית ל-changed().
   אין כתובת שרת, או שאין מפתח (k), אז start מחזירה null. המנוע עובד אז כמו קודם, רק במכשיר.

   הפרוטוקול (masa-sheet.gs). הכול POST בגוף text/plain, כדי שלא יהיה preflight, והמפתח לא יופיע בכתובת:
     {a:'load', u, k}                  → {ok, rows:[[field, who, value, updatedMs]], gates:{g1:true}}
     {a:'save', u, k, set:[[field, value, t, who]], sum:{pct, stage, stuck}} → {ok}
   שמות השדות:
     f:<id> טקסט · c:<id> סימון ('1' או ריק) · rw:<key> ניסוח מחדש · h:<a|b>:<key> רמז שנפתח · n:<a|b> שם · open איפה נתקעתי
   who: המסלול שהיה פתוח במכשיר בזמן הכתיבה (a או b). כך בזוג אין דריסה: שורה לכל (יחידה, שדה, כותבת), ומוצגת האחרונה.
   t: זמן העריכה במכשיר. שליחה חוזרת של אותה עריכה (למשל אחרי sendBeacon) לא משנה את הגיליון.
   עצירות המורה (g1, g2…) לא נשלחות מכאן. הן מגיעות מהגיליון בלבד. */
(function(){
  'use strict';
  /* כתובת ה-Web App (מסתיימת ב-/exec), אחרי שהמורה פורסת. ריק = שמירה במכשיר בלבד */
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbzTMq4ZnpJ-epgvtEcntyVZxfmxZfn6io0_q0D52y4mel-KZOxfAq8TOigNlVPpTcYP/exec';
  var POLL_MS = 90000, DEBOUNCE_MS = 1500, TIMEOUT_MS = 20000, BATCH = 300;

  function endpoint(){
    /* בפיתוח מקומי בלבד: ?sync=http://localhost:8790 (שרת ההדמיה בתיקיית המורה) */
    var q = new URLSearchParams(location.search).get('sync');
    if(q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\/?$/.test(q)) return q;
    return ENDPOINT;
  }
  function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } }
  function lsSet(k, v){ try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function size(o){ return Object.keys(o).length; }

  /* המצב של המנוע ↔ רשימה שטוחה של שדות. ערך ריק = השדה לא קיים */
  function flatten(st, gates){
    var o = {}, k;
    for(k in st.f) if(st.f[k]!=null && String(st.f[k])!=='') o['f:'+k] = String(st.f[k]);
    for(k in st.checks) if(st.checks[k] && gates.indexOf(k)<0) o['c:'+k] = '1';
    for(k in st.rw) if(st.rw[k]!=null && String(st.rw[k])!=='') o['rw:'+k] = String(st.rw[k]);
    ['a','b'].forEach(function(t){
      var h = (st.hints && st.hints[t]) || {};
      for(var x in h) if(h[x]) o['h:'+t+':'+x] = String(h[x]);
      if(st.names && st.names[t]) o['n:'+t] = String(st.names[t]);
    });
    if(st.open) o.open = String(st.open);
    return o;
  }
  function apply(st, key, v){
    var m;
    if(key==='open'){ st.open = v; return; }
    if((m = key.match(/^n:([ab])$/))){ st.names[m[1]] = v; return; }
    if((m = key.match(/^h:([ab]):(.+)$/))){ if(v) st.hints[m[1]][m[2]] = v; else delete st.hints[m[1]][m[2]]; return; }
    if((m = key.match(/^(f|c|rw):(.+)$/))){
      var box = m[1]==='f' ? st.f : (m[1]==='c' ? st.checks : st.rw);
      if(v) box[m[2]] = m[1]==='c' ? true : v; else delete box[m[2]];
    }
  }

  /* o: {id, gates:[...], get(), summary(), onRemote(keys), onState(state)} */
  function start(o){
    var url = endpoint(); if(!url) return null;
    var P = new URLSearchParams(location.search), kKey = 'masa-'+o.id+'-k';
    var key = P.get('k');
    if(key && /^[\w-]{4,64}$/.test(key)) lsSet(kKey, key); else key = lsGet(kKey);
    if(!key) return null;

    var pKey = 'masa-'+o.id+'-pending', sKey = 'masa-'+o.id+'-synced';
    var pending = lsGet(pKey) || {};          /* שדה → {v, t, w}: נכתב במכשיר ועוד לא אושר בגיליון */
    var known = flatten(o.get(), o.gates);    /* מול מה משווים בשמירה הבאה */
    var timer = null, retryT = null, retryMs = 0, busy = false, loaded = false, dead = false, lastLoad = 0, lastT = 0, sumDue = false;

    function who(){ return o.get().track==='b' ? 'b' : 'a'; }
    function stamp(){ var t = Date.now(); lastT = t>lastT ? t : lastT+1; return lastT; }
    function persist(){ lsSet(pKey, size(pending) ? pending : null); }
    function setState(s){ if(o.onState) o.onState(s); }

    function req(body){
      var ctl = window.AbortController ? new AbortController() : null;
      var tm = setTimeout(function(){ if(ctl) ctl.abort(); }, TIMEOUT_MS);
      return fetch(url, { method:'POST', body:body, signal: ctl ? ctl.signal : undefined, redirect:'follow' })
        .then(function(r){ clearTimeout(tm); return r.json(); }, function(e){ clearTimeout(tm); throw e; });
    }
    function fatal(){ dead = true; clearTimeout(timer); clearTimeout(retryT); setState('badkey'); }
    function retry(){
      setState('offline');
      retryMs = Math.min(retryMs ? retryMs*2 : 15000, 120000);
      clearTimeout(retryT);
      retryT = setTimeout(function(){ if(!loaded) load(); else flush(); }, retryMs);
    }

    /* כל שינוי במכשיר: מה השתנה מאז הפעם הקודמת נכנס לתור */
    function changed(){
      var now = flatten(o.get(), o.gates), w = who(), n = 0, k, t = stamp();
      for(k in now) if(now[k]!==known[k]){ pending[k] = {v:now[k], t:t, w:w}; n++; }
      for(k in known) if(!(k in now)){ pending[k] = {v:'', t:t, w:w}; n++; }
      known = now;
      if(!n) return;
      persist();
      if(dead) return;
      setState('pending');
      clearTimeout(timer); timer = setTimeout(flush, DEBOUNCE_MS);
    }

    function flush(beacon){
      clearTimeout(timer);
      if(dead || (!size(pending) && !sumDue)) return;
      var batch = Object.keys(pending).slice(0, BATCH).map(function(k){ var p = pending[k]; return [k, p.v, p.t, p.w]; });
      var body = JSON.stringify({ a:'save', u:o.id, k:key, set:batch, sum:o.summary() });
      sumDue = false;
      /* סגירת הדף: שולחים בלי לחכות. התור נשאר, ובפעם הבאה נשלח שוב, והגיליון מזהה שזו אותה עריכה */
      if(beacon){ try{ if(navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], {type:'text/plain'})); }catch(e){} return; }
      if(busy){ timer = setTimeout(flush, DEBOUNCE_MS); return; }
      busy = true; setState('saving');
      req(body).then(function(r){
        busy = false;
        if(r && r.err==='key') return fatal();
        if(!r || !r.ok) throw new Error((r && r.err) || 'save');
        batch.forEach(function(b){ var p = pending[b[0]]; if(p && p.t===b[2]) delete pending[b[0]]; });
        persist(); retryMs = 0;
        if(size(pending)) timer = setTimeout(flush, 300); else setState('saved');
      }).catch(function(){ busy = false; if(!batch.length) sumDue = true; retry(); });
    }

    function load(){
      if(dead) return;
      if(busy){ setTimeout(load, 1000); return; }
      busy = true; lastLoad = Date.now();
      if(!loaded) setState('loading');
      req(JSON.stringify({ a:'load', u:o.id, k:key })).then(function(r){
        busy = false;
        if(r && r.err==='key') return fatal();
        if(!r || !r.ok) throw new Error((r && r.err) || 'load');
        merge(r); loaded = true; retryMs = 0;
        if(size(pending)) flush(); else setState('saved');
      }).catch(function(){ busy = false; retry(); });
    }

    /* מה שבגיליון גובר, חוץ ממה שעוד מחכה בתור במכשיר */
    function merge(r){
      var st = o.get(), S = {}, when = {}, keys = [], k;
      (r.rows || []).forEach(function(x){
        var f = String(x[0]), v = x[2]==null ? '' : String(x[2]), u = +x[3] || 0;
        if(!(f in when) || u>=when[f]){ when[f] = u; S[f] = v; }
      });
      var first = !lsGet(sKey), local = flatten(st, o.gates);
      for(k in S){
        if(k in pending) continue;
        if((local[k] || '')!==S[k]){ apply(st, k, S[k]); keys.push(k); }
      }
      for(k in local){
        if((k in S) || (k in pending)) continue;
        /* פעם ראשונה במכשיר הזה: מה שנכתב בו לפני השמירה בגיליון עולה לגיליון */
        if(first) pending[k] = {v:local[k], t:stamp(), w:who()};
        /* אחר כך הגיליון קובע: שורה שהמורה מחקה נמחקת גם כאן */
        else { apply(st, k, ''); keys.push(k); }
      }
      /* עצירות המורה: רק מהגיליון */
      var g = r.gates || {};
      o.gates.forEach(function(id){
        var on = g[id]===true;
        if(!!st.checks[id]!==on){ if(on) st.checks[id] = true; else delete st.checks[id]; keys.push('c:'+id); }
      });
      lsSet(sKey, 1); persist();
      known = flatten(st, o.gates);
      if(keys.length){
        o.onRemote(keys);
        /* בת הזוג כתבה, או שהמורה אישרה: האחוז והסטטוס השתנו. שולחים סיכום מעודכן (בלי שדות),
           כדי שהלוח של המורה לא יישאר עם מה שהמכשיר הזה שלח לפני שידע */
        sumDue = true; clearTimeout(timer); timer = setTimeout(flush, DEBOUNCE_MS);
      }
    }

    /* מתי בודקים אם יש חדש (בת הזוג, או סימון של המורה) */
    setInterval(function(){ if(document.visibilityState==='visible' && !busy && !dead) load(); }, POLL_MS);
    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState==='hidden'){ if(size(pending)) flush(true); }
      else if(Date.now()-lastLoad>30000 && !busy) load();
    });
    window.addEventListener('pagehide', function(){ if(size(pending)) flush(true); });
    window.addEventListener('online', function(){ clearTimeout(retryT); retryMs = 0; if(loaded) flush(); else load(); });

    setTimeout(load, 0);
    return { changed:changed, pendingCount:function(){ return size(pending); } };
  }

  window.MasaSync = { start:start };
})();
