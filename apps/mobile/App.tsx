import { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { supabase } from "./src/lib/supabase";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import ScanScreen from "./src/screens/ScanScreen";

export type RootStack = { Home: undefined; Scan: undefined };
const Stack = createNativeStackNavigator<RootStack>();
const theme = { dark: true, colors: { primary: "#e31e24", background: "#0c0a09", card: "#1c1917", text: "#fafaf9", border: "#292524", notification: "#e31e24" } } as const;

// عهدة كيان — تطبيق الموظف. نفس مصادقة Supabase؛ الصلاحيات تُفرض في القاعدة.
export default function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setAuthed(!!data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (!ready) return null;
  return (
    <NavigationContainer theme={theme as never}>
      <StatusBar style="light" />
      {authed ? (
        <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: "#1c1917" }, headerTintColor: "#fafaf9" }}>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: "عهدتي" }} />
          <Stack.Screen name="Scan" component={ScanScreen} options={{ title: "مسح QR" }} />
        </Stack.Navigator>
      ) : (
        <LoginScreen />
      )}
    </NavigationContainer>
  );
}
