/**
 * Face recognition helpers built on top of face-api.js.
 */

const FACE_MODEL_URL =
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

let _modelsLoaded = false;

// Reuse the same options object — avoids GC pressure on mobile
const _detectorOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 160,      // smallest supported — fastest inference
  scoreThreshold: 0.4  // slightly lower so it works on mobile cameras
});

/**
 * Pre-load the three required model weights.
 */
async function loadFaceModels() {
  if (_modelsLoaded) return;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL_URL), // tiny landmark net — much faster
    faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL)
  ]);
  _modelsLoaded = true;
}

function areModelsLoaded() {
  return _modelsLoaded;
}

/**
 * Detect a single face and return its 128-d descriptor.
 * Uses the tiny landmark net for speed.
 *
 * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} input
 * @returns {Promise<Float32Array|null>}
 */
async function detectFace(input) {
  const detection = await faceapi
    .detectSingleFace(input, _detectorOptions)
    .withFaceLandmarks(true)   // true = use tiny landmark model
    .withFaceDescriptor();

  return detection ? detection.descriptor : null;
}

/**
 * Compare two descriptors — returns Euclidean distance.
 */
function compareFaces(d1, d2) {
  return faceapi.euclideanDistance(d1, d2);
}

/**
 * Returns { match, distance, threshold }.
 */
function verifyFace(liveDescriptor, referenceDescriptor, threshold = 0.6) {
  const distance = compareFaces(liveDescriptor, referenceDescriptor);
  return { match: distance <= threshold, distance, threshold };
}

/**
 * Draw detection overlay on a canvas (admin photo preview use).
 */
async function drawFaceOverlay(video, canvas) {
  const detection = await faceapi
    .detectSingleFace(video, _detectorOptions)
    .withFaceLandmarks(true);
  if (!detection) return;
  const dims    = faceapi.matchDimensions(canvas, video, true);
  const resized = faceapi.resizeResults(detection, dims);
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  faceapi.draw.drawDetections(canvas, resized);
  faceapi.draw.drawFaceLandmarks(canvas, resized);
}
