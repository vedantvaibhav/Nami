import { addDays, toISO, startOfDay } from './time.js'
import { saveImage } from './store.js'

// A little canvas-painted sunset so the demo has a polaroid from day one
async function makeSeedPhoto() {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 480
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, 480)
  g.addColorStop(0, '#FFD9A0')
  g.addColorStop(0.55, '#FF9A8B')
  g.addColorStop(1, '#7F7FD5')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 640, 480)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(320, 310, 58, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(60,50,120,0.35)'
  ctx.fillRect(0, 388, 640, 92)
  return new Promise((r) => c.toBlob(r, 'image/png'))
}

export async function seedMemories() {
  const today = startOfDay(new Date())
  const d = (n) => toISO(addDays(today, n))
  const imgId = crypto.randomUUID()
  await saveImage(imgId, await makeSeedPhoto())

  return [
    {
      id: crypto.randomUUID(),
      type: 'quote',
      title: 'The best art is made for an audience of one',
      body: '',
      date: d(-85),
      color: 'blue',
      y: 430,
      tilt: 0,
    },
    {
      id: crypto.randomUUID(),
      type: 'note',
      title: 'First spark 💡',
      body: 'Saw a timeline that felt like a scrapbook. Had to make one.',
      date: d(-60),
      color: 'yellow',
      y: 190,
      tilt: 0,
    },
    {
      id: crypto.randomUUID(),
      type: 'photo',
      title: 'golden hour',
      body: '',
      date: d(-38),
      color: 'peach',
      y: 300,
      tilt: -2.5,
      media: [{ id: imgId, kind: 'image', name: 'golden-hour.png' }],
    },
    {
      id: crypto.randomUUID(),
      type: 'note',
      title: 'why the hell not?',
      body: '',
      date: d(-14),
      color: 'purple',
      y: 170,
      tilt: 0,
    },
    {
      id: crypto.randomUUID(),
      type: 'note',
      title: 'Started this timeline ✨',
      body: 'Click anywhere to add a memory. Drop a photo. ⌘V to paste.',
      date: d(0),
      color: 'mint',
      y: 360,
      tilt: 0,
    },
  ]
}
