import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Gets the Expo push token and registers it with the API (POST /me/devices), best-effort:
 * izin reddi / emulator / EAS projectId yoklugu akisi BOZMAZ, sessizce gecilir.
 * SPEC 9: "push token kaydi".
 */
export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return; // emulatorde Expo push token uretilmez

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Genel',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await api.post('/me/devices', {
      expoPushToken: token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  } catch {
    // Push is optional; registration failures should not affect the session flow.
  }
}
