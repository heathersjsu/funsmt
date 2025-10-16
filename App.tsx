import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Image, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, MD3LightTheme as DefaultTheme, MD3LightTheme } from 'react-native-paper';
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
import { useEffect, useState } from 'react';
import { registerDevicePushToken } from './src/utils/notifications';
import { supabase } from './src/supabaseClient';
import { buildKidTheme, loadFigmaThemeOverrides } from './src/theme';
import { ThemeUpdateProvider } from './src/theme/ThemeContext';

const Stack = createNativeStackNavigator();

export default function App() {
  const [ready, setReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  useEffect(() => {
    // 初始化读取会话
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      setIsAuthenticated(!!user);
      if (user) await registerDevicePushToken(user.id);
      setReady(true);
    });
    // 监听会话变化
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user;
      setIsAuthenticated(!!user);
      if (user) await registerDevicePushToken(user.id);
    });
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const [theme, setTheme] = useState<MD3LightTheme>(buildKidTheme());
  useEffect(() => {
    // Attempt to load theme overrides from Figma variables if available
    loadFigmaThemeOverrides()
      .then((overrides) => {
        if (Object.keys(overrides || {}).length) {
          setTheme(buildKidTheme(overrides));
        }
      })
      .catch(() => {
        // Ignore errors; keep default playful theme
      });
  }, []);

  // Configure web deep linking prefixes based on site URL
  const prefixes = [process.env.EXPO_PUBLIC_SITE_URL || ''].filter(Boolean);
  const linking = prefixes.length ? { prefixes } : undefined;

  return (
    <SafeAreaProvider>
      <ThemeUpdateProvider value={{ setTheme }}>
        <PaperProvider theme={theme}>
          <NavigationContainer linking={linking}>
          {ready && isAuthenticated ? (
            <Stack.Navigator
              initialRouteName="Home"
              screenOptions={({ navigation }) => ({
                headerLeft: () => (
                  <TouchableOpacity
                    onPress={() => {
                      const names = navigation.getState()?.routeNames || [];
                      const target = names.includes('Home') ? 'Home' : names[0];
                      navigation.navigate(target);
                    }}
                    style={{ paddingLeft: 8 }}
                  >
                    <Image source={require('./assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 6 }} />
                  </TouchableOpacity>
                ),
                headerRight: () => <HeaderAvatarMenu />,
              })}
            >
              <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
              <Stack.Screen name="ToyList" component={ToyListScreen} options={{ title: 'Toy List' }} />
              <Stack.Screen name="ToyForm" component={ToyFormScreen} options={{ title: 'Toy Details' }} />
              <Stack.Screen name="ToyCheckIn" component={ToyCheckInScreen} options={{ title: 'Toy Check-In' }} />
              <Stack.Screen name="Stats" component={StatsScreen} options={{ title: 'Statistics' }} />
              <Stack.Screen name="ReminderStatus" component={ReminderStatusScreen} options={{ title: 'Reminders' }} />
              <Stack.Screen name="Preferences" component={PreferencesScreen} options={{ title: 'Preferences' }} />
              <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
            </Stack.Navigator>
          ) : (
            <Stack.Navigator
              initialRouteName="Login"
              screenOptions={({ navigation }) => ({
                headerLeft: () => (
                  <TouchableOpacity
                    onPress={() => {
                      const names = navigation.getState()?.routeNames || [];
                      const target = names.includes('Home') ? 'Home' : (names.includes('Login') ? 'Login' : names[0]);
                      navigation.navigate(target);
                    }}
                    style={{ paddingLeft: 8 }}
                  >
                    <Image source={require('./assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 6 }} />
                  </TouchableOpacity>
                ),
                headerRight: () => <HeaderAvatarMenu />,
              })}
            >
              <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Pinme Sign In' }} />
              <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Sign Up' }} />
              <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Reset Password' }} />
              <Stack.Screen name="Preferences" component={PreferencesScreen} options={{ title: 'Preferences' }} />
              <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
            </Stack.Navigator>
          )}
          <StatusBar style="auto" />
          </NavigationContainer>
        </PaperProvider>
      </ThemeUpdateProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({});
