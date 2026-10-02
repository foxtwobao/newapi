const MODELS = [
  "wan3.0-video-480p", "wan3.0-video-720p", "wan3.0-video-1080p",
  "wan3.0-video-prime-480p", "wan3.0-video-prime-720p", "wan3.0-video-prime-1080p",
  "wan3.0-image-480p", "wan3.0-image-720p", "wan3.0-image-1080p",
  "wan3.0-image-prime-480p", "wan3.0-image-prime-720p", "wan3.0-image-prime-1080p",
];

export const meta = {
  apiVersion: 1,
  key: "rolldek",
  name: "RollDek",
  icon: "text:RD",
  description: { en: "RollDek WAN 3.0 video generation", zh: "RollDek 万相 3.0 视频生成" },
  version: "1.0.0",
  author: { name: "Community" },
  baseUrl: "https://rolldek.com",
  models: MODELS,
  fetchMode: "per_task",
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
  },
  protocols: [{ name: "openai_video", models: MODELS }],
};

function profile(model) {
  const match = /^wan3\.0-(video|image)(-prime)?-(480|720|1080)p$/.exec(model || "");
  if (!match) throw new Error("unsupported RollDek model: " + model);
  return { image: match[1] === "image", size: match[3] + "P" };
}

function duration(req) {
  if (req.seconds !== undefined && req.duration !== undefined && Number(req.seconds) !== Number(req.duration))
    throw new Error("seconds and duration must match");
  const value = req.seconds ?? req.duration ?? 5;
  if (typeof value !== "string" && typeof value !== "number") throw new Error("seconds must be an integer");
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error("seconds must be an integer between 1 and 3600");
  return seconds;
}

function publicURL(value, field) {
  if (typeof value !== "string" || !/^https:\/\/[^/?#]+(?:[/?#]|$)/i.test(value)) throw new Error(field + " must be a public HTTPS URL");
  return value;
}

function media(req, imageModel) {
  if (req.input !== undefined && (!req.input || typeof req.input !== "object" || Array.isArray(req.input)))
    throw new Error("input must be an object");
  const images = req.reference_images ?? [];
  const videos = req.reference_videos ?? [];
  const audios = req.reference_audios ?? [];
  const advanced = req.input && req.input.media !== undefined ? req.input.media : [];
  if (!Array.isArray(images) || !Array.isArray(videos) || !Array.isArray(audios) || !Array.isArray(advanced))
    throw new Error("reference media and input.media must be arrays");
  if (images.length > 10) throw new Error("too many reference images");
  const refs = { images: [], videos: [], audios: [], advanced: [] };
  const videoURLs = new Set();
  let inputVideoSeconds = 0;
  let imageCount = 0;
  for (const image of images) {
    if (!image || typeof image !== "object" || Array.isArray(image) || ![undefined, "reference_image", "first_frame", "last_frame"].includes(image.role))
      throw new Error("invalid reference image");
    refs.images.push({ url: publicURL(image.url, "reference image"), role: image.role || "reference_image" });
    imageCount++;
  }
  function addVideo(video) {
    if (imageModel) throw new Error("image models do not support reference videos");
    const url = publicURL(typeof video === "string" ? video : video && video.url, "reference video");
    if (videoURLs.has(url)) return;
    videoURLs.add(url);
    const hint = typeof video === "object" && video !== null ? video.duration ?? video.seconds : undefined;
    const estimated = hint === undefined ? 30 : Number(hint);
    if (!Number.isFinite(estimated) || estimated <= 0 || estimated > 3600) throw new Error("reference video duration must be between 0 and 3600");
    inputVideoSeconds += estimated;
    refs.videos.push({ url });
  }
  for (const video of videos) addVideo(video);
  for (const audio of audios) refs.audios.push({ url: publicURL(audio && audio.url, "reference audio") });
  for (const item of advanced) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid input.media item");
    const type = item.type;
    if (!["reference_image", "first_frame", "last_frame", "reference_video", "reference_audio"].includes(type))
      throw new Error("invalid input.media type");
    const url = publicURL(item.url, "input.media URL");
    if (type === "reference_video") addVideo(item);
    else if (type === "reference_audio") refs.advanced.push({ type, url });
    else {
      imageCount++;
      refs.advanced.push({ type, url });
    }
  }
  if (imageCount > 10) throw new Error("too many reference images");
  if (imageModel && imageCount === 0) throw new Error("image models require a reference image");
  return { refs, inputVideoSeconds };
}

function normalize(req, model) {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
  if (typeof req.prompt !== "string" || !req.prompt.trim()) throw new Error("prompt is required");
  const target = profile(model);
  const seconds = duration(req);
  const { refs, inputVideoSeconds } = media(req, target.image);
  if (seconds + inputVideoSeconds > 3600) throw new Error("estimated billable seconds exceed 3600");
  const ratio = req.aspect_ratio ?? req.ratio;
  if (ratio !== undefined && !["16:9", "9:16", "1:1", "adaptive"].includes(ratio)) throw new Error("invalid aspect_ratio");
  const body = { model, prompt: req.prompt.trim(), seconds: String(seconds), size: target.size, resolution: target.size };
  if (ratio !== undefined) body.aspect_ratio = ratio;
  if (refs.images.length) body.reference_images = refs.images;
  if (refs.videos.length) body.reference_videos = refs.videos;
  if (refs.audios.length) body.reference_audios = refs.audios;
  if (refs.advanced.length) body.input = { media: refs.advanced };
  return { body, billableSeconds: seconds + inputVideoSeconds };
}

export function buildSubmitRequest(ctx) {
  const model = ctx.upstreamModel || ctx.model;
  const request = normalize(ctx.requestBody, model);
  return {
    url: ctx.baseUrl + "/v1/videos", method: "POST",
    headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" },
    body: request.body,
  };
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {};
  const taskId = body.id || body.task_id;
  if (!taskId) throw new Error("task_id is empty");
  return { taskId, taskData: body };
}

export function extractUsage(ctx) {
  return { seconds: normalize(ctx.requestBody, ctx.upstreamModel || ctx.model).billableSeconds };
}

export function extractUsageOnComplete(task, result, body) {
  const usage = (body && body.usage) || {};
  const output = usage.output_video_duration ?? usage.duration;
  const input = usage.input_video_duration;
  if (output === undefined || (!profile(task.upstreamModel || task.model).image && input === undefined)) return {};
  const total = Number(output) + (profile(task.upstreamModel || task.model).image ? 0 : Number(input));
  return Number.isFinite(total) && total >= 0 ? { seconds: total } : {};
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
      const req = ctx.body.value;
      const resolved = normalize(req, ctx.upstreamModel || ctx.model);
      return { kind: "submit", model: ctx.model, action: "video_generation", requestBody: Object.assign({}, req, { model: ctx.model, seconds: resolved.body.seconds }) };
    },
    render: function (ctx, task) { return task.data || {}; },
  },
};
