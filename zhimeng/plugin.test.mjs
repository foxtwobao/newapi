import assert from "node:assert/strict";
import test from "node:test";

import * as plugin from "./plugin.js";
const official = "sd2.5-官链-满参考-受排队影响";
const converted = "sd2.5-官转-30图10音频-火山词元";
const image = "https://h3.juheai.club/m/image-1";
const video = "https://h3.juheai.club/m/video-1";
const audio = "https://h3.juheai.club/m/audio-1";

function decode(model, body) {
  return plugin.protocols.openai_video.decodeRequest({ model, body: { kind: "json", value: { model, ...body } } });
}

function submit(model, body) {
  const intent = decode(model, body);
  assert.equal(intent.model, model);
  assert.deepEqual(decode(model, intent.requestBody), intent);
  const context = { model, requestBody: intent.requestBody, baseUrl: "https://movie.zmoapi.cn", apiKey: "test-key" };
  return { context, request: plugin.buildSubmitRequest(context) };
}

test("Seedance 2.0 accepts its documented nested requests and preserves HTTP media and voice references", () => {
  for (const model of ["sd-2-c4", "sd-2-c5"]) {
    const body = {
      model,
      input: { prompt: "  人物参考@1与音频1  ", media: [{ type: "reference_voice", url: "http://example.com/voice.mp3" }] },
      parameters: { duration: "15", resolution: "720p", ratio: "9:16" },
    };
    const before = JSON.stringify(body);
    const { context, request } = submit(model, body);
    assert.deepEqual(request.body, { ...body, parameters: { ...body.parameters, duration: 15 } });
    assert.equal(JSON.stringify(body), before);
    assert.deepEqual(plugin.extractUsage(context), { video_count: 1 });
    assert.deepEqual(plugin.extractUsage({ ...context, usagePurpose: "billing_ratios" }), {});
  }
  assert.throws(() => decode("sd-2-c4", { input: { prompt: "cat" }, parameters: {} }), /duration is required/);
  assert.throws(() => decode("sd-2-c4", { prompt: "cat", input: { prompt: "different" }, parameters: { duration: 5 } }), /do not mix/);
});

test("Seedance 2.0 public requests retain their defaults, media ordering and model-specific ratios", () => {
  const media = [
    { type: "last_frame", url: "http://example.com/last.jpg" },
    { type: "first_frame", url: image },
    { type: "reference_audio", url: audio },
  ];
  const { request } = submit("sd-2-c5", { prompt: "cat", metadata: { input: { media } } });
  assert.deepEqual(request.body, {
    model: "sd-2-c5",
    input: { prompt: "cat", media: [media[0], media[1], { type: "reference_voice", url: audio }] },
    parameters: { duration: 5, resolution: "720p", ratio: "16:9" },
  });
  submit("sd-2-c5", { prompt: "cat", duration: 4, ratio: "21:9" });
  assert.throws(() => decode("sd-2-c4", { prompt: "cat", ratio: "21:9" }), /ratio/);
  for (const duration of [3, 16, 4.5]) assert.throws(() => decode("sd-2-c5", { prompt: "cat", duration }), /duration/);
});

test("Seedance 2.5 publishes the exact Chinese model IDs and sends flat requests without inventing a duration", () => {
  assert.equal(plugin.meta.models.length, 13);
  for (const model of [official, converted]) {
    assert.ok(plugin.meta.models.includes(model));
    assert.equal(plugin.meta.usageProfiles.find((profile) => profile.models.includes(model)).schema.video_count.unit, "count");
    for (const duration of [4, 30]) {
      const { request } = submit(model, { model, prompt: "湖边晨雾", duration });
      assert.deepEqual(request.body, { model, prompt: "湖边晨雾", duration, ratio: "16:9", resolution: "720p" });
      assert.equal(request.url, "https://movie.zmoapi.cn/v1/videos");
    }
    for (const ratio of ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]) {
      const { request } = submit(model, { prompt: "cat", seconds: 20, aspect_ratio: ratio, resolution: "720p" });
      assert.equal(request.body.duration, 20);
      assert.equal(request.body.ratio, ratio);
    }
    assert.throws(() => decode(model, { prompt: "cat" }), /duration is required/);
    for (const duration of [3, 31, 4.5, -1, "5", null, true]) assert.throws(() => decode(model, { prompt: "cat", duration }), /duration/);
  }
});

test("Seedance 2.5 maps public media and documented reference arrays to the same upstream request", () => {
  for (const model of [official, converted]) {
    const wire = { model, prompt: "参考@1与@2", duration: 20, ratio: "21:9", resolution: "720p", reference_images: [image], reference_audios: [audio] };
    const media = [
      { type: "reference_image", url: image },
      { type: "reference_audio", url: audio },
    ];
    if (model === official) {
      wire.reference_videos = [video];
      media.splice(1, 0, { type: "reference_video", url: video });
    }
    const native = submit(model, wire).request;
    const canonical = submit(model, { prompt: wire.prompt, duration: 20, resolution: "720P", ratio: "21:9", metadata: { input: { media } } }).request;
    assert.deepEqual(native.body, wire);
    assert.deepEqual(canonical, native);
  }
  assert.throws(() => decode(converted, { prompt: "cat", duration: 5, reference_videos: [] }), /does not support/);
  assert.throws(() => decode(converted, { prompt: "cat", duration: 5, metadata: { input: { media: [{ type: "reference_video", url: video }] } } }), /too many/);
  assert.throws(() => decode(official, { prompt: "cat", duration: 5, reference_images: [image], metadata: { input: { media: [] } } }), /one media source/);
});

test("Seedance 2.5 enforces its per-type reference limits and retains image order", () => {
  const images = Array.from({ length: 30 }, (_, index) => "https://h3.juheai.club/m/image-" + index);
  const videos = Array.from({ length: 10 }, (_, index) => "https://h3.juheai.club/m/video-" + index);
  const audios = Array.from({ length: 10 }, (_, index) => "https://h3.juheai.club/m/audio-" + index);
  const { request, context } = submit(official, { prompt: "cat", duration: 30, reference_images: images, reference_videos: videos, reference_audios: audios });
  assert.deepEqual(request.body.reference_images, images);
  assert.deepEqual(request.body.reference_videos, videos);
  assert.deepEqual(request.body.reference_audios, audios);
  assert.deepEqual(plugin.extractUsage(context), { video_count: 1 });
  submit(converted, { prompt: "cat", duration: 30, reference_images: images, reference_audios: audios });
  for (const [key, urls] of [
    ["reference_images", [...images, image]],
    ["reference_videos", [...videos, video]],
    ["reference_audios", [...audios, audio]],
  ]) {
    assert.throws(() => decode(official, { prompt: "cat", duration: 30, [key]: urls }), /too many/);
  }
});

test("Seedance 2.5 rejects invalid H3 links, frame roles, conflicting aliases and unsupported controls before submission", () => {
  for (const url of [
    "http://h3.juheai.club/m/image",
    "https://other.example/m/image",
    "https://h3.juheai.club.evil.example/m/image",
    "https://h3.juheai.club/api/v1/media/image",
    "https://h3.juheai.club/m/image?token=secret",
    "https://h3.juheai.club/m/image#fragment",
    "data:image/png;base64,AA==",
    "./image.jpg",
  ]) {
    assert.throws(() => decode(official, { prompt: "cat", duration: 5, reference_images: [url] }), /H3 public_url/);
  }
  for (const fields of [
    { reference_images: image },
    { reference_audios: [null] },
    { resolution: "1080p" },
    { duration: 5, seconds: 6 },
    { ratio: "16:9", aspect_ratio: "9:16" },
    { prompt: " " },
    { prompt: "猫".repeat(7001) },
    { size: "1280x720" },
    { audio: false },
    { seed: 0 },
    { n: 2 },
    { stream: true },
    { input: { prompt: "cat" } },
    { parameters: { duration: 5 } },
    { metadata: { parameters: { duration: 31 } } },
    { metadata: { input: { media: [{ type: "first_frame", url: image }] } } },
  ])
    assert.throws(() => decode(official, { prompt: "cat", duration: 5, ...fields }));
  submit(official, { prompt: "猫".repeat(7000), duration: 5 });
});

test("Seedance reports one video per successful completion and preserves mapped client identities", () => {
  for (const model of ["sd-2-c4", "sd-2-c5", official, converted]) {
    const { context } = submit(model, { prompt: "cat", duration: model.startsWith("sd2.5") ? 30 : 15 });
    const submitted = plugin.parseSubmitResponse(context, { body: { task_id: "vendor-job", status: "queued" } });
    assert.equal(submitted.taskId, "vendor-job");
    const task = { model: "customer-model", upstreamModel: model, state: submitted.state };
    const result = plugin.parseTaskResult(task, { status: "completed", seconds: 1000, content: { url: image } });
    assert.equal(result.status, "SUCCESS");
    assert.deepEqual(plugin.extractUsageOnComplete(task, result, { seconds: 1000 }), { video_count: 1 });
    assert.deepEqual(plugin.extractUsageOnComplete(task, { status: "FAILURE" }, {}), {});
    assert.equal(plugin.parseTaskResult(task, { status: "completed" }).status, "SUCCESS");
    const intent = plugin.protocols.openai_video.decodeRequest({
      model: "customer-model",
      upstreamModel: model,
      body: { kind: "json", value: { prompt: "cat", duration: 5 } },
    });
    assert.equal(intent.model, "customer-model");
    assert.equal(plugin.buildSubmitRequest({ ...context, model: "customer-model", upstreamModel: model, requestBody: intent.requestBody }).body.model, model);
  }
});

test("Seedance 2.5 authenticates provider content downloads and never sends the video token to public result hosts", () => {
  const context = {
    model: official,
    artifactKey: "video",
    upstreamTaskId: "vendor-job",
    baseUrl: "https://movie.zmoapi.cn",
    apiKey: "test-key",
    clientRequest: { method: "GET" },
  };
  const contentURL = context.baseUrl + "/v1/videos/vendor-job/content";
  for (const method of ["GET", "HEAD"]) {
    const request = plugin.buildContentRequest({ ...context, clientRequest: { method }, data: { status: "completed", content: { url: contentURL } } });
    assert.deepEqual(request, { url: contentURL, method, headers: { Authorization: "Bearer test-key" } });
  }
  for (const url of [image, "https://cdn.example/result.mp4", "https://movie.zmoapi.cn.evil.example/v1/videos/vendor-job/content"]) {
    const request = plugin.buildContentRequest({ ...context, data: { status: "completed", content: { url } } });
    assert.deepEqual(request, { url, method: "GET", credentialless: true });
  }
});

const veoModels = [
  ["veo-3.1-lite", "720P", ["1280x720", "720x1280"], ["text0", "first_frame1", "first_last2"]],
  ["veo-3.1-fast", "720P", ["1280x720", "720x1280"], ["text0", "first_frame1", "first_last2", "reference3"]],
  ["veo-3.1", "720P", ["1280x720", "720x1280"], ["text0", "first_frame1", "first_last2"]],
  ["veo-3.1-fast-1080p", "1080P", ["1920x1080", "1080x1920"], ["text0"]],
  ["veo-3.1-1080p", "1080P", ["1920x1080", "1080x1920"], ["text0", "first_frame1", "first_last2"]],
  ["omni-flash-video", "720P", ["1280x720", "720x1280"], ["text0", "reference1", "reference2", "reference3"]],
];
const veoImages = ["https://tc.juheai.club/file/first.jpg", "https://tc.juheai.club/file/last.jpg", "https://tc.juheai.club/file/reference.jpg"];

test("Veo requires the documented exact size for each model without a default or size aliases", () => {
  for (const [model, resolution, sizes] of veoModels) {
    assert.ok(plugin.meta.models.includes(model));
    for (const size of sizes) {
      const body = { model, prompt: "cat", size };
      const { request, context } = submit(model, body);
      assert.deepEqual(request.body, body);
      assert.deepEqual(plugin.extractUsage(context), { video_count: 1, resolution });
      assert.deepEqual(plugin.extractUsage({ ...context, usagePurpose: "billing_ratios" }), {});
    }
    for (const size of [
      undefined,
      null,
      false,
      720,
      "",
      "720p",
      "1080P",
      "1280*720",
      "1280X720",
      " 1280x720 ",
      "960x960",
      ...(resolution === "720P" ? ["1920x1080", "1080x1920"] : ["1280x720", "720x1280"]),
    ]) {
      assert.throws(() => decode(model, { prompt: "cat", size }), /size/);
    }
  }
});

test("Veo preserves explicit modes and image order for the full documented model and count matrix", () => {
  const images = [...veoImages, veoImages[0]];
  for (const [model, resolution, sizes, supported] of veoModels) {
    for (const size of sizes) {
      for (const generation_mode of ["text", "first_frame", "first_last", "reference"]) {
        for (const count of [0, 1, 2, 3, 4]) {
          const body = { model, prompt: "cat", size, generation_mode, reference_images: images.slice(0, count) };
          if (!supported.includes(generation_mode + count)) {
            assert.throws(() => decode(model, body), undefined, model + "/" + generation_mode + count);
            continue;
          }
          const before = JSON.stringify(body);
          const { request, context } = submit(model, body);
          assert.deepEqual(request.body, body);
          assert.deepEqual(plugin.extractUsage(context), { video_count: 1, resolution });
          assert.equal(JSON.stringify(body), before);
        }
      }
    }
  }
});

test("Veo validates documented image-count defaults without inserting an omitted generation_mode", () => {
  for (const [model, validCounts] of [
    ["veo-3.1-lite", [0, 1]],
    ["veo-3.1-fast", [0, 1, 3]],
    ["veo-3.1", [0, 1]],
    ["veo-3.1-fast-1080p", [0]],
    ["veo-3.1-1080p", [0, 1]],
    ["omni-flash-video", [0, 2, 3]],
  ]) {
    const size = model.endsWith("1080p") ? "1920x1080" : "1280x720";
    for (const count of [0, 1, 2, 3]) {
      const body = { model, prompt: "cat", size, reference_images: veoImages.slice(0, count) };
      if (validCounts.includes(count)) assert.deepEqual(submit(model, body).request.body, body);
      else assert.throws(() => decode(model, body), undefined, model + "/implicit/" + count);
    }
    const body = { model, prompt: "cat", size };
    assert.deepEqual(submit(model, body).request.body, body);
    body.generation_mode = "text";
    assert.deepEqual(submit(model, body).request.body, body);
  }
});

test("Veo rejects unsupported controls and invalid legacy modes", () => {
  const model = "veo-3.1";
  const body = { model, prompt: "cat", size: "1280x720" };
  for (const fields of [
    { seconds: 8 },
    { duration: 8 },
    { n: 1 },
    { seed: 0 },
    { audio: false },
    { stream: false },
    { watermark: false },
    { media: [] },
    { input_reference: veoImages[0] },
    { input: { prompt: "cat" } },
    { parameters: {} },
    { metadata: { parameters: { generation_mode: "text" } } },
    { metadata: { input: { media: [{ type: "reference_image", url: veoImages[0] }] } } },
  ])
    assert.throws(() => decode(model, { ...body, ...fields }));
  for (const generation_mode of [null, false, 0, {}, "", "First_Last", " text ", "unknown"]) {
    assert.throws(() => decode(model, { ...body, generation_mode }), /generation_mode/);
  }
  for (const key of ["model", "prompt", "size"]) {
    const missing = { ...body };
    delete missing[key];
    assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model, body: { kind: "json", value: missing } }), new RegExp(key));
  }
});

test("Veo enforces prompt and image URL boundaries and rejects input query strings", () => {
  const model = "omni-flash-video";
  const body = { model, prompt: "cat", size: "1280x720", generation_mode: "reference", reference_images: [veoImages[0]] };
  for (const prompt of ["  cat  ", "a".repeat(10000), "猫".repeat(5461) + "a", "😀".repeat(4096)]) {
    assert.equal(submit(model, { ...body, prompt }).request.body.prompt, prompt);
  }
  for (const prompt of [null, false, 0, [], "", "  ", "a".repeat(10001), "猫".repeat(5461) + "ab", "😀".repeat(4096) + "a"]) {
    assert.throws(() => decode(model, { ...body, prompt }), /prompt/);
  }
  const prefix = "https://tc.juheai.club/file/";
  const longest = prefix + "a".repeat(4096 - prefix.length);
  assert.deepEqual(submit(model, { ...body, reference_images: [longest] }).request.body.reference_images, [longest]);
  for (const url of [
    "https://tc.juheai.club/file/image.jpg?key=value",
    "https://tc.juheai.club/file/image.jpg?signature=test%2Bvalue%2F%3D&expires=123&tag=one&tag=two",
    "https://tc.juheai.club/file/image.jpg?",
  ]) {
    assert.throws(() => decode(model, { ...body, reference_images: [url] }), /uploaded public HTTPS/);
  }
  for (const url of [
    null,
    {},
    "",
    "http://tc.juheai.club/file/image.jpg",
    "./image.jpg",
    "data:image/png;base64,AA==",
    "https://tc.juheai.club/",
    "https://tc.juheai.club/file/image.jpg#fragment",
    "https://tc.juheai.club/file/image.jpg?key=value#fragment",
    "https://user:password@tc.juheai.club/file/image.jpg",
    "https://tc.juheai.club/file/a b.jpg",
    longest + "a",
  ]) {
    assert.throws(() => decode(model, { ...body, reference_images: [url] }), /uploaded public HTTPS/);
  }
  for (const reference_images of [null, false, veoImages[0], {}]) {
    assert.throws(() => decode(model, { ...body, reference_images }), /reference_images/);
  }
});

test("Veo uses documented task states, result URLs, authenticated content downloads and per-video usage", () => {
  for (const [model, resolution, sizes] of veoModels) {
    const { context } = submit(model, { prompt: "cat", size: sizes[0], generation_mode: "text" });
    const accepted = plugin.parseSubmitResponse(context, { body: { id: "vendor-job", task_id: "vendor-job", status: "queued" } });
    assert.equal(accepted.taskId, "vendor-job");
    assert.deepEqual(accepted.state, { model, resolution });
    const task = { ...context, taskId: accepted.taskId, state: accepted.state };
    assert.deepEqual(plugin.buildQueryRequest(task), {
      url: "https://movie.zmoapi.cn/v1/videos/vendor-job",
      method: "GET",
      headers: { Authorization: "Bearer test-key" },
    });
    for (const [status, expected] of [
      ["queued", "QUEUED"],
      ["in_progress", "IN_PROGRESS"],
      ["failed", "FAILURE"],
      ["unexpected", "UNKNOWN"],
    ]) {
      const result = plugin.parseTaskResult(task, { status, message: "provider detail" });
      assert.equal(result.status, expected);
      assert.deepEqual(plugin.extractUsageOnComplete(task, result, {}), {});
      if (status === "failed") assert.equal(result.reason, "provider detail");
    }
    const url = "https://tc.juheai.club/file/result.mp4";
    for (const content of [
      { content: { url }, result_url: "https://tc.juheai.club/file/other.mp4" },
      { result_url: url },
      { video_url: url },
      { output: [url] },
    ]) {
      const body = { status: "completed", ...content, progress: 100 };
      const result = plugin.parseTaskResult(task, body);
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.url, url);
      assert.deepEqual(plugin.extractUsageOnComplete(task, result, body), { video_count: 1 });
    }
    assert.equal(plugin.parseTaskResult(task, { status: "completed" }).status, "SUCCESS");
    assert.throws(
      () => plugin.parseSubmitResponse(context, { body: { code: "invalid_input", message: "provider rejection", data: null } }),
      /provider rejection/
    );
    assert.deepEqual(plugin.buildContentRequest({ ...task, artifactKey: "video", upstreamTaskId: "vendor-job", clientRequest: { method: "GET" } }), {
      url: "https://movie.zmoapi.cn/v1/videos/vendor-job/content",
      method: "GET",
      headers: { Authorization: "Bearer test-key" },
    });
  }
});

test("Veo honors explicit channel model mappings while validating the selected upstream model", () => {
  for (const model of ["customer-veo", "veo-3.1-lite"]) {
    const upstreamModel = "veo-3.1-fast";
    const body = { model, prompt: "cat", size: "720x1280", generation_mode: "reference", reference_images: veoImages };
    const intent = plugin.protocols.openai_video.decodeRequest({ model, upstreamModel, body: { kind: "json", value: body } });
    assert.equal(intent.model, model);
    const context = { model, upstreamModel, requestBody: intent.requestBody, baseUrl: "https://movie.zmoapi.cn", apiKey: "test-key" };
    assert.deepEqual(plugin.buildSubmitRequest(context).body, { ...body, model: upstreamModel });
    assert.deepEqual(plugin.extractUsage(context), { video_count: 1, resolution: "720P" });
    assert.deepEqual(plugin.protocols.openai_video.decodeRequest({ model, upstreamModel, body: { kind: "json", value: intent.requestBody } }), intent);
  }
});

test('H3 public parameters preserve optional booleans and enforce resolution/duration combinations',()=>{
 for(const resolution of ['480P','768P','1080P','2K']) for(const fast_mode of [undefined,false,true]) {
  const duration=resolution==='2K'?15:30;
  const {request,context}=submit('MiniMax-H3',{prompt:'scene',duration,resolution,ratio:'21:9',metadata:{parameters:fast_mode===undefined?{}:{fast_mode}}});
  assert.equal(request.body.resolution,({ '480P':'480p','1080P':'1080p'})[resolution]||resolution);
  assert.equal(request.body.fast_mode,fast_mode);
  assert.equal(Object.hasOwn(request.body,'fast_mode'),fast_mode!==undefined);
  assert.deepEqual(plugin.extractUsage(context),{seconds:duration,duration_tier:duration<=15?"4-15":"16-30",resolution,fast_mode:fast_mode===true,priority_mode:fast_mode===true?"priority":"standard",reference_video_seconds:0,extra_image_count:0});
  const accepted=plugin.parseSubmitResponse(context,{body:{id:'job'}});
  assert.deepEqual(plugin.extractUsageOnComplete({...context,state:accepted.state},{status:'SUCCESS'},{}),{seconds:duration,duration_tier:duration<=15?"4-15":"16-30"});
 }
 for(const body of [{duration:16,resolution:'2K'},{duration:31,resolution:'480P'},{duration:'6'},{metadata:{parameters:{fast_mode:0}}},{fast_mode:true,metadata:{parameters:{fast_mode:false}}}]) assert.throws(()=>decode('MiniMax-H3',{prompt:'scene',...body}));
});

test('H3 long output plus reference video reuses measured billing without WAN combined cap',()=>{
 globalThis.utils={fetch:()=>({status:200,body:{success:true,data:[]}})};
 const {context}=submit('MiniMax-H3',{prompt:'scene',duration:30,resolution:'768P',metadata:{parameters:{fast_mode:true},input:{media:[{type:'reference_video',url:video}]}}});
 const accepted=plugin.parseSubmitResponse(context,{body:{id:'job'}});
 const task={...context,taskId:'job',state:accepted.state};
 globalThis.utils.fetch=()=>({status:200,body:{success:true,data:[{type:2,model_name:'minimax-h3',other:{task_id:'job',is_task:true,reference_video_charge:{seconds:15,resolution:'768P',video_count:1}}}]}});
 const result=plugin.parseTaskResult(task,{status:'completed'});
 assert.equal(result.status,'SUCCESS');
 assert.equal(result.state.referenceVideoBilling.seconds,15);
 assert.deepEqual(plugin.extractUsageOnComplete(task,{...result,plugin_state:result.state},{}),{seconds:30,duration_tier:"16-30",reference_video_seconds:15});
 delete globalThis.utils;
});

test('Veo public roles and dimensions map explicitly and preserve ordering',()=>{
 for(const [model,resolution,sizes] of veoModels) {
  const {request}=submit(model,{prompt:'scene',resolution,ratio:'9:16'});
  assert.deepEqual(request.body,{model,prompt:'scene',size:sizes[1],generation_mode:'text',reference_images:[]});
  assert.throws(()=>decode(model,{prompt:'scene',resolution,ratio:'9:16',size:sizes[0]}),/conflicting/);
 }
 const {request}=submit('veo-3.1',{prompt:'scene',ratio:'16:9',metadata:{input:{media:[{type:'last_frame',url:veoImages[1]},{type:'first_frame',url:veoImages[0]}]}}});
 assert.equal(request.body.generation_mode,'first_last');
 assert.deepEqual(request.body.reference_images,veoImages.slice(0,2));
 const omni=submit('omni-flash-video',{prompt:'scene',ratio:'16:9',metadata:{input:{media:[{type:'reference_image',url:veoImages[0]}]}}}).request;
 assert.equal(omni.body.generation_mode,'reference');
 for(const media of [[{type:'last_frame',url:image}],[{type:'reference_video',url:video}],[{type:'first_frame',url:image},{type:'reference_image',url:image}]]) assert.throws(()=>decode('veo-3.1',{prompt:'scene',ratio:'16:9',metadata:{input:{media}}}));
});

test('WAN aliases preserve false and zero, reject conflicts and metadata overrides',()=>{
 const {request}=submit('wan3.0-video',{prompt:'scene',generate_audio:false,metadata:{parameters:{seed:0},input:{media:[{type:'reference_voice',url:'http://example.com/audio.wav'}]}}});
 assert.deepEqual(request.body.metadata.parameters,{audio:false,seed:0});
 assert.equal(request.body.metadata.input.media[0].type,'reference_audio');
 assert.throws(()=>decode('wan3.0-video',{prompt:'scene',generate_audio:false,metadata:{parameters:{audio:true}}}),/conflicting/);
 assert.throws(()=>decode('wan3.0-video',{prompt:'scene',metadata:{url:'https://evil.example'}}));
 assert.deepEqual(plugin.protocols.openai_video.render({}, {data:{url:'https://evil.example',token:'secret'}}),{});
});

test('Seedance content preserves signed query parameters with credentials confined to the exact endpoint',()=>{
  const endpoint='https://movie.zmoapi.cn/v1/videos/task-1/content';
  const ctx={model:official,baseUrl:'https://movie.zmoapi.cn',apiKey:'test-key',upstreamTaskId:'task-1',artifactKey:'video',clientRequest:{method:'GET'}};
  for(const url of [endpoint+'?signature=a%2Fb&expires=123','https://cdn.example/video?signature=a%2Fb',endpoint+'-other?signature=x','https://movie.zmoapi.cn.evil.example/video']) {
    const request=plugin.buildContentRequest({...ctx,data:{status:'completed',url}});
    assert.equal(request.url,url);
    if(url.startsWith(endpoint+'?')) assert.equal(request.headers.Authorization,'Bearer test-key');
    else { assert.equal(request.credentialless,true); assert.equal(request.headers,undefined); }
  }
});

test('terminal submission responses preserve state and settle through completion usage',()=>{
  for(const [model,extra] of [['wan3.0-video',{}],['MiniMax-H3',{}],['sd-2-c4',{}],[official,{duration:5}],['veo-3.1',{ratio:'16:9'}]]) {
    const {context}=submit(model,{prompt:'scene',...extra});
    const body={id:'task-1',status:'completed',seconds:5};
    const parsed=plugin.parseSubmitResponse(context,{body});
    assert.equal(parsed.immediate.status,'SUCCESS');
    const facts=plugin.extractUsageOnComplete({...context,taskId:parsed.taskId,state:parsed.state},parsed.immediate,body);
    assert.deepEqual(facts,model==='MiniMax-H3'?{seconds:5,duration_tier:'4-15'}:model==='wan3.0-video'?{seconds:5}:{video_count:1});
    const failed=plugin.parseSubmitResponse(context,{body:{id:'task-1',status:'failed',error:{message:'generation rejected'}}});
    assert.equal(failed.immediate.status,'FAILURE');
    assert.equal(failed.immediate.reason,'generation rejected');
    for(const status of ['queued','in_progress','unknown']) assert.equal(plugin.parseSubmitResponse(context,{body:{id:'task-1',status}}).immediate,undefined);
    assert.throws(()=>plugin.parseSubmitResponse(context,{body:{id:'task-1',status:'completed',error:{message:'invalid'}}}));
  }
});

test('reference completions defer accounting to polling on hosts without submit fetch',()=>{
  for (const model of ['MiniMax-H3','wan3.0-video']) {
    const duration=model==='MiniMax-H3'?20:5;
    const resolution=model==='MiniMax-H3'?'768P':'720P';
    const ctx={model,baseUrl:'https://movie.zmoapi.cn',apiKey:'test-key',requestBody:decode(model,{prompt:'scene',duration,resolution,metadata:{input:{media:[{type:'reference_video',url:video}]}}}).requestBody};
    const receipt={id:'task-1',status:'completed',seconds:duration,url:'https://cdn.example/finished.mp4'};
    // Match the actual host: there is no fetcher during submission parsing.
    delete globalThis.utils;
    const parsed=plugin.parseSubmitResponse(ctx,{body:receipt});
    assert.equal(parsed.immediate,undefined);
    assert.deepEqual(parsed.state.completedSubmission,{status:'completed',seconds:duration,url:receipt.url});
    const task={...ctx,taskId:parsed.taskId,state:parsed.state,data:parsed.taskData};
    assert.equal(plugin.buildQueryRequest(task).url,'https://movie.zmoapi.cn/v1/videos/task-1');
    for (const outcome of ['valid','missing','invalid','transport','http503','http404','redirect']) {
      let reads=0;
      globalThis.utils={fetch:(request)=>{
        reads++;
        assert.equal(request.url,'https://movie.zmoapi.cn/api/log/token');
        assert.equal(request.headers.Authorization,'Bearer test-key');
        if(outcome==='transport')throw new Error('unavailable');
        const charge={seconds:outcome==='invalid'?-1:3,resolution,video_count:1};
        return {status:outcome==='http503'?503:outcome==='http404'?404:outcome==='redirect'?302:200,body:{success:true,data:outcome==='missing'?[]:[{type:2,model_name:model==='MiniMax-H3'?'minimax-h3':model,other:{task_id:'task-1',is_task:true,reference_video_charge:charge}}]}};
      }};
      try {
        // Even a stale or contradictory JSON snapshot cannot undo completion.
        for (const later of [{status:'queued'},{status:'failed'},{}]) {
          const result=plugin.parseTaskResult(task,later);
          assert.equal(result.status,'SUCCESS');
          assert.equal(result.url,receipt.url);
          const completion={...result,plugin_state:result.state};
          if(outcome==='valid')assert.deepEqual(plugin.extractUsageOnComplete(task,completion,later),model==='MiniMax-H3'?{seconds:20,duration_tier:"16-30",reference_video_seconds:3}:{seconds:8});
          else assert.throws(()=>plugin.extractUsageOnComplete(task,completion,later),/retaining reserved/);
        }
        assert.equal(reads,3);
      } finally {delete globalThis.utils;}
    }
    const failed=plugin.parseSubmitResponse(ctx,{body:{id:'task-1',status:'failed',error:{message:'rejected'}}});
    assert.equal(failed.immediate.status,'FAILURE');
    assert.equal(failed.state.completedSubmission,undefined);
  }
});

test('H3 duration tiers follow completion seconds across the 15/16 boundary',()=>{
  for(const [requested,actual] of [[15,16],[16,15],[4,4],[30,30]]) {
    const {context}=submit('MiniMax-H3',{prompt:'scene',duration:requested,resolution:'768P'});
    assert.equal(plugin.extractUsage(context).duration_tier,requested<=15?'4-15':'16-30');
    const accepted=plugin.parseSubmitResponse(context,{body:{id:'job'}});
    const facts=plugin.extractUsageOnComplete({...context,state:accepted.state},{status:'SUCCESS'},{seconds:actual});
    assert.deepEqual(facts,{seconds:actual,duration_tier:actual<=15?'4-15':'16-30'});
  }
});


test('H3 pricing priority is derived from fast_mode and stays frozen at completion',()=>{
  for(const fast_mode of [undefined,false,true]) {
    const {context,request}=submit('MiniMax-H3',{prompt:'scene',duration:15,resolution:'768P',metadata:{parameters:fast_mode===undefined?{}:{fast_mode}}});
    const estimated=plugin.extractUsage(context);
    const accepted=plugin.parseSubmitResponse(context,{body:{id:'task-1'}});
    const actual=plugin.extractUsageOnComplete({...context,state:accepted.state},{status:'SUCCESS'},{seconds:16,fast_mode:!fast_mode,priority_mode:'untrusted'});
    const settled={...estimated,...actual};
    assert.equal(settled.priority_mode,fast_mode===true?'priority':'standard');
    assert.equal(settled.fast_mode,fast_mode===true);
    assert.equal(settled.duration_tier,'16-30');
    assert.equal(Object.hasOwn(request.body,'priority_mode'),false);
  }
  for(const extra of [{priority_mode:'priority'},{metadata:{parameters:{priority_mode:'standard',fast_mode:true}}}]) {
    assert.throws(()=>decode('MiniMax-H3',{prompt:'scene',...extra}),/unsupported/);
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
