const WAN3_MODELS = ["wan3.0-video", "wan3.0-video-prime"];
export const meta = {
  apiVersion: 1,
  key: "rolldek",
  name: "RollDek",
  icon: "text:RD",
  description: { en: "RollDek WAN 3.0 video generation", zh: "RollDek 万相 3.0 视频生成" },
  version: "2.0.0",
  author: { name: "Community" },
  baseUrl: "https://rolldek.com",
  models: WAN3_MODELS,
  fetchMode: "per_task",
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
  },
  usageProfiles: [
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
  if (!WAN3_MODELS.includes(model)) throw new Error("unsupported RollDek model: " + model);
  return normalizeWan3Request(ctx.requestBody, ctx.model, "rolldek");
}

export function buildSubmitRequest(ctx) {
  const model = ctx.upstreamModel || ctx.model;
  const req = rolldekVideoRequest(ctx);
  return {
    url: ctx.baseUrl + "/v1/videos", method: "POST",
    headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" },
    body: { model: model + "-" + req.resolution.toLowerCase(), prompt: req.prompt, seconds: String(req.duration),
      size: req.resolution, resolution: req.resolution, aspect_ratio: req.ratio, input: req.metadata.input },
  };
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {};
  const taskId = body.id || body.task_id;
  if (!taskId) throw new Error("task_id is empty");
  const req = rolldekVideoRequest(ctx);
  return { taskId, taskData: body, state: { duration: req.duration, resolution: req.resolution,
    hasReferenceVideo: req.metadata.input.media.some(item => item.type === "reference_video"),
    upstreamModel: (ctx.upstreamModel || ctx.model) + "-" + req.resolution.toLowerCase() } };
}

export function extractUsage(ctx) {
  const req = rolldekVideoRequest(ctx);
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

export function parseTaskResult(ctx, body) {
  const status = { queued: "QUEUED", pending: "QUEUED", processing: "IN_PROGRESS", in_progress: "IN_PROGRESS", completed: "SUCCESS", failed: "FAILURE", cancelled: "FAILURE" }[body.status] || "UNKNOWN";
  const result = { status };
  if (Number.isFinite(body.progress) && body.progress >= 0 && body.progress <= 100) result.progress = body.progress + "%";
  if (status === "SUCCESS" && body.metadata && body.metadata.url) result.url = body.metadata.url;
  if (status === "FAILURE") result.reason = (body.error && body.error.message) || "task failed";
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
    render: function (ctx, task) { return task.data || {}; },
  },
};
