import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("chat picker closes on toggle, outside click, Escape and selection", async () => {
  const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const code=html.slice(html.indexOf("function closeChatPicker()"),html.indexOf("function applyTheme(theme)"));
  const element=()=>({hidden:true,disabled:false,textContent:"",value:"",children:[],attrs:{},
    setAttribute(key,value){this.attrs[key]=value;},replaceChildren(){this.children=[];},
    append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},
    focus(){this.focused=true;}});
  const nodes=Object.fromEntries(["browse","chats","chat-status","chat"].map(id=>[id,element()]));
  const listeners={};let calls=0;
  const context=vm.createContext({
    $:id=>nodes[id],selectedChatId:null,lastState:{agent:"none"},chatPickerGeneration:0,
    api:async()=>{calls++;return {chats:[{id:"999999999999999999",display_name:"Sample room",member_count:4}]};},
    saveConfig:async()=>{},tick:async()=>{},showError:()=>{},
    window:{matchMedia:()=>({matches:false})},
    document:{createElement:element,addEventListener:(event,handler)=>{listeners[event]=handler;}},
  });
  vm.runInContext(code,context);
  await nodes.browse.onclick();assert.equal(nodes.chats.hidden,false);assert.equal(nodes.browse.attrs["aria-expanded"],"true");
  await nodes.browse.onclick();assert.equal(nodes.chats.hidden,true);assert.equal(calls,1,"closing does not request chats again");
  assert.equal(nodes.browse.textContent,"Browse your chats ↗");assert.equal(nodes["chat-status"].textContent,"");
  await nodes.browse.onclick();listeners.click({target:{closest:()=>({})}});assert.equal(nodes.chats.hidden,false);
  listeners.click({target:{closest:()=>null}});assert.equal(nodes.chats.hidden,true);
  await nodes.browse.onclick();listeners.keydown({key:"Escape"});assert.equal(nodes.chats.hidden,true);assert.equal(nodes.browse.focused,true);
  await nodes.browse.onclick();await nodes.chats.children[0].onclick();
  assert.equal(nodes.chats.hidden,true);assert.equal(nodes.chat.value,"Sample room");assert.equal(context.selectedChatId,"999999999999999999");
  let visibleError;
  context.api=async()=>{throw Error("Reader timed out");};
  context.showError=message=>{visibleError=message;};
  await nodes.browse.onclick();
  assert.equal(visibleError,"Reader timed out");
  assert.equal(context.chatPickerError,"Reader timed out");
  assert.equal(nodes.browse.disabled,false);
  assert.equal(nodes.browse.textContent,"Browse your chats ↗");
});

test("picker shows English labels without changing the original room selection", async () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const code = html.slice(html.indexOf("function closeChatPicker()"), html.indexOf("function applyTheme(theme)"));
  const element = () => ({ hidden: true, children: [], textContent: "", value: "",
    setAttribute() {}, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); } });
  const nodes = Object.fromEntries(["browse", "chats", "chat-status", "chat"].map((id) => [id, element()]));
  let completeLabels;
  const requests = [];
  const context = vm.createContext({
    $: (id) => nodes[id], selectedChatId: null, lastState: { agent: "selected" }, chatPickerGeneration: 0,
    api: async (route, body) => {
      requests.push({ route, body });
      if (route === "/api/chats") return { chats: [{ id: "999999999999999999", display_name: "공부 모임", member_count: 4 }] };
      return new Promise((resolve) => { completeLabels = resolve; });
    },
    saveConfig: async () => {}, tick: async () => {}, showError: () => {},
    window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: element, addEventListener() {} },
  });
  vm.runInContext(code, context);
  await nodes.browse.onclick();
  const option = nodes.chats.children[0];
  assert.equal(option.children[0].textContent, "공부 모임", "original appears before translation completes");
  assert.equal(nodes.browse.disabled, false, "translation does not block the picker");
  assert.equal(requests[1].route, "/api/chat-names");
  assert.equal(requests[1].body.ids[0], "999999999999999999");
  completeLabels({ chats: [{ id: "999999999999999999", english_name: "Study Group" }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(option.children[0].textContent, "공부 모임 (Study Group)");
  await option.onclick();
  assert.equal(nodes.chat.value, "공부 모임");
  assert.equal(context.selectedChatId, "999999999999999999");
});
