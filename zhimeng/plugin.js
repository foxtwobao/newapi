const WAN3_MODELS = ["wan3.0-video", "wan3.0-video-prime"];
// Share the host model spelling with Hailuo; Zhimeng uses a lowercase wire ID.
const MINIMAX_MODEL = "MiniMax-H3";
const SEEDANCE20_MODELS = ["sd-2-c4", "sd-2-c5"];
const SEEDANCE25_MODELS = ["sd2.5-官链-满参考-受排队影响", "sd2.5-官转-30图10音频-火山词元"];
const SEEDANCE_MODELS = SEEDANCE20_MODELS.concat(SEEDANCE25_MODELS);
// Keep the six model IDs and their fixed resolutions from Zhimeng's video API.
const VEO_MODEL_RESOLUTIONS = {
  "veo-3.1-lite": "720P",
  "veo-3.1-fast": "720P",
  "veo-3.1": "720P",
  "veo-3.1-fast-1080p": "1080P",
  "veo-3.1-1080p": "1080P",
  "omni-flash-video": "720P",
};
const VEO_MODELS = Object.keys(VEO_MODEL_RESOLUTIONS);
const WAN3_USAGE_SCHEMA = {
  seconds: { type: "number", unit: "second", description: { en: "Video generation unit price", zh: "视频生成单价" } },
  resolution: { enum: ["480P", "720P", "1080P"], description: { en: "Output video resolution", zh: "输出视频分辨率" } },
};
const SEEDANCE_USAGE_SCHEMA = {
  video_count: { type: "number", unit: "count", description: { en: "Video generation unit price", zh: "视频生成单价" } },
};
const VEO_USAGE_SCHEMA = {
  video_count: SEEDANCE_USAGE_SCHEMA.video_count,
  resolution: { enum: ["720P", "1080P"], description: { en: "Output video resolution", zh: "输出视频分辨率" } },
};

const minimaxDurationTier = seconds => seconds <= 15 ? "4-15" : "16-30";

const MINIMAX_USAGE_SCHEMA = {
  duration_tier: { enum: ["4-15", "16-30"], description: { en: "Output duration tier (seconds)", zh: "输出时长档位（秒）" } },
  seconds: { type: "number", unit: "second", description: { en: "Video generation unit price", zh: "视频生成单价" } },
  reference_video_seconds: { type: "number", unit: "second", description: { en: "Reference video unit price", zh: "参考视频单价" } },
  extra_image_count: { type: "number", unit: "count", description: { en: "Additional reference image unit price", zh: "额外参考图片单价" } },
  priority_mode: {
    enum: ["standard", "priority"],
    description: { en: "Processing priority", zh: "处理优先级" },
    enumLabels: { standard: { en: "Standard", zh: "标准" }, priority: { en: "Priority", zh: "优先" } },
  },
  fast_mode: { type: "boolean", description: { en: "Priority mode enabled", zh: "启用优先模式" } },
  resolution: { enum: ["480P", "768P", "1080P", "2K"], description: { en: "Output video resolution", zh: "输出视频分辨率" } },
};

export const meta = {
  apiVersion: 1,
  key: "zhimeng",
  name: "Zhimeng",
  icon: "text:知梦",
  description: { en: "WAN 3.0, Seedance, MiniMax H3, Veo and Omni video generation via Zhimeng", zh: "通过知梦生成万相 3.0、Seedance、MiniMax H3、Veo 和 Omni 视频" },
  version: "1.5.5",
  author: { name: "Community" },
  baseUrl: "https://movie.zmoapi.cn",
  models: WAN3_MODELS.concat(SEEDANCE_MODELS, [MINIMAX_MODEL], VEO_MODELS),
  fetchMode: "per_task",
  usageSchema: WAN3_USAGE_SCHEMA,
  usageProfiles: [
    { models: WAN3_MODELS, schema: WAN3_USAGE_SCHEMA },
    { models: SEEDANCE_MODELS, schema: SEEDANCE_USAGE_SCHEMA },
    { models: [MINIMAX_MODEL], schema: MINIMAX_USAGE_SCHEMA },
    { models: VEO_MODELS, schema: VEO_USAGE_SCHEMA },
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
  if (req.generate_audio !== undefined) {
    if (req.audio !== undefined && req.audio !== req.generate_audio) throw new Error("conflicting audio parameter");
    req = Object.assign({}, req, { audio: req.generate_audio });
    delete req.generate_audio;
  }
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
  for (let item of media) {
    if (item && item.type === "reference_voice") item = Object.assign({}, item, { type: "reference_audio" });
    if (!item || typeof item !== "object" || Array.isArray(item) || !Object.prototype.hasOwnProperty.call(limits, item.type)) throw new Error("unsupported WAN3 media type; use reference_audio for audio references");
    for (const key of Object.keys(item)) {
      if (!["type", "url"].includes(key)) throw new Error("unsupported WAN3 media parameter: " + key);
    }
    if (typeof item.url !== "string" || !item.url.trim()) throw new Error("media URL is required");
    if (!/^https?:\/\/[^/?#\s@\\]+(?:[/?#]|$)/i.test(item.url)) throw new Error("media URLs must use HTTP or HTTPS");
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
  const seedance25 = SEEDANCE25_MODELS.includes(model);
  // Also accept the documented 2.0 wire format. Normalize reference_voice only
  // on that surface; public media keeps the shared reference_audio role.
  if (!seedance25 && (req.input !== undefined || req.parameters !== undefined)) {
    for (const key of Object.keys(req)) {
      if (!["model", "input", "parameters"].includes(key)) throw new Error("do not mix Seedance 2.0 input/parameters with public request fields");
    }
    if (!req.input || typeof req.input !== "object" || Array.isArray(req.input)) throw new Error("input must be an object");
    if (!req.parameters || typeof req.parameters !== "object" || Array.isArray(req.parameters)) throw new Error("parameters must be an object");
    if (req.parameters.duration === undefined) throw new Error("parameters.duration is required");
    const input = Object.assign({}, req.input);
    if (Array.isArray(input.media)) input.media = input.media.map(item => item && item.type === "reference_voice" ? Object.assign({}, item, { type: "reference_audio" }) : item);
    req = { model, metadata: { input, parameters: req.parameters } };
  }
  const allowed = ["model", "prompt", "duration", "seconds", "resolution", "ratio", "aspect_ratio", "metadata"];
  if (seedance25) allowed.push("reference_images", "reference_videos", "reference_audios");
  else allowed.push("size", "media");
  for (const key of Object.keys(req)) {
    if (!allowed.includes(key)) throw new Error("unsupported Seedance parameter: " + key);
  }
  const metadata = req.metadata === undefined ? {} : req.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("metadata must be an object");
  for (const key of Object.keys(metadata)) {
    if (!["input", "parameters"].includes(key)) throw new Error("unsupported Seedance parameter: metadata." + key);
  }
  const input = metadata.input === undefined ? {} : metadata.input;
  const parameters = metadata.parameters === undefined ? {} : metadata.parameters;
  for (const item of [{ value: input, name: "metadata.input", allowed: ["prompt", "media"] },
    { value: parameters, name: "metadata.parameters", allowed: seedance25 ? ["duration", "seconds", "resolution", "ratio", "aspect_ratio"] : ["duration", "seconds", "resolution", "size", "ratio", "aspect_ratio"] }]) {
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
        const maximum = seedance25 ? 30 : 15;
        const message = "duration must be an integer between 4 and " + maximum;
        if ((typeof value !== "number" && (seedance25 || typeof value !== "string")) || String(value).trim() === "") throw new Error(message);
        value = Number(value);
        if (!Number.isInteger(value) || value < 4 || value > maximum) throw new Error(message);
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
  const promptLimit = seedance25 ? 7000 : 10000;
  if (!validatedPrompt || Array.from(seedance25 ? prompt : validatedPrompt).length > promptLimit) throw new Error("prompt must contain 1–" + promptLimit + " characters");
  if (seedance25 && values.duration === undefined) throw new Error("Seedance 2.5 duration is required");
  const resolution = values.resolution === undefined ? "720P" : values.resolution;
  if (resolution !== "720P") throw new Error("Seedance resolution must be 720P");
  const ratio = values.ratio === undefined ? "16:9" : values.ratio;
  if (!ratios.includes(ratio)) throw new Error("unsupported Seedance ratio");
  if (req.media !== undefined && input.media !== undefined) throw new Error("use only one media source");
  let media = input.media === undefined ? (req.media === undefined ? [] : req.media) : input.media;
  const arrayRoles = { reference_images: "reference_image", reference_videos: "reference_video", reference_audios: "reference_audio" };
  const referenceArrays = Object.keys(arrayRoles).filter(key => req[key] !== undefined);
  if (seedance25 && referenceArrays.length) {
    if (input.media !== undefined) throw new Error("use only one media source");
    media = [];
    for (const key of referenceArrays) {
      if (key === "reference_videos" && model === "sd2.5-官转-30图10音频-火山词元") throw new Error("this Seedance 2.5 model does not support reference_videos");
      if (!Array.isArray(req[key])) throw new Error(key + " must be an array");
      for (const url of req[key]) media.push({ type: arrayRoles[key], url });
    }
  }
  if (!Array.isArray(media)) throw new Error("metadata.input.media must be an array");
  const maximumMedia = seedance25 ? 50 : 15;
  if (media.length > maximumMedia) throw new Error("Seedance supports at most " + maximumMedia + " media entries");
  const limits = seedance25
    ? { reference_image: 30, reference_video: model === "sd2.5-官链-满参考-受排队影响" ? 10 : 0, reference_audio: 10 }
    : { first_frame: 1, last_frame: 1, reference_image: 9, reference_video: 3, reference_audio: 3 };
  const counts = {};
  const normalizedMedia = [];
  for (const item of media) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !Object.prototype.hasOwnProperty.call(limits, item.type)) throw new Error("unsupported Seedance media type; use reference_audio for audio references");
    for (const key of Object.keys(item)) {
      if (!["type", "url"].includes(key)) throw new Error("unsupported Seedance media parameter: " + key);
    }
    if (seedance25) {
      if (typeof item.url !== "string" || !/^https:\/\/h3\.juheai\.club\/m\/[^/?#\s\\]+$/i.test(item.url)) throw new Error("Seedance 2.5 media must use H3 public_url links");
    } else if (typeof item.url !== "string" || !/^https?:\/\/[^/?#\s]+(?:[/?#]|$)/i.test(item.url)) throw new Error("media URLs must use HTTP or HTTPS");
    counts[item.type] = (counts[item.type] || 0) + 1;
    if (counts[item.type] > limits[item.type]) throw new Error("too many input.media entries for " + item.type);
    normalizedMedia.push({ type: item.type, url: item.url });
  }
  if (!seedance25 && (counts.first_frame || 0) + (counts.last_frame || 0) + (counts.reference_image || 0) > 9) throw new Error("Seedance supports at most 9 images including frames");
  if (counts.last_frame && !counts.first_frame) throw new Error("last_frame requires first_frame");
  return { model, prompt, duration: values.duration === undefined ? 5 : values.duration, resolution, ratio,
    metadata: Object.assign({}, metadata, { input: { media: normalizedMedia }, parameters: {} }) };
}

function isMinimaxModel(model) {
  return typeof model === "string" && model.toLowerCase() === "minimax-h3";
}

function normalizeMinimaxRequest(req, model) {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
  const allowed = ["model", "prompt", "duration", "seconds", "resolution", "size", "ratio", "aspect_ratio", "fast_mode", "generation_mode", "image_urls", "video_urls", "audio_urls", "media", "metadata"];
  for (const key of Object.keys(req)) {
    if (!allowed.includes(key)) throw new Error("unsupported MiniMax H3 parameter: " + key);
  }
  const metadata = req.metadata === undefined ? {} : req.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("metadata must be an object");
  for (const key of Object.keys(metadata)) if (!["input", "parameters"].includes(key)) throw new Error("unsupported metadata field: " + key);
  if (metadata.model !== undefined) throw new Error("can't change model with metadata");
  const input = metadata.input === undefined ? {} : metadata.input;
  const parameters = metadata.parameters === undefined ? {} : metadata.parameters;
  for (const item of [{ value: input, name: "metadata.input", allowed: ["prompt", "media"] },
    { value: parameters, name: "metadata.parameters", allowed: ["duration", "seconds", "resolution", "size", "ratio", "aspect_ratio", "generation_mode", "fast_mode"] }]) {
    if (!item.value || typeof item.value !== "object" || Array.isArray(item.value)) throw new Error(item.name + " must be an object");
    for (const key of Object.keys(item.value)) {
      if (!item.allowed.includes(key)) throw new Error("unsupported MiniMax H3 parameter: " + item.name + "." + key);
    }
  }
  const values = {};
  for (const source of [req, parameters, input]) {
    for (const key of Object.keys(source)) {
      const name = key === "seconds" ? "duration" : key === "aspect_ratio" ? "ratio" : key === "size" ? "resolution" : key;
      if (!["prompt", "duration", "resolution", "ratio", "generation_mode", "fast_mode"].includes(name)) continue;
      let value = source[key];
      if (name === "duration") {
        if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") throw new Error("duration must be an integer between 4 and 30");
        value = Number(value);
        if (!Number.isInteger(value) || value < 4 || value > 30) throw new Error("duration must be an integer between 4 and 30");
      } else if (name === "fast_mode") {
        if (typeof value !== "boolean") throw new Error("fast_mode must be a boolean");
      } else {
        if (typeof value !== "string") throw new Error(name + " must be a string");
        if (name !== "prompt") value = value.trim();
        if (name === "resolution") {
          value = value.toUpperCase();
          if (!["480P", "768P", "1080P", "2K"].includes(value)) throw new Error("MiniMax H3 resolution must be 480P, 768P, 1080P or 2K");
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
  if ((values.resolution === undefined || values.resolution === "2K") && values.duration > 15) throw new Error("2K duration must not exceed 15 seconds");
  return { model, prompt: values.prompt, duration: values.duration === undefined ? 4 : values.duration,
    resolution: values.resolution || "2K", ratio: values.ratio || "adaptive", generation_mode: mode,
    metadata: { input: { media: normalized }, parameters: values.fast_mode === undefined ? {} : { fast_mode: values.fast_mode } } };
}

function normalizeVeoRequest(req, model) {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
  if (req.metadata !== undefined || req.resolution !== undefined || req.ratio !== undefined || req.aspect_ratio !== undefined) {
    const allowed = ["model", "prompt", "resolution", "ratio", "aspect_ratio", "size", "metadata"];
    for (const key of Object.keys(req)) if (!allowed.includes(key)) throw new Error("unsupported Veo/Omni parameter: " + key);
    const metadata = req.metadata === undefined ? {} : req.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("metadata must be an object");
    for (const key of Object.keys(metadata)) if (!["input", "parameters"].includes(key)) throw new Error("unsupported metadata field: " + key);
    const input = metadata.input === undefined ? {} : metadata.input;
    const parameters = metadata.parameters === undefined ? {} : metadata.parameters;
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "media")) throw new Error("invalid metadata.input");
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || Object.keys(parameters).length) throw new Error("unsupported Veo/Omni parameters");
    const resolution = VEO_MODEL_RESOLUTIONS[model];
    if (req.resolution !== undefined && (typeof req.resolution !== "string" || req.resolution.toUpperCase() !== resolution)) throw new Error("unsupported resolution");
    const sizes = resolution === "720P" ? ["1280x720", "720x1280"] : ["1920x1080", "1080x1920"];
    let ratio;
    for (const value of [req.ratio, req.aspect_ratio]) {
      if (value === undefined) continue;
      if (!["16:9", "9:16"].includes(value)) throw new Error("unsupported ratio");
      if (ratio !== undefined && ratio !== value) throw new Error("conflicting ratio");
      ratio = value;
    }
    if (req.size !== undefined) {
      if (!sizes.includes(req.size)) throw new Error("unsupported size");
      const value = req.size === sizes[0] ? "16:9" : "9:16";
      if (ratio !== undefined && ratio !== value) throw new Error("conflicting size and ratio");
      ratio = value;
    }
    if (ratio === undefined) throw new Error("ratio or size is required");
    const media = input.media === undefined ? [] : input.media;
    if (!Array.isArray(media)) throw new Error("media must be an array");
    const frames = {};
    const references = [];
    for (const item of media) {
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["type", "url"].includes(key))) throw new Error("invalid media entry");
      if (item.type === "reference_image") references.push(item.url);
      else if (["first_frame", "last_frame"].includes(item.type)) {
        if (Object.prototype.hasOwnProperty.call(frames,item.type)) throw new Error("duplicate frame");
        frames[item.type] = item.url;
      } else throw new Error("unsupported media role");
    }
    const hasFrames = Object.keys(frames).length > 0;
    if ((hasFrames && references.length) || (Object.prototype.hasOwnProperty.call(frames,"last_frame") && !Object.prototype.hasOwnProperty.call(frames,"first_frame"))) throw new Error("invalid media combination");
    const images = hasFrames ? [frames.first_frame].concat(Object.prototype.hasOwnProperty.call(frames,"last_frame") ? [frames.last_frame] : []) : references;
    req = { model: req.model, prompt: req.prompt, size: sizes[ratio === "16:9" ? 0 : 1], generation_mode: hasFrames ? (images.length === 2 ? "first_last" : "first_frame") : references.length ? "reference" : "text", reference_images: images };
  }
  // Zhimeng explicitly limits Veo/Omni to these five fields. Do not apply the
  // other video families' aliases, size defaults or metadata role inference.
  const allowed = ["model", "prompt", "size", "generation_mode", "reference_images"];
  for (const key of Object.keys(req)) {
    if (!allowed.includes(key)) throw new Error("unsupported Veo/Omni parameter: " + key);
  }
  if (typeof req.model !== "string" || !req.model.trim()) throw new Error("model is required");
  const prompt = req.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt is required");
  let characters = 0, bytes = 0;
  for (const character of prompt) {
    characters++;
    const code = character.codePointAt(0);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  if (characters > 10000 || bytes > 16384) throw new Error("prompt must not exceed 10000 characters or 16 KiB of UTF-8");
  const resolution = VEO_MODEL_RESOLUTIONS[model];
  const sizes = resolution === "720P" ? ["1280x720", "720x1280"] : ["1920x1080", "1080x1920"];
  if (!sizes.includes(req.size)) throw new Error("Veo/Omni size must be " + sizes.join(" or ") + " for the selected model");
  const images = req.reference_images === undefined ? [] : req.reference_images;
  if (!Array.isArray(images)) throw new Error("reference_images must be an array");
  if (images.length > 3) throw new Error("Veo/Omni supports at most 3 images");
  for (const url of images) {
    // The documentation does not enumerate all current storage hosts. The
    // provider checks storage membership; do not guess an allowlist here.
    // Input images must be uploaded public URLs without query strings.
    if (typeof url !== "string" || Array.from(url).length > 4096 || !/^https:\/\/[^/?#\s@\\]+\/[^?#\s\\]+$/i.test(url))
      throw new Error("Veo/Omni images require uploaded public HTTPS URLs without query strings or fragments");
  }
  // Use only the documented count default for validation, and preserve an
  // omitted mode upstream. Two URLs never imply first_last.
  const mode = req.generation_mode === undefined ? (images.length === 0 ? "text" : images.length === 1 ? "first_frame" : "reference") : req.generation_mode;
  if (!["text", "first_frame", "first_last", "reference"].includes(mode)) throw new Error("invalid Veo/Omni generation_mode");
  if ((mode === "text" && images.length !== 0) || (mode === "first_frame" && images.length !== 1) ||
      (mode === "first_last" && images.length !== 2) || (mode === "reference" && images.length === 0))
    throw new Error("generation_mode does not match the reference_images count");
  if ((mode === "first_frame" || mode === "first_last") && (model === "omni-flash-video" || model === "veo-3.1-fast-1080p"))
    throw new Error("Veo/Omni model does not support first or last frames at this resolution");
  if (mode === "reference" && model !== "omni-flash-video" && (model !== "veo-3.1-fast" || images.length !== 3))
    throw new Error("Veo reference mode requires exactly 3 images and the 720P Fast model");
  const body = { model, prompt, size: req.size };
  if (req.generation_mode !== undefined) body.generation_mode = req.generation_mode;
  if (req.reference_images !== undefined) body.reference_images = images.slice();
  return body;
}

function zhimengRequest(ctx) {
  if (ctx.requestBody && ctx.requestBody.duration !== undefined && typeof ctx.requestBody.duration !== "number") throw new Error("duration must be a number");
  const target = ctx.upstreamModel || ctx.model;
  const model = isMinimaxModel(target) ? MINIMAX_MODEL : target;
  if (isMinimaxModel(ctx.model) && model !== MINIMAX_MODEL) throw new Error("public MiniMax H3 model must not be remapped");
  if (WAN3_MODELS.includes(ctx.model) && model !== ctx.model) throw new Error("public WAN3 models must not be remapped");
  if (SEEDANCE_MODELS.includes(ctx.model) && model !== ctx.model) throw new Error("public Seedance models must not be remapped");
  if (VEO_MODELS.includes(model)) return normalizeVeoRequest(ctx.requestBody, model);
  if (model === MINIMAX_MODEL) return normalizeMinimaxRequest(ctx.requestBody, model);
  if (SEEDANCE_MODELS.includes(model)) return normalizeSeedanceRequest(ctx.requestBody, model);
  if (!WAN3_MODELS.includes(model)) throw new Error("unsupported Zhimeng model: " + model);
  return normalizeWan3Request(ctx.requestBody, model, "zhimeng");
}

export function buildSubmitRequest(ctx) {
  const req = zhimengRequest(ctx);
  if (VEO_MODELS.includes(req.model)) {
    return { url: ctx.baseUrl + "/v1/videos", method: "POST",
      headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" }, body: req };
  }
  if (req.model === MINIMAX_MODEL) {
    const media = req.metadata.input.media;
    if (media.some(item => item.type === "reference_video")) zhimengUsageLogs(ctx);
    const images = req.generation_mode === "frames"
      ? media.filter(item => item.type === "first_frame").concat(media.filter(item => item.type === "last_frame"))
      : media.filter(item => item.type === "reference_image");
    return {
      url: ctx.baseUrl + "/v1/videos", method: "POST",
      headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" },
      body: { model: "minimax-h3", prompt: req.prompt, duration: req.duration, resolution: ({ "480P": "480p", "1080P": "1080p" })[req.resolution] || req.resolution,
        ...req.metadata.parameters, aspect_ratio: req.ratio, generation_mode: req.generation_mode,
        image_urls: images.map(item => item.url),
        video_urls: media.filter(item => item.type === "reference_video").map(item => item.url),
        audio_urls: media.filter(item => item.type === "reference_audio").map(item => item.url) },
    };
  }
  if (SEEDANCE25_MODELS.includes(req.model)) {
    const body = { model: req.model, prompt: req.prompt, duration: req.duration, resolution: req.resolution.toLowerCase(), ratio: req.ratio };
    for (const item of [{ key: "reference_images", type: "reference_image" }, { key: "reference_videos", type: "reference_video" }, { key: "reference_audios", type: "reference_audio" }]) {
      const urls = req.metadata.input.media.filter(media => media.type === item.type).map(media => media.url);
      if (urls.length) body[item.key] = urls;
    }
    return { url: ctx.baseUrl + "/v1/videos", method: "POST",
      headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" }, body };
  }
  if (SEEDANCE20_MODELS.includes(req.model)) {
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
  if (body.status !== "failed" && (body.error || (body.code !== undefined && body.code !== 0 && body.code !== "0" && body.code !== "success")))
    throw new Error(body.error && body.error.message || body.message || "Zhimeng submission failed");
  const taskId = body.id || body.task_id;
  if (typeof taskId !== "string" || !taskId.trim()) throw new Error("task_id is empty");
  const req = zhimengRequest(ctx);
  const state = VEO_MODELS.includes(req.model) ? { model: req.model, resolution: VEO_MODEL_RESOLUTIONS[req.model] } :
    { model: req.model === MINIMAX_MODEL ? "minimax-h3" : req.model, duration: req.duration, resolution: req.resolution,
    hasReferenceVideo: req.metadata.input.media.some(item => item.type === "reference_video") };
  if ((WAN3_MODELS.includes(req.model) || req.model === MINIMAX_MODEL) && state.hasReferenceVideo)
    state.referenceVideoCount = req.metadata.input.media.filter(item => item.type === "reference_video").length;
  const response = { taskId, taskData: body, state };
  if (body.status === "completed" || body.status === "failed") {
    // Submission parsing has no utils.fetch on the existing host. Preserve a
    // verified completion, then let the ordinary poll hook read its bill.
    const result = parseTaskResult({ ...ctx, taskId }, body);
    if (result.status === "SUCCESS" && state.hasReferenceVideo) {
      state.completedSubmission = { status: "completed" };
      if (body.seconds !== undefined) state.completedSubmission.seconds = body.seconds;
      if (result.url) state.completedSubmission.url = result.url;
    } else if (result.status === "SUCCESS" || result.status === "FAILURE") {
      response.immediate = result;
    }
  }
  return response;
}

export function extractUsage(ctx) {
  const req = zhimengRequest(ctx);
  if (VEO_MODELS.includes(req.model)) return ctx.usagePurpose === "billing_ratios" ? {} : { video_count: 1, resolution: VEO_MODEL_RESOLUTIONS[req.model] };
  if (SEEDANCE_MODELS.includes(req.model)) return ctx.usagePurpose === "billing_ratios" ? {} : { video_count: 1 };
  if (req.model === MINIMAX_MODEL) {
    if (ctx.usagePurpose === "billing_ratios") return {};
    const media = req.metadata.input.media;
    return { seconds: req.duration, duration_tier: minimaxDurationTier(req.duration), resolution: req.resolution, fast_mode: req.metadata.parameters.fast_mode === true,
      priority_mode: req.metadata.parameters.fast_mode === true ? "priority" : "standard",
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
  if (VEO_MODELS.includes(task.upstreamModel || task.model)) return { video_count: 1 };
  if (SEEDANCE_MODELS.includes(task.upstreamModel || task.model)) return { video_count: 1 };
  if (!task.state || typeof task.state.hasReferenceVideo !== "boolean") throw new Error("missing Zhimeng submission state; retaining reserved usage");
  const minimax = isMinimaxModel(task.upstreamModel || task.model);
  body = task.state.completedSubmission || body;
  // H3 does not promise output duration in query responses. Keep the frozen
  // requested duration when it is absent, and never trust client media lengths.
  const seconds = minimax && (!body || body.seconds === undefined) ? task.state.duration : body && body.seconds;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < (minimax ? 4 : 2) || seconds > (minimax && task.state.resolution === "2K" ? 15 : 30))
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
        (!minimax && seconds + billing.seconds > 30))
      throw new Error("missing or invalid Zhimeng reference video billing; retaining reserved usage");
    return minimax ? { seconds, duration_tier: minimaxDurationTier(seconds), reference_video_seconds: billing.seconds } : { seconds: seconds + billing.seconds };
  }
  return minimax ? { seconds, duration_tier: minimaxDurationTier(seconds) } : { seconds };
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
  // A later snapshot cannot undo the completion already confirmed at submit.
  // Accounting failures still retain reserved usage, without changing success.
  const snapshot = ctx.state && ctx.state.completedSubmission || body;
  const data = snapshot && typeof snapshot === "object" ? snapshot : {};
  let status = { queued: "QUEUED", in_progress: "IN_PROGRESS", completed: "SUCCESS", failed: "FAILURE" }[data.status] || "UNKNOWN";
  if (status === "SUCCESS" && (data.error || (data.code !== undefined && data.code !== 0 && data.code !== "0" && data.code !== "success"))) status = "UNKNOWN";
  const result = { status };
  if (typeof data.progress === "number" && Number.isFinite(data.progress) && data.progress >= 0 && data.progress <= 100) result.progress = data.progress + "%";
  if (status === "SUCCESS") {
    const urls = [data.content && data.content.url, data.video_url, data.url, data.result_url, data.media_url, Array.isArray(data.output) ? data.output[0] : undefined, data.object];
    for (const url of urls) {
      if (typeof url === "string" && /^https?:\/\//i.test(url)) { result.url = url; break; }
    }

  }
  if (status === "FAILURE") result.reason = videoFailureMessage(data, undefined, ctx);
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
        try { other = typeof log.other === "string" ? JSON.parse(log.other) : log.other; } catch { continue; }
        if (!other || other.task_id !== ctx.taskId || other.is_task !== true) continue;
        if (billing) throw new Error("ambiguous billing record");
        const charge = other.reference_video_charge;
        if (!charge || typeof charge.seconds !== "number" || !Number.isFinite(charge.seconds) || charge.seconds <= 0 || charge.seconds > 15 ||
            (!isMinimaxModel(ctx.upstreamModel || ctx.model) && charge.seconds + ctx.state.duration > 30) || charge.resolution !== ctx.state.resolution ||
            !Number.isInteger(charge.video_count) || charge.video_count < 1 || charge.video_count > ctx.state.referenceVideoCount)
          throw new Error("invalid reference video billing record");
        billing = { taskId: ctx.taskId, seconds: charge.seconds, resolution: charge.resolution, videoCount: charge.video_count };
      }
      if (!billing) throw new Error("reference video billing record not found");
      state.referenceVideoBilling = billing;
      delete state.referenceVideoBillingError;
    } catch {
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
  const model = ctx.state && ctx.state.model || ctx.upstreamModel || ctx.model;
  if (SEEDANCE_MODELS.includes(model)) {
    const result = parseTaskResult(ctx, ctx.data);
    if (result.status !== "SUCCESS" || !result.url) throw new Error("Seedance video URL is unavailable");
    const contentURL = ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.upstreamTaskId) + "/content";
    if (SEEDANCE25_MODELS.includes(model) && result.url.split(/[?#]/, 1)[0] === contentURL)
      return { url: result.url, method: ctx.clientRequest.method, headers: { Authorization: "Bearer " + ctx.apiKey } };
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
