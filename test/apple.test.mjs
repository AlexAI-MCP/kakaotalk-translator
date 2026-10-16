import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { appleSupport, appleReady } from "../lib/runtime.mjs";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Fictional helper honoring the kakao-apple-translate contract; an explicit path also works on Linux CI.
function fakeHelper(dir){
  const file=path.join(dir,"kakao-apple-translate");
  fs.writeFileSync(file,`#!${process.execPath}
if(process.argv[2]==="--check"){console.log(JSON.stringify({"ko-en":"installed","en-ko":"supported"}));process.exit(0);}
let data="";process.stdin.on("data",d=>data+=d).on("end",()=>{const req=JSON.parse(data);
if(req.source!=="ko"||req.target!=="en")process.exit(2);process.stdout.write(JSON.stringify(req.texts.map(t=>"EN:"+t)));});
`,{mode:0o755});
  return file;
}
async function startServer(args,env){
  const probe=net.createServer();probe.listen(0,"127.0.0.1");await once(probe,"listening");const port=probe.address().port;await new Promise(r=>probe.close(r));
  const clean={...process.env};for(const k of ["KAKAO_LIVE_CHAT","KAKAO_LIVE_AGENT","KAKAO_LIVE_TARGET"])delete clean[k];
  const child=spawn(process.execPath,["server.mjs",...args,"--no-open"],{cwd:root,env:{...clean,KAKAO_LIVE_PORT:String(port),...env},stdio:["ignore","ignore","ignore"]});
  const base="http://127.0.0.1:"+port;
  for(let i=0;i<60;i++){try{if((await fetch(base+"/api/state")).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const post=(route,data)=>fetch(base+route,{method:"POST",headers:{"X-Kakao-Live":"1","Content-Type":"application/json"},body:JSON.stringify(data)});
  const stop=async()=>{const exited=once(child,"exit");child.kill("SIGTERM");await Promise.race([exited,new Promise(r=>setTimeout(r,2500))]);if(child.exitCode===null)child.kill("SIGKILL");};
  return {base,post,stop};
}

test("Apple helper check maps language pairs to target directions",() => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"kakao-apple-"));
  try {
    const support=appleSupport(fakeHelper(dir));
    assert.deepEqual(support,{installed:true,pairs:{"ko-en":"installed","en-ko":"supported"}});
    assert.equal(appleReady(support,"en"),true);assert.equal(appleReady(support,"ko"),false);
    assert.equal(appleSupport(null).installed,false);assert.equal(appleReady(appleSupport(null),"en"),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test("live config accepts Apple only for installed language directions",async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"kakao-apple-"));
  const settings=path.join(dir,"settings.json");
  const s=await startServer([],{KAKAO_LIVE_APPLE_TRANSLATE:fakeHelper(dir),KAKAO_LIVE_SETTINGS_PATH:settings});
  try {
    const initial=await(await fetch(s.base+"/api/state")).json();
    assert.equal(initial.available.apple,true);assert.equal(initial.available.appleKoEn,true);assert.equal(initial.available.appleEnKo,false);
    const ok=await s.post("/api/config",{agent:"apple",target:"en"});assert.equal(ok.status,200);assert.equal((await ok.json()).agent,"apple");
    assert.equal(JSON.parse(fs.readFileSync(settings,"utf8")).agent,"apple");
    const ko=await s.post("/api/config",{agent:"apple",target:"ko"});assert.equal(ko.status,400);assert.match((await ko.json()).error,/Translation Languages/);
    const target=await s.post("/api/config",{target:"ko"});assert.equal(target.status,400,"agent stays apple, so the target change is rejected");
    const after=await(await fetch(s.base+"/api/state")).json();assert.equal(after.agent,"apple");assert.equal(after.target,"en");
  } finally { await s.stop();fs.rmSync(dir,{recursive:true,force:true}); }
});
test("missing Apple helper is rejected with setup guidance",async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"kakao-apple-"));
  const s=await startServer(["--demo"],{KAKAO_LIVE_APPLE_TRANSLATE:path.join(dir,"missing")});
  try {
    assert.equal((await(await fetch(s.base+"/api/state")).json()).available.apple,false);
    const r=await s.post("/api/config",{agent:"apple"});assert.equal(r.status,400);assert.match((await r.json()).error,/npm run setup:apple/);
  } finally { await s.stop();fs.rmSync(dir,{recursive:true,force:true}); }
});
test("demo messages translate through the Apple helper contract",async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"kakao-apple-"));
  const s=await startServer(["--demo"],{KAKAO_LIVE_APPLE_TRANSLATE:fakeHelper(dir)});
  try {
    assert.equal((await s.post("/api/config",{agent:"apple",target:"en"})).status,200);
    assert.equal((await s.post("/api/start",{})).status,200);
    let data;
    for(let i=0;i<40;i++){data=await(await fetch(s.base+"/api/messages?after=0")).json();if(data.state.translationCounts.done)break;await new Promise(r=>setTimeout(r,100));}
    const done=data.messages.find(m=>m.tstate==="done");assert.ok(done);assert.equal(done.translation,"EN:"+done.text);assert.equal(data.state.lastError,null);
  } finally { await s.stop();fs.rmSync(dir,{recursive:true,force:true}); }
});
