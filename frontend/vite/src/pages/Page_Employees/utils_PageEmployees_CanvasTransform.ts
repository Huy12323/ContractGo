type FitParams = {
  vpW: number
  vpH: number
  contentW: number
  contentH: number
  zoomMin: number
  zoomMax: number
  margin: number
}

export const computeFitTransform = ({ vpW, vpH, contentW, contentH, zoomMin, zoomMax, margin }: FitParams) => {
  const availableW = Math.max(1, vpW - margin * 2)
  const availableH = Math.max(1, vpH - margin * 2)
  const safeContentW = Math.max(1, contentW)
  const safeContentH = Math.max(1, contentH)
  const fitZoom = Math.min(availableW / safeContentW, availableH / safeContentH, 1)
  const zoom = Math.max(zoomMin, Math.min(zoomMax, fitZoom))
  return {
    zoom,
    pan: {
      x: (vpW - safeContentW * zoom) / 2,
      y: (vpH - safeContentH * zoom) / 2,
    },
  }
}

type ZoomAnchorParams = {
  prevPan: { x: number; y: number }
  prevZoom: number
  newZoom: number
  anchor: { x: number; y: number }
}

export const applyZoomAnchored = ({ prevPan, prevZoom, newZoom, anchor }: ZoomAnchorParams) => {
  const ratio = newZoom / prevZoom
  return {
    x: anchor.x - (anchor.x - prevPan.x) * ratio,
    y: anchor.y - (anchor.y - prevPan.y) * ratio,
  }
}
