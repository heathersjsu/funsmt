import { LogBox, NativeModules } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';

LogBox.ignoreLogs([
  'new NativeEventEmitter() was called with a non-null argument without the required addListener method.',
  'new NativeEventEmitter() was called with a non-null argument without the required removeListeners method.',
  'The app is running using the Legacy Architecture.',
]);
const nm: any = NativeModules;
['Voice', 'Zeroconf', 'BleManager', 'WifiManager', 'NfcManager'].forEach((name) => {
  const mod = nm?.[name];
  if (mod && typeof mod.addListener !== 'function') (mod as any).addListener = () => {};
  if (mod && typeof mod.removeListeners !== 'function') (mod as any).removeListeners = () => {};
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
