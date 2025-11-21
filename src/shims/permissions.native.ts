// Native shim that avoids requiring `react-native-permissions`.
// Implements minimal permission helpers using React Native's built-in APIs on Android.
// On iOS, we return GRANTED and rely on module-specific permission prompts (e.g., expo-camera).
import { PermissionsAndroid, Platform } from 'react-native';

// Align shapes with react-native-permissions as much as is useful for current app usage
export const RESULTS = {
  GRANTED: 'granted',
  DENIED: 'denied',
  NEVER_ASK_AGAIN: 'never_ask_again',
  BLOCKED: 'blocked',
} as any;

// Provide a more complete map of Android permissions referenced in the app.
// Use string literals for newer Android 12+/13+ permissions to ensure checks/requests don't crash
// on React Native versions where PermissionsAndroid.PERMISSIONS may not include them.
export const PERMISSIONS = {
  ANDROID: {
    CAMERA: PermissionsAndroid.PERMISSIONS.CAMERA,
    RECORD_AUDIO: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    // Location (used for BLE scan on Android < 12 and for reading SSID/Wi‑Fi scans)
    ACCESS_FINE_LOCATION: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ACCESS_COARSE_LOCATION: PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    // Android 12+ BLE permissions (string constants to avoid undefined on older RN versions)
    BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
    BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
    // Android 13+ Wi‑Fi nearby devices permission
    NEARBY_WIFI_DEVICES: 'android.permission.NEARBY_WIFI_DEVICES',
    // Optional Wi‑Fi state permissions (not strictly required for our current flow)
    ACCESS_WIFI_STATE: PermissionsAndroid.PERMISSIONS.ACCESS_WIFI_STATE,
    CHANGE_WIFI_STATE: PermissionsAndroid.PERMISSIONS.CHANGE_WIFI_STATE,
    // NFC (not covered by PermissionsAndroid API; keep the string constant for checks/requests)
    NFC: 'android.permission.NFC',
  },
  IOS: {},
} as any;

export async function check(permission: string) {
  if (Platform.OS === 'android') {
    // PermissionsAndroid.check returns boolean
    if (!permission) return RESULTS.DENIED;
    const ok = await PermissionsAndroid.check(permission as any);
    return ok ? RESULTS.GRANTED : RESULTS.DENIED;
  }
  // iOS: rely on module-level permission requests; assume granted for flow
  return RESULTS.GRANTED;
}

export async function request(permission: string) {
  if (Platform.OS === 'android') {
    // PermissionsAndroid.request returns one of 'granted' | 'denied' | 'never_ask_again'
    if (!permission) return RESULTS.DENIED;
    const res = await PermissionsAndroid.request(permission as any);
    return res;
  }
  // iOS: rely on module-level permission requests; assume granted for flow
  return RESULTS.GRANTED;
}

const Permissions = { PERMISSIONS, RESULTS, check, request } as any;
export default Permissions;