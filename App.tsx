import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, Image, TouchableOpacity, Text, View, Animated, Platform as RNPlatform } from 'react-native';
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
import { registerDevicePushToken, ensureNotificationPermissionAndChannel } from './src/utils/notifications';
import { supabase } from './src/supabaseClient';
import { buildCartoonTheme, loadFigmaThemeOverrides } from './src/theme';
import { ThemeUpdateProvider } from './src/theme/ThemeContext';
import { AuthTokenContext } from './src/context/AuthTokenContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MeScreen from './src/screens/Me/MeScreen';
import HelpScreen from './src/screens/Me/HelpScreen';
import ManualScreen from './src/screens/Me/ManualScreen';
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
import { ensureBleDeps } from './src/shims/bleDeps';
import { syncLocalFromRemote, loadLongPlaySettings } from './src/utils/reminderSettings';
import { startLongPlayMonitor, stopLongPlayMonitor } from './src/reminders/longPlay';

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
    <HomeStack.Navigator screenOptions={{ animation: 'slide_from_right', headerStyle: { height: 56 }, headerShadowVisible: true }}>
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
          title: 'Reminders',
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
              style={{ paddingLeft: 8 }}
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
      <ToysStack.Screen name="ToyForm" component={ToyFormScreen} options={{ title: 'Toy Details' }} />
      <ToysStack.Screen name="ToyCheckIn" component={ToyCheckInScreen} options={{ title: 'Toy Check-In' }} />
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
      <DevicesStack.Screen name="AddDeviceUI" component={AddDeviceUIScreen} options={{ headerTitle: '' }} />
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
      <MeStack.Screen name="Preferences" component={PreferencesScreen} options={{ title: 'Preferences' }} />
      <MeStack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
      <MeStack.Screen name="Help" component={HelpScreen} options={{ title: 'Help' }} />
      <MeStack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual' }} />
      <MeStack.Screen name="EnvironmentCheck" component={EnvironmentCheckScreen} options={{ title: '环境自检' }} />
      <MeStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit Profile' }} />
      {/* Reminder detail screens hosted under Home stack now; removed here to ensure back returns to ReminderStatus */}
      {/* Recovery checklist moved into Me stack per request */}
      <MeStack.Screen name="RecoveryChecklist" component={RecoveryChecklistScreen} options={{ title: 'Recovery Checklist' }} />
    </MeStack.Navigator>
  );
}

function MainTabs() {
  const paperTheme = useTheme();
  // --- Inline voice controller for tab bar central mic ---
  let webRecog: any = null;
  let nativeVoice: any = null;
  let transcriptCache = '';
  const [listening, setListening] = useState(false);
  const [snackVisible, setSnackVisible] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  
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
    if (!SR) { showSnack('浏览器不支持语音识别'); return null; }
    const recog = new SR();
    try {
      const lang = getLang();
      recog.lang = String(lang).toLowerCase().includes('zh') ? 'zh-CN' : 'en-US';
    } catch { recog.lang = 'en-US'; }
    recog.continuous = false;
    recog.interimResults = false;
    recog.onresult = (evt: any) => {
      const text = Array.from(evt.results).map((r: any) => r[0]?.transcript || '').join(' ').trim();
      transcriptCache = text;
    };
    recog.onerror = () => { showSnack('语音识别失败'); };
    return recog;
  };

  const ensureNativeVoice = async () => {
    if (!supportsNativeVoice) { showSnack('语音识别需要开发版或生产版构建（Expo Go 不支持原生语音模块）'); return null; }
    if (nativeVoice) return nativeVoice;
    try {
      const mod: any = await import('@react-native-voice/voice');
      nativeVoice = mod?.default || mod;
      nativeVoice.onSpeechResults = (e: any) => { const text = (e?.value?.[0] || '').trim(); if (text) transcriptCache = text; };
      nativeVoice.onSpeechError = () => { showSnack('语音识别失败'); };
    } catch {
      showSnack('设备未安装语音模块');
    }
    return nativeVoice;
  };

  const startVoiceListening = async (navigation: any) => {
    transcriptCache = '';
    setListening(true);
    startPulse();
    if (RNPlatform.OS === 'web') {
      webRecog = initWebRecognition();
      try { webRecog?.start?.(); } catch { showSnack('无法开始语音'); }
    } else {
      const Voice = await ensureNativeVoice();
      if (!Voice) { setListening(false); stopPulse(); return; }
      const lang = (() => { try { const l = getLang(); return String(l).toLowerCase().includes('zh') ? 'zh-CN' : 'en-US'; } catch { return 'en-US'; } })();
      try { await Voice.start(lang); } catch { showSnack('无法开始语音'); }
    }
  };

  const stopVoiceListening = async (navigation: any) => {
    let hadText = !!transcriptCache;
    if (RNPlatform.OS === 'web') {
      try { webRecog?.stop?.(); } catch {}
    } else {
      const Voice = await ensureNativeVoice();
      try { await Voice?.stop?.(); } catch {}
    }
    if (hadText) { executeVoiceCommand(transcriptCache, navigation); }
    transcriptCache = '';
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
        <Tab.Screen name="Home" component={HomeStackScreen} options={{ title: 'Home', tabBarLabel: 'Home' }} />
        <Tab.Screen name="Toys" component={ToysStackScreen} options={{ title: 'Toys' }} />
        <Tab.Screen
          name="Voice"
          component={VoiceCommandScreen}
          options={({ navigation }) => ({
            title: 'Voice',
            tabBarLabel: 'Voice',
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
                  if (!hadText) { showSnack('未识别到语音'); }
                }}
                style={{ alignItems: 'center', justifyContent: 'center' }}
              >
                <Animated.View style={{ transform: [{ scale: pulse }] }}>
                  <MaterialCommunityIcons name="microphone" size={28} color={listening ? paperTheme.colors.error : paperTheme.colors.primary} />
                </Animated.View>
              </TouchableOpacity>
            ),
          })}
        />
        <Tab.Screen name="Devices" component={DevicesStackScreen} options={{ title: 'Devices' }} />
        <Tab.Screen name="Me" component={MeStackScreen} options={{ title: 'Me' }} />
      </Tab.Navigator>
      <Snackbar visible={snackVisible} onDismiss={hideSnack} duration={1600}>
        {/* Wrap string in Text to satisfy RN native constraint */}
        <Text>{snackMsg}</Text>
      </Snackbar>
    </>
  );
}

export default function App() {
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
        link.href = 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;700&family=Nunito:wght@400;600;700&display=swap';
        head.appendChild(pre1);
        head.appendChild(pre2);
        head.appendChild(link);
      } catch {}
    }
  }, []);
  useEffect(() => {
    // 在 Web 开发环境可通过环境变量或 URL 强制登出（仅当有 ?logout 或 ALWAYS_LOGIN_ON_WEB=true）
    const ALWAYS_LOGIN_ON_WEB = (process.env.EXPO_PUBLIC_ALWAYS_LOGIN_ON_WEB === 'true');
    try {
      const params = new URLSearchParams((globalThis as any)?.location?.search || '');
      const forceLogout = params.has('logout') || ALWAYS_LOGIN_ON_WEB;
      if (forceLogout && typeof window !== 'undefined') {
        try {
          Object.keys(window.localStorage || {}).forEach((k) => { if (k.startsWith('sb-')) window.localStorage.removeItem(k); });
        } catch {}
        supabase.auth.signOut().catch(() => {});
        setSignedIn(false);
        setUserJwt(null);
        setInitialSessionReady(true);
      }
    } catch {}
    // Subscribe auth state so sign in/out immediately affects routing
    if (!(process.env.EXPO_PUBLIC_ALWAYS_LOGIN_ON_WEB === 'true')) {
      // 安全超时兜底：若 getSession 因网络等原因长时间不返回，2 秒后允许进入登录页，避免卡住加载态
      const initTimer = setTimeout(() => { try { setInitialSessionReady(true); } catch {} }, 2000);
      supabase.auth.getSession().then(async ({ data }) => {
        let session = data.session;
        // 若 Supabase 未能恢复会话，但本地 localStorage 仍有持久化值，主动注入会话以避免刷新后“空账户”
        if (!session && typeof window !== 'undefined') {
          try {
            const key = Object.keys(window.localStorage || {}).find((k) => /sb-.*-auth-token$/.test(k));
            if (key) {
              const raw = window.localStorage.getItem(key) || 'null';
              const parsed = JSON.parse(raw);
              const cs = parsed?.currentSession || parsed?.session || null;
              const at = cs?.access_token || cs?.accessToken || null;
              const rt = parsed?.currentSession?.refresh_token || parsed?.refreshToken || cs?.refresh_token || null;
              if (at && rt) {
                const { data: setData, error: setErr } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
                if (!setErr) session = setData.session || setData.user ? (setData as any).session : null;
              }
            }
          } catch {}
        }
        // 放宽校验：以是否存在 session 决定是否进入主界面，避免在 getUser 临时失败时误判为未登录
        const finallySigned = !!session;
        setSignedIn(finallySigned);
        setUserJwt(session?.access_token || null);
        setInitialSessionReady(true);
        clearTimeout(initTimer);
      }).catch(() => {
        // 即使出错也不应卡在加载态，先允许进入登录页
        setSignedIn(false);
        setUserJwt(null);
        setInitialSessionReady(true);
        clearTimeout(initTimer);
      });
    } else {
      // 强制默认显示登录页
      setSignedIn(false);
      setUserJwt(null);
      setInitialSessionReady(true);
    }
    const { data: authSub } = supabase.auth.onAuthStateChange(async (event, session) => {
      // 放宽：只要有 session 就认为已登录，后续在后台拉取用户与设置
      const finallySigned = !!session;
      setSignedIn(finallySigned);
      setUserJwt(session?.access_token || null);
      if (event === 'INITIAL_SESSION') {
        setInitialSessionReady(true);
      }
      try {
        if (finallySigned) {
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

  return (
    <AuthTokenContext.Provider value={{ userJwt, setUserJwt }}>
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeUpdateProvider value={{ setTheme }}>
          <PaperProvider theme={theme}>
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
