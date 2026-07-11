import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { useFocusEffect, type NavigationProp } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { getMyAssignments } from "../lib/api";
import type { RootStack } from "../../App";

// شاشة الموظف الرئيسية: عهدتي + أزرار صرف/إرجاع/مسح/بلاغ (تُستكمل تدريجيًا).
export default function HomeScreen({ navigation }: { navigation: NavigationProp<RootStack> }) {
  const [rows, setRows] = useState<{ assignment_number: string; status: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    const r = await getMyAssignments();
    if (r.ok) setRows((r.data as { assignment_number: string; status: string }[]) ?? []);
    setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const Btn = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <TouchableOpacity style={s.action} onPress={onPress}><Text style={s.actionText}>{label}</Text></TouchableOpacity>
  );
  return (
    <ScrollView style={s.wrap} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#fff" />}>
      <View style={s.grid}>
        <Btn label="مسح QR" onPress={() => navigation.navigate("Scan")} />
        <Btn label="صرف عهدة" onPress={() => {}} />
        <Btn label="إرجاع العهدة" onPress={() => {}} />
        <Btn label="بلاغ مشكلة" onPress={() => {}} />
      </View>
      <Text style={s.h}>عهدي الحالية</Text>
      {rows.length === 0 ? <Text style={s.empty}>لا عهدة نشطة.</Text> : rows.map((a, i) => (
        <View key={i} style={s.row}><Text style={s.code}>{a.assignment_number}</Text><Text style={s.status}>{a.status}</Text></View>
      ))}
      <TouchableOpacity style={s.logout} onPress={() => supabase.auth.signOut()}><Text style={s.logoutText}>تسجيل الخروج</Text></TouchableOpacity>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#0c0a09", padding: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  action: { backgroundColor: "#e31e24", borderRadius: 12, paddingVertical: 22, width: "47%", alignItems: "center" },
  actionText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  h: { color: "#fff", fontSize: 15, fontWeight: "600", marginBottom: 8 },
  empty: { color: "#78716c", fontSize: 13 },
  row: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#1c1917", borderColor: "#292524", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  code: { color: "#e7e5e4", fontFamily: "monospace" }, status: { color: "#a8a29e", fontSize: 12 },
  logout: { marginTop: 24, padding: 12 }, logoutText: { color: "#f87171", textAlign: "center" },
});
