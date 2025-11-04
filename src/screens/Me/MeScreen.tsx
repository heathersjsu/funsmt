import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text, Card, List, Button, Avatar, Divider, useTheme } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { BouncyIconButton } from '../../components/BouncyIconButton';

 export default function MeScreen() {
   const navigation = useNavigation<any>();
   const [email, setEmail] = useState<string | null>(null);
   const [userName, setUserName] = useState<string | null>(null);
   const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
   const [toyCounts, setToyCounts] = useState<{ total: number; out: number; in: number }>({ total: 0, out: 0, in: 0 });
   const theme = useTheme();


   useEffect(() => {
     supabase.auth.getUser().then(({ data }) => {
       const user = data.user;
       setEmail(user?.email || null);
       setUserName(user?.user_metadata?.full_name || user?.email || 'User');
       setAvatarUrl(user?.user_metadata?.avatar_url || null);
     });
     const fetchCounts = async () => {
       const { data } = await supabase.from('toys').select('status');
       const arr = (data || []) as any[];
       const total = arr.length;
       const out = arr.filter(t => t.status === 'out').length;
       const inCount = arr.filter(t => t.status === 'in').length;
       setToyCounts({ total, out, in: inCount });
     };
     fetchCounts();
   }, []);

   const points = useMemo(() => {
     // Simple points: 10 for each check-out, 5 for each check-in
     return toyCounts.out * 10 + toyCounts.in * 5;
   }, [toyCounts]);

   const onHelp = () => {
     navigation.navigate('Help');
   };
   const onManual = () => {
     navigation.navigate('Manual');
   };
   const onLogout = async () => {
     await supabase.auth.signOut();
   };

   return (
     <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
       <ScrollView style={[styles.container, { backgroundColor: 'transparent' }]} contentContainerStyle={{ paddingBottom: 24 }}>
         <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
           <Card.Title
             title={userName || 'Me'}
             subtitle={email || ''}
             left={(props) => (
               <TouchableOpacity onPress={() => navigation.navigate('EditProfile')}>
                 {avatarUrl ? (
                   <Avatar.Image {...props} source={{ uri: avatarUrl }} style={{ backgroundColor: theme.colors.secondaryContainer }} />
                 ) : (
                   <Avatar.Icon {...props} icon="account" style={{ backgroundColor: theme.colors.secondaryContainer }} />
                 )}
               </TouchableOpacity>
             )}
             titleStyle={{ color: theme.colors.onSurface }}
             subtitleStyle={{ color: theme.colors.onSurfaceVariant }}
           />
           <Card.Content>
             <Text style={{ color: theme.colors.onSurfaceVariant }}>Points: {points}</Text>
             <Text style={{ color: theme.colors.onSurfaceVariant }}>Total toys: {toyCounts.total} (in {toyCounts.in} / out {toyCounts.out})</Text>
           </Card.Content>
         </Card>

         <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 

          <List.Item title="Help" left={() => <BouncyIconButton icon="help-circle" bg={theme.colors.primary} onPress={onHelp} size="small" />} onPress={onHelp} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
           <Divider />

          <List.Item title="Manual" left={() => <BouncyIconButton icon="book" bg={theme.colors.primary} onPress={onManual} size="small" />} onPress={onManual} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
          <List.Item title="Reminders" left={() => <BouncyIconButton icon="bell-outline" bg={theme.colors.secondary} onPress={() => navigation.navigate('Home', { screen: 'ReminderStatus' })} size="small" />} onPress={() => navigation.navigate('Home', { screen: 'ReminderStatus' })} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
          
          {/* Moved reminder entries into ReminderStatusScreen per request */}
         </Card>

         <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 

          <List.Item title="Sign Out" left={() => <BouncyIconButton icon="logout" bg={theme.colors.error} onPress={onLogout} size="small" />} onPress={onLogout} style={{ paddingLeft: 20 }} />
         </Card>
       </ScrollView>
     </LinearGradient>
   );
 }

 const styles = StyleSheet.create({
   container: { flex: 1, padding: 16 /* bg moved to gradient */ },
   card: { borderRadius: 20, marginBottom: 12 },
 });