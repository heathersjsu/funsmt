// Native shim: provide a safe wrapper that does NOT import react-native-ble-plx at module load time.
// This avoids render errors in Expo Go / Dev Client where the native module is unavailable.
// The wrapper tries to require the real module lazily in the constructor. If unavailable, it
// provides friendly errors for BLE operations, allowing the app to show inline messages instead
// of crashing the whole screen.

type Listener = { remove: () => void };

export class BleManager {
  private _real: any | null = null;

  constructor() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('react-native-ble-plx');
      const Real = mod?.BleManager || mod?.default;
      if (Real) {
        this._real = new Real();
      } else {
        this._real = null;
        console.warn('BLE native module unavailable (react-native-ble-plx not linked). Use Dev Client or a release build.');
      }
    } catch (e) {
      this._real = null;
      console.warn('BLE native module unavailable (react-native-ble-plx not installed). Use Dev Client or a release build.');
    }
  }

  // Proxy methods used by the app. When the real manager is missing, throw a clear error or no-op.
  onStateChange(callback: (state: string) => void, emitCurrentState?: boolean): Listener {
    if (this._real?.onStateChange) return this._real.onStateChange(callback, emitCurrentState);
    // Return a removable listener to satisfy call sites
    return { remove: () => {} };
  }

  startDeviceScan(filters: any, options: any, listener: (error: any, device: any) => void) {
    if (this._real?.startDeviceScan) return this._real.startDeviceScan(filters, options, listener);
    const err = new Error('BLE scan unavailable: react-native-ble-plx not available (use Dev Client or release build)');
    try { listener(err, null); } catch {}
    throw err;
  }

  stopDeviceScan() {
    try { if (this._real?.stopDeviceScan) return this._real.stopDeviceScan(); } catch {}
  }

  async connectToDevice(id: string, opts?: any) {
    if (this._real?.connectToDevice) return this._real.connectToDevice(id, opts);
    throw new Error('BLE connect unavailable: react-native-ble-plx not available');
  }

  async discoverAllServicesAndCharacteristicsForDevice(id: string) {
    if (this._real?.discoverAllServicesAndCharacteristicsForDevice) return this._real.discoverAllServicesAndCharacteristicsForDevice(id);
    throw new Error('BLE discover unavailable: react-native-ble-plx not available');
  }

  async readCharacteristicForService(serviceUUID: string, characteristicUUID: string) {
    if (this._real?.readCharacteristicForService) return this._real.readCharacteristicForService(serviceUUID, characteristicUUID);
    throw new Error('BLE read unavailable: react-native-ble-plx not available');
  }

  async writeCharacteristicWithResponseForService(serviceUUID: string, characteristicUUID: string, valueBase64: string) {
    if (this._real?.writeCharacteristicWithResponseForService) return this._real.writeCharacteristicWithResponseForService(serviceUUID, characteristicUUID, valueBase64);
    throw new Error('BLE write unavailable: react-native-ble-plx not available');
  }

  async cancelDeviceConnection(id: string) {
    if (this._real?.cancelDeviceConnection) return this._real.cancelDeviceConnection(id);
    // No-op when not available
    return;
  }
}