import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, Image, TouchableOpacity, Text, View, Animated, Platform as RNPlatform, PermissionsAndroid } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, MD3LightTheme as DefaultTheme, MD3LightTheme, useTheme, Snackbar } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LoginScreen from './src/screens/Auth/LoginScreen';
import RegisterScreen from './src/screens/Auth/RegisterScreen';
import ForgotPasswordScreen from './src/screens/Auth/ForgotPasswordScreen';
import ToyListScreen from './src/screens/Toys/ToyListScreen';
import ToyFormScreen from './src/screens/Toys/ToyFormScreen';
import ToyCheckInScreen from './src/screens/Toys/ToyCheckInScreen';
import HomeScreen from './src/screens/Home/HomeScreen';
import StatsScreen from './src/screens/Stats/StatsScreen';
import ReminderStatusScreen from './src/screens/Reminders/ReminderStatusScreen';
import PreferencesScreen from './src/screens/Settings/PreferencesScreen';
import AccountScreen from './src/screens/Account/AccountScreen';
import HeaderAvatarMenu from './src/components/HeaderAvatarMenu';
import DeviceConfigScreen from './src/screens/Devices/DeviceConfigScreen';
import DeviceProvisioningScreen from './src/screens/Devices/DeviceProvisioningScreen';
import AddDeviceUIScreen from './src/screens/Devices/AddDeviceUIScreen';
import DeviceManagementScreen from './src/screens/Devices/DeviceManagementScreen';
import { useEffect, useState, useRef } from 'react';
import { registerDevicePushToken, ensureNotificationPermissionAndChannel, recordNotificationHistory, getNotificationHistory } from './src/utils/notifications';
import * as Notifications from 'expo-notifications';
import { supabase, STORAGE_KEY, PROJECT_REF } from './src/supabaseClient';
import { buildCartoonTheme, loadFigmaThemeOverrides } from './src/theme';
import EnvDiagnosticsBanner from './src/components/EnvDiagnosticsBanner';
import { ThemeUpdateProvider } from './src/theme/ThemeContext';
import { AuthTokenContext } from './src/context/AuthTokenContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MeScreen from './src/screens/Me/MeScreen';
import HelpScreen from './src/screens/Me/HelpScreen';
import ManualScreen from './src/screens/Me/ManualScreen';
import OwnerManagementScreen from './src/screens/Me/OwnerManagementScreen';
import OwnerDetailScreen from './src/screens/Me/OwnerDetailScreen';
import EditProfileScreen from './src/screens/Me/EditProfileScreen';
import EnvironmentCheckScreen from './src/screens/Me/EnvironmentCheckScreen';
import VoiceCommandScreen from './src/screens/Voice/VoiceCommandScreen';
import { handleRfidEvent } from './src/utils/playSessions';
import { useNotifications, NotificationsProvider } from './src/context/NotificationsContext';
import Constants from 'expo-constants';
import DeviceDetailScreen from './src/screens/Devices/DeviceDetailScreen';
import LongPlaySettingsScreen from './src/screens/Reminders/LongPlaySettingsScreen';
import IdleToySettingsScreen from './src/screens/Reminders/IdleToySettingsScreen';
import SmartTidyingSettingsScreen from './src/screens/Tidying/SmartTidyingSettingsScreen';
import RecoveryChecklistScreen from './src/screens/Tidying/RecoveryChecklistScreen';
import NotificationHistoryScreen from './src/screens/Reminders/NotificationHistoryScreen';
import ToyHistoryScreen from './src/screens/Toys/ToyHistoryScreen';
import { ensureBleDeps } from './src/shims/bleDeps';
import { syncLocalFromRemote, loadLongPlaySettings, loadIdleToySettings } from './src/utils/reminderSettings';
import { startLongPlayMonitor, stopLongPlayMonitor } from './src/reminders/longPlay';
import { runIdleScan } from './src/reminders/idleToy';
import { useFonts, Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const ToysStack = createNativeStackNavigator();
const DevicesStack = createNativeStackNavigator();
const MeStack = createNativeStackNavigator();

// Ensure native BLE-related modules are part of the JS bundle for Dev Client
ensureBleDeps();

// 导航容器引用，用于全局导航（App 订阅里使用）
const navigationRef = createNavigationContainerRef<any>();

function HeaderBellButton() {
  const navigation = useNavigation<any>();
  const { unreadCount } = useNotifications();
  const size = 26;
  const paperTheme = useTheme();
  const color = paperTheme.colors.primary;
  return (
    <View style={{ paddingRight: 8 }}>
      <TouchableOpacity
        onPress={() => navigation.navigate('NotificationHistory')}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        style={{ paddingHorizontal: 4, paddingVertical: 4 }}
      >
        <MaterialCommunityIcons name="bell-outline" size={size} color={color} />
        {unreadCount > 0 && (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: paperTheme.colors.error,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 3,
            }}
          >
            <Text style={{ color: paperTheme.colors.onError, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>
              {unreadCount > 99 ? '99+' : String(unreadCount)}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

function HomeStackScreen() {
  const paperTheme = useTheme();
  return (
    <HomeStack.Navigator screenOptions={{ animation: 'slide_from_right', headerShadowVisible: true }}>
      <HomeStack.Screen
        name="HomeMain"
        component={HomeScreen}
        options={{
          headerTitle: '',
          headerRight: () => <HeaderBellButton />,
        }}
      />
      <HomeStack.Screen
        name="ReminderStatus"
        component={ReminderStatusScreen}
        options={({ navigation }) => ({
          headerTitle: () => (
            <View style={{ marginLeft: 12 }}>
              <Text style={{ color: paperTheme.colors.primary, fontWeight: '700', fontSize: RNPlatform.OS === 'ios' ? 17 : 20 }}>Reminders</Text>
            </View>
          ),
          headerLeftContainerStyle: { marginRight: 12 },
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                const parent = navigation.getParent?.();
                if (parent) {
                  parent.navigate('Me', { screen: 'MeMain' });
                } else {
                  navigation.navigate('Me');
                }
              }}
              style={{ paddingLeft: 12 }}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color={paperTheme.colors.primary} />
            </TouchableOpacity>
          ),
        })}
      />
      <HomeStack.Screen name="NotificationHistory" component={NotificationHistoryScreen} options={{ title: 'Notifications' }} />
      {/* Reminders detail screens hosted in Home stack so back returns to ReminderStatus */}
      <HomeStack.Screen name="LongPlaySettings" component={LongPlaySettingsScreen} options={{ title: 'Long Play Reminder' }} />
      <HomeStack.Screen name="IdleToySettings" component={IdleToySettingsScreen} options={{ title: 'Idle Toy Reminder' }} />
      <HomeStack.Screen name="SmartTidyingSettings" component={SmartTidyingSettingsScreen} options={{ title: 'Smart Tidy-up' }} />
      {/* Recovery checklist moved to Me stack per request */}
    </HomeStack.Navigator>
  );
}

function ToysStackScreen() {
  const paperTheme = useTheme();
  return (
    <ToysStack.Navigator screenOptions={{ animation: 'slide_from_right' }}>
      <ToysStack.Screen
        name="ToyList"
        component={ToyListScreen}
        options={({ navigation }) => ({
          headerTitle: '',
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('ToyForm')} style={{ paddingRight: 8 }}>
              <Text style={{ color: paperTheme.colors.primary, fontWeight: '600' }}>Add new toy +</Text>
            </TouchableOpacity>
          ),
        })}
      />
      <ToysStack.Screen name="ToyForm" component={ToyFormScreen} options={{ title: 'Add new toy' }} />
      <ToysStack.Screen name="ToyCheckIn" component={ToyCheckInScreen} options={{ title: 'Toy Check-In' }} />
      <ToysStack.Screen name="ToyHistory" component={ToyHistoryScreen} options={{ title: 'Play History' }} />
    </ToysStack.Navigator>
  );
}

function DevicesStackScreen() {
  const paperTheme = useTheme();
  return (
    <DevicesStack.Navigator screenOptions={{ animation: 'slide_from_right' }}>
      <DevicesStack.Screen
        name="DeviceManagement"
        component={DeviceManagementScreen}
        options={({ navigation }) => ({
          headerTitle: '',
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('AddDeviceUI')} style={{ paddingRight: 8 }}>
              <Text style={{ color: paperTheme.colors.primary, fontWeight: '600' }}>Add new device +</Text>
            </TouchableOpacity>
          ),
        })}
      />
      <DevicesStack.Screen
        name="AddDeviceUI"
        component={AddDeviceUIScreen}
        options={{
          headerTitle: 'Add new device'
        }}
      />
      <DevicesStack.Screen name="DeviceProvisioning" component={DeviceProvisioningScreen} options={{ headerTitle: '' }} />
      <DevicesStack.Screen name="DeviceConfig" component={DeviceConfigScreen} options={{ title: 'Device Config' }} />
      <DevicesStack.Screen name="DeviceDetail" component={DeviceDetailScreen} options={{ title: 'Device Detail' }} />
    </DevicesStack.Navigator>
  );
}

function MeStackScreen() {
  return (
    <MeStack.Navigator screenOptions={{ animation: 'slide_from_right' }}>
      <MeStack.Screen name="MeMain" component={MeScreen} options={{ headerTitle: '' }} />
      <MeStack.Screen
        name="ReminderStatusAlias"
        component={ReminderStatusScreen}
        options={{
          headerTitle: 'Reminders'
        }}
      />
      <MeStack.Screen name="Preferences" component={PreferencesScreen} options={{ title: 'Preferences' }} />
      <MeStack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
      <MeStack.Screen name="Help" component={HelpScreen} options={{ title: 'Help' }} />
      <MeStack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual' }} />
      <MeStack.Screen name="EnvironmentCheck" component={EnvironmentCheckScreen} options={{ title: '环境自检' }} />
      <MeStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit Profile' }} />
      <MeStack.Screen name="OwnerManagement" component={OwnerManagementScreen} options={{ title: 'Toy Owner' }} />
      <MeStack.Screen name="OwnerDetail" component={OwnerDetailScreen} options={{ title: 'Owner Detail' }} />
      {/* Reminder detail screens hosted under Home stack now; removed here to ensure back returns to ReminderStatus */}
      {/* Recovery checklist moved into Me stack per request */}
      <MeStack.Screen name="RecoveryChecklist" component={RecoveryChecklistScreen} options={{ title: 'Recovery Checklist' }} />
    </MeStack.Navigator>
  );
}

function MainTabs() {
  const paperTheme = useTheme();
  // --- Inline voice controller for tab bar central mic ---
  const webRecogRef = useRef<any>(null);
  const nativeVoiceRef = useRef<any>(null);
  const transcriptRef = useRef<string>('');
  const [listening, setListening] = useState(false);
  const [snackVisible, setSnackVisible] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const pendingErrorRef = useRef<string | null>(null);
  
  const holdThresholdMs = 160;
  const startTimerRef = useRef<any>(null);
  // Add missing refs for pulse animation
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseAnimRef = useRef<any>(null);
  const showSnack = (msg: string) => { setSnackMsg(msg); setSnackVisible(true); };
  const hideSnack = () => setSnackVisible(false);

  // Only dev client or standalone builds have native modules; Expo Go has appOwnership === 'expo'
  const supportsNativeVoice = RNPlatform.OS !== 'web' && (Constants.appOwnership !== 'expo');

  const startPulse = () => {
    try {
      pulseAnimRef.current?.stop?.();
      pulseAnimRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.12, duration: 420, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 420, useNativeDriver: true }),
        ])
      );
      pulseAnimRef.current.start();
    } catch {}
  };
  const stopPulse = () => { try { pulseAnimRef.current?.stop?.(); pulse.setValue(1); } catch {} };

  React.useEffect(() => {
    if (snackVisible && snackMsg !== 'Listening...') {
      const t = setTimeout(() => setSnackVisible(false), 2000);
      return () => clearTimeout(t);
    }
    return;
  }, [snackVisible, snackMsg]);

  const executeVoiceCommand = (text: string, navigation: any) => {
    const t = (text || '').trim();
    if (!t) return;
    const enMatch = t.match(/add\s+toy\s*(?:named|name|called)?\s*["'“”]?([^"'“”]+)?/i) || t.match(/create\s+toy\s*["'“”]?([^"'“”]+)?/i);
    const zhMatch = t.match(/(?:添加|新增|创建)玩具\s*(?:名称)?\s*["'“”]?([^"'“”]+)?/);
    const name = (enMatch?.[1] || zhMatch?.[1] || '').trim();
    if (/add\s+toy/i.test(t) || /(?:添加|新增|创建)玩具/.test(t)) {
      navigation.navigate('Toys', { screen: 'ToyForm', params: { name } });
      return;
    }
    if (/open\s+devices/i.test(t) || /打开设备/.test(t)) { navigation.navigate('Devices'); return; }
    if (/open\s+toys/i.test(t) || /打开玩具/.test(t)) { navigation.navigate('Toys'); return; }
    if (/open\s+reminders?/i.test(t) || /打开提醒/.test(t)) { navigation.navigate('Me', { screen: 'ReminderStatusAlias' }); return; }
    if (/(add|create|new)\s+device/i.test(t)) { navigation.navigate('Devices', { screen: 'AddDeviceUI' }); return; }
  };

  const getLang = (): string => {
    try {
      if (RNPlatform.OS === 'web') {
        // navigator 在 web 可用
        // eslint-disable-next-line no-restricted-globals
        return ((navigator as any)?.language || 'en-US');
      }
      // 原生端使用 expo-localization（惰性加载，避免打包期解析问题）
      try {
        const Localization = require('expo-localization');
        const locale = Localization?.locale || Localization?.locales?.[0] || 'en-US';
        return typeof locale === 'string' ? locale : 'en-US';
      } catch {
        return 'en-US';
      }
    } catch {
      return 'en-US';
    }
  };

  const initWebRecognition = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { showSnack('Browser does not support speech recognition'); return null; }
    const recog = new SR();
    try {
      const lang = getLang();
      recog.lang = String(lang).toLowerCase().includes('zh') ? 'zh-CN' : 'en-US';
    } catch { recog.lang = 'en-US'; }
    recog.continuous = false;
    recog.interimResults = false;
    recog.onresult = (evt: any) => {
      const text = Array.from(evt.results).map((r: any) => r[0]?.transcript || '').join(' ').trim();
      transcriptRef.current = text;
    };
    recog.onerror = (evt: any) => {
      try {
        const err = (evt?.error || '').toString();
        if (err === 'aborted') { return; }
        const msg =
          (err === 'no-speech' || err === 'no-match') ? 'No speech detected' :
          (err === 'not-allowed' || err === 'service-not-allowed') ? 'Microphone permission denied' :
          (err === 'audio-capture') ? 'Microphone not available' :
          'Speech recognition failed';
        if (listening) { pendingErrorRef.current = msg; return; }
        showSnack(msg);
      } catch {
        if (listening) { pendingErrorRef.current = 'Speech recognition failed'; return; }
        showSnack('Speech recognition failed');
      }
    };
    return recog;
  };

  const ensureMicPermission = async (): Promise<boolean> => {
    try {
      if (RNPlatform.OS === 'web') {
        // eslint-disable-next-line no-restricted-globals
        const md = (navigator as any)?.mediaDevices;
        if (md?.getUserMedia) {
          try { await md.getUserMedia({ audio: true }); } catch { return false; }
        }
        return true;
      }
      if (RNPlatform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      return true;
    } catch {
      return false;
    }
  };

  const ensureNativeVoice = async () => {
    if (!supportsNativeVoice) { showSnack('Voice requires Dev Client or production build (Expo Go not supported)'); return null; }
    if (nativeVoiceRef.current) return nativeVoiceRef.current;
    try {
      const mod: any = await import('@react-native-voice/voice');
      nativeVoiceRef.current = mod?.default || mod;
      nativeVoiceRef.current.onSpeechResults = (e: any) => { const text = (e?.value?.[0] || '').trim(); if (text) transcriptRef.current = text; };
      nativeVoiceRef.current.onSpeechError = (e: any) => {
        try {
          const code = e?.error?.code ?? e?.error?.message ?? e?.error;
          const cstr = String(code ?? '').toLowerCase();
          if (cstr.includes('cancel') || cstr.includes('aborted')) { return; }
          const msg =
            (cstr.includes('no match') || cstr === '7' || cstr.includes('no-speech')) ? 'No speech detected' :
            (cstr.includes('permission') || cstr === '5') ? 'Microphone permission denied' :
            (cstr.includes('audio') || cstr === '9') ? 'Microphone not available' :
            'Speech recognition failed';
          if (listening) { pendingErrorRef.current = msg; return; }
          showSnack(msg);
        } catch {
          if (listening) { pendingErrorRef.current = 'Speech recognition failed'; return; }
          showSnack('Speech recognition failed');
        }
      };
      nativeVoiceRef.current.onSpeechPartialResults = (e: any) => {
        const text = (e?.value?.[0] || '').trim();
        if (text) transcriptRef.current = text;
      };
    } catch {
      showSnack('Rebuild Dev Client to enable voice: run npx expo run:android or run:ios');
    }
    return nativeVoiceRef.current;
  };

  const startVoiceListening = async (navigation: any) => {
    transcriptRef.current = '';
    const permitted = await ensureMicPermission();
    if (!permitted) {
      showSnack('Microphone permission denied');
      return;
    }
    setListening(true);
    startPulse();
    showSnack('Listening...');
    if (RNPlatform.OS === 'web') {
      webRecogRef.current = initWebRecognition();
      try { webRecogRef.current?.start?.(); } catch { showSnack('Unable to start speech'); }
    } else {
      const Voice = await ensureNativeVoice();
      if (!Voice) { setListening(false); stopPulse(); return; }
      const lang = (() => { try { const l = getLang(); return String(l).toLowerCase().includes('zh') ? 'zh-CN' : 'en-US'; } catch { return 'en-US'; } })();
      try { await Voice.start(lang); } catch { showSnack('Unable to start speech'); }
    }
  };

  const stopVoiceListening = async (navigation: any) => {
    let hadText = !!transcriptRef.current;
    if (RNPlatform.OS === 'web') {
      try { webRecogRef.current?.stop?.(); } catch {}
    } else {
      const Voice = await ensureNativeVoice();
      try { await Voice?.stop?.(); } catch {}
    }
    if (hadText) {
      showSnack(`Heard: "${transcriptRef.current}"`);
      executeVoiceCommand(transcriptRef.current, navigation);
    } else {
      const msg = pendingErrorRef.current || 'No speech detected';
      showSnack(msg);
    }
    pendingErrorRef.current = null;
    transcriptRef.current = '';
    setListening(false);
    stopPulse();
    return hadText;
  };

  return (
    <>
      <Tab.Navigator
        initialRouteName="Home"
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: paperTheme.colors.primary,
          tabBarInactiveTintColor: paperTheme.colors.onSurfaceVariant,
          tabBarStyle: { backgroundColor: paperTheme.colors.surface, height: 64, borderTopColor: paperTheme.colors.outline, borderTopWidth: 1 },
          tabBarLabelStyle: { fontSize: 12 },
          tabBarIcon: ({ color, size }) => {
            const iconName =
              route.name === 'Home' ? 'home' :
              route.name === 'Toys' ? 'puzzle' :
              route.name === 'Voice' ? 'microphone' :
              route.name === 'Devices' ? 'access-point' :
              route.name === 'Me' ? 'account' : 'circle';
            return <MaterialCommunityIcons name={iconName as any} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen
          name="Home"
          component={HomeStackScreen}
          options={{ title: 'Home', tabBarLabel: 'Home' }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              try {
                navigation.navigate('Home', { screen: 'HomeMain' });
              } catch {}
            }
          })}
        />
        <Tab.Screen
          name="Toys"
          component={ToysStackScreen}
          options={{ title: 'Toys' }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              try {
                navigation.navigate('Toys', { screen: 'ToyList' });
              } catch {}
            }
          })}
        />
        <Tab.Screen
          name="Voice"
          component={VoiceCommandScreen}
          options={({ navigation }) => ({
            title: 'Voice',
            tabBarLabel: 'Voice',
            tabBarShowLabel: false,
            tabBarButton: (props: any) => (
              <TouchableOpacity
                {...props}
                onPress={() => { /* no navigation on press */ }}
                onPressIn={() => {
                  // 延迟启动，避免快速点按导致瞬时 start/stop
                  if (startTimerRef.current) { clearTimeout(startTimerRef.current); }
                  startTimerRef.current = setTimeout(() => { startVoiceListening(navigation); }, holdThresholdMs);
                }}
                onPressOut={async () => {
                  if (startTimerRef.current) {
                    clearTimeout(startTimerRef.current);
                    startTimerRef.current = null;
                    // 尚未真正开始监听则直接返回
                    if (!listening) { return; }
                  }
                  const hadText = await stopVoiceListening(navigation);
                  if (!hadText) { /* message shown in stopVoiceListening */ }
                }}
                style={{ alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', display: 'flex' }}
              >
                <Animated.View style={{ transform: [{ scale: pulse }] }}>
                  <MaterialCommunityIcons name="microphone" size={28} color={listening ? paperTheme.colors.error : paperTheme.colors.primary} />
                </Animated.View>
              </TouchableOpacity>
            ),
          })}
        />
        <Tab.Screen
          name="Devices"
          component={DevicesStackScreen}
          options={{ title: 'Devices' }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              try {
                navigation.navigate('Devices', { screen: 'DeviceManagement' });
              } catch {}
            }
          })}
        />
        <Tab.Screen
          name="Me"
          component={MeStackScreen}
          options={{ title: 'Me' }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              try {
                navigation.navigate('Me', { screen: 'MeMain' });
              } catch {}
            }
          })}
        />
      </Tab.Navigator>
      <Snackbar
        visible={snackVisible}
        onDismiss={hideSnack}
        duration={snackMsg === 'Listening...' ? 600000 : 2000}
        style={{ backgroundColor: paperTheme.colors.secondaryContainer, alignSelf: 'center' }}
        wrapperStyle={{ position: 'absolute', top: '45%', left: 0, right: 0 }}
      >
        {/* Wrap string in Text to satisfy RN native constraint */}
        <Text style={{ color: paperTheme.colors.onSecondaryContainer, textAlign: 'center' }}>{snackMsg}</Text>
      </Snackbar>
    </>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  // 默认使用卡通主题，避免初次渲染出现 MD3 紫色配色
  const [theme, setTheme] = useState(buildCartoonTheme());
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [initialSessionReady, setInitialSessionReady] = useState(false);
  const [userJwt, setUserJwt] = useState<string | null>(null);
  useEffect(() => { loadFigmaThemeOverrides().then((o) => setTheme(buildCartoonTheme(o))); }, []);
  // Web: inject Google Fonts for Baloo 2 and Nunito to match kid-friendly theme fonts
  useEffect(() => {
    if (RNPlatform.OS === 'web') {
      try {
        const head = document.head || document.getElementsByTagName('head')[0];
        const pre1 = document.createElement('link');
        pre1.rel = 'preconnect';
        pre1.href = 'https://fonts.googleapis.com';
        const pre2 = document.createElement('link');
        pre2.rel = 'preconnect';
        pre2.href = 'https://fonts.gstatic.com';
        pre2.crossOrigin = 'anonymous';
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
        head.appendChild(pre1);
        head.appendChild(pre2);
        head.appendChild(link);
      } catch {}
    }
  }, []);
  useEffect(() => {
    (async () => {
      try {
        if (RNPlatform.OS !== 'ios') {
          await (async () => {
            try {
              if ((RNPlatform as any).OS === 'web') {
                const md = (navigator as any)?.mediaDevices;
                if (md?.getUserMedia) {
                  try { await md.getUserMedia({ audio: true }); } catch {}
                }
              } else {
                await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
              }
            } catch {}
          })();
        }
      } catch {}
    })();
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams((globalThis as any)?.location?.search || '');
        const forceLogout = params.has('logout');
        if (forceLogout && typeof window !== 'undefined') {
          try {
            // Clear ALL possible auth tokens
            Object.keys(window.localStorage || {}).forEach((k) => { 
              if (k.startsWith('sb-') || k.includes('auth-token') || k === 'pinme-auth-token') {
                window.localStorage.removeItem(k);
              }
            });
          } catch {}
          
          // Force sign out
          await supabase.auth.signOut().catch(() => {});
          
          // Clear state
          setSignedIn(false);
          setUserJwt(null);
          setInitialSessionReady(true);
          
          // Remove query param to clean up URL (optional but nice)
          if (window.history && window.history.replaceState) {
             const newUrl = window.location.pathname;
             window.history.replaceState({}, '', newUrl);
          }
          return; // Stop further processing
        }
      } catch {}
      
      // If NOT logging out, proceed to session check
      const initTimer = setTimeout(() => { try { setInitialSessionReady(true); } catch {} }, 2000);
      try {
        const { data } = await supabase.auth.getSession();
        let session = data.session;
        
        let finallySigned = !!session;
        try {
          // Double check with server to ensure token is valid
          const { data: u } = await supabase.auth.getUser();
          // Must have ID and Email to be considered a valid logged-in user
          if (u?.user?.id && u?.user?.email) {
             finallySigned = true;
             session = data.session; // Keep session if valid
          } else {
             // If getUser fails or returns incomplete user, try to refresh
             if (session) {
               const { data: r } = await supabase.auth.refreshSession();
               if (r.session && r.user?.email) {
                  session = r.session;
                  finallySigned = true;
               } else {
                  finallySigned = false;
               }
             } else {
               finallySigned = false;
             }
          }
        } catch {
          finallySigned = false;
        }
        
        if (!finallySigned) {
           // Clear any stale data
           await supabase.auth.signOut().catch(() => {});
        }
  
        setSignedIn(finallySigned);
        setUserJwt(session?.access_token || null);
        setInitialSessionReady(true);
        clearTimeout(initTimer);
      } catch {
        setSignedIn(false);
        setUserJwt(null);
        setInitialSessionReady(true);
        clearTimeout(initTimer);
      }
    })();
  }, []);

  useEffect(() => {
    // 监听登录状态变化
    const { data: authSub } = supabase.auth.onAuthStateChange(async (event, session) => {
      // 1. 处理显式退出
      if (event === 'SIGNED_OUT') {
        setSignedIn(false);
        setUserJwt(null);
        return;
      }

      // 2. 严格校验 Session 有效性
      let isValidSession = !!(session?.user?.id);
      
      // 如果本地有 Session 但不确定（例如 TokenRefreshed），再通过 getUser 确认一次
      if (isValidSession && (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
         try {
           const { data: u, error } = await supabase.auth.getUser();
           if (error || !u.user) {
             isValidSession = false;
             // 如果服务端验证失败，强制清理
             await supabase.auth.signOut().catch(() => {});
           }
         } catch {
           isValidSession = false;
         }
      }

      setSignedIn(isValidSession);
      setUserJwt(session?.access_token || null);
      if (event === 'INITIAL_SESSION') {
        setInitialSessionReady(true);
      }
      try {
        if (isValidSession) {
          // Pull server-side settings and start monitors if enabled
          await syncLocalFromRemote();
          const lp = await loadLongPlaySettings();
          stopLongPlayMonitor();
          if (lp.enabled) startLongPlayMonitor(lp);
        } else {
          // 未登录时也按本地设置启用/停用提醒
          const lp = await loadLongPlaySettings();
          stopLongPlayMonitor();
          if (lp.enabled) startLongPlayMonitor(lp);
        }
      } catch {}
    });
    const sub = supabase
      .channel('notifications')
      .on('broadcast', { event: 'rfid' }, (payload) => {
        try { handleRfidEvent(payload?.payload); } catch {}
      })
      .subscribe();
    // 确保本地提醒在 Android13+ 可显示，同时注册推送（若已登录）
    ensureNotificationPermissionAndChannel().catch(() => {});
    registerDevicePushToken().catch(() => {});
    // 未登录场景下也启动长时播放监控（遵循本地设置）
    (async () => {
      try {
        const lp = await loadLongPlaySettings();
        stopLongPlayMonitor();
        if (lp.enabled) startLongPlayMonitor(lp);
      } catch {}
    })();
    return () => {
      try { supabase.removeChannel(sub); } catch {}
      try { authSub?.subscription?.unsubscribe(); } catch {}
    };
  }, []);

  // 将所有本地收到的通知写入历史，展示在首页右上角铃铛内
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(async (event) => {
      try {
        const content: any = event?.request?.content || {};
        const title: string = content?.title || 'Notification';
        const body: string | undefined = content?.body;
        const t = (title || '').toLowerCase();
        const src =
          t.includes('long play') ? 'longPlay' :
          t.includes('idle toy') ? 'idleToy' :
          t.includes('tidy') || t.includes('tidy-up') ? 'smartTidying' :
          'unknown';
        const history = await getNotificationHistory();
        const now = Date.now();
        const dup = (history || []).some(h => h.title === title && h.body === body && Math.abs(now - (h.timestamp || 0)) < 180000);
        if (!dup) {
          await recordNotificationHistory(title, body, src);
        }
      } catch {}
    });
    return () => { try { sub.remove(); } catch {} };
  }, []);

  // 空闲玩具自动扫描：应用前台运行时每 6 小时执行一次，并在启动后立即执行一次
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const s = await loadIdleToySettings();
        await runIdleScan({ enabled: s.enabled, days: s.days, smartSuggest: s.smartSuggest });
      } catch {}
    };
    run();
    const timer = setInterval(run, 6 * 60 * 60 * 1000);
    return () => {
      mounted = false;
      try { clearInterval(timer); } catch {}
    };
  }, []);

  if (!initialSessionReady || !fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF' }}>
        <Image source={require('./assets/splash-icon.png')} style={{ width: 120, height: 120, resizeMode: 'contain' }} />
      </View>
    );
  }

  return (
    <AuthTokenContext.Provider value={{ userJwt, setUserJwt }}>
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeUpdateProvider value={{ setTheme }}>
          <PaperProvider theme={theme}>
            {/* <EnvDiagnosticsBanner />  Removed per user request */}
            <NotificationsProvider>
              <NavigationContainer ref={navigationRef}>
              {signedIn ? (
                <Stack.Navigator screenOptions={({ navigation }) => ({
                  headerLeft: () => (
                    <TouchableOpacity
                      onPress={() => {
                        const names = navigation.getState()?.routeNames || [];
                        const target = names.includes('MainTabs') ? 'MainTabs' : (names.includes('Login') ? 'Login' : names[0]);
                        navigation.navigate(target);
                      }}
                      style={{ paddingLeft: 8 }}
                    >
                      <Image source={require('./assets/icon.png')} style={{ width: 24, height: 24, borderRadius: 4 }} />
                    </TouchableOpacity>
                  ),
                  headerRight: () => <HeaderAvatarMenu />,
                  headerStyle: { backgroundColor: theme.colors.surface },
                  headerTitleStyle: { color: theme.colors.primary, ...(RNPlatform.OS === 'web' ? { fontFamily: 'Baloo 2', fontWeight: '700' } : {}) },
                })}>
                  <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
                </Stack.Navigator>
              ) : (
                <Stack.Navigator
                  initialRouteName="Login"
                  screenOptions={({ navigation }) => ({
                    headerLeft: () => (
                      <TouchableOpacity
                        onPress={() => {
                          // 未登录状态下只允许停留在 Login
                          const names = navigation.getState()?.routeNames || [];
                          const target = names.includes('Login') ? 'Login' : names[0];
                          navigation.navigate(target);
                        }}
                        style={{ paddingLeft: 8 }}
                      >
                      <Image source={require('./assets/icon.png')} style={{ width: 24, height: 24, borderRadius: 4 }} />
                      </TouchableOpacity>
                    ),
                    headerRight: () => null,
                    headerStyle: { backgroundColor: theme.colors.surface },
                    headerTitleStyle: { color: theme.colors.primary, ...(RNPlatform.OS === 'web' ? { fontFamily: 'Baloo 2', fontWeight: '700' } : {}) },
                  })}
                >
                  <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
                  <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Sign Up' }} />
                  <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Reset Password' }} />
                </Stack.Navigator>
              )}
                <StatusBar style="auto" />
              </NavigationContainer>
            </NotificationsProvider>
          </PaperProvider>
        </ThemeUpdateProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
    </AuthTokenContext.Provider>
  );
}

const styles = StyleSheet.create({});
// 简单错误边界，避免白屏并显示可读错误信息
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: any; info?: any }>{
  constructor(props: any) { super(props); this.state = { error: null, info: null }; }
  componentDidCatch(error: any, info: any) { try { console.error('App crashed:', error, info); } catch {}; this.setState({ error, info }); }
  render() {
    if (this.state.error) {
      return (
        <SafeAreaProvider>
          <PaperProvider theme={MD3LightTheme}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
              <Image source={require('./assets/icon.png')} style={{ width: 80, height: 80, borderRadius: 16, marginBottom: 12 }} />
              <Text style={{ fontWeight: '700', marginBottom: 6 }}>应用出现错误</Text>
              <Text style={{ opacity: 0.8, textAlign: 'center' }}>{String(this.state.error?.message || this.state.error)}</Text>
              {!!this.state.info?.componentStack && (
                <Text style={{ opacity: 0.4, marginTop: 8 }} numberOfLines={6}>
                  {String(this.state.info?.componentStack)}
                </Text>
              )}
              <Text style={{ opacity: 0.6, marginTop: 8, textAlign: 'center' }}>请按 Ctrl+F5 强制刷新，或将控制台错误信息发我</Text>
            </View>
          </PaperProvider>
        </SafeAreaProvider>
      );
    }
    return this.props.children as any;
  }
}
