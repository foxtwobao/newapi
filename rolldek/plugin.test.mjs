import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as plugin from './plugin.js';
function request(model, extra = {}) {
  const value = {model, prompt:'A scene', ...extra};
  const ctx = {model, baseUrl:'https://api.example', apiKey:'test-secret'};
  const decoded = plugin.protocols.openai_video.decodeRequest({...ctx,body:{kind:'json',value}});
  return {...ctx,requestBody:decoded.requestBody};
}
const media = (type,n) => Array.from({length:n},(_,i)=>({type,url:`https://media.example/${type}/${i}`}));
for (const model of plugin.meta.models) test(`${model}: defaults, stable normalization, identity and pricing`,()=>{
  const ctx=request(model);
  const again=plugin.protocols.openai_video.decodeRequest({...ctx,body:{kind:'json',value:ctx.requestBody}});
  assert.deepEqual(again.requestBody,ctx.requestBody);
  const upstream=plugin.buildSubmitRequest(ctx);
  assert.equal(upstream.url,'https://api.example/v1/videos');
  assert.equal(upstream.body.model,model);
  assert.deepEqual(plugin.extractUsage(ctx),model.startsWith('sd-')?{video_count:1}:{seconds:5,resolution:'1080P'});
  if(model.startsWith('sd-')) {
    assert.equal(upstream.body.duration,4);
    assert.equal(upstream.body.resolution,'720p');
    assert.deepEqual(plugin.extractUsageOnComplete(ctx,{status:'SUCCESS'},{}),{video_count:1});
  }
});
test('SD durations, aliases, extensions and billing bypasses',()=>{
  for(const model of plugin.meta.models.filter(x=>x.startsWith('sd-'))){
    const max=model==='sd-2.0-ch1'?15:30;
    assert.equal(plugin.buildSubmitRequest(request(model,{duration:max,seconds:String(max)})).body.duration,max);
    for(const extra of [{duration:0},{duration:false},{duration:null},{duration:'6'},{duration:4.5},{duration:-1},{duration:max+1},{duration:6,seconds:'5'},{size:'1920x1080'},{resolution:'720P',size:'1920x1080'},{ratio:'adaptive'},{metadata:{parameters:{audio:false}}},{metadata:{parameters:{seed:0}}},{metadata:{headers:{Authorization:'bad'}}}]) assert.throws(()=>request(model,extra),JSON.stringify(extra));
  }
});
test('SD media limits, ordering and frame pairs',()=>{
  for(const [model,images,videos,audios] of [['sd-2.0-ch1',9,3,3],['sd-2.5-ch1',30,10,10],['sd-2.5-ch2',10,10,10],['sd-2.5-ch3',9,0,0]]){
    const items=[...media('reference_image',images),...media('reference_video',videos),...media('reference_audio',audios)];
    const body=plugin.buildSubmitRequest(request(model,{metadata:{input:{media:items}}})).body;
    assert.deepEqual(body.image_refs,items.slice(0,images).map(x=>x.url));
    for(const [type,n] of [['reference_image',images],['reference_video',videos],['reference_audio',audios]]) assert.throws(()=>request(model,{metadata:{input:{media:media(type,n+1)}}}));
    assert.throws(()=>request(model,{metadata:{input:{media:media('first_frame',1)}}}));
    const frames=[...media('last_frame',1),...media('first_frame',1)];
    if(model==='sd-2.0-ch1')assert.throws(()=>request(model,{metadata:{input:{media:frames}}}));
    else {
      const b=plugin.buildSubmitRequest(request(model,{metadata:{input:{media:frames}}})).body;
      assert.equal(b.first_image,frames[1].url);assert.equal(b.last_image,frames[0].url);
      assert.throws(()=>request(model,{metadata:{input:{media:[...frames,...media('reference_image',1)]}}}));
    }
    assert.throws(()=>request(model,{metadata:{input:{media:[{type:'reference_image',url:'https://example.com/a',duration:1}]}}}));
  }
  assert.throws(()=>request('sd-2.5-ch3',{ratio:'3:2'}));
  assert.equal(plugin.buildSubmitRequest(request('sd-2.5-ch1',{ratio:'3:2'})).body.aspect_ratio,'3:2');
});
test('WAN reserve and measured usage stay unchanged',()=>{
  const ctx=request('wan3.0-video',{duration:6,metadata:{input:{media:[...media('reference_video',1),...media('reference_video',1)]}}});
  assert.equal(plugin.extractUsage(ctx).seconds,36);
  assert.deepEqual(plugin.extractUsageOnComplete(ctx,{status:'SUCCESS'},{metadata:{usage:{output_video_duration:6,input_video_duration:3}}}),{seconds:9});
  assert.throws(()=>plugin.extractUsageOnComplete(ctx,{status:'SUCCESS'},{}));
  assert.throws(()=>plugin.extractUsageOnComplete(ctx,{status:'SUCCESS'},{usage:{duration:-1,input_video_duration:3}}));
  assert.throws(()=>request('wan3.0-video',{duration:'6'}));
});
test('query, content and public output do not expose raw provider data',()=>{
  const ctx=request('sd-2.5-ch1');
  assert.equal(plugin.buildQueryRequest({...ctx,taskId:'id/1'}).url,'https://api.example/v1/videos/id%2F1');
  assert.equal(plugin.parseTaskResult(ctx,{status:'completed'}).status,'SUCCESS');
  assert.equal(plugin.parseTaskResult(ctx,{status:'unexpected'}).status,'UNKNOWN');
  assert.deepEqual(plugin.protocols.openai_video.render({}, {data:{url:'https://evil.example',api_key:'secret'}}),{});
  const download=plugin.buildContentRequest({...ctx,artifactKey:'video',upstreamTaskId:'id/1',clientRequest:{method:'GET'},data:{url:'https://evil.example'}});
  assert.equal(download.url,'https://api.example/v1/videos/id%2F1/content');
  assert.equal(download.headers.Authorization,'Bearer test-secret');
});

test('legacy media normalization writes validated roles and rejects ambiguous sources',()=>{
  const content=[{type:'video_url',video_url:{url:'https://media.example/v'}},{type:'audio_url',audio_url:{url:'https://media.example/a'}}];
  const before=JSON.stringify(content);
  const ctx=request('sd-2.5-ch1',{metadata:{content}});
  const wire=plugin.buildSubmitRequest(ctx).body;
  assert.deepEqual(wire.video_refs,['https://media.example/v']);
  assert.deepEqual(wire.audio_refs,['https://media.example/a']);
  assert.equal(Object.hasOwn(wire,'undefined'),false);
  assert.equal(JSON.stringify(content),before);
  for(const extra of [
    {images:null},{image:null},{input_reference:null},
    {images:[],image:'https://media.example/a'},
    {image:'https://media.example/a',input_reference:'https://media.example/b'},
    {images:[],metadata:{input:{media:[]}}},
    {images:[],metadata:{content:[]}},
    {metadata:{content:[{...content[0],role:null}]}},
  ]) assert.throws(()=>request('sd-2.5-ch1',extra));
});

test('submission terminal states use immediate settlement, including missing content and usage',()=>{
  for(const model of ['wan3.0-video','sd-2.5-ch1']) {
    const ctx=request(model);
    for(const status of ['completed','succeeded','failed','cancelled','expired']) {
      const body={id:'upstream-id',status,...(['failed','cancelled','expired'].includes(status)?{error:{message:'generation rejected'}}:{})};
      const parsed=plugin.parseSubmitResponse(ctx,{body});
      assert.equal(parsed.immediate.status,['completed','succeeded'].includes(status)?'SUCCESS':'FAILURE');
      assert.equal(parsed.taskId,'upstream-id');
      if(parsed.immediate.status==='SUCCESS' && model==='wan3.0-video') {
        const task={...ctx,taskId:parsed.taskId,state:parsed.state};
        assert.throws(()=>plugin.extractUsageOnComplete(task,parsed.immediate,body),/missing/);
        assert.deepEqual(plugin.extractUsageOnComplete(task,parsed.immediate,{usage:{output_video_duration:5,input_video_duration:0}}),{seconds:5});
      }
    }
    for(const status of ['queued','processing','unknown']) assert.equal(plugin.parseSubmitResponse(ctx,{body:{id:'upstream-id',status}}).immediate,undefined);
    assert.throws(()=>plugin.parseSubmitResponse(ctx,{body:{id:123,status:'completed'}}),/task_id/);
    assert.throws(()=>plugin.parseSubmitResponse(ctx,{body:{id:'id',status:'completed',error:{message:'error'}}}),/error/);
  }
});

test("failed video queries preserve reasons and redact sensitive details", () => {
  const render = plugin.protocols.openai_video.render;
  for (const fields of [{error:{message:"参考视频超过 15 秒"}}, {error:"参考视频超过 15 秒"}, {error_message:"参考视频超过 15 秒"}, {message:"参考视频超过 15 秒"}, {fail_reason:"参考视频超过 15 秒"}]) {
    const data = {status:"failed", ...fields};
    const parsed = plugin.parseTaskResult({model:"wan3.0-video"}, data);
    assert.equal(parsed.reason, "参考视频超过 15 秒");
    assert.deepEqual(render({}, {status:"FAILURE", fail_reason:parsed.reason, data}), {error:{code:"generation_failed",message:"参考视频超过 15 秒"}});
    assert.equal(render({}, {status:"FAILURE", fail_reason:"task failed", data}).error.message, parsed.reason);
  }
  assert.equal(render({}, {status:"FAILURE",fail_reason:"Task timed out",data:{message:"queued"}}).error.message,"Task timed out");
  assert.equal(render({}, {status:"FAILURE",data:{error:{message:42},message:{nested:"bad"}}}).error.message,"Model service did not return a failure reason");
  for (const status of ["QUEUED","IN_PROGRESS","SUCCESS"]) assert.deepEqual(render({}, {status,data:{error:"stale error"}}),{});
  const data = {status:"failed",error:{message:'Rejected private-key-123 private-job-456 https://store.example/private?signature=secret Bearer abcdef api_key="quoted secret" token=hidden sk-test-secret'}};
  const parsed = plugin.parseTaskResult({apiKey:"private-key-123",taskId:"private-job-456"},data);
  const output = render({}, {status:"FAILURE",fail_reason:parsed.reason,data});
  assert.match(output.error.message,/Rejected/);
  for (const secret of ["private-key-123","private-job-456","store.example","abcdef","quoted secret","hidden","sk-test-secret"]) assert.ok(!JSON.stringify(output).includes(secret),secret);
  assert.ok(render({}, {status:"FAILURE",fail_reason:"x".repeat(3000)}).error.message.length<=2048);
});
