import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import NavigationService from './NavigationService';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from '../lib/types';
import {
  LoginScreen,
  HomeScreen,
  DepositScreen,
  EscrowDetailScreen,
  HistoryScreen,
  NotificationsScreen,
  ProfileScreen,
  NotificationSettingsScreen,
  SecuritySettingsScreen,
  HelpSupportScreen,
  AboutUsScreen,
  AppGuideScreen,
  CommunityGuidelinesScreen,
  PrivacyPolicyScreen,
  TermsOfServiceScreen,
  EditProfileScreen,
  SupportChatScreen,
  DisputeThreadScreen,
  DepositPendingScreen,
  TransactionReceiptScreen,
  VirtualAssistantScreen,
  DisputeScreen,
  InboxScreen,
  ChatScreen,
  RefundRequestScreen,
} from '../screens';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer ref={NavigationService.navigationRef}>
      <Stack.Navigator id="root"
        initialRouteName="Login"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Deposit" component={DepositScreen} />
        <Stack.Screen name="EscrowDetail" component={EscrowDetailScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
        <Stack.Screen name="SecuritySettings" component={SecuritySettingsScreen} />
        <Stack.Screen name="HelpSupport" component={HelpSupportScreen} />
        <Stack.Screen name="AboutUs" component={AboutUsScreen} />
        <Stack.Screen name="AppGuide" component={AppGuideScreen} />
        <Stack.Screen name="CommunityGuidelines" component={CommunityGuidelinesScreen} />
        <Stack.Screen name="VirtualAssistant" component={VirtualAssistantScreen} />
        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
        <Stack.Screen name="SupportChat" component={SupportChatScreen} />
        <Stack.Screen name="DisputeThread" component={DisputeThreadScreen} />
        <Stack.Screen name="DepositPending" component={DepositPendingScreen} />
        <Stack.Screen name="TransactionReceipt" component={TransactionReceiptScreen} />
        <Stack.Screen name="TermsOfService" component={TermsOfServiceScreen} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        <Stack.Screen name="Dispute" component={DisputeScreen} />
        <Stack.Screen name="Inbox" component={InboxScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="RefundRequest" component={RefundRequestScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

