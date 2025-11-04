import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type DiscoveredDevice = {
  name?: string;
  host?: string;
  port?: number;
  ip?: string;
  txt?: Record<string, string> | null;
  fullName?: string;
};

const isNativeWithModules = Platform.OS !== 'web' && (Constants.appOwnership !== 'expo');

export async function discoverDevices(timeoutMs = 5000): Promise<DiscoveredDevice[]> {
  if (!isNativeWithModules) {
    // Web / Expo Go fallback: attempt known hostnames
    const candidates = ['http://esp32.local/health', 'http://esp32.local', 'http://192.168.4.1'];
    const results: DiscoveredDevice[] = [];
    for (const url of candidates) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (res.ok) results.push({ name: 'esp32', host: url, ip: url, port: 80 });
      } catch {}
    }
    return results;
  }
  try {
    const ZeroconfMod: any = await import('react-native-zeroconf');
    const zeroconf = new ZeroconfMod.default();
    const devices: DiscoveredDevice[] = [];

    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { zeroconf.stop(); } catch {}
        resolve(devices);
      }, timeoutMs);

      zeroconf.on('resolved', (service: any) => {
        const name: string = service?.name || '';
        const type: string = service?.type || '';
        const ip: string = (service?.addresses?.[0] || service?.host || '') as string;
        const port: number = service?.port || 80;
        const fullname: string = service?.fullName || '';
        const txt: Record<string, string> | null = service?.txt || null;
        const attractive = /esp|pinme|rfid/i.test(name) || /esp/i.test(fullname) || /_http\._tcp/i.test(type);
        if (attractive) {
          devices.push({ name, ip, port, fullName: fullname, txt });
        }
      });
      zeroconf.on('error', () => {
        try { clearTimeout(timer); zeroconf.stop(); } catch {}
        resolve(devices);
      });
      zeroconf.on('stop', () => {
        try { clearTimeout(timer); } catch {}
        resolve(devices);
      });

      try {
        zeroconf.scan();
      } catch {
        try { clearTimeout(timer); zeroconf.stop(); } catch {}
        resolve(devices);
      }
    });
  } catch {
    // Module not available
    return [];
  }
}