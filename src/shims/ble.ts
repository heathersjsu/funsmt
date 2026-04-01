import { Platform } from 'react-native'
let mod: any
try {
  mod = Platform.OS === 'web' ? require('./ble.web') : require('./ble.native')
} catch {
  mod = {}
}
export const BleManager = mod.BleManager
export default BleManager