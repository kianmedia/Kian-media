import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { resolveQr } from "../lib/api";

// مسح QR للمعدة → حلّ الـ token عبر RPC آمنة (بلا بيانات مالية).
export default function ScanScreen() {
  const [perm, requestPerm] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [asset, setAsset] = useState<{ asset_name: string; asset_code: string; availability_status: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onScan({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true); setErr(null);
    // الـ QR يحمل رابط ?scan=<token> أو الـ token مباشرة.
    const token = (data.match(/scan=([0-9a-fA-F-]{36})/) ?? [])[1] ?? data.trim();
    const r = await resolveQr(token);
    if (r.ok) setAsset(r.data as never); else setErr(r.error);
  }
  if (!perm) return <View style={s.wrap} />;
  if (!perm.granted) return (
    <View style={s.center}><Text style={s.txt}>يلزم إذن الكاميرا لمسح رموز المعدات.</Text>
      <TouchableOpacity style={s.btn} onPress={requestPerm}><Text style={s.btnText}>السماح</Text></TouchableOpacity></View>
  );
  return (
    <View style={s.wrap}>
      {!asset && <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanned ? undefined : onScan} />}
      {(asset || err) && (
        <View style={s.card}>
          {asset ? (
            <>
              <Text style={s.name}>{asset.asset_name}</Text>
              <Text style={s.code}>{asset.asset_code}</Text>
              <Text style={s.status}>الحالة: {asset.availability_status}</Text>
            </>
          ) : <Text style={s.err}>{err}</Text>}
          <TouchableOpacity style={s.btn} onPress={() => { setAsset(null); setErr(null); setScanned(false); }}><Text style={s.btnText}>مسح آخر</Text></TouchableOpacity>
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: "#0c0a09", justifyContent: "center", alignItems: "center", padding: 24 },
  card: { position: "absolute", bottom: 40, left: 20, right: 20, backgroundColor: "#1c1917", borderColor: "#292524", borderWidth: 1, borderRadius: 14, padding: 18 },
  name: { color: "#fff", fontSize: 18, fontWeight: "700" }, code: { color: "#a8a29e", fontFamily: "monospace", marginTop: 4 },
  status: { color: "#e7e5e4", marginTop: 6 }, txt: { color: "#e7e5e4", textAlign: "center", marginBottom: 16 },
  err: { color: "#f87171" }, btn: { backgroundColor: "#e31e24", borderRadius: 10, padding: 12, marginTop: 14 }, btnText: { color: "#fff", textAlign: "center", fontWeight: "600" },
});
