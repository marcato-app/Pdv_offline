import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui';
import { vibrate } from '../lib/haptics';

// Leitor de código de barras pela câmera (celular, tablet ou webcam).
// Usa o leitor nativo do navegador quando existe; senão carrega o ZXing só na hora.

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

export const HAS_CAMERA = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

function beepOk() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 1800;
    o.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 90);
  } catch { /* sem som */ }
}

export function CameraScan({ onCode, onClose, continuous = false, title = 'Ler código pela câmera' }: {
  onCode: (code: string) => void; onClose: () => void; continuous?: boolean; title?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const [last, setLast] = useState('');
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let zxingStop: (() => void) | null = null;
    let lastCode = '';
    let lastAt = 0;
    const got = (c: string) => {
      const now = Date.now();
      if (c === lastCode && now - lastAt < 2000) return;
      lastCode = c;
      lastAt = now;
      beepOk();
      vibrate('ok');
      setLast(c);
      cb.current(c);
      if (!continuous) { stop = true; onClose(); }
    };

    (async () => {
      try {
        // Câmera de trás; se o aparelho recusar as preferências, tenta a câmera padrão.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        } catch (e1) {
          if ((e1 as Error)?.name === 'NotAllowedError') throw e1;
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (stop) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        if (BD) {
          const det = new BD({ formats: FORMATS });
          const loop = async () => {
            if (stop) return;
            try {
              const r = await det.detect(v);
              if (r[0]?.rawValue) got(r[0].rawValue);
            } catch { /* quadro ruim, tenta o próximo */ }
            if (!stop) setTimeout(loop, 120);
          };
          loop();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (stop) return;
          const reader = new BrowserMultiFormatReader();
          const ctl = await reader.decodeFromVideoElement(v, (res) => { if (res && !stop) got(res.getText()); });
          zxingStop = () => ctl.stop();
        }
      } catch (e) {
        const name = (e as Error)?.name;
        const ios = /iPhone|iPad/.test(navigator.userAgent);
        setErr(name === 'NotAllowedError' ? (ios ? 'A câmera está bloqueada. No iPhone: Ajustes → Safari → Câmera → Permitir (ou toque em "aA" na barra de endereço → Ajustes do Site → Câmera).' : 'A câmera está bloqueada. Toque no cadeado ao lado do endereço e permita a câmera.') : name === 'NotFoundError' ? 'Nenhuma câmera encontrada neste aparelho.' : 'Não foi possível abrir a câmera.');
      }
    })();

    return () => {
      stop = true;
      zxingStop?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Modal title={title} onClose={onClose} footer={<button className="btn" onClick={onClose}>{continuous ? 'Fechar câmera' : 'Cancelar'}</button>}>
      {err ? <div className="error">{err}</div> : (
        <div className="scan-box">
          <video ref={video} playsInline muted />
          <span className="scan-frame" />
          <span className="scan-line" />
        </div>
      )}
      <span className="muted small">{last ? `Lido: ${last}` : 'Aponte a câmera para o código de barras.'}{continuous ? ' A câmera continua aberta para o próximo produto.' : ''}</span>
    </Modal>
  );
}

/** Botão com ícone de câmera que abre o leitor. */
/** Botão com ícone de câmera. Com onOpen, quem usa abre o leitor (no caixa ele fica na tela inteira, fora do campo). */
export function CameraButton({ onCode, continuous, className = 'btn', label, onOpen }: { onCode?: (code: string) => void; continuous?: boolean; className?: string; label?: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  if (!HAS_CAMERA) return null;
  return (
    <>
      <button type="button" className={className + ' cam-btn'} aria-label="Ler código pela câmera" title="Ler código pela câmera" onMouseDown={(e) => e.preventDefault()} onClick={() => (onOpen ? onOpen() : setOpen(true))}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8" />
        </svg>
        {label}
      </button>
      {open && onCode && <CameraScan continuous={continuous} onCode={onCode} onClose={() => setOpen(false)} />}
    </>
  );
}
