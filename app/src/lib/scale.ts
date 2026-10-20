// Balança do caixa ligada no computador (cabo serial ou USB-serial).
// Funciona no app de Windows e no Chrome/Edge do computador. Protocolo comum de Toledo, Filizola, Urano e Elgin:
// o PDV manda ENQ (0x05) e a balança responde STX + peso + ETX. Ex.: STX "01234" ETX = 1,234 kg.

import { getDevice, setDevice } from './db';

export interface ScaleSettings {
  enabled: boolean;
  baudRate: number;
  brand: 'toledo' | 'filizola' | 'urano' | 'outra';
}

export const DEFAULT_SCALE_SETTINGS: ScaleSettings = { enabled: false, baudRate: 9600, brand: 'toledo' };

/* eslint-disable @typescript-eslint/no-explicit-any */
const serial = (): any => (navigator as any).serial;
export const scaleSupported = () => !!serial();

let port: any = null;

export async function getScaleSettings() {
  return { ...DEFAULT_SCALE_SETTINGS, ...(await getDevice<Partial<ScaleSettings>>('scaleSerial', {})) };
}

export async function setScaleSettings(s: ScaleSettings) {
  await setDevice('scaleSerial', s);
  await closeScale();
}

/** Pede ao usuário para escolher a porta da balança (só na configuração). */
export async function pickScalePort() {
  if (!scaleSupported()) throw new Error('Este aparelho não aceita balança no cabo. Use o app de Windows ou o Chrome no computador.');
  await closeScale();
  port = await serial().requestPort();
  return true;
}

async function openPort() {
  const s = await getScaleSettings();
  if (!port) {
    const ports = await serial().getPorts();
    port = ports[0] || null;
  }
  if (!port) throw new Error('Balança não configurada. Vá em Configurações › Caixa.');
  if (!port.readable) await port.open({ baudRate: s.baudRate, dataBits: 8, stopBits: 1, parity: 'none' });
  return port;
}

export async function closeScale() {
  try { await port?.close(); } catch { /* já fechada */ }
}

function parse(bytes: number[]): number | null {
  const text = String.fromCharCode(...bytes);
  const m = text.match(/\x02([^\x03]*)\x03/);
  const body = (m ? m[1] : text).trim();
  if (/^[IN]+$/i.test(body) || body.includes('I')) throw new Error('Peso instável. Espere a balança parar.');
  if (/^S+$/i.test(body)) throw new Error('Peso acima do limite da balança');
  const digits = body.replace(/[^\d]/g, '');
  if (digits.length < 4) return null;
  return Number(digits) / 1000;
}

/** Lê o peso em kg. */
export async function readWeight(timeoutMs = 2500): Promise<number> {
  const p = await openPort();
  const writer = p.writable.getWriter();
  await writer.write(new Uint8Array([0x05]));
  writer.releaseLock();
  const reader = p.readable.getReader();
  const got: number[] = [];
  const timer = setTimeout(() => reader.cancel().catch(() => undefined), timeoutMs);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      got.push(...value);
      if (got.includes(0x03) || got.length > 32) break;
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const kg = parse(got);
  if (kg === null) throw new Error('A balança não respondeu. Confira o cabo e a velocidade.');
  if (kg <= 0) throw new Error('Coloque o produto na balança');
  return kg;
}
