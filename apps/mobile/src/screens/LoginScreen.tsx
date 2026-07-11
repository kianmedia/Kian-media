import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function signIn() {
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(error.message);
  }
  return (
    <View style={s.wrap}>
      <Text style={s.title}>عهدة كيان</Text>
      <Text style={s.sub}>سجّل الدخول بحسابك في بوابة كيان</Text>
      <TextInput style={s.input} placeholder="البريد الإلكتروني" placeholderTextColor="#78716c" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={s.input} placeholder="كلمة المرور" placeholderTextColor="#78716c" secureTextEntry value={password} onChangeText={setPassword} />
      {err && <Text style={s.err}>{err}</Text>}
      <TouchableOpacity style={[s.btn, busy && { opacity: 0.5 }]} disabled={busy} onPress={signIn}><Text style={s.btnText}>دخول</Text></TouchableOpacity>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#0c0a09", padding: 24, justifyContent: "center" },
  title: { color: "#fff", fontSize: 30, fontWeight: "700", textAlign: "center" },
  sub: { color: "#a8a29e", fontSize: 13, textAlign: "center", marginTop: 6, marginBottom: 24 },
  input: { backgroundColor: "#1c1917", borderColor: "#292524", borderWidth: 1, borderRadius: 10, padding: 14, color: "#fafaf9", marginBottom: 12, textAlign: "right" },
  btn: { backgroundColor: "#e31e24", borderRadius: 10, padding: 15, marginTop: 8 },
  btnText: { color: "#fff", fontWeight: "600", textAlign: "center", fontSize: 15 },
  err: { color: "#f87171", fontSize: 12, marginBottom: 8, textAlign: "center" },
});
