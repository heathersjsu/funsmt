import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Avatar, IconButton, Menu } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../supabaseClient';

export default function HeaderAvatarMenu() {
  const navigation = useNavigation<any>();
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email || null);
    });
  }, []);

  const openMenu = () => setVisible(true);
  const closeMenu = () => setVisible(false);

  const onPreferences = () => {
    closeMenu();
    // Priority navigation to Preferences under Me tab, maintaining bottom navigation bar
    const names = navigation.getState()?.routeNames || [];
    if (names.includes('MainTabs')) {
      navigation.navigate('Me', { screen: 'Preferences' });
    } else {
      navigation.navigate('Preferences');
    }
  };
  const onAccount = () => {
    closeMenu();
    const names = navigation.getState()?.routeNames || [];
    if (names.includes('MainTabs')) {
      navigation.navigate('Me', { screen: 'Account' });
    } else {
      navigation.navigate('Account');
    }
  };
  const onLogout = async () => {
    closeMenu();
    await supabase.auth.signOut();
    navigation.navigate('Login');
  };

  return (
    <View style={{ flexDirection: 'row' }}>
      <Menu
        visible={visible}
        onDismiss={closeMenu}
        anchor={
          <TouchableOpacity onPress={openMenu} accessibilityRole="button">
            <Avatar.Image size={36} source={require('../../assets/icon.png')} />
          </TouchableOpacity>
        }
      >
        <Menu.Item onPress={onPreferences} title="Preferences" />
        <Menu.Item onPress={onAccount} title={email ? `Account (${email})` : 'Account'} />
        <Menu.Item onPress={onLogout} title="Logout" />
      </Menu>
    </View>
  );
}