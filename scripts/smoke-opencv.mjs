// Vérifie qu'OpenCV.js (WASM) s'initialise en Node et expose les briques de détection.
import cv from '@techstark/opencv-js'

const ready = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout init OpenCV')), 30000)
  if (cv && cv.Mat) {
    clearTimeout(t)
    resolve()
    return
  }
  cv.onRuntimeInitialized = () => {
    clearTimeout(t)
    resolve()
  }
})

await ready
console.log('OpenCV prêt. CV_8UC1 =', cv.CV_8UC1)
console.log('CascadeClassifier dispo :', typeof cv.CascadeClassifier)
const m = new cv.Mat(180, 320, cv.CV_8UC1)
console.log('Mat créée :', m.rows, 'x', m.cols)
m.delete()
const ok = typeof cv.CascadeClassifier === 'function' && cv.CV_8UC1 !== undefined
console.log(ok ? '\nOK — OpenCV.js opérationnel en Node.' : '\nÉCHEC')
process.exit(ok ? 0 : 1)
