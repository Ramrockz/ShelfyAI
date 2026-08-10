// Shared "Scan Barcode" sheet -- live camera decode (native BarcodeDetector
// where available, lazily-loaded ZXing elsewhere) plus an always-visible
// manual entry input. Requires the #bcScanModal markup (copied into the
// consuming page) with #bcScanVideo/#bcStatus/#bcManualInput, and
// barcode-scanner.css for styling.
//
// Usage: openBarcodeScan(code => { ...use code... }). The callback fires
// exactly once, from whichever path (camera or manual) resolves first.
let _bcStream = null;
let _bcRAF = null;
let _bcZXingReader = null;
let _bcOnResult = null;
const _BC_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'codabar', 'itf'];

async function openBarcodeScan(onResult) {
  _bcOnResult = onResult;
  document.getElementById('bcManualInput').value = '';
  document.getElementById('bcStatus').textContent = 'Requesting camera…';
  document.getElementById('bcScanModal').classList.add('active');
  try {
    _bcStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.getElementById('bcScanVideo');
    video.srcObject = _bcStream;
    document.getElementById('bcStatus').textContent = 'Point the camera at a barcode';
    startBarcodeDecodeLoop(video);
  } catch (e) {
    document.getElementById('bcStatus').textContent = 'Camera unavailable — enter the number below instead.';
  }
}

function startBarcodeDecodeLoop(video) {
  if ('BarcodeDetector' in window) {
    BarcodeDetector.getSupportedFormats().then((supported) => {
      const formats = _BC_FORMATS.filter((f) => supported.includes(f));
      const detector = new BarcodeDetector(formats.length ? { formats } : undefined);
      const tick = async () => {
        if (!_bcStream) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) { handleBarcodeResult(codes[0].rawValue); return; }
        } catch (e) {}
        _bcRAF = requestAnimationFrame(tick);
      };
      tick();
    });
    return;
  }
  loadZXing()
    .then(() => {
      _bcZXingReader = new ZXing.BrowserMultiFormatReader();
      _bcZXingReader.decodeFromVideoElement(video, (result) => {
        if (result) handleBarcodeResult(result.getText());
      });
    })
    .catch(() => {
      document.getElementById('bcStatus').textContent = 'Scanning isn’t supported on this browser — enter the number below.';
    });
}

function loadZXing() {
  if (window.ZXing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/@zxing/library@0.20.0/umd/index.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function handleBarcodeResult(code) {
  const cb = _bcOnResult;
  closeBarcodeScan();
  if (cb) cb(code);
}

function useManualBarcode() {
  const v = document.getElementById('bcManualInput').value.trim();
  if (!v) return;
  handleBarcodeResult(v);
}

function closeBarcodeScan() {
  document.getElementById('bcScanModal')?.classList.remove('active');
  if (_bcRAF) { cancelAnimationFrame(_bcRAF); _bcRAF = null; }
  if (_bcZXingReader) { try { _bcZXingReader.reset(); } catch (e) {} _bcZXingReader = null; }
  if (_bcStream) { _bcStream.getTracks().forEach((t) => t.stop()); _bcStream = null; }
}
