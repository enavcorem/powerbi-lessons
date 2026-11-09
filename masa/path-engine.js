/* מנוע המסע: משותף לכל היחידות.
   כל מה שייחודי ליחידה יושב ב-units/<id>.js (window.UNIT): השלבים, המילון, השאלות, הפרומפט והסטטוס.
   יחידה של תלמידה אחת: מסלול 'a' בלבד. זוג: 'a' ו-'b', עם החלפת מסלול.
   מפתחות: שדה שאלה a1-rel, סימון שאלה a-q1-v, ניסוח מחדש a1, רמזים לפי מסלול. */
(function(){
  'use strict';
  var U = window.UNIT;
  var TR = U.pair ? ['a','b'] : ['a'];
  function T(sg, pl){ return U.pair ? pl : sg; }
  var KEY = 'masa-'+U.id+'-v1';
  var FMIN = U.FMIN || 10, LOCK_MIN = U.LOCK_MIN || 6;
  var SEQ = U.SEQ, QF = U.QF, QC = U.QC, LOCKHINT = U.LOCKHINT || {};
  var SKILLS = { 'import':'ייבוא נתונים', 'pq-duplicates':'הסרת כפילויות ועמודות', 'pq-replace':'החלפת ערכים ואחידות', 'types-sort':'סוג נתון ומיון',
    'relationships':'קשר בין טבלאות', 'visuals':'בחירת ויזואל', 'slicer':'סלייסרים', 'conditional-format':'עיצוב מותנה' };
  var STAGES = SEQ.filter(function(x){ return !x.gate; });
  SEQ.forEach(function(x){ if(!x.gate) x.num = STAGES.indexOf(x)+1; });
  function $(id){ return document.getElementById(id); }

  /* ---------- מצב ---------- */
  function blank(){ return { checks:{}, f:{}, rw:{}, hints:{a:{}, b:{}}, names:{a:'', b:''}, open:'', track:'a' }; }
  function load(){
    var s=null; try{ s=JSON.parse(localStorage.getItem(KEY)); }catch(e){}
    s = s && typeof s==='object' ? s : {};
    var b=blank(), h=s.hints||{}, n=s.names||{};
    return { checks:s.checks||b.checks, f:s.f||b.f, rw:s.rw||b.rw, hints:{a:h.a||{}, b:h.b||{}}, names:{a:n.a||'', b:n.b||''}, open:s.open||'',
      track:(U.pair && s.track==='b') ? 'b' : 'a' };
  }
  var state = load();
  /* שמירה בגיליון (sync.js). null = אין שרת או אין מפתח בקישור, ואז הכול נשמר רק במכשיר */
  var sync = null;
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} if(sync) sync.changed(); }

  /* ---------- טקסט ---------- */
  var COLRX = new RegExp('\\b('+(U.cols||[]).slice().sort(function(a,b){ return b.length-a.length; }).join('|')+')\\b', 'g');
  function fmt(s){
    var keep=[];
    s=String(s).replace(/`([^`]+)`/g, function(_,m){ keep.push('<code>'+esc(m)+'</code>'); return '\u0001'+(keep.length-1)+'\u0002'; });
    s=s.replace(/<a [^>]*>[^<]*<\/a>|<b>|<\/b>/g, function(m){ keep.push(m); return '\u0001'+(keep.length-1)+'\u0002'; });
    if(U.cols && U.cols.length) s=s.replace(COLRX, function(m){ keep.push('<code>'+m+'</code>'); return '\u0001'+(keep.length-1)+'\u0002'; });
    s=s.replace(/[A-Za-z][A-Za-z0-9]*(?:[ \-\/][A-Za-z0-9]+)*/g, function(m){ return '<span class="en">'+m+'</span>'; });
    return s.replace(/\u0001(\d+)\u0002/g, function(_,i){ return keep[+i]; });
  }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  /* ---------- ספירה ---------- */
  function fv(id){ return String(state.f[id]||'').trim(); }
  function fieldDone(id){
    var v=fv(id);
    if(U.fieldDone){ var r=U.fieldDone(id, v, api); if(r!==undefined) return r; }
    if(id==='rows') return /\d{3,}/.test(v);
    if(id==='frame') return v==='a' || v==='b';
    return v.length>=FMIN;
  }
  function qs(tr){ return U.TRACKS[tr].qs; }
  /* כרטיס שאלה: 4 שדות חובה (נספרים באחוז ובסטטוס) ו-3 להעמקה (מקופלים, לא נספרים).
     יחידה יכולה לקבוע חובה אחרת ב-U.QREQ */
  var QREQ = U.QREQ || ['rel','cols','viz','claim'];
  var CERF = ['claim','evid','reason','alt'];
  function isReq(x){ return QREQ.indexOf(x)>=0; }
  function qIds(tr, n){
    var k=tr+n, ids=[];
    function f(x){ if(isReq(x)) ids.push('f:'+k+'-'+x); }
    ['rel','cols','viz'].forEach(f);
    ids.push('c:'+tr+'-q'+n+'-v', 'c:'+tr+'-q'+n+'-k');
    CERF.forEach(f);
    ids.push('c:'+tr+'-q'+n+'-t');
    return ids;
  }
  /* השאלה הראשונה שעוד לא הושלמה (0 אם כולן הושלמו) */
  function curQ(tr){ for(var n=1;n<=qs(tr).length;n++){ var ids=qIds(tr,n); if(countDone(ids)<ids.length) return n; } return 0; }
  function seqIds(x, tr){
    tr = tr || state.track;
    if(x.gate) return ['c:'+x.id];
    if(x.track){ var ids=[]; for(var n=1;n<=qs(tr).length;n++) ids=ids.concat(qIds(tr,n)); return ids; }
    return x.items.map(function(it,k){ return /^f:/.test(it[0]) ? it[0] : 'c:'+x.id+'-'+(k+1); });
  }
  function isDone(id){ return id.indexOf('f:')===0 ? fieldDone(id.slice(2)) : !!state.checks[id.slice(2)]; }
  function countDone(ids){ return ids.filter(isDone).length; }
  function currentIndex(tr){
    for(var i=0;i<SEQ.length;i++){ var ids=seqIds(SEQ[i], tr); if(countDone(ids)<ids.length) return i; }
    return -1;
  }
  function blockedBy(i){ for(var j=0;j<i;j++){ if(SEQ[j].gate && !state.checks[SEQ[j].id]) return SEQ[j]; } return null; }
  function pct(tr){ var t=0,d=0; SEQ.forEach(function(x){ var ids=seqIds(x,tr); t+=ids.length; d+=countDone(ids); }); return Math.round(d*100/t); }
  function qText(tr, n){ var r=(state.rw[tr+n]||'').trim(); return r || qs(tr)[n-1].t; }
  function name(tr){ return String(state.names[tr]||'').trim(); }
  function trShort(tr){ return tr==='a'?'א׳':'ב׳'; }
  function who(tr){ var nm=name(tr); return 'תלמידה '+trShort(tr)+(nm?' ('+nm+')':''); }
  function hintList(tr){ var h=state.hints[tr]||{}; return Object.keys(h).map(function(k){ return h[k]; }); }
  function idLabel(id){
    var m;
    if(id.indexOf('f:')===0){ var k=id.slice(2);
      if((m=k.match(/^([ab])(\d)-(\w+)$/))){ var q=QF.filter(function(x){ return x[0]===m[3]; })[0]; return 'שאלה '+m[2]+': '+(q?q[1]:m[3]); }
      if(k==='order') return 'כפילויות: לפני או אחרי';
      return (U.FLABEL||{})[k]||k; }
    var c=id.slice(2);
    if((m=c.match(/^([ab])-q(\d)-(\w)$/))){ var qc=QC.filter(function(x){ return x[0]===m[3]; })[0]; return 'שאלה '+m[2]+': '+(qc?qc[1]:''); }
    for(var i=0;i<SEQ.length;i++){ var x=SEQ[i]; if(x.gate && x.id===c) return '✋ '+x.t;
      if(!x.gate && !x.track && c.indexOf(x.id+'-')===0){ var it=x.items[+c.slice(x.id.length+1)-1]; if(it) return it[0].replace(/`/g,''); } }
    return c;
  }

  /* ---------- רינדור ---------- */
  function skillLink(a){ return '<a class="skill" href="cards.html#'+a+'" target="_blank" rel="noopener">🎬 כרטיס מיומנות: '+SKILLS[a]+'</a>'; }
  function checkHTML(id, label, cls){
    var on=!!state.checks[id];
    return '<label class="check'+(on?' on':'')+(cls?' '+cls:'')+'"><input type="checkbox" data-id="'+id+'"'+(on?' checked':'')+'><span>'+fmt(label)+'</span></label>';
  }
  function areaHTML(id, label, ph, small){
    return '<div class="field wf'+(small?' sm':'')+'"><label for="f-'+id+'">'+label+'</label><textarea id="f-'+id+'" data-f="'+id+'" placeholder="'+esc(ph||'')+'">'+esc(state.f[id]||'')+'</textarea></div>';
  }
  function lockText(locked){ return locked ? T('כתבי קודם ניסיון משלך, ואז ייפתח רמז','כתבו קודם ניסיון משלכן, ואז ייפתח רמז') : T('פתחי רמז (נספר בסטטוס)','פתחו רמז (נספר בסטטוס)'); }
  function hintHTML(key, label, inner, lockField, sumText){
    var locked = lockField ? fv(lockField).length<LOCK_MIN : false;
    return '<details class="hintd'+(lockField?' lock':'')+(locked?' locked':'')+'" data-hint="'+key+'" data-hlabel="'+esc(label)+'"'+(lockField?' data-lock="'+lockField+'"':'')+'><summary>'+
      (lockField ? lockText(locked) : sumText)+'</summary>'+inner+'</details>';
  }
  /* טקסטים של כרטיס שאלה. היחידה יכולה לדרוס כל אחד מהם ב-U.QL */
  var QL = Object.assign({
    relH:'🏢 למה זה רלוונטי ללקוח? <em>חובה</em>',
    relP:T('איזו החלטה של הלקוח השאלה הזו עוזרת לקבל? משפט אחד, במילים שלך. המורה תבדוק אותו.','איזו החלטה של הלקוח השאלה הזו עוזרת לקבל? משפט אחד, במילים שלכן. המורה תבדוק אותו.'),
    relPh:'השאלה הזו תעזור ללקוח להחליט...',
    colsL:T('✏️ הניסיון שלי: אילו עמודות, ולמה','✏️ הניסיון שלנו: אילו עמודות, ולמה'),
    vizL:T('✏️ הניסיון שלי: איזה ויזואל, ומה יהיה בצירים','✏️ הניסיון שלנו: איזה ויזואל, ומה יהיה בצירים'),
    claim:T('טענה: מה את אומרת ללקוח?','טענה: מה אתן אומרות ללקוח?'), evid:'ראיה: מה בדיוק בגרף מראה את זה? (אחוזים, כמה אנשים בכל קבוצה)',
    reason:'נימוק: למה הראיה הזו תומכת בטענה?', alt:'🤔 מה עוד יכול להסביר את זה?',
    rw:T('✏️ הניסוח שלי <small>(אם שיניתי אחרי מפגש עם המורה)</small>','✏️ הניסוח שלנו <small>(אם שיניתן אחרי מפגש עם המורה)</small>'),
    rwPh:T('משאירה ריק = הניסוח מההצעה','משאירות ריק = הניסוח מההצעה')
  }, U.QL || {});
  /* ערך ב-QL יכול להיות פונקציה של api (למשל שם לקוחה שתלוי בהחלטה של התלמידות) */
  function ql(k){ var v=QL[k]; return typeof v==='function' ? v(api) : v; }
  var CERPH = { claim:'משפט אחד', evid:'בגרף ___ רואים ש___', reason:'זה מראה ש___ כי ___', alt:'אולי ___' };
  function cerHTML(list, key){ return list.map(function(x){ return areaHTML(key+'-'+x, ql(x), CERPH[x], true); }).join(''); }
  /* שאלה אחת בכל פעם: רק השאלה הנוכחית פתוחה, ופתיחת שאלה סוגרת את האחרות (ב-toggle למטה) */
  function questionsHTML(){
    var tr=state.track, cq=curQ(tr), total=qs(tr).length;
    var html='<div class="skills">'+['visuals','slicer','conditional-format'].map(skillLink).join('')+'</div><div class="qs">';
    qs(tr).forEach(function(q, k){
      var n=k+1, key=tr+n, ids=qIds(tr,n), dn=countDone(ids), all=dn===ids.length;
      var req=CERF.filter(isReq), deep=CERF.filter(function(x){ return !isReq(x); });
      var deepOpen=deep.some(function(x){ return fv(key+'-'+x); });
      html += '<details class="q'+(all?' done':'')+'" data-q="'+n+'"'+(n===cq?' open':'')+'><summary><span class="qn">'+(all?'✓':n)+'</span><h4 class="qt"><span class="qtx">'+esc(qText(tr,n))+'</span>'+
        '<small><span data-qpill="'+n+'">'+dn+'/'+ids.length+'</span> · שאלה '+n+' מתוך '+total+'</small></h4><span class="chev" aria-hidden="true">▾</span></summary><div class="q-body">'+
        '<div class="qb rel"><h5 class="h">'+ql('relH')+'</h5><p>'+ql('relP')+'</p>'+
          '<textarea id="f-'+key+'-rel" data-f="'+key+'-rel" aria-label="למה שאלה '+n+' רלוונטית ללקוח" placeholder="'+esc(ql('relPh'))+'">'+esc(state.f[key+'-rel']||'')+'</textarea></div>'+
        '<div class="qb cols"><h5 class="h">🔎 אילו עמודות עונות על זה?</h5><p>'+fmt(q.colsQ)+'</p>'+
          areaHTML(key+'-cols', ql('colsL'), 'למשל: ___ כי ___', true)+
          hintHTML(tr+'-'+key+'-cols', 'שאלה '+n+' עמודות', '<p>'+fmt(q.cols)+'</p>', key+'-cols')+'</div>'+
        '<div class="qb viz"><h5 class="h">📊 איזה ויזואל?</h5><p>'+fmt(q.viz)+'</p>'+
          areaHTML(key+'-viz', ql('vizL'), 'למשל: ___ כי ___', true)+
          hintHTML(tr+'-'+key+'-viz', 'שאלה '+n+' ויזואל', '<p>'+fmt(q.vizP)+'</p>', key+'-viz')+'</div>'+
        '<div class="qb trap"><h5 class="h">💣 שאלת המלכודת</h5><p>'+fmt(q.trap)+'</p></div>'+
        '<div class="qb cer"><h5 class="h">🧠 טענה ← ראיה ← נימוק</h5>'+cerHTML(req, key)+
          (deep.length ? '<details class="deep"'+(deepOpen?' open':'')+'><summary>להעמקה <small>(לא חובה, ולא נספר באחוז)</small></summary>'+cerHTML(deep, key)+'</details>' : '')+'</div>'+
        '<div class="checks">'+QC.map(function(it){ return checkHTML(tr+'-q'+n+'-'+it[0], it[1]); }).join('')+'</div>'+
        '<div class="field"><label for="rw-'+key+'">'+ql('rw')+'</label><input type="text" id="rw-'+key+'" data-rw="'+key+'" placeholder="'+esc(ql('rwPh'))+'" value="'+esc(state.rw[key]||'')+'"></div>'+
        (n<total ? '<button type="button" class="btn ghost small qnext" data-next="'+(n+1)+'">לשאלה '+(n+1)+' <span aria-hidden="true">←</span></button>' : '')+
        '</div></details>';
    });
    return html+'</div>';
  }
  function tasksHTML(st){
    return '<div class="tasks">'+st.tasks.map(function(t, ti){
      var head='<h4 class="h">'+t.h+'</h4>'+(t.skill?skillLink(t.skill):'')+'<p>'+fmt(t.q)+'</p>';
      if(t.lock) return '<div class="qb task">'+head+areaHTML(t.lock,'✏️ הניסיון שלי',t.ph||'',true)+hintHTML(t.lock, 'שלב '+st.num+': '+t.h.replace(/^\S+\s/,''), LOCKHINT[t.lock], t.lock)+'</div>';
      if(t.field) return '<div class="qb task">'+head+'<div class="field wf sm"><input type="text" id="f-'+t.field+'" data-f="'+t.field+'" placeholder="'+esc(t.ph||'')+'" value="'+esc(state.f[t.field]||'')+'" aria-label="'+esc(t.h)+'"></div></div>';
      var inner = t.html==='COLS' ? U.COLS_HTML : '<p>'+fmt(t.p)+'</p>';
      return '<div class="qb task">'+head+hintHTML(st.id+'-t'+ti, 'שלב '+st.num+': '+t.h.replace(/^\S+\s/,''), '<div class="rv">'+inner+'</div>', null, t.label)+'</div>';
    }).join('')+'</div>';
  }
  function gateHTML(g, i){
    var on=!!state.checks[g.id];
    return '<div class="gate-block'+(on?' on':'')+'" id="'+g.id+'" data-seq="'+i+'"><h3 class="gh">✋ <b>'+g.t+'</b></h3>'+
      '<p>מה מראים למורה: '+fmt(g.show)+'</p>'+
      /* עם גיליון: רק המורה מסמנת, בגיליון. בלי גיליון: התלמידה מסמנת כמו קודם */
      (sync ? '<p class="gate-state">'+(on ? '✅ המורה אישרה' : '⏳ מחכה לאישור של המורה. הוא יופיע כאן לבד')+'</p>'
            : checkHTML(g.id, 'המורה אישרה', 'gatecheck'))+'</div>';
  }
  function dictHTML(){
    return '<div class="dict">'+U.DICT.map(function(d){ return '<div>'+d[0].split(' · ').map(function(c){ return '<code>'+c+'</code>'; }).join(' ')+'<p>'+fmt(d[1])+'</p></div>'; }).join('')+'</div>';
  }
  function renderStages(){
    var cur=currentIndex(), box=$('stages');
    var wasOpen={}; Array.prototype.forEach.call(box.querySelectorAll('details.stage[open]'), function(d){ wasOpen[d.id]=true; });
    box.innerHTML = SEQ.map(function(st, i){
      if(st.gate) return gateHTML(st, i);
      var body='<p class="why">'+fmt(st.why)+'</p>';
      if(st.skills) body+='<div class="skills">'+(st.track?'':st.skills.map(skillLink).join(''))+'</div>';
      if(st.bridge) body+='<div class="bridge-note">'+st.bridge+'</div>';
      if(st.dict) body+=dictHTML();
      if(st.honest) body+='<p class="honest">'+(U.honest || '<b>ומה אם יוצא ״אין הבדל״?</b> זו תשובה! ״בנתונים האלה לא נמצא קשר בין X ל-Y״ היא מסקנה כנה ולגיטימית.')+'</p>';
      var thinkH = st.think ? '<div class="think"><div class="lbl">🤔 שאלות לחשוב עליהן</div><ul>'+st.think.map(function(q){ return '<li>'+fmt(q)+'</li>'; }).join('')+'</ul></div>' : '';
      var tasksH = st.tasks ? tasksHTML(st) : '';
      body += st.tasksFirst ? tasksH+thinkH : thinkH+tasksH;
      if((st.decision || st.concl || st.peer) && U.decisionHTML) body+=U.decisionHTML(st, api);
      if(st.track) body+=questionsHTML();
      else if(st.review){ var nR=U.REVIEW.length;
        body+='<div class="lbl" style="font-weight:800;color:var(--purple);margin:2px 0 6px">🪞 '+T('עברי','עברו')+' על כל דשבורד ובדקי:</div>';
        body+='<div class="checks">'+st.items.slice(0,nR).map(function(it,k){ return checkHTML(st.id+'-'+(k+1), it[0]); }).join('')+'</div>'+
          areaHTML('fixed','🔧 מה מצאתי ותיקנתי? <small>(לפחות דבר אחד, ספציפי: איזה גרף, מה היה, מה עכשיו)</small>','')+
          '<div class="checks">'+checkHTML(st.id+'-'+(st.items.length), st.items[st.items.length-1][0])+'</div>'; }
      else { var cl=st.items.map(function(it,k){ return /^f:/.test(it[0]) ? '' : checkHTML(st.id+'-'+(k+1), it[0]); }).join(''); if(cl) body+='<div class="checks">'+cl+'</div>'; }
      if(st.hint) body+='<div class="hint">'+fmt(st.hint)+'</div>';
      var ids=seqIds(st), dn=countDone(ids), all=dn===ids.length;
      var title = st.num+'. '+st.t+(st.track && U.pair ? '<span class="track-tag">'+trShort(state.track)+'</span>' : '');
      return '<details class="stage'+(st.decision?' decision':'')+(all?' done':'')+(i===cur?' current':'')+'" id="'+st.id+'" data-seq="'+i+'"'+((i===cur||wasOpen[st.id])?' open':'')+'>'+
        '<summary><span class="se">'+st.e+'</span><h3 class="st"><small data-tag="'+i+'"></small><b>'+title+'</b></h3>'+
        '<span class="pill" data-pill="'+i+'">'+dn+'/'+ids.length+'</span><span class="chev" aria-hidden="true">▾</span></summary>'+
        '<div class="stage-body"><div class="waitnote">⏳ שלב קודם מחכה לאישור המורה. אפשר להציץ, אבל קודם '+T('עוברים','עוברות')+' את העצירה.</div>'+body+'</div></details>';
    }).join('');
  }

  var lastCur=null;
  function refresh(){
    var cur=currentIndex(), tr=state.track;
    if(lastCur!==null && cur!==lastCur && cur>=0){ var ce=document.querySelector('details[data-seq="'+cur+'"]'); if(ce) ce.open=true; }
    lastCur=cur;
    SEQ.forEach(function(st,i){
      var el=document.querySelector('[data-seq="'+i+'"]'); if(!el) return;
      var ids=seqIds(st), dn=countDone(ids), all=dn===ids.length, blk=blockedBy(i);
      el.classList.toggle('done',all); el.classList.toggle('current',i===cur); el.classList.toggle('waiting', !!blk && !all);
      if(st.gate){ el.classList.toggle('on', all); return; }
      el.querySelector('[data-pill="'+i+'"]').textContent=dn+'/'+ids.length;
      el.querySelector('[data-tag="'+i+'"]').textContent= all?'✅ הושלם':(blk?'⏳ אחרי אישור המורה':(i===cur?T('📍 את כאן','📍 אתן כאן'):(st.decision?T('🧭 החלטה שלך','🧭 החלטה שלכן'):'שלב '+st.num)));
    });
    for(var n=1;n<=qs(tr).length;n++){
      var box=document.querySelector('[data-q="'+n+'"]'); if(!box) continue;
      var ids=qIds(tr,n), dn=countDone(ids), all=dn===ids.length;
      box.classList.toggle('done',all);
      box.querySelector('.qn').textContent= all?'✓':n;
      box.querySelector('[data-qpill="'+n+'"]').textContent=dn+'/'+ids.length;
    }
    var p=pct(tr);
    $('xpFill').style.width=p+'%';
    $('xpBar').setAttribute('aria-valuenow',p);
    $('xpText').innerHTML='<b>'+p+'%</b> מהמסלול';
    var cx=cur<0?null:SEQ[cur];
    renderNow(cx, tr);
    $('goNow').setAttribute('href', cur<0?'#status':'#'+cx.id);
    var suf = U.trackSuffix ? U.trackSuffix(api) : '';
    $('trackLabel').textContent = (U.pair ? 'מסלול '+who(tr) : 'המסלול של '+(name('a')||'התלמידה'))+(suf?' · '+suf:'');
    $('preview').textContent=U.buildStatus(api);
    $('aiPrompt').textContent=U.buildPrompt(api, tr);
    /* הוק אופציונלי ליחידה: עדכון חלקים בדף שתלויים בהחלטות (למשל פסקת הלקוחה) */
    if(U.onRefresh) U.onRefresh(api);
  }

  /* ---------- תיבת ״מה עכשיו״ ----------
     מה עושים: השלב הנוכחי, והפריט הראשון שעוד לא סומן בו (מחושב לבד).
     מה מגישים / זמן / סבב: מהשלב ביחידה (out, time, round). שדה חסר = התא מוסתר. בעצירה: show. */
  function cell(id, html){ var el=$(id); el.innerHTML=html||''; el.parentNode.hidden=!html; }
  function renderNow(x, tr){
    if(!x){ $('nowText').textContent='🏁 הכול הושלם!'; $('nowNext').textContent='כל השלבים סומנו. בהצלחה בהצגה!';
      cell('nowOut',''); cell('nowTime',''); cell('nowRound',''); return; }
    $('nowText').textContent = x.gate ? '✋ '+x.t : 'שלב '+x.num+': '+x.t;
    var miss = x.gate ? null : seqIds(x, tr).filter(function(id){ return !isDone(id); })[0];
    $('nowNext').textContent = x.gate ? T('מראים למורה, והיא מסמנת אישור','מראות למורה, והיא מסמנת אישור') : (miss ? 'הבא ברשימה: '+idLabel(miss) : '');
    cell('nowOut', fmt(x.gate ? x.show : (x.out||'')));
    cell('nowTime', x.time ? esc(x.time) : '');
    cell('nowRound', x.round ? esc(x.round) : '');
  }

  /* ---------- נגישות: אימוג׳י ----------
     האימוג׳י הם קישוט. עוטפים כל אחד ב-aria-hidden, כדי שקוראת מסך לא תקריא ״סמל מפה״ לפני כל כותרת.
     עובד על כל ה-DOM (גם על מה שהיחידה בונה), ונשאר מעודכן דרך MutationObserver. לא נוגע בשדות כתיבה. */
  var EMO = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*/gu;
  function hideEmoji(root){
    if(!root || root.nodeType!==1) return;
    var w=document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode:function(n){
      var p=n.parentNode;
      if(!p || /^(TEXTAREA|SCRIPT|STYLE|OPTION)$/.test(p.nodeName) || p.closest('[aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
      EMO.lastIndex=0; return EMO.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
    var list=[]; while(w.nextNode()) list.push(w.currentNode);
    list.forEach(function(n){
      var s=n.nodeValue, frag=document.createDocumentFragment(), last=0;
      s.replace(EMO, function(m, i){
        if(i>last) frag.appendChild(document.createTextNode(s.slice(last, i)));
        var sp=document.createElement('span'); sp.setAttribute('aria-hidden','true'); sp.textContent=m; frag.appendChild(sp);
        last=i+m.length; return m; });
      if(last<s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      n.parentNode.replaceChild(frag, n);
    });
  }
  function watchEmoji(){
    hideEmoji(document.body);
    new MutationObserver(function(recs){ recs.forEach(function(r){ hideEmoji(r.target.nodeType===3 ? r.target.parentNode : r.target); }); })
      .observe(document.body, { childList:true, characterData:true, subtree:true });
  }

  /* ---------- העתקה ---------- */
  var toastT;
  function toast(msg){ var t=$('toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(function(){ t.classList.remove('on'); },2400); }
  function fallbackCopy(text){
    var ta=document.createElement('textarea'); ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0,text.length);
    var ok=false; try{ ok=document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta); return ok;
  }
  function copy(text, okMsg){
    window.__lastCopied=text;
    function done(ok){ toast(ok?okMsg:T('😕 לא הצלחתי להעתיק. סמני את הטקסט והעתיקי ידנית','😕 לא הצלחנו להעתיק. סמנו את הטקסט והעתיקו ידנית')); }
    if(navigator.clipboard && window.isSecureContext){ navigator.clipboard.writeText(text).then(function(){ done(true); }, function(){ done(fallbackCopy(text)); }); }
    else done(fallbackCopy(text));
  }
  function copyStatus(){
    var missing=TR.filter(function(t){ return !name(t); })[0];
    if(missing){ $('name-'+missing).focus(); toast(T('✏️ כתבי קודם את השם שלך למעלה','✏️ כתבו קודם את השמות שלכן למעלה')); return; }
    copy(U.buildStatus(api), T('✅ הסטטוס הועתק! הדביקי בוואטסאפ למורה','✅ הסטטוס הועתק! הדביקו בוואטסאפ למורה'));
  }

  /* ---------- שלד הדף מתוך היחידה ---------- */
  function buildShell(){
    document.title = U.title;
    /* בזוג: אלמנטים עם data-pl מקבלים ניסוח ברבות, ו-data-pl-ph מחליף placeholder */
    if(U.pair){
      Array.prototype.forEach.call(document.querySelectorAll('[data-pl]'), function(el){ el.innerHTML = el.getAttribute('data-pl'); });
      Array.prototype.forEach.call(document.querySelectorAll('[data-pl-ph]'), function(el){ el.setAttribute('placeholder', el.getAttribute('data-pl-ph')); });
    }
    if(U.openPh) $('openq').setAttribute('placeholder', U.openPh);
    /* קישור אופציונלי בראש הדף (U.home = {href, text}). בלי ההגדרה לא מוצג כלום */
    if(U.home && U.home.href){ var ha=document.createElement('a'); ha.className='home-link'; ha.href=U.home.href; ha.textContent=U.home.text||'🧭 חזרה';
      document.querySelector('.top-actions').appendChild(ha); }
    $('logo').innerHTML = U.logo;
    $('heroTop').innerHTML = U.heroTop;
    $('intro').innerHTML = U.intro;
    $('stageCount').textContent = STAGES.length;
    $('names').innerHTML = TR.map(function(t){
      var lbl = U.pair ? '👩 תלמידה '+trShort(t)+' <small>(שם)</small>' : '👩 השם שלי';
      return '<div class="field" style="margin-top:4px"><label for="name-'+t+'">'+lbl+'</label><input type="text" id="name-'+t+'" data-name="'+t+'" placeholder="השם שלך" autocomplete="off"></div>';
    }).join('');
    if(U.pair){
      $('tracks').hidden = false;
      $('tracks').innerHTML = TR.map(function(t){ var x=U.TRACKS[t];
        return '<button type="button" data-track="'+t+'" aria-pressed="'+(state.track===t)+'">תלמידה '+trShort(t)+'<small>'+esc(x.topic||'')+'</small></button>'; }).join('');
    }
  }

  var api = { fv:fv, esc:esc, fmt:fmt, T:T, areaHTML:areaHTML, checkHTML:checkHTML, hintHTML:hintHTML,
    pct:pct, currentIndex:currentIndex, seqIds:seqIds, isDone:isDone, countDone:countDone, idLabel:idLabel, qIds:qIds, qText:qText,
    name:name, who:who, trShort:trShort, hintList:hintList, SEQ:SEQ };
  /* היחידה קוראת api.state.checks וכו' — שומרים על הפניה חיה */
  Object.defineProperty(api, 'state', { get:function(){ return state; } });

  /* ---------- אירועים ---------- */
  function updateLocks(fid){
    Array.prototype.forEach.call(document.querySelectorAll('details.lock[data-lock="'+fid+'"]'), function(lk){
      var locked=fv(fid).length<LOCK_MIN; lk.classList.toggle('locked',locked); if(locked) lk.open=false;
      lk.querySelector('summary').textContent=lockText(locked);
    });
  }
  function keepOpenRender(){
    var keep=[]; Array.prototype.forEach.call($('stages').querySelectorAll('details.stage[open]'), function(d){ keep.push(d.id); });
    renderStages(); keep.forEach(function(id){ var d=$(id); if(d) d.open=true; });
  }
  /* ---------- שמירה בגיליון ---------- */
  function plain(s){ return String(s||'').replace(/<[^>]+>/g,'').replace(/`/g,''); }
  function stageText(tr){ var c=currentIndex(tr); if(c<0) return '🏁 סיימה'; var x=SEQ[c]; return x.gate ? '✋ '+plain(x.t) : 'שלב '+x.num+': '+plain(x.t); }
  function summary(){ var p={}, s={}; TR.forEach(function(t){ p[t]=pct(t); s[t]=stageText(t); });
    /* status: אותו טקסט שהתלמידה מעתיקה למורה (בזוג: של שתיהן). הגיליון שומר אותו, והמורה רואה אותו בלוח */
    var st=''; try{ st=String(U.buildStatus(api)||''); }catch(e){}
    return { pct:p, stage:s, stuck:state.open, status:st }; }
  var SYNC_MSG = { loading:'⏳ טוען את מה שנשמר…', pending:'✏️ נשמר במכשיר…', saving:'⏳ שומר אצל המורה…', saved:'☁️ נשמר אצל המורה',
    offline:'📴 אין חיבור. נשמר במכשיר, ויישלח כשהרשת תחזור',
    badkey:T('⚠️ הקישור לא תקין. בקשי מהמורה את הקישור האישי שלך','⚠️ הקישור לא תקין. בקשו מהמורה את הקישור האישי שלכן') };
  function syncState(s){ var el=$('syncState'); if(!el) return; el.textContent=SYNC_MSG[s]||''; el.dataset.s=s; }
  /* הגיע חדש מהגיליון (בת הזוג או המורה): מציירים מחדש בלי לאבד פוקוס, גלילה ומה שפתוח */
  function onRemote(){
    var a=document.activeElement, aid=a&&a.id, s0, s1;
    try{ s0=a.selectionStart; s1=a.selectionEnd; }catch(e){}
    try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
    TR.forEach(function(t){ var el=$('name-'+t); if(el!==a) el.value=state.names[t]; });
    var oq=$('openq'); if(oq!==a) oq.value=state.open;
    var y=window.scrollY, st=$('stages'), open=[];
    Array.prototype.forEach.call(st.querySelectorAll('details[open]'), function(d){
      open.push(d.id ? '#'+d.id : d.dataset.q ? 'details.q[data-q="'+d.dataset.q+'"]' : d.dataset.hint ? 'details[data-hint="'+d.dataset.hint+'"]' : null); });
    var inside=st.contains(a);
    renderStages();
    Array.prototype.forEach.call(st.querySelectorAll('details[open]'), function(d){ d.open=false; });
    open.forEach(function(q){ var d=q && st.querySelector(q); if(d) d.open=true; });
    if(inside && aid){ var el=$(aid); if(el){ el.focus({preventScroll:true}); try{ el.setSelectionRange(s0,s1); }catch(e){} } }
    window.scrollTo(0, y);
    refresh();
  }

  function init(){
    if(window.MasaSync) sync = window.MasaSync.start({ id:U.id, gates:SEQ.filter(function(x){ return x.gate; }).map(function(x){ return x.id; }),
      get:function(){ return state; }, summary:summary, onRemote:onRemote, onState:syncState });
    if(sync){
      $('footNote').textContent = T('☁️ מה שכתבת נשמר אצל המורה. אפשר להמשיך מכל מכשיר, דרך אותו קישור אישי.',
        '☁️ מה שכתבתן נשמר אצל המורה. כל אחת יכולה לעבוד מהמכשיר שלה, דרך אותו קישור אישי, וכל מה שנכתב מגיע לשתיכן.');
      $('resetBtn').hidden = true;
    } else if($('syncState')) $('syncState').hidden = true;
    buildShell();
    renderStages();
    TR.forEach(function(t){ var el=$('name-'+t); el.value=state.names[t];
      el.addEventListener('input', function(){ state.names[t]=el.value; save(); refresh(); }); });
    var oq=$('openq'); oq.value=state.open;
    oq.addEventListener('input', function(){ state.open=oq.value; save(); refresh(); });
    if(U.pair) $('tracks').addEventListener('click', function(e){
      var b=e.target.closest('button[data-track]'); if(!b) return;
      state.track=b.dataset.track; save();
      Array.prototype.forEach.call($('tracks').querySelectorAll('button'), function(x){ x.setAttribute('aria-pressed', x===b); });
      lastCur=null; keepOpenRender(); refresh();
    });
    var stages=$('stages');
    var doneBefore={};
    function celebrate(){
      /* הודעת הסיום מופיעה כשהכול הושלם, גם אם השלב האחרון שנסגר אינו השלב האחרון ברשימה */
      var fresh=null, every=true;
      SEQ.forEach(function(x){ if(x.gate) return; var ids=seqIds(x), all=countDone(ids)===ids.length;
        if(all && !doneBefore[x.id]) fresh=x; if(!all) every=false;
        doneBefore[x.id]=all; });
      if(fresh) toast(every?T('🏁 סיימת את כל המסלול! בהצלחה בהצגה','🏁 סיימתן את כל המסלול! בהצלחה בהצגה'):'🎉 שלב '+fresh.num+' הושלם!');
    }
    SEQ.forEach(function(x){ if(!x.gate){ var ids=seqIds(x); doneBefore[x.id]=countDone(ids)===ids.length; } });
    stages.addEventListener('change', function(e){
      var t=e.target;
      if(t.matches('input[type=radio][data-f]')){ state.f[t.dataset.f]=t.value; save(); keepOpenRender(); refresh(); return; }
      if(t.matches('input[type=checkbox][data-id]')){
        if(t.checked) state.checks[t.dataset.id]=true; else delete state.checks[t.dataset.id];
        t.closest('.check').classList.toggle('on', t.checked);
        save(); refresh();
        if(t.checked){
          if(/^g\d$/.test(t.dataset.id)){ toast('✋ אושר! ממשיכים'); celebrate(); return; }
          var m=t.dataset.id.match(/^([ab])-q(\d)-/);
          if(m){ var ids=qIds(m[1], +m[2]); if(countDone(ids)===ids.length){ toast('🎉 דשבורד '+m[2]+' מוכן!'); celebrate(); return; } }
          celebrate();
        }
      }
    });
    stages.addEventListener('input', function(e){
      var t=e.target;
      if(t.dataset && t.dataset.f && t.type!=='radio'){ state.f[t.dataset.f]=t.value; save(); updateLocks(t.dataset.f); refresh(); celebrate(); return; }
      if(t.dataset && t.dataset.rw){
        state.rw[t.dataset.rw]=t.value; save();
        var box=t.closest('.q'), k=t.dataset.rw; if(box) box.querySelector('.qtx').textContent=qText(k[0], +k.slice(1));
        refresh();
      }
    });
    stages.addEventListener('click', function(e){
      var nx=e.target.closest && e.target.closest('button.qnext');
      if(nx){ var nq=document.querySelector('details.q[data-q="'+nx.dataset.next+'"]'); if(!nq) return;
        nq.open=true; nq.scrollIntoView({block:'start'}); nq.querySelector('summary').focus(); return; }
      var sm=e.target.closest && e.target.closest('details.lock > summary');
      if(!sm) return;
      var lk=sm.parentNode;
      if(lk.classList.contains('locked')){
        e.preventDefault();
        var ta=$('f-'+lk.dataset.lock); if(ta) ta.focus();
        toast(T('✏️ קודם כתבי ניסיון משלך, ואז ייפתח הרמז','✏️ קודם כתבו ניסיון משלכן, ואז ייפתח הרמז'));
      }
    });
    stages.addEventListener('toggle', function(e){
      var d=e.target, h=state.hints[state.track];
      /* שאלה אחת בכל פעם */
      if(d.open && d.classList && d.classList.contains('q')){
        Array.prototype.forEach.call(stages.querySelectorAll('details.q[open]'), function(o){ if(o!==d) o.open=false; }); return; }
      if(!d.open || !d.dataset || !d.dataset.hint || d.classList.contains('locked')) return;
      if(!h[d.dataset.hint]){ h[d.dataset.hint]=d.dataset.hlabel||d.dataset.hint; save(); refresh(); }
    }, true);
    $('copyTop').addEventListener('click', copyStatus);
    $('copyStatus').addEventListener('click', copyStatus);
    $('copyPrompt').addEventListener('click', function(){ copy(U.buildPrompt(api, state.track), T('✅ הפרומפט הועתק. הדביקי בג׳מיני','✅ הפרומפט הועתק. הדביקו בג׳מיני')); });
    $('goNow').addEventListener('click', function(){ var cur=currentIndex(); if(cur>=0){ var el=$(SEQ[cur].id); if(el.tagName==='DETAILS') el.open=true; } });
    $('resetBtn').addEventListener('click', function(){
      if(confirm(T('למחוק את כל הסימונים, ההחלטות וכל מה שכתבת במכשיר הזה?','למחוק את כל הסימונים, ההחלטות וכל מה שכתבתן במכשיר הזה?'))){
        state=blank(); save(); lastCur=null;
        TR.forEach(function(t){ $('name-'+t).value=''; }); oq.value=''; renderStages(); refresh(); toast('🧹 הכול אופס');
      }
    });
    refresh();
    watchEmoji();
  }
  init();
})();
