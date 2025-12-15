// Web shim: BLE scanning is not supported on web/Expo Web.
// Provide a safe placeholder that won't crash on import or basic usage.

type Callback = (error: any, characteristic: any) => void;
type Listener = { remove: () => void };

class Subscription {
  remove() {
    // no-op on web
  }
}

export class BleManager {
  // Do not throw in constructor; allow screen to render and fail gracefully when methods are called.
  constructor() {}

  // Observe state; on web, report poweredOff/unsupported and return a removable listener
  onStateChange(callback: (state: string) => void, emitCurrentState?: boolean): Listener {
    try {
      if (emitCurrentState) callback('poweredOff');
    } catch {}
    return { remove: () => {} };
  }

  // Start scan: do NOT throw; surface the error via callback so UI can show inline tips
  startDeviceScan(_filters?: any, _options?: any, listener?: (error: any, device: any) => void) {
    const err = new Error('BLE is not supported on web');
    try { listener && listener(err, null); } catch {}
    // no-op
  }

  stopDeviceScan() { /* no-op */ }

  async isDeviceConnected(_id: string): Promise<boolean> { return false; }

  async connectedDevices(_serviceUUIDs: string[]): Promise<any[]> { return []; }

  cancelDeviceConnection(_id?: string) { /* no-op */ }

  cancelTransaction(_transactionId?: string) { /* no-op on web */ }

  async connectToDevice(_id: string, _opts?: any): Promise<any> {
    // Reject to be caught by callers
    return Promise.reject(new Error('BLE is not supported on web'));
  }

  async discoverAllServicesAndCharacteristicsForDevice(_id: string): Promise<any> {
    return Promise.reject(new Error('BLE is not supported on web'));
  }

  // Some code paths call a generic discover method; provide a no-op for compatibility
  async discoverAllServicesAndCharacteristics(): Promise<void> {
    // no-op
  }

  // Monitor notifications: report unsupported via callback; return a removable subscription.
  monitorCharacteristicForService(_serviceUUID: string, _charUUID: string, cb: Callback, _transactionId?: string): Subscription {
    try { cb(new Error('BLE notifications not supported on Web'), null); } catch {}
    return new Subscription();
  }

  async writeCharacteristicWithResponseForService(_serviceUUID: string, _characteristicUUID: string, _valueBase64: string): Promise<any> {
    return Promise.reject(new Error('BLE is not supported on web'));
  }

  async readCharacteristicForService(_serviceUUID: string, _characteristicUUID: string): Promise<any> {
    // Return an empty payload in base64 shape to avoid crashes when read is attempted on web.
    return { value: '' };
  }
}

export default BleManager;