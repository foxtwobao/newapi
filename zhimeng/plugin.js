const WAN3_MODELS = ["wan3.0-video", "wan3.0-video-prime"];
// Share the host model spelling with Hailuo; Zhimeng uses a lowercase wire ID.
const MINIMAX_MODEL = "MiniMax-H3";
const SEEDANCE_MODELS = ["sd-2-c4", "sd-2-c5"];
const WAN3_USAGE_SCHEMA = {
  seconds: { type: "number", unit: "second", description: { en: "Video generation unit price", zh: "视频生成单价" } },
  resolution: { enum: ["480P", "720P", "1080P"], description: { en: "Output video resolution", zh: "输出视频分辨率" } },
};
const SEEDANCE_USAGE_SCHEMA = {
  video_count: { type: "number", unit: "count", description: { en: "Video generation unit price", zh: "视频生成单价" } },
};

const MINIMAX_USAGE_SCHEMA = {
  seconds: { type: "number", unit: "second", description: { en: "Video generation unit price", zh: "视频生成单价" } },
  reference_video_seconds: { type: "number", unit: "second", description: { en: "Reference video unit price", zh: "参考视频单价" } },
  extra_image_count: { type: "number", unit: "count", description: { en: "Additional reference image unit price", zh: "额外参考图片单价" } },
  resolution: { enum: ["768P", "2K"], description: { en: "Output video resolution", zh: "输出视频分辨率" } },
};

export const meta = {
  apiVersion: 1,
  key: "zhimeng",
  name: "Zhimeng",
  icon: "text:知梦",
  description: { en: "WAN 3.0, Seedance and MiniMax H3 video generation via Zhimeng", zh: "通过知梦生成万相 3.0、Seedance 和 MiniMax H3 视频" },
  version: "1.2.0",
  author: { name: "Community" },
  baseUrl: "https://movie.zmoapi.cn",
  models: WAN3_MODELS.concat(SEEDANCE_MODELS, [MINIMAX_MODEL]),
  fetchMode: "per_task",
  usageSchema: WAN3_USAGE_SCHEMA,
  usageProfiles: [
    { models: WAN3_MODELS, schema: WAN3_USAGE_SCHEMA },
    { models: SEEDANCE_MODELS, schema: SEEDANCE_USAGE_SCHEMA },
    { models: [MINIMAX_MODEL], schema: MINIMAX_USAGE_SCHEMA },
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
  if (counts.reference_video && values.duration >= 30) throw new Error("reference video duration plus output duration must not exceed 30 seconds");
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

function normalizeSeedanceRequest(req, model) {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
  const allowed = ["model", "prompt", "duration", "seconds", "resolution", "size", "ratio", "aspect_ratio", "metadata", "media"];
  for (const key of Object.keys(req)) {
    if (!allowed.includes(key)) throw new Error("unsupported Seedance parameter: " + key);
  }
  const metadata = req.metadata === undefined ? {} : req.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("metadata must be an object");
  if (metadata.model !== undefined) throw new Error("can't change model with metadata");
  const input = metadata.input === undefined ? {} : metadata.input;
  const parameters = metadata.parameters === undefined ? {} : metadata.parameters;
  for (const item of [{ value: input, name: "metadata.input", allowed: ["prompt", "media"] },
    { value: parameters, name: "metadata.parameters", allowed: ["duration", "seconds", "resolution", "size", "ratio", "aspect_ratio"] }]) {
    if (!item.value || typeof item.value !== "object" || Array.isArray(item.value)) throw new Error(item.name + " must be an object");
    for (const key of Object.keys(item.value)) {
      if (!item.allowed.includes(key)) throw new Error("unsupported Seedance parameter: " + item.name + "." + key);
    }
  }
  const ratios = model === "sd-2-c4" ? ["16:9", "9:16", "1:1"] : ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
  const values = {};
  for (const source of [req, parameters, input]) {
    for (const key of Object.keys(source)) {
      const name = key === "seconds" ? "duration" : key === "aspect_ratio" ? "ratio" : key;
      if (!["duration", "resolution", "size", "ratio", "prompt"].includes(name)) continue;
      let value = source[key];
      if (name === "duration") {
        if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") throw new Error("duration must be an integer between 4 and 15");
        value = Number(value);
        if (!Number.isInteger(value) || value < 4 || value > 15) throw new Error("duration must be an integer between 4 and 15");
      } else if (name === "resolution") {
        if (typeof value !== "string" || !/^720p?$/i.test(value.trim())) throw new Error("Seedance resolution must be 720P");
        value = "720P";
      } else if (name === "size") {
        if (typeof value !== "string" || !value.trim()) throw new Error("invalid size");
        const size = videoSize(value);
        for (const dimension of ["resolution", "ratio"]) {
          if (size[dimension] === undefined) continue;
          if (values[dimension] !== undefined && values[dimension] !== size[dimension]) throw new Error("conflicting Seedance parameter: " + dimension);
          values[dimension] = size[dimension];
        }
        continue;
      } else if (name === "ratio") {
        if (typeof value !== "string" || !ratios.includes(value.trim())) throw new Error("unsupported Seedance ratio");
        value = value.trim();
      } else {
        if (typeof value !== "string") throw new Error("prompt must be a string");
      }
      if (values[name] !== undefined && values[name] !== value) throw new Error("conflicting Seedance parameter: " + name);
      values[name] = value;
    }
  }
  const prompt = values.prompt === undefined ? "" : values.prompt;
  const validatedPrompt = prompt.trim();
  if (!validatedPrompt || Array.from(validatedPrompt).length > 10000) throw new Error("prompt must contain 1–10000 characters");
  const resolution = values.resolution === undefined ? "720P" : values.resolution;
  if (resolution !== "720P") throw new Error("Seedance resolution must be 720P");
  const ratio = values.ratio === undefined ? "16:9" : values.ratio;
  if (!ratios.includes(ratio)) throw new Error("unsupported Seedance ratio");
  if (req.media !== undefined && input.media !== undefined) throw new Error("use only one media source");
  const media = input.media === undefined ? (req.media === undefined ? [] : req.media) : input.media;
  if (!Array.isArray(media)) throw new Error("metadata.input.media must be an array");
  if (media.length > 15) throw new Error("Seedance supports at most 15 media entries");
  const limits = { first_frame: 1, last_frame: 1, reference_image: 9, reference_video: 3, reference_audio: 3 };
  const counts = {};
  const normalizedMedia = [];
  for (const item of media) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !Object.prototype.hasOwnProperty.call(limits, item.type)) throw new Error("unsupported Seedance media type; use reference_audio for audio references");
    for (const key of Object.keys(item)) {
      if (!["type", "url"].includes(key)) throw new Error("unsupported Seedance media parameter: " + key);
    }
    if (typeof item.url !== "string" || !/^https:\/\/[^/?#\s]+(?:[/?#]|$)/i.test(item.url)) throw new Error("media URLs must use HTTPS");
    counts[item.type] = (counts[item.type] || 0) + 1;
    if (counts[item.type] > limits[item.type]) throw new Error("too many input.media entries for " + item.type);
    normalizedMedia.push({ type: item.type, url: item.url });
  }
  if ((counts.first_frame || 0) + (counts.last_frame || 0) + (counts.reference_image || 0) > 9) throw new Error("Seedance supports at most 9 images including frames");
  if (counts.last_frame && !counts.first_frame) throw new Error("last_frame requires first_frame");
  return { model, prompt, duration: values.duration === undefined ? 5 : values.duration, resolution, ratio,
    metadata: Object.assign({}, metadata, { input: { media: normalizedMedia }, parameters: {} }) };
}

function isMinimaxModel(model) {
  return typeof model === "string" && model.toLowerCase() === "minimax-h3";
}

function normalizeMinimaxRequest(req, model) {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
  const allowed = ["model", "prompt", "duration", "seconds", "resolution", "size", "ratio", "aspect_ratio", "generation_mode", "image_urls", "video_urls", "audio_urls", "media", "metadata"];
  for (const key of Object.keys(req)) {
    if (!allowed.includes(key)) throw new Error("unsupported MiniMax H3 parameter: " + key);
  }
  const metadata = req.metadata === undefined ? {} : req.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("metadata must be an object");
  if (metadata.model !== undefined) throw new Error("can't change model with metadata");
  const input = metadata.input === undefined ? {} : metadata.input;
  const parameters = metadata.parameters === undefined ? {} : metadata.parameters;
  for (const item of [{ value: input, name: "metadata.input", allowed: ["prompt", "media"] },
    { value: parameters, name: "metadata.parameters", allowed: ["duration", "seconds", "resolution", "size", "ratio", "aspect_ratio", "generation_mode"] }]) {
    if (!item.value || typeof item.value !== "object" || Array.isArray(item.value)) throw new Error(item.name + " must be an object");
    for (const key of Object.keys(item.value)) {
      if (!item.allowed.includes(key)) throw new Error("unsupported MiniMax H3 parameter: " + item.name + "." + key);
    }
  }
  const values = {};
  for (const source of [req, parameters, input]) {
    for (const key of Object.keys(source)) {
      const name = key === "seconds" ? "duration" : key === "aspect_ratio" ? "ratio" : key === "size" ? "resolution" : key;
      if (!["prompt", "duration", "resolution", "ratio", "generation_mode"].includes(name)) continue;
      let value = source[key];
      if (name === "duration") {
        if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") throw new Error("duration must be an integer between 4 and 15");
        value = Number(value);
        if (!Number.isInteger(value) || value < 4 || value > 15) throw new Error("duration must be an integer between 4 and 15");
      } else {
        if (typeof value !== "string") throw new Error(name + " must be a string");
        if (name !== "prompt") value = value.trim();
        if (name === "resolution") {
          value = value.toUpperCase();
          if (!["768P", "2K"].includes(value)) throw new Error("MiniMax H3 resolution must be 768P or 2K");
        }
        if (name === "ratio" && !["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"].includes(value)) throw new Error("unsupported MiniMax H3 ratio");
        if (name === "generation_mode" && !["frames", "references"].includes(value)) throw new Error("generation_mode must be frames or references");
      }
      if (values[name] !== undefined && values[name] !== value) throw new Error("conflicting MiniMax H3 parameter: " + name);
      values[name] = value;
    }
  }
  if (!values.prompt || !values.prompt.trim()) throw new Error("prompt is required");
  if (req.media !== undefined && input.media !== undefined) throw new Error("use only one media source");
  let media = input.media === undefined ? req.media : input.media;
  const simplified = ["image_urls", "video_urls", "audio_urls"].some(key => req[key] !== undefined);
  if (media !== undefined && simplified) throw new Error("do not mix media and URL arrays");
  if (simplified) {
    media = [];
    const mode = values.generation_mode || ((req.video_urls && req.video_urls.length) || (req.audio_urls && req.audio_urls.length) ? "references" : "frames");
    for (const key of ["image_urls", "video_urls", "audio_urls"]) {
      if (req[key] === undefined) continue;
      if (!Array.isArray(req[key])) throw new Error(key + " must be an array");
      for (let i = 0; i < req[key].length; i++) {
        const type = key === "video_urls" ? "reference_video" : key === "audio_urls" ? "reference_audio" : mode === "references" ? "reference_image" : i === 0 ? "first_frame" : "last_frame";
        media.push({ type, url: req[key][i] });
      }
    }
  }
  if (media === undefined) media = [];
  if (!Array.isArray(media)) throw new Error("media must be an array");
  const counts = {};
  const limits = { first_frame: 1, last_frame: 1, reference_image: 9, reference_video: 3, reference_audio: 3 };
  const normalized = [];
  for (const item of media) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !Object.prototype.hasOwnProperty.call(limits, item.type)) throw new Error("unsupported MiniMax H3 media type");
    for (const key of Object.keys(item)) {
      if (!["type", "url"].includes(key)) throw new Error("unsupported MiniMax H3 media parameter: " + key);
    }
    if (typeof item.url !== "string" || !/^https?:\/\/[^/?#\s]+(?:[/?#]|$)/i.test(item.url)) throw new Error("media URLs must use HTTP or HTTPS");
    counts[item.type] = (counts[item.type] || 0) + 1;
    if (counts[item.type] > limits[item.type]) throw new Error("too many media entries for " + item.type);
    normalized.push({ type: item.type, url: item.url });
  }
  const hasFrames = counts.first_frame || counts.last_frame;
  const hasReferences = counts.reference_image || counts.reference_video || counts.reference_audio;
  const mode = values.generation_mode || (hasReferences ? "references" : "frames");
  if ((counts.last_frame && !counts.first_frame) || (hasFrames && mode !== "frames") || (hasReferences && mode !== "references")) throw new Error("unsupported MiniMax H3 media combination");
  return { model, prompt: values.prompt, duration: values.duration === undefined ? 4 : values.duration,
    resolution: values.resolution || "2K", ratio: values.ratio || "adaptive", generation_mode: mode,
    metadata: { input: { media: normalized }, parameters: {} } };
}

function zhimengRequest(ctx) {
  const target = ctx.upstreamModel || ctx.model;
  const model = isMinimaxModel(target) ? MINIMAX_MODEL : target;
  if (isMinimaxModel(ctx.model) && model !== MINIMAX_MODEL) throw new Error("public MiniMax H3 model must not be remapped");
  if (WAN3_MODELS.includes(ctx.model) && model !== ctx.model) throw new Error("public WAN3 models must not be remapped");
  if (SEEDANCE_MODELS.includes(ctx.model) && model !== ctx.model) throw new Error("public Seedance models must not be remapped");
  if (model === MINIMAX_MODEL) return normalizeMinimaxRequest(ctx.requestBody, model);
  if (SEEDANCE_MODELS.includes(model)) return normalizeSeedanceRequest(ctx.requestBody, model);
  if (!WAN3_MODELS.includes(model)) throw new Error("unsupported Zhimeng model: " + model);
  return normalizeWan3Request(ctx.requestBody, model, "zhimeng");
}

export function buildSubmitRequest(ctx) {
  const req = zhimengRequest(ctx);
  if (req.model === MINIMAX_MODEL) {
    const media = req.metadata.input.media;
    if (media.some(item => item.type === "reference_video")) zhimengUsageLogs(ctx);
    const images = req.generation_mode === "frames"
      ? media.filter(item => item.type === "first_frame").concat(media.filter(item => item.type === "last_frame"))
      : media.filter(item => item.type === "reference_image");
    return {
      url: ctx.baseUrl + "/v1/videos", method: "POST",
      headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" },
      body: { model: "minimax-h3", prompt: req.prompt, duration: req.duration, resolution: req.resolution,
        aspect_ratio: req.ratio, generation_mode: req.generation_mode,
        image_urls: images.map(item => item.url),
        video_urls: media.filter(item => item.type === "reference_video").map(item => item.url),
        audio_urls: media.filter(item => item.type === "reference_audio").map(item => item.url) },
    };
  }
  if (SEEDANCE_MODELS.includes(req.model)) {
    return {
      url: ctx.baseUrl + "/v1/videos", method: "POST",
      headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" },
      body: { model: req.model, input: { prompt: req.prompt, media: req.metadata.input.media.map(item => ({ type: item.type === "reference_audio" ? "reference_voice" : item.type, url: item.url })) },
        parameters: { duration: req.duration, resolution: req.resolution.toLowerCase(), ratio: req.ratio } },
    };
  }
  // Reference input is measured by Zhimeng, not by client-supplied metadata.
  // Check access to its billing records before starting paid work. Older hosts
  // without utils.fetch fail here, before the submission descriptor is sent.
  if (req.metadata.input.media.some(item => item.type === "reference_video")) zhimengUsageLogs(ctx);
  return {
    url: ctx.baseUrl + "/v1/videos", method: "POST",
    headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" },
    body: { model: req.model, prompt: req.prompt, duration: req.duration, resolution: req.resolution,
      aspect_ratio: req.ratio, metadata: { input: req.metadata.input, parameters: req.metadata.parameters } },
  };
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid Zhimeng submission response");
  if (body.error || (body.code !== undefined && body.code !== 0 && body.code !== "0" && body.code !== "success"))
    throw new Error(body.error && body.error.message || body.message || "Zhimeng submission failed");
  const taskId = body.id || body.task_id;
  if (typeof taskId !== "string" || !taskId.trim()) throw new Error("task_id is empty");
  const req = zhimengRequest(ctx);
  const state = { model: req.model === MINIMAX_MODEL ? "minimax-h3" : req.model, duration: req.duration, resolution: req.resolution,
    hasReferenceVideo: req.metadata.input.media.some(item => item.type === "reference_video") };
  if ((WAN3_MODELS.includes(req.model) || req.model === MINIMAX_MODEL) && state.hasReferenceVideo)
    state.referenceVideoCount = req.metadata.input.media.filter(item => item.type === "reference_video").length;
  return { taskId, taskData: body, state };
}

export function extractUsage(ctx) {
  const req = zhimengRequest(ctx);
  if (SEEDANCE_MODELS.includes(req.model)) return ctx.usagePurpose === "billing_ratios" ? {} : { video_count: 1 };
  if (req.model === MINIMAX_MODEL) {
    if (ctx.usagePurpose === "billing_ratios") return {};
    const media = req.metadata.input.media;
    return { seconds: req.duration, resolution: req.resolution,
      reference_video_seconds: media.some(item => item.type === "reference_video") ? 15 : 0,
      extra_image_count: Math.max(media.filter(item => item.type === "reference_image").length - 5, 0) };
  }
  // Zhimeng caps input at 15 seconds and input + output at 30 seconds.
  // Reserve the upper bound; never trust URL hints or a client duration.
  const seconds = req.metadata.input.media.some(item => item.type === "reference_video") ? Math.min(req.duration + 15, 30) : req.duration;
  return ctx.usagePurpose === "billing_ratios" ? { seconds } : { seconds, resolution: req.resolution };
}

export function extractUsageOnComplete(task, result, body) {
  if (!result || result.status !== "SUCCESS") return {};
  if (SEEDANCE_MODELS.includes(task.upstreamModel || task.model)) return { video_count: 1 };
  if (!task.state || typeof task.state.hasReferenceVideo !== "boolean") throw new Error("missing Zhimeng submission state; retaining reserved usage");
  const minimax = isMinimaxModel(task.upstreamModel || task.model);
  // H3 does not promise output duration in query responses. Keep the frozen
  // requested duration when it is absent, and never trust client media lengths.
  const seconds = minimax && (!body || body.seconds === undefined) ? task.state.duration : body && body.seconds;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < (minimax ? 4 : 2) || seconds > (minimax ? 15 : 30))
    throw new Error("invalid Zhimeng completion seconds; retaining reserved usage");
  if (task.state.hasReferenceVideo) {
    // The host passes newly returned poll state as result.plugin_state, before
    // persisting it. This also handles a task completing on its first poll.
    const state = result.plugin_state || task.state;
    const billing = state.referenceVideoBilling;
    if (!Number.isInteger(task.state.referenceVideoCount) || task.state.referenceVideoCount < 1 || task.state.referenceVideoCount > (minimax ? 3 : 5) ||
        !billing || billing.taskId !== task.taskId || billing.resolution !== task.state.resolution ||
        typeof billing.seconds !== "number" || !Number.isFinite(billing.seconds) || billing.seconds <= 0 || billing.seconds > 15 ||
        !Number.isInteger(billing.videoCount) || billing.videoCount < 1 || billing.videoCount > task.state.referenceVideoCount ||
        seconds + billing.seconds > 30)
      throw new Error("missing or invalid Zhimeng reference video billing; retaining reserved usage");
    return minimax ? { seconds, reference_video_seconds: billing.seconds } : { seconds: seconds + billing.seconds };
  }
  return { seconds };
}

function zhimengUsageLogs(ctx) {
  const response = utils.fetch({ url: ctx.baseUrl + "/api/log/token", headers: { Authorization: "Bearer " + ctx.apiKey } });
  if (response.status !== 200 || !response.body || response.body.success !== true || !Array.isArray(response.body.data))
    throw new Error("Zhimeng reference video billing records are unavailable");
  return response.body.data;
}

export function buildQueryRequest(ctx) {
  return { url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.taskId), method: "GET", headers: { Authorization: "Bearer " + ctx.apiKey } };
}

export function parseTaskResult(ctx, body) {
  const data = body && typeof body === "object" ? body : {};
  let status = { queued: "QUEUED", in_progress: "IN_PROGRESS", completed: "SUCCESS", failed: "FAILURE" }[data.status] || "UNKNOWN";
  if (status === "SUCCESS" && (data.error || (data.code !== undefined && data.code !== 0 && data.code !== "0" && data.code !== "success"))) status = "UNKNOWN";
  const result = { status };
  if (typeof data.progress === "number" && Number.isFinite(data.progress) && data.progress >= 0 && data.progress <= 100) result.progress = data.progress + "%";
  if (status === "SUCCESS") {
    const urls = [data.content && data.content.url, data.video_url, data.url, data.result_url, data.media_url, Array.isArray(data.output) ? data.output[0] : undefined, data.object];
    for (const url of urls) {
      if (typeof url === "string" && /^https?:\/\//i.test(url)) { result.url = url; break; }
    }
    if (SEEDANCE_MODELS.includes(ctx.upstreamModel || ctx.model) && !result.url) {
      result.status = "UNKNOWN";
      result.reason = "Seedance video URL is unavailable";
    }
  }
  if (status === "FAILURE") result.reason = data.error && data.error.message || data.message || "Zhimeng task failed";
  if (status === "UNKNOWN") result.reason = data.error && data.error.message || data.message || "unrecognized Zhimeng task status";
  if ((WAN3_MODELS.includes(ctx.upstreamModel || ctx.model) || isMinimaxModel(ctx.upstreamModel || ctx.model)) && ctx.state && ctx.state.hasReferenceVideo &&
      ["QUEUED", "IN_PROGRESS", "SUCCESS"].includes(result.status) && !ctx.state.referenceVideoBilling) {
    // Capture the provider's measured input as early as possible: the token
    // endpoint exposes recent records, not an unlimited task history. Keep it
    // in private state across polls; never infer seconds from prices or quota.
    const state = Object.assign({}, ctx.state);
    try {
      let billing;
      for (const log of zhimengUsageLogs(ctx)) {
        if (!log || log.type !== 2 || log.model_name !== ctx.state.model) continue;
        let other;
        try { other = typeof log.other === "string" ? JSON.parse(log.other) : log.other; } catch (_) { continue; }
        if (!other || other.task_id !== ctx.taskId || other.is_task !== true) continue;
        if (billing) throw new Error("ambiguous billing record");
        const charge = other.reference_video_charge;
        if (!charge || typeof charge.seconds !== "number" || !Number.isFinite(charge.seconds) || charge.seconds <= 0 || charge.seconds > 15 ||
            charge.seconds + ctx.state.duration > 30 || charge.resolution !== ctx.state.resolution ||
            !Number.isInteger(charge.video_count) || charge.video_count < 1 || charge.video_count > ctx.state.referenceVideoCount)
          throw new Error("invalid reference video billing record");
        billing = { taskId: ctx.taskId, seconds: charge.seconds, resolution: charge.resolution, videoCount: charge.video_count };
      }
      if (!billing) throw new Error("reference video billing record not found");
      state.referenceVideoBilling = billing;
      delete state.referenceVideoBillingError;
    } catch (_) {
      // Do not turn a successfully generated video into a failed/refunded task
      // because the accounting lookup is unavailable. Retry on subsequent
      // nonterminal polls; completion without verified input retains the cap.
      state.referenceVideoBillingError = "Verified reference video billing is unavailable; reserved usage retained";
    }
    result.state = state;
  }
  return result;
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  if (SEEDANCE_MODELS.includes(ctx.state && ctx.state.model || ctx.upstreamModel || ctx.model)) {
    const result = parseTaskResult(ctx, ctx.data);
    if (result.status !== "SUCCESS" || !result.url) throw new Error("Seedance video URL is unavailable");
    return { url: result.url, method: ctx.clientRequest.method, credentialless: true };
  }
  // Use the authenticated provider endpoint. Returned CDN URLs never receive
  // the channel key; the host owns client Range and conditional headers.
  return { url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.upstreamTaskId) + "/content",
    method: ctx.clientRequest.method, headers: { Authorization: "Bearer " + ctx.apiKey } };
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const requestBody = zhimengRequest({ model: ctx.model, upstreamModel: ctx.upstreamModel, requestBody: ctx.body.value });
      return { kind: "submit", model: ctx.model, action: "video_generation", requestBody };
    },
    render: function (ctx, task) { return task.data || {}; },
  },
};
