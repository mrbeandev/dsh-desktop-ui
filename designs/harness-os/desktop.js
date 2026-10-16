'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const apps = [
  {id:'sessions',name:'Sessions',description:'Pick up a thought. Start a new one.',icon:'chat'},
  {id:'agents',name:'Agent activity',description:'A little team, working alongside you.',icon:'agent'},
  {id:'files',name:'Workspace files',description:'Everything you are bringing to life.',icon:'folder'},
  {id:'terminal',name:'Terminal',description:'A safe, simulated command line.',icon:'terminal'},
  {id:'settings',name:'Settings',description:'Make yourself at home.',icon:'settings'}
];
let topZ = 10, toastTimer, paletteIndex = 0, agentBusy = false;
const initialMessages = $('#messages').innerHTML;
const conversations = new Map([['A desktop for ideas', initialMessages]]);
let currentSession = 'A desktop for ideas';
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3200);}
function savePreference(key,value){try{localStorage.setItem('harness-os-demo:'+key,value);}catch{}}
function getPreference(key){try{return localStorage.getItem('harness-os-demo:'+key);}catch{return null;}}
function setMood(mood){if(!['grove','dusk','clay'].includes(mood)) mood='grove';document.body.dataset.mood=mood;$$('[data-theme]').forEach(b=>b.classList.toggle('selected',b.dataset.theme===mood));savePreference('mood',mood);}
setMood(getPreference('mood')||'grove');
function focusWindow(win){win.style.zIndex=++topZ;}
function openApp(id){const win=$('#window-'+id);if(!win)return;win.hidden=false;if(id==='agents')win.classList.add('mobile-open');focusWindow(win);$$('.dock [data-app="'+id+'"]').forEach(b=>b.classList.add('running'));if(id==='terminal')$('#terminal-input').focus();}
function hideWindow(win){win.hidden=true;$$('.dock [data-app="'+win.id.replace('window-','')+'"]').forEach(b=>b.classList.remove('running'));}
$$('.app-window').forEach(win=>{
  win.addEventListener('pointerdown',()=>focusWindow(win));
  const bar=$('.window-titlebar',win);
  bar.addEventListener('dblclick',e=>{if(!e.target.closest('button'))win.classList.toggle('is-maximized');});
  bar.addEventListener('pointerdown',e=>{
    if(e.target.closest('button')||win.classList.contains('is-maximized')||e.button!==0)return;
    const rect=win.getBoundingClientRect(),parent=$('#desktop').getBoundingClientRect();
    const startX=e.clientX,startY=e.clientY,startLeft=rect.left-parent.left,startTop=rect.top-parent.top;
    bar.setPointerCapture(e.pointerId);
    function move(ev){win.style.right='auto';win.style.left=Math.max(0,Math.min(parent.width-80,startLeft+ev.clientX-startX))+'px';win.style.top=Math.max(0,Math.min(parent.height-100,startTop+ev.clientY-startY))+'px';}
    function end(){bar.removeEventListener('pointermove',move);bar.removeEventListener('pointerup',end);bar.removeEventListener('pointercancel',end);}
    bar.addEventListener('pointermove',move);bar.addEventListener('pointerup',end);bar.addEventListener('pointercancel',end);
  });
});
function switchSession(name){conversations.set(currentSession,$('#messages').innerHTML);currentSession=name;$('#session-title').textContent=name;$('#messages').innerHTML=conversations.get(name)||'';$$('.session-item').forEach(b=>b.classList.toggle('selected',b.dataset.session===name));if(!$('#messages').children.length){const welcome=document.createElement('p');welcome.className='muted';welcome.textContent='A fresh page. What would you like to make?';$('#messages').append(welcome);}openApp('sessions');}
let sessionNumber=1;
function newSession(){const name='Untitled idea '+sessionNumber++;const button=document.createElement('button');button.className='session-item';button.dataset.session=name;const dot=document.createElement('span');dot.className='session-dot';const label=document.createElement('span');label.textContent=name;const small=document.createElement('small');small.textContent='Just now · new session';label.append(small);button.append(dot,label);$('.sidebar-heading').after(button);switchSession(name);$('#prompt').focus();toast('A fresh little space, just for you.');}
function runAgent(){if(agentBusy){toast('Builder is already working on a demo task.');return;}agentBusy=true;openApp('agents');$('#builder-state').textContent='Sketching a small possibility…';$('#task-count').textContent='01';$('#pulse-value').textContent='BUILDING';$('.status-orb.idle').style.background='#94b47b';toast('Demo task started. No tools or models are called.');setTimeout(()=>{agentBusy=false;$('#builder-state').textContent='Demo sketch complete. Ready again.';$('#task-count').textContent='00';$('#pulse-value').textContent='ALL CLEAR';$('.status-orb.idle').style.background='';toast('Builder finished its simulated task. Nice teamwork.');},5000);}
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.app)openApp(b.dataset.app);
 if(b.dataset.session)switchSession(b.dataset.session);
 if(b.dataset.theme)setMood(b.dataset.theme);
 if(b.dataset.windowAction){const win=b.closest('.app-window');if(b.dataset.windowAction==='maximize')win.classList.toggle('is-maximized');else hideWindow(win);}
 const action=b.dataset.action;
 if(action==='launcher')openLauncher();
 if(action==='new-session')newSession();
 if(action==='workspace')toast('Personal workspace · Demo only. Your real workspaces are untouched.');
 if(action==='model'){const label=$('#model-label');label.textContent=label.textContent==='DeepSeek V3.2'?'GPT · demo mode':'DeepSeek V3.2';toast('Model label changed. This prototype does not make API calls.');}
 if(action==='run-agent')runAgent();
 if(b.dataset.file){const descriptions={'index.html':'<!-- Harness OS: the desktop shell -->\nWindows, conversations, app launcher, and inline landscape SVG.\nSemantic HTML. No framework or build step.','desktop.css':':root { --paper: #f8f8f2; --accent: #cce9ad; }\nWarm ivory windows. Mineral greens. A little breathing room.\nResponsive layouts, focus states, and reduced-motion support.','desktop.js':'// A little life for a static desktop.\nWindow dragging · app launching · mock sessions · theme memory\nSimulated terminal only. No shell or provider access.'};$('#file-preview').textContent=descriptions[b.dataset.file];}
});
function appendMessage(text,kind){const node=document.createElement('div');if(kind==='user'){node.className='user-message';node.textContent=text;}else{node.className='assistant-message';const sig=document.createElement('div');sig.className='assistant-signature';const bold=document.createElement('b');bold.textContent='Harness';const label=document.createElement('span');label.textContent='Simulated response';sig.append(bold,label);const body=document.createElement('div');body.className='assistant-body';const p=document.createElement('p');p.textContent=text;body.append(p);node.append(sig,body);}$('#messages').append(node);$('#messages').scrollTop=$('#messages').scrollHeight;}
$('#chat-form').addEventListener('submit',e=>{e.preventDefault();const input=$('#prompt'),text=input.value.trim();if(!text)return;appendMessage(text,'user');input.value='';const reply=/agent|team|build/i.test(text)?'Let’s give Builder a little room to work. Open Agent activity and start a demo task to see how background work could feel in Harness OS.':/file|code|project/i.test(text)?'Your workspace files are one click away in the dock. In a connected version, this is where code, diffs, and artifacts would live together.':'That sounds like the start of something good. This is a local design demo, so I’m not calling a model—but imagine this thought becoming a session, a plan, and a little team of agents, all right here.';appendMessage(reply,'assistant');conversations.set(currentSession,$('#messages').innerHTML);});
$('#prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}});
const launcher=$('#launcher');
function renderApps(){const query=$('#app-search').value.toLowerCase(),results=$('#launcher-results');results.replaceChildren();apps.filter(a=>(a.name+' '+a.description).toLowerCase().includes(query)).forEach(a=>{const b=document.createElement('button');b.className='palette-result';b.innerHTML='<svg><use href="#i-'+a.icon+'"/></svg><span><b>'+a.name+'</b><small>'+a.description+'</small></span><span>↵</span>';b.addEventListener('click',()=>{launcher.close();openApp(a.id);});results.append(b);});if(!results.children.length){const p=document.createElement('p');p.className='muted';p.style.padding='10px 20px';p.textContent='No apps found. Try “files” or “sessions”.';results.append(p);}paletteIndex=0;highlightResult();}
function highlightResult(){const items=$$('.palette-result');items.forEach((b,i)=>b.classList.toggle('highlighted',i===paletteIndex));}
function openLauncher(){if(!launcher.open)launcher.showModal();$('#app-search').value='';renderApps();$('#app-search').focus();}
$('#app-search').addEventListener('input',renderApps);
$('#app-search').addEventListener('keydown',e=>{const items=$$('.palette-result');if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(items.length)paletteIndex=(paletteIndex+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;highlightResult();}if(e.key==='Enter'){e.preventDefault();items[paletteIndex]?.click();}});
$('.palette-top').addEventListener('submit',e=>{if(e.submitter){return;}e.preventDefault();});
launcher.addEventListener('click',e=>{if(e.target===launcher){const r=launcher.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)launcher.close();}});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(launcher.open)launcher.close();else openLauncher();}});
$('#quiet-mode').addEventListener('change',e=>{document.body.classList.toggle('quiet',e.target.checked);savePreference('quiet',String(e.target.checked));});
$('#quiet-mode').checked=getPreference('quiet')==='true';document.body.classList.toggle('quiet',$('#quiet-mode').checked);
$('#terminal-form').addEventListener('submit',e=>{e.preventDefault();const input=$('#terminal-input'),command=input.value.trim();input.value='';if(!command)return;const output=$('#terminal-output');if(command==='clear'){output.replaceChildren();return;}const line=document.createElement('p');line.textContent='❯ '+command;output.append(line);const commands={help:'Available demo commands:\n  help       Show this list\n  ls         List mock workspace files\n  pwd        Show mock workspace path\n  status     Show simulated system status\n  whoami     A friendly introduction\n  clear      Clear this terminal\n  open files Open the Files app',ls:'index.html    desktop.css    desktop.js',pwd:'~/workspaces/dsh-desktop-ui',status:'Harness OS · preview 0.1\n2 demo agents · 12 mock tools · no runtime connected',whoami:'A curious human, making something good.','open files':'Opening workspace files…'};const response=document.createElement('p');response.textContent=commands[command]||'Not a demo command: '+command+'\nTry help. This terminal never executes system commands.';output.append(response);if(command==='open files')openApp('files');$('.terminal-content').scrollTop=$('.terminal-content').scrollHeight;});
function updateClock(){const now=new Date();$('#clock').textContent=now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+' · '+now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});}
updateClock();setInterval(updateClock,30000);
