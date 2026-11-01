const SEEDANCE_MODELS = ["sd-2.0-ch1", "sd-2.5-ch1", "sd-2.5-ch2", "sd-2.5-ch3"];
function objectValue(value, name) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(name + " must be an object");
  return value;
}
function videoProfile(ctx) {
  return { resolutions: ["720p"], maxDuration: (ctx.upstreamModel || ctx.model) === SEEDANCE_MODELS[0] ? 15 : 30, videoInput: (ctx.upstreamModel || ctx.model) !== SEEDANCE_MODELS[3] };
}
const WAN3_MODELS = ["wan3.0-video", "wan3.0-video-prime"];
export const meta = {
  apiVersion: 1,
  key: "rolldek",
  name: "RollDek",
  icon: "text:RD",
  description: { en: "RollDek WAN 3.0 and Seedance video generation", zh: "RollDek 万相 3.0 和 Seedance 视频生成" },
  version: "2.2.2",
  author: { name: "Community" },
  baseUrl: "https://rolldek.com",
  models: WAN3_MODELS.concat(SEEDANCE_MODELS),
  fetchMode: "per_task",
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
  },
  usageProfiles: [
    { models: SEEDANCE_MODELS, schema: {
      video_count: { type: "number", unit: "count", description: { en: "Video generation unit price", zh: "视频生成单价" } },
    } },
    { models: WAN3_MODELS, schema: {
      seconds: { type: "number", unit: "second", description: { en: "Video generation unit price", zh: "视频生成单价" } },
      resolution: { enum: ["480P", "720P", "1080P"], description: { en: "Output video resolution", zh: "输出视频分辨率" } },
    } },
  ],
  protocols: ["openai_video"],
};

const LEGACY_SIZES = {
  "480P": { "16:9": "832*480", "9:16": "480*832", "1:1": "624*624" },
  "720P": { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960", "4:3": "1088*832", "3:4": "832*1088" },
  "1080P": { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "1440*1440", "4:3": "1632*1248", "3:4": "1248*1632" },
};

// Wan2.7 changed the pixel sizes for 4:3 and 3:4. Legacy sizes remain valid
// compatibility inputs, but never replace the target model's native sizes.
const MODERN_SIZES = {
  "720P": { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960", "4:3": "1104*832", "3:4": "832*1104" },
  "1080P": { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "1440*1440", "4:3": "1648*1248", "3:4": "1248*1648" },
};

function videoSize(value) {
  const size = value.trim().replace(/x/i, "*");
  if (/^(480|720|1080)p?$/i.test(size)) return { resolution: size.toUpperCase().replace(/P?$/, "P") };
  for (const sizes of [LEGACY_SIZES, MODERN_SIZES]) {
    for (const resolution of Object.keys(sizes)) {
      for (const ratio of Object.keys(sizes[resolution])) {
        if (sizes[resolution][ratio] === size) return { resolution, ratio };
      }
    }
  }
  throw new Error("invalid size");
}

// These public request rules are kept in each standalone upload. Changes must
// pass the cross-provider decoder regressions in plugins/wan3_channels_test.go.
function normalizeWan3Request(req, model, provider) {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
  const allowed = ["model", "prompt", "duration", "seconds", "resolution", "size", "ratio", "aspect_ratio", "metadata", "media", "audio", "seed", "prompt_extend", "watermark", "auto_duration"];
  for (const key of Object.keys(req)) {
    if (!allowed.includes(key)) throw new Error("unsupported WAN3 parameter: " + key + "; use metadata.input.media and metadata.parameters");
  }
  const metadata = req.metadata === undefined ? {} : req.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("metadata must be an object");
  for (const key of Object.keys(metadata)) if (!["input", "parameters"].includes(key)) throw new Error("unsupported metadata field: " + key);
  if (metadata.model !== undefined) throw new Error("can't change model with metadata");
  const input = metadata.input === undefined ? {} : metadata.input;
  const parameters = metadata.parameters === undefined ? {} : metadata.parameters;
  for (const item of [{ value: input, name: "metadata.input", allowed: ["prompt", "media"] },
    { value: parameters, name: "metadata.parameters", allowed: ["duration", "seconds", "resolution", "size", "ratio", "aspect_ratio", "audio", "seed", "prompt_extend", "watermark"] }]) {
    if (!item.value || typeof item.value !== "object" || Array.isArray(item.value)) throw new Error(item.name + " must be an object");
    for (const key of Object.keys(item.value)) {
      if (!item.allowed.includes(key)) throw new Error("unsupported WAN3 parameter: " + item.name + "." + key);
    }
  }
  const values = {};
  for (const source of [req, parameters, input]) {
    for (const key of Object.keys(source)) {
      const name = key === "seconds" ? "duration" : key === "aspect_ratio" ? "ratio" : key;
      if (!["duration", "resolution", "size", "ratio", "prompt", "audio", "seed", "prompt_extend", "watermark"].includes(name)) continue;
      let value = source[key];
      if (name === "duration") {
        if (key === "duration" && typeof value !== "number") throw new Error("duration must be a number");
        if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") throw new Error("duration must be an integer between 2 and 30");
        value = Number(value);
        if (!Number.isInteger(value) || (value !== -1 && (value < 2 || value > 30))) throw new Error("duration must be an integer between 2 and 30");
        if (value === -1 && provider !== "alibaba") throw new Error("automatic duration is not supported by " + provider);
      } else if (name === "resolution") {
        if (typeof value !== "string" || !/^(480|720|1080)p?$/i.test(value.trim())) throw new Error("resolution must be 480P, 720P or 1080P");
        value = value.trim().toUpperCase().replace(/P?$/, "P");
      } else if (name === "size") {
        if (typeof value !== "string" || !value.trim()) throw new Error("invalid size");
        const size = videoSize(value.trim().toUpperCase().replace("X", "*"));
        for (const dimension of ["resolution", "ratio"]) {
          if (size[dimension] === undefined) continue;
          if (values[dimension] !== undefined && values[dimension] !== size[dimension]) throw new Error("conflicting WAN3 parameter: " + dimension);
          values[dimension] = size[dimension];
        }
        continue;
      } else if (name === "ratio") {
        if (typeof value !== "string") throw new Error("invalid ratio");
        value = value.trim().toLowerCase();
        if (value === "auto") value = "adaptive";
        if (!["16:9", "9:16", "1:1", "4:3", "3:4", "adaptive"].includes(value)) throw new Error("invalid ratio");
        if (provider === "rolldek" && !["16:9", "9:16", "1:1", "adaptive"].includes(value)) throw new Error("unsupported RollDek ratio");
      } else if (name === "prompt") {
        if (typeof value !== "string") throw new Error("prompt must be a string");
      } else if (name === "seed") {
        if (!Number.isInteger(value) || value < -1 || value > 2147483647) throw new Error("seed must be an integer between -1 and 2147483647");
      } else if (typeof value !== "boolean") throw new Error(name + " must be a boolean");
      if (provider === "rolldek" && ["audio", "seed", "prompt_extend", "watermark"].includes(name)) throw new Error("unsupported RollDek parameter: " + name);
      if (values[name] !== undefined && values[name] !== value) throw new Error("conflicting WAN3 parameter: " + name);
      values[name] = value;
    }
  }
  if (req.auto_duration !== undefined) {
    if (typeof req.auto_duration !== "boolean") throw new Error("auto_duration must be a boolean");
    if (provider !== "alibaba") throw new Error("automatic duration is not supported by " + provider);
    if ((req.auto_duration && values.duration !== undefined && values.duration !== -1) || (!req.auto_duration && values.duration === -1)) throw new Error("conflicting WAN3 parameter: duration");
    if (req.auto_duration) values.duration = -1;
  }
  const resolution = values.resolution === undefined ? "1080P" : values.resolution;
  if (!["480P", "720P", "1080P"].includes(resolution)) throw new Error("resolution must be 480P, 720P or 1080P");
  const ratio = values.ratio === undefined ? "adaptive" : values.ratio;
  if (provider === "rolldek" && !["16:9", "9:16", "1:1", "adaptive"].includes(ratio)) throw new Error("unsupported RollDek ratio");
  if (req.media !== undefined && input.media !== undefined) throw new Error("use only one media source");
  const media = input.media === undefined ? (req.media === undefined ? [] : req.media) : input.media;
  if (!Array.isArray(media)) throw new Error("metadata.input.media must be an array");
  const counts = {};
  const limits = { first_frame: 1, last_frame: 1, reference_image: 10, reference_video: 5, reference_audio: 5 };
  if (provider === "alibaba") { limits.file = 1; limits.link = 1; }
  const normalizedMedia = [];
  for (const item of media) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !Object.prototype.hasOwnProperty.call(limits, item.type)) throw new Error("unsupported WAN3 media type; use reference_audio for audio references");
    for (const key of Object.keys(item)) {
      if (!["type", "url"].includes(key)) throw new Error("unsupported WAN3 media parameter: " + key);
    }
    if (typeof item.url !== "string" || !item.url.trim()) throw new Error("media URL is required");
    if (!/^https:\/\/[^/?#\s]+(?:[/?#]|$)/i.test(item.url)) throw new Error("media URLs must use HTTPS");
    counts[item.type] = (counts[item.type] || 0) + 1;
    if (counts[item.type] > limits[item.type]) throw new Error("too many input.media entries for " + item.type);
    normalizedMedia.push({ type: item.type, url: item.url });
  }
  const frames = counts.first_frame || counts.last_frame;
  const references = counts.reference_image || counts.reference_video || counts.reference_audio || counts.file || counts.link;
  if ((frames && references) || (counts.file && counts.link) || (counts.last_frame && !counts.first_frame)) throw new Error("unsupported wan3.0 input.media combination");
  // No Zhimeng media enters shared scheduling until its reference semantics
  // and, for video, actual billed input duration have been verified.
  if (provider === "zhimeng" && media.length) throw new Error("Zhimeng media inputs are not enabled");
  const prompt = values.prompt === undefined ? "" : values.prompt;
  if (!prompt.trim() && (provider !== "alibaba" || !media.length)) throw new Error("prompt is required");
  const advanced = {};
  for (const key of ["audio", "seed", "prompt_extend", "watermark"]) {
    if (values[key] !== undefined) advanced[key] = values[key];
  }
  const result = { model, prompt, resolution, ratio, metadata: Object.assign({}, metadata, { input: { media: normalizedMedia }, parameters: advanced }) };
  if (values.duration === -1) result.auto_duration = true;
  else result.duration = values.duration === undefined ? 5 : values.duration;
  return result;
}

function rolldekVideoRequest(ctx) {
  const model = ctx.upstreamModel || ctx.model;
  if (WAN3_MODELS.includes(ctx.model) && model !== ctx.model) throw new Error("public WAN3 models must not be mapped to resolution suffixes");
  if (SEEDANCE_MODELS.includes(model)) {
    const req = normalizePublicSeedance(ctx.requestBody, ctx);
    if (req.seconds === -1 || req.metadata.ratio === "adaptive") throw new Error("RollDek Seedance does not document automatic duration or adaptive ratio");
    return req;
  }
  if (!WAN3_MODELS.includes(model)) throw new Error("unsupported RollDek model: " + model);
  return normalizeWan3Request(ctx.requestBody, ctx.model, "rolldek");
}

export function buildSubmitRequest(ctx) {
  const model = ctx.upstreamModel || ctx.model;
  const req = rolldekVideoRequest(ctx);
  if (SEEDANCE_MODELS.includes(model)) {
    const body = { model, prompt: req.prompt, duration: req.seconds, resolution: "720p", aspect_ratio: req.metadata.ratio };
    const fields = { first_frame: "first_image", last_frame: "last_image", reference_image: "image_refs", reference_video: "video_refs", reference_audio: "audio_refs" };
    for (const item of req.metadata.content) {
      const field = fields[item.role];
      const url = item[item.type].url;
      if (item.role === "first_frame" || item.role === "last_frame") body[field] = url;
      else { if (!body[field]) body[field] = []; body[field].push(url); }
    }
    return { url: ctx.baseUrl + "/v1/videos", method: "POST", headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" }, body };
  }
  return {
    url: ctx.baseUrl + "/v1/videos", method: "POST",
    headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" },
    body: { model, prompt: req.prompt, seconds: String(req.duration),
      size: req.resolution, resolution: req.resolution, aspect_ratio: req.ratio, input: req.metadata.input },
  };
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid RollDek submission response");
  const taskId = body.id || body.task_id;
  if (typeof taskId !== "string" || !taskId.trim()) throw new Error("task_id is empty");
  const result = parseTaskResult(ctx, body);
  if (body.error && result.status !== "FAILURE") throw new Error("RollDek submission returned an error");
  const response = { taskId, taskData: body };
  if (!SEEDANCE_MODELS.includes(ctx.upstreamModel || ctx.model)) {
    const req = rolldekVideoRequest(ctx);
    response.state = { duration: req.duration, resolution: req.resolution,
      hasReferenceVideo: req.metadata.input.media.some(item => item.type === "reference_video"),
      upstreamModel: ctx.upstreamModel || ctx.model };
  }
  if (result.status === "SUCCESS" || result.status === "FAILURE") response.immediate = result;
  return response;
}

export function extractUsage(ctx) {
  const req = rolldekVideoRequest(ctx);
  if (SEEDANCE_MODELS.includes(ctx.upstreamModel || ctx.model)) {
    if (ctx.usagePurpose === "billing_ratios") return {};
    return { video_count: 1 };
  }
  // Reserve the existing 30-second estimate for each distinct reference video.
  // This is not a provider limit; measured input and output replace it on completion.
  const videoURLs = new Set();
  for (const item of req.metadata.input.media) {
    if (item.type === "reference_video") videoURLs.add(item.url);
  }
  const facts = { seconds: req.duration + videoURLs.size * 30 };
  if (ctx.usagePurpose !== "billing_ratios") facts.resolution = req.resolution;
  return facts;
}

export function extractUsageOnComplete(task, result, body) {
  if (SEEDANCE_MODELS.includes(task.upstreamModel || task.model)) {
    if (!result || result.status !== "SUCCESS") return {};
    return { video_count: 1 };
  }
  if (!WAN3_MODELS.includes(task.upstreamModel || task.model)) throw new Error("unsupported RollDek model: " + (task.upstreamModel || task.model));
  if (!result || result.status !== "SUCCESS") return {};
  // RollDek's task endpoint nests WAN usage under metadata. Keep the
  // existing top-level form authoritative when present; never merge two
  // partial reports into a billable total.
  const usage = body && (body.usage ?? (body.metadata && body.metadata.usage));
  if (!usage) throw new Error("missing RollDek WAN3 completion usage; retaining reserved usage");
  const output = usage.output_video_duration === undefined ? usage.duration : usage.output_video_duration;
  const input = usage.input_video_duration;
  if (typeof output !== "number" || !Number.isFinite(output) || output < 0 ||
    typeof input !== "number" || !Number.isFinite(input) || input < 0 || !Number.isFinite(output + input))
    throw new Error("invalid RollDek WAN3 completion duration; retaining reserved usage");
  // Reference video billing follows complete measured input and output usage,
  // without assuming another provider's business limits; the
  // host validates the total against its second-unit safety ceiling.
  // Resolution remains the frozen submission fact, not a provider override.
  return { seconds: output + input };
}

export function buildQueryRequest(ctx) {
  return { url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.taskId), method: "GET", headers: { Authorization: "Bearer " + ctx.apiKey } };
}

// Keep independently uploaded plugins self-contained. Only human-readable
// failure fields are exposed; never serialize the provider response as an error.
function videoFailureMessage(data, fallback, ctx) {
  data = data && typeof data === "object" ? data : {};
  const candidates = [data.error && data.error.message, data.error, data.error_message, data.message, data.fail_reason, data.reason, fallback];
  let message = candidates.find(value => typeof value === "string" && value.trim()) || "Model service did not return a failure reason";
  // Driver contexts know the exact credential and private ID; remove these
  // before persisting a reason. Render contexts deliberately have no secrets.
  for (const secret of ctx ? [ctx.apiKey, ctx.authHeader, ctx.taskId] : []) {
    if (typeof secret === "string" && secret) message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, "[redacted URL]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "[redacted authorization]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|token|authorization|cookie|secret|signature)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 2048);
}

export function parseTaskResult(ctx, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: "UNKNOWN" };
  const status = { running: "IN_PROGRESS", succeeded: "SUCCESS", expired: "FAILURE", queued: "QUEUED", pending: "QUEUED", processing: "IN_PROGRESS", in_progress: "IN_PROGRESS", completed: "SUCCESS", failed: "FAILURE", cancelled: "FAILURE" }[body.status] || "UNKNOWN";
  const result = { status };
  if (Number.isFinite(body.progress) && body.progress >= 0 && body.progress <= 100) result.progress = body.progress + "%";
  if (status === "SUCCESS") result.url = body.url || body.video_url || (body.content && (body.content.url || body.content.video_url));
  if (status === "SUCCESS" && body.metadata && body.metadata.url) result.url = body.metadata.url;
  if (status === "FAILURE") result.reason = videoFailureMessage(body, undefined, ctx);
  if (status === "UNKNOWN") result.reason = "unrecognized status: " + String(body.status || "");
  return result;
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  return {
    url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.upstreamTaskId) + "/content",
    method: ctx.clientRequest.method,
    headers: { Authorization: "Bearer " + ctx.apiKey },
  };
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const requestBody = rolldekVideoRequest({ model: ctx.model, upstreamModel: ctx.upstreamModel, requestBody: ctx.body.value });
      return { kind: "submit", model: ctx.model, action: "video_generation", requestBody };
    },
    render: function (ctx, task) {
      if (!task || task.status !== "FAILURE") return {};
      const reason = typeof task.fail_reason === "string" ? task.fail_reason.trim() : "";
      // Old tasks may have a generic stored reason but a useful raw snapshot.
      const generic = !reason || ["task failed", "Zhimeng task failed", "Model service did not return a failure reason"].includes(reason);
      const message = videoFailureMessage(generic ? task.data : {}, reason);
      return { error: { code: "generation_failed", message } };
    },
  },
};

// Public video normalization is local to this independently uploaded plugin.
function normalizePublicSeedance(req, ctx) {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
  const metadata = objectValue(req.metadata, "metadata");
  const parameters = objectValue(metadata.parameters, "metadata.parameters");
  const input = objectValue(metadata.input, "metadata.input");
  const fields = ["duration", "seconds", "resolution", "size", "ratio", "aspect_ratio"];
  for (const key of Object.keys(req)) {
    if (!["model", "prompt", "metadata", "images", "image", "input_reference"].concat(fields).includes(key)) throw new Error("unsupported video parameter: " + key);
  }
  for (const key of Object.keys(metadata)) {
    if (!["input", "parameters", "content"].concat(fields).includes(key)) throw new Error("unsupported video metadata: " + key);
  }
  for (const key of Object.keys(parameters)) if (!fields.includes(key)) throw new Error("unsupported video parameter: " + key);
  for (const key of Object.keys(input)) if (key !== "media") throw new Error("unsupported video input: " + key);
  const profile = videoProfile(ctx);
  const values = {};
  for (const source of [req, metadata, parameters]) {
    for (const key of fields) {
      if (source[key] === undefined) continue;
      let name = key === "seconds" ? "duration" : key === "aspect_ratio" ? "ratio" : key === "audio" ? "generate_audio" : key;
      let value = source[key];
      if (name === "size") {
        if (typeof value !== "string") throw new Error("invalid size");
        const sizes = { "1280x720": ["720p", "16:9"], "720x1280": ["720p", "9:16"], "1920x1080": ["1080p", "16:9"], "1080x1920": ["1080p", "9:16"] };
        const size = value.toLowerCase().replace("*", "x");
        if (sizes[size]) {
          for (const [dimension, v] of [["resolution", sizes[size][0]], ["ratio", sizes[size][1]]]) {
            if (values[dimension] !== undefined && values[dimension] !== v) throw new Error("conflicting video parameter: " + dimension);
            values[dimension] = v;
          }
          continue;
        }
        name = "resolution";
      }
      if (name === "duration") {
        if (key === "duration" && typeof value !== "number") throw new Error("duration must be a number");
        if (key === "seconds" && !["number", "string"].includes(typeof value)) throw new Error("invalid seconds");
        value = Number(value);
        if (!Number.isInteger(value) || (value !== -1 && (value < 4 || value > profile.maxDuration))) throw new Error("duration outside model range");
        if (value === -1 && !profile.videoInput && !profile.audio) throw new Error("automatic duration is unsupported");
      } else if (name === "resolution") {
        if (typeof value !== "string" || !profile.resolutions.includes(value.toLowerCase())) throw new Error("unsupported resolution");
        value = value.toLowerCase();
      } else if (name === "ratio") {
        if (typeof value !== "string" || !["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "3:2", "2:3"].includes(value)) throw new Error("unsupported ratio");
      } else if (name === "seed") {
        if (!Number.isInteger(value) || value < -1 || value > 2147483647) throw new Error("seed outside model range");
      } else {
        if (typeof value !== "boolean") throw new Error(name + " must be a boolean");
        if (name === "generate_audio" && !profile.audio && !profile.videoInput) throw new Error("audio control is unsupported");
      }
      if (values[name] !== undefined && values[name] !== value) throw new Error("conflicting video parameter: " + name);
      values[name] = value;
    }
  }
  const media = input.media;
  let content = [];
  const imageSources = ["images", "input_reference", "image"].filter(key => req[key] !== undefined);
  if (imageSources.length > 1) throw new Error("use only one media source");
  const legacyImages = req.images !== undefined ? req.images : req.input_reference !== undefined ? [req.input_reference] : req.image !== undefined ? [req.image] : [];
  if (!Array.isArray(legacyImages)) throw new Error("images must be an array");
  if ([media !== undefined, metadata.content !== undefined, imageSources.length > 0].filter(Boolean).length > 1) throw new Error("use only one media source");
  if (media !== undefined) {
    if (!Array.isArray(media)) throw new Error("media must be an array");
    for (const item of media) {
      if (!item || typeof item !== "object" || Object.keys(item).some(key => !["type", "url"].includes(key))) throw new Error("invalid media entry");
      const type = { first_frame: "image_url", last_frame: "image_url", reference_image: "image_url", reference_video: "video_url", reference_audio: "audio_url" }[item.type];
      if (!type) throw new Error("unsupported media role");
      content.push({ type, [type]: { url: item.url }, role: item.type });
    }
  } else {
    if (metadata.content !== undefined && !Array.isArray(metadata.content)) throw new Error("content must be an array");
    content = legacyImages.map((url, index) => ({ type: "image_url", image_url: { url }, role: index === 0 ? "first_frame" : "last_frame" })).concat(metadata.content || []);
  }
  const counts = {};
  const normalizedContent = [];
  for (const item of content) {
    if (!item || !["image_url", "video_url", "audio_url"].includes(item.type) || Object.keys(item).some(key => !["type", "role", item.type].includes(key))) throw new Error("unsupported content entry; use prompt for text");
    const role = item.role === undefined ? ({ image_url: "first_frame", video_url: "reference_video", audio_url: "reference_audio" })[item.type] : item.role;
    const index = SEEDANCE_MODELS.indexOf(ctx.upstreamModel || ctx.model);
    const limits = { first_frame: index === 0 ? 0 : 1, last_frame: index === 0 ? 0 : 1, reference_image: [9,30,10,9][index], reference_video: [3,10,10,0][index], reference_audio: [3,10,10,0][index] };
    const expected = role === "reference_video" ? "video_url" : role === "reference_audio" ? "audio_url" : "image_url";
    if (typeof role !== "string" || !Object.prototype.hasOwnProperty.call(limits, role) || !limits[role] || item.type !== expected || (!profile.videoInput && ["reference_video", "reference_audio"].includes(role))) throw new Error("unsupported media role for model");
    const payload = item[item.type];
    if (!payload || Object.keys(payload).some(key => key !== "url") || typeof payload.url !== "string" || !/^https:\/\/[^/?#\s@\\]+(?:[/?#]|$)/i.test(payload.url)) throw new Error("media requires an HTTPS URL");
    counts[role] = (counts[role] || 0) + 1;
    if (counts[role] > limits[role]) throw new Error("too many media entries for " + role);
    normalizedContent.push({ type: item.type, [item.type]: { url: payload.url }, role });
  }
  if ((counts.first_frame && !counts.last_frame) || (counts.last_frame && !counts.first_frame) || ((counts.first_frame || counts.last_frame) && (counts.reference_image || counts.reference_video || counts.reference_audio))) throw new Error("unsupported media combination");
  if (counts.reference_audio && !counts.reference_image && !counts.reference_video) throw new Error("reference_audio requires visual references");
  if (typeof req.prompt !== "string" || !req.prompt.trim()) throw new Error("prompt is required");
  if ((ctx.upstreamModel || ctx.model) === SEEDANCE_MODELS[3] && ["3:2", "2:3"].includes(values.ratio)) throw new Error("unsupported ratio");
  if (values.resolution !== undefined && values.resolution !== "720p") throw new Error("unsupported resolution");
  const body = Object.assign({ duration: 4, resolution: "720p", ratio: "16:9" }, values, { content: normalizedContent });
  return { model: ctx.model, prompt: req.prompt, seconds: body.duration, metadata: body };
}
