import { Platform } from 'react-native'
let mod: any
try {
  mod = Platform.OS === 'web' ? require('./permissions.web') : require('./permissions.native')
} catch {
  mod = {}
}
export const PERMISSIONS = mod.PERMISSIONS
export const RESULTS = mod.RESULTS
export const check = mod.check
export const request = mod.request
export default mod