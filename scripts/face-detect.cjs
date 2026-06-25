// Détection de visage isolée dans un PROCESS ENFANT.
// OpenCV.js (asm.js) bloque le thread principal d'Electron de façon synchrone ;
// l'exécuter ici (electron-as-node) garde l'UI fluide et permet de TUER ce
// process si jamais il traîne. Entrée : un JSON en argv[2]. Sortie : {"centerX": n|null}.
const fs = require('fs')
const { spawnSync } = require('child_process')
const cv = require('@techstark/opencv-js')

const arg = JSON.parse(process.argv[2] || '{}')
const { ffmpeg, source, start, end, cascade } = arg
const FW = 320
const FH = 180
const FSIZE = FW * FH
const SAMPLES = 8

function ready() {
  return new Promise((r) => {
    if (cv.Mat) return r()
    cv.onRuntimeInitialized = () => r()
  })
}

/** Une image grise 320x180 à l'instant t, par seek rapide (décode ~1 GOP). */
function grab(t) {
  const res = spawnSync(
    ffmpeg,
    [
      '-ss',
      String(t),
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      `scale=${FW}:${FH},format=gray`,
      '-f',
      'rawvideo',
      '-'
    ],
    { maxBuffer: 1 << 26 }
  )
  const b = res.stdout
  return b && b.length >= FSIZE ? b.subarray(0, FSIZE) : null
}

;(async () => {
  await ready()
  const data = fs.readFileSync(cascade)
  try {
    cv.FS_unlink('/c.xml')
  } catch {
    /* premier chargement */
  }
  cv.FS_createDataFile('/', 'c.xml', data, true, false, false)
  const cls = new cv.CascadeClassifier()
  cls.load('c.xml')

  const dur = Math.max(0.2, end - start)
  const minSize = new cv.Size(48, 48)
  const maxSize = new cv.Size()
  const centers = []

  for (let k = 0; k < SAMPLES; k++) {
    const t = start + ((k + 0.5) / SAMPLES) * dur
    const frame = grab(t)
    if (!frame) continue
    const mat = new cv.Mat(FH, FW, cv.CV_8UC1)
    mat.data.set(frame)
    const faces = new cv.RectVector()
    try {
      cls.detectMultiScale(mat, faces, 1.25, 3, 0, minSize, maxSize)
      let best = null
      for (let j = 0; j < faces.size(); j++) {
        const r = faces.get(j)
        if (!best || r.width * r.height > best.width * best.height) best = r
      }
      if (best) centers.push((best.x + best.width / 2) / FW)
    } catch {
      /* image ignorée */
    }
    faces.delete()
    mat.delete()
  }

  let centerX = null
  if (centers.length) {
    centers.sort((a, b) => a - b)
    centerX = centers[Math.floor(centers.length / 2)]
  }
  process.stdout.write(JSON.stringify({ centerX }))
  process.exit(0)
})().catch(() => {
  process.stdout.write(JSON.stringify({ centerX: null }))
  process.exit(1)
})
