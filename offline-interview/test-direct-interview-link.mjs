import assert from 'node:assert/strict';
import {buildDirectInterviewLink,resolveDirectInterviewLink} from './direct-interview-link.js';
globalThis.atob ??= value=>Buffer.from(value,'base64').toString('binary');
globalThis.btoa ??= value=>Buffer.from(value,'binary').toString('base64');
const spec={schema:'offline-interview.interview-spec.v1',id:'x',version:'1.0',title:'T',context:'',objective:'O',language:'fr-FR',tags:[],participants:[{id:'P1',name:'A',role:'interviewer'}],sections:[{id:'S1',title:'S',questions:[{id:'Q1',text:'Ça va ?',intent:'I',required:true,audience:['P1'],followUps:[]}]}]};
const href=buildDirectInterviewLink('https://example.test/',spec,{view:'interview'});const u=new URL(href);const parsed=await resolveDirectInterviewLink(u);assert.deepEqual(parsed.raw,spec);assert.equal(parsed.view,'interview');
await assert.rejects(()=>resolveDirectInterviewLink(new URL('https://example.test/#oi=1&view=setup&url=http%3A%2F%2Finsecure.test%2Fx.json')),/HTTPS/);
await assert.rejects(()=>resolveDirectInterviewLink(new URL('https://example.test/#oi=1&view=setup&spec=***')),/invalide/);
console.log('PASS direct interview link v1');
