const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({ headless:true, channel:'msedge' });
 const results=[];
 try {
 for (const [width,height,scale] of [[1000,700,1],[1280,720,1.25],[1380,900,1.5],[800,560,1.5]]) {
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:scale});
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const make=(id,parent,name,size,isDir=false)=>({id,parent,name,path:'D:\\样本\\'+name,isDir,logicalSize:size,diskSize:size,unknown:0,errors:0,skipped:0,modified:null,state:'ok',message:null,complete:true,childCount:0});
   const nodes=[make(0,null,'样本',80010,true),make(1,0,'大目录',60000,true),make(2,0,'文件.txt',20000),make(3,1,'子文件.txt',40000),make(4,1,'另一个文件.txt',20000),make(5,0,'小目录',1000,true),make(6,5,'tiny.txt',1000),...Array.from({length:110},(_,i)=>make(10+i,0,'长中文文件名-'.repeat(8)+i+'.txt',1))];
   nodes.forEach(n=>{n.childCount=nodes.filter(x=>x.parent===n.id).length});
   window.__nodes=nodes;window.__calls=[];window.__revision=1;window.__delay=0;window.__scanId=1;window.__phase='completed';window.__message=null;
   window.__progress=()=>({phase:window.__phase,files:114,directories:2,logicalSize:80120,diskSize:80120,errors:0,skipped:0,unknown:0,revision:window.__revision,elapsedMs:50,message:window.__message});
   window.isTauri=true;window.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(cmd,args={})=>{
    window.__calls.push({cmd,args:JSON.parse(JSON.stringify(args))});
    if(cmd==='list_drives')return ['C:\\','D:\\'];
    if(cmd==='start_scan'){window.__channel=args.onProgress;args.onProgress.onmessage(window.__progress());return window.__scanId++;}
    if(cmd==='get_progress')return window.__progress();
    if(cmd==='control_scan'){window.__phase={pause:'paused',resume:'scanning',cancel:'cancelled'}[args.action];window.__revision++;return window.__progress();}
    if(cmd==='get_children'){
     const q=args.query;let items=nodes.filter(n=>n.parent===q.nodeId); if(q.pattern)items=items.filter(n=>n.name.includes(q.pattern));
     const directory=nodes.find(n=>n.id===q.nodeId); const breadcrumbs=[];let n=directory;while(n){breadcrumbs.unshift(n);n=nodes.find(p=>p.id===n.parent)}
     return {directory,breadcrumbs,items:items.slice(q.offset,q.offset+100),total:items.length,revision:window.__revision};
    }
    if(cmd==='get_view'){
     const delay=window.__delay;
     const branch=id=>({directory:nodes.find(n=>n.id===id),items:nodes.filter(n=>n.parent===id),truncated:false,omittedLogicalSize:0,omittedDiskSize:0});
     const value={...branch(args.nodeId),branches:args.expanded.map(branch),revision:window.__revision};
     if(delay)await new Promise(r=>setTimeout(r,delay));
     return value;
    }
    if(cmd==='open_with'||cmd==='show_in_explorer')return null;
    throw new Error(cmd);
   }};
  });
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('button',{name:'开始扫描'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===100);
  await page.waitForTimeout(400);
  await page.getByRole('button',{name:'视图设置'}).click();
  const matrixToggle=page.locator('.view-popover label').filter({hasText:'空间矩阵'}).locator('input');
  assert.equal(await matrixToggle.isChecked(),true,'matrix remains enabled');
  assert.equal(await matrixToggle.isDisabled(),true,'matrix cannot be hidden');
  await page.getByRole('button',{name:'浅色',exact:true}).click();
  assert.equal(await page.locator('.app-shell').getAttribute('data-theme'),'light','light theme applies');
  await page.getByRole('button',{name:'深色',exact:true}).click();
  assert.equal(await page.locator('.app-shell').getAttribute('data-theme'),'dark','dark theme restores');
  await page.getByRole('button',{name:'视图设置'}).click();
  async function checkLayout(only){
   return page.evaluate(only=>{
    const overflow=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return s.display!=='none'&&['auto','scroll'].some(v=>s.overflowY===v||s.overflowX===v)&&(e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)}).map(e=>e.className);
    const root=document.documentElement;const controls=[...document.querySelectorAll('.scan-bar button,.explorer-toolbar button,.list-toolbar input,.list-footer button')].filter(e=>e.getClientRects().length).map(e=>{const b=e.getBoundingClientRect();return {text:e.textContent||e.getAttribute('aria-label'),visible:b.left>=0&&b.right<=innerWidth+1&&b.top>=0&&b.bottom<=innerHeight+1}});
    return {overflow,rootFit:root.scrollWidth===root.clientWidth&&root.scrollHeight===root.clientHeight,controls,hidden:only?[...document.querySelectorAll('.normal-only')].every(e=>getComputedStyle(e).display==='none'):true};
   },only);
  }
  const normal=await checkLayout(false); assert.deepEqual(normal.overflow,['table-wrap']);assert.ok(normal.rootFit);assert.ok(normal.controls.every(c=>c.visible),JSON.stringify(normal.controls));
  async function point(id){return page.evaluate(async id=>{const {layout}=await import('/src/treemap.ts');const call=window.__calls.filter(c=>c.cmd==='get_view').at(-1);const b=document.querySelector('canvas').getBoundingClientRect();const rects=layout(window.__nodes.filter(n=>n.parent===call.args.nodeId),b.width,b.height,'disk',new Map(call.args.expanded.map(id=>[id,window.__nodes.filter(n=>n.parent===id)])));const r=rects.find(r=>r.node.id===id);return {x:b.x+r.x+Math.min(20,r.width/2),y:b.y+r.y+Math.min(12,r.height/2),width:r.width,height:r.height};},id)}
  let p=await point(1);await page.mouse.click(p.x,p.y);await page.waitForFunction(()=>window.__calls.some(c=>c.cmd==='get_view'&&c.args.expanded.includes(1)));await page.waitForTimeout(400);
  assert.equal(await page.locator('.breadcrumbs button').count(),2,'directory content follows the expanded matrix directory');
  assert.equal(await page.locator('tbody tr').count(),2,'directory list refreshes for the clicked matrix directory');
  p=await point(3);await page.mouse.click(p.x,p.y,{button:'right'});await page.getByRole('menuitem',{name:'打开方式…'}).click();assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.cmd==='open_with').at(-1).args.nodeId),3);
  await page.getByRole('button',{name:'仅矩阵',exact:true}).click();await page.waitForTimeout(350);const only=await checkLayout(true);assert.deepEqual(only.overflow,[]);assert.ok(only.hidden&&only.rootFit);assert.equal(await page.locator('.list-panel').isVisible(),false);
  p=await point(3);await page.mouse.click(p.x,p.y,{button:'right'});await page.keyboard.press('Escape');assert.equal(await page.locator('.map-only').count(),1,'Escape closes menu before exiting mode');await page.keyboard.press('Escape');assert.equal(await page.locator('.map-only').count(),0);
  await page.getByRole('button',{name:'切换模式',exact:true}).click();await page.waitForTimeout(400);p=await point(1);await page.mouse.dblclick(p.x,p.y);await page.waitForTimeout(500);assert.equal(await page.locator('.breadcrumbs button').count(),2,'double click only navigates once');
  const row=page.locator('tbody tr').filter({hasText:'子文件.txt'});await row.locator('button').focus();await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'在资源管理器中显示'}).click();assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.cmd==='show_in_explorer').at(-1).args.nodeId),3);
  await page.getByRole('button',{name:'回到扫描根目录'}).click();await page.getByRole('button',{name:'展开模式',exact:true}).click();await page.waitForTimeout(400);p=await point(5);assert.ok(p.width<160||p.height<100);await page.mouse.click(p.x,p.y);await page.waitForTimeout(400);assert.equal(await page.locator('.breadcrumbs button').last().textContent(),'小目录');
  if(width===1000){
   await page.getByRole('button',{name:'回到扫描根目录'}).click();await page.waitForTimeout(400);
   await page.evaluate(()=>{window.__delay=700});await page.getByRole('button',{name:'逻辑大小',exact:true}).click();
   await page.locator('tbody tr').filter({hasText:'大目录'}).locator('button').dblclick();
   await page.evaluate(()=>{window.__delay=0});await page.waitForTimeout(950);
   assert.equal(await page.locator('tbody tr').count(),2,'stale root response must not overwrite child directory');
   assert.equal(await page.locator('.breadcrumbs button').last().textContent(),'大目录');
   await page.getByRole('button',{name:'回到扫描根目录'}).click();await page.waitForTimeout(400);
   await page.evaluate(()=>{window.__message='长中文错误信息'.repeat(100)});await page.getByRole('button',{name:'磁盘占用',exact:true}).click();await page.waitForTimeout(400);
   assert.ok((await checkLayout(false)).rootFit);
   await page.evaluate(()=>{window.__message=null;window.__phase='scanning';window.__revision++;window.__channel.onmessage(window.__progress())});
   await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'继续',exact:true}).click();
   const before=await page.evaluate(()=>window.__calls.filter(c=>c.cmd==='get_view').length);
   await page.evaluate(()=>{window.__nodes.find(n=>n.id===1).diskSize=45000;window.__revision++});await page.waitForTimeout(750);
   assert.ok(await page.evaluate(before=>window.__calls.filter(c=>c.cmd==='get_view').length>before,before));
   await page.getByRole('button',{name:'取消',exact:true}).click();await page.waitForTimeout(400);
   assert.ok(await page.locator('.stats').textContent().then(t=>t.includes('已取消')));
  }
  assert.deepEqual(errors,[]);results.push({width,height,scale,normalScroll:normal.overflow,onlyScroll:only.overflow,interactions:'passed'});await context.close();
 }
 console.log(JSON.stringify(results,null,2));
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
