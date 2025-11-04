import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Image, TouchableOpacity, Platform, Text, View, Animated } from 'react-native';
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
import DeviceManagementScreen from './src/screens/Devices/DeviceManagementScreen';
import { useEffect, useState, useRef } from 'react';
import { registerDevicePushToken } from './src/utils/notifications';
import { supabase } from './src/supabaseClient';
import { buildCartoonTheme, loadFigmaThemeOverrides } from './src/theme';
import { ThemeUpdateProvider } from './src/theme/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MeScreen from './src/screens/Me/MeScreen';
import HelpScreen from './src/screens/Me/HelpScreen';
import ManualScreen from './src/screens/Me/ManualScreen';
import EditProfileScreen from './src/screens/Me/EditProfileScreen';
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

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const ToysStack = createNativeStackNavigator();
const DevicesStack = createNativeStackNavigator();
const MeStack = createNativeStackNavigator();

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
      <HomeStack.Screen name="ReminderStatus" component={ReminderStatusScreen} options={{ title: 'Reminders' }} />
      <HomeStack.Screen name="NotificationHistory" component={NotificationHistoryScreen} options={{ title: 'Notifications' }} />
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
            <TouchableOpacity onPress={() => navigation.navigate('DeviceConfig')} style={{ paddingRight: 8 }}>
              <Text style={{ color: paperTheme.colors.primary, fontWeight: '600' }}>Add new device +</Text>
            </TouchableOpacity>
          ),
        })}
      />
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
      <MeStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit Profile' }} />
      {/* New reminder and tidying screens */}
      <MeStack.Screen name="LongPlaySettings" component={LongPlaySettingsScreen} options={{ title: 'Long Play Reminder' }} />
      <MeStack.Screen name="IdleToySettings" component={IdleToySettingsScreen} options={{ title: 'Idle Toy Reminder' }} />
      <MeStack.Screen name="SmartTidyingSettings" component={SmartTidyingSettingsScreen} options={{ title: 'Smart Tidy-up' }} />
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
  const supportsNativeVoice = Platform.OS !== 'web' && (Constants.appOwnership !== 'expo');

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

  const initWebRecognition = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { showSnack('浏览器不支持语音识别'); return null; }
    const recog = new SR();
    recog.lang = (navigator.language || '').includes('zh') ? 'zh-CN' : 'en-US';
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
    if (Platform.OS === 'web') {
      webRecog = initWebRecognition();
      try { webRecog?.start?.(); } catch { showSnack('无法开始语音'); }
    } else {
      const Voice = await ensureNativeVoice();
      if (!Voice) { setListening(false); stopPulse(); return; }
      const lang = (navigator.language || '').includes('zh') ? 'zh-CN' : 'en-US';
      try { await Voice.start(lang); } catch { showSnack('无法开始语音'); }
    }
  };

  const stopVoiceListening = async (navigation: any) => {
    let hadText = !!transcriptCache;
    if (Platform.OS === 'web') {
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
        {snackMsg}
      </Snackbar>
    </>
  );
}

export default function App() {
  const [theme, setTheme] = useState(MD3LightTheme);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => { loadFigmaThemeOverrides().then((o) => setTheme(buildCartoonTheme(o))); }, []);
  useEffect(() => {
    // Subscribe auth state so sign in/out immediately affects routing
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    const sub = supabase
      .channel('notifications')
      .on('broadcast', { event: 'rfid' }, (payload) => {
        try { handleRfidEvent(payload?.payload); } catch {}
      })
      .subscribe();
    registerDevicePushToken().catch(() => {});
    return () => {
      try { supabase.removeChannel(sub); } catch {}
      try { authSub?.subscription?.unsubscribe(); } catch {}
    };
  }, []);

  return (
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
                      <Image source={require('./assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 6 }} />
                    </TouchableOpacity>
                  ),
                  headerRight: () => <HeaderAvatarMenu />,
                  headerStyle: { backgroundColor: theme.colors.surface },
                  headerTitleStyle: { color: theme.colors.primary },
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
                        <Image source={require('./assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 6 }} />
                      </TouchableOpacity>
                    ),
                    headerRight: () => <HeaderAvatarMenu />,
                    headerStyle: { backgroundColor: theme.colors.surface },
                    headerTitleStyle: { color: theme.colors.primary },
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
  );
}

const styles = StyleSheet.create({});
