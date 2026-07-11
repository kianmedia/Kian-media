import type { ExpoConfig } from "expo/config";

// تطبيق كيان للعهدة — Expo config. المتغيرات EXPO_PUBLIC_* تُحقن وقت البناء.
const config: ExpoConfig = {
  name: "Kian Custody",
  slug: "kian-custody",
  scheme: "kiancustody",           // deep link: kiancustody://scan?t=<token>
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: "com.kianmedia.custody",
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: "لمسح رموز QR للمعدات وتصوير أدلة الاستلام والإرجاع.",
      NSLocationWhenInUseUsageDescription: "لتسجيل موقع جلسة المهمة عند تفعيلها بموافقتك فقط.",
    },
  },
  android: {
    package: "com.kianmedia.custody",
    permissions: ["CAMERA", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
  },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
  plugins: ["expo-camera", "expo-location", "expo-secure-store"],
};
export default config;
